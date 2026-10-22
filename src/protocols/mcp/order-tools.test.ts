import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQuote, QUOTE_TTL_MS } from "@/core/quotes";
import { handleWebhook } from "@/core/webhooks";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { FAKE_LICENSE_KEY, payment, signedWebhook } from "@/test/fake-adapter";
import type { ToolEnv } from "./tool";
import { checkoutTool } from "./tools/checkout";
import { getOrderTool } from "./tools/get-order";

let t: ReturnType<typeof setup>;
let env: ToolEnv;
let merchantId: string;
let quoteId: string;
const logged: string[] = [];

const text = (r: CallToolResult) => (r.content[0] as { type: "text"; text: string }).text;
const data = (r: CallToolResult) => r.structuredContent as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(async () => {
  logged.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(JSON.stringify(a)));
  }
  t = setup();
  env = { deps: { ...t.deps, appUrl: "http://localhost:3000" }, agentSessionId: "ags_1" };
  merchantId = seedMerchant(t.db).id;
  const productId = seedProduct(t.db, merchantId, { name: "ShareThings Lifetime" }).id;
  t.adapter.quote.mockResolvedValue({
    currency: "EUR", subtotal: 4366, discount: 0, tax: 830, total: 5195,
    items: [{ productId: "p", quantity: 1, taxRateBps: 1900, tax: 830, taxInclusive: false, subscription: false }],
    recurring: null, isBinding: true,
  });
  quoteId = (await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer: { country: "DE" } })).id;
});

afterEach(() => vi.restoreAllMocks());

async function pay(orderId: string, total = 5197) {
  await handleWebhook(t.deps, {
    merchantId,
    ...signedWebhook({
      id: `msg_${orderId}`,
      type: "payment.succeeded",
      occurredAt: "2026-10-21T12:06:00.000Z",
      payment: payment({ total, tax: 830, currency: "EUR", metadata: { openmor_order_id: orderId } }),
    }),
  });
}

describe("checkout tool", () => {
  it("returns the order and checkout link with the requested summary", async () => {
    const r = await checkoutTool.handler({ quote_id: quoteId, buyer_email: "Buyer@Example.com" }, env);
    expect(r.isError).toBeUndefined();
    expect(data(r)).toEqual({
      order_id: expect.any(String),
      status: "pending_payment",
      checkout_url: "https://test.checkout.dodopayments.com/session/cks_1",
      product_name: "ShareThings Lifetime",
      amount_due: { amount_minor: 5195, currency: "EUR", formatted: "€51.95" },
      is_new_order: true,
      mode: "handoff",
      fell_back_to_handoff: false,
      fallback_reason: null,
    });
    expect(text(r)).toBe("Open this link to pay €51.95 for ShareThings Lifetime. The final amount is shown on the checkout page.");
    expect(t.db.tables.order[0]!.agentSessionId).toBe("ags_1");
    expect(checkoutTool.outputSchema.safeParse(data(r)).success).toBe(true);
  });

  it("is idempotent across retries", async () => {
    const a = await checkoutTool.handler({ quote_id: quoteId, buyer_email: "b@x.test" }, env);
    const b = await checkoutTool.handler({ quote_id: quoteId, buyer_email: "b@x.test" }, env);
    expect(data(b)).toMatchObject({ order_id: data(a).order_id, checkout_url: data(a).checkout_url, is_new_order: false });
  });

  it("returns QUOTE_EXPIRED with a hint for an expired quote", async () => {
    t.clock.advance(QUOTE_TTL_MS + 1);
    const r = await checkoutTool.handler({ quote_id: quoteId, buyer_email: "b@x.test" }, env);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^QUOTE_EXPIRED: Quote ".+" is expired\. This quote can no longer be used \(quotes last 15 minutes and check out once\); call get_quote again/);
  });

  it("returns QUOTE_USED with a hint when another buyer already checked out the quote", async () => {
    await checkoutTool.handler({ quote_id: quoteId, buyer_email: "a@x.test" }, env);
    const r = await checkoutTool.handler({ quote_id: quoteId, buyer_email: "b@x.test" }, env);
    expect(r.isError).toBe(true);
    expect(data(r).error.code).toBe("QUOTE_USED");
    expect(text(r)).toMatch(/^QUOTE_USED: .+ call get_quote again for a fresh quote_id/);
    expect(text(r)).not.toContain("a@x.test");
  });

  it("returns INVALID_INPUT for a bad email", async () => {
    const r = await checkoutTool.handler({ quote_id: quoteId, buyer_email: "nope" }, env);
    expect(text(r)).toBe("INVALID_INPUT: buyer_email must be a valid email address, e.g. buyer@example.com.");
  });
});

