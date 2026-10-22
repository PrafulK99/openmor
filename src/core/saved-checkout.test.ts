import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout, type CheckoutDeps } from "@/core/checkout";
import { BuyerActionRequiredError, ProviderError } from "@/core/errors";
import { createQuote, QUOTE_TTL_MS } from "@/core/quotes";
import { createSavedMethodCheckout, MAX_DRIFT_PERCENT, withinDrift } from "@/core/saved-checkout";
import { monthlyAllowance } from "@/core/spend";
import { handleWebhook } from "@/core/webhooks";
import { seedBuyerLink, seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { payment, providerQuote, signedWebhook } from "@/test/fake-adapter";

let t: ReturnType<typeof setup>;
let deps: CheckoutDeps;
let merchantId: string;
let productId: string;
let providerProductId: string;
let link: ReturnType<typeof seedBuyerLink>;
const logged: string[] = [];

const EMAIL = "buyer@example.com";

/** A provider preview with the given total (EUR). */
const preview = (total: number, overrides: Record<string, unknown> = {}) =>
  providerQuote({ total, subtotal: total, tax: 0, ...overrides });

/** Get a quote for `total` (the preview the first call returns), leaving later previews to the test. */
async function quoteFor(total: number, buyer = { country: "DE" }): Promise<string> {
  t.adapter.quote.mockResolvedValueOnce(preview(total));
  return (await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer })).id;
}

/** Make the next re-check preview come back with `total`. */
const nextPreview = (total: number, overrides: Record<string, unknown> = {}) => t.adapter.quote.mockResolvedValueOnce(preview(total, overrides));

const buy = (quoteId: string, overrides: Record<string, unknown> = {}) =>
  createSavedMethodCheckout(deps, { quoteId, buyerEmail: EMAIL, buyerLinkId: link.id, ...overrides });

const order = () => t.db.tables.order[0]!;
const allowance = (now = t.clock.now()) => monthlyAllowance(t.db.asPrisma(), t.db.tables.buyerLink[0] as never, now);

beforeEach(() => {
  logged.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(JSON.stringify(a)));
  }
  t = setup();
  deps = { ...t.deps, appUrl: "https://openmor.example.com/" };
  merchantId = seedMerchant(t.db).id;
  ({ id: productId, providerProductId } = seedProduct(t.db, merchantId, { name: "ShareThings Storage Credits" }));
  link = seedBuyerLink(t.db, merchantId, { monthlyCapAmount: 5000, perOrderCapAmount: 2000, buyerEmail: EMAIL });
});
afterEach(() => vi.restoreAllMocks());

describe("withinDrift (FX drift policy)", () => {
  it("is exactly 1%: 1.01x passes, anything above fails, lower always passes", () => {
    expect(MAX_DRIFT_PERCENT).toBe(1);
    expect(withinDrift(1000, 1000)).toBe(true);
    expect(withinDrift(1010, 1000)).toBe(true);
    expect(withinDrift(1011, 1000)).toBe(false);
    expect(withinDrift(1020, 1000)).toBe(false);
    expect(withinDrift(1, 1000)).toBe(true);
    expect(withinDrift(0, 1000)).toBe(true);
  });

  it("uses integer math, so rounding never lets a total slip over", () => {
    // 954 * 1.01 = 963.54: 963 is within 1%, 964 is not.
    expect(withinDrift(963, 954)).toBe(true);
    expect(withinDrift(964, 954)).toBe(false);
  });
});

