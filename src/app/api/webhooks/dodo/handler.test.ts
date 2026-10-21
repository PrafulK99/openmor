import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/core/checkout";
import { createQuote } from "@/core/quotes";
import type { WebhookEvent } from "@/core/types";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { payment, signedWebhook } from "@/test/fake-adapter";
import { handleDodoWebhook } from "./handler";

let t: ReturnType<typeof setup>;
let merchantId: string;
let orderId: string;
const logged: string[] = [];

function request(e: WebhookEvent, signature = "valid"): Request {
  const { headers, rawBody } = signedWebhook(e, signature);
  return new Request("http://localhost/api/webhooks/dodo/x", { method: "POST", headers, body: rawBody });
}

const paid = (id = "msg_1"): WebhookEvent => ({
  id,
  type: "payment.succeeded",
  occurredAt: "2026-10-21T12:05:00Z",
  payment: payment({ metadata: { openmor_order_id: orderId }, customerId: "cus_SECRET_BODY_MARKER" }),
});

beforeEach(async () => {
  logged.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(JSON.stringify(a)));
  }
  t = setup();
  merchantId = seedMerchant(t.db).id;
  const productId = seedProduct(t.db, merchantId).id;
  const quote = await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer: { country: "DE" } });
  orderId = (await createCheckout({ ...t.deps, appUrl: "http://x" }, { quoteId: quote.id, buyerEmail: "b@x.test" })).order.id;
});

afterEach(() => vi.restoreAllMocks());

describe("handleDodoWebhook", () => {
  it("answers 200 and marks the order paid", async () => {
    const res = await handleDodoWebhook(t.deps, request(paid()), merchantId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "processed" });
    expect(t.db.tables.order[0]!.status).toBe("paid");
  });

  it("answers 200 for a duplicate so Dodo stops retrying", async () => {
    await handleDodoWebhook(t.deps, request(paid()), merchantId);
    const res = await handleDodoWebhook(t.deps, request(paid()), merchantId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "duplicate" });
  });

  it("rejects a bad signature with 401 and never logs the body", async () => {
    const res = await handleDodoWebhook(t.deps, request(paid(), "forged"), merchantId);
    expect(res.status).toBe(401);
    expect(t.db.tables.order[0]!.status).toBe("pending_payment");
    expect(logged.join("\n")).not.toContain("cus_SECRET_BODY_MARKER");
  });

  it("answers 404 for an unknown merchant", async () => {
    expect((await handleDodoWebhook(t.deps, request(paid()), "nope")).status).toBe(404);
  });

  it("answers 500 on a processing failure so Dodo retries, logging no body or message", async () => {
    t.db.order.updateMany = async () => {
      throw new Error("db password=hunter2");
    };
    const res = await handleDodoWebhook(t.deps, request(paid()), merchantId);
    expect(res.status).toBe(500);
    const logs = logged.join("\n");
    expect(logs).not.toContain("cus_SECRET_BODY_MARKER");
    expect(logs).not.toContain("hunter2");
  });

  it("refuses oversized bodies", async () => {
    const big = new Request("http://localhost/x", { method: "POST", body: "x".repeat(1024 * 1024 + 1) });
    expect((await handleDodoWebhook(t.deps, big, merchantId)).status).toBe(413);
  });
});
