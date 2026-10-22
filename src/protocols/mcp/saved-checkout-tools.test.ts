import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashApprovalToken } from "@/core/buyer-links";
import { BuyerActionRequiredError, ProviderError } from "@/core/errors";
import { createQuote } from "@/core/quotes";
import { seedBuyerLink, seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { providerQuote } from "@/test/fake-adapter";
import { fakeEmail, tokenFromEmail, type FakeEmail } from "@/test/fake-email";
import type { ToolEnv } from "./tool";
import { checkoutTool } from "./tools/checkout";
import { getBuyerLinkTool } from "./tools/get-buyer-link";
import { getOrderTool } from "./tools/get-order";
import { linkBuyerTool } from "./tools/link-buyer";
import { revokeBuyerLinkTool } from "./tools/revoke-buyer-link";

let t: ReturnType<typeof setup>;
let env: ToolEnv;
let email: FakeEmail;
let merchantId: string;
let productId: string;
let link: ReturnType<typeof seedBuyerLink>;
const logged: string[] = [];
const outputs: string[] = [];

const EMAIL = "buyer@example.com";
const text = (r: CallToolResult) => (r.content[0] as { type: "text"; text: string }).text;
const data = (r: CallToolResult) => r.structuredContent as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Run a tool and remember its whole output, for the secrets sweep at the end. */
async function call(r: Promise<CallToolResult>): Promise<CallToolResult> {
  const result = await r;
  outputs.push(JSON.stringify(result));
  return result;
}

const preview = (total: number, overrides: Record<string, unknown> = {}) => providerQuote({ total, subtotal: total, tax: 0, ...overrides });

async function quoteFor(total: number): Promise<string> {
  t.adapter.quote.mockResolvedValueOnce(preview(total));
  return (await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer: { country: "DE" } })).id;
}

const saved = (quoteId: string, extra: Record<string, unknown> = {}) =>
  call(checkoutTool.handler({ quote_id: quoteId, buyer_email: EMAIL, mode: "saved_method", buyer_link_id: link.id, ...extra }, env));

beforeEach(() => {
  logged.length = 0;
  outputs.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(JSON.stringify(a)));
  }
  t = setup();
  email = fakeEmail();
  env = { deps: { ...t.deps, appUrl: "https://openmor.example.com", email }, agentSessionId: "ags_1" };
  merchantId = seedMerchant(t.db).id;
  productId = seedProduct(t.db, merchantId, { name: "ShareThings Storage Credits" }).id;
  link = seedBuyerLink(t.db, merchantId, { monthlyCapAmount: 5000, perOrderCapAmount: 2000, buyerEmail: EMAIL });
});
afterEach(() => vi.restoreAllMocks());