describe("a successful saved-method charge", () => {
  it("re-checks the price, charges the saved card with the stored ids, and marks the order paid", async () => {
    const quoteId = await quoteFor(954);
    nextPreview(954);
    const r = await buy(quoteId);

    expect(r).toMatchObject({ created: true, outcome: "paid", fallbackReason: null });
    expect(t.adapter.quote).toHaveBeenCalledTimes(2); // the quote, then the re-check
    expect(t.adapter.chargeSavedMethod).toHaveBeenCalledTimes(1);
    expect(t.adapter.chargeSavedMethod).toHaveBeenCalledWith({
      quote: { items: [{ productId: providerProductId, quantity: 1 }], country: "DE" },
      customer: { email: EMAIL },
      returnUrl: `https://openmor.example.com/orders/${order().id}`,
      metadata: { openmor_order_id: order().id, openmor_quote_id: quoteId },
      customerId: "cus_1",
      paymentMethodId: "pm_1",
    });
    expect(r.order).toMatchObject({ status: "paid", checkoutMode: "saved_method", checkoutUrl: null, quoted: { currency: "EUR", total: 954 }, charged: { total: 954 } });
    expect(order()).toMatchObject({ buyerLinkId: link.id, providerPaymentId: "pay_saved_1", buyerEmail: EMAIL, idempotencyKey: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(t.db.tables.quote[0]!.status).toBe("used");
  });

  it("counts the real charged amount toward the month", async () => {
    const quoteId = await quoteFor(954);
    nextPreview(954);
    t.adapter.chargeSavedMethod.mockImplementationOnce(async (i) => payment({ status: "succeeded", total: 957, tax: 0, currency: "EUR", metadata: i.metadata ?? {} }));
    await buy(quoteId);
    expect(order()).toMatchObject({ chargedTotalAmount: 957, totalAmount: 954 });
    expect((await allowance()).spent).toBe(957);
  });

  it("charges the lower total when the price dropped", async () => {
    const quoteId = await quoteFor(954);
    nextPreview(900);
    t.adapter.chargeSavedMethod.mockImplementationOnce(async (i) => payment({ status: "succeeded", total: 900, tax: 0, currency: "EUR", metadata: i.metadata ?? {} }));
    const r = await buy(quoteId);
    expect(r.order.quoted.total).toBe(900);
    expect((await allowance()).spent).toBe(900);
  });

  it("leaves a charge that is still processing pending, counted against the cap, until the webhook settles it", async () => {
    const quoteId = await quoteFor(954);
    nextPreview(954);
    t.adapter.chargeSavedMethod.mockImplementationOnce(async (i) => payment({ status: "processing", metadata: i.metadata ?? {} }));
    const r = await buy(quoteId);
    expect(r).toMatchObject({ outcome: "processing", order: { status: "pending_payment" } });
    expect((await allowance()).spent).toBe(954);

    await handleWebhook(t.deps, {
      merchantId,
      ...signedWebhook({ id: "msg_1", type: "payment.succeeded", occurredAt: "2026-10-21T12:01:00.000Z", payment: payment({ paymentId: "pay_saved_1", total: 954, tax: 0, currency: "EUR", metadata: { openmor_order_id: order().id as string } }) }),
    });
    expect(order().status).toBe("paid");
    expect((await allowance()).spent).toBe(954);
  });

  it("is idempotent: a repeat with the same quote and email returns the order and never charges again", async () => {
    const quoteId = await quoteFor(954);
    nextPreview(954);
    const first = await buy(quoteId);
    const again = await createSavedMethodCheckout(deps, { quoteId, buyerEmail: "  BUYER@example.com ", buyerLinkId: link.id });
    expect(again).toMatchObject({ created: false, outcome: "existing" });
    expect(again.order.id).toBe(first.order.id);
    expect(t.adapter.chargeSavedMethod).toHaveBeenCalledTimes(1);
    expect(t.db.tables.order).toHaveLength(1);
    expect(t.adapter.quote).toHaveBeenCalledTimes(2);
  });

  it("charges once when two identical calls arrive at the same moment", async () => {
    const quoteId = await quoteFor(954);
    t.adapter.quote.mockResolvedValue(preview(954));
    const [a, b] = await Promise.all([buy(quoteId), buy(quoteId)]);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(a.order.id).toBe(b.order.id);
    expect(t.adapter.chargeSavedMethod).toHaveBeenCalledTimes(1);
    expect(t.db.tables.order).toHaveLength(1);
  });

  it("returns an earlier handoff order for the same quote and email instead of charging", async () => {
    const quoteId = await quoteFor(954);
    const handoff = await createCheckout(deps, { quoteId, buyerEmail: EMAIL });
    const r = await buy(quoteId);
    expect(r).toMatchObject({ created: false, outcome: "existing", order: { id: handoff.order.id, checkoutMode: "handoff" } });
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
  });
});

describe("FX drift: quoted total vs the re-checked total", () => {
  it.each([
    ["exactly 1.00x", 1000, 1000],
    ["exactly 1.01x", 1000, 1010],
    ["just under 1.01x", 954, 963],
  ])("charges at %s", async (_name, quoted, now) => {
    t.db.tables.buyerLink[0]!.perOrderCapAmount = null;
    const quoteId = await quoteFor(quoted);
    nextPreview(now);
    const r = await buy(quoteId);
    expect(r.outcome).toBe("paid");
    expect(r.order.quoted.total).toBe(now);
  });

  it.each([
    ["1.02x", 1000, 1020],
    ["just over 1.01x", 1000, 1011],
    ["one cent over 1.01x on 954", 954, 964],
  ])("refuses PRICE_CHANGED at %s, with a fresh quote, no charge and no order", async (_name, quoted, now) => {
    t.db.tables.buyerLink[0]!.perOrderCapAmount = null;
    const quoteId = await quoteFor(quoted);
    nextPreview(now);
    const err = await buy(quoteId).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "PRICE_CHANGED", name: "PriceChangedError" });
    const fresh = (err as { freshQuote: { id: string; total: number; status: string } }).freshQuote;
    expect(fresh).toMatchObject({ total: now, status: "open", currency: "EUR" });
    expect(fresh.id).not.toBe(quoteId);
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
    expect(t.db.tables.order).toHaveLength(0);
    // The stale quote is retired; the fresh one is stored and usable.
    expect(t.db.tables.quote.find((q) => q.id === quoteId)!.status).toBe("expired");
    expect(t.db.tables.quote.find((q) => q.id === fresh.id)!.status).toBe("open");
    expect((err as Error).message).toContain("1% change");
  });

  it("lets the buyer-approved fresh quote go through", async () => {
    t.db.tables.buyerLink[0]!.perOrderCapAmount = null;
    const quoteId = await quoteFor(1000);
    nextPreview(1020);
    const err = (await buy(quoteId).catch((e: unknown) => e)) as { freshQuote: { id: string } };
    nextPreview(1020);
    const r = await buy(err.freshQuote.id);
    expect(r).toMatchObject({ outcome: "paid", order: { quoted: { total: 1020 } } });
  });

  it("refuses PRICE_CHANGED when the currency changed", async () => {
    const quoteId = await quoteFor(954);
    nextPreview(954, { currency: "USD" });
    await expect(buy(quoteId)).rejects.toMatchObject({ code: "PRICE_CHANGED", message: expect.stringContaining("currency changed") });
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
  });
});

