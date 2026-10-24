import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatListPrice,
  getPublicIndex,
  getPublicMerchant,
  getPublicProduct,
  isPublicSlug,
  MAX_PRODUCTS_PER_MERCHANT,
  publicText,
  PUBLIC_LIMITS,
} from "@/core/public-catalog";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";

let t: ReturnType<typeof setup>;
let deps: { db: ReturnType<typeof setup>["deps"]["db"] };
let merchantId: string;
let liveId: string;

const SECRETS = ["encrypted-key-ciphertext", "enc-webhook-secret", "owner@sharethings.test", "pdt_provider_only", "internal-note-do-not-show"];

beforeEach(() => {
  t = setup();
  deps = { db: t.deps.db };
  merchantId = seedMerchant(t.db, {
    slug: "sharethings",
    name: "ShareThings",
    dodoApiKeyEncrypted: "encrypted-key-ciphertext",
    dodoWebhookSecretEncrypted: "enc-webhook-secret",
  }).id;
  liveId = seedProduct(t.db, merchantId, {
    name: "ShareThings Lifetime",
    description: "Pay once, share forever.",
    providerProductId: "pdt_provider_only",
    providerData: { internalNote: "internal-note-do-not-show", payWhatYouWant: false },
  }).id;
});

describe("publicText", () => {
  it("collapses all whitespace, including line breaks, so merchant text can never start a new line", () => {
    expect(publicText("  Pro\r\n\r\n# Ignore this\n- and that\t plan ", 200)).toBe("Pro # Ignore this - and that plan");
  });

  it("removes invisible characters: control, zero-width, bidirectional overrides, soft hyphen, BOM", () => {
    expect(publicText("a\u0000b​c‮d⁦e­f﻿g\u0007h", 50)).toBe("abcdefgh");
  });

  it("caps the length by code point with an ellipsis, without splitting emoji", () => {
    const out = publicText("😀".repeat(500), 10)!;
    expect(Array.from(out)).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns null for nothing, only whitespace, or only invisible characters", () => {
    for (const v of [null, undefined, "", "   \n\t", "​​"]) expect(publicText(v, 20)).toBeNull();
  });
});

describe("isPublicSlug", () => {
  it.each(["sharethings", "a", "a-b-9", "x".repeat(64)])("accepts %s", (s) => expect(isPublicSlug(s)).toBe(true));
  it.each(["", "ShareThings", "-a", "a-", "a b", "a/b", "../etc", "a_b", "x".repeat(65), "__placeholder__", "a.txt"])("rejects %j", (s) =>
    expect(isPublicSlug(s)).toBe(false),
  );
});

