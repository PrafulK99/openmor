// Test-mode merchants on every public surface, through the real chain (route or page -> cached read ->
// core -> in-memory database): hidden unless PUBLIC_INCLUDE_TEST_MERCHANTS=true, and then marked with
// fixed strings, noindex, and left out of the sitemap. A hidden merchant looks exactly like an unknown one.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_NOTE } from "@/core/visibility";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { GET as networkLlms } from "./llms.txt/route";
import { GET as merchantLlms } from "./m/[merchantSlug]/llms.txt/route";
import MerchantPage, { generateMetadata as merchantMetadata } from "./m/[merchantSlug]/page";
import ProductPage, { generateMetadata as productMetadata } from "./m/[merchantSlug]/[productId]/page";
import sitemap from "./sitemap";
import { GET as merchantTwin } from "./twin/m/[merchantSlug]/route";
import { GET as productTwin } from "./twin/m/[merchantSlug]/[productId]/route";
import { POST as ucpLookup } from "./ucp/catalog/lookup/route";
import { POST as ucpProduct } from "./ucp/catalog/product/route";
import { POST as ucpSearch } from "./ucp/catalog/search/route";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/public-url", () => ({ publicBaseUrl: () => "https://openmor.example.com" }));

const BASE = "https://openmor.example.com";
let t: ReturnType<typeof setup>;
let testProductId: string;
let liveProductId: string;

