import type { CallToolResult } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it } from "vitest";
import { ERROR_CODES, OpenMorError, ProviderError } from "@/core/errors";
import { QUOTE_TTL_MS } from "@/core/quotes";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { providerQuote } from "@/test/fake-adapter";
import { ERROR_HINTS, toolError } from "./results";
import { TOOLS } from "./server";
import type { ToolEnv } from "./tool";
import { getProductTool } from "./tools/get-product";
import { getQuoteTool } from "./tools/get-quote";
import { searchProductsTool } from "./tools/search-products";

let t: ReturnType<typeof setup>;
let env: ToolEnv;
let merchantId: string;
let lifetimeId: string;
let proId: string;
const seen: CallToolResult[] = [];

// Record every result so the leak test at the end can scan all of them.
async function call<T>(p: Promise<T>): Promise<T> {
  const r = await p;
  seen.push(r as CallToolResult);
  return r;
}

const text = (r: CallToolResult) => (r.content[0] as { type: "text"; text: string }).text;
const data = (r: CallToolResult) => r.structuredContent as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  t = setup(new Date("2026-10-21T12:00:00Z"));
  env = { deps: { ...t.deps, appUrl: "http://localhost:3000" } };
  merchantId = seedMerchant(t.db).id;
  lifetimeId = seedProduct(t.db, merchantId, {
    providerProductId: "pdt_life",
    name: "ShareThings Lifetime",
    priceAmount: 4900,
    providerData: { billing: null, licenseKeys: true, credits: false, entitlementTypes: ["license_key"] },
  }).id;
  proId = seedProduct(t.db, merchantId, {
    providerProductId: "pdt_pro",
    name: "ShareThings Pro",
    description: "Monthly plan",
    priceAmount: 500,
    isRecurring: true,
    providerData: { billing: { interval: "month", count: 1 } },
  }).id;
});

describe("search_products", () => {
  it("returns snake_case products with merchant fields and money in minor units and formatted", async () => {
    const r = await call(searchProductsTool.handler({ query: "sharethings" }, env));
    expect(r.isError).toBeUndefined();
    expect(data(r).count).toBe(2);
    expect(data(r).products[0]).toEqual({
      merchant_id: merchantId,
      merchant_slug: "sharethings",
      merchant_name: "ShareThings",
      product_id: lifetimeId,
      name: "ShareThings Lifetime",
      is_test: false,
      description: "Pay once, share forever.",
      list_price: { amount_minor: 4900, currency: "USD", formatted: "$49.00" },
      billing_type: "one_time",
    });
    expect(text(r)).toBe(
      'Found 2 products for "sharethings": ShareThings Lifetime ($49.00); ShareThings Pro ($5.00, subscription). List prices exclude tax; call get_quote for the buyer\'s price.',
    );
    expect(searchProductsTool.outputSchema.safeParse(data(r)).success).toBe(true);
  });

  it("applies filters", async () => {
    const r = await call(
      searchProductsTool.handler(
        { query: "sharethings", billing_type: "subscription", max_price: { amount: 1000, currency: "usd" }, merchant: "sharethings" },
        env,
      ),
    );
    expect(data(r).products.map((p: { name: string }) => p.name)).toEqual(["ShareThings Pro"]);
  });

  it("explains an empty result", async () => {
    const r = await call(searchProductsTool.handler({ query: "nothing-like-this" }, env));
    expect(data(r)).toMatchObject({ count: 0, products: [] });
    expect(text(r)).toMatch(/^No products found for "nothing-like-this"\./);
  });

  it("rejects a bad max_price with INVALID_INPUT and a fix hint", async () => {
    const r = await call(searchProductsTool.handler({ query: "x", max_price: { amount: 19.99, currency: "USD" } }, env));
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("INVALID_INPUT: max_price.amount must be a whole number of minor units, e.g. 2000 for $20.00.");
    const r2 = await call(searchProductsTool.handler({ query: "x", max_price: { amount: 100, currency: "dollars" } }, env));
    expect(text(r2)).toBe("INVALID_INPUT: max_price.currency must be a 3-letter code like USD.");
  });
});

