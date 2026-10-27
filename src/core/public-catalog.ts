// Read-only views of the public catalog, for the agent-readable pages (/m/..., llms.txt, sitemap).
//
// What is public: merchants that opted in to the network and are visible (live mode, or test mode when
// the deployment includes test merchants: see visibility.ts), and their products that are marked
// agent-sellable and still active. Nothing else is ever returned, whether it exists or not.
// What is never returned: merchant keys or ids, provider ids, buyer data, raw provider data.
// Everything here is read from our own database (filled by catalog sync); no provider is called.
import type { CoreDeps } from "@/core/deps";
import { formatMoney } from "@/core/money";
import { parseProductExtras } from "@/core/products";
import { limitText } from "@/core/text";
import type { BillingPeriod } from "@/core/types";
import { isTestMerchant, merchantModeSelect, visibleMerchantWhere } from "@/core/visibility";

export type PublicDeps = Pick<CoreDeps, "db" | "includeTestMerchants">;

/** Length limits for merchant-written text on public pages. It is data, so it is capped. */
export const PUBLIC_LIMITS = { merchantName: 100, productName: 120, summary: 240, description: 800 } as const;

/** Safety caps so one huge catalog cannot make a page, llms.txt or the sitemap unbounded. */
export const MAX_PUBLIC_MERCHANTS = 1000;
export const MAX_PRODUCTS_PER_MERCHANT = 500;

// Same shape core accepts when a merchant is created (see merchants.ts). Anything else cannot be a slug.
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Control characters, zero-width characters and bidirectional overrides: invisible, so they can hide
// text from a reader or reorder it. Removed from every public string.
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/**
 * Merchant text made safe to publish: invisible characters removed, every run of whitespace
 * (including line breaks) collapsed to one space, and the length capped. Null when nothing is left.
 * Collapsing line breaks matters: merchant text can never start a new line in llms.txt.
 */
export function publicText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  return limitText(value.replace(INVISIBLE, "").replace(/\s+/g, " "), max);
}

export function isPublicProductId(value: string): boolean {
  return PRODUCT_ID_PATTERN.test(value);
}

export function isPublicSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

export interface PublicProduct {
  /** The public product id: the same id agents pass as product_id to get_quote. */
  id: string;
  name: string;
  /** First part of the description, for lists. */
  summary: string | null;
  description: string | null;
  /** List price before tax and before any currency conversion. Not what a buyer pays. */
  listPrice: { amountMinor: number; currency: string };
  /** Set for subscriptions: how often the price renews. */
  billing: BillingPeriod | null;
  /** True when the list price is only a minimum. */
  payWhatYouWant: boolean;
  /** When the catalog sync last refreshed this product (ISO 8601). */
  updatedAt: string;
}

export interface PublicMerchant {
  slug: string;
  name: string;
  /** The merchant is in test mode. Only possible when the deployment includes test merchants. */
  isTest: boolean;
  products: PublicProduct[];
  updatedAt: string;
}

export interface PublicProductPage {
  merchant: { slug: string; name: string; isTest: boolean };
  product: PublicProduct;
}

export interface PublicIndexMerchant {
  slug: string;
  name: string;
  isTest: boolean;
  products: { id: string; name: string; updatedAt: string }[];
  updatedAt: string;
}

const productSelect = {
  id: true,
  name: true,
  description: true,
  priceAmount: true,
  currency: true,
  isRecurring: true,
  providerData: true,
  syncedAt: true,
} as const;

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  priceAmount: number;
  currency: string;
  isRecurring: boolean;
  providerData: unknown;
  syncedAt: Date;
};

function toPublicProduct(p: ProductRow): PublicProduct {
  const extras = parseProductExtras(p.providerData);
  return {
    id: p.id,
    name: publicText(p.name, PUBLIC_LIMITS.productName) ?? "Untitled product",
    summary: publicText(p.description, PUBLIC_LIMITS.summary),
    description: publicText(p.description, PUBLIC_LIMITS.description),
    listPrice: { amountMinor: p.priceAmount, currency: p.currency.toUpperCase() },
    billing: p.isRecurring ? (extras.billing ?? null) : null,
    payWhatYouWant: extras.payWhatYouWant ?? false,
    updatedAt: p.syncedAt.toISOString(),
  };
}

/** A merchant is public only if it opted in. Unknown, malformed and opted-out slugs are indistinguishable (null). */
async function findPublicMerchant(deps: PublicDeps, slug: string) {
  if (!isPublicSlug(slug)) return null;
  return deps.db.merchant.findFirst({
    where: { slug, ...visibleMerchantWhere(deps) },
    // Safe columns only: never the encrypted key, webhook secret or email. The mode flags are read only to derive isTest.
    select: { id: true, slug: true, name: true, updatedAt: true, ...merchantModeSelect },
  });
}

