import { beforeEach, describe, expect, it } from "vitest";
import { InvalidInputError } from "@/core/errors";
import { createQuote, getQuote, QUOTE_TTL_MS } from "@/core/quotes";
import { providerQuote } from "@/test/fake-adapter";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";

let t: ReturnType<typeof setup>;
let merchantId: string;
let productId: string;
let providerProductId: string;

beforeEach(() => {
  t = setup();
  merchantId = seedMerchant(t.db).id;
  ({ id: productId, providerProductId } = seedProduct(t.db, merchantId));
});

const buyer = { country: "de" };

describe("createQuote", () => {
  it("quotes via the adapter and stores all amounts with a 15 minute expiry", async () => {
    const q = await createQuote(t.deps, { merchantId, productId, quantity: 2, buyer: { ...buyer, zip: " 10115 " } });

    expect(t.adapter.quote).toHaveBeenCalledWith({
      items: [{ productId: providerProductId, quantity: 2 }],
      country: "DE",
      zip: "10115",
    });
    expect(q).toMatchObject({
      merchantId,
      productId,
      quantity: 2,
      country: "DE",
      currency: "EUR",
      subtotal: 801,
      discount: 0,
      tax: 152,
      total: 954,
      isBinding: true,
      status: "open",
      recurring: null,
      taxRateBps: 1900,
      // Seeded product is listed in USD, the fake preview is in EUR.
      isConverted: true,
    });
    expect(q.expiresAt.getTime() - t.clock.now().getTime()).toBe(QUOTE_TTL_MS);
    expect(t.db.tables.quote).toHaveLength(1);
    expect(t.db.tables.quote[0]).toMatchObject({ totalAmount: 954, taxAmount: 152, subtotalAmount: 801 });
  });

  it("stores the recurring breakup and a non-binding flag", async () => {
    t.adapter.quote.mockResolvedValueOnce(
      providerQuote({ isBinding: false, recurring: { subtotal: 445, discount: 0, tax: 85, total: 530 } }),
    );
    const q = await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer });
    expect(q.isBinding).toBe(false);
    expect(q.recurring).toEqual({ subtotal: 445, discount: 0, tax: 85, total: 530 });
  });

  it("attaches the agent session id when given", async () => {
    const q = await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer, agentSessionId: "ags_1" });
    expect(q.agentSessionId).toBe("ags_1");
    expect(t.db.tables.quote[0]!.agentSessionId).toBe("ags_1");
  });

  it("marks a same-currency quote as not converted", async () => {
    t.adapter.quote.mockResolvedValueOnce(providerQuote({ currency: "USD" }));
    const q = await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer: { country: "US" } });
    expect(q.isConverted).toBe(false);
  });

  it("stores a null tax rate when the provider returns no line items", async () => {
    t.adapter.quote.mockResolvedValueOnce(providerQuote({ items: [] }));
    const q = await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer });
    expect(q.taxRateBps).toBeNull();
  });

  it("refuses a product that is not agent-sellable", async () => {
    const draft = seedProduct(t.db, merchantId, { agentSellable: false });
    await expect(
      createQuote(t.deps, { merchantId, productId: draft.id, quantity: 1, buyer }),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
    expect(t.adapter.quote).not.toHaveBeenCalled();
  });

  it("refuses an inactive product", async () => {
    const gone = seedProduct(t.db, merchantId, { active: false });
    await expect(
      createQuote(t.deps, { merchantId, productId: gone.id, quantity: 1, buyer }),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
  });

  it("refuses a product that belongs to another merchant", async () => {
    const other = seedMerchant(t.db, { slug: "other", email: "o@x.test" });
    await expect(
      createQuote(t.deps, { merchantId: other.id, productId, quantity: 1, buyer }),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
  });

  it("refuses unknown and non-opted-in merchants with MERCHANT_NOT_FOUND", async () => {
    await expect(
      createQuote(t.deps, { merchantId: "missing", productId, quantity: 1, buyer }),
    ).rejects.toMatchObject({ code: "MERCHANT_NOT_FOUND" });
    const hidden = seedMerchant(t.db, { slug: "hidden", email: "h@x.test", networkOptIn: false });
    const p = seedProduct(t.db, hidden.id);
    await expect(
      createQuote(t.deps, { merchantId: hidden.id, productId: p.id, quantity: 1, buyer }),
    ).rejects.toMatchObject({ code: "MERCHANT_NOT_FOUND" });
  });

  it("rejects bad quantity and country", async () => {
    await expect(createQuote(t.deps, { merchantId, productId, quantity: 0, buyer })).rejects.toThrow(InvalidInputError);
    await expect(createQuote(t.deps, { merchantId, productId, quantity: 1.5, buyer })).rejects.toThrow(InvalidInputError);
    await expect(
      createQuote(t.deps, { merchantId, productId, quantity: 1, buyer: { country: "Germany" } }),
    ).rejects.toThrow(InvalidInputError);
    await expect(createQuote(t.deps, { merchantId, productId, quantity: 0, buyer })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("getQuote", () => {
  it("returns an open quote before expiry", async () => {
    const q = await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer });
    t.clock.advance(QUOTE_TTL_MS - 1);
    expect((await getQuote(t.deps, q.id))!.status).toBe("open");
  });

  it("marks the quote expired once past expiresAt, and persists it", async () => {
    const q = await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer });
    t.clock.advance(QUOTE_TTL_MS);
    expect((await getQuote(t.deps, q.id))!.status).toBe("expired");
    expect(t.db.tables.quote[0]!.status).toBe("expired");
  });

  it("does not expire a quote that was already used", async () => {
    const q = await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer });
    t.db.tables.quote[0]!.status = "used";
    t.clock.advance(QUOTE_TTL_MS * 2);
    expect((await getQuote(t.deps, q.id))!.status).toBe("used");
  });

  it("returns null for an unknown quote", async () => {
    expect(await getQuote(t.deps, "nope")).toBeNull();
  });
});

describe("quote ids", () => {
  it("are random UUIDs, one per quote", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      ids.add((await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer })).id);
    }
    expect(ids.size).toBe(5);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("keep working for quotes that were stored with an old-style id", async () => {
    const q = await createQuote(t.deps, { merchantId, productId, quantity: 1, buyer });
    const legacyId = "cm0legacyquoteid0000000001";
    t.db.tables.quote.find((row) => row.id === q.id)!.id = legacyId;
    expect(await getQuote(t.deps, q.id)).toBeNull();
    expect(await getQuote(t.deps, legacyId)).toMatchObject({ id: legacyId, merchantId, productId });
  });
});
