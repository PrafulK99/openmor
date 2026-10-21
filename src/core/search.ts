import type { Prisma } from "@/generated/prisma/client";
import type { CoreDeps } from "@/core/deps";

export const SEARCH_LIMIT = 20;
const MAX_QUERY_LENGTH = 100;

export interface SearchInput {
  query: string;
  /** Keep products whose list price is at most `amount` minor units of `currency`. Other currencies are excluded. */
  maxPrice?: { amount: number; currency: string };
  billingType?: "one_time" | "subscription";
  merchantSlug?: string;
}

export interface SearchResult {
  productId: string;
  merchantId: string;
  merchantSlug: string;
  merchantName: string;
  name: string;
  description: string | null;
  /** List price before tax, in minor units. Get a quote for the real total. */
  price: number;
  currency: string;
  billingType: "one_time" | "subscription";
}

const resultSelect = {
  id: true,
  name: true,
  description: true,
  priceAmount: true,
  currency: true,
  isRecurring: true,
  merchant: { select: { id: true, slug: true, name: true } },
} as const;

type Row = Prisma.ProductGetPayload<{ select: typeof resultSelect }>;

function toResult(row: Row): SearchResult {
  return {
    productId: row.id,
    merchantId: row.merchant.id,
    merchantSlug: row.merchant.slug,
    merchantName: row.merchant.name,
    name: row.name,
    description: row.description,
    price: row.priceAmount,
    currency: row.currency,
    billingType: row.isRecurring ? "subscription" : "one_time",
  };
}

/**
 * Find agent-sellable, active products from merchants in the network.
 * Case-insensitive substring match; name matches rank above description-only matches.
 */
export async function searchProducts(deps: CoreDeps, input: SearchInput): Promise<SearchResult[]> {
  const query = input.query.trim().slice(0, MAX_QUERY_LENGTH);

  const eligible: Prisma.ProductWhereInput = {
    agentSellable: true,
    active: true,
    merchant: {
      is: {
        networkOptIn: true,
        ...(input.merchantSlug ? { slug: input.merchantSlug.trim().toLowerCase() } : {}),
      },
    },
    ...(input.billingType ? { isRecurring: input.billingType === "subscription" } : {}),
    ...(input.maxPrice
      ? {
          currency: input.maxPrice.currency.toUpperCase(),
          priceAmount: { lte: input.maxPrice.amount },
        }
      : {}),
  };
  const nameMatch: Prisma.ProductWhereInput = { name: { contains: query, mode: "insensitive" } };
  const orderBy: Prisma.ProductOrderByWithRelationInput[] = [{ name: "asc" }, { id: "asc" }];

  const byName = await deps.db.product.findMany({
    where: { AND: [eligible, nameMatch] },
    select: resultSelect,
    orderBy,
    take: SEARCH_LIMIT,
  });
  if (byName.length >= SEARCH_LIMIT || query === "") return byName.map(toResult);

  const byDescription = await deps.db.product.findMany({
    where: {
      AND: [eligible, { NOT: nameMatch }, { description: { contains: query, mode: "insensitive" } }],
    },
    select: resultSelect,
    orderBy,
    take: SEARCH_LIMIT - byName.length,
  });

  return [...byName, ...byDescription].map(toResult);
}