/** A merchant page: only opted-in merchants, only their sellable products. Null otherwise. */
export async function getPublicMerchant(deps: PublicDeps, slug: string): Promise<PublicMerchant | null> {
  const merchant = await findPublicMerchant(deps, slug);
  if (!merchant) return null;
  const rows = await deps.db.product.findMany({
    where: { merchantId: merchant.id, agentSellable: true, active: true },
    select: productSelect,
    orderBy: { name: "asc" },
    take: MAX_PRODUCTS_PER_MERCHANT,
  });
  const products = rows.map(toPublicProduct);
  const latest = products.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), merchant.updatedAt.toISOString());
  return { slug: merchant.slug, name: publicText(merchant.name, PUBLIC_LIMITS.merchantName) ?? merchant.slug, isTest: isTestMerchant(merchant), products, updatedAt: latest };
}

/** A product page. Null unless the merchant is public AND this product is that merchant's sellable product. */
export async function getPublicProduct(deps: PublicDeps, slug: string, productId: string): Promise<PublicProductPage | null> {
  if (!PRODUCT_ID_PATTERN.test(productId)) return null;
  const merchant = await findPublicMerchant(deps, slug);
  if (!merchant) return null;
  const row = await deps.db.product.findFirst({
    where: { id: productId, merchantId: merchant.id, agentSellable: true, active: true },
    select: productSelect,
  });
  if (!row) return null;
  return {
    merchant: { slug: merchant.slug, name: publicText(merchant.name, PUBLIC_LIMITS.merchantName) ?? merchant.slug, isTest: isTestMerchant(merchant) },
    product: toPublicProduct(row),
  };
}

/** Everything public, in one light read: for the network llms.txt, the sitemap and static params. */
export async function getPublicIndex(deps: PublicDeps): Promise<PublicIndexMerchant[]> {
  const merchants = await deps.db.merchant.findMany({
    where: visibleMerchantWhere(deps),
    select: { id: true, slug: true, name: true, updatedAt: true, ...merchantModeSelect },
    orderBy: { name: "asc" },
    take: MAX_PUBLIC_MERCHANTS,
  });
  if (merchants.length === 0) return [];
  const rows = await deps.db.product.findMany({
    where: { merchantId: { in: merchants.map((m) => m.id) }, agentSellable: true, active: true },
    select: { id: true, merchantId: true, name: true, syncedAt: true },
    orderBy: { name: "asc" },
  });
  return merchants.map((m) => {
    const products = rows
      .filter((r) => r.merchantId === m.id)
      .slice(0, MAX_PRODUCTS_PER_MERCHANT)
      .map((r) => ({ id: r.id, name: publicText(r.name, PUBLIC_LIMITS.productName) ?? "Untitled product", updatedAt: r.syncedAt.toISOString() }));
    const latest = products.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), m.updatedAt.toISOString());
    return { slug: m.slug, name: publicText(m.name, PUBLIC_LIMITS.merchantName) ?? m.slug, isTest: isTestMerchant(m), products, updatedAt: latest };
  });
}

/** Most products one UCP catalog read returns: the catalog is searched in memory, so it is capped. */
export const MAX_CATALOG_PRODUCTS = 5000;

/**
 * Every public merchant with its sellable products, in one read: for the UCP catalog, which searches
 * the whole network. Same visibility rules as the pages (opted-in merchants, agent-sellable active
 * products), safe columns only, capped at MAX_CATALOG_PRODUCTS.
 */
export async function getPublicCatalog(deps: PublicDeps): Promise<PublicMerchant[]> {
  const merchants = await deps.db.merchant.findMany({
    where: visibleMerchantWhere(deps),
    select: { id: true, slug: true, name: true, updatedAt: true, ...merchantModeSelect },
    orderBy: { name: "asc" },
    take: MAX_PUBLIC_MERCHANTS,
  });
  if (merchants.length === 0) return [];
  const rows = await deps.db.product.findMany({
    where: { merchantId: { in: merchants.map((m) => m.id) }, agentSellable: true, active: true },
    select: { ...productSelect, merchantId: true },
    orderBy: { name: "asc" },
    take: MAX_CATALOG_PRODUCTS,
  });
  return merchants
    .filter((m) => isPublicSlug(m.slug))
    .map((m) => {
      const products = rows.filter((r) => r.merchantId === m.id).slice(0, MAX_PRODUCTS_PER_MERCHANT).map(toPublicProduct);
      const latest = products.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), m.updatedAt.toISOString());
      return { slug: m.slug, name: publicText(m.name, PUBLIC_LIMITS.merchantName) ?? m.slug, isTest: isTestMerchant(m), products, updatedAt: latest };
    });
}

/** "$49.00" for display: the list price with its own currency, before tax. */
export function formatListPrice(price: { amountMinor: number; currency: string }): string {
  return formatMoney(price.amountMinor, price.currency);
}
