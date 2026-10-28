// The landing page at /. It must stay static (no database, no Dodo, no external resources), and every
// number and claim on it must match the code, so these tests read the code and docs it talks about.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QUOTE_TTL_MS } from "@/core/quotes";
import { TWIN_REWRITES } from "@/lib/twin-config";
import { TOOLS } from "@/protocols/mcp/server";
import { getQuoteTool } from "@/protocols/mcp/tools/get-quote";
import {
  CONNECTOR_URL,
  DOCS,
  FRONT_DOORS,
  homeMetadata,
  homeUrl,
  MCP_ADD_COMMAND,
  MCP_TOOL_NAMES,
  QUOTE_MINUTES,
  REPO_URL,
  SECTION,
  STATS,
  STEPS,
  TEST_COUNT_FLOOR,
} from "./_home/content";
import Home from "./page";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const html = renderToStaticMarkup(<Home />);
const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
const text = html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ");

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("numbers on the page match the code", () => {
  it("names exactly the MCP tools the connector registers", () => {
    expect([...MCP_TOOL_NAMES]).toEqual(TOOLS.map((t) => t.name));
    expect(STATS[0]).toEqual({ value: "5", label: "MCP tools" });
  });

  it("counts four front doors, one card each", () => {
    expect(FRONT_DOORS.map((d) => d.title)).toEqual(["MCP connector", "Readable pages and llms.txt", "Markdown twins", "UCP read-only catalog"]);
    expect(STATS[1]!.value).toBe("4");
  });

  it("states the real quote lifetime", () => {
    expect(QUOTE_MINUTES * 60_000).toBe(QUOTE_TTL_MS);
    expect(STATS[2]!.value).toBe(`${QUOTE_MINUTES} min`);
  });

  it("claims no more tests than the repository has", () => {
    // Counts test call sites (it(, test(, it.each(...)( ). Vitest runs at least this many, as each() expands.
    const sites = testFiles(join(ROOT, "src")).reduce((n, f) => n + [...readFileSync(f, "utf8").matchAll(/(^|[^.\w])(it|test)(\.each\([^)]*\))?\(/gm)].length, 0);
    expect(sites).toBeGreaterThanOrEqual(TEST_COUNT_FLOOR);
    expect(STATS[3]!.value).toBe(`${TEST_COUNT_FLOOR}+`);
  });

  it("shows only real get_quote fields in the hero example", () => {
    const input = Object.keys(getQuoteTool.inputSchema.shape);
    const output = Object.keys(getQuoteTool.outputSchema.shape);
    for (const field of ["merchant_id", "product_id", "buyer_country"]) {
      expect(input).toContain(field);
      expect(html).toContain(`&quot;${field}&quot;`);
    }
    for (const field of ["quote_id", "total", "tax_rate_percent", "is_binding", "expires_in_seconds"]) {
      expect(output).toContain(field);
      expect(text).toContain(field);
    }
  });

  it("gives every purchase step a real tool, in order, covering all five", () => {
    expect(STEPS.map((s) => s.title)).toEqual(["Find", "Quote with the right tax", "Pay on Dodo's hosted page", "Receive the licence key"]);
    expect(STEPS.flatMap((s) => s.tools)).toEqual([...MCP_TOOL_NAMES]);
  });
});

describe("claims match the README and docs", () => {
  it("uses the same connect command and connector URL as the README", () => {
    expect(read("README.md")).toContain(MCP_ADD_COMMAND);
    expect(MCP_ADD_COMMAND).toBe("claude mcp add --transport http openmor https://openmor.vercel.app/api/mcp");
    expect(CONNECTOR_URL.endsWith("/api/mcp")).toBe(true);
    expect(read("README.md")).toContain("/m/sharethings");
  });

  it("security claims are backed by the code and the deploy docs", () => {
    expect(read("src/lib/crypto.ts")).toContain("aes-256-gcm");
    expect(read("docs/deploy.md")).toMatch(/100 requests/);
    expect(read("docs/deploy.md")).toMatch(/60 ?s/);
    expect(read("next.config.ts")).toContain("Content-Security-Policy");
    for (const claim of ["No card data", "Keys encrypted at rest", "Verified webhooks", "Test mode by default"]) expect(text).toContain(claim);
  });
});

