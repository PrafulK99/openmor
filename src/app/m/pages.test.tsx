// The public pages, end to end through the real chain: page -> cached reads -> core -> database
// (an in-memory one). Only the Next.js cache directives and the base URL are stubbed.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLACEHOLDER, staticMerchantParams, staticProductParams } from "@/app/public-data";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import MerchantPage, { generateMetadata as merchantMetadata, generateStaticParams as merchantParams } from "./[merchantSlug]/page";
import ProductPage, { generateMetadata as productMetadata, generateStaticParams as productParams } from "./[merchantSlug]/[productId]/page";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("@/lib/public-url", () => ({ publicBaseUrl: () => "https://openmor.example.com" }));

let t: ReturnType<typeof setup>;
let merchantId: string;
let liveId: string;

const merchantParam = (merchantSlug: string) => ({ params: Promise.resolve({ merchantSlug }) }) as never;
const productParam = (merchantSlug: string, productId: string) => ({ params: Promise.resolve({ merchantSlug, productId }) }) as never;
const html = async (element: Promise<unknown>) => renderToStaticMarkup((await element) as never);
const is404 = (e: unknown) => (e as { digest?: string }).digest?.includes("404") === true;

async function expect404(render: () => Promise<unknown>) {
  const err = await render().then(
    () => null,
    (e: unknown) => e,
  );
  expect(is404(err), `expected a 404, got ${String(err)}`).toBe(true);
}

beforeEach(() => {
  t = setup();
  state.db = t.db.asPrisma();
  merchantId = seedMerchant(t.db, { slug: "sharethings", name: "ShareThings" }).id;
  liveId = seedProduct(t.db, merchantId, { name: "ShareThings Lifetime", description: "Pay once, share forever.", priceAmount: 4900 }).id;
});

