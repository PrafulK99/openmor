import { describe, expect, it } from "vitest";
import type { OrderView } from "@/core/orders";
import { orderPageModel } from "./status";

const base: OrderView = {
  id: "ord_1",
  merchantId: "m",
  quoteId: "q",
  productId: "p",
  productName: "ShareThings Lifetime",
  status: "pending_payment",
  checkoutMode: "handoff",
  checkoutUrl: "https://checkout",
  quoted: { currency: "EUR", tax: 830, total: 5195 },
  charged: null,
  paidAt: null,
  createdAt: new Date(),
};

describe("orderPageModel", () => {
  it("shows waiting for payment with the quoted amount", () => {
    expect(orderPageModel(base)).toMatchObject({ heading: "Waiting for payment", amount: "€51.95" });
  });

  it("shows payment received with the charged amount", () => {
    const m = orderPageModel({ ...base, status: "paid", charged: { currency: "EUR", tax: 830, total: 5197 } });
    expect(m).toMatchObject({ heading: "Payment received", amount: "€51.97" });
  });

  it("shows failures", () => {
    expect(orderPageModel({ ...base, status: "failed" }).heading).toBe("Payment failed");
  });

  it("has no field that could carry a licence key, link or email", () => {
    expect(Object.keys(orderPageModel({ ...base, status: "paid" })).sort()).toEqual(["amount", "detail", "heading", "productName"]);
  });
});
