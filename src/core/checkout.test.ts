import { beforeEach, describe, expect, it } from "vitest";
import { checkoutIdempotencyKey, createCheckout, type CheckoutDeps } from "@/core/checkout";
import { createQuote, QUOTE_TTL_MS } from "@/core/quotes";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { ProviderError } from "@/core/errors";

let t: ReturnType<typeof setup>;
let deps: CheckoutDeps;
let merchantId: string;
let productId: string;
let providerProductId: string;
let quoteId: string;

beforeEach(async () => {
  t = setup();
  deps = { ...t.deps, appUrl: "http://localhost:3000/" };
  merchantId = seedMerchant(t.db).id;
  ({ id: productId, providerProductId } = seedProduct(t.db, merchantId));
  quoteId = (await createQuote(t.deps, { merchantId, productId, quantity: 2, buyer: { country: "US", state: "CA", zip: "94102" } })).id;
});

describe("createCheckout", () => {
  it("creates a pending handoff order, a Dodo session with return URL and metadata, and uses the quote", async () => {
    const { order, created } = await createCheckout(deps, { quoteId, buyerEmail: "  Buyer@Example.COM ", agentSessionId: "ags_1" });
    expect(created).toBe(true);
    expect(order).toMatchObject({
      quoteId,
      merchantId,
      productId,
      status: "pending_payment",
      checkoutMode: "handoff",
      checkoutUrl: "https://test.checkout.dodopayments.com/session/cks_1",
      quoted: { currency: "EUR", tax: 152, total: 954 },
      charged: null,
    });
    expect(t.adapter.createCheckout).toHaveBeenCalledWith({
      quote: { items: [{ productId: providerProductId, quantity: 2 }], country: "US", state: "CA", zip: "94102" },
      customer: { email: "buyer@example.com" },
      returnUrl: `http://localhost:3000/orders/${order.id}`,
      metadata: { openmor_order_id: order.id, openmor_quote_id: quoteId },
    });
    const row = t.db.tables.order[0]!;
    expect(row).toMatchObject({
      buyerEmail: "buyer@example.com",
      agentSessionId: "ags_1",
      providerCheckoutSessionId: "cks_1",
      idempotencyKey: checkoutIdempotencyKey(quoteId, "buyer@example.com"),
    });
    expect(row.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(t.db.tables.quote[0]!.status).toBe("used");
  });

  it("is idempotent: a repeat with the same quote and email returns the same order and URL", async () => {
    const first = await createCheckout(deps, { quoteId, buyerEmail: "buyer@example.com" });
    const again = await createCheckout(deps, { quoteId, buyerEmail: "BUYER@example.com" });
    expect(again.created).toBe(false);
    expect(again.order.id).toBe(first.order.id);
    expect(again.order.checkoutUrl).toBe(first.order.checkoutUrl);
    expect(t.db.tables.order).toHaveLength(1);
    expect(t.adapter.createCheckout).toHaveBeenCalledTimes(1);
  });

  it("refuses a used quote for a different buyer with QUOTE_EXPIRED", async () => {
    await createCheckout(deps, { quoteId, buyerEmail: "a@example.com" });
    await expect(createCheckout(deps, { quoteId, buyerEmail: "b@example.com" })).rejects.toMatchObject({
      code: "QUOTE_EXPIRED",
      message: expect.stringContaining("already used"),
    });
  });

  it("refuses an expired quote with QUOTE_EXPIRED and creates nothing", async () => {
    t.clock.advance(QUOTE_TTL_MS);
    await expect(createCheckout(deps, { quoteId, buyerEmail: "a@example.com" })).rejects.toMatchObject({
      code: "QUOTE_EXPIRED",
      message: expect.stringContaining("expired"),
    });
    expect(t.db.tables.order).toHaveLength(0);
    expect(t.adapter.createCheckout).not.toHaveBeenCalled();
  });

  it("refuses an unknown quote with QUOTE_EXPIRED", async () => {
    await expect(createCheckout(deps, { quoteId: "nope", buyerEmail: "a@example.com" })).rejects.toMatchObject({
      code: "QUOTE_EXPIRED",
    });
  });

  it.each(["", "not-an-email", "a@", "@x.com"])("rejects bad email %j with INVALID_INPUT", async (email) => {
    await expect(createCheckout(deps, { quoteId, buyerEmail: email })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(t.db.tables.quote[0]!.status).toBe("open");
  });

  it("refuses when the product stopped being sellable after the quote", async () => {
    t.db.tables.product[0]!.agentSellable = false;
    await expect(createCheckout(deps, { quoteId, buyerEmail: "a@example.com" })).rejects.toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
    });
  });

  it("recovers on retry when the provider failed after the order was created", async () => {
    t.adapter.createCheckout.mockRejectedValueOnce(new ProviderError("Dodo Payments", 503, "down"));
    await expect(createCheckout(deps, { quoteId, buyerEmail: "a@example.com" })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
    expect(t.db.tables.order[0]!.checkoutUrl).toBeNull();
    const retry = await createCheckout(deps, { quoteId, buyerEmail: "a@example.com" });
    expect(retry.order.checkoutUrl).toMatch(/^https:\/\//);
    expect(t.db.tables.order).toHaveLength(1);
  });

  it("rolls back the quote claim if the order insert fails", async () => {
    // Make the order insert inside the transaction fail.
    const original = t.db.order.create;
    t.db.order.create = async () => {
      throw new Error("insert failed");
    };
    await expect(createCheckout(deps, { quoteId, buyerEmail: "a@example.com" })).rejects.toThrow("insert failed");
    t.db.order.create = original;
    expect(t.db.tables.quote[0]!.status).toBe("open");
  });
});