describe("per-order cap", () => {
  beforeEach(() => {
    t.db.tables.buyerLink[0]!.perOrderCapAmount = 954;
  });

  it("allows a total exactly at the cap", async () => {
    const quoteId = await quoteFor(954);
    nextPreview(954);
    expect((await buy(quoteId)).outcome).toBe("paid");
  });

  it("refuses one cent over, saying so, with nothing reserved and the quote still open", async () => {
    const quoteId = await quoteFor(955);
    nextPreview(955);
    const err = await buy(quoteId).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "LIMIT_EXCEEDED", message: expect.stringContaining("over the buyer's limit of €9.54 per purchase"), details: { reason: "per_order_cap", limit_minor: 954, requested_minor: 955 } });
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
    expect(t.db.tables.order).toHaveLength(0);
    expect(t.db.tables.quote[0]!.status).toBe("open");
  });

  it("checks the re-checked total, not the older quoted one", async () => {
    const quoteId = await quoteFor(950);
    nextPreview(955); // within 1% of 950 (959) but over the 954 cap
    await expect(buy(quoteId)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", details: { reason: "per_order_cap" } });
  });
});

describe("monthly cap", () => {
  const quoteAndBuy = async (total: number) => {
    const quoteId = await quoteFor(total);
    nextPreview(total);
    return buy(quoteId);
  };

  beforeEach(() => {
    t.db.tables.buyerLink[0]!.perOrderCapAmount = null;
  });

  it("allows spending exactly up to the cap and refuses the next cent", async () => {
    t.db.tables.buyerLink[0]!.monthlyCapAmount = 1908;
    expect((await quoteAndBuy(954)).outcome).toBe("paid");
    expect((await allowance()).remaining).toBe(954);
    expect((await quoteAndBuy(954)).outcome).toBe("paid"); // lands exactly on the cap
    expect(await allowance()).toMatchObject({ spent: 1908, remaining: 0 });
    const quoteId = await quoteFor(1);
    nextPreview(1);
    await expect(buy(quoteId)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", details: { reason: "monthly_cap", remaining_minor: 0 } });
    expect(t.adapter.chargeSavedMethod).toHaveBeenCalledTimes(2);
  });

  it("says how much is left, and when it resets", async () => {
    t.db.tables.buyerLink[0]!.monthlyCapAmount = 1000;
    await quoteAndBuy(954);
    const quoteId = await quoteFor(954);
    nextPreview(954);
    const err = await buy(quoteId).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: "This purchase costs €9.54, but only €0.46 is left of the buyer's €10.00 monthly limit. It resets on 1 November 2026 (UTC).",
      details: { reason: "monthly_cap", currency: "EUR", requested_minor: 954, limit_minor: 1000, spent_minor: 954, remaining_minor: 46, resets_at: "2026-11-01T00:00:00.000Z" },
    });
    expect(t.db.tables.order).toHaveLength(1);
    expect(t.db.tables.quote.at(-1)!.status).toBe("open");
  });

  it("starts a new month at zero: blocked on the last day, allowed at 00:00:00 UTC on the 1st", async () => {
    t.db.tables.buyerLink[0]!.monthlyCapAmount = 954;
    await quoteAndBuy(954);
    t.clock.advance(Date.parse("2026-10-31T23:59:59.999Z") - t.clock.now().getTime());
    let quoteId = await quoteFor(954);
    nextPreview(954);
    await expect(buy(quoteId)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    t.clock.advance(1); // 2026-11-01T00:00:00.000Z
    quoteId = await quoteFor(954);
    nextPreview(954);
    expect((await buy(quoteId)).outcome).toBe("paid");
    expect(t.db.tables.order).toHaveLength(2);
    expect((await allowance()).spent).toBe(954);
  });

  it("does not count failed, cancelled or refunded orders", async () => {
    t.db.tables.buyerLink[0]!.monthlyCapAmount = 954;
    for (const status of ["failed", "cancelled", "refunded"]) {
      t.db.insert("order", { merchantId, quoteId: "q", buyerLinkId: link.id, idempotencyKey: `${status}`.padEnd(64, "0"), buyerEmail: EMAIL, status, checkoutMode: "saved_method", currency: "EUR", taxAmount: 0, totalAmount: 954 });
    }
    expect((await quoteAndBuy(954)).outcome).toBe("paid");
  });

  it("queues two quick purchases that each fit but not together: only one is charged", async () => {
    t.db.tables.buyerLink[0]!.monthlyCapAmount = 1000;
    const q1 = await quoteFor(954);
    const q2 = await quoteFor(954);
    t.adapter.quote.mockResolvedValue(preview(954));
    const results = await Promise.allSettled([buy(q1), buy(q2)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "LIMIT_EXCEEDED", details: { reason: "monthly_cap", remaining_minor: 46 } });
    expect(t.adapter.chargeSavedMethod).toHaveBeenCalledTimes(1);
    expect(t.db.tables.order).toHaveLength(1);
    // The refused quote was not used up.
    expect(t.db.tables.quote.filter((q) => q.status === "open")).toHaveLength(1);
  });
});

