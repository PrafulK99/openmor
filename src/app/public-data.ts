// Cached reads for the public pages, llms.txt, the sitemap and robots.txt.
//
// Every function reads our own database through core (never a payment provider) and is cached with
// `use cache`: a page is served from the cache and refreshed in the background, so traffic to these
// public pages never reaches the database on every request, let alone Dodo.
//
// Freshness: catalog sync (`pnpm merchant:sync`) and opt-in changes are made from the command line,
// outside the Next.js server, so they cannot clear this cache on demand. They show up on the pages
// within the revalidate time below, or at once on the next deploy. All entries carry the
// "public-catalog" tag so a future admin action can call revalidateTag("public-catalog").
import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";
import { getPublicIndex, getPublicMerchant, getPublicProduct, isPublicSlug } from "@/core/public-catalog";
import { buildMerchantLlmsTxt, buildNetworkLlmsTxt } from "@/core/public-formats";
import { publicBaseUrl } from "@/lib/public-url";

/** Served from cache for 5 minutes, refreshed in the background after 15, dropped after a day. */
const CATALOG_LIFE = { stale: 300, revalidate: 900, expire: 86400 } as const;

/**
 * A param that is never a real slug. Cache Components needs generateStaticParams to return at least one
 * entry, so when there is nothing to list (an empty database, or none reachable at build time) this
 * stands in. Its page is a 404, and it never touches the database.
 */
export const PLACEHOLDER = "__placeholder__";

/** How many product pages are prerendered at build. The rest are rendered on first visit and then cached. */
const MAX_PRERENDERED_PRODUCTS = 200;

/**
 * For routes that are prerendered at build time with no params (/llms.txt, /sitemap.xml). If the
 * database cannot be read then (none configured, or an outage during a deploy), do not fail the
 * build: wait for a request instead, which makes the route render at request time. The same read is
 * then tried again with a live request, and a real failure there is a normal server error.
 */
export async function orDeferToRequest<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    await connection();
    throw error;
  }
}

async function publicDeps() {
  // Loaded lazily so importing this module needs no environment variables.
  const { db } = await import("@/lib/db");
  return { db };
}

export async function cachedPublicMerchant(slug: string) {
  "use cache";
  cacheLife(CATALOG_LIFE);
  cacheTag("public-catalog", `public-merchant:${slug}`);
  return getPublicMerchant(await publicDeps(), slug);
}

export async function cachedPublicProduct(slug: string, productId: string) {
  "use cache";
  cacheLife(CATALOG_LIFE);
  cacheTag("public-catalog", `public-merchant:${slug}`);
  return getPublicProduct(await publicDeps(), slug, productId);
}

export async function cachedPublicIndex() {
  "use cache";
  cacheLife(CATALOG_LIFE);
  cacheTag("public-catalog");
  return getPublicIndex(await publicDeps());
}

/** /llms.txt as text. */
export async function cachedNetworkLlmsTxt(): Promise<string> {
  "use cache";
  cacheLife(CATALOG_LIFE);
  cacheTag("public-catalog");
  return buildNetworkLlmsTxt({ baseUrl: publicBaseUrl(), merchants: await getPublicIndex(await publicDeps()) });
}

/** /m/{slug}/llms.txt as text, or null when there is no such public merchant. */
export async function cachedMerchantLlmsTxt(slug: string): Promise<string | null> {
  "use cache";
  cacheLife(CATALOG_LIFE);
  cacheTag("public-catalog", `public-merchant:${slug}`);
  const merchant = await getPublicMerchant(await publicDeps(), slug);
  return merchant ? buildMerchantLlmsTxt({ baseUrl: publicBaseUrl(), merchant }) : null;
}

/** Build-time list of merchant pages to prerender. Never throws and never returns an empty list. */
export async function staticMerchantParams(): Promise<{ merchantSlug: string }[]> {
  try {
    const index = await getPublicIndex(await publicDeps());
    const params = index.filter((m) => isPublicSlug(m.slug)).map((m) => ({ merchantSlug: m.slug }));
    if (params.length > 0) return params;
  } catch {
    // No database at build time: fall through. Pages are then rendered on first visit.
  }
  return [{ merchantSlug: PLACEHOLDER }];
}

/** Build-time list of product pages to prerender. Never throws and never returns an empty list. */
export async function staticProductParams(): Promise<{ merchantSlug: string; productId: string }[]> {
  try {
    const index = await getPublicIndex(await publicDeps());
    const params = index
      .filter((m) => isPublicSlug(m.slug))
      .flatMap((m) => m.products.map((p) => ({ merchantSlug: m.slug, productId: p.id })))
      .slice(0, MAX_PRERENDERED_PRODUCTS);
    if (params.length > 0) return params;
  } catch {
    // No database at build time: fall through.
  }
  return [{ merchantSlug: PLACEHOLDER, productId: PLACEHOLDER }];
}
