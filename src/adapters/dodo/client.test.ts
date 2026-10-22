// Runs the real Dodo SDK against a fake transport to check our timeout and retry settings.
import { APIConnectionTimeoutError, APIError } from "dodopayments";
import { describe, expect, it, vi } from "vitest";
import {
  capRetryAfter,
  createDodoClient,
  DODO_MAX_RETRIES,
  DODO_TIMEOUT_MS,
  MAX_RETRY_AFTER_MS,
  retryAfterMs,
} from "./client";

const json = (status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ message: `status ${status}` }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function client(fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>, timeoutMs?: number) {
  return createDodoClient({ apiKey: "sk_test_x", environment: "test_mode", fetch, ...(timeoutMs ? { timeoutMs } : {}) });
}

describe("limits", () => {
  it("fit two attempts plus backoff inside the 30 s function limit", () => {
    expect(DODO_TIMEOUT_MS).toBe(12_000);
    expect(DODO_MAX_RETRIES).toBe(1);
    // Two attempts, the SDK's first backoff (at most 0.5 s), and the longest Retry-After we accept.
    expect(DODO_TIMEOUT_MS * (DODO_MAX_RETRIES + 1) + Math.max(500, MAX_RETRY_AFTER_MS)).toBeLessThan(30_000);
  });
});

describe("retryAfterMs", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("reads retry-after-ms, then retry-after seconds or an HTTP date", () => {
    expect(retryAfterMs(h({ "retry-after-ms": "250", "retry-after": "60" }))).toBe(250);
    expect(retryAfterMs(h({ "retry-after": "3" }))).toBe(3000);
    const now = Date.parse("2026-10-22T10:00:00Z");
    expect(retryAfterMs(h({ "retry-after": "Thu, 22 Oct 2026 10:00:05 GMT" }), now)).toBe(5000);
    expect(retryAfterMs(h({}))).toBeUndefined();
  });
});

describe("capRetryAfter", () => {
  it("marks an error asking for a long wait as not retryable, keeping status and body", async () => {
    const res = await capRetryAfter(async () => json(429, { "retry-after": "60" }))("https://x");
    expect(res.status).toBe(429);
    expect(res.headers.get("x-should-retry")).toBe("false");
    expect(await res.json()).toEqual({ message: "status 429" });
  });

  it("leaves short waits, successes and errors without Retry-After alone", async () => {
    for (const original of [json(429, { "retry-after": "1" }), json(200, { "retry-after": "60" }), json(503)]) {
      expect(await capRetryAfter(async () => original)("https://x")).toBe(original);
    }
  });
});

describe("createDodoClient with the real SDK", () => {
  it("does not retry when Dodo asks to wait 60 s: one attempt, then the 429 error", async () => {
    const fetch = vi.fn(async () => json(429, { "retry-after": "60" }));
    const started = Date.now();
    const err = await client(fetch).products.retrieve("pdt_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("retries a short Retry-After exactly once", async () => {
    const fetch = vi.fn(async () => json(503, { "retry-after-ms": "10" }));
    const err = await client(fetch).products.retrieve("pdt_1").catch((e: unknown) => e);
    expect((err as APIError).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1 + DODO_MAX_RETRIES);
  });

  it("times out a hung request, retries once, then throws a timeout error", async () => {
    // Never answers; rejects only when the SDK aborts it at the timeout.
    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const err = await client(fetch, 50).products.retrieve("pdt_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIConnectionTimeoutError);
    expect(fetch).toHaveBeenCalledTimes(1 + DODO_MAX_RETRIES);
  });

  it("uses the 12 s timeout and the capped fetch by default", () => {
    const c = createDodoClient({ apiKey: "sk_test_x", environment: "test_mode" });
    expect(c.timeout).toBe(DODO_TIMEOUT_MS);
    expect(c.maxRetries).toBe(DODO_MAX_RETRIES);
  });
});
