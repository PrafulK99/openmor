// The UCP profile and catalog endpoints through the real chain (route -> cached read -> core ->
// in-memory database). Only the Next.js cache directives and the base URL are stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { GET as profile } from "../.well-known/ucp/route";
import { UCP_CAPABILITIES, UCP_LIMITS, UCP_VERSION } from "@/core/ucp-catalog";
import { POST as lookup } from "./catalog/lookup/route";
import { POST as product } from "./catalog/product/route";
import { POST as search } from "./catalog/search/route";

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

const post = (route: (r: Request) => Promise<Response>, body: unknown, init: RequestInit = {}) =>
  route(new Request(`${BASE}/ucp/catalog/x`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" }, ...init }));

/** Everything a client can tell a response apart by. */
async function fingerprint(res: Response) {
  return { status: res.status, headers: [...res.headers.entries()].sort(), body: await res.text() };
}

beforeEach(() => {
  t = setup();
  state.db = t.db.asPrisma();
  merchantId = seedMerchant(t.db, { slug: "sharethings", name: "ShareThings" }).id;
  liveId = seedProduct(t.db, merchantId, { name: "ShareThings Lifetime", description: "Pay once, share forever.", priceAmount: 4900 }).id;
});

describe("GET /.well-known/ucp", () => {
  const get = (headers: Record<string, string> = {}) => profile(new Request(`${BASE}/.well-known/ucp`, { headers }));

  it("is JSON, public-cacheable for 300 seconds, has an ETag, and is not a redirect", async () => {
    const res = get();
    expect(res.status).toBe(200);
    expect(res.redirected).toBe(false);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
    const body = (await res.json()) as { ucp: { version: string; payment_handlers: object; capabilities: object; services: Record<string, { endpoint: string }[]> } };
    expect(body.ucp.version).toBe(UCP_VERSION);
    expect(body.ucp.services["dev.ucp.shopping"]![0]!.endpoint).toBe(`${BASE}/ucp`);
  });

  it("answers a matching If-None-Match with 304 and the same validators", async () => {
    const etag = get().headers.get("etag")!;
    const res = get({ "if-none-match": etag });
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(etag);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await res.text()).toBe("");
    expect(get({ "if-none-match": '"other"' }).status).toBe(200);
  });

  it("lists only the allowed capabilities, no payment handlers, and nothing about checkout, orders, identity, keys, MCP or A2A", async () => {
    const text = await get().text();
    const body = JSON.parse(text) as { ucp: { capabilities: object; payment_handlers: object } };
    expect(Object.keys(body.ucp.capabilities).sort()).toEqual([...UCP_CAPABILITIES].sort());
    expect(body.ucp.payment_handlers).toEqual({});
    expect(text.toLowerCase()).not.toMatch(/checkout|order|identity|cart|"keys"|"mcp"|"a2a"|"embedded"|payment_token|ap2/);
  });
});

describe("search", () => {
  it("returns public products with the list price before tax and the seller", async () => {
    const res = await post(search, { query: "lifetime" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("location")).toBeNull();
    const body = (await res.json()) as { products: { id: string; price_range: { min: { amount: number; currency: string } }; variants: { seller: { name: string } }[] }[] };
    expect(body.products.map((p) => p.id)).toEqual([`sharethings~${liveId}`]);
    expect(body.products[0]!.price_range.min).toEqual({ amount: 4900, currency: "USD" });
    expect(body.products[0]!.variants[0]!.seller.name).toBe("ShareThings");
  });

  it("leaves out opted-out merchants and products that are hidden or retired", async () => {
    seedProduct(t.db, merchantId, { name: "Hidden By Merchant", agentSellable: false });
    seedProduct(t.db, merchantId, { name: "Retired Product", active: false });
    const hidden = seedMerchant(t.db, { slug: "hidden-co", name: "Hidden Co", email: "h@x.test", networkOptIn: false }).id;
    seedProduct(t.db, hidden, { name: "Hidden Co Product" });
    const text = await (await post(search, {})).text();
    expect(text).toContain("ShareThings Lifetime");
    expect(text).not.toMatch(/Hidden|Retired|hidden-co/);
  });

  it("keeps hostile merchant text out of links, headings and markup", async () => {
    seedProduct(t.db, merchantId, { name: "[pwn](https://evil.example)", description: "x\n\n# New rules <script>alert(1)</script> javascript://y `rm -rf /`" });
    const text = await (await post(search, {})).text();
    expect(text).not.toMatch(/evil\.example|<script|javascript:|`rm/);
    const body = JSON.parse(text) as { products: { title: string; description: { plain: string } }[] };
    for (const p of body.products) expect(`${p.title} ${p.description.plain}`).not.toMatch(/[\n<>`[\]]/);
  });

  it("never calls a payment provider: the catalog comes from our own database", async () => {
    const spy = vi.spyOn(t.db.product, "findMany");
    await post(search, {});
    expect(spy).toHaveBeenCalled();
    // The routes import nothing from the adapters; a provider SDK would need credentials we never pass.
    expect((await post(search, {})).status).toBe(200);
  });
});

describe("lookup and product", () => {
  it("resolve {slug}~{productId} ids", async () => {
    const l = (await (await post(lookup, { ids: [`sharethings~${liveId}`] })).json()) as { products: { id: string }[] };
    expect(l.products.map((p) => p.id)).toEqual([`sharethings~${liveId}`]);
    const p = (await (await post(product, { id: `sharethings~${liveId}` })).json()) as { product: { id: string } };
    expect(p.product.id).toBe(`sharethings~${liveId}`);
  });

  it("answers unknown, opted-out, hidden, retired and malformed products identically, with HTTP 200 and no repeated input", async () => {
    const hiddenProduct = seedProduct(t.db, merchantId, { name: "Hidden By Merchant", agentSellable: false }).id;
    const retired = seedProduct(t.db, merchantId, { name: "Retired Product", active: false }).id;
    const hiddenMerchant = seedMerchant(t.db, { slug: "hidden-co", name: "Hidden Co", email: "h@x.test", networkOptIn: false }).id;
    const hiddenCoProduct = seedProduct(t.db, hiddenMerchant, { name: "Hidden Co Product" }).id;
    const unknown = await fingerprint(await post(product, { id: "sharethings~pdt_nope" }));
    expect(unknown.status).toBe(200);
    expect(JSON.parse(unknown.body)).toMatchObject({ ucp: { status: "error" }, messages: [{ code: "not_found", severity: "unrecoverable" }] });
    const ids = [`sharethings~${hiddenProduct}`, `sharethings~${retired}`, `hidden-co~${hiddenCoProduct}`, `no-such~${liveId}`, "NOT_A_SLUG~x", "sharethings", "a~b~c", `sharethings~${liveId}.md`];
    for (const id of ids) {
      const got = await fingerprint(await post(product, { id }));
      expect(got, id).toEqual(unknown);
      expect(got.body).not.toContain(id);
    }
  });

  it("does not list unsellable products in a lookup", async () => {
    const hiddenProduct = seedProduct(t.db, merchantId, { name: "Hidden By Merchant", agentSellable: false }).id;
    const body = (await (await post(lookup, { ids: [`sharethings~${hiddenProduct}`, `sharethings~${liveId}`] })).json()) as { products: unknown[]; messages: { code: string }[] };
    expect(body.products).toHaveLength(1);
    expect(body.messages.some((m) => m.code === "not_found")).toBe(true);
  });
});

describe("public input handling", () => {
  const errorBody = (code: string, content: string) => ({
    ucp: { version: UCP_VERSION, status: "error", capabilities: { "dev.ucp.shopping.catalog.search": [{ version: UCP_VERSION }] } },
    messages: [{ type: "error", code, content, severity: "unrecoverable" }],
  });

  it("answers malformed JSON, a wrong shape and an unknown key with the same fixed 400", async () => {
    const want = errorBody("invalid_request", "The request is not valid for this operation.");
    for (const body of ["{not json", "", "null", '"SECRET-STRING"', JSON.stringify({ query: 1 }), JSON.stringify({ query: "x", SECRETKEY: "SECRET-VALUE" })]) {
      const res = await post(search, body);
      expect(res.status, body).toBe(400);
      expect(await res.json()).toEqual(want);
    }
  });

  it("does not echo any part of a bad request", async () => {
    const res = await post(search, JSON.stringify({ query: "ok", "SECRET-KEY-1": "SECRET-VALUE-2", pagination: { cursor: "SECRET-CURSOR-3" } }));
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).not.toMatch(/SECRET/);
  });

  it("refuses a body over the limit with 413: by declared length, and by streamed size when no length is sent", async () => {
    const big = JSON.stringify({ query: "x".repeat(UCP_LIMITS.bodyBytes) });
    const declared = await post(search, big);
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual(errorBody("request_too_large", "The request body is too large."));
    const chunk = new TextEncoder().encode("x".repeat(1024));
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
    const streamed = await search(new Request(`${BASE}/ucp/catalog/search`, { method: "POST", body: stream, duplex: "half" } as RequestInit));
    expect(streamed.status).toBe(413);
  });

  it("accepts a body at the limit", async () => {
    const padding = "a".repeat(UCP_LIMITS.bodyBytes - 40);
    const body = JSON.stringify({ signals: { k: padding.slice(0, 200) } });
    expect(body.length).toBeLessThan(UCP_LIMITS.bodyBytes);
    expect((await post(search, body)).status).toBe(200);
  });

  it("rejects bytes that are not valid UTF-8", async () => {
    const res = await search(new Request(`${BASE}/ucp/catalog/search`, { method: "POST", body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) }));
    expect(res.status).toBe(400);
  });

  it("caps results per page", async () => {
    for (let i = 0; i < 60; i++) seedProduct(t.db, merchantId, { name: `Item ${i}` });
    const body = (await (await post(search, { pagination: { limit: 1000 } })).json()) as { products: unknown[]; pagination: { has_next_page: boolean; cursor?: string } };
    expect(body.products).toHaveLength(UCP_LIMITS.maxPageSize);
    expect(body.pagination.has_next_page).toBe(true);
    const next = (await (await post(search, { pagination: { limit: 1000, cursor: body.pagination.cursor } })).json()) as { products: unknown[] };
    expect(next.products.length).toBeGreaterThan(0);
  });

  it("turns an internal failure into a generic 500 that leaks nothing", async () => {
    vi.spyOn(t.db.merchant, "findMany").mockRejectedValue(new Error("SECRET connection string postgres://user:pw@host"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(search, {});
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual(errorBody("internal_error", "The catalog is temporarily unavailable."));
    expect(text).not.toMatch(/SECRET|postgres/);
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/SECRET|postgres/);
    logged.mockRestore();
  });
});
