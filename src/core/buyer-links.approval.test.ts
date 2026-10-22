import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_TTL_MS, createBuyerLink, decideApproval, getApprovalView, hashApprovalToken } from "@/core/buyer-links";
import { type CheckoutDeps } from "@/core/checkout";
import { ProviderError } from "@/core/errors";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { fakeEmail, tokenFromEmail } from "@/test/fake-email";

let t: ReturnType<typeof setup>;
let deps: CheckoutDeps;
let merchantId: string;
let productId: string;
let token: string;
const logged: string[] = [];

const link = () => t.db.tables.buyerLink[0]!;

async function sendLink(overrides: Parameters<typeof createBuyerLink>[1] extends infer I ? Partial<I> : never = {}) {
  const email = fakeEmail();
  const d = { ...deps, email };
  await createBuyerLink(d, {
    merchantId,
    buyerEmail: "buyer@example.com",
    monthlyCap: { amountMinor: 5000, currency: "EUR" },
    perOrderCap: { amountMinor: 2000, currency: "EUR" },
    productIds: [productId],
    ...overrides,
  });
  return tokenFromEmail(email.sent.at(-1)!);
}

beforeEach(async () => {
  logged.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(JSON.stringify(a)));
  }
  t = setup();
  deps = { ...t.deps, appUrl: "https://openmor.example.com" };
  merchantId = seedMerchant(t.db).id;
  productId = seedProduct(t.db, merchantId, { name: "ShareThings Lifetime" }).id;
  token = await sendLink();
});
afterEach(() => vi.restoreAllMocks());

describe("getApprovalView", () => {
  it("shows the merchant, caps, product scope and expiry for a pending link", async () => {
    const view = await getApprovalView(deps, token);
    expect(view).toEqual({
      kind: "ready",
      buyerEmail: "buyer@example.com",
      terms: {
        merchantName: "ShareThings",
        currency: "EUR",
        monthlyCap: 5000,
        perOrderCap: 2000,
        productNames: ["ShareThings Lifetime"],
        expiresAt: link().expiresAt,
      },
    });
  });

  it("shows no product list for an unscoped link", async () => {
    token = await sendLink({ productIds: undefined, buyerEmail: "other@example.com" });
    const view = await getApprovalView(deps, token);
    expect(view).toMatchObject({ kind: "ready", terms: { productNames: null } });
  });

  it("only reads: opening the link any number of times (an email scanner) approves nothing", async () => {
    const before = structuredClone(link());
    for (let i = 0; i < 5; i++) expect((await getApprovalView(deps, token)).kind).toBe("ready");
    expect(link()).toEqual(before);
    expect(link().status).toBe("pending_approval");
    expect(t.adapter.findSavedPaymentMethod).not.toHaveBeenCalled();
    expect(t.adapterFor).not.toHaveBeenCalled();
  });

  it("reports unknown, malformed and empty tokens as invalid", async () => {
    for (const bad of ["nope", "", "x".repeat(500), `${token}x`, token.toUpperCase()]) {
      expect(await getApprovalView(deps, bad)).toEqual({ kind: "invalid" });
    }
  });
});

describe("token expiry", () => {
  it("works until 30 minutes after the email and not a millisecond longer", async () => {
    t.clock.advance(APPROVAL_TTL_MS - 1);
    expect((await getApprovalView(deps, token)).kind).toBe("ready");
    t.clock.advance(1);
    expect(await getApprovalView(deps, token)).toEqual({ kind: "expired" });
    expect(await decideApproval(deps, token, "approve")).toEqual({ kind: "expired" });
    expect(await decideApproval(deps, token, "decline")).toEqual({ kind: "expired" });
    expect(link().status).toBe("pending_approval");
    expect(t.adapter.findSavedPaymentMethod).not.toHaveBeenCalled();
  });

  it("expires if the permission's own end date comes first", async () => {
    link().expiresAt = new Date(t.clock.now().getTime() + 60_000);
    t.clock.advance(60_000);
    expect(await decideApproval(deps, token, "approve")).toEqual({ kind: "expired" });
  });

  it("expires when the approval window closes while we wait for the payment provider", async () => {
    t.adapter.findSavedPaymentMethod.mockImplementationOnce(async () => {
      t.clock.advance(APPROVAL_TTL_MS);
      return { customerId: "cus_1", paymentMethodId: "pm_1" };
    });
    expect(await decideApproval(deps, token, "approve")).toEqual({ kind: "expired" });
    expect(link()).toMatchObject({ status: "pending_approval", providerCustomerId: null, providerPaymentMethodId: null });
  });
});

