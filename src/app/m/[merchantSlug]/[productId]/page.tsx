// /m/{merchantSlug}/{productId}: a product's public page, with schema.org Product and Offer JSON-LD.
// Shows the LIST price with its own currency and says tax is added per country. It never shows a
// tax-inclusive price: only a quote (get_quote) is binding. See ../page.tsx for why ensureStatic.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPublicSlug } from "@/core/public-catalog";
import { merchantPath, productPath } from "@/core/public-formats";
import { publicBaseUrl } from "@/lib/public-url";
import { cachedPublicProduct, staticProductParams } from "@/app/public-data";
import { ProductView } from "../../views";

export const ensureStatic = "navigation";

export async function generateStaticParams() {
  return staticProductParams();
}

async function load(merchantSlug: string, productId: string) {
  if (!isPublicSlug(merchantSlug) || !/^[A-Za-z0-9_-]{1,64}$/.test(productId)) return null;
  return cachedPublicProduct(merchantSlug, productId);
}

export async function generateMetadata({ params }: PageProps<"/m/[merchantSlug]/[productId]">): Promise<Metadata> {
  const { merchantSlug, productId } = await params;
  const data = await load(merchantSlug, productId);
  if (!data) return { title: "Not found" };
  const base = publicBaseUrl();
  return {
    title: `${data.product.name} · ${data.merchant.name} on OpenMoR`,
    description: data.product.summary ?? undefined,
    alternates: { canonical: `${base}${productPath(data.merchant.slug, data.product.id)}`, types: { "text/plain": `${base}${merchantPath(data.merchant.slug)}/llms.txt` } },
  };
}

export default async function ProductPage({ params }: PageProps<"/m/[merchantSlug]/[productId]">) {
  const { merchantSlug, productId } = await params;
  const data = await load(merchantSlug, productId);
  if (!data) notFound();
  return <ProductView data={data} baseUrl={publicBaseUrl()} />;
}
