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
  DOCS,
  EXAMPLE_QUOTE,
  FRONT_DOORS,
  homeMetadata,
  homeUrl,
  MCP_ADD_COMMAND,
  MCP_TOOL_NAMES,
  REPO_URL,
  ROADMAP,
  SECTION,
  SECURITY_CONTROLS,
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
const text = html
  .replace(/<[^>]+>/g, " ")
  .replaceAll("&#x27;", "'")
  .replaceAll("&quot;", '"')
  .replaceAll("&amp;", "&")
  .replace(/\s+/g, " ");

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
    expect(STATS[0]).toMatchObject({ label: "MCP tools", value: "5" });
    expect(text).toContain("5 MCP tools");
  });

  it("counts four front doors and labels them Door 01 to 04", () => {
    expect(FRONT_DOORS.map((d) => d.title)).toEqual(["MCP connector", "Readable pages and llms.txt", "Markdown twins", "UCP read-only catalog"]);
    expect(STATS[1]).toMatchObject({ label: "Front doors", value: "4" });
    for (const n of ["01", "02", "03", "04"]) expect(text).toContain(`Door ${n}`);
    expect(text).not.toMatch(/Protocol 0\d/);
  });

  it("states the licence from the repository", () => {
    expect(STATS[2]).toMatchObject({ label: "Licence", value: "Apache-2.0" });
    expect(read("LICENSE")).toContain("Apache License");
    expect(JSON.parse(read("package.json")).license).toBe("Apache-2.0");
  });

  it("claims no more tests than the repository has", () => {
    // Counts test call sites (it(, test(, it.each(...)( ). Vitest runs at least this many, as each() expands.
    const sites = testFiles(join(ROOT, "src")).reduce((n, f) => n + [...readFileSync(f, "utf8").matchAll(/(^|[^.\w])(it|test)(\.each\([^)]*\))?\(/gm)].length, 0);
    expect(sites).toBeGreaterThanOrEqual(TEST_COUNT_FLOOR);
    expect(STATS[3]).toMatchObject({ label: "Automated tests", value: `${TEST_COUNT_FLOOR}+` });
  });

  it("uses the real tool names, in purchase order, and the real quote lifetime", () => {
    expect(STEPS.map((s) => s.tool)).toEqual(["search_products", "get_quote", "checkout", "get_order"]);
    for (const step of STEPS) expect(MCP_TOOL_NAMES).toContain(step.tool);
    expect(QUOTE_TTL_MS).toBe(15 * 60_000);
    expect(STEPS[1]!.body).toContain("15 minutes");
  });
});