describe("get_product", () => {
  it("returns full details", async () => {
    const r = await call(getProductTool.handler({ merchant_id: merchantId, product_id: proId }, env));
    expect(data(r)).toMatchObject({
      product_id: proId,
      merchant_slug: "sharethings",
      list_price: { amount_minor: 500, currency: "USD", formatted: "$5.00" },
      billing_type: "subscription",
      billing_interval: { interval: "month", count: 1 },
      fulfillment: { license_keys: null, credits: null, entitlement_types: [] },
    });
    expect(text(r)).toBe(
      "ShareThings Pro from ShareThings: list price $5.00 every month, before tax. Call get_quote with the buyer's country for the price they pay.",
    );
    expect(getProductTool.outputSchema.safeParse(data(r)).success).toBe(true);
  });

  it("returns MERCHANT_NOT_FOUND and PRODUCT_UNAVAILABLE with hints", async () => {
    const r = await call(getProductTool.handler({ merchant_id: "nope", product_id: proId }, env));
    expect(text(r)).toBe('MERCHANT_NOT_FOUND: No merchant "nope" in the network. Use a merchant_id exactly as returned by search_products.');
    expect(data(r).error.code).toBe("MERCHANT_NOT_FOUND");

    const draft = seedProduct(t.db, merchantId, { agentSellable: false });
    const r2 = await call(getProductTool.handler({ merchant_id: merchantId, product_id: draft.id }, env));
    expect(data(r2).error).toMatchObject({ code: "PRODUCT_UNAVAILABLE", hint: ERROR_HINTS.PRODUCT_UNAVAILABLE });
  });

  it("requires ids", async () => {
    const r = await call(getProductTool.handler({ merchant_id: " ", product_id: proId }, env));
    expect(text(r)).toBe("INVALID_INPUT: merchant_id is required; use the merchant_id from search_products.");
  });
});