describe("the buyer link", () => {
  const attempt = async () => {
    const quoteId = await quoteFor(954);
    t.adapter.quote.mockResolvedValue(preview(954));
    return buy(quoteId);
  };
  const noChargeFor = async (code: string, messagePart: string) => {
    await expect(attempt()).rejects.toMatchObject({ code, message: expect.stringContaining(messagePart) });
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
    expect(t.db.tables.order).toHaveLength(0);
    expect(t.db.tables.quote[0]!.status).toBe("open");
  };

  it("cannot charge once revoked", async () => {
    t.db.tables.buyerLink[0]!.status = "revoked";
    t.db.tables.buyerLink[0]!.revokedAt = t.clock.now();
    await noChargeFor("BUYER_NOT_LINKED", "revoked");
  });

  it("cannot charge before the buyer approves", async () => {
    t.db.tables.buyerLink[0]!.status = "pending_approval";
    await noChargeFor("BUYER_NOT_LINKED", "not approved");
  });

  it("cannot charge after the permission's end date", async () => {
    t.db.tables.buyerLink[0]!.expiresAt = new Date(t.clock.now().getTime() + 1);
    const quoteId = await quoteFor(954);
    t.clock.advance(1);
    await expect(buy(quoteId)).rejects.toMatchObject({ code: "BUYER_NOT_LINKED", message: expect.stringContaining("expired") });
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
  });

  it("cannot charge a link with no saved card on file", async () => {
    t.db.tables.buyerLink[0]!.providerPaymentMethodId = null;
    await noChargeFor("BUYER_NOT_LINKED", "no saved card");
  });

  it("is revoked if the buyer revokes it while we re-check the price: nothing is charged and the quote stays open", async () => {
    const quoteId = await quoteFor(954);
    t.adapter.quote.mockImplementationOnce(async () => {
      t.db.tables.buyerLink[0]!.status = "revoked";
      return preview(954);
    });
    await expect(buy(quoteId)).rejects.toMatchObject({ code: "BUYER_NOT_LINKED" });
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
    expect(t.db.tables.order).toHaveLength(0);
    expect(t.db.tables.quote[0]!.status).toBe("open");
  });

  it("gives the same answer for an unknown link, someone else's email, and another merchant's link", async () => {
    const quoteId = await quoteFor(954);
    const other = seedMerchant(t.db, { slug: "other", email: "o@x.test" }).id;
    const foreign = seedBuyerLink(t.db, other, { buyerEmail: EMAIL });
    const wrong = [
      buy(quoteId, { buyerLinkId: "bl_nope" }),
      buy(quoteId, { buyerEmail: "stranger@example.com" }),
      buy(quoteId, { buyerLinkId: foreign.id }),
    ];
    const messages: string[] = [];
    for (const p of wrong) messages.push(((await p.catch((e: unknown) => e)) as Error).message);
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toContain("No buyer link with this id for this buyer and merchant");
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
  });

  it("only covers the products the buyer approved", async () => {
    const other = seedProduct(t.db, merchantId, { name: "ShareThings Pro" }).id;
    t.db.tables.buyerLink[0]!.productScope = [other];
    await expect(attempt()).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", details: { reason: "product_scope" }, message: expect.stringContaining("ShareThings Storage Credits") });
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
    // In scope: fine.
    t.db.tables.buyerLink[0]!.productScope = [productId];
    const quoteId = await quoteFor(954);
    nextPreview(954);
    expect((await buy(quoteId)).outcome).toBe("paid");
  });

  it("refuses a quote in a different currency than the link's limits", async () => {
    t.db.tables.buyerLink[0]!.currency = "USD";
    await expect(attempt()).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", details: { reason: "currency", link_currency: "USD", quote_currency: "EUR" } });
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
  });
});

