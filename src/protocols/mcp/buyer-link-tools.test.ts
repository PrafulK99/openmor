import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { fakeEmail, tokenFromEmail, type FakeEmail } from "@/test/fake-email";
import type { ToolEnv } from "./tool";
import { linkBuyerTool } from "./tools/link-buyer";

let t: ReturnType<typeof setup>;
let env: ToolEnv;
let email: FakeEmail;
let merchantId: string;
let productId: string;
const logged: string[] = [];

const text = (r: CallToolResult) => (r.content[0] as { type: "text"; text: string }).text;
const data = (r: CallToolResult) => r.structuredContent as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  logged.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(JSON.stringify(a)));
  }
  t = setup();
  email = fakeEmail();
  env = { deps: { ...t.deps, appUrl: "https://openmor.example.com", email }, agentSessionId: "ags_1" };
  merchantId = seedMerchant(t.db).id;
  productId = seedProduct(t.db, merchantId).id;
});
afterEach(() => vi.restoreAllMocks());

const args = (extra: Record<string, unknown> = {}) => ({
  merchant_id: merchantId,
  buyer_email: "buyer@example.com",
  monthly_cap: { amount: 5000, currency: "EUR" },
  ...extra,
});

describe("link_buyer", () => {
  it("creates a pending link, emails the buyer, and says to check their email", async () => {
    const r = await linkBuyerTool.handler(args({ per_order_cap: { amount: 2000, currency: "EUR" }, product_ids: [productId], expires_in_days: 60 }), env);
    expect(r.isError).toBeUndefined();
    expect(text(r)).toMatch(/^Check your email to approve\./);
    expect(data(r)).toMatchObject({
      buyer_link_id: t.db.tables.buyerLink[0]!.id,
      status: "pending_approval",
      merchant_id: merchantId,
      monthly_cap: { amount_minor: 5000, currency: "EUR", formatted: "€50.00" },
      per_order_cap: { amount_minor: 2000, currency: "EUR", formatted: "€20.00" },
      product_ids: [productId],
    });
    expect(t.db.tables.buyerLink[0]).toMatchObject({ agentSessionId: "ags_1", status: "pending_approval" });
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it("has no per-order cap or scope when none was given", async () => {
    const r = await linkBuyerTool.handler(args(), env);
    expect(data(r)).toMatchObject({ per_order_cap: null, product_ids: null });
  });

  it("never puts the approval token, a provider id or the buyer's address in tool output or logs", async () => {
    const r = await linkBuyerTool.handler(args(), env);
    const token = tokenFromEmail(email.sent[0]!);
    const out = JSON.stringify(r);
    expect(out).not.toContain(token);
    expect(out).not.toContain("approve/");
    expect(out).not.toContain(t.db.tables.buyerLink[0]!.approvalTokenHash as string);
    expect(logged.join("\n")).not.toContain(token);
  });

  it("returns INVALID_INPUT naming the bad argument", async () => {
    const r = await linkBuyerTool.handler(args({ monthly_cap: { amount: 0, currency: "EUR" } }), env);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^INVALID_INPUT: monthly_cap\.amount must be a whole number/);
    expect((await linkBuyerTool.handler(args({ expires_in_days: 91 }), env)).isError).toBe(true);
  });

  it("returns MERCHANT_NOT_FOUND for an unknown merchant", async () => {
    const r = await linkBuyerTool.handler(args({ merchant_id: "nope" }), env);
    expect(data(r).error.code).toBe("MERCHANT_NOT_FOUND");
  });

  it("returns PROVIDER_ERROR with a retry hint when email cannot be sent, and leaves no link", async () => {
    email.send.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "EmailSendError", status: 500, errorName: "internal" }));
    const r = await linkBuyerTool.handler(args(), env);
    expect(r.isError).toBe(true);
    expect(t.db.tables.buyerLink).toHaveLength(0);
    // Unknown errors are never passed through to the agent.
    expect(data(r).error.code).toBe("INTERNAL_ERROR");
    expect(text(r)).not.toContain("buyer@example.com");
  });

  it("is described for agents: asks for the buyer's limits and warns it sends email", () => {
    expect(linkBuyerTool.description).toMatch(/Never choose the monthly cap/);
    expect(linkBuyerTool.description).toMatch(/sends a real email each time/);
    expect(linkBuyerTool.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false });
  });
});
