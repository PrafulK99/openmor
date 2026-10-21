import { beforeEach, describe, expect, it } from "vitest";
import { getProductDetails, loadSellable } from "@/core/products";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";

let t: ReturnType<typeof setup>;
let merchantId: string;

beforeEach(() => {
  t = setup();
  merchantId = seedMerchant(t.db).id;
});

describe("getProductDetails", () => {
  it("returns catalog details plus billing and fulfillment facts from providerData", async () => {
    const p = seedProduct(t.db, merchantId, {
      name: "ShareThings Pro",
      isRecurring: true,
      priceAmount: 500,
      providerData: {
        billing: { interval: "month", count: 1 },
        usageBased: false,
        payWhatYouWant: false,
        licenseKeys: true,
        credits: null,
        entitlementTypes: ["license_key"],
      },
    });
    const d = await getProductDetails(t.deps, { merchantId, productId: p.id });
    expect(d).toEqual({
      productId: p.id,
      merchant: { id: merchantId, slug: "sharethings", name: "ShareThings" },
      name: "ShareThings Pro",
      description: "Pay once, share forever.",
      price: 500,
      currency: "USD",
      billingType: "subscription",
      billing: { interval: "month", count: 1 },
      usageBased: false,
      payWhatYouWant: false,
      licenseKeys: true,
      credits: null,
      entitlementTypes: ["license_key"],
    });
  });

  it("tolerates missing or malformed providerData", async () => {
    const p = seedProduct(t.db, merchantId, { providerData: { billing: "monthly", entitlementTypes: 7 } });
    const d = await getProductDetails(t.deps, { merchantId, productId: p.id });
    expect(d).toMatchObject({ billing: null, entitlementTypes: [], licenseKeys: null });
  });

  it("never returns merchant key fields", async () => {
    const p = seedProduct(t.db, merchantId);
    const d = await getProductDetails(t.deps, { merchantId, productId: p.id });
    expect(JSON.stringify(d)).not.toContain("dodoApiKeyEncrypted");
    expect(JSON.stringify(d)).not.toContain(t.db.tables.merchant[0]!.dodoApiKeyEncrypted as string);
  });
});

describe("loadSellable", () => {
  it("refuses non-sellable, inactive and other merchants' products", async () => {
    const draft = seedProduct(t.db, merchantId, { agentSellable: false });
    const gone = seedProduct(t.db, merchantId, { active: false });
    const other = seedMerchant(t.db, { slug: "o", email: "o@x.test" });
    const foreign = seedProduct(t.db, other.id);
    for (const id of [draft.id, gone.id, foreign.id, "missing"]) {
      await expect(loadSellable(t.deps, merchantId, id)).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
    }
  });

  it("refuses unknown and non-opted-in merchants", async () => {
    const hidden = seedMerchant(t.db, { slug: "h", email: "h@x.test", networkOptIn: false });
    const p = seedProduct(t.db, hidden.id);
    await expect(loadSellable(t.deps, hidden.id, p.id)).rejects.toMatchObject({ code: "MERCHANT_NOT_FOUND" });
    await expect(loadSellable(t.deps, "missing", p.id)).rejects.toMatchObject({ code: "MERCHANT_NOT_FOUND" });
  });
});
