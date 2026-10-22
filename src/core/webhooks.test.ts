import { beforeEach, describe, expect, it } from "vitest";
import { createCheckout } from "@/core/checkout";
import { WebhookVerificationError } from "@/core/errors";
import { ORDER_RANK, statusesBefore } from "@/core/orders";
import { createQuote } from "@/core/quotes";
import type { WebhookEvent } from "@/core/types";
import { handleWebhook } from "@/core/webhooks";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { payment, signedWebhook } from "@/test/fake-adapter";

let t: ReturnType<typeof setup>;
let merchantId: string;
let orderId: string;

function event(id: string, type: string, overrides: Parameters<typeof payment>[0] = {}): WebhookEvent {
  const status = type.split(".")[1] as "succeeded" | "failed" | "cancelled" | "processing";
  return {
    id,
    type,
    occurredAt: "2026-10-21T12:05:00.000Z",
    payment: payment({ status, metadata: { openmor_order_id: orderId }, ...overrides }),
  };
}

const deliver = (e: WebhookEvent, signature = "valid") =>
  handleWebhook(t.deps, { merchantId, ...signedWebhook(e, signature) });

const order = () => t.db.tables.order.find((o) => o.id === orderId)!;

beforeEach(async () => {
  t = setup();
  merchantId = seedMerchant(t.db).id;
  const productId = seedProduct(t.db, merchantId).id;
  const quote = await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer: { country: "DE" } });
  orderId = (await createCheckout({ ...t.deps, appUrl: "http://x" }, { quoteId: quote.id, buyerEmail: "b@x.test" })).order.id;
});

describe("handleWebhook", () => {
  it("rejects a bad signature without touching anything", async () => {
    await expect(deliver(event("msg_1", "payment.succeeded"), "forged")).rejects.toThrow(WebhookVerificationError);
    expect(t.db.tables.webhookEvent).toHaveLength(0);
    expect(order().status).toBe("pending_payment");
  });

  it("marks the order paid with the payment id, paid time and the amount actually charged", async () => {
    const r = await deliver(event("msg_1", "payment.succeeded", { total: 956, tax: 153, customerId: "cus_9" }));
    expect(r).toMatchObject({ outcome: "processed", orderId, changed: true });
    expect(order()).toMatchObject({
      status: "paid",
      providerPaymentId: "pay_1",
      paidAt: new Date("2026-10-21T12:05:00.000Z"),
      chargedCurrency: "EUR",
      chargedTaxAmount: 153,
      chargedTotalAmount: 956,
      // Quoted amounts are kept: drift is visible, not overwritten.
      totalAmount: 954,
      fulfillment: { provider: "dodo", customerId: "cus_9", subscriptionId: null },
    });
  });

  it("ignores a duplicate delivery of the same webhook id", async () => {
    await deliver(event("msg_1", "payment.succeeded"));
    const before = structuredClone(order());
    const again = await deliver(event("msg_1", "payment.succeeded", { total: 1 }));
    expect(again.outcome).toBe("duplicate");
    expect(order()).toEqual(before);
    expect(t.db.tables.webhookEvent).toHaveLength(1);
  });

  it("reprocesses a retry whose first attempt failed half-way", async () => {
    const original = t.db.order.updateMany;
    t.db.order.updateMany = async () => {
      throw new Error("db blip");
    };
    await expect(deliver(event("msg_1", "payment.succeeded"))).rejects.toThrow("db blip");
    t.db.order.updateMany = original;
    expect(t.db.tables.webhookEvent[0]!.processedAt).toBeNull();
    const retry = await deliver(event("msg_1", "payment.succeeded"));
    expect(retry.outcome).toBe("processed");
    expect(order().status).toBe("paid");
  });

  it("never moves an order backwards when events arrive out of order", async () => {
    await deliver(event("msg_2", "payment.succeeded"));
    await deliver(event("msg_1", "payment.failed", { paymentId: "pay_0" }));
    await deliver(event("msg_3", "payment.cancelled", { paymentId: "pay_0" }));
    await deliver(event("msg_4", "payment.processing"));
    expect(order()).toMatchObject({ status: "paid", providerPaymentId: "pay_1" });
  });

  it("lets a failed attempt be followed by a successful one", async () => {
    await deliver(event("msg_1", "payment.failed", { paymentId: "pay_0" }));
    expect(order().status).toBe("failed");
    await deliver(event("msg_2", "payment.succeeded"));
    expect(order().status).toBe("paid");
  });

  it("finds the order by checkout session id when metadata is missing", async () => {
    const r = await deliver(event("msg_1", "payment.succeeded", { metadata: {}, checkoutSessionId: "cks_1" }));
    expect(r.orderId).toBe(orderId);
    expect(order().status).toBe("paid");
  });

  it("ignores payments that are not ours, and orders of another merchant", async () => {
    const r = await deliver(event("msg_1", "payment.succeeded", { metadata: {}, checkoutSessionId: "cks_other", paymentId: "pay_x" }));
    expect(r).toMatchObject({ outcome: "processed", orderId: null, changed: false });

    const other = seedMerchant(t.db, { slug: "other", email: "o@x.test" });
    const r2 = await handleWebhook(t.deps, { merchantId: other.id, ...signedWebhook(event("msg_9", "payment.succeeded")) });
    expect(r2.orderId).toBeNull();
    expect(order().status).toBe("pending_payment");
  });

  it("records non-payment events without acting on them", async () => {
    const r = await deliver({ id: "msg_1", type: "subscription.renewed", occurredAt: "2026-10-21T12:00:00Z" });
    expect(r).toMatchObject({ outcome: "processed", orderId: null, changed: false });
    expect(t.db.tables.webhookEvent[0]).toMatchObject({ type: "subscription.renewed", processedAt: expect.any(Date) });
  });

  it("throws MERCHANT_NOT_FOUND for an unknown merchant", async () => {
    await expect(handleWebhook(t.deps, { merchantId: "nope", ...signedWebhook(event("m", "payment.succeeded")) })).rejects.toMatchObject({
      code: "MERCHANT_NOT_FOUND",
    });
  });

  it("stores no webhook payload", async () => {
    await deliver(event("msg_1", "payment.succeeded"));
    const allowed = ["createdAt", "id", "merchantId", "orderId", "processedAt", "receivedAt", "type", "updatedAt", "webhookId"];
    for (const key of Object.keys(t.db.tables.webhookEvent[0]!)) expect(allowed).toContain(key);
    expect(JSON.stringify(t.db.tables.webhookEvent)).not.toContain("b@x.test");
  });
});

describe("statusesBefore", () => {
  it("only allows forward moves", () => {
    expect(statusesBefore("paid").sort()).toEqual(["cancelled", "failed", "pending_payment"]);
    expect(statusesBefore("failed")).toEqual(["pending_payment"]);
    for (const s of statusesBefore("refunded")) expect(ORDER_RANK[s]).toBeLessThan(ORDER_RANK.refunded);
  });
});