describe("approve", () => {
  it("looks the buyer up by email, stores only the provider ids, and activates the link", async () => {
    expect(await decideApproval(deps, token, "approve")).toEqual({ kind: "approved" });
    expect(t.adapter.findSavedPaymentMethod).toHaveBeenCalledWith("buyer@example.com");
    expect(link()).toMatchObject({
      status: "active",
      approvedAt: t.clock.now(),
      providerCustomerId: "cus_1",
      providerPaymentMethodId: "pm_1",
      revokedAt: null,
    });
  });

  it("is single-use: the same token cannot approve, decline or look up a card again", async () => {
    await decideApproval(deps, token, "approve");
    t.adapter.findSavedPaymentMethod.mockClear();
    t.adapter.findSavedPaymentMethod.mockResolvedValue({ customerId: "cus_ATTACKER", paymentMethodId: "pm_ATTACKER" });
    expect(await decideApproval(deps, token, "approve")).toEqual({ kind: "already_used" });
    expect(await decideApproval(deps, token, "decline")).toEqual({ kind: "already_used" });
    expect(await getApprovalView(deps, token)).toEqual({ kind: "already_used" });
    expect(t.adapter.findSavedPaymentMethod).not.toHaveBeenCalled();
    expect(link()).toMatchObject({ status: "active", providerCustomerId: "cus_1", providerPaymentMethodId: "pm_1" });
  });

  it("keeps the link pending and says so when the buyer has no saved card, then works once a card exists", async () => {
    t.adapter.findSavedPaymentMethod.mockResolvedValueOnce(null);
    expect(await decideApproval(deps, token, "approve")).toEqual({ kind: "no_saved_method" });
    expect(link()).toMatchObject({ status: "pending_approval", providerCustomerId: null, providerPaymentMethodId: null, approvedAt: null });
    expect((await getApprovalView(deps, token)).kind).toBe("ready");
    // The buyer buys once with a normal checkout, then comes back to the same link.
    expect(await decideApproval(deps, token, "approve")).toEqual({ kind: "approved" });
    expect(link().status).toBe("active");
  });

  it("keeps the link pending when the payment provider cannot be reached", async () => {
    t.adapter.findSavedPaymentMethod.mockRejectedValueOnce(new ProviderError("Dodo Payments", 503, "down"));
    expect(await decideApproval(deps, token, "approve")).toEqual({ kind: "provider_unavailable" });
    expect(link().status).toBe("pending_approval");
    expect(await decideApproval(deps, token, "approve")).toEqual({ kind: "approved" });
  });

  it("lets only one of two simultaneous approvals win", async () => {
    t.adapter.findSavedPaymentMethod.mockImplementationOnce(async () => {
      // A second tab approves while the first waits on the provider.
      t.adapter.findSavedPaymentMethod.mockResolvedValueOnce({ customerId: "cus_2", paymentMethodId: "pm_2" });
      expect(await decideApproval(deps, token, "approve")).toEqual({ kind: "approved" });
      return { customerId: "cus_1", paymentMethodId: "pm_1" };
    });
    expect(await decideApproval(deps, token, "approve")).toEqual({ kind: "already_used" });
    expect(link()).toMatchObject({ status: "active", providerCustomerId: "cus_2", providerPaymentMethodId: "pm_2" });
  });

  it("never logs the token, the buyer's address or any provider id", async () => {
    await decideApproval(deps, token, "approve");
    await decideApproval(deps, token, "approve");
    const out = logged.join("\n");
    for (const secret of [token, hashApprovalToken(token), "cus_1", "pm_1", "buyer@example.com"]) expect(out).not.toContain(secret);
  });
});

describe("decline", () => {
  it("ends the link with no card lookup, and the token cannot be used again", async () => {
    expect(await decideApproval(deps, token, "decline")).toEqual({ kind: "declined" });
    expect(link()).toMatchObject({ status: "revoked", revokedAt: t.clock.now(), providerCustomerId: null, providerPaymentMethodId: null });
    expect(t.adapter.findSavedPaymentMethod).not.toHaveBeenCalled();
    expect(await decideApproval(deps, token, "approve")).toEqual({ kind: "already_used" });
    expect(link().status).toBe("revoked");
  });
});