const flag = (on: boolean) => vi.stubEnv("PUBLIC_INCLUDE_TEST_MERCHANTS", on ? "true" : "false");
const mParam = (merchantSlug: string) => ({ params: Promise.resolve({ merchantSlug }) }) as never;
const pParam = (merchantSlug: string, productId: string) => ({ params: Promise.resolve({ merchantSlug, productId }) }) as never;
const html = async (element: Promise<unknown>) => renderToStaticMarkup((await element) as never);
const is404 = (e: unknown) => (e as { digest?: string }).digest?.includes("404") === true;
const rejects404 = async (render: () => Promise<unknown>) => is404(await render().then(() => null, (e: unknown) => e));
const twinM = (slug: string) => merchantTwin(new Request(`${BASE}/m/${slug}.md`), mParam(slug));
const twinP = (slug: string, id: string) => productTwin(new Request(`${BASE}/m/${slug}/${id}.md`), pParam(slug, id));
const llmsM = (slug: string) => merchantLlms(new Request(`${BASE}/m/${slug}/llms.txt`), mParam(slug));
const post = (route: (r: Request) => Promise<Response>, body: unknown) =>
  route(new Request(`${BASE}/ucp/catalog/x`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const fingerprint = async (res: Response) => ({ status: res.status, headers: [...res.headers.entries()].sort(), body: await res.text() });
const ucpIds = (r: { products: { id: string }[] }) => r.products.map((p) => p.id);

beforeEach(() => {
  t = setup();
  state.db = t.db.asPrisma();
  const live = seedMerchant(t.db, { slug: "liveco", name: "LiveCo", email: "l@x.test" }).id;
  liveProductId = seedProduct(t.db, live, { name: "LiveCo Pro", description: "A live product." }).id;
  const test = seedMerchant(t.db, { slug: "tester", name: "Tester", email: "t@x.test", dodoEnvironment: "test_mode", liveModeEnabled: false }).id;
  testProductId = seedProduct(t.db, test, { name: "Tester Pro", description: "A test product." }).id;
});

afterEach(() => vi.unstubAllEnvs());

describe("flag off: a test merchant is exactly an unknown merchant", () => {
  beforeEach(() => flag(false));

  it("pages and metadata are the same bare 404 / generic title", async () => {
    for (const slug of ["tester", "no-such-merchant"]) {
      expect(await rejects404(() => MerchantPage(mParam(slug)))).toBe(true);
      expect(await merchantMetadata(mParam(slug))).toEqual({ title: "Not found" });
    }
    for (const [slug, id] of [["tester", testProductId], ["no-such-merchant", testProductId], ["liveco", "nope"]] as const) {
      expect(await rejects404(() => ProductPage(pParam(slug, id)))).toBe(true);
      expect(await productMetadata(pParam(slug, id))).toEqual({ title: "Not found" });
    }
  });

  it("markdown twins and per-merchant llms.txt answer identically to unknown ones", async () => {
    expect(await fingerprint(await twinM("tester"))).toEqual(await fingerprint(await twinM("no-such-merchant")));
    expect(await fingerprint(await twinP("tester", testProductId))).toEqual(await fingerprint(await twinP("no-such-merchant", testProductId)));
    expect((await twinM("tester")).status).toBe(404);
    expect(await fingerprint(await llmsM("tester"))).toEqual(await fingerprint(await llmsM("no-such-merchant")));
    expect((await llmsM("tester")).status).toBe(404);
  });

  it("llms.txt and the sitemap list only live merchants", async () => {
    const llms = await (await networkLlms()).text();
    expect(llms).toContain("liveco");
    expect(llms).not.toMatch(/tester|Tester|TEST/);
    const urls = (await sitemap()).map((e) => e.url).join("\n");
    expect(urls).toContain("/m/liveco");
    expect(urls).not.toContain("tester");
  });

  it("the UCP catalog has no test products, and a hidden id gets the unknown id's answer", async () => {
    const all = (await (await post(ucpSearch, { query: "" })).json()) as { products: { id: string }[] };
    expect(ucpIds(all)).toEqual([`liveco~${liveProductId}`]);
    expect(JSON.stringify(all)).not.toMatch(/tester|Tester/);
    expect(await fingerprint(await post(ucpProduct, { id: `tester~${testProductId}` }))).toEqual(await fingerprint(await post(ucpProduct, { id: `nobody~${testProductId}` })));
    expect(await fingerprint(await post(ucpLookup, { ids: [`tester~${testProductId}`] }))).toEqual(await fingerprint(await post(ucpLookup, { ids: [`nobody~${testProductId}`] })));
  });

  it("is also off when the variable is unset or a typo", async () => {
    for (const v of [undefined, "yes", "TRUE"]) {
      vi.unstubAllEnvs();
      if (v) vi.stubEnv("PUBLIC_INCLUDE_TEST_MERCHANTS", v);
      expect((await twinM("tester")).status).toBe(404);
    }
  });
});

describe("flag on: test merchants appear, marked everywhere, and are not indexable", () => {
  beforeEach(() => flag(true));

  it("pages show the banner and are noindex; live pages have neither", async () => {
    const m = await html(MerchantPage(mParam("tester")));
    expect(m).toContain("Tester");
    expect(m).toContain(TEST_NOTE);
    const p = await html(ProductPage(pParam("tester", testProductId)));
    expect(p).toContain(TEST_NOTE);
    for (const meta of [await merchantMetadata(mParam("tester")), await productMetadata(pParam("tester", testProductId))]) {
      expect(meta.robots).toEqual({ index: false, follow: false });
    }
    expect(await html(MerchantPage(mParam("liveco")))).not.toContain("TEST CATALOG");
    expect(await html(ProductPage(pParam("liveco", liveProductId)))).not.toContain("TEST CATALOG");
    expect((await merchantMetadata(mParam("liveco"))).robots).toBeUndefined();
  });

  it("markdown twins carry the banner and noindex; live twins do not carry the banner", async () => {
    for (const res of [await twinM("tester"), await twinP("tester", testProductId)]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(await res.text()).toContain(`> ${TEST_NOTE}`);
    }
    expect(await (await twinM("liveco")).text()).not.toContain("TEST CATALOG");
    expect(await (await twinP("liveco", liveProductId)).text()).not.toContain("TEST CATALOG");
  });

  it("llms.txt files say so; the network file flags only the test merchant", async () => {
    const network = await (await networkLlms()).text();
    expect(network).toContain(TEST_NOTE);
    const testLine = network.split("\n").find((l) => l.includes("/m/tester"))!;
    const liveLine = network.split("\n").find((l) => l.includes("/m/liveco"))!;
    expect(testLine).toContain("TEST merchant (test mode).");
    expect(liveLine).not.toContain("TEST");
    expect(await (await llmsM("tester")).text()).toContain(TEST_NOTE);
    expect(await (await llmsM("liveco")).text()).not.toContain("TEST CATALOG");
  });

  it("the sitemap leaves test merchants and their products out", async () => {
    const urls = (await sitemap()).map((e) => e.url).join("\n");
    expect(urls).toContain("/m/liveco");
    expect(urls).not.toContain("tester");
    expect(urls).not.toContain(testProductId);
  });

  it("the UCP catalog marks test products with metadata and an info message, and live ones with neither", async () => {
    const res = (await (await post(ucpSearch, { query: "" })).json()) as {
      products: { id: string; variants: { metadata: Record<string, unknown> }[] }[];
      messages: { code: string; content: string }[];
    };
    const byId = Object.fromEntries(res.products.map((p) => [p.id, p]));
    expect(byId[`tester~${testProductId}`]!.variants[0]!.metadata.test_catalog).toBe(true);
    expect(byId[`liveco~${liveProductId}`]!.variants[0]!.metadata).not.toHaveProperty("test_catalog");
    expect(res.messages.find((m) => m.code === "test_catalog")?.content).toBe(TEST_NOTE);

    const liveOnly = (await (await post(ucpSearch, { query: "LiveCo" })).json()) as { messages: { code: string }[] };
    expect(liveOnly.messages.map((m) => m.code)).not.toContain("test_catalog");

    const one = (await (await post(ucpProduct, { id: `tester~${testProductId}` })).json()) as { messages: { code: string }[]; product: { variants: { metadata: Record<string, unknown> }[] } };
    expect(one.product.variants[0]!.metadata.test_catalog).toBe(true);
    expect(one.messages.map((m) => m.code)).toContain("test_catalog");
    const looked = (await (await post(ucpLookup, { ids: [`tester~${testProductId}`] })).json()) as { messages: { code: string }[] };
    expect(looked.messages.map((m) => m.code)).toContain("test_catalog");
  });

  it("merchant text cannot fake the marker or the note", async () => {
    t.db.tables.merchant.find((m) => m.slug === "liveco")!.name = TEST_NOTE;
    const live = await html(MerchantPage(mParam("liveco")));
    // The text appears once, as the escaped merchant name, and not as the banner (role="note").
    expect(live).not.toContain('role="note"');
  });
});
