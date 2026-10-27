// Test-mode merchants on the MCP tools: hidden unless the deployment includes them (deps.includeTestMerchants),
// and marked with fixed [TEST] strings when included. A hidden merchant gets exactly an unknown one's answer.
import type { CallToolResult } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MARKER, TEST_NOTE } from "@/core/visibility";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import type { ToolEnv } from "./tool";
import { checkoutTool } from "./tools/checkout";
import { getOrderTool } from "./tools/get-order";
import { getProductTool } from "./tools/get-product";
import { getQuoteTool } from "./tools/get-quote";
import { searchProductsTool } from "./tools/search-products";

let t: ReturnType<typeof setup>;
let testMerchantId: string;
let testProductId: string;
let liveMerchantId: string;
let liveProductId: string;

const text = (r: CallToolResult) => (r.content[0] as { type: "text"; text: string }).text;
const data = (r: CallToolResult) => r.structuredContent as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const envWith = (includeTestMerchants: boolean): ToolEnv => ({ deps: { ...t.deps, appUrl: "http://localhost:3000", includeTestMerchants } });

beforeEach(() => {
  t = setup();
  testMerchantId = seedMerchant(t.db, { slug: "tester", name: "Tester", email: "t@x.test", dodoEnvironment: "test_mode", liveModeEnabled: false }).id;
  testProductId = seedProduct(t.db, testMerchantId, { name: "Tester Pro" }).id;
  liveMerchantId = seedMerchant(t.db, { slug: "liveco", name: "LiveCo", email: "l@x.test" }).id;
  liveProductId = seedProduct(t.db, liveMerchantId, { name: "LiveCo Pro" }).id;
  t.adapter.quote.mockResolvedValue({
    currency: "EUR", subtotal: 4366, discount: 0, tax: 830, total: 5195,
    items: [{ productId: "p", quantity: 1, taxRateBps: 1900, tax: 830, taxInclusive: false, subscription: false }],
    recurring: null, isBinding: true,
  });
});

const quoteArgs = (merchant_id: string, product_id: string) => ({ merchant_id, product_id, buyer_country: "DE" });

describe("flag off (the default)", () => {
  it("search_products lists only live merchants, including when asked for the test merchant by slug", async () => {
    const all = await searchProductsTool.handler({ query: "" }, envWith(false));
    expect(data(all).products.map((p: { merchant_slug: string }) => p.merchant_slug)).toEqual(["liveco"]);
    const byName = await searchProductsTool.handler({ query: "", merchant: "tester" }, envWith(false));
    const unknown = await searchProductsTool.handler({ query: "", merchant: "no-such" }, envWith(false));
    expect(data(byName)).toEqual(data(unknown));
    expect(text(byName)).toBe(text(unknown));
  });

  it("is off when includeTestMerchants is absent too", async () => {
    const r = await searchProductsTool.handler({ query: "" }, { deps: { ...t.deps, appUrl: "x" } });
    expect(data(r).count).toBe(1);
  });

  it("get_product, get_quote and checkout answer for a test merchant exactly as for an unknown merchant", async () => {
    const env = envWith(false);
    const asTest = [
      await getProductTool.handler({ merchant_id: testMerchantId, product_id: testProductId }, env),
      await getQuoteTool.handler(quoteArgs(testMerchantId, testProductId), env),
    ];
    const asUnknown = [
      await getProductTool.handler({ merchant_id: "no-such-merchant", product_id: testProductId }, env),
      await getQuoteTool.handler(quoteArgs("no-such-merchant", testProductId), env),
    ];
    for (const [hidden, unknown] of asTest.map((r, i) => [r, asUnknown[i]!] as const)) {
      expect(hidden.isError).toBe(true);
      expect(data(hidden).error.code).toBe("MERCHANT_NOT_FOUND");
      // Only the id the caller sent differs; nothing says the merchant exists.
      expect(text(hidden).replace(testMerchantId, "X")).toBe(text(unknown).replace("no-such-merchant", "X"));
    }
    expect(t.adapter.quote).not.toHaveBeenCalled();
  });

  it("checkout refuses a quote made while the merchant was visible, once it is hidden", async () => {
    const quote = await getQuoteTool.handler(quoteArgs(testMerchantId, testProductId), envWith(true));
    const r = await checkoutTool.handler({ quote_id: data(quote).quote_id, buyer_email: "b@x.test" }, envWith(false));
    expect(r.isError).toBe(true);
    expect(data(r).error.code).toBe("MERCHANT_NOT_FOUND");
    expect(t.adapter.createCheckout).not.toHaveBeenCalled();
  });

  it("still serves live merchants normally, with no marker", async () => {
    const r = await getQuoteTool.handler(quoteArgs(liveMerchantId, liveProductId), envWith(false));
    expect(data(r)).toMatchObject({ is_test: false, product_name: "LiveCo Pro" });
    expect(text(r)).not.toContain(TEST_MARKER);
    expect(text(r)).not.toContain("TEST CATALOG");
  });
});