describe("checkout with mode saved_method", () => {
  it("charges the saved card and says so, with no checkout link", async () => {
    const quoteId = await quoteFor(954);
    t.adapter.quote.mockResolvedValueOnce(preview(954));
    const r = await saved(quoteId);
    expect(r.isError).toBeUndefined();
    expect(data(r)).toEqual({
      order_id: expect.any(String),
      status: "paid",
      checkout_url: null,
      product_name: "ShareThings Storage Credits",
      amount_due: { amount_minor: 954, currency: "EUR", formatted: "€9.54" },
      is_new_order: true,
      mode: "saved_method",
      fell_back_to_handoff: false,
      fallback_reason: null,
    });
    expect(text(r)).toBe("Paid €9.54 for ShareThings Storage Credits with the buyer's saved card. Call get_order with order_id and buyer_email to get what they bought.");
    expect(checkoutTool.outputSchema.safeParse(data(r)).success).toBe(true);
    expect(t.db.tables.order[0]!.agentSessionId).toBe("ags_1");
  });

  it("is idempotent: a retry returns the same order and does not charge again", async () => {
    const quoteId = await quoteFor(954);
    t.adapter.quote.mockResolvedValueOnce(preview(954));
    const first = await saved(quoteId);
    const again = await saved(quoteId);
    expect(data(again)).toMatchObject({ order_id: data(first).order_id, is_new_order: false, status: "paid" });
    expect(t.adapter.chargeSavedMethod).toHaveBeenCalledTimes(1);
  });

  it("needs a buyer_link_id with saved_method, and refuses one without it", async () => {
    const quoteId = await quoteFor(954);
    const missing = await call(checkoutTool.handler({ quote_id: quoteId, buyer_email: EMAIL, mode: "saved_method" }, env));
    expect(text(missing)).toMatch(/^INVALID_INPUT: buyer_link_id is required when mode is saved_method/);
    const stray = await call(checkoutTool.handler({ quote_id: quoteId, buyer_email: EMAIL, buyer_link_id: link.id }, env));
    expect(text(stray)).toMatch(/^INVALID_INPUT: buyer_link_id is only used with mode saved_method/);
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
  });

  it("answers PRICE_CHANGED with a fresh quote the agent can show the buyer", async () => {
    t.db.tables.buyerLink[0]!.perOrderCapAmount = null;
    const quoteId = await quoteFor(1000);
    t.adapter.quote.mockResolvedValueOnce(preview(1020));
    const r = await saved(quoteId);
    expect(r.isError).toBe(true);
    expect(data(r).error).toMatchObject({ code: "PRICE_CHANGED", hint: expect.stringContaining("fresh quote") });
    expect(data(r).fresh_quote).toMatchObject({ quote_id: expect.any(String), currency: "EUR", total: { amount_minor: 1020, formatted: "€10.20" }, product_name: "ShareThings Storage Credits" });
    expect(data(r).fresh_quote.quote_id).not.toBe(quoteId);
    expect(text(r)).toMatch(/^PRICE_CHANGED: The price moved from €10\.00 to €10\.20, more than the 1% change allowed.*New quote: ShareThings Storage Credits: €10\.20/);
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
  });

  it("answers LIMIT_EXCEEDED with how much is left", async () => {
    t.db.tables.buyerLink[0]!.monthlyCapAmount = 1000;
    t.db.tables.buyerLink[0]!.perOrderCapAmount = null;
    const q1 = await quoteFor(954);
    t.adapter.quote.mockResolvedValueOnce(preview(954));
    await saved(q1);
    const q2 = await quoteFor(954);
    t.adapter.quote.mockResolvedValueOnce(preview(954));
    const r = await saved(q2);
    expect(r.isError).toBe(true);
    expect(data(r).error).toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: expect.stringContaining("only €0.46 is left of the buyer's €10.00 monthly limit"),
      details: { reason: "monthly_cap", remaining_minor: 46, requested_minor: 954 },
    });
  });

  it("tells the agent when the buyer has to pay on the page instead, and that nothing was charged", async () => {
    const quoteId = await quoteFor(954);
    t.adapter.quote.mockResolvedValueOnce(preview(954));
    t.adapter.chargeSavedMethod.mockRejectedValueOnce(new BuyerActionRequiredError("payment status requires_customer_action"));
    const r = await saved(quoteId);
    expect(r.isError).toBeUndefined();
    expect(data(r)).toMatchObject({
      status: "pending_payment",
      mode: "handoff",
      fell_back_to_handoff: true,
      fallback_reason: "buyer_must_be_present",
      checkout_url: "https://test.checkout.dodopayments.com/session/cks_1",
    });
    expect(text(r)).toBe(
      "The saved card could not be charged without the buyer being present, so give the buyer this link to pay €9.54 for ShareThings Storage Credits. The final amount is shown on the checkout page. This was not charged automatically.",
    );
  });

  it("explains a subscription fallback", async () => {
    const sub = seedProduct(t.db, merchantId, { name: "ShareThings Pro", isRecurring: true }).id;
    t.adapter.quote.mockResolvedValueOnce(preview(954));
    const quoteId = (await createQuote(t.deps, { merchantId, productId: sub, quantity: 1, buyer: { country: "DE" } })).id;
    const r = await saved(quoteId);
    expect(data(r)).toMatchObject({ fell_back_to_handoff: true, fallback_reason: "subscription" });
    expect(text(r)).toContain("subscription, which renews by itself");
  });

  it("reports a charge being confirmed, and warns not to start another", async () => {
    const quoteId = await quoteFor(954);
    t.adapter.quote.mockResolvedValueOnce(preview(954));
    t.adapter.chargeSavedMethod.mockImplementationOnce(async (i) => ({ paymentId: "pay_p", status: "processing", currency: "EUR", total: 954, tax: 0, checkoutSessionId: null, customerId: "cus_1", subscriptionId: null, metadata: i.metadata ?? {} }));
    const r = await saved(quoteId);
    expect(data(r)).toMatchObject({ status: "pending_payment", mode: "saved_method", checkout_url: null });
    expect(text(r)).toBe("€9.54 for ShareThings Storage Credits was charged to the buyer's saved card and is being confirmed. Call get_order in a minute. Do not start another checkout for this: it would not charge again.");
  });

  it("on a timeout returns PROVIDER_ERROR; the retry returns the same pending order and never charges twice", async () => {
    const quoteId = await quoteFor(954);
    t.adapter.quote.mockResolvedValueOnce(preview(954));
    t.adapter.chargeSavedMethod.mockRejectedValueOnce(new ProviderError("Dodo Payments", undefined, "deadline", "Dodo is slow right now, try again in a minute"));
    const failed = await saved(quoteId);
    expect(data(failed).error).toMatchObject({ code: "PROVIDER_ERROR", message: expect.stringContaining("Dodo is slow right now") });
    const retry = await saved(quoteId);
    expect(retry.isError).toBeUndefined();
    expect(data(retry)).toMatchObject({ status: "pending_payment", mode: "saved_method", is_new_order: false });
    expect(t.adapter.chargeSavedMethod).toHaveBeenCalledTimes(1);
    expect(checkoutTool.description).toMatch(/Never get a new quote to try again after a PROVIDER_ERROR/);
  });

  it("a saved-card order shows up in get_order like any other", async () => {
    const quoteId = await quoteFor(954);
    t.adapter.quote.mockResolvedValueOnce(preview(954));
    const orderId = data(await saved(quoteId)).order_id as string;
    const r = await call(getOrderTool.handler({ order_id: orderId, buyer_email: EMAIL }, env));
    expect(data(r)).toMatchObject({ status: "paid", amount_charged: { amount_minor: 954 } });
  });
});