describe("quotes", () => {
  it("refuses an expired, unknown or already-used quote before touching the provider", async () => {
    const quoteId = await quoteFor(954);
    t.clock.advance(QUOTE_TTL_MS);
    await expect(buy(quoteId)).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    await expect(buy("nope")).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });

    const q2 = await quoteFor(954);
    nextPreview(954);
    await buy(q2);
    await expect(buy(q2, { buyerEmail: "someone-else@example.com" })).rejects.toMatchObject({ code: "QUOTE_USED" });
    expect(t.adapter.chargeSavedMethod).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["", "quote_id is required"],
  ])("rejects bad input %j", async (quoteId, message) => {
    await expect(buy(quoteId)).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining(message) });
    await expect(buy("q", { buyerEmail: "not-an-email" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(buy("q", { buyerLinkId: " " })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("buyer_link_id") });
  });
});

describe("when the buyer must be present", () => {
  it("falls back to a hosted checkout link, no longer counts against the cap, and keeps the quote used", async () => {
    const quoteId = await quoteFor(954);
    nextPreview(954);
    t.adapter.chargeSavedMethod.mockRejectedValueOnce(new BuyerActionRequiredError("payment status requires_customer_action"));
    const r = await buy(quoteId);
    expect(r).toMatchObject({ created: true, outcome: "handoff", fallbackReason: "buyer_must_be_present" });
    expect(r.order).toMatchObject({ status: "pending_payment", checkoutMode: "handoff", checkoutUrl: "https://test.checkout.dodopayments.com/session/cks_1" });
    expect(t.adapter.createCheckout).toHaveBeenCalledWith({
      quote: expect.objectContaining({ country: "DE" }),
      customer: { email: EMAIL },
      returnUrl: `https://openmor.example.com/orders/${order().id}`,
      metadata: { openmor_order_id: order().id, openmor_quote_id: quoteId },
    });
    expect(order()).toMatchObject({ providerCheckoutSessionId: "cks_1", providerPaymentId: null });
    expect((await allowance()).spent).toBe(0); // the buyer pays this one themselves
    expect(t.db.tables.quote[0]!.status).toBe("used");
  });

  it("releases everything if the hosted link cannot be created either, so a retry works", async () => {
    const quoteId = await quoteFor(954);
    nextPreview(954);
    t.adapter.chargeSavedMethod.mockRejectedValueOnce(new BuyerActionRequiredError("refused"));
    t.adapter.createCheckout.mockRejectedValueOnce(new ProviderError("Dodo Payments", 500, "down"));
    await expect(buy(quoteId)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(t.db.tables.order).toHaveLength(0);
    expect(t.db.tables.quote[0]!.status).toBe("open");
    expect((await allowance()).spent).toBe(0);
    nextPreview(954);
    expect((await buy(quoteId)).outcome).toBe("paid");
  });

  it("uses a hosted checkout for subscriptions, which renew outside any cap, without charging", async () => {
    const sub = seedProduct(t.db, merchantId, { name: "ShareThings Pro", isRecurring: true }).id;
    t.adapter.quote.mockResolvedValueOnce(preview(954));
    const quoteId = (await createQuote(t.deps, { merchantId, productId: sub, quantity: 1, buyer: { country: "DE" } })).id;
    const r = await buy(quoteId);
    expect(r).toMatchObject({ outcome: "handoff", fallbackReason: "subscription", order: { checkoutMode: "handoff" } });
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
  });

  it("uses a hosted checkout when the quote or the re-check is not binding (the buyer sees the final amount)", async () => {
    t.adapter.quote.mockResolvedValueOnce(preview(954, { isBinding: false }));
    let quoteId = (await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer: { country: "DE" } })).id;
    expect(await buy(quoteId)).toMatchObject({ outcome: "handoff", fallbackReason: "non_binding_price" });

    quoteId = await quoteFor(954);
    nextPreview(954, { isBinding: false });
    expect(await buy(quoteId)).toMatchObject({ outcome: "handoff", fallbackReason: "non_binding_price" });
    expect(t.adapter.chargeSavedMethod).not.toHaveBeenCalled();
  });
});

