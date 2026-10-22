import { z } from "zod";
import type { CoreDeps } from "@/core/deps";
import { InvalidInputError, OpenMorError } from "@/core/errors";
import { encrypt } from "@/lib/crypto";

const createMerchantSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, "slug: lowercase letters, digits and dashes, 1-64 chars"),
  email: z.email().trim().toLowerCase().max(320),
  dodoApiKey: z.string().trim().min(1, "Dodo API key is required"),
});

export type CreateMerchantInput = z.input<typeof createMerchantSchema>;

/** A merchant as core returns it. Deliberately has no key fields. */
export interface MerchantView {
  id: string;
  name: string;
  slug: string;
  email: string;
  dodoEnvironment: "test_mode" | "live_mode";
  liveModeEnabled: boolean;
  networkOptIn: boolean;
  createdAt: Date;
}

// Select only safe columns so the encrypted key never leaves the database layer.
export const merchantViewSelect = {
  id: true,
  name: true,
  slug: true,
  email: true,
  dodoEnvironment: true,
  liveModeEnabled: true,
  networkOptIn: true,
  createdAt: true,
} as const;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/**
 * Register a merchant. The key is checked against the provider (one listProducts call)
 * before anything is stored, and is stored only as AES-256-GCM ciphertext.
 * New merchants are test mode and not in the network until they opt in.
 */
export async function createMerchant(deps: CoreDeps, input: CreateMerchantInput): Promise<MerchantView> {
  const parsed = createMerchantSchema.safeParse(input);
  if (!parsed.success) {
    // Report which fields failed, never their values (one of them is the key).
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new InvalidInputError(`Invalid merchant details: ${fields}`);
  }
  const { name, slug, email, dodoApiKey } = parsed.data;

  const config = {
    dodoApiKeyEncrypted: encrypt(dodoApiKey),
    dodoEnvironment: "test_mode" as const,
    liveModeEnabled: false,
  };

  // Throws ProviderError (e.g. HTTP 401) if the key is wrong for test mode.
  await deps.adapterFor(config).listProducts();

  try {
    return await deps.db.merchant.create({
      data: { name, slug, email, ...config },
      select: merchantViewSelect,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new InvalidInputError("A merchant with this slug or email already exists");
    }
    throw err;
  }
}

export async function getMerchantBySlug(deps: CoreDeps, slug: string): Promise<MerchantView> {
  const merchant = await deps.db.merchant.findUnique({
    where: { slug: slug.trim().toLowerCase() },
    select: merchantViewSelect,
  });
  if (!merchant) throw new OpenMorError("MERCHANT_NOT_FOUND", `No merchant with slug "${slug}"`);
  return merchant;
}

/** Load a merchant with its provider config. Internal: never return this object to callers. */
export async function loadMerchantWithConfig(deps: CoreDeps, merchantId: string) {
  const merchant = await deps.db.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) throw new OpenMorError("MERCHANT_NOT_FOUND", `No merchant with id "${merchantId}"`);
  return merchant;
}

export async function setNetworkOptIn(
  deps: CoreDeps,
  merchantId: string,
  optIn: boolean,
): Promise<MerchantView> {
  await loadMerchantWithConfig(deps, merchantId);
  return deps.db.merchant.update({
    where: { id: merchantId },
    data: { networkOptIn: optIn },
    select: merchantViewSelect,
  });
}

// Standard Webhooks secrets from Dodo look like "whsec_" + base64.
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/]{16,}={0,2}$/;

/** Store the merchant's Dodo webhook signing secret, encrypted. Never returned afterwards. */
export async function setWebhookSecret(deps: CoreDeps, merchantId: string, secret: string): Promise<MerchantView> {
  const value = secret.trim();
  if (!WEBHOOK_SECRET.test(value)) {
    throw new InvalidInputError('Webhook secret must look like "whsec_..." as shown in the Dodo dashboard');
  }
  await loadMerchantWithConfig(deps, merchantId);
  return deps.db.merchant.update({
    where: { id: merchantId },
    data: { dodoWebhookSecretEncrypted: encrypt(value) },
    select: merchantViewSelect,
  });
}
