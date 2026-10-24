// /sitemap.xml: every public merchant page and product page. Built from the same cached read as
// llms.txt, so only opted-in merchants and sellable products can appear.
import type { MetadataRoute } from "next";
import { merchantPath, productPath } from "@/core/public-formats";
import { publicBaseUrl } from "@/lib/public-url";
import { cachedPublicIndex, orDeferToRequest } from "./public-data";

/** The sitemap protocol allows at most 50,000 URLs in one file. */
export const MAX_SITEMAP_URLS = 50_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicBaseUrl();
  const index = await orDeferToRequest(cachedPublicIndex);
  return index
    .flatMap((m) => [
      { url: `${base}${merchantPath(m.slug)}`, lastModified: m.updatedAt },
      ...m.products.map((p) => ({ url: `${base}${productPath(m.slug, p.id)}`, lastModified: p.updatedAt })),
    ])
    .slice(0, MAX_SITEMAP_URLS);
}
