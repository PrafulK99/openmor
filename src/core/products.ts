import { z } from "zod";
import type { Merchant, Product as ProductRow } from "@/generated/prisma/client";
import type { CoreDeps } from "@/core/deps";
import { OpenMorError } from "@/core/errors";
import type { BillingPeriod } from "@/core/types";

/**
 * Load a merchant and product that agents may buy from: merchant in the network,
 * product belongs to it, is active and agent-sellable. Internal: the merchant row
 * carries the encrypted key, so never return it to callers.
 */
export async function loadSellable(
  deps: CoreDeps,
  merchantId: string,
  productId: string,
): Promise<{ merchant: Merchant; product: ProductRow }> {
  const merchant = await deps.db.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant || !merchant.networkOptIn) {
    throw new OpenMorError("MERCHANT_NOT_FOUND", `No merchant "${merchantId}" in the network`);
  }
  const product = await deps.db.product.findUnique({ where: { id: productId } });
  if (!product || product.merchantId !== merchant.id || !product.active || !product.agentSellable) {
    throw new OpenMorError("PRODUCT_UNAVAILABLE", `Product "${productId}" is not available from this merchant`);
  }
  return { merchant, product };
}

export interface ProductDetails {
  productId: string;
  merchant: { id: string; slug: string; name: string };
  name: string;
  description: string | null;
  /** List price before tax, in minor units of `currency`. A quote gives the real total. */
  price: number;
  currency: string;
  billingType: "one_time" | "subscription";
  billing: BillingPeriod | null;
  usageBased: boolean;
  payWhatYouWant: boolean;
  /** Null when the provider did not say. */
  licenseKeys: boolean | null;
  credits: boolean | null;
  entitlementTypes: string[];
}

// Shape of Product.providerData as written by catalog sync (a normalized core Product).
// Parsed defensively: older rows or other providers may lack fields.
const providerDataSchema = z
  .object({
    billing: z
      .object({ interval: z.enum(["day", "week", "month", "year"]), count: z.number().int().positive() })
      .nullable()
      .catch(null),
    usageBased: z.boolean().catch(false),
    payWhatYouWant: z.boolean().catch(false),
    licenseKeys: z.boolean().nullable().catch(null),
    credits: z.boolean().nullable().catch(null),
    entitlementTypes: z.array(z.string().max(64)).max(50).catch([]),
  })
  .partial();

/** The extra fields catalog sync stores in Product.providerData, parsed defensively. Never returns the raw JSON. */
export function parseProductExtras(providerData: unknown): z.infer<typeof providerDataSchema> {
  const parsed = providerDataSchema.safeParse(providerData ?? {});
  return parsed.success ? parsed.data : {};
}

/** Full details of one agent-sellable product, from the synced catalog. */
export async function getProductDetails(
  deps: CoreDeps,
  input: { merchantId: string; productId: string },
): Promise<ProductDetails> {
  const { merchant, product } = await loadSellable(deps, input.merchantId, input.productId);
  const extra = parseProductExtras(product.providerData);
  return {
    productId: product.id,
    merchant: { id: merchant.id, slug: merchant.slug, name: merchant.name },
    name: product.name,
    description: product.description,
    price: product.priceAmount,
    currency: product.currency,
    billingType: product.isRecurring ? "subscription" : "one_time",
    billing: product.isRecurring ? (extra.billing ?? null) : null,
    usageBased: extra.usageBased ?? false,
    payWhatYouWant: extra.payWhatYouWant ?? false,
    licenseKeys: extra.licenseKeys ?? null,
    credits: extra.credits ?? null,
    entitlementTypes: extra.entitlementTypes ?? [],
  };
}