describe("get_buyer_link", () => {
  it("shows an active link's caps, this month's spend and what is left", async () => {
    const quoteId = await quoteFor(954);
    t.adapter.quote.mockResolvedValueOnce(preview(954));
    await saved(quoteId);
    const r = await call(getBuyerLinkTool.handler({ buyer_link_id: link.id, buyer_email: "Buyer@Example.com" }, env));
    expect(data(r)).toMatchObject({
      buyer_link_id: link.id,
      status: "active",
      can_charge: true,
      merchant_name: "ShareThings",
      monthly_cap: { amount_minor: 5000, formatted: "€50.00" },
      per_order_cap: { amount_minor: 2000, formatted: "€20.00" },
      product_ids: null,
      spent_this_month: { amount_minor: 954, formatted: "€9.54" },
      remaining_this_month: { amount_minor: 4046, formatted: "€40.46" },
      month_resets_at: "2026-11-01T00:00:00.000Z",
      approval_expires_at: null,
    });
    expect(text(r)).toBe("Active for ShareThings: €9.54 of €50.00 spent this month, €40.46 left (resets 1 November 2026, UTC). Up to €20.00 per purchase. The permission ends 31 December 2026.");
    expect(getBuyerLinkTool.outputSchema.safeParse(data(r)).success).toBe(true);
  });

  it("follows the whole life of a link: pending, approved, revoked", async () => {
    const created = await call(linkBuyerTool.handler({ merchant_id: merchantId, buyer_email: "new@example.com", monthly_cap: { amount: 3000, currency: "EUR" } }, env));
    const id = data(created).buyer_link_id as string;
    const pending = await call(getBuyerLinkTool.handler({ buyer_link_id: id, buyer_email: "new@example.com" }, env));
    expect(data(pending)).toMatchObject({ status: "pending_approval", can_charge: false, remaining_this_month: { amount_minor: 0 } });
    expect(text(pending)).toMatch(/^Waiting for the buyer to approve in their email \(the link works until 12:30 UTC\)\. Nothing can be charged yet\./);

    const row = t.db.tables.buyerLink.find((l) => l.id === id)!;
    Object.assign(row, { status: "active", providerCustomerId: "cus_9", providerPaymentMethodId: "pm_9" });
    expect(data(await call(getBuyerLinkTool.handler({ buyer_link_id: id, buyer_email: "new@example.com" }, env)))).toMatchObject({ status: "active", can_charge: true, remaining_this_month: { amount_minor: 3000 } });

    await call(revokeBuyerLinkTool.handler({ buyer_link_id: id, buyer_email: "new@example.com" }, env));
    expect(data(await call(getBuyerLinkTool.handler({ buyer_link_id: id, buyer_email: "new@example.com" }, env)))).toMatchObject({ status: "revoked", can_charge: false });
  });

  it("reports an unapproved link whose email lapsed, and an approved link past its end date, as expired", async () => {
    const created = await call(linkBuyerTool.handler({ merchant_id: merchantId, buyer_email: "new@example.com", monthly_cap: { amount: 3000, currency: "EUR" } }, env));
    const id = data(created).buyer_link_id as string;
    t.clock.advance(30 * 60 * 1000);
    expect(data(await call(getBuyerLinkTool.handler({ buyer_link_id: id, buyer_email: "new@example.com" }, env)))).toMatchObject({ status: "expired", can_charge: false });
    t.clock.advance(Date.parse("2027-01-01T00:00:00Z") - t.clock.now().getTime());
    expect(data(await call(getBuyerLinkTool.handler({ buyer_link_id: link.id, buyer_email: EMAIL }, env)))).toMatchObject({ status: "expired", can_charge: false });
  });

  it("gives the same BUYER_NOT_LINKED answer for a wrong email and an unknown id", async () => {
    const wrongEmail = await call(getBuyerLinkTool.handler({ buyer_link_id: link.id, buyer_email: "stranger@example.com" }, env));
    const unknown = await call(getBuyerLinkTool.handler({ buyer_link_id: "bl_nope", buyer_email: EMAIL }, env));
    expect(data(wrongEmail).error.code).toBe("BUYER_NOT_LINKED");
    expect(text(wrongEmail)).toBe(text(unknown));
  });
});

