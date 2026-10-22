// Shared setup for core tests: a FakeDb, a FakeAdapter, a controllable clock and deps.
import { createHash } from "node:crypto";
import { vi } from "vitest";
import type { AdapterFor, CoreDeps } from "@/core/deps";
import { encrypt } from "@/lib/crypto";
import { FakeAdapter } from "./fake-adapter";
import { FakeDb } from "./fake-db";
import { TEST_ENCRYPTION_KEY } from "./keys";

export function setup(start = new Date("2026-10-21T12:00:00Z")) {
  let current = start;
  const clock = {
    now: () => current,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
  const db = new FakeDb(clock.now);
  const adapter = new FakeAdapter();
  const adapterFor = vi.fn<AdapterFor>(() => adapter);
  const deps: CoreDeps = { db: db.asPrisma(), adapterFor, now: clock.now };
  return { db, adapter, adapterFor, deps, clock };
}

export function seedMerchant(db: FakeDb, overrides: Record<string, unknown> = {}) {
  return db.insert("merchant", {
    name: "ShareThings",
    slug: "sharethings",
    email: "owner@sharethings.test",
    dodoApiKeyEncrypted: encrypt("dodo_test_sk_seed", TEST_ENCRYPTION_KEY),
    networkOptIn: true,
    ...overrides,
  }) as { id: string };
}

export function seedProduct(db: FakeDb, merchantId: string, overrides: Record<string, unknown> = {}) {
  return db.insert("product", {
    merchantId,
    providerProductId: `pdt_${Math.random().toString(36).slice(2, 8)}`,
    name: "ShareThings Lifetime",
    description: "Pay once, share forever.",
    priceAmount: 4900,
    currency: "USD",
    isRecurring: false,
    agentSellable: true,
    active: true,
    ...overrides,
  }) as { id: string; providerProductId: string };
}

let linkSeq = 0;

/** An active buyer link with a saved card on file. Caps are in EUR; override anything. */
export function seedBuyerLink(db: FakeDb, merchantId: string, overrides: Record<string, unknown> = {}) {
  const n = ++linkSeq;
  return db.insert("buyerLink", {
    merchantId,
    buyerEmail: "buyer@example.com",
    status: "active",
    approvalTokenHash: createHash("sha256").update(`seed-token-${n}`).digest("hex"),
    approvalExpiresAt: new Date("2026-10-21T12:30:00Z"),
    approvedAt: new Date("2026-10-21T12:10:00Z"),
    expiresAt: new Date("2026-12-31T00:00:00Z"),
    currency: "EUR",
    monthlyCapAmount: 10_000,
    providerCustomerId: "cus_1",
    providerPaymentMethodId: "pm_1",
    ...overrides,
  }) as {
    id: string;
    merchantId: string;
    currency: string;
    monthlyCapAmount: number;
  };
}
