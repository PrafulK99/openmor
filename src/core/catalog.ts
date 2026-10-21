import { nowFrom, type CoreDeps } from "@/core/deps";
import { loadMerchantWithConfig } from "@/core/merchants";
import { limitText, TEXT_LIMITS } from "@/core/text";
import type { Product as ProviderProduct } from "@/core/types";

const UNNAMED = "Untitled product";

export interface CatalogProduct {
  id: string;
  providerProductId: string;
  name: string;
  description: string | null;
  priceAmount: number;
  currency: string;
  isRecurring: boolean;
  agentSellable: boolean;
  active: boolean;
}

export interface SyncResult {
  created: number;
  updated: number;
  /** Products that vanished at the provider (or lost their price) and were marked inactive. */
  deactivated: number;
  /** New provider products not stored because they have no price; listed by provider id. */
  skipped: string[];
  products: CatalogProduct[];
}

const catalogSelect = {
  id: true,
  providerProductId: true,
  name: true,
  description: true,
  priceAmount: true,
  currency: true,
  isRecurring: true,
  agentSellable: true,
  active: true,
} as const;

type Priced = ProviderProduct & { price: number; currency: string };

function hasPrice(p: ProviderProduct): p is Priced {
  return p.price !== null && p.currency !== null;
}

function productFields(p: Priced) {
  return {
    name: limitText(p.name, TEXT_LIMITS.name) ?? UNNAMED,
    description: limitText(p.description, TEXT_LIMITS.description),
    priceAmount: p.price,
    currency: p.currency.toUpperCase(),
    isRecurring: p.kind === "subscription",
    // Our normalized view of the provider product, for later fulfillment mapping. Not exposed to agents.
    providerData: JSON.parse(JSON.stringify(p)),
  };
}

/**
 * Pull the merchant's catalog from the provider and upsert it into Product.
 * New products start not agent-sellable. Products missing at the provider become
 * inactive and are never deleted; a product that comes back is reactivated.
 */
export async function syncCatalog(deps: CoreDeps, merchantId: string): Promise<SyncResult> {
  const merchant = await loadMerchantWithConfig(deps, merchantId);
  const remote = await deps.adapterFor(merchant).listProducts();
  const syncedAt = nowFrom(deps);

  const existing = await deps.db.product.findMany({
    where: { merchantId },
    select: { providerProductId: true },
  });
  const known = new Set(existing.map((p) => p.providerProductId));

  let created = 0;
  let updated = 0;
  const skipped: string[] = [];
  const seen: string[] = [];

  for (const p of remote) {
    if (!hasPrice(p)) {
      // Without a price we cannot store or sell it. If we had it before, it is deactivated below.
      if (!known.has(p.id)) skipped.push(p.id);
      continue;
    }
    const fields = productFields(p);
    await deps.db.product.upsert({
      where: { merchantId_providerProductId: { merchantId, providerProductId: p.id } },
      create: { merchantId, providerProductId: p.id, ...fields, agentSellable: false, active: true, syncedAt },
      update: { ...fields, active: true, syncedAt },
    });
    seen.push(p.id);
    if (known.has(p.id)) updated++;
    else created++;
  }

  // Only runs after every upsert succeeded, so a failed sync never deactivates products.
  const { count: deactivated } = await deps.db.product.updateMany({
    where: { merchantId, active: true, providerProductId: { notIn: seen } },
    data: { active: false, syncedAt },
  });

  const products = await deps.db.product.findMany({
    where: { merchantId },
    select: catalogSelect,
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return { created, updated, deactivated, skipped, products };
}

/**
 * Choose which products agents may sell. `productIds` are OpenMoR product ids.
 * Returns how many products changed; ids from another merchant are ignored.
 */
export async function setAgentSellable(
  deps: CoreDeps,
  merchantId: string,
  productIds: string[] | "all",
  sellable: boolean,
): Promise<number> {
  await loadMerchantWithConfig(deps, merchantId);
  const { count } = await deps.db.product.updateMany({
    where: { merchantId, ...(productIds === "all" ? {} : { id: { in: productIds } }) },
    data: { agentSellable: sellable },
  });
  return count;
}

export async function listCatalog(deps: CoreDeps, merchantId: string): Promise<CatalogProduct[]> {
  return deps.db.product.findMany({
    where: { merchantId },
    select: catalogSelect,
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}
