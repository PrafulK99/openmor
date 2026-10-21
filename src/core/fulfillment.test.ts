import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/core/checkout";
import { getOrderFulfillment } from "@/core/fulfillment";
import { getOrder } from "@/core/orders";
import { createQuote } from "@/core/quotes";
import { handleWebhook } from "@/core/webhooks";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { FAKE_LICENSE_KEY, payment, signedWebhook } from "@/test/fake-adapter";

let t: ReturnType<typeof setup>;
let merchantId: string;
let orderId: string;
const logged: string[] = [];

beforeEach(async () => {
  logged.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  t = setup();
  merchantId = seedMerchant(t.db).id;
  const productId = seedProduct(t.db, merchantId).id;
  const quote = await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer: { country: "DE" } });
  orderId = (await createCheckout({ ...t.deps, appUrl: "http://x" }, { quoteId: quote.id, buyerEmail: "b@x.test" })).order.id;
});

afterEach(() => vi.restoreAllMocks());

async function pay() {
  await handleWebhook(t.deps, {
    merchantId,
    ...signedWebhook({
      id: "msg_1",
      type: "payment.succeeded",
      occurredAt: "2026-10-21T12:05:00Z",
      payment: payment({ metadata: { openmor_order_id: orderId } }),
    }),
  });
}

describe("getOrderFulfillment", () => {
  it("returns nothing before the order is paid, without calling the provider", async () => {
    expect(await getOrderFulfillment(t.deps, orderId)).toBeNull();
    expect(t.adapter.getFulfillment).not.toHaveBeenCalled();
  });

  it("fetches the licence key live from the provider once paid", async () => {
    await pay();
    const f = await getOrderFulfillment(t.deps, orderId);
    expect(t.adapter.getFulfillment).toHaveBeenCalledWith("pay_1");
    expect(f!.licenseKeys[0]!.key).toBe(FAKE_LICENSE_KEY);
  });

  it("never stores the licence key or portal link in the database, and never logs them", async () => {
    await pay();
    await getOrderFulfillment(t.deps, orderId);
    await getOrderFulfillment(t.deps, orderId);
    await getOrder(t.deps, orderId);

    const db = JSON.stringify(t.db.tables);
    expect(db).not.toContain(FAKE_LICENSE_KEY);
    expect(db).not.toContain("portal_secret");
    // Only non-secret references are kept on the order.
    expect(t.db.tables.order[0]!.fulfillment).toEqual({ provider: "dodo", customerId: "cus_1", subscriptionId: null });

    const logs = logged.join("\n");
    expect(logs).not.toContain(FAKE_LICENSE_KEY);
    expect(logs).not.toContain("portal_secret");
  });

  it("rejects an unknown order", async () => {
    await expect(getOrderFulfillment(t.deps, "nope")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