describe("flag on", () => {
  it("marks test merchants in search_products names and summary, and leaves live ones alone", async () => {
    const r = await searchProductsTool.handler({ query: "" }, envWith(true));
    const byName = Object.fromEntries(data(r).products.map((p: { merchant_slug: string }) => [p.merchant_slug, p]));
    expect(byName.tester).toMatchObject({ name: `${TEST_MARKER} Tester Pro`, is_test: true });
    expect(byName.liveco).toMatchObject({ name: "LiveCo Pro", is_test: false });
    expect(text(r)).toContain(`${TEST_MARKER} Tester Pro`);
    expect(text(r)).toContain(TEST_NOTE);
    expect(searchProductsTool.outputSchema.safeParse(data(r)).success).toBe(true);
  });

  it("does not add the note when no result is from a test merchant", async () => {
    const r = await searchProductsTool.handler({ query: "LiveCo" }, envWith(true));
    expect(text(r)).not.toContain("TEST CATALOG");
  });

  it("marks get_product, get_quote, checkout and get_order for a test merchant", async () => {
    const env = envWith(true);
    const product = await getProductTool.handler({ merchant_id: testMerchantId, product_id: testProductId }, env);
    expect(data(product)).toMatchObject({ name: `${TEST_MARKER} Tester Pro`, is_test: true });
    expect(text(product)).toContain(TEST_NOTE);

    const quote = await getQuoteTool.handler(quoteArgs(testMerchantId, testProductId), env);
    expect(data(quote)).toMatchObject({ product_name: `${TEST_MARKER} Tester Pro`, is_test: true });
    expect(text(quote)).toContain(`${TEST_MARKER} Tester Pro`);
    expect(text(quote)).toContain(TEST_NOTE);
    expect(getQuoteTool.outputSchema.safeParse(data(quote)).success).toBe(true);

    const checkout = await checkoutTool.handler({ quote_id: data(quote).quote_id, buyer_email: "b@x.test" }, env);
    expect(checkout.isError).toBeUndefined();
    expect(data(checkout)).toMatchObject({ product_name: `${TEST_MARKER} Tester Pro`, is_test: true });
    expect(text(checkout)).toContain(`${TEST_MARKER} Tester Pro`);
    expect(text(checkout)).toContain(TEST_NOTE);
    expect(checkoutTool.outputSchema.safeParse(data(checkout)).success).toBe(true);

    const order = await getOrderTool.handler({ order_id: data(checkout).order_id }, env);
    expect(data(order)).toMatchObject({ product_name: `${TEST_MARKER} Tester Pro`, is_test: true });
    expect(text(order)).toContain(TEST_NOTE);
  });

  it("uses fixed strings: a merchant cannot fake or remove the marker with its own text", async () => {
    t.db.tables.product.find((p) => p.id === liveProductId)!.name = `${TEST_MARKER} Totally Test`;
    const r = await searchProductsTool.handler({ query: "Totally" }, envWith(true));
    expect(data(r).products[0]).toMatchObject({ is_test: false });
    expect(text(r)).not.toContain("TEST CATALOG");
  });
});
