import { beforeEach, describe, expect, it } from "vitest";
import { monthlyAllowance, utcMonthWindow } from "@/core/spend";
import { seedBuyerLink, seedMerchant, setup } from "@/test/core-fixtures";

let t: ReturnType<typeof setup>;
let merchantId: string;
let link: ReturnType<typeof seedBuyerLink>;

const OCT = (day: number, time = "12:00:00.000") => new Date(`2026-10-${String(day).padStart(2, "0")}T${time}Z`);

function order(overrides: Record<string, unknown> = {}) {
  return t.db.insert("order", {
    merchantId,
    quoteId: "quote_x",
    buyerLinkId: link.id,
    idempotencyKey: `k${t.db.tables.order.length}`.padEnd(64, "0"),
    buyerEmail: "buyer@example.com",
    status: "paid",
    checkoutMode: "saved_method",
    currency: "EUR",
    taxAmount: 0,
    totalAmount: 1000,
    createdAt: OCT(10),
    ...overrides,
  });
}

const allowance = (now = OCT(20)) => monthlyAllowance(t.db.asPrisma(), link, now);

beforeEach(() => {
  t = setup(OCT(20));
  merchantId = seedMerchant(t.db).id;
  link = seedBuyerLink(t.db, merchantId, { monthlyCapAmount: 5000 });
});

describe("utcMonthWindow", () => {
  it("is the UTC calendar month, start inclusive and end exclusive", () => {
    expect(utcMonthWindow(OCT(20))).toEqual({ start: new Date("2026-10-01T00:00:00.000Z"), end: new Date("2026-11-01T00:00:00.000Z") });
    expect(utcMonthWindow(new Date("2026-12-31T23:59:59.999Z")).end).toEqual(new Date("2027-01-01T00:00:00.000Z"));
    expect(utcMonthWindow(new Date("2026-11-01T00:00:00.000Z")).start).toEqual(new Date("2026-11-01T00:00:00.000Z"));
  });
});

describe("monthlyAllowance", () => {
  it("is the whole cap when nothing was spent, with the reset time", async () => {
    expect(await allowance()).toEqual({ spent: 0, remaining: 5000, resetsAt: new Date("2026-11-01T00:00:00.000Z") });
  });

  it("adds up paid, fulfilled and still-pending saved-method orders", async () => {
    order({ status: "paid", totalAmount: 1000 });
    order({ status: "fulfilled", totalAmount: 700 });
    order({ status: "pending_payment", totalAmount: 300 });
    expect(await allowance()).toMatchObject({ spent: 2000, remaining: 3000 });
  });

  it("ignores failed, cancelled and refunded orders", async () => {
    for (const status of ["failed", "cancelled", "refunded"]) order({ status });
    expect((await allowance()).spent).toBe(0);
  });

  it("ignores handoff orders, other links and other months", async () => {
    const other = seedBuyerLink(t.db, merchantId);
    order({ checkoutMode: "handoff" });
    order({ buyerLinkId: other.id });
    order({ createdAt: new Date("2026-09-30T23:59:59.999Z") });
    expect((await allowance()).spent).toBe(0);
  });

  it("counts what was actually charged when it differs from the quoted total", async () => {
    order({ totalAmount: 1000, chargedTotalAmount: 1010, chargedCurrency: "EUR" });
    expect((await allowance()).spent).toBe(1010);
  });

  it("never reports a negative remainder when spend is over the cap", async () => {
    order({ totalAmount: 6000 });
    expect(await allowance()).toMatchObject({ spent: 6000, remaining: 0 });
  });

  it("resets at the month boundary: last millisecond counts, the next month starts at zero", async () => {
    order({ totalAmount: 4000, createdAt: new Date("2026-10-31T23:59:59.999Z") });
    expect((await allowance(new Date("2026-10-31T23:59:59.999Z"))).spent).toBe(4000);
    const november = await allowance(new Date("2026-11-01T00:00:00.000Z"));
    expect(november).toMatchObject({ spent: 0, remaining: 5000 });
    // And an order placed in November counts only against November.
    order({ totalAmount: 1500, createdAt: new Date("2026-11-01T00:00:00.000Z") });
    expect((await allowance(new Date("2026-11-15T00:00:00Z"))).spent).toBe(1500);
    expect((await allowance(new Date("2026-10-31T23:59:59.999Z"))).spent).toBe(4000);
  });
});