describe("the example quote", () => {
  const q = EXAMPLE_QUOTE;

  it("uses real get_quote argument and response field names", () => {
    const input = Object.keys(getQuoteTool.inputSchema.shape);
    const output = Object.keys(getQuoteTool.outputSchema.shape);
    for (const field of Object.keys(q.request)) expect(input, field).toContain(field);
    for (const field of Object.keys(q.response)) expect(output, field).toContain(field);
    for (const field of [...Object.keys(q.request), "quote_id", "tax_rate_percent", "is_converted", "list_currency", "is_binding", "expires_in_seconds"]) {
      expect(text, field).toContain(field);
    }
  });

  it("is internally consistent: subtotal plus tax is the total, at the stated rate", () => {
    const r = q.response;
    expect(r.subtotal.amount_minor + r.tax.amount_minor).toBe(r.total.amount_minor);
    expect(Math.abs(Math.round((r.subtotal.amount_minor * r.tax_rate_percent) / 100) - r.tax.amount_minor)).toBeLessThanOrEqual(1);
    expect(q.request.buyer_country).toBe("DE");
    expect(r.quote_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(r.expires_in_seconds).toBeLessThanOrEqual(QUOTE_TTL_MS / 1000);
  });

  it("is a converted test-catalog quote from a USD list price, and says so", () => {
    expect(q.listPrice.currency).toBe("USD");
    expect(q.response.list_currency).toBe("USD");
    expect(q.response.currency).toBe("EUR");
    expect(q.response.is_converted).toBe(true);
    expect(q.productName.startsWith("[TEST] ")).toBe(true);
    expect(text).toContain("Example quote, test catalog");
    expect(text).toContain("Amounts vary with exchange rates");
    expect(text).toContain("The list price is in USD and this quote was converted to EUR");
    for (const amount of [q.listPrice.formatted, q.response.subtotal.formatted, q.response.tax.formatted, q.response.total.formatted]) expect(text).toContain(amount);
  });
});

describe("content", () => {
  it("shows an honest badge and the test catalog notice", () => {
    expect(text).toContain("Open source · test catalog");
    expect(text).toContain("The live catalog is a test catalog.");
    expect(text).toContain("no real purchases happen");
  });

  it("drops the invented or false content from the design reference", () => {
    for (const banned of [
      "v0.4.2",
      "alpha",
      "Dev Dashboard",
      "Autonomous Commerce",
      "MCP 1.0",
      "Self-host",
      "SKU",
      "VIES",
      "npm install",
      "@openmor/core",
      "Design System",
      "Prava",
      "Stripe",
      "Lemon",
      "delegation",
      "All rights reserved",
      "MoR fees",
      "telemetry",
      "executable",
      "sandbox",
      "RPC",
      "Ready for hosted checkout",
      "agent-session",
      "Registered MoR",
    ]) {
      expect(text.toLowerCase(), banned).not.toContain(banned.toLowerCase());
    }
  });

  it("covers the security controls the threat model supports, and is plain about prompt injection", () => {
    expect(SECURITY_CONTROLS.map((c) => c.title)).toEqual([
      "Encrypted merchant keys",
      "Verified webhooks",
      "Idempotent checkout",
      "Test mode by default",
      "IP rate limit on agent endpoints",
      "Merchant text is data",
    ]);
    const threat = read("docs/threat-model.md");
    expect(threat).toContain("AES-256-GCM");
    expect(threat).toContain("Standard Webhooks");
    expect(threat).toContain("idempotent");
    expect(threat).toContain("100 requests per IP");
    expect(threat).toContain("**This reduces the risk; it cannot remove it.**");
    expect(read("README.md")).toContain("Live mode needs an explicit per-merchant flag");
    expect(text).toContain("AES-256-GCM");
    expect(text).toContain("reduces the risk of prompt injection; it cannot remove it");
    // Only the public pages clean and escape merchant text; MCP results are only length-limited (threat model).
    expect(threat).toContain("MCP results carry names and descriptions with only the length limit");
    expect(text).toContain("Public pages also clean and escape it");
  });

  it("keeps the roadmap honest: no provider names, no dates", () => {
    expect(ROADMAP.map((r) => r.title)).toEqual(["Merchant dashboard", "More provider adapters", "Repeat purchases"]);
    expect(text).toContain("maintainer scripts");
    expect(ROADMAP.map((r) => r.body).join(" ")).not.toMatch(/\b(20\d\d|Q[1-4]|Paddle|Lemon|Stripe)\b/);
  });

  it("has the footer the project uses", () => {
    expect(text).toContain("© 2026 Praful Kharpuriye");
    const footer = html.slice(html.indexOf("<footer"));
    for (const href of [REPO_URL, DOCS.readme, DOCS.docs, DOCS.license]) expect(footer).toContain(`href="${href}"`);
    expect(footer).toContain(">Apache-2.0</a>");
  });
});

describe("structure and links", () => {
  it("has one h1, the hero buttons, and the copy-paste command with a copy button", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<a[^>]*href="#${SECTION.tryIt}"[^>]*>Try it</a>`));
    expect(html).toMatch(/View on GitHub<\/a>/);
    expect(text).toContain(MCP_ADD_COMMAND);
    expect(MCP_ADD_COMMAND).toBe("claude mcp add --transport http openmor https://openmor.vercel.app/api/mcp");
    expect(read("README.md")).toContain(MCP_ADD_COMMAND);
    expect(html).toMatch(/<button type="button"[^>]*aria-label="Copy the command"/);
  });

  it("keeps the design's section order", () => {
    const markers = [
      'id="hero-title"',
      "The live catalog is a test catalog.",
      'aria-label="OpenMoR in numbers"',
      ...[SECTION.how, SECTION.tryIt, SECTION.doors, SECTION.security, SECTION.limits].map((id) => `id="${id}"`),
      "<footer",
    ];
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
    expect(existsSync(join(ROOT, "src/app/.well-known/ucp/route.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "src/app/llms.txt/route.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "src/app/m/[merchantSlug]/page.tsx"))).toBe(true);
    expect(TWIN_REWRITES.some((r) => r.source === "/m/:merchantSlug.md")).toBe(true);
    expect(existsSync(join(ROOT, "src/app/twin/m/[merchantSlug]/route.ts"))).toBe(true);
    expect(FRONT_DOORS[0]!.links[0]!.href).toBe(`#${SECTION.tryIt}`);
  });

  it("links outside the site only to files that exist in the GitHub repository", () => {
    const external = hrefs.filter((h) => /^https?:/.test(h));
    expect(external.length).toBeGreaterThan(0);
    for (const url of external) {
      expect(url, url).toMatch(/^https:\/\/github\.com\/PrafulK99\/openmor([/#]|$)/);
      const blob = url.match(/\/blob\/main\/(.+)$/)?.[1];
      const tree = url.match(/\/tree\/main\/(.+)$/)?.[1];
      if (blob) expect(existsSync(join(ROOT, blob)), blob).toBe(true);
      if (tree) expect(statSync(join(ROOT, tree)).isDirectory(), tree).toBe(true);
    }
    for (const doc of [DOCS.threatModel, DOCS.security, DOCS.savedPayments]) expect(hrefs).toContain(doc);
  });

  it("loads nothing external and has no inline event handlers", () => {
    expect(html).not.toMatch(/<(script|img|iframe|link|style)\b/i);
    expect(html).not.toMatch(/\s(src|on[a-z]+)=/i);
    expect(html).not.toMatch(/fonts\.googleapis|tailwind|material/i);
  });
});

describe("static and self-contained", () => {
  const imports = (path: string) => [...read(path).matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();

  it("imports nothing that can reach the database or a provider", () => {
    expect(imports("src/app/page.tsx")).toEqual(["./_home/content", "./_home/copy-button", "./_home/home.module.css", "./_home/icons", "next/link"]);
    expect(imports("src/app/_home/content.ts")).toEqual(["./icons", "next"]);
    expect(read("src/app/_home/content.ts")).toContain('import type { IconName } from "./icons";');
    expect(imports("src/app/_home/icons.tsx")).toEqual([]);
    expect(imports("src/app/_home/copy-button.tsx")).toEqual(["./home.module.css", "./icons", "react"]);
    expect(read("src/app/_home/copy-button.tsx").startsWith('"use client";')).toBe(true);
  });

  it("is light in every color scheme, like the design", () => {
    const globals = read("src/app/globals.css");
    const darkBlock = globals.slice(globals.indexOf("@media (prefers-color-scheme: dark)"));
    for (const token of ["home-bg", "home-fg", "home-muted", "surface", "accent", "chip-bg", "receipt-bg"]) expect(darkBlock, token).not.toContain(`--${token}:`);
    expect(read("src/app/_home/home.module.css")).toMatch(/\.page \{[^}]*color-scheme: light;/);
    expect(read("src/app/_home/home.module.css")).not.toContain("prefers-color-scheme");
  });

  it("styles use only the color variables, no external files, and animate only when motion is allowed", () => {
    const css = read("src/app/_home/home.module.css");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(css).not.toMatch(/url\(|@import|@font-face/i);
    const globals = read("src/app/globals.css");
    for (const v of css.matchAll(/var\(--([\w-]+)\)/g)) {
      if (["gutter", "max", "sans", "mono"].includes(v[1]!)) continue;
      expect(globals, v[1]).toContain(`--${v[1]}:`);
    }
    const motionStart = css.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(motionStart).toBeGreaterThan(0);
    for (const m of css.matchAll(/\b(animation|transition):/g)) expect(m.index!).toBeGreaterThan(motionStart);
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