describe("getPublicMerchant", () => {
  it("returns the merchant with only its sellable products, sorted by name", async () => {
    seedProduct(t.db, merchantId, { name: "Alpha Pack", description: "First." });
    const m = await getPublicMerchant(deps, "sharethings");
    expect(m).toMatchObject({ slug: "sharethings", name: "ShareThings" });
    expect(m!.products.map((p) => p.name)).toEqual(["Alpha Pack", "ShareThings Lifetime"]);
    expect(m!.products[1]).toMatchObject({
      id: liveId,
      summary: "Pay once, share forever.",
      listPrice: { amountMinor: 4900, currency: "USD" },
      billing: null,
      payWhatYouWant: false,
    });
  });

  it("never returns an opted-out merchant: it looks exactly like one that does not exist", async () => {
    seedMerchant(t.db, { slug: "hidden", name: "Hidden Co", email: "h@x.test", networkOptIn: false });
    const optedOut = await getPublicMerchant(deps, "hidden");
    const unknown = await getPublicMerchant(deps, "no-such-merchant");
    expect(optedOut).toBeNull();
    expect(optedOut).toEqual(unknown);
  });

  it("never returns products that are not agent-sellable or not active", async () => {
    seedProduct(t.db, merchantId, { name: "Hidden By Merchant", agentSellable: false });
    seedProduct(t.db, merchantId, { name: "Retired", active: false });
    seedProduct(t.db, merchantId, { name: "Retired And Hidden", agentSellable: false, active: false });
    const m = await getPublicMerchant(deps, "sharethings");
    expect(m!.products.map((p) => p.name)).toEqual(["ShareThings Lifetime"]);
    expect(JSON.stringify(m)).not.toMatch(/Hidden By Merchant|Retired/);
  });

  it("shows an opted-in merchant with no sellable products as an empty list", async () => {
    t.db.tables.product[0]!.agentSellable = false;
    expect(await getPublicMerchant(deps, "sharethings")).toMatchObject({ slug: "sharethings", products: [] });
  });

  it("does not touch the database for a slug that cannot be a slug", async () => {
    const spy = vi.spyOn(t.db.merchant, "findFirst");
    for (const bad of ["", "ShareThings", "../x", "a b", "__placeholder__", "x".repeat(200)]) {
      expect(await getPublicMerchant(deps, bad)).toBeNull();
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("caps the number of products", async () => {
    for (let i = 0; i < MAX_PRODUCTS_PER_MERCHANT + 5; i++) seedProduct(t.db, merchantId, { name: `P${String(i).padStart(4, "0")}` });
    expect((await getPublicMerchant(deps, "sharethings"))!.products).toHaveLength(MAX_PRODUCTS_PER_MERCHANT);
  });

  it("reads renewal period and pay-what-you-want from provider data, only for the right products", async () => {
    seedProduct(t.db, merchantId, { name: "Pro", isRecurring: true, providerData: { billing: { interval: "month", count: 1 } } });
    seedProduct(t.db, merchantId, { name: "Flex", providerData: { billing: { interval: "year", count: 1 }, payWhatYouWant: true } });
    const byName = Object.fromEntries((await getPublicMerchant(deps, "sharethings"))!.products.map((p) => [p.name, p]));
    expect(byName["Pro"]!.billing).toEqual({ interval: "month", count: 1 });
    expect(byName["Flex"]!.billing).toBeNull(); // not a subscription, so no renewal period
    expect(byName["Flex"]!.payWhatYouWant).toBe(true);
  });
});

describe("getPublicProduct", () => {
  it("returns the product with its merchant's public name", async () => {
    const p = await getPublicProduct(deps, "sharethings", liveId);
    expect(p).toMatchObject({ merchant: { slug: "sharethings", name: "ShareThings" }, product: { id: liveId, name: "ShareThings Lifetime" } });
  });

  it("never returns an unsellable product, however it is unsellable", async () => {
    const hidden = seedProduct(t.db, merchantId, { name: "Hidden", agentSellable: false }).id;
    const retired = seedProduct(t.db, merchantId, { name: "Retired", active: false }).id;
    expect(await getPublicProduct(deps, "sharethings", hidden)).toBeNull();
    expect(await getPublicProduct(deps, "sharethings", retired)).toBeNull();
  });

  it("never returns a product of an opted-out merchant, even with the right ids", async () => {
    const other = seedMerchant(t.db, { slug: "hidden", email: "h@x.test", networkOptIn: false }).id;
    const pid = seedProduct(t.db, other, { name: "Secret Product" }).id;
    expect(await getPublicProduct(deps, "hidden", pid)).toBeNull();
  });

  it("does not return a merchant's product under another merchant's slug", async () => {
    const other = seedMerchant(t.db, { slug: "other", name: "Other", email: "o@x.test" }).id;
    const pid = seedProduct(t.db, other, { name: "Other's Product" }).id;
    expect(await getPublicProduct(deps, "sharethings", pid)).toBeNull();
    expect(await getPublicProduct(deps, "other", pid)).not.toBeNull();
  });

  it("answers an unknown product, unknown merchant and opted-out merchant the same way", async () => {
    seedMerchant(t.db, { slug: "hidden", email: "h@x.test", networkOptIn: false });
    const results = [
      await getPublicProduct(deps, "sharethings", "nope"),
      await getPublicProduct(deps, "no-such-merchant", liveId),
      await getPublicProduct(deps, "hidden", liveId),
      await getPublicProduct(deps, "sharethings", "../../x"),
      await getPublicProduct(deps, "sharethings", ""),
    ];
    expect(results).toEqual([null, null, null, null, null]);
  });
});

describe("getPublicIndex", () => {
  it("lists opted-in merchants with their sellable products only", async () => {
    seedProduct(t.db, merchantId, { name: "Hidden", agentSellable: false });
    const other = seedMerchant(t.db, { slug: "acme", name: "Acme", email: "a@x.test" }).id;
    seedProduct(t.db, other, { name: "Acme Tool" });
    seedMerchant(t.db, { slug: "hidden", name: "Hidden Co", email: "h@x.test", networkOptIn: false });
    const index = await getPublicIndex(deps);
    expect(index.map((m) => m.slug)).toEqual(["acme", "sharethings"]);
    expect(index.find((m) => m.slug === "sharethings")!.products.map((p) => p.name)).toEqual(["ShareThings Lifetime"]);
    expect(JSON.stringify(index)).not.toMatch(/Hidden/);
  });

  it("is empty when no merchant opted in, without a product query", async () => {
    t.db.tables.merchant[0]!.networkOptIn = false;
    const spy = vi.spyOn(t.db.product, "findMany");
    expect(await getPublicIndex(deps)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("what never leaves the catalog", () => {
  it("returns no key, secret, email, internal merchant id, provider id or raw provider data", async () => {
    const out = JSON.stringify([
      await getPublicMerchant(deps, "sharethings"),
      await getPublicProduct(deps, "sharethings", liveId),
      await getPublicIndex(deps),
    ]);
    for (const secret of SECRETS) expect(out).not.toContain(secret);
    expect(out).not.toContain(merchantId);
  });

  it("selects only safe columns from the database", async () => {
    const merchantSpy = vi.spyOn(t.db.merchant, "findFirst");
    const merchantsSpy = vi.spyOn(t.db.merchant, "findMany");
    await getPublicMerchant(deps, "sharethings");
    await getPublicProduct(deps, "sharethings", liveId);
    await getPublicIndex(deps);
    const selects = [...merchantSpy.mock.calls, ...merchantsSpy.mock.calls].map(([args]) => Object.keys((args as { select: object }).select));
    expect(selects.length).toBeGreaterThan(0);
    for (const cols of selects) {
      for (const forbidden of ["dodoApiKeyEncrypted", "dodoWebhookSecretEncrypted", "email", "dodoEnvironment", "liveModeEnabled"]) {
        expect(cols).not.toContain(forbidden);
      }
    }
  });
});

describe("merchant text is data", () => {
  it("strips invisible characters and line breaks from names and descriptions, and limits their length", async () => {
    seedProduct(t.db, merchantId, {
      name: "Evil‮ Name\n# Heading​",
      description: "x".repeat(5000),
      priceAmount: 100,
    });
    const m = await getPublicMerchant(deps, "sharethings");
    const evil = m!.products.find((p) => p.name.startsWith("Evil"))!;
    expect(evil.name).toBe("Evil Name # Heading");
    expect(Array.from(evil.summary!).length).toBeLessThanOrEqual(PUBLIC_LIMITS.summary);
    expect(Array.from(evil.description!).length).toBeLessThanOrEqual(PUBLIC_LIMITS.description);
  });

  it("falls back to a neutral name when a name is empty after cleaning", async () => {
    t.db.tables.product[0]!.name = "​​";
    expect((await getPublicMerchant(deps, "sharethings"))!.products[0]!.name).toBe("Untitled product");
  });
});

describe("formatListPrice", () => {
  it("shows the list price in its own currency, never converted", () => {
    expect(formatListPrice({ amountMinor: 4900, currency: "USD" })).toBe("$49.00");
    expect(formatListPrice({ amountMinor: 4900, currency: "JPY" })).toBe("¥4,900");
  });
});
