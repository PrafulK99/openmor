// llms.txt, per-merchant llms.txt, sitemap.xml and robots.txt, through the real chain down to an
// in-memory database. Only the Next.js cache directives and the base URL are stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { GET as networkLlms } from "./llms.txt/route";
import { GET as merchantLlms, generateStaticParams as llmsParams } from "./m/[merchantSlug]/llms.txt/route";
import { PLACEHOLDER } from "./public-data";
import robots from "./robots";
import sitemap, { MAX_SITEMAP_URLS } from "./sitemap";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("@/lib/public-url", () => ({ publicBaseUrl: () => "https://openmor.example.com" }));

const BASE = "https://openmor.example.com";
let t: ReturnType<typeof setup>;
let merchantId: string;
let liveId: string;

const ctx = (merchantSlug: string) => ({ params: Promise.resolve({ merchantSlug }) }) as never;
const merchantFile = (slug: string) => merchantLlms(new Request(`${BASE}/m/${slug}/llms.txt`), ctx(slug));

beforeEach(() => {
  t = setup();
  state.db = t.db.asPrisma();
  merchantId = seedMerchant(t.db, { slug: "sharethings", name: "ShareThings" }).id;
  liveId = seedProduct(t.db, merchantId, { name: "ShareThings Lifetime", description: "Pay once, share forever.", priceAmount: 4900 }).id;
});

describe("/llms.txt", () => {
  it("is plain text in llms.txt format, listing opted-in merchants with links and the connector URL", async () => {
    const res = await networkLlms();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    expect(body.startsWith("# OpenMoR\n\n> ")).toBe(true);
    expect(body).toContain(`${BASE}/api/mcp`);
    expect(body).toContain(`- [ShareThings](${BASE}/m/sharethings): 1 product. Summary for agents: ${BASE}/m/sharethings/llms.txt`);
    expect(body).toContain("## Merchants");
    expect(body).toContain(`- [Sitemap](${BASE}/sitemap.xml)`);
  });

  it("leaves out opted-out merchants and does not count unsellable products", async () => {
    seedProduct(t.db, merchantId, { name: "Hidden By Merchant", agentSellable: false });
    const hidden = seedMerchant(t.db, { slug: "hidden-co", name: "Hidden Co", email: "h@x.test", networkOptIn: false }).id;
    seedProduct(t.db, hidden, { name: "Hidden Co Product" });
    const body = await (await networkLlms()).text();
    expect(body).toContain("1 product.");
    expect(body).not.toMatch(/Hidden/);
    expect(body).not.toContain("hidden-co");
  });
});

describe("/m/{slug}/llms.txt", () => {
  it("lists the merchant's sellable products with list prices before tax and how to buy", async () => {
    const res = await merchantFile("sharethings");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("# ShareThings");
    expect(body).toContain(`- [ShareThings Lifetime](${BASE}/m/sharethings/${liveId}): List price $49.00 before tax.`);
    expect(body).toContain('Call search_products with merchant "sharethings"');
    expect(body).toContain("get_quote");
  });

  it("never lists unsellable products", async () => {
    seedProduct(t.db, merchantId, { name: "Hidden By Merchant", agentSellable: false });
    seedProduct(t.db, merchantId, { name: "Retired Product", active: false });
    expect(await (await merchantFile("sharethings")).text()).not.toMatch(/Hidden By Merchant|Retired Product/);
  });

  it("answers an opted-out merchant, an unknown one and a malformed slug with one identical bare 404", async () => {
    seedMerchant(t.db, { slug: "hidden-co", name: "Hidden Co", email: "h@x.test", networkOptIn: false });
    const answers = new Set<string>();
    for (const slug of ["hidden-co", "no-such-merchant", "NOT_A_SLUG", PLACEHOLDER, "../x", ""]) {
      const res = await merchantFile(slug);
      expect(res.status).toBe(404);
      answers.add(`${res.headers.get("content-type")}|${await res.text()}`);
    }
    expect([...answers]).toEqual(["text/plain; charset=utf-8|Not found\n"]);
  });

  it("does not touch the database for a malformed slug", async () => {
    const spy = vi.spyOn(t.db.merchant, "findFirst");
    expect((await merchantFile("NOT_A_SLUG")).status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it("prerenders the opted-in merchants, or the placeholder when there are none", async () => {
    expect(await llmsParams()).toEqual([{ merchantSlug: "sharethings" }]);
    t.db.tables.merchant[0]!.networkOptIn = false;
    expect(await llmsParams()).toEqual([{ merchantSlug: PLACEHOLDER }]);
  });
});

describe("/sitemap.xml", () => {
  it("lists absolute URLs for public merchant and product pages, with last-modified dates", async () => {
    const entries = await sitemap();
    expect(entries.map((e) => e.url)).toEqual([`${BASE}/m/sharethings`, `${BASE}/m/sharethings/${liveId}`]);
    for (const e of entries) expect(Number.isNaN(Date.parse(String(e.lastModified)))).toBe(false);
  });

  it("never lists opted-out merchants or unsellable products", async () => {
    seedProduct(t.db, merchantId, { name: "Hidden", agentSellable: false });
    seedProduct(t.db, merchantId, { name: "Retired", active: false });
    const hidden = seedMerchant(t.db, { slug: "hidden-co", name: "Hidden Co", email: "h@x.test", networkOptIn: false }).id;
    seedProduct(t.db, hidden, { name: "Hidden Co Product" });
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toHaveLength(2);
    expect(urls.join("\n")).not.toContain("hidden-co");
  });

  it("is empty, not broken, when nothing is public, and stays within the protocol's URL limit", async () => {
    t.db.tables.merchant[0]!.networkOptIn = false;
    expect(await sitemap()).toEqual([]);
    expect(MAX_SITEMAP_URLS).toBe(50_000);
  });
});

describe("/robots.txt", () => {
  it("allows the public pages and llms.txt, keeps crawlers off the API and order pages, and points to the sitemap", () => {
    expect(robots()).toEqual({
      rules: [{ userAgent: "*", allow: ["/m/", "/llms.txt"], disallow: ["/api/", "/orders/"] }],
      sitemap: `${BASE}/sitemap.xml`,
    });
  });
});
