import { nowFrom, type CoreDeps } from "@/core/deps";
import { OpenMorError } from "@/core/errors";
import { applyPaymentEvent } from "@/core/orders";

export interface WebhookRequest {
  merchantId: string;
  headers: Record<string, string>;
  rawBody: string;
}

export interface WebhookOutcome {
  outcome: "processed" | "duplicate";
  webhookId: string;
  type: string;
  /** The order the event matched, or null for events that are not about our orders. */
  orderId: string | null;
  changed: boolean;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/**
 * Verify and apply one provider webhook. Throws WebhookVerificationError for a bad signature
 * (answer 401) and MERCHANT_NOT_FOUND for an unknown merchant. Nothing is read from the body
 * before its signature is verified, and the body is never stored or logged.
 *
 * Idempotent: each delivery id is recorded once. A retry of a fully processed event is
 * skipped; a retry of one that failed half-way is processed again, which is safe because
 * order updates only move forward.
 */
export async function handleWebhook(deps: CoreDeps, req: WebhookRequest): Promise<WebhookOutcome> {
  const merchant = await deps.db.merchant.findUnique({ where: { id: req.merchantId } });
  if (!merchant) throw new OpenMorError("MERCHANT_NOT_FOUND", "Unknown merchant");

  const event = await deps.adapterFor(merchant).verifyWebhook({ headers: req.headers, rawBody: req.rawBody });
  const key = { merchantId_webhookId: { merchantId: merchant.id, webhookId: event.id } };

  let record = await deps.db.webhookEvent.findUnique({ where: key });
  if (!record) {
    try {
      record = await deps.db.webhookEvent.create({
        data: { merchantId: merchant.id, webhookId: event.id, type: event.type },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      record = await deps.db.webhookEvent.findUniqueOrThrow({ where: key });
    }
  }
  if (record.processedAt) {
    return { outcome: "duplicate", webhookId: event.id, type: event.type, orderId: record.orderId, changed: false };
  }

  const result = event.payment
    ? await applyPaymentEvent(deps, merchant.id, event.payment, event.occurredAt)
    : { orderId: null, changed: false };

  await deps.db.webhookEvent.update({
    where: { id: record.id },
    data: { processedAt: nowFrom(deps), orderId: result.orderId },
  });
  return { outcome: "processed", webhookId: event.id, type: event.type, ...result };
}
