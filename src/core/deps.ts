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

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends one email. Throws EmailSendError on failure. Implemented in src/lib/email.ts. */
export interface EmailSender {
  send(message: EmailMessage, options?: { idempotencyKey?: string }): Promise<void>;
}

export interface CoreDeps {
  db: PrismaClient;
  adapterFor: AdapterFor;
  /** For buyer approval emails. Absent in scripts and tests that never send mail. */
  email?: EmailSender;
  /** Injectable clock for tests. Defaults to the real time. */
  now?: () => Date;
}

export function nowFrom(deps: Pick<CoreDeps, "now">): Date {
  return deps.now ? deps.now() : new Date();
}