describe("get_quote", () => {
  const de = { buyer_country: "de" };

  it("returns the quote with money, tax rate, conversion and expiry, and a one-line summary", async () => {
    const r = await call(getQuoteTool.handler({ merchant_id: merchantId, product_id: lifetimeId, ...de }, { ...env, agentSessionId: "ags_1" }));
    expect(r.isError).toBeUndefined();
    expect(data(r)).toEqual({
      quote_id: expect.any(String),
      merchant_id: merchantId,
      product_id: lifetimeId,
      product_name: "ShareThings Lifetime",
      is_test: false,
      quantity: 1,
      buyer_country: "DE",
      buyer_state: null,
      buyer_zip: null,
      currency: "EUR",
      subtotal: { amount_minor: 801, currency: "EUR", formatted: "€8.01" },
      discount: { amount_minor: 0, currency: "EUR", formatted: "€0.00" },
      tax: { amount_minor: 152, currency: "EUR", formatted: "€1.52" },
      total: { amount_minor: 954, currency: "EUR", formatted: "€9.54" },
      tax_rate_percent: 19,
      is_converted: true,
      list_currency: "USD",
      is_binding: true,
      expires_at: "2026-10-21T12:15:00.000Z",
      expires_in_seconds: QUOTE_TTL_MS / 1000,
      renewal: null,
    });
    expect(text(r)).toBe(
      "ShareThings Lifetime: €9.54 including 19% VAT for Germany. Converted from USD, so the final amount may move slightly at checkout. Quote valid for 15 minutes (until 12:15 UTC).",
    );
    expect(t.db.tables.quote[0]!.agentSessionId).toBe("ags_1");
    expect(getQuoteTool.outputSchema.safeParse(data(r)).success).toBe(true);
  });

  it("computes expires_in_seconds at response time and keeps expires_at in UTC with a Z", async () => {
    // Late evening in India is already the next day there, but expires_at stays a UTC instant.
    const created = new Date("2026-10-21T19:22:00Z"); // 00:52 IST on 22 October
    let calls = 0;
    // First clock read stores the quote; the second builds the response 2 minutes later.
    const now = () => (calls++ === 0 ? created : new Date(created.getTime() + 120_000));
    const r = await call(
      getQuoteTool.handler({ merchant_id: merchantId, product_id: lifetimeId, buyer_country: "IN" }, { deps: { ...t.deps, now, appUrl: "http://localhost:3000" } }),
    );
    expect(data(r).expires_at).toBe("2026-10-21T19:37:00.000Z");
    expect(data(r).expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(data(r).expires_in_seconds).toBe(13 * 60);
    expect(Number.isInteger(data(r).expires_in_seconds)).toBe(true);
    expect(text(r)).toMatch(/Quote valid for 13 minutes \(until 19:37 UTC\)\.$/);
  });

  it("never reports negative time left", async () => {
    let calls = 0;
    const start = new Date("2026-10-21T12:00:00Z");
    const now = () => (calls++ === 0 ? start : new Date(start.getTime() + QUOTE_TTL_MS + 5_000));
    const r = await call(getQuoteTool.handler({ merchant_id: merchantId, product_id: lifetimeId, buyer_country: "DE" }, { deps: { ...t.deps, now, appUrl: "http://localhost:3000" } }));
    expect(data(r).expires_in_seconds).toBe(0);
    expect(text(r)).toMatch(/Quote valid for less than a minute \(until 12:15 UTC\)\.$/);
  });

  it("includes the renewal amount for subscriptions", async () => {
    t.adapter.quote.mockResolvedValueOnce(
      providerQuote({ subtotal: 445, tax: 85, total: 530, recurring: { subtotal: 445, discount: 0, tax: 85, total: 530 } }),
    );
    const r = await call(getQuoteTool.handler({ merchant_id: merchantId, product_id: proId, ...de }, env));
    expect(data(r).renewal).toEqual({
      total: { amount_minor: 530, currency: "EUR", formatted: "€5.30" },
      tax: { amount_minor: 85, currency: "EUR", formatted: "€0.85" },
      interval: "every month",
    });
    expect(text(r)).toContain("Renews at €5.30 every month.");
  });

  it("describes zero tax, same currency and US state", async () => {
    t.adapter.quote.mockResolvedValueOnce(
      providerQuote({ currency: "USD", subtotal: 4900, tax: 0, total: 4900, items: [{ productId: "pdt_life", quantity: 2, taxRateBps: 0, tax: 0, taxInclusive: false, subscription: false }] }),
    );
    const r = await call(
      getQuoteTool.handler({ merchant_id: merchantId, product_id: lifetimeId, quantity: 2, buyer_country: "US", buyer_state: "CA", buyer_zip: "94102" }, env),
    );
    expect(t.adapter.quote).toHaveBeenCalledWith({ items: [{ productId: "pdt_life", quantity: 2 }], country: "US", state: "CA", zip: "94102" });
    expect(text(r)).toBe("2 × ShareThings Lifetime: $49.00, no sales tax for United States (CA). Quote valid for 15 minutes (until 12:15 UTC).");
    expect(data(r)).toMatchObject({ is_converted: false, buyer_state: "CA", buyer_zip: "94102", tax_rate_percent: 0 });
  });

  it("labels a non-binding (BYOP) quote as an estimate", async () => {
    t.adapter.quote.mockResolvedValueOnce(providerQuote({ isBinding: false, tax: 0, total: 801 }));
    const r = await call(getQuoteTool.handler({ merchant_id: merchantId, product_id: lifetimeId, ...de }, env));
    expect(data(r).is_binding).toBe(false);
    expect(text(r)).toMatch(/^ShareThings Lifetime: estimated €8\.01 before tax\. This merchant handles tax itself/);
  });

  it.each([
    [{ buyer_country: "Germany" }, "INVALID_INPUT: buyer_country must be a 2-letter code like DE."],
    [{ buyer_country: "DE", quantity: 0 }, "INVALID_INPUT: quantity must be a whole number from 1 to 100."],
    [{ buyer_country: "DE", quantity: 2.5 }, "INVALID_INPUT: quantity must be a whole number from 1 to 100."],
    [{ buyer_country: "DE", buyer_zip: "9".repeat(40) }, 'INVALID_INPUT: buyer_zip must be at most 32 characters, e.g. "94102".'],
  ])("rejects bad input %j", async (args, expected) => {
    const r = await call(getQuoteTool.handler({ merchant_id: merchantId, product_id: lifetimeId, ...args }, env));
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(expected);
    expect(t.adapter.quote).not.toHaveBeenCalled();
  });

  it("returns PRODUCT_UNAVAILABLE and MERCHANT_NOT_FOUND without calling the provider", async () => {
    const gone = seedProduct(t.db, merchantId, { active: false });
    const r = await call(getQuoteTool.handler({ merchant_id: merchantId, product_id: gone.id, ...de }, env));
    expect(data(r).error.code).toBe("PRODUCT_UNAVAILABLE");
    const hidden = seedMerchant(t.db, { slug: "hidden", email: "h@x.test", networkOptIn: false });
    const hp = seedProduct(t.db, hidden.id);
    const r2 = await call(getQuoteTool.handler({ merchant_id: hidden.id, product_id: hp.id, ...de }, env));
    expect(data(r2).error.code).toBe("MERCHANT_NOT_FOUND");
    expect(t.adapter.quote).not.toHaveBeenCalled();
  });

  it("returns PROVIDER_ERROR with the provider's message and a retry hint", async () => {
    t.adapter.quote.mockRejectedValueOnce(new ProviderError("Dodo Payments", 503, "Service unavailable"));
    const r = await call(getQuoteTool.handler({ merchant_id: merchantId, product_id: lifetimeId, ...de }, env));
    expect(text(r)).toBe(
      "PROVIDER_ERROR: Dodo Payments returned HTTP 503: Service unavailable. The payment provider could not answer; wait a moment and retry once.",
    );
  });

  it("returns INTERNAL_ERROR without internal details for unexpected failures", async () => {
    t.adapter.quote.mockRejectedValueOnce(new Error("connect ECONNREFUSED postgres://admin:hunter2@db.internal:5432"));
    const r = await call(getQuoteTool.handler({ merchant_id: merchantId, product_id: lifetimeId, ...de }, env));
    expect(data(r).error).toMatchObject({ code: "INTERNAL_ERROR", message: "Internal error." });
    expect(JSON.stringify(r)).not.toContain("hunter2");
    expect(JSON.stringify(r)).not.toContain("db.internal");
  });
});

describe("errors and descriptions", () => {
  it("has a one-line hint for every stable error code", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_HINTS[code]).toMatch(/^[^\n]{10,200}$/);
      const r = toolError(new OpenMorError(code, "Something specific"));
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toEqual({ error: { code, message: "Something specific.", hint: ERROR_HINTS[code] } });
      expect(text(r)).not.toContain("\n");
    }
  });

  it("tool descriptions are static agent guidance with no merchant data", () => {
    const merchantText = [...t.db.tables.product.map((p) => p.name as string), "ShareThings"];
    for (const tool of TOOLS) {
      for (const s of merchantText) expect(tool.description).not.toContain(s);
    }
    expect(searchProductsTool.description).toMatch(/Call this FIRST/);
    for (const tool of TOOLS) expect(tool.description).toMatch(/[Nn]ever invent/);
    expect(getQuoteTool.description).toMatch(/in the quote's currency/);
  });
});

describe("secrets", () => {
  it("no tool output ever contains the Dodo API key or its ciphertext", async () => {
    // Exercise every tool on happy and error paths, then scan everything collected in this file.
    await call(searchProductsTool.handler({ query: "" }, env));
    await call(getProductTool.handler({ merchant_id: merchantId, product_id: lifetimeId }, env));
    await call(getQuoteTool.handler({ merchant_id: merchantId, product_id: lifetimeId, buyer_country: "DE" }, env));
    await call(getQuoteTool.handler({ merchant_id: merchantId, product_id: "missing", buyer_country: "DE" }, env));

    const ciphertexts = t.db.tables.merchant.map((m) => m.dodoApiKeyEncrypted as string);
    const blob = JSON.stringify(seen);
    expect(seen.length).toBeGreaterThan(15);
    expect(blob).not.toContain("dodo_test_sk_seed");
    expect(blob).not.toContain("dodoApiKey");
    for (const c of ciphertexts) expect(blob).not.toContain(c);
    // Ciphertext format from src/lib/crypto.ts.
    expect(blob).not.toMatch(/"v1:[A-Za-z0-9+/=]{20,}/);
  });
});