describe("merchant page", () => {
  it("renders the merchant, its sellable products with short descriptions, and the price note", async () => {
    seedProduct(t.db, merchantId, { name: "Storage Credits", description: "Extra storage.", priceAmount: 900 });
    const out = await html(MerchantPage(merchantParam("sharethings")));
    expect(out).toContain("<h1>ShareThings</h1>");
    expect(out).toContain("ShareThings Lifetime");
    expect(out).toContain("Pay once, share forever.");
    expect(out).toContain("Storage Credits");
    expect(out).toContain(`href="/m/sharethings/${liveId}"`);
    expect(out).toContain("The final price depends on the buyer&#x27;s country");
    expect(out).toContain("get_quote");
    expect(out).toContain("https://openmor.example.com/api/mcp");
  });

  it("shows no prices, tax-inclusive or otherwise, on the list", async () => {
    const out = await html(MerchantPage(merchantParam("sharethings")));
    expect(out).not.toMatch(/\$|€|49\.00|incl(uding|usive)? (tax|vat)/i);
  });

  it("never renders products that are not sellable", async () => {
    seedProduct(t.db, merchantId, { name: "Hidden By Merchant", agentSellable: false });
    seedProduct(t.db, merchantId, { name: "Retired Product", active: false });
    const out = await html(MerchantPage(merchantParam("sharethings")));
    expect(out).toContain("ShareThings Lifetime");
    expect(out).not.toMatch(/Hidden By Merchant|Retired Product/);
  });

  it("returns 404 for an opted-out merchant, an unknown slug and a malformed slug alike", async () => {
    seedMerchant(t.db, { slug: "hidden-co", name: "Hidden Co", email: "h@x.test", networkOptIn: false });
    for (const slug of ["hidden-co", "no-such-merchant", "NOT_A_SLUG", PLACEHOLDER, "../x", ""]) {
      await expect404(() => MerchantPage(merchantParam(slug)));
    }
  });

  it("does not touch the database for a malformed slug", async () => {
    const spy = vi.spyOn(t.db.merchant, "findFirst");
    await expect404(() => MerchantPage(merchantParam("NOT_A_SLUG")));
    expect(spy).not.toHaveBeenCalled();
  });

  it("escapes hostile merchant text and puts none of it in a link or attribute", async () => {
    t.db.tables.merchant[0]!.name = "<img src=x onerror=alert(1)>Acme";
    seedProduct(t.db, merchantId, { name: '"><script>alert(1)</script>', description: "<b>bold</b> [x](https://evil.example) javascript:alert(1)" });
    const out = await html(MerchantPage(merchantParam("sharethings")));
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;Acme");
    // The only hrefs are ours.
    const hrefs = [...out.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
    for (const h of hrefs) expect(h.startsWith("/m/")).toBe(true);
  });

  it("answers metadata generically for a missing merchant, with no hint", async () => {
    seedMerchant(t.db, { slug: "hidden-co", name: "Hidden Co", email: "h@x.test", networkOptIn: false });
    for (const slug of ["hidden-co", "no-such-merchant"]) {
      expect(await merchantMetadata(merchantParam(slug))).toEqual({ title: "Not found" });
    }
    const ok = await merchantMetadata(merchantParam("sharethings"));
    expect(ok.title).toBe("ShareThings on OpenMoR");
    expect(ok.alternates).toMatchObject({ canonical: "https://openmor.example.com/m/sharethings", types: { "text/plain": "https://openmor.example.com/m/sharethings/llms.txt" } });
  });
});

describe("product page", () => {
  it("renders the product with its list price, currency and the tax note", async () => {
    const out = await html(ProductPage(productParam("sharethings", liveId)));
    expect(out).toContain("<h1>ShareThings Lifetime</h1>");
    expect(out).toContain("$49.00 USD");
    expect(out).toContain("before tax");
    expect(out).toContain("Tax is added for the buyer&#x27;s country");
    expect(out).toContain("Only a quote is binding");
    expect(out).toContain(`<code>${liveId}</code>`);
    expect(out).not.toMatch(/incl(uding|usive)? (tax|vat)/i);
  });

  it("includes schema.org Product and Offer JSON-LD that parses and says tax is not included", async () => {
    const out = await html(ProductPage(productParam("sharethings", liveId)));
    const raw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(out)?.[1];
    expect(raw).toBeTruthy();
    expect(raw).not.toMatch(/[<>]/);
    const ld = JSON.parse(raw!);
    expect(ld).toMatchObject({ "@type": "Product", name: "ShareThings Lifetime", sku: liveId });
    expect(ld.offers).toMatchObject({ "@type": "Offer", price: "49.00", priceCurrency: "USD", priceSpecification: { valueAddedTaxIncluded: false } });
  });

  it("keeps a hostile description from breaking out of the JSON-LD script", async () => {
    const id = seedProduct(t.db, merchantId, { name: "Evil", description: "</script><script>alert(1)</script>" }).id;
    const out = await html(ProductPage(productParam("sharethings", id)));
    expect(out.match(/<script/g)).toHaveLength(1);
    expect(out).not.toContain("<script>alert");
  });

  it("returns 404 for products that are not sellable, however they are not", async () => {
    const hidden = seedProduct(t.db, merchantId, { name: "Hidden", agentSellable: false }).id;
    const retired = seedProduct(t.db, merchantId, { name: "Retired", active: false }).id;
    await expect404(() => ProductPage(productParam("sharethings", hidden)));
    await expect404(() => ProductPage(productParam("sharethings", retired)));
  });

  it("returns 404 for a product of an opted-out merchant, and for another merchant's product under this slug", async () => {
    const hiddenMerchant = seedMerchant(t.db, { slug: "hidden-co", name: "Hidden Co", email: "h@x.test", networkOptIn: false }).id;
    const hiddenProduct = seedProduct(t.db, hiddenMerchant, { name: "Hidden Co Product" }).id;
    const otherMerchant = seedMerchant(t.db, { slug: "acme", name: "Acme", email: "a@x.test" }).id;
    const otherProduct = seedProduct(t.db, otherMerchant, { name: "Acme Product" }).id;
    await expect404(() => ProductPage(productParam("hidden-co", hiddenProduct)));
    await expect404(() => ProductPage(productParam("sharethings", hiddenProduct)));
    await expect404(() => ProductPage(productParam("sharethings", otherProduct)));
    expect(await html(ProductPage(productParam("acme", otherProduct)))).toContain("Acme Product");
  });

  it("returns 404 for unknown and malformed ids", async () => {
    for (const id of ["nope", "../etc/passwd", "a b", "x".repeat(200), PLACEHOLDER]) {
      await expect404(() => ProductPage(productParam("sharethings", id)));
    }
  });

  it("answers metadata generically for a missing product", async () => {
    expect(await productMetadata(productParam("sharethings", "nope"))).toEqual({ title: "Not found" });
    const ok = await productMetadata(productParam("sharethings", liveId));
    expect(ok.title).toBe("ShareThings Lifetime · ShareThings on OpenMoR");
  });
});

describe("what a rendered page never contains", () => {
  it("has no key, secret, email, internal merchant id or provider id", async () => {
    t.db.tables.merchant[0]!.dodoApiKeyEncrypted = "encrypted-key-ciphertext";
    t.db.tables.merchant[0]!.dodoWebhookSecretEncrypted = "enc-webhook-secret";
    t.db.tables.product[0]!.providerProductId = "pdt_provider_only";
    const out = (await html(MerchantPage(merchantParam("sharethings")))) + (await html(ProductPage(productParam("sharethings", liveId))));
    for (const secret of ["encrypted-key-ciphertext", "enc-webhook-secret", "owner@sharethings.test", "pdt_provider_only", merchantId]) {
      expect(out).not.toContain(secret);
    }
  });
});

describe("static params", () => {
  it("lists opted-in merchants and their sellable products, and no one else", async () => {
    seedProduct(t.db, merchantId, { name: "Hidden", agentSellable: false });
    seedMerchant(t.db, { slug: "hidden-co", email: "h@x.test", networkOptIn: false });
    expect(await merchantParams()).toEqual([{ merchantSlug: "sharethings" }]);
    expect(await productParams()).toEqual([{ merchantSlug: "sharethings", productId: liveId }]);
  });

  it("falls back to the placeholder, never an empty list, when there is nothing to list", async () => {
    t.db.tables.merchant[0]!.networkOptIn = false;
    expect(await staticMerchantParams()).toEqual([{ merchantSlug: PLACEHOLDER }]);
    expect(await staticProductParams()).toEqual([{ merchantSlug: PLACEHOLDER, productId: PLACEHOLDER }]);
  });

  it("falls back to the placeholder when the database cannot be read at build time", async () => {
    vi.spyOn(t.db.merchant, "findMany").mockRejectedValue(new Error("connection refused"));
    expect(await staticMerchantParams()).toEqual([{ merchantSlug: PLACEHOLDER }]);
    expect(await staticProductParams()).toEqual([{ merchantSlug: PLACEHOLDER, productId: PLACEHOLDER }]);
  });

  it("caps how many product pages are prerendered", async () => {
    for (let i = 0; i < 250; i++) seedProduct(t.db, merchantId, { name: `P${i}` });
    expect((await staticProductParams()).length).toBe(200);
  });
});

describe("rendering rules", () => {
  it("requires the complete page before responding (ensureStatic navigation) on both pages", async () => {
    const merchantModule = await import("./[merchantSlug]/page");
    const productModule = await import("./[merchantSlug]/[productId]/page");
    expect(merchantModule.ensureStatic).toBe("navigation");
    expect(productModule.ensureStatic).toBe("navigation");
  });
});
