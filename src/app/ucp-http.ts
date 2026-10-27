// HTTP plumbing for the UCP endpoints (/.well-known/ucp and /ucp/catalog/*). These are public and
// unauthenticated, so: the request body is size-limited before it is parsed, every failure is a fixed
// message that never contains any part of the request, and no response is ever a redirect.
import { createHash } from "node:crypto";
import type { ZodType, infer as zInfer } from "zod";
import { InvalidInputError } from "@/core/errors";
import { UCP_LIMITS, ucpError } from "@/protocols/ucp/catalog";

const JSON_TYPE = "application/json; charset=utf-8";

const FIXED = {
  invalid: ["invalid_request", "The request is not valid for this operation."],
  tooLarge: ["request_too_large", "The request body is too large."],
  internal: ["internal_error", "The catalog is temporarily unavailable."],
} as const;

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": JSON_TYPE, "x-robots-tag": "noindex", ...init.headers },
  });
}

function failure(capability: string, status: number, [code, content]: readonly [string, string]): Response {
  return jsonResponse(ucpError(capability, code, content), { status, headers: { "cache-control": "no-store" } });
}

type Body = { ok: true; value: unknown } | { ok: false; tooLarge: boolean };

/** Read and parse a JSON body of at most `max` bytes. The length header is checked first, and the stream is cut off at the limit regardless. */
export async function readJsonBody(request: Request, max: number = UCP_LIMITS.bodyBytes): Promise<Body> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !/^\d+$/.test(declared)) return { ok: false, tooLarge: false };
  if (declared !== null && Number(declared) > max) return { ok: false, tooLarge: true };
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, tooLarge: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return { ok: false, tooLarge: true };
    }
    chunks.push(value);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

/**
 * Run one catalog operation: read the body, validate it, read the cached catalog, answer. Wrong input
 * is a 400, an oversized body a 413, and anything unexpected a generic 500 (only the error class name
 * is logged, never the request).
 */
export async function handleCatalogRequest<S extends ZodType>(
  request: Request,
  op: { capability: string; schema: S; run: (parsed: zInfer<S>) => Promise<unknown> | unknown },
): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return body.tooLarge ? failure(op.capability, 413, FIXED.tooLarge) : failure(op.capability, 400, FIXED.invalid);
  try {
    const parsed = op.schema.safeParse(body.value);
    if (!parsed.success) return failure(op.capability, 400, FIXED.invalid);
    return jsonResponse(await op.run(parsed.data), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof InvalidInputError) return failure(op.capability, 400, FIXED.invalid);
    // eslint-disable-next-line no-console -- logs the error class name only, never the request
    console.error("ucp catalog request failed", { error: error instanceof Error ? error.name : "unknown" });
    return failure(op.capability, 500, FIXED.internal);
  }
}

/** A strong ETag for a JSON document: the profile changes only on a deploy or a base URL change. */
export const etagOf = (text: string) => `"${createHash("sha256").update(text).digest("base64url").slice(0, 22)}"`;
