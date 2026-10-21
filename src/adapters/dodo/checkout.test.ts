import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookVerificationError } from "@/core/errors";
import { DodoAdapter } from "./adapter";

// Mocked SDK for checkout, payments, fulfillment. Webhooks use the real SDK verifier
// (no network), so signature tests run real Standard Webhooks crypto.
const sdk = vi.hoisted(() => ({
  createSession: vi.fn(),
  retrievePayment: vi.fn(),
  retrieveSubscription: vi.fn(),
  listLicenseKeys: vi.fn(),
  listCredits: vi.fn(),
  createPortal: vi.fn(),
}));

vi.mock("dodopayments", async (importOriginal) => {
  const real = await importOriginal<typeof import("dodopayments")>();
  const realWebhooks = new real.default({ bearerToken: "x", environment: "test_mode", baseURL: null, webhookKey: null })
    .webhooks;
  class FakeDodo {
    checkoutSessions = { create: sdk.createSession };
    payments = { retrieve: sdk.retrievePayment };
    subscriptions = { retrieve: sdk.retrieveSubscription };
    licenseKeys = { list: sdk.listLicenseKeys };
    customers = { listCreditEntitlements: sdk.listCredits, customerPortal: { create: sdk.createPortal } };
    webhooks = realWebhooks;
  }
  return { ...real, default: FakeDodo, DodoPayments: FakeDodo };
});

// A real-looking Standard Webhooks secret: "whsec_" + base64 of 32 bytes.
const SECRET = `whsec_${Buffer.alloc(32, 9).toString("base64")}`;