describe("get_order tool", () => {
  let orderId: string;
  beforeEach(async () => {
    orderId = data(await checkoutTool.handler({ quote_id: quoteId, buyer_email: "b@x.test" }, env)).order_id;
  });

  it("reports a pending order with its payment link", async () => {
    const r = await getOrderTool.handler({ order_id: orderId, buyer_email: "b@x.test" }, env);
    expect(data(r)).toMatchObject({ status: "pending_payment", amount_charged: null, fulfillment: null, checkout_url: expect.stringMatching(/^https:/) });
    expect(text(r)).toBe("Waiting for payment of €51.95 for ShareThings Lifetime. If the buyer has not paid yet, give them the checkout link again.");
    expect(t.adapter.getFulfillment).not.toHaveBeenCalled();
  });

  it("returns the charged amount and the live licence key once paid", async () => {
    await pay(orderId);
    const r = await getOrderTool.handler({ order_id: orderId, buyer_email: "B@X.test" }, env);
    expect(data(r)).toMatchObject({
      status: "paid",
      quoted_total: { amount_minor: 5195, formatted: "€51.95" },
      amount_charged: { amount_minor: 5197, currency: "EUR", formatted: "€51.97" },
      paid_at: "2026-10-21T12:06:00.000Z",
      checkout_url: null,
      fulfillment: {
        license_keys: [{ key: FAKE_LICENSE_KEY, status: "active", activations_limit: 3, expires_at: null }],
        subscription: null,
        credits: [],
        portal_url: expect.stringMatching(/^https:/),
      },
    });
    expect(text(r)).toBe(
      "Payment received: €51.97 (quoted €51.95) for ShareThings Lifetime. Delivered: 1 licence key, a customer portal link; give them to the buyer.",
    );
    // The key is in the structured result for the agent, not in the one-line summary.
    expect(text(r)).not.toContain(FAKE_LICENSE_KEY);
    expect(getOrderTool.outputSchema.safeParse(data(r)).success).toBe(true);
  });

  it("reports a licence key that is still being issued", async () => {
    await pay(orderId);
    t.adapter.getFulfillment.mockResolvedValueOnce({
      paymentId: "pay_1",
      licenseKeys: [{ id: "entg_p", key: null, status: "pending", activationsLimit: null, expiresAt: null }],
      subscription: null,
      credits: [],
      portalUrl: null,
    });
    const r = await getOrderTool.handler({ order_id: orderId, buyer_email: "b@x.test" }, env);
    expect(data(r).fulfillment.license_keys).toEqual([{ key: null, status: "pending", activations_limit: null, expires_at: null }]);
    expect(text(r)).toMatch(/1 licence key still being issued \(call get_order again later\)/);
    expect(getOrderTool.outputSchema.safeParse(data(r)).success).toBe(true);
  });

  it("withholds the licence key without the buyer's email, and refuses a wrong email", async () => {
    await pay(orderId);
    const r = await getOrderTool.handler({ order_id: orderId }, env);
    expect(data(r).fulfillment).toBeNull();
    expect(JSON.stringify(r)).not.toContain(FAKE_LICENSE_KEY);
    expect(text(r)).toMatch(/Call get_order again with buyer_email/);

    const wrong = await getOrderTool.handler({ order_id: orderId, buyer_email: "attacker@x.test" }, env);
    expect(wrong.isError).toBe(true);
    expect(JSON.stringify(wrong)).not.toContain(FAKE_LICENSE_KEY);
  });

  it("never writes the licence key to the database or logs", async () => {
    await pay(orderId);
    await getOrderTool.handler({ order_id: orderId, buyer_email: "b@x.test" }, env);
    expect(JSON.stringify(t.db.tables)).not.toContain(FAKE_LICENSE_KEY);
    expect(logged.join("\n")).not.toContain(FAKE_LICENSE_KEY);
  });

  it("returns ORDER_NOT_FOUND for an unknown order", async () => {
    const r = await getOrderTool.handler({ order_id: "nope" }, env);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('ORDER_NOT_FOUND: No order "nope". Use the order_id exactly as returned by checkout.');
    expect(data(r).error.code).toBe("ORDER_NOT_FOUND");
  });
});
