import { beforeEach, describe, expect, it } from "vitest";
import { SEARCH_LIMIT, searchProducts } from "@/core/search";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";

let t: ReturnType<typeof setup>;
let merchantId: string;

beforeEach(() => {
  t = setup();
  merchantId = seedMerchant(t.db).id;
});

describe("searchProducts", () => {
  it("returns sellable products with merchant id, slug and name", async () => {
    const p = seedProduct(t.db, merchantId);
    const results = await searchProducts(t.deps, { query: "sharethings" });
    expect(results).toEqual([
      {
        productId: p.id,
        merchantId,
        merchantSlug: "sharethings",
        merchantName: "ShareThings",
        name: "ShareThings Lifetime",
        description: "Pay once, share forever.",
        price: 4900,
        currency: "USD",
        billingType: "one_time",
      },
    ]);
  });

  it("hides merchants that have not opted in to the network", async () => {
    const hidden = seedMerchant(t.db, { slug: "hidden", email: "h@x.test", networkOptIn: false });
    seedProduct(t.db, hidden.id, { name: "ShareThings Clone" });
    seedProduct(t.db, merchantId);
    const results = await searchProducts(t.deps, { query: "sharethings" });
    expect(results.map((r) => r.merchantSlug)).toEqual(["sharethings"]);
  });

  it("hides products that are not agent-sellable or not active", async () => {
    seedProduct(t.db, merchantId, { name: "ShareThings Draft", agentSellable: false });
    seedProduct(t.db, merchantId, { name: "ShareThings Old", active: false });
    expect(await searchProducts(t.deps, { query: "sharethings" })).toEqual([]);
  });

  it("matches case-insensitively and ranks name matches above description matches", async () => {
    seedProduct(t.db, merchantId, { name: "Storage add-on", description: "Extra space for SHARETHINGS" });
    seedProduct(t.db, merchantId, { name: "Zebra ShareThings plan", description: null });
    seedProduct(t.db, merchantId, { name: "Unrelated", description: "nothing here" });
    const names = (await searchProducts(t.deps, { query: "ShArEtHiNgS" })).map((r) => r.name);
    expect(names).toEqual(["Zebra ShareThings plan", "Storage add-on"]);
  });

  it("filters by billing type, max price and merchant slug", async () => {
    seedProduct(t.db, merchantId, { name: "ShareThings Pro", isRecurring: true, priceAmount: 500 });
    seedProduct(t.db, merchantId, { name: "ShareThings Lifetime", priceAmount: 4900 });
    seedProduct(t.db, merchantId, { name: "ShareThings EU", priceAmount: 100, currency: "EUR" });
    const other = seedMerchant(t.db, { slug: "other", email: "o@x.test" });
    seedProduct(t.db, other.id, { name: "ShareThings Elsewhere", priceAmount: 100 });

    const subs = await searchProducts(t.deps, { query: "sharethings", billingType: "subscription" });
    expect(subs.map((r) => r.name)).toEqual(["ShareThings Pro"]);

    const cheapUsd = await searchProducts(t.deps, {
      query: "sharethings",
      maxPrice: { amount: 1000, currency: "usd" },
      merchantSlug: "sharethings",
    });
    expect(cheapUsd.map((r) => r.name)).toEqual(["ShareThings Pro"]);
  });

  it("limits results to 20", async () => {
    for (let i = 0; i < 25; i++) seedProduct(t.db, merchantId, { name: `ShareThings ${String(i).padStart(2, "0")}` });
    expect(await searchProducts(t.deps, { query: "sharethings" })).toHaveLength(SEARCH_LIMIT);
  });
});
