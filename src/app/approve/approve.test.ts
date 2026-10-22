import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBuyerLink, getApprovalView } from "@/core/buyer-links";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { fakeEmail, tokenFromEmail } from "@/test/fake-email";
import nextConfig from "../../../next.config";
import { GET } from "./[token]/route";
import { APPROVAL_COOKIE, approvalLanding, clearedApprovalCookie } from "./landing";
import { isFinal, MESSAGES, messageFor } from "./messages";

const TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MC1fQUJDREVG";
const logged: string[] = [];

beforeEach(() => {
  logged.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(JSON.stringify(a)));
  }
});
afterEach(() => vi.restoreAllMocks());

describe("approvalLanding (the emailed link)", () => {
  it("redirects to /approve with the token only in an HttpOnly, SameSite=Lax cookie scoped to /approve", () => {
    const res = approvalLanding(TOKEN, true);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/approve");
    expect(res.headers.get("location")).not.toContain(TOKEN);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${APPROVAL_COOKIE}=${TOKEN}`);
    for (const attr of ["Path=/approve", "HttpOnly", "SameSite=Lax", "Max-Age=1800", "Secure"]) expect(cookie).toContain(attr);
  });

  it("does not cache the redirect or send a Referer", () => {
    const res = approvalLanding(TOKEN, true);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("omits Secure only on plain http (local development)", () => {
    expect(approvalLanding(TOKEN, false).headers.get("set-cookie")).not.toContain("Secure");
  });

  it.each(["", "short", "has space in it 123456789012345", "x".repeat(200), "bad/token/with/slashes1234567890"])(
    "sets no cookie for the malformed token %j",
    (bad) => {
      const res = approvalLanding(bad, true);
      expect(res.status).toBe(303);
      expect(res.headers.get("set-cookie")).toBeNull();
    },
  );

  it("clears the cookie with Max-Age=0 on the same path", () => {
    expect(clearedApprovalCookie(true)).toMatch(/^openmor_approval=; Path=\/approve; .*Max-Age=0/);
  });
});

describe("GET /approve/[token] route", () => {
  const call = (url: string, headers: Record<string, string> = {}) =>
    GET(new Request(url, { headers }), { params: Promise.resolve({ token: TOKEN }) } as never);

  it("hands over the token and redirects, with Secure on https and via x-forwarded-proto", async () => {
    const direct = await call(`https://openmor.example.com/approve/${TOKEN}`);
    expect(direct.headers.get("set-cookie")).toContain("Secure");
    const proxied = await call(`http://internal:3000/approve/${TOKEN}`, { "x-forwarded-proto": "https" });
    expect(proxied.headers.get("set-cookie")).toContain("Secure");
    const local = await call(`http://localhost:3000/approve/${TOKEN}`);
    expect(local.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("logs nothing", async () => {
    await call(`https://openmor.example.com/approve/${TOKEN}`);
    expect(logged).toEqual([]);
  });

  it("exports no way to approve by GET: the only handler is GET and it touches no data", async () => {
    // Simulate a scanner: open the emailed link, follow the redirect, load the page data, repeatedly.
    const t = setup();
    const email = fakeEmail();
    const deps = { ...t.deps, appUrl: "https://openmor.example.com", email };
    const merchantId = seedMerchant(t.db).id;
    seedProduct(t.db, merchantId);
    await createBuyerLink(deps, { merchantId, buyerEmail: "buyer@example.com", monthlyCap: { amountMinor: 5000, currency: "EUR" } });
    const token = tokenFromEmail(email.sent[0]!);
    const before = structuredClone(t.db.tables);
    for (let i = 0; i < 3; i++) {
      const res = await GET(new Request(`https://openmor.example.com/approve/${token}`), { params: Promise.resolve({ token }) } as never);
      expect(res.status).toBe(303);
      expect((await getApprovalView(deps, token)).kind).toBe("ready");
    }
    expect(t.db.tables).toEqual(before);
    expect(t.db.tables.buyerLink[0]!.status).toBe("pending_approval");
    expect(t.adapterFor).not.toHaveBeenCalled();
  });
});

describe("dev request logging", () => {
  it("keeps /approve/{token} requests out of the dev request log", () => {
    const ignore = (nextConfig.logging as { incomingRequests: { ignore: RegExp[] } }).incomingRequests.ignore;
    expect(ignore.some((re) => re.test(`http://localhost:3000/approve/${TOKEN}`))).toBe(true);
    expect(ignore.some((re) => re.test("http://localhost:3000/api/mcp"))).toBe(false);
  });
});

describe("messages", () => {
  it("has plain-words text for every outcome", () => {
    for (const m of Object.values(MESSAGES)) {
      expect(m.heading.length).toBeGreaterThan(3);
      expect(m.body.length).toBeGreaterThan(10);
    }
  });

  it("tells a buyer with no saved card to buy once first, and offers a way back", () => {
    expect(MESSAGES.no_saved_method.heading).toBe("Buy once with a normal checkout first, so a card is saved");
    expect(MESSAGES.no_saved_method.retry).toBe(true);
  });

  it("falls back to 'not valid' for unknown codes, including prototype names", () => {
    for (const code of [undefined, "", "nope", "toString", "__proto__", "constructor"]) expect(messageFor(code)).toBe(MESSAGES.invalid);
  });

  it("keeps the cookie only while the link can still be approved", () => {
    expect(isFinal("no_saved_method")).toBe(false);
    expect(isFinal("provider_unavailable")).toBe(false);
    for (const kind of ["approved", "declined", "invalid", "expired", "already_used"] as const) expect(isFinal(kind)).toBe(true);
  });
});
