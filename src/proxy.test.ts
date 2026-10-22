import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strippedOrderUrl } from "@/lib/return-url";
import nextConfig from "../next.config";
import { config, proxy } from "./proxy";

const KEY = "LK-SECRET-1234-ABCD-5678";
const dirty = `http://localhost:3000/orders/cmvik99qn000sr0vpi5zs5k2a?payment_id=pay_1&status=succeeded&license_key=${KEY}`;
const logged: string[] = [];

beforeEach(() => {
  logged.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(JSON.stringify(a)));
  }
});
afterEach(() => vi.restoreAllMocks());

describe("order return URL proxy", () => {
  it("redirects server-side to the same order URL without the licence key", () => {
    const res = proxy(new NextRequest(dirty));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/orders/cmvik99qn000sr0vpi5zs5k2a");
    expect(res.headers.get("location")).not.toContain(KEY);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("drops every query parameter, not just license_key", () => {
    const res = proxy(new NextRequest("http://localhost:3000/orders/ord_1?licenseKey=x&foo=bar#frag"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/orders/ord_1");
  });

  it("lets a clean order URL through untouched", () => {
    const res = proxy(new NextRequest("http://localhost:3000/orders/ord_1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("never logs the incoming URL", () => {
    proxy(new NextRequest(dirty));
    expect(logged.join("\n")).not.toContain(KEY);
    expect(logged).toEqual([]);
  });

  it("runs only on order pages", () => {
    expect(config.matcher).toBe("/orders/:id");
    expect(strippedOrderUrl(new URL("http://x/api/mcp?license_key=1"))).toBeNull();
    expect(strippedOrderUrl(new URL("http://x/orders/a/b?license_key=1"))).toBeNull();
  });

  it("keeps order URLs out of the dev request log", () => {
    const ignore = (nextConfig.logging as { incomingRequests: { ignore: RegExp[] } }).incomingRequests.ignore;
    expect(ignore.some((re) => re.test(dirty))).toBe(true);
    expect(ignore.some((re) => re.test("http://localhost:3000/api/mcp"))).toBe(false);
  });
});