describe("when the charge outcome is unknown", () => {
  it("keeps the order reserved and counted, throws PROVIDER_ERROR, and never charges a retry", async () => {
    const quoteId = await quoteFor(954);
    nextPreview(954);
    t.adapter.chargeSavedMethod.mockRejectedValueOnce(new ProviderError("Dodo Payments", undefined, "timeout", "Dodo is slow right now, try again in a minute"));
    await expect(buy(quoteId)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });

    // A payment may exist: the order stays, still reserving the spend, and the quote stays used.
    expect(order()).toMatchObject({ status: "pending_payment", checkoutMode: "saved_method", providerPaymentId: null });
    expect(t.db.tables.quote[0]!.status).toBe("used");
    expect((await allowance()).spent).toBe(954);

    // The agent retries with the same quote and email: it gets that order back, with no new charge.
    const retry = await buy(quoteId);
    expect(retry).toMatchObject({ created: false, outcome: "existing", order: { status: "pending_payment", checkoutMode: "saved_method" } });
    expect(t.adapter.chargeSavedMethod).toHaveBeenCalledTimes(1);

    // If the payment did go through, its webhook settles the order.
    await handleWebhook(t.deps, {
      merchantId,
      ...signedWebhook({ id: "msg_9", type: "payment.succeeded", occurredAt: "2026-10-21T12:02:00.000Z", payment: payment({ paymentId: "pay_late", total: 954, tax: 0, currency: "EUR", metadata: { openmor_order_id: order().id as string } }) }),
    });
    expect(order()).toMatchObject({ status: "paid", providerPaymentId: "pay_late" });
  });

  it("does not let an unknown-outcome order be bypassed by asking for a new quote beyond the cap", async () => {
    t.db.tables.buyerLink[0]!.monthlyCapAmount = 1000;
    t.db.tables.buyerLink[0]!.perOrderCapAmount = null;
    const quoteId = await quoteFor(954);
    nextPreview(954);
    t.adapter.chargeSavedMethod.mockRejectedValueOnce(new ProviderError("Dodo Payments", 503, "down"));
    await expect(buy(quoteId)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    const q2 = await quoteFor(954);
    nextPreview(954);
    await expect(buy(q2)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", details: { remaining_minor: 46 } });
  });
});

describe("secrets", () => {
  it("never puts provider ids or the buyer's address in logs or in what core returns for an order", async () => {
    const quoteId = await quoteFor(954);
    nextPreview(954);
    const r = await buy(quoteId);
    const out = JSON.stringify(r);
    for (const secret of ["cus_1", "pm_1", link.id.slice(3)]) expect(out).not.toContain(secret);
    expect(logged.join("\n")).toBe("");
  });
});
