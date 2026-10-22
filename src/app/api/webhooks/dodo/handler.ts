// HTTP handling for Dodo webhooks, kept apart from route.ts so it can be tested with fakes.
import type { CoreDeps } from "@/core/deps";
import { OpenMorError, WebhookVerificationError } from "@/core/errors";
import { handleWebhook } from "@/core/webhooks";

const MAX_BODY_BYTES = 1024 * 1024;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * 200 when processed or a duplicate, 401 for a bad signature, 404 for an unknown merchant,
 * 500 (so Dodo retries) when processing fails. Never logs the request body: before
 * verification it is untrusted, and after it holds buyer personal data.
 */
export async function handleDodoWebhook(deps: CoreDeps, req: Request, merchantId: string): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json(413, { error: "payload too large" });
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return json(413, { error: "payload too large" });

  const headers = Object.fromEntries(req.headers.entries());
  try {
    const result = await handleWebhook(deps, { merchantId, headers, rawBody });
    return json(200, { ok: true, outcome: result.outcome });
  } catch (err) {
    if (err instanceof WebhookVerificationError) return json(401, { error: "invalid webhook signature" });
    if (err instanceof OpenMorError && err.code === "MERCHANT_NOT_FOUND") return json(404, { error: "unknown merchant" });
    // Name only: error messages can carry data from the payload or the database.
    // eslint-disable-next-line no-console -- logs merchant id and error class name, nothing else
    console.error("dodo webhook processing failed", { merchantId, error: err instanceof Error ? err.name : "unknown" });
    return json(500, { error: "processing failed" });
  }
}
