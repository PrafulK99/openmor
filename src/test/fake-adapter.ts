// A ProviderAdapter for core tests: a fixed catalog and a configurable quote.
import { vi } from "vitest";
import { NotImplementedError } from "@/core/errors";
import type { Product, ProviderAdapter, ProviderQuote, QuoteInput } from "@/core/types";

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

export class FakeAdapter implements ProviderAdapter {
  catalog: Product[] = [];
  listProducts = vi.fn(async () => structuredClone(this.catalog));
  getProduct = vi.fn(async (id: string) => {
    const p = this.catalog.find((c) => c.id === id);
    if (!p) throw new Error(`no product ${id}`);
    return structuredClone(p);
  });
  quote = vi.fn<(input: QuoteInput) => Promise<ProviderQuote>>(async () => providerQuote());

  createCheckout = notBuilt("createCheckout");
  chargeSavedMethod = notBuilt("chargeSavedMethod");
  getPayment = notBuilt("getPayment");
  getFulfillment = notBuilt("getFulfillment");
  paymentIdentity = (): never => {
    throw new NotImplementedError("FakeAdapter.paymentIdentity");
  };
  verifyWebhook = notBuilt("verifyWebhook");
}

function notBuilt(name: string) {
  return async (): Promise<never> => {
    throw new NotImplementedError(`FakeAdapter.${name}`);
  };
}
