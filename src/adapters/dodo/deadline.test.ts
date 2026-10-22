// The real Dodo SDK under a tool-call deadline, with a fake network (global fetch stub).
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOOL_DEADLINE_MS, withDeadline } from "@/core/deadline";
import { ProviderError } from "@/core/errors";
import { DodoAdapter, DODO_SLOW_MESSAGE } from "./adapter";

type Handler = (url: string) => Response | undefined;

/** fetch stub: each request answers after `delayMs` with handler(url), or hangs if it returns undefined. */
function stubFetch(handler: Handler, delayMs = 0) {
  const fetch = vi.fn(
    (input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        const onAbort = () => reject(new DOMException("aborted", "AbortError"));
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });
        const res = handler(String(input));
        if (res) setTimeout(() => resolve(res), delayMs);
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const adapter = () => new DodoAdapter({ apiKey: "sk_test_x", environment: "test_mode" });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Dodo calls under a tool-call deadline", () => {
  it("cuts a hung call off at the deadline with a clean PROVIDER_ERROR, without retrying", async () => {
    const fetch = stubFetch(() => undefined);
    const started = Date.now();
    const err = await withDeadline(100, () => adapter().getProduct("pdt_1")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ code: "PROVIDER_ERROR", message: DODO_SLOW_MESSAGE, status: undefined });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it("shares one budget across calls: a later call gets only the time that is left", async () => {
    // First call answers 404 after 120 ms; the second hangs.
    let n = 0;
    stubFetch(() => (++n === 1 ? json(404, { message: "Product not found" }) : undefined), 120);
    const started = Date.now();
    const result = await withDeadline(200, async () => {
      const first = await adapter().getProduct("pdt_a").catch((e: unknown) => e);
      const second = await adapter().getProduct("pdt_b").catch((e: unknown) => e);
      return { first, second };
    });
    expect(result.first).toMatchObject({ code: "PROVIDER_ERROR", status: 404 });
    expect(result.second).toMatchObject({ code: "PROVIDER_ERROR", message: DODO_SLOW_MESSAGE });
    // Ended at the shared 200 ms deadline, not 200 ms after the second call began.
    expect(Date.now() - started).toBeLessThan(310);
  });

  it("stops a paid order's chain of Dodo calls at 25 s, before the 30 s function limit", async () => {
    vi.useFakeTimers();
    // Every Dodo answer takes 10 s: payment (10 s), product (20 s), credits would end at 30 s.
    const fetch = stubFetch((url) => {
      if (url.includes("/payments/")) return json(200, { payment_id: "pay_1", customer: { customer_id: "cus_1" }, product_cart: [{ product_id: "pdt_1", quantity: 1 }] });
      if (url.includes("/products/")) return json(200, { product_id: "pdt_1", entitlements: [], license_key_enabled: false });
      if (url.includes("/credit-entitlements")) return json(200, { items: [] });
      return json(200, { link: "https://portal" });
    }, 10_000);

    let settled: unknown;
    void withDeadline(TOOL_DEADLINE_MS, () => adapter().getFulfillment("pay_1")).then(
      (v) => (settled = v),
      (e: unknown) => (settled = e),
    );
    await vi.advanceTimersByTimeAsync(TOOL_DEADLINE_MS - 1);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeInstanceOf(ProviderError);
    expect(settled).toMatchObject({ code: "PROVIDER_ERROR", message: DODO_SLOW_MESSAGE });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("passes no signal outside a deadline (webhooks, scripts keep the per-call timeout only)", async () => {
    const fetch = stubFetch(() => json(404, { message: "nope" }));
    await adapter().getProduct("pdt_1").catch(() => {});
    // The SDK always sends its own timeout signal; it must not be an aborted deadline.
    expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(false);
  });
});
