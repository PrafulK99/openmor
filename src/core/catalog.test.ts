import { beforeEach, describe, expect, it } from "vitest";
import { setAgentSellable, syncCatalog } from "@/core/catalog";
import { product } from "@/test/fake-adapter";
import { seedMerchant, setup } from "@/test/core-fixtures";

let t: ReturnType<typeof setup>;
let merchantId: string;

beforeEach(() => {
  t = setup();
  merchantId = seedMerchant(t.db).id;
});

describe("syncCatalog", () => {
  it("creates new products as not agent-sellable", async () => {
    t.adapter.catalog = [
      product({ id: "pdt_a", name: "Lifetime", price: 4900 }),
      product({ id: "pdt_b", name: "Pro", price: 500, kind: "subscription", billing: { interval: "month", count: 1 } }),
    ];
    const r = await syncCatalog(t.deps, merchantId);
    expect(r).toMatchObject({ created: 2, updated: 0, deactivated: 0, skipped: [] });
    expect(r.products.every((p) => p.agentSellable === false && p.active)).toBe(true);
    expect(r.products.find((p) => p.providerProductId === "pdt_b")!.isRecurring).toBe(true);
  });

  it("marks a product that disappeared at the provider inactive and keeps it", async () => {
    t.adapter.catalog = [product({ id: "pdt_a" }), product({ id: "pdt_b" })];
    await syncCatalog(t.deps, merchantId);

    t.adapter.catalog = [product({ id: "pdt_a" })];
    const r = await syncCatalog(t.deps, merchantId);

    expect(r).toMatchObject({ created: 0, updated: 1, deactivated: 1 });
    expect(t.db.tables.product).toHaveLength(2);
    const gone = t.db.tables.product.find((p) => p.providerProductId === "pdt_b")!;
    expect(gone.active).toBe(false);
  });

  it("reactivates a product that comes back, without changing agentSellable", async () => {
    t.adapter.catalog = [product({ id: "pdt_a" })];
    await syncCatalog(t.deps, merchantId);
    await setAgentSellable(t.deps, merchantId, "all", true);
    t.adapter.catalog = [];
    await syncCatalog(t.deps, merchantId);
    t.adapter.catalog = [product({ id: "pdt_a", price: 5900 })];
    await syncCatalog(t.deps, merchantId);

    const row = t.db.tables.product[0]!;
    expect(row).toMatchObject({ active: true, agentSellable: true, priceAmount: 5900 });
  });

  it("applies text length limits", async () => {
    t.adapter.catalog = [product({ id: "pdt_a", name: "n".repeat(300), description: "d".repeat(5000) })];
    const { products } = await syncCatalog(t.deps, merchantId);
    expect(Array.from(products[0]!.name)).toHaveLength(200);
    expect(Array.from(products[0]!.description!)).toHaveLength(2000);
  });

  it("skips new products without a price, and deactivates known ones that lost it", async () => {
    t.adapter.catalog = [product({ id: "pdt_a" })];
    await syncCatalog(t.deps, merchantId);
    t.adapter.catalog = [product({ id: "pdt_a", price: null }), product({ id: "pdt_new", price: null })];
    const r = await syncCatalog(t.deps, merchantId);
    expect(r.skipped).toEqual(["pdt_new"]);
    expect(r.deactivated).toBe(1);
  });

  it("does not deactivate anything when the provider call fails", async () => {
    t.adapter.catalog = [product({ id: "pdt_a" })];
    await syncCatalog(t.deps, merchantId);
    t.adapter.listProducts.mockRejectedValueOnce(new Error("boom"));
    await expect(syncCatalog(t.deps, merchantId)).rejects.toThrow("boom");
    expect(t.db.tables.product[0]!.active).toBe(true);
  });

  it("throws MERCHANT_NOT_FOUND for an unknown merchant", async () => {
    await expect(syncCatalog(t.deps, "missing")).rejects.toMatchObject({ code: "MERCHANT_NOT_FOUND" });
  });
});

describe("setAgentSellable", () => {
  it("updates selected ids only, and never another merchant's products", async () => {
    t.adapter.catalog = [product({ id: "pdt_a" }), product({ id: "pdt_b" })];
    const { products } = await syncCatalog(t.deps, merchantId);
    const other = seedMerchant(t.db, { slug: "other", email: "o@x.test" });
    const otherProduct = t.db.insert("product", {
      merchantId: other.id,
      providerProductId: "pdt_z",
      name: "Z",
      priceAmount: 1,
      currency: "USD",
    }) as { id: string };

    const count = await setAgentSellable(t.deps, merchantId, [products[0]!.id, otherProduct.id], true);
    expect(count).toBe(1);
    expect(t.db.tables.product.filter((p) => p.agentSellable).map((p) => p.id)).toEqual([products[0]!.id]);
  });

  it("updates all products with 'all'", async () => {
    t.adapter.catalog = [product({ id: "pdt_a" }), product({ id: "pdt_b" })];
    await syncCatalog(t.deps, merchantId);
    expect(await setAgentSellable(t.deps, merchantId, "all", true)).toBe(2);
  });
});
