import { APIConnectionTimeoutError, APIError } from "dodopayments";
import type { CheckoutSessionPreviewResponse } from "dodopayments/resources/checkout-sessions";
import type { Product as DodoProduct, ProductListResponse } from "dodopayments/resources/products/products";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotImplementedError, ProviderError } from "@/core/errors";
import type { ProviderAdapter } from "@/core/types";
import { DodoAdapter } from "./adapter";

const API_KEY = "dodo_test_sk_SECRET_123";

// Mocked SDK surface. The real error classes are kept so instanceof checks behave as in production.
const sdk = vi.hoisted(() => ({
  ctorArgs: [] as unknown[],
  list: vi.fn(),
  retrieve: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("dodopayments", async (importOriginal) => {
  const real = await importOriginal<typeof import("dodopayments")>();
  class FakeDodo {
    products = { list: sdk.list, retrieve: sdk.retrieve };
    checkoutSessions = { preview: sdk.preview };
    constructor(opts: unknown) {
      sdk.ctorArgs.push(opts);
    }
  }
  return { ...real, default: FakeDodo, DodoPayments: FakeDodo };
});

async function* pages<T>(items: T[]) {
  yield* items;
}

function adapter() {
  return new DodoAdapter({ apiKey: API_KEY, environment: "test_mode" });
}

const listedOneTime = {
  product_id: "pdt_one",
  business_id: "bus_1",
  name: "Lifetime licence",
  description: "  Pay once, use forever.  ",
  is_recurring: false,
  price: 4900,
  currency: "USD",
  price_detail: { type: "one_time_price", price: 4900, currency: "USD", discount: 0, purchasing_power_parity: false },
  entitlements: [{ id: "ent_1", name: "Key", integration_type: "license_key", integration_config: {} }],
  metadata: {},
  tax_category: "saas",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
} as unknown as ProductListResponse;

const fullSubscription = {
  product_id: "pdt_sub",
  business_id: "bus_1",
  brand_id: "brd_1",
  name: "Pro",
  description: null,
  is_recurring: true,
  license_key_enabled: false,
  price: {
    type: "recurring_price",
    price: 500,
    currency: "USD",
    payment_frequency_count: 1,
    payment_frequency_interval: "Month",
    subscription_period_count: 20,
    subscription_period_interval: "Year",
  },
  entitlements: [],
  credit_entitlements: [{ id: "cem_1", credit_entitlement_id: "cre_1", credits_amount: "100" }],
  metadata: {},
  tax_category: "saas",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
} as unknown as DodoProduct;

function preview(overrides: Partial<CheckoutSessionPreviewResponse> = {}): CheckoutSessionPreviewResponse {
  return {
    billing_country: "DE",
    currency: "EUR",
    current_breakup: { subtotal: 4362, discount: 0, tax: 829, total_amount: 5191 },
    is_byop: false,
    payment_method_required: true,
    product_cart: [
      {
        product_id: "pdt_one",
        quantity: 1,
        tax_rate: 1900,
        tax: 829,
        tax_inclusive: false,
        is_subscription: false,
        is_usage_based: false,
        currency: "EUR",
        og_currency: "USD",
        og_price: 4362,
        discounted_price: 4362,
        tax_category: "saas",
        credit_entitlements: [],
        meters: [],
      },
    ],
    total_price: 5191,
    total_tax: 829,
    recurring_breakup: null,
    ...overrides,
  };
}

beforeEach(() => {
  sdk.ctorArgs.length = 0;
  sdk.list.mockReset();
  sdk.retrieve.mockReset();
  sdk.preview.mockReset();
});

describe("DodoAdapter construction", () => {
  it("passes key and environment explicitly so the SDK never reads env vars", () => {
    adapter();
    expect(sdk.ctorArgs[0]).toEqual({
      bearerToken: API_KEY,
      environment: "test_mode",
      baseURL: null,
      webhookKey: null,
      timeout: 12_000,
      maxRetries: 1,
      fetch: expect.any(Function),
    });
  });

  it("refuses an empty key", () => {
    expect(() => new DodoAdapter({ apiKey: "", environment: "test_mode" })).toThrow(/API key/);
  });
});

describe("listProducts / getProduct", () => {
  it("maps a one-time product from the list endpoint", async () => {
    sdk.list.mockReturnValue(pages([listedOneTime]));
    const [p] = await adapter().listProducts();
    expect(p).toEqual({
      id: "pdt_one",
      name: "Lifetime licence",
      description: "Pay once, use forever.",
      price: 4900,
      currency: "USD",
      kind: "one_time",
      billing: null,
      usageBased: false,
      payWhatYouWant: false,
      licenseKeys: true,
      credits: null, // the list endpoint does not expose credits
      entitlementTypes: ["license_key"],
    });
  });

  it("maps a subscription with billing interval and credits from the detail endpoint", async () => {
    sdk.retrieve.mockResolvedValue(fullSubscription);
    const p = await adapter().getProduct("pdt_sub");
    expect(sdk.retrieve).toHaveBeenCalledWith("pdt_sub", {});
    expect(p).toMatchObject({
      id: "pdt_sub",
      kind: "subscription",
      price: 500,
      currency: "USD",
      billing: { interval: "month", count: 1 },
      licenseKeys: false,
      credits: true,
    });
  });

  it("caps long merchant text", async () => {
    sdk.list.mockReturnValue(pages([{ ...listedOneTime, name: "x".repeat(500) }]));
    const [p] = await adapter().listProducts();
    expect(Array.from(p!.name!)).toHaveLength(200);
  });
});

describe("quote", () => {
  it("quotes a one-time product and sends country, state and zip", async () => {
    sdk.preview.mockResolvedValue(preview());
    const q = await adapter().quote({
      items: [{ productId: "pdt_one", quantity: 1 }],
      country: "us",
      state: "CA",
      zip: "94102",
    });
    expect(sdk.preview).toHaveBeenCalledWith({
      product_cart: [{ product_id: "pdt_one", quantity: 1 }],
      billing_address: { country: "US", state: "CA", zipcode: "94102" },
    }, {});
    expect(q).toEqual({
      currency: "EUR",
      subtotal: 4362,
      discount: 0,
      tax: 829,
      total: 5191,
      items: [
        { productId: "pdt_one", quantity: 1, taxRateBps: 1900, tax: 829, taxInclusive: false, subscription: false },
      ],
      recurring: null,
      isBinding: true,
    });
  });

  it("omits state and zip when not given", async () => {
    sdk.preview.mockResolvedValue(preview());
    await adapter().quote({ items: [{ productId: "pdt_one", quantity: 1 }], country: "DE" });
    expect(sdk.preview.mock.calls[0]![0].billing_address).toEqual({ country: "DE" });
  });

  it("maps the recurring breakup for a subscription", async () => {
    sdk.preview.mockResolvedValue(
      preview({
        current_breakup: { subtotal: 445, discount: 0, tax: 85, total_amount: 530 },
        recurring_breakup: { subtotal: 445, discount: 0, tax: 85, total_amount: 530 },
      }),
    );
    const q = await adapter().quote({ items: [{ productId: "pdt_sub", quantity: 1 }], country: "DE" });
    expect(q.recurring).toEqual({ subtotal: 445, discount: 0, tax: 85, total: 530 });
  });

  it("passes discount codes and maps the discount", async () => {
    sdk.preview.mockResolvedValue(
      preview({ current_breakup: { subtotal: 4362, discount: 436, tax: 746, total_amount: 4672 } }),
    );
    const q = await adapter().quote({
      items: [{ productId: "pdt_one", quantity: 1 }],
      country: "DE",
      discountCodes: ["LAUNCH10"],
    });
    expect(sdk.preview.mock.calls[0]![0].discount_codes).toEqual(["LAUNCH10"]);
    expect(q).toMatchObject({ subtotal: 4362, discount: 436, tax: 746, total: 4672 });
  });

  it("marks a BYOP quote as non-binding", async () => {
    sdk.preview.mockResolvedValue(preview({ is_byop: true }));
    const q = await adapter().quote({ items: [{ productId: "pdt_one", quantity: 1 }], country: "DE" });
    expect(q.isBinding).toBe(false);
  });

  it("treats a missing tax figure as zero", async () => {
    sdk.preview.mockResolvedValue(
      preview({ current_breakup: { subtotal: 1000, discount: 0, tax: null, total_amount: 1000 } }),
    );
    const q = await adapter().quote({ items: [{ productId: "pdt_one", quantity: 1 }], country: "AE" });
    expect(q.tax).toBe(0);
  });
});

describe("errors", () => {
  it("wraps an SDK API error as PROVIDER_ERROR with status and Dodo's message", async () => {
    sdk.preview.mockRejectedValue(
      APIError.generate(422, { message: "Product pdt_x not found" }, undefined, new Headers()),
    );
    const err = await adapter()
      .quote({ items: [{ productId: "pdt_x", quantity: 1 }], country: "DE" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({
      code: "PROVIDER_ERROR",
      status: 422,
      providerMessage: "Product pdt_x not found",
    });
  });

  it("never leaks the API key, even if the provider echoes it", async () => {
    sdk.retrieve.mockRejectedValue(
      APIError.generate(401, { message: `Invalid key ${API_KEY}` }, undefined, new Headers()),
    );
    const err = (await adapter().getProduct("pdt_one").catch((e: unknown) => e)) as ProviderError;
    expect(err.status).toBe(401);
    expect(JSON.stringify({ ...err, message: err.message, stack: err.stack })).not.toContain(API_KEY);
    expect(err.message).toContain("[redacted]");
  });

  it("reports an SDK timeout as PROVIDER_ERROR without a status", async () => {
    sdk.retrieve.mockRejectedValue(new APIConnectionTimeoutError());
    const err = await adapter().getProduct("pdt_one").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ code: "PROVIDER_ERROR", status: undefined });
    expect((err as ProviderError).message).toMatch(/timed out/i);
  });

  it("wraps network errors without a status", async () => {
    sdk.list.mockImplementation(() => {
      throw new Error("fetch failed");
    });
    const err = (await adapter().listProducts().catch((e: unknown) => e)) as ProviderError;
    expect(err).toMatchObject({ code: "PROVIDER_ERROR", status: undefined, providerMessage: "fetch failed" });
  });

  it("throws a clear not-implemented error for unbuilt methods", async () => {
    const a: ProviderAdapter = adapter();
    expect(() => a.paymentIdentity()).toThrow(NotImplementedError);
    expect(() => a.paymentIdentity()).toThrow("DodoAdapter.paymentIdentity is not implemented yet");
  });
});
