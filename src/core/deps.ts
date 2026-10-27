// What core functions need from the outside world. Callers (routes, MCP tools, scripts)
// build this once and pass it in, so core never imports a provider SDK or a global client.
import type { Merchant, PrismaClient } from "@/generated/prisma/client";
import type { ProviderAdapter } from "@/core/types";

/** The merchant fields an adapter factory needs: the encrypted key and the environment flags. */
export type MerchantProviderConfig = Pick<
  Merchant,
  "dodoApiKeyEncrypted" | "dodoEnvironment" | "liveModeEnabled"
> & {
  /** Needed only to verify webhooks; absent until the merchant runs merchant:webhook. */
  dodoWebhookSecretEncrypted?: string | null;
};

export type AdapterFor = (merchant: MerchantProviderConfig) => ProviderAdapter;

export interface CoreDeps {
  db: PrismaClient;
  adapterFor: AdapterFor;
  /** Injectable clock for tests. Defaults to the real time. */
  now?: () => Date;
  /** Show test-mode merchants. Off unless the deployment sets PUBLIC_INCLUDE_TEST_MERCHANTS=true (see core/visibility.ts). */
  includeTestMerchants?: boolean;
}

export function nowFrom(deps: Pick<CoreDeps, "now">): Date {
  return deps.now ? deps.now() : new Date();
}