describe("rendered page", () => {
  it("shows the test catalog notice before anything else", () => {
    expect(text).toContain("Test catalog.");
    expect(text).toContain("no real purchases happen");
    expect(html.indexOf("Test catalog.")).toBeLessThan(html.indexOf("<h1"));
  });

  it("has one h1, the two hero buttons, and the copy-paste command", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<a[^>]*href="#${SECTION.tryIt}"[^>]*>Try it</a>`));
    expect(html).toMatch(new RegExp(`<a[^>]*href="${REPO_URL}"[^>]*>View on GitHub</a>`));
    expect(text).toContain(MCP_ADD_COMMAND);
    expect(text).toContain("Germany");
  });

  it("keeps the sections in the agreed order", () => {
    const markers = ['id="hero-title"', 'aria-label="OpenMoR in numbers"', ...[SECTION.how, SECTION.tryIt, SECTION.doors, SECTION.security, SECTION.limits].map((id) => `id="${id}"`), "<footer"];
    const order = markers.map((marker) => html.indexOf(marker));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("every in-page link has a target", () => {
    const anchors = hrefs.filter((h) => h.startsWith("#"));
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) expect(ids, a).toContain(a.slice(1));
  });

  it("links each front door to a route that exists", () => {
    const local = [...new Set(hrefs.filter((h) => h.startsWith("/")))].sort();
    expect(local).toEqual(["/", "/.well-known/ucp", "/llms.txt", "/m/sharethings", "/m/sharethings.md"]);
    expect(existsSync(join(ROOT, "src/app/page.tsx"))).toBe(true);
    expect(existsSync(join(ROOT, "src/app/.well-known/ucp/route.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "src/app/llms.txt/route.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "src/app/m/[merchantSlug]/page.tsx"))).toBe(true);
    expect(TWIN_REWRITES.some((r) => r.source === "/m/:merchantSlug.md")).toBe(true);
    expect(existsSync(join(ROOT, "src/app/twin/m/[merchantSlug]/route.ts"))).toBe(true);
  });

  it("links only to this site and to files that exist in the GitHub repository", () => {
    const external = hrefs.filter((h) => /^https?:/.test(h));
    expect(external.length).toBeGreaterThan(0);
    for (const url of external) {
      expect(url, url).toMatch(/^https:\/\/github\.com\/PrafulK99(\/openmor)?([/#]|$)/);
      const blob = url.match(/\/blob\/main\/(.+)$/)?.[1];
      const tree = url.match(/\/tree\/main\/(.+)$/)?.[1];
      if (blob) expect(existsSync(join(ROOT, blob)), blob).toBe(true);
      if (tree) expect(statSync(join(ROOT, tree)).isDirectory(), tree).toBe(true);
    }
    for (const doc of [DOCS.threatModel, DOCS.security, DOCS.license, DOCS.readme, DOCS.docs]) expect(hrefs).toContain(doc);
  });

  it("loads nothing external: no scripts, images, frames or stylesheets", () => {
    expect(html).not.toMatch(/<(script|img|iframe|link|style)\b/i);
    expect(html).not.toMatch(/\ssrc=/i);
  });
});

describe("static and self-contained", () => {
  it("imports nothing that can reach the database or a provider", () => {
    const imports = (path: string) => [...read(path).matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports("src/app/page.tsx").sort()).toEqual(["./_home/content", "./_home/home.module.css", "next/link"]);
    expect(imports("src/app/_home/content.ts")).toEqual(["next"]);
  });

  it("styles use only the color variables and no external fonts or files", () => {
    const css = read("src/app/_home/home.module.css");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(css).not.toMatch(/url\(|@import|@font-face/i);
    for (const v of css.matchAll(/var\(--([\w-]+)\)/g)) {
      if (["gutter", "max"].includes(v[1]!)) continue;
      expect(read("src/app/globals.css"), v[1]).toContain(`--${v[1]}:`);
    }
  });
});

describe("metadata", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("builds the canonical URL and Open Graph basics from APP_URL, with no image", () => {
    const meta = homeMetadata("https://shop.example.com/");
    expect(meta.alternates?.canonical).toBe("https://shop.example.com/");
    expect(meta.openGraph).toMatchObject({ type: "website", siteName: "OpenMoR", url: "https://shop.example.com/" });
    expect(meta.openGraph).not.toHaveProperty("images");
    expect(meta.title).toMatch(/^OpenMoR/);
    expect(String(meta.description).length).toBeLessThanOrEqual(200);
  });

  it("falls back to production when APP_URL is missing or not a web URL", () => {
    expect(homeUrl(undefined)).toBe("https://openmor.vercel.app");
    expect(homeUrl("not a url")).toBe("https://openmor.vercel.app");
    expect(homeUrl("javascript:alert(1)")).toBe("https://openmor.vercel.app");
    expect(homeUrl("http://localhost:3000/some/path")).toBe("http://localhost:3000");
  });

  it("the page exports metadata for the configured APP_URL", async () => {
    vi.stubEnv("APP_URL", "https://openmor.example.com");
    const { metadata } = await import("./page");
    expect(metadata.alternates?.canonical).toBe("https://openmor.example.com/");
  });
});
