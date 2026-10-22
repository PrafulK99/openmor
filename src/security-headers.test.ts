import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

/** Headers of the single catch-all rule, which applies to every route. */
async function allRouteHeaders(): Promise<Record<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  expect(rules.map((r) => r.source)).toEqual(["/:path*"]);
  return Object.fromEntries(rules.flatMap((r) => r.headers.map((h) => [h.key.toLowerCase(), h.value])));
}

describe("security headers", () => {
  it("sets nosniff, no-referrer and DENY framing on all routes", async () => {
    const h = await allRouteHeaders();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["x-frame-options"]).toBe("DENY");
  });

  it("has a CSP that blocks framing, plugins and foreign scripts but allows Next's inline hydration", async () => {
    const csp = (await allRouteHeaders())["content-security-policy"];
    const directives = Object.fromEntries(csp!.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["script-src"]).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'"]));
    expect(directives["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    // Tests run with NODE_ENV=test: no eval outside dev.
    expect(directives["script-src"]).not.toContain("'unsafe-eval'");
  });
});
