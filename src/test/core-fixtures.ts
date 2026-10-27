// Shared setup for core tests: a FakeDb, a FakeAdapter, a controllable clock and deps.
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
    // Live by default: a test-mode merchant is hidden unless the deployment includes them. Tests of test mode override these.
    dodoEnvironment: "live_mode",
    liveModeEnabled: true,
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