describe("revoke_buyer_link", () => {
  it("revokes, and a revoked link can no longer charge", async () => {
    const r = await call(revokeBuyerLinkTool.handler({ buyer_link_id: link.id, buyer_email: EMAIL }, env));
    expect(r.isError).toBeUndefined();
    expect(data(r)).toMatchObject({ status: "revoked", can_charge: false });
    expect(text(r)).toMatch(/^Revoked\./);
    expect(t.db.tables.buyerLink[0]).toMatchObject({ status: "revoked", revokedAt: t.clock.now() });

    const quoteId = await quoteFor(954);
    const attempt = await saved(quoteId);
    expect(data(attempt).error).toMatchObject({ code: "BUYER_NOT_LINKED", message: expect.stringContaining("revoked") });
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
    expect(t.db.tables.order).toHaveLength(0);
  });

  it("is harmless to repeat", async () => {
    await call(revokeBuyerLinkTool.handler({ buyer_link_id: link.id, buyer_email: EMAIL }, env));
    const again = await call(revokeBuyerLinkTool.handler({ buyer_link_id: link.id, buyer_email: EMAIL }, env));
    expect(data(again).status).toBe("revoked");
  });

  it("does nothing for the wrong email or an unknown id", async () => {
    const wrong = await call(revokeBuyerLinkTool.handler({ buyer_link_id: link.id, buyer_email: "stranger@example.com" }, env));
    expect(data(wrong).error.code).toBe("BUYER_NOT_LINKED");
    expect((await call(revokeBuyerLinkTool.handler({ buyer_link_id: "bl_nope", buyer_email: EMAIL }, env))).isError).toBe(true);
    expect(t.db.tables.buyerLink[0]!.status).toBe("active");
  });

  it("can cancel a link that is still waiting for approval", async () => {
    const created = await call(linkBuyerTool.handler({ merchant_id: merchantId, buyer_email: "new@example.com", monthly_cap: { amount: 3000, currency: "EUR" } }, env));
    const id = data(created).buyer_link_id as string;
    expect(data(await call(revokeBuyerLinkTool.handler({ buyer_link_id: id, buyer_email: "new@example.com" }, env))).status).toBe("revoked");
  });

  it("is marked destructive and idempotent for clients", () => {
    expect(revokeBuyerLinkTool.annotations).toMatchObject({ destructiveHint: true, idempotentHint: true, readOnlyHint: false });
    expect(revokeBuyerLinkTool.description).toMatch(/Never revoke a link on your own initiative/);
  });
});

describe("secrets", () => {
  it("no tool output or log ever contains an approval token, its hash, or a provider customer or payment method id", async () => {
    // Exercise every buyer-link tool on happy and error paths.
    const created = await call(linkBuyerTool.handler({ merchant_id: merchantId, buyer_email: "new@example.com", monthly_cap: { amount: 3000, currency: "EUR" } }, env));
    const id = data(created).buyer_link_id as string;
    const token = tokenFromEmail(email.sent[0]!);
    await call(getBuyerLinkTool.handler({ buyer_link_id: id, buyer_email: "new@example.com" }, env));
    await call(getBuyerLinkTool.handler({ buyer_link_id: id, buyer_email: "wrong@example.com" }, env));

    const quoteId = await quoteFor(954);
    t.adapter.quote.mockResolvedValueOnce(preview(954));
    await saved(quoteId);
    await saved(quoteId); // idempotent repeat
    const q2 = await quoteFor(1000);
    t.adapter.quote.mockResolvedValueOnce(preview(1020));
    t.db.tables.buyerLink[0]!.perOrderCapAmount = null;
    await saved(q2); // PRICE_CHANGED
    t.adapter.chargeSavedMethod.mockRejectedValueOnce(new BuyerActionRequiredError("needs the buyer"));
    const q3 = await quoteFor(954);
    t.adapter.quote.mockResolvedValueOnce(preview(954));
    await saved(q3); // fallback
    await call(revokeBuyerLinkTool.handler({ buyer_link_id: link.id, buyer_email: EMAIL }, env));
    await saved(await quoteFor(954)); // revoked

    const everything = outputs.join("\n") + "\n" + logged.join("\n");
    for (const secret of [token, hashApprovalToken(token), "cus_1", "pm_1", "cus_9", "pm_9", "approve/"]) {
      expect(everything, `leaked ${secret.slice(0, 6)}…`).not.toContain(secret);
    }
    expect(outputs.length).toBeGreaterThan(8);
  });
});
