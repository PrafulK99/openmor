import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPROVAL_TTL_MS,
  createBuyerLink,
  describeTerms,
  hashApprovalToken,
  MAX_APPROVAL_EMAILS_PER_HOUR,
  type CreateBuyerLinkInput,
} from "@/core/buyer-links";
import { type CheckoutDeps } from "@/core/checkout";
import { withDeadline } from "@/core/deadline";
import { EmailSendError } from "@/core/errors";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { fakeEmail, tokenFromEmail, type FakeEmail } from "@/test/fake-email";

const DAY = 24 * 60 * 60 * 1000;

let t: ReturnType<typeof setup>;
let email: FakeEmail;
let deps: CheckoutDeps;
let merchantId: string;
let productId: string;
const logged: string[] = [];

const input = (overrides: Partial<CreateBuyerLinkInput> = {}): CreateBuyerLinkInput => ({
  merchantId,
  buyerEmail: "Buyer@Example.com",
  monthlyCap: { amountMinor: 5000, currency: "eur" },
  ...overrides,
});

beforeEach(() => {
  logged.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(JSON.stringify(a)));
  }
  t = setup();
  email = fakeEmail();
  deps = { ...t.deps, appUrl: "https://openmor.example.com/", email };
  merchantId = seedMerchant(t.db).id;
  productId = seedProduct(t.db, merchantId, { name: "ShareThings Lifetime" }).id;
});
afterEach(() => vi.restoreAllMocks());

