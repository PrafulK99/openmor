// Picks and builds the provider adapter for a merchant. The only place that decrypts merchant keys.
import type { AdapterFor, MerchantProviderConfig } from "@/core/deps";
import type { ProviderEnvironment } from "@/core/types";
import { isTestMerchant } from "@/core/visibility";
import { decrypt } from "@/lib/crypto";
import { DodoAdapter } from "./dodo";

/** Live mode needs both the live environment and the explicit live flag. Anything else is test mode. */
export function environmentFor(merchant: MerchantProviderConfig): ProviderEnvironment {
  return isTestMerchant(merchant) ? "test_mode" : "live_mode";
}

/** Build an adapterFor. Pass `encryptionKey` only in tests; by default ENCRYPTION_KEY is used. */
export function createAdapterFor(options: { encryptionKey?: Buffer } = {}): AdapterFor {
  return (merchant) =>
    new DodoAdapter({
      apiKey: decrypt(merchant.dodoApiKeyEncrypted, options.encryptionKey),
      environment: environmentFor(merchant),
      webhookSecret: merchant.dodoWebhookSecretEncrypted
        ? decrypt(merchant.dodoWebhookSecretEncrypted, options.encryptionKey)
        : null,
    });
}

export const adapterFor: AdapterFor = createAdapterFor();
