import { createHmac } from "node:crypto";
import { APIConnectionTimeoutError, APIError } from "dodopayments";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuyerActionRequiredError, ProviderError, WebhookVerificationError } from "@/core/errors";
import { DodoAdapter } from "./adapter";

// Mocked SDK for checkout, payments, fulfillment. Webhooks use the real SDK verifier
// (no network), so signature tests run real Standard Webhooks crypto.
const sdk = vi.hoisted(() => ({
  createSession: vi.fn(),
  retrievePayment: vi.fn(),
  retrieveSubscription: vi.fn(),
  listLicenseKeys: vi.fn(),
  retrieveProduct: vi.fn(),
  listGrants: vi.fn(),
  listCredits: vi.fn(),
  createPortal: vi.fn(),
  listCustomers: vi.fn(),
  retrievePaymentMethods: vi.fn(),
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
    products = { retrieve: sdk.retrieveProduct };
    entitlements = { grants: { list: sdk.listGrants } };
    customers = {
      list: sdk.listCustomers,
      retrievePaymentMethods: sdk.retrievePaymentMethods,
      listCreditEntitlements: sdk.listCredits,
      customerPortal: { create: sdk.createPortal },
    };
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
    }, {});
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

  // A product whose licence keys come from a license_key entitlement (the current Dodo model).
  const withKeyEntitlement = {
    product_id: "pdt_life",
    license_key_enabled: false,
    entitlements: [
      { id: "ent_key", integration_type: "license_key", name: "Key", integration_config: {} },
      { id: "ent_gh", integration_type: "github", name: "Repo", integration_config: {} },
    ],
  };
  const grant = (over: Record<string, unknown>) => ({
    id: "entg_1",
    integration_type: "license_key",
    status: "Delivered",
    customer_id: "cus_1",
    payment_id: "pay_1",
    subscription_id: null,
    license_key: { id: "lic_1", key: "KEY-OURS", status: "active", activations_used: 0, activations_limit: 3, expires_at: null },
    ...over,
  });

  function stubRest() {
    sdk.listCredits.mockResolvedValue({ items: [{ name: "Storage", balance: "100", unit: "GB" }] });
    sdk.createPortal.mockResolvedValue({ link: "https://portal/abc" });
  }

  it("reads keys from entitlement grants, matched to this payment, plus credits and a portal link", async () => {
    sdk.retrievePayment.mockResolvedValue(dodoPayment);
    sdk.retrieveProduct.mockResolvedValue(withKeyEntitlement);
    sdk.listGrants.mockReturnValue(
      pages([
        grant({}),
        // Same customer, earlier purchase of the same product: not this order.
        grant({ id: "entg_old", payment_id: "pay_old", license_key: { id: "lic_old", key: "KEY-OLD", status: "active" } }),
        // This payment, but revoked or failed: never handed out.
        grant({ id: "entg_rev", status: "Revoked", license_key: { id: "lic_rev", key: "KEY-REVOKED", status: "disabled" } }),
        grant({ id: "entg_fail", status: "Failed", license_key: null }),
      ]),
    );
    stubRest();

    const f = await adapter().getFulfillment("pay_1");
    expect(sdk.retrieveProduct).toHaveBeenCalledWith("pdt_life", {});
    // Only the license_key entitlement is queried, filtered to this customer.
    expect(sdk.listGrants).toHaveBeenCalledTimes(1);
    expect(sdk.listGrants).toHaveBeenCalledWith("ent_key", { customer_id: "cus_1" }, {});
    expect(sdk.listLicenseKeys).not.toHaveBeenCalled();
    expect(sdk.createPortal).toHaveBeenCalledWith("cus_1", { send_email: false }, {});
    expect(f).toEqual({
      paymentId: "pay_1",
      licenseKeys: [{ id: "lic_1", key: "KEY-OURS", status: "active", activationsLimit: 3, expiresAt: null }],
      subscription: null,
      credits: [{ name: "Storage", balance: "100", unit: "GB" }],
      portalUrl: "https://portal/abc",
    });
  });

  it("reports a manually fulfilled grant as pending, with no key", async () => {
    sdk.retrievePayment.mockResolvedValue(dodoPayment);
    sdk.retrieveProduct.mockResolvedValue(withKeyEntitlement);
    sdk.listGrants.mockReturnValue(pages([grant({ id: "entg_p", status: "Pending", license_key: null })]));
    stubRest();
    const f = await adapter().getFulfillment("pay_1");
    expect(f.licenseKeys).toEqual([{ id: "entg_p", key: null, status: "pending", activationsLimit: null, expiresAt: null }]);
  });

  it("matches subscription grants by subscription id", async () => {
    sdk.retrievePayment.mockResolvedValue({ ...dodoPayment, subscription_id: "sub_1", product_cart: null });
    sdk.retrieveSubscription.mockResolvedValue({
      subscription_id: "sub_1",
      status: "active",
      next_billing_date: "2026-11-21T00:00:00Z",
      product_id: "pdt_pro",
    });
    sdk.retrieveProduct.mockResolvedValue({ ...withKeyEntitlement, product_id: "pdt_pro" });
    sdk.listGrants.mockReturnValue(
      pages([
        grant({ payment_id: null, subscription_id: "sub_1", license_key: { id: "lic_3", key: "K3", status: "active" } }),
        grant({ payment_id: null, subscription_id: "sub_other", license_key: { id: "lic_4", key: "K4", status: "active" } }),
      ]),
    );
    stubRest();
    const f = await adapter().getFulfillment("pay_1");
    expect(sdk.retrieveProduct).toHaveBeenCalledWith("pdt_pro", {});
    expect(f.subscription).toEqual({ id: "sub_1", status: "active", nextBillingDate: "2026-11-21T00:00:00Z" });
    expect(f.licenseKeys.map((k) => k.key)).toEqual(["K3"]);
  });

  it("falls back to the deprecated licence-key list only for legacy products without an entitlement", async () => {
    sdk.retrievePayment.mockResolvedValue(dodoPayment);
    sdk.retrieveProduct.mockResolvedValue({ product_id: "pdt_life", license_key_enabled: true, entitlements: [] });
    sdk.listLicenseKeys.mockReturnValue(
      pages([
        { id: "lic_1", key: "KEY-LEGACY", status: "active", payment_id: "pay_1", activations_limit: 1, expires_at: null },
        { id: "lic_2", key: "KEY-OTHER", status: "active", payment_id: "pay_old" },
      ]),
    );
    stubRest();
    const f = await adapter().getFulfillment("pay_1");
    expect(sdk.listGrants).not.toHaveBeenCalled();
    expect(sdk.listLicenseKeys).toHaveBeenCalledWith({ customer_id: "cus_1", product_id: "pdt_life" }, {});
    expect(f.licenseKeys.map((k) => k.key)).toEqual(["KEY-LEGACY"]);
  });

  it("returns no keys for a product without licence keys", async () => {
    sdk.retrievePayment.mockResolvedValue(dodoPayment);
    sdk.retrieveProduct.mockResolvedValue({ product_id: "pdt_life", license_key_enabled: false, entitlements: [] });
    stubRest();
    const f = await adapter().getFulfillment("pay_1");
    expect(f.licenseKeys).toEqual([]);
    expect(sdk.listGrants).not.toHaveBeenCalled();
    expect(sdk.listLicenseKeys).not.toHaveBeenCalled();
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

describe("chargeSavedMethod", () => {
  const input = {
    quote: { items: [{ productId: "pdt_life", quantity: 1 }], country: "de", discountCodes: ["SAVE10"] },
    customer: { email: "b@x.test" },
    returnUrl: "http://localhost:3000/orders/ord_1",
    metadata: { openmor_order_id: "ord_1" },
    customerId: "cus_1",
    paymentMethodId: "pm_1",
  };

  it("confirms a session for the existing customer and method, then reads the payment's status", async () => {
    sdk.createSession.mockResolvedValue({ session_id: "cks_9", checkout_url: null, payment_id: "pay_1" });
    sdk.retrievePayment.mockResolvedValue(dodoPayment);
    const p = await adapter().chargeSavedMethod(input);
    expect(sdk.createSession).toHaveBeenCalledWith(
      {
        product_cart: [{ product_id: "pdt_life", quantity: 1 }],
        customer: { customer_id: "cus_1" },
        payment_method_id: "pm_1",
        confirm: true,
        billing_address: { country: "DE" },
        discount_codes: ["SAVE10"],
        return_url: "http://localhost:3000/orders/ord_1",
        metadata: { openmor_order_id: "ord_1" },
      },
      {},
    );
    expect(sdk.retrievePayment).toHaveBeenCalledWith("pay_1", {});
    expect(p).toMatchObject({ paymentId: "pay_1", status: "succeeded", total: 5195, tax: 830, metadata: { openmor_order_id: "ord_1" } });
  });

  it("returns a payment that is still processing as processing", async () => {
    sdk.createSession.mockResolvedValue({ session_id: "cks_9", payment_id: "pay_1" });
    sdk.retrievePayment.mockResolvedValue({ ...dodoPayment, status: "processing" });
    expect((await adapter().chargeSavedMethod(input)).status).toBe("processing");
  });

  it.each(["requires_customer_action", "requires_payment_method", "requires_confirmation", "failed", "cancelled"])(
    "needs the buyer when the payment is %s",
    async (status) => {
      sdk.createSession.mockResolvedValue({ session_id: "cks_9", payment_id: "pay_1" });
      sdk.retrievePayment.mockResolvedValue({ ...dodoPayment, status });
      await expect(adapter().chargeSavedMethod(input)).rejects.toBeInstanceOf(BuyerActionRequiredError);
    },
  );

  it("needs the buyer when Dodo creates no payment", async () => {
    sdk.createSession.mockResolvedValue({ session_id: "cks_9", checkout_url: "https://x", payment_id: null });
    await expect(adapter().chargeSavedMethod(input)).rejects.toBeInstanceOf(BuyerActionRequiredError);
  });

  it("treats a 4xx refusal as needing the buyer: no payment exists", async () => {
    sdk.createSession.mockRejectedValue(APIError.generate(422, { message: "3DS required" }, undefined, new Headers()));
    const err = await adapter().chargeSavedMethod(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BuyerActionRequiredError);
    expect((err as BuyerActionRequiredError).reason).toBe("Dodo refused the charge (HTTP 422)");
    expect(sdk.retrievePayment).not.toHaveBeenCalled();
  });

  it.each([
    ["a 503", APIError.generate(503, { message: "down" }, undefined, new Headers())],
    ["a timeout", new APIConnectionTimeoutError()],
  ])("rethrows %s as PROVIDER_ERROR, never as needing the buyer: a payment may exist", async (_name, failure) => {
    sdk.createSession.mockRejectedValue(failure);
    const err = await adapter().chargeSavedMethod(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).not.toBeInstanceOf(BuyerActionRequiredError);
  });
});

describe("findSavedPaymentMethod", () => {
  const card = (id: string, extra: Record<string, unknown> = {}) => ({ payment_method: "card", payment_method_id: id, ...extra });

  it("looks the customer up by lowercase email and returns their saved card", async () => {
    sdk.listCustomers.mockReturnValue(pages([{ customer_id: "cus_1", email: "Buyer@Example.com" }]));
    sdk.retrievePaymentMethods.mockResolvedValue({ items: [card("pm_1")] });
    expect(await adapter().findSavedPaymentMethod("  Buyer@Example.com ")).toEqual({ customerId: "cus_1", paymentMethodId: "pm_1" });
    expect(sdk.listCustomers).toHaveBeenCalledWith({ email: "buyer@example.com" }, {});
    expect(sdk.retrievePaymentMethods).toHaveBeenCalledWith("cus_1", {});
  });

  it("ignores customers whose email only partly matches", async () => {
    sdk.listCustomers.mockReturnValue(pages([{ customer_id: "cus_other", email: "xbuyer@example.com.au" }]));
    expect(await adapter().findSavedPaymentMethod("buyer@example.com")).toBeNull();
    expect(sdk.retrievePaymentMethods).not.toHaveBeenCalled();
  });

  it("picks the most recently used card and skips non-cards and cards unusable for repeat charges", async () => {
    sdk.listCustomers.mockReturnValue(pages([{ customer_id: "cus_1", email: "buyer@example.com" }]));
    sdk.retrievePaymentMethods.mockResolvedValue({
      items: [
        card("pm_old", { last_used_at: "2026-01-01T00:00:00Z" }),
        card("pm_new", { last_used_at: "2026-09-01T00:00:00Z" }),
        card("pm_blocked", { last_used_at: "2026-10-01T00:00:00Z", recurring_enabled: false }),
        { payment_method: "upi", payment_method_id: "pm_upi", last_used_at: "2026-10-20T00:00:00Z" },
      ],
    });
    expect((await adapter().findSavedPaymentMethod("buyer@example.com"))?.paymentMethodId).toBe("pm_new");
  });

  it("returns null with no customer, or a customer with no usable card", async () => {
    sdk.listCustomers.mockReturnValueOnce(pages([]));
    expect(await adapter().findSavedPaymentMethod("buyer@example.com")).toBeNull();
    sdk.listCustomers.mockReturnValueOnce(pages([{ customer_id: "cus_1", email: "buyer@example.com" }]));
    sdk.retrievePaymentMethods.mockResolvedValue({ items: [] });
    expect(await adapter().findSavedPaymentMethod("buyer@example.com")).toBeNull();
  });

  it("wraps Dodo failures as PROVIDER_ERROR", async () => {
    sdk.listCustomers.mockImplementation(() => {
      throw APIError.generate(500, { message: "boom" }, undefined, new Headers());
    });
    await expect(adapter().findSavedPaymentMethod("buyer@example.com")).rejects.toMatchObject({ code: "PROVIDER_ERROR", status: 500 });
  });
});

describe("inspectSavedMethods (diagnostics)", () => {
  it("counts customers and each one's listed payment methods, asking for the address as typed and in lower case", async () => {
    sdk.listCustomers.mockImplementation(({ email }: { email: string }) =>
      pages(email === "Buyer@Example.com" ? [{ customer_id: "cus_mixed", email }] : [{ customer_id: "cus_lower", email }]),
    );
    sdk.retrievePaymentMethods.mockImplementation(async (id: string) => ({
      items: id === "cus_mixed" ? [{ payment_method: "card", payment_method_id: "pm_1" }, { payment_method: "upi", payment_method_id: "pm_2" }] : [],
    }));
    const r = await adapter().inspectSavedMethods("  Buyer@Example.com ");
    expect(r).toEqual({ customers: 2, methodCounts: [2, 0] });
    expect(sdk.listCustomers.mock.calls.map((c) => c[0])).toEqual([{ email: "Buyer@Example.com" }, { email: "buyer@example.com" }]);
    expect(JSON.stringify(r)).not.toMatch(/cus_|pm_/);
  });

  it("counts a customer returned by both queries once, and asks once when the address is already lower case", async () => {
    sdk.listCustomers.mockImplementation(() => pages([{ customer_id: "cus_1", email: "buyer@example.com" }]));
    sdk.retrievePaymentMethods.mockResolvedValue({ items: [] });
    expect(await adapter().inspectSavedMethods("buyer@example.com")).toEqual({ customers: 1, methodCounts: [0] });
    expect(sdk.listCustomers).toHaveBeenCalledTimes(1);
    sdk.listCustomers.mockClear();
    expect(await adapter().inspectSavedMethods("Buyer@example.com")).toEqual({ customers: 1, methodCounts: [0] });
    expect(sdk.listCustomers).toHaveBeenCalledTimes(2);
  });

  it("reports no customers as zero", async () => {
    sdk.listCustomers.mockImplementation(() => pages([]));
    expect(await adapter().inspectSavedMethods("nobody@example.com")).toEqual({ customers: 0, methodCounts: [] });
  });
});
