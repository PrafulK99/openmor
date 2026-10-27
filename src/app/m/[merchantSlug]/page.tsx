// /m/{merchantSlug}: a merchant's public page for people and agents. Server-rendered, complete HTML.
//
// ensureStatic = "navigation": the whole page is produced ahead of time from cached data, and a slug
// that was not prerendered at build time waits for its complete page on first visit (then it is
// cached). That is what makes the first response full HTML and a missing merchant a real 404 status,
// rather than a loading shell that crawlers and LLM fetchers would see.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPublicSlug } from "@/core/public-catalog";
import { merchantPath, PRICE_DEPENDS_NOTE } from "@/core/public-formats";
import { merchantTwinPath } from "@/core/public-markdown";
import { publicBaseUrl } from "@/lib/public-url";
import { cachedPublicMerchant, staticMerchantParams } from "@/app/public-data";
import { MerchantView } from "../views";

export const ensureStatic = "navigation";

export async function generateStaticParams() {
  return staticMerchantParams();
}

async function load(merchantSlug: string) {
  // A slug that cannot be a slug is not looked up, and does not become a cache entry.
  if (!isPublicSlug(merchantSlug)) return null;
  return cachedPublicMerchant(merchantSlug);
}

export async function generateMetadata({ params }: PageProps<"/m/[merchantSlug]">): Promise<Metadata> {
  const { merchantSlug } = await params;
  const merchant = await load(merchantSlug);
  // The same generic title for every missing page: it must not hint at what exists.
  if (!merchant) return { title: "Not found" };
  const base = publicBaseUrl();
  return {
    title: `${merchant.name} on OpenMoR`,
    description: PRICE_DEPENDS_NOTE,
    alternates: { canonical: `${base}${merchantPath(merchant.slug)}`, types: { "text/plain": `${base}${merchantPath(merchant.slug)}/llms.txt`, "text/markdown": `${base}${merchantTwinPath(merchant.slug)}` } },
  };
}

export default async function MerchantPage({ params }: PageProps<"/m/[merchantSlug]">) {
  const { merchantSlug } = await params;
  const merchant = await load(merchantSlug);
  if (!merchant) notFound();
  return <MerchantView merchant={merchant} baseUrl={publicBaseUrl()} />;
}
