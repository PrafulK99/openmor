import { describe, expect, it } from "vitest";
import { toOrderView } from "@/core/orders";

const row = {
  id: "ord_1",
  merchantId: "m",
  quoteId: "q",
  buyerLinkId: null,
  agentSessionId: null,
  idempotencyKey: "k",
  buyerEmail: "b@x.test",
  status: "pending_payment" as const,
  checkoutMode: "handoff" as const,
  currency: "EUR",
  taxAmount: 830,
  totalAmount: 5195,
  chargedCurrency: null,
  chargedTaxAmount: null,
  chargedTotalAmount: null,
  providerCheckoutSessionId: null,
  providerPaymentId: null,
  checkoutUrl: null,
  fulfillment: null,
  paidAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  quote: { product: { id: "p", name: "ShareThings Lifetime" } },
  merchant: { dodoEnvironment: "live_mode" as const, liveModeEnabled: true },
};

describe("toOrderView", () => {
  it("reports no charge while the charged columns are empty", () => {
    expect(toOrderView(row).charged).toBeNull();
  });

  it("treats missing charged columns (e.g. an older Prisma client) as no charge", () => {
    const old = { ...row } as Record<string, unknown>;
    delete old.chargedCurrency;
    delete old.chargedTotalAmount;
    expect(toOrderView(old as typeof row).charged).toBeNull();
  });

  it("reports the charged amount once set", () => {
    expect(toOrderView({ ...row, chargedCurrency: "EUR", chargedTaxAmount: 831, chargedTotalAmount: 5197 }).charged).toEqual({
      currency: "EUR",
      tax: 831,
      total: 5197,
    });
  });
});