/** Sign like Dodo does (Standard Webhooks): base64(HMAC-SHA256(key, "{id}.{ts}.{body}")). */
function sign(body: string, id = "msg_1", ts = Math.floor(Date.now() / 1000), secret = SECRET) {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` };
}

async function* pages<T>(items: T[]) {
  yield* items;
}

const adapter = (webhookSecret: string | null = SECRET) =>
  new DodoAdapter({ apiKey: "dodo_test_sk_x", environment: "test_mode", webhookSecret });

const dodoPayment = {
  payment_id: "pay_1",
  status: "succeeded",
  currency: "EUR",
  total_amount: 5195,
  tax: 830,
  checkout_session_id: "cks_1",
  customer: { customer_id: "cus_1", email: "b@x.test", name: "B" },
  subscription_id: null,
  metadata: { openmor_order_id: "ord_1" },
  product_cart: [{ product_id: "pdt_life", quantity: 1 }],
};

beforeEach(() => {
  for (const fn of Object.values(sdk)) fn.mockReset();
});

describe("createCheckout", () => {
  it("creates a hosted session with cart, customer, address, return URL and metadata", async () => {
    sdk.createSession.mockResolvedValue({ session_id: "cks_9", checkout_url: "https://test.checkout/cks_9" });
    const s = await adapter().createCheckout({
      quote: { items: [{ productId: "pdt_life", quantity: 2 }], country: "us", state: "CA", zip: "94102" },
      customer: { email: "b@x.test" },
      returnUrl: "http://localhost:3000/orders/ord_1",
      metadata: { openmor_order_id: "ord_1" },
    });
    expect(sdk.createSession).toHaveBeenCalledWith({
      product_cart: [{ product_id: "pdt_life", quantity: 2 }],
      customer: { email: "b@x.test" },
      billing_address: { country: "US", state: "CA", zipcode: "94102" },
      return_url: "http://localhost:3000/orders/ord_1",
      metadata: { openmor_order_id: "ord_1" },
    });
    expect(s).toEqual({ sessionId: "cks_9", checkoutUrl: "https://test.checkout/cks_9" });
  });

  it("fails clearly when Dodo returns no checkout URL", async () => {
    sdk.createSession.mockResolvedValue({ session_id: "cks_9", checkout_url: null });
    await expect(
      adapter().createCheckout({ quote: { items: [], country: "DE" }, customer: { email: "b@x.test" }, returnUrl: "x" }),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});

describe("getPayment / getFulfillment", () => {
  it("maps a payment, stringifying metadata", async () => {
    sdk.retrievePayment.mockResolvedValue({ ...dodoPayment, metadata: { openmor_order_id: "ord_1", n: 3 } });
    expect(await adapter().getPayment("pay_1")).toEqual({
      paymentId: "pay_1",
      status: "succeeded",
      currency: "EUR",
      total: 5195,
      tax: 830,
      checkoutSessionId: "cks_1",
      customerId: "cus_1",
      subscriptionId: null,
      metadata: { openmor_order_id: "ord_1", n: "3" },
    });
  });

  it("returns only this payment's licence keys, plus credits and a portal link, without emailing the buyer", async () => {
    sdk.retrievePayment.mockResolvedValue(dodoPayment);
    sdk.listLicenseKeys.mockReturnValue(
      pages([
        { id: "lic_1", key: "KEY-OURS", status: "active", payment_id: "pay_1", activations_limit: 3, expires_at: null },
        { id: "lic_2", key: "KEY-OTHER", status: "active", payment_id: "pay_old" },
      ]),
    );
    sdk.listCredits.mockResolvedValue({ items: [{ name: "Storage", balance: "100", unit: "GB" }] });
    sdk.createPortal.mockResolvedValue({ link: "https://portal/abc" });

    const f = await adapter().getFulfillment("pay_1");
    expect(sdk.listLicenseKeys).toHaveBeenCalledWith({ customer_id: "cus_1", product_id: "pdt_life" });
    expect(sdk.createPortal).toHaveBeenCalledWith("cus_1", { send_email: false });
    expect(f).toEqual({
      paymentId: "pay_1",
      licenseKeys: [{ id: "lic_1", key: "KEY-OURS", status: "active", activationsLimit: 3, expiresAt: null }],
      subscription: null,
      credits: [{ name: "Storage", balance: "100", unit: "GB" }],
      portalUrl: "https://portal/abc",
    });
  });

  it("includes the subscription and its keys", async () => {
    sdk.retrievePayment.mockResolvedValue({ ...dodoPayment, subscription_id: "sub_1", product_cart: null });
    sdk.retrieveSubscription.mockResolvedValue({
      subscription_id: "sub_1",
      status: "active",
      next_billing_date: "2026-11-21T00:00:00Z",
      product_id: "pdt_pro",
    });
    sdk.listLicenseKeys.mockReturnValue(
      pages([{ id: "lic_3", key: "K3", status: "active", payment_id: null, subscription_id: "sub_1" }]),
    );
    sdk.listCredits.mockResolvedValue({ items: [] });
    sdk.createPortal.mockResolvedValue({ link: "https://portal/x" });
    const f = await adapter().getFulfillment("pay_1");
    expect(sdk.listLicenseKeys).toHaveBeenCalledWith({ customer_id: "cus_1", product_id: "pdt_pro" });
    expect(f.subscription).toEqual({ id: "sub_1", status: "active", nextBillingDate: "2026-11-21T00:00:00Z" });
    expect(f.licenseKeys.map((k) => k.key)).toEqual(["K3"]);
  });
});

describe("verifyWebhook", () => {
  const body = JSON.stringify({
    type: "payment.succeeded",
    timestamp: "2026-10-21T19:40:00Z",
    business_id: "bus",
    data: dodoPayment,
  });

  it("accepts a correctly signed webhook and normalizes it", async () => {
    const e = await adapter().verifyWebhook({ headers: sign(body), rawBody: body });
    expect(e).toMatchObject({ id: "msg_1", type: "payment.succeeded", occurredAt: "2026-10-21T19:40:00Z" });
    expect(e.payment).toMatchObject({
      paymentId: "pay_1",
      status: "succeeded",
      total: 5195,
      metadata: { openmor_order_id: "ord_1" },
    });
  });

  it("accepts header names in any case", async () => {
    const h = Object.fromEntries(Object.entries(sign(body)).map(([k, v]) => [k.toUpperCase(), v]));
    await expect(adapter().verifyWebhook({ headers: h, rawBody: body })).resolves.toMatchObject({ id: "msg_1" });
  });

  it("rejects a tampered body, a wrong secret, a missing header and a stale timestamp", async () => {
    const headers = sign(body);
    await expect(adapter().verifyWebhook({ headers, rawBody: body.replace("5195", "1") })).rejects.toThrow(
      WebhookVerificationError,
    );
    const other = `whsec_${Buffer.alloc(32, 1).toString("base64")}`;
    await expect(adapter(other).verifyWebhook({ headers, rawBody: body })).rejects.toThrow("invalid signature");
    const noSig: Record<string, string> = { ...headers };
    delete noSig["webhook-signature"];
    await expect(adapter().verifyWebhook({ headers: noSig, rawBody: body })).rejects.toThrow(
      "missing webhook-signature header",
    );
    const stale = sign(body, "msg_1", Math.floor(Date.now() / 1000) - 3600);
    await expect(adapter().verifyWebhook({ headers: stale, rawBody: body })).rejects.toThrow(WebhookVerificationError);
  });

  it("refuses to verify without a configured secret instead of skipping verification", async () => {
    await expect(adapter(null).verifyWebhook({ headers: sign(body), rawBody: body })).rejects.toThrow(
      "no webhook secret configured",
    );
  });

  it("passes non-payment events through by type only", async () => {
    const b = JSON.stringify({ type: "subscription.renewed", timestamp: "2026-10-21T19:40:00Z", data: { subscription_id: "s" } });
    const e = await adapter().verifyWebhook({ headers: sign(b, "msg_2"), rawBody: b });
    expect(e).toEqual({ id: "msg_2", type: "subscription.renewed", occurredAt: "2026-10-21T19:40:00Z" });
  });
});
