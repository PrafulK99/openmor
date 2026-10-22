// Builds the Dodo Payments SDK client with time limits that fit inside a Vercel function.
import DodoPayments from "dodopayments";
import type { ProviderEnvironment } from "@/core/types";

/**
 * Per-attempt timeout and retries. The SDK retries timeouts too, so the worst case for one
 * call is 12 s + backoff (about 0.5 s) + 12 s = about 24.5 s: a slow Dodo call ends as a
 * PROVIDER_ERROR inside the /api/mcp limit of 30 s instead of the function being killed.
 */
export const DODO_TIMEOUT_MS = 12_000;
export const DODO_MAX_RETRIES = 1;

/** Longest Retry-After we will wait before retrying. This SDK version honors any value. */
export const MAX_RETRY_AFTER_MS = 2_000;

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** The wait a response asks for, parsed the way the SDK does (retry-after-ms, then retry-after). */
export function retryAfterMs(headers: Headers, now: number = Date.now()): number | undefined {
  const ms = headers.get("retry-after-ms");
  if (ms !== null && !Number.isNaN(parseFloat(ms))) return parseFloat(ms);
  const value = headers.get("retry-after");
  if (value === null) return undefined;
  const seconds = parseFloat(value);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : date - now;
}

/**
 * Wrap fetch so an error response asking us to wait longer than MAX_RETRY_AFTER_MS is not
 * retried: it gets `x-should-retry: false`, which the SDK obeys before any other retry rule.
 * The SDK then throws that error at once, and the adapter reports it as PROVIDER_ERROR.
 */
export function capRetryAfter(fetchImpl?: FetchFn): FetchFn {
  return async (input, init) => {
    const res = await (fetchImpl ?? globalThis.fetch)(input, init);
    if (res.ok) return res;
    const wait = retryAfterMs(res.headers);
    if (wait === undefined || wait <= MAX_RETRY_AFTER_MS) return res;
    const headers = new Headers(res.headers);
    headers.set("x-should-retry", "false");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}

export interface DodoClientOptions {
  apiKey: string;
  environment: ProviderEnvironment;
  /** Tests only: the transport under the Retry-After cap, and a shorter per-attempt timeout. */
  fetch?: FetchFn;
  timeoutMs?: number;
}

export function createDodoClient({ apiKey, environment, fetch, timeoutMs }: DodoClientOptions): DodoPayments {
  // Pass every option explicitly: left out, the SDK falls back to DODO_PAYMENTS_* env vars
  // and to live_mode. The caller decides the key and mode, never process.env.
  return new DodoPayments({
    bearerToken: apiKey,
    environment,
    baseURL: null,
    webhookKey: null,
    timeout: timeoutMs ?? DODO_TIMEOUT_MS,
    maxRetries: DODO_MAX_RETRIES,
    fetch: capRetryAfter(fetch),
  });
}
