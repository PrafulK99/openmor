// A ProviderAdapter for core tests: a fixed catalog, a configurable quote, checkout, payments,
// fulfillment, and a webhook "verifier" that accepts only the signature "valid".
import { vi } from "vitest";
import { NotImplementedError, WebhookVerificationError } from "@/core/errors";
import type {
  CheckoutInput,
  CheckoutSession,
  Fulfillment,
  Payment,
  Product,
  ProviderAdapter,
  ProviderQuote,
  QuoteInput,
  SavedMethodChargeInput,
  SavedPaymentMethod,
  WebhookEvent,
  WebhookInput,
} from "@/core/types";

export const FAKE_LICENSE_KEY = "LK-SECRET-1234-ABCD-5678";

export function product(overrides: Partial<Product> & { id: string }): Product {
  return {
    name: `Product ${overrides.id}`,
    description: null,
    price: 1000,
    currency: "USD",
    kind: "one_time",
    billing: null,
    usageBased: false,
    payWhatYouWant: false,
    licenseKeys: null,
    credits: null,
    entitlementTypes: [],
    ...overrides,
  };
}

export function providerQuote(overrides: Partial<ProviderQuote> = {}): ProviderQuote {
  return {
    currency: "EUR",
    subtotal: 801,
    discount: 0,
    tax: 152,
    total: 954,
    items: [{ productId: "pdt_1", quantity: 1, taxRateBps: 1900, tax: 152, taxInclusive: false, subscription: false }],
    recurring: null,
    isBinding: true,
    ...overrides,
  };
}

export function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    paymentId: "pay_1",
    status: "succeeded",
    currency: "EUR",
    total: 956,
    tax: 153,
    checkoutSessionId: "cks_1",
    customerId: "cus_1",
    subscriptionId: null,
    metadata: {},
    ...overrides,
  };
}

/** A webhook request the fake adapter accepts. `event` is what verification "returns". */
export function signedWebhook(event: WebhookEvent, signature = "valid"): WebhookInput {
  return {
    headers: { "webhook-id": event.id, "webhook-timestamp": "1", "webhook-signature": signature },
    rawBody: JSON.stringify(event),
  };
}

export class FakeAdapter implements ProviderAdapter {
  catalog: Product[] = [];
  #sessions = 0;

  listProducts = vi.fn(async () => structuredClone(this.catalog));
  getProduct = vi.fn(async (id: string) => {
    const p = this.catalog.find((c) => c.id === id);
    if (!p) throw new Error(`no product ${id}`);
    return structuredClone(p);
  });
  quote = vi.fn<(input: QuoteInput) => Promise<ProviderQuote>>(async () => providerQuote());
  createCheckout = vi.fn<(input: CheckoutInput) => Promise<CheckoutSession>>(async () => {
    const n = ++this.#sessions;
    return { sessionId: `cks_${n}`, checkoutUrl: `https://test.checkout.dodopayments.com/session/cks_${n}` };
  });
  getPayment = vi.fn<(paymentId: string) => Promise<Payment>>(async (paymentId) => payment({ paymentId }));
  getFulfillment = vi.fn<(paymentId: string) => Promise<Fulfillment>>(async (paymentId) => ({
    paymentId,
    licenseKeys: [{ id: "lic_1", key: FAKE_LICENSE_KEY, status: "active", activationsLimit: 3, expiresAt: null }],
    subscription: null,
    credits: [],
    portalUrl: "https://test.customer.dodopayments.com/session/portal_secret",
  }));
  verifyWebhook = vi.fn<(input: WebhookInput) => Promise<WebhookEvent>>(async ({ headers, rawBody }) => {
    if (headers["webhook-signature"] !== "valid") throw new WebhookVerificationError("invalid signature");
    return JSON.parse(rawBody) as WebhookEvent;
  });

  /** Succeeds by default with the preview total, echoing the metadata like Dodo does. */
  chargeSavedMethod = vi.fn<(input: SavedMethodChargeInput) => Promise<Payment>>(async (input) =>
    payment({ paymentId: "pay_saved_1", status: "succeeded", total: 954, tax: 152, metadata: input.metadata ?? {} }),
  );
  findSavedPaymentMethod = vi.fn<(email: string) => Promise<SavedPaymentMethod | null>>(async () => ({
    customerId: "cus_1",
    paymentMethodId: "pm_1",
  }));
  paymentIdentity = (): never => {
    throw new NotImplementedError("FakeAdapter.paymentIdentity");
  };
}