describe("createBuyerLink", () => {
  it("creates a pending link with the caps, defaults and a 30-day permission, and emails the buyer once", async () => {
    const link = await createBuyerLink(deps, input({ agentSessionId: "ags_1" }));
    expect(t.db.tables.buyerLink).toHaveLength(1);
    expect(t.db.tables.buyerLink[0]).toMatchObject({
      id: link.buyerLinkId,
      merchantId,
      agentSessionId: "ags_1",
      buyerEmail: "buyer@example.com",
      status: "pending_approval",
      currency: "EUR",
      monthlyCapAmount: 5000,
      perOrderCapAmount: null,
      productScope: [],
      providerCustomerId: null,
      providerPaymentMethodId: null,
      approvedAt: null,
    });
    expect(link.expiresAt.getTime() - t.clock.now().getTime()).toBe(30 * DAY);
    expect(link.approvalExpiresAt.getTime() - t.clock.now().getTime()).toBe(APPROVAL_TTL_MS);
    expect(APPROVAL_TTL_MS).toBe(30 * 60 * 1000);
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.sent[0]!.to).toBe("buyer@example.com");
  });

  it("stores only the SHA-256 of the token; the raw token is in the email link and nowhere else", async () => {
    await createBuyerLink(deps, input());
    const token = tokenFromEmail(email.sent[0]!);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(email.sent[0]!.text).toContain(`https://openmor.example.com/approve/${token}`);
    const row = t.db.tables.buyerLink[0]!;
    expect(row.approvalTokenHash).toBe(hashApprovalToken(token));
    expect(row.approvalTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(t.db.tables)).not.toContain(token);
    expect(logged.join("\n")).not.toContain(token);
  });

  it("gives each link a random, unguessable id", async () => {
    const a = await createBuyerLink(deps, input());
    const b = await createBuyerLink(deps, input());
    expect(a.buyerLinkId).toMatch(/^bl_[A-Za-z0-9_-]{24}$/);
    expect(a.buyerLinkId).not.toBe(b.buyerLinkId);
  });

  it("uses a fresh random token for every link", async () => {
    await createBuyerLink(deps, input());
    await createBuyerLink(deps, input());
    expect(tokenFromEmail(email.sent[0]!)).not.toBe(tokenFromEmail(email.sent[1]!));
  });

  it("describes the caps, scope and expiry in plain words in the email", async () => {
    await createBuyerLink(
      deps,
      input({ perOrderCap: { amountMinor: 2000, currency: "EUR" }, productIds: [productId], expiresInDays: 10 }),
    );
    const { text } = email.sent[0]!;
    expect(text).toContain("up to €50.00 each calendar month");
    expect(text).toContain("nothing over €20.00");
    expect(text).toContain("only ShareThings Lifetime");
    expect(text).toContain("ends on 31 October 2026 (UTC)");
    expect(t.db.tables.buyerLink[0]).toMatchObject({ perOrderCapAmount: 2000, productScope: [productId] });
  });

  it("accepts the 1 and 90 day limits and rejects anything outside them", async () => {
    await createBuyerLink(deps, input({ expiresInDays: 1 }));
    const long = await createBuyerLink(deps, input({ expiresInDays: 90 }));
    expect(long.expiresAt.getTime() - t.clock.now().getTime()).toBe(90 * DAY);
    for (const days of [0, 91, -1, 1.5, Number.NaN]) {
      await expect(createBuyerLink(deps, input({ expiresInDays: days }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });

  it.each([
    ["a zero cap", { amountMinor: 0, currency: "EUR" }],
    ["a negative cap", { amountMinor: -5, currency: "EUR" }],
    ["a fractional cap", { amountMinor: 50.5, currency: "EUR" }],
    ["a huge cap", { amountMinor: 3_000_000_000, currency: "EUR" }],
    ["a bad currency", { amountMinor: 5000, currency: "EURO" }],
    ["an unknown currency", { amountMinor: 5000, currency: "ZZZ" }],
  ])("rejects %s for the monthly cap", async (_name, cap) => {
    await expect(createBuyerLink(deps, input({ monthlyCap: cap }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(t.db.tables.buyerLink).toHaveLength(0);
    expect(email.send).not.toHaveBeenCalled();
  });

  it("rejects a per-order cap in another currency or above the monthly cap", async () => {
    await expect(createBuyerLink(deps, input({ perOrderCap: { amountMinor: 100, currency: "USD" } }))).rejects.toThrow(/same as monthly_cap/);
    await expect(createBuyerLink(deps, input({ perOrderCap: { amountMinor: 5001, currency: "EUR" } }))).rejects.toThrow(/more than monthly_cap/);
    // Equal is fine.
    await createBuyerLink(deps, input({ perOrderCap: { amountMinor: 5000, currency: "EUR" } }));
  });

  it.each(["", "not-an-email", "a@", "@x.com", "a b@x.com"])("rejects the email %j", async (buyerEmail) => {
    await expect(createBuyerLink(deps, input({ buyerEmail }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(email.send).not.toHaveBeenCalled();
  });

  it("rejects products that are not this merchant's agent-sellable products, and empty scopes", async () => {
    const other = seedMerchant(t.db, { slug: "other", email: "o@x.test" }).id;
    const foreign = seedProduct(t.db, other).id;
    const hidden = seedProduct(t.db, merchantId, { agentSellable: false }).id;
    await expect(createBuyerLink(deps, input({ productIds: [productId, foreign] }))).rejects.toThrow(foreign);
    await expect(createBuyerLink(deps, input({ productIds: [hidden] }))).rejects.toThrow(hidden);
    await expect(createBuyerLink(deps, input({ productIds: [] }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(createBuyerLink(deps, input({ productIds: Array.from({ length: 21 }, (_, i) => `p${i}`) }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(t.db.tables.buyerLink).toHaveLength(0);
  });

  it("refuses an unknown merchant or one outside the network", async () => {
    await expect(createBuyerLink(deps, input({ merchantId: "nope" }))).rejects.toMatchObject({ code: "MERCHANT_NOT_FOUND" });
    const hidden = seedMerchant(t.db, { slug: "hidden", email: "h@x.test", networkOptIn: false }).id;
    await expect(createBuyerLink(deps, input({ merchantId: hidden }))).rejects.toMatchObject({ code: "MERCHANT_NOT_FOUND" });
  });

  it(`stops after ${MAX_APPROVAL_EMAILS_PER_HOUR} approval emails to one address in an hour, then allows more later`, async () => {
    for (let i = 0; i < MAX_APPROVAL_EMAILS_PER_HOUR; i++) await createBuyerLink(deps, input());
    await expect(createBuyerLink(deps, input())).rejects.toThrow(/Too many approval emails/);
    // A different address is unaffected.
    await createBuyerLink(deps, input({ buyerEmail: "other@example.com" }));
    t.clock.advance(60 * 60 * 1000);
    await createBuyerLink(deps, input());
  });

  it("removes the link and reports PROVIDER_ERROR without details when the email cannot be sent", async () => {
    email.send.mockRejectedValueOnce(new EmailSendError(403, "validation_error"));
    const err = await createBuyerLink(deps, input()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "PROVIDER_ERROR", message: "The approval email could not be sent. Try again in a minute." });
    expect(t.db.tables.buyerLink).toHaveLength(0);
    expect(logged.join("\n")).not.toContain("buyer@example.com");
    // The log line carries the status and error name, nothing about the buyer or the token.
    expect(logged.join("\n")).toContain("validation_error");
  });

  it("removes the link and fails with a clear error when no email sender is configured", async () => {
    await expect(createBuyerLink({ ...t.deps, appUrl: "https://x.example.com" }, input())).rejects.toThrow(/Email is not configured/);
    expect(t.db.tables.buyerLink).toHaveLength(0);
  });

  it("gives up on a hung email send at the tool deadline and leaves nothing behind", async () => {
    vi.useFakeTimers();
    try {
      email.send.mockImplementationOnce(() => new Promise(() => {}));
      const pending = withDeadline(1000, () => createBuyerLink(deps, input())).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toMatchObject({ code: "PROVIDER_ERROR", message: expect.stringContaining("slow to send") });
      expect(t.db.tables.buyerLink).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("describeTerms", () => {
  const base = { merchantName: "ShareThings", currency: "EUR", monthlyCap: 5000, perOrderCap: null, productNames: null, expiresAt: new Date("2026-11-21T00:00:00Z") };

  it("says there is no per-purchase limit and any product when unscoped", () => {
    const lines = describeTerms(base);
    expect(lines[1]).toBe("Per purchase: no separate limit.");
    expect(lines[2]).toBe("What it can buy: anything ShareThings sells to AI assistants.");
    expect(lines[3]).toContain("21 November 2026 (UTC)");
  });

  it("formats amounts in the link's currency, including zero-decimal currencies", () => {
    expect(describeTerms({ ...base, currency: "JPY", monthlyCap: 5000, perOrderCap: 1000 }).slice(0, 2).join(" ")).toContain("¥5,000");
  });
});
