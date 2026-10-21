import type { Quote } from "@/generated/prisma/client";
import { nowFrom, type CoreDeps } from "@/core/deps";
import { InvalidInputError } from "@/core/errors";
import { loadSellable } from "@/core/products";
import type { QuoteBreakup } from "@/core/types";

export const QUOTE_TTL_MS = 15 * 60 * 1000;
const MAX_QUANTITY = 100;

export interface BuyerLocation {
  /** ISO 3166-1 alpha-2, e.g. "DE". */
  country: string;
  state?: string;
  zip?: string;
  discountCodes?: string[];
}

export interface CreateQuoteInput {
  merchantId: string;
  /** OpenMoR product id (from search), not the provider's id. */
  productId: string;
  quantity: number;
  buyer: BuyerLocation;
  /** The AgentSession that asked for this quote, if known. */
  agentSessionId?: string;
}

export interface QuoteView {
  id: string;
  merchantId: string;
  productId: string;
  agentSessionId: string | null;
  quantity: number;
  country: string;
  state: string | null;
  zip: string | null;
  discountCodes: string[];
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  recurring: QuoteBreakup | null;
  /** Tax rate of the product in basis points (1900 = 19%). Null if the provider gave none. */
  taxRateBps: number | null;
  /** Quote currency differs from the product's list currency, so the total can drift with FX rates. */
  isConverted: boolean;
  isBinding: boolean;
  status: "open" | "used" | "expired";
  expiresAt: Date;
  createdAt: Date;
}

function toView(q: Quote): QuoteView {
  return {
    id: q.id,
    merchantId: q.merchantId,
    productId: q.productId,
    agentSessionId: q.agentSessionId,
    quantity: q.quantity,
    country: q.country,
    state: q.state,
    zip: q.zip,
    discountCodes: q.discountCodes,
    currency: q.currency,
    subtotal: q.subtotalAmount,
    discount: q.discountAmount,
    tax: q.taxAmount,
    total: q.totalAmount,
    recurring: (q.recurringBreakup as QuoteBreakup | null) ?? null,
    taxRateBps: q.taxRateBps,
    isConverted: q.isConverted,
    isBinding: q.isBinding,
    status: q.status,
    expiresAt: q.expiresAt,
    createdAt: q.createdAt,
  };
}

function validate(input: CreateQuoteInput) {
  const { quantity, buyer } = input;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new InvalidInputError(`quantity must be a whole number from 1 to ${MAX_QUANTITY}`);
  }
  const country = buyer.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new InvalidInputError("buyer.country must be a two-letter ISO country code");
  }
  const state = buyer.state?.trim() || undefined;
  const zip = buyer.zip?.trim() || undefined;
  if ((state?.length ?? 0) > 64 || (zip?.length ?? 0) > 32) {
    throw new InvalidInputError("buyer.state or buyer.zip is too long");
  }
  const discountCodes = (buyer.discountCodes ?? []).map((c) => c.trim()).filter(Boolean);
  return { quantity, country, state, zip, discountCodes };
}

/**
 * Get a provider price preview for one product and store it as a quote valid for 15 minutes.
 * The merchant must be in the network and the product active and agent-sellable.
 */
export async function createQuote(deps: CoreDeps, input: CreateQuoteInput): Promise<QuoteView> {
  const { quantity, country, state, zip, discountCodes } = validate(input);

  const { merchant, product } = await loadSellable(deps, input.merchantId, input.productId);

  const preview = await deps.adapterFor(merchant).quote({
    items: [{ productId: product.providerProductId, quantity }],
    country,
    ...(state ? { state } : {}),
    ...(zip ? { zip } : {}),
    ...(discountCodes.length ? { discountCodes } : {}),
  });

  const line =
    preview.items.find((i) => i.productId === product.providerProductId) ?? preview.items[0];
  const isConverted = preview.currency.toUpperCase() !== product.currency.toUpperCase();

  const now = nowFrom(deps);
  const quote = await deps.db.quote.create({
    data: {
      merchantId: merchant.id,
      productId: product.id,
      agentSessionId: input.agentSessionId ?? null,
      quantity,
      country,
      state: state ?? null,
      zip: zip ?? null,
      discountCodes,
      currency: preview.currency,
      subtotalAmount: preview.subtotal,
      discountAmount: preview.discount,
      taxAmount: preview.tax,
      totalAmount: preview.total,
      recurringBreakup: preview.recurring ? { ...preview.recurring } : undefined,
      taxRateBps: line?.taxRateBps ?? null,
      isConverted,
      isBinding: preview.isBinding,
      status: "open",
      expiresAt: new Date(now.getTime() + QUOTE_TTL_MS),
      createdAt: now,
    },
  });
  return toView(quote);
}

/** Fetch a quote. An open quote past its expiry is marked expired before it is returned. Null if unknown. */
export async function getQuote(deps: CoreDeps, quoteId: string): Promise<QuoteView | null> {
  const quote = await deps.db.quote.findUnique({ where: { id: quoteId } });
  if (!quote) return null;

  if (quote.status === "open" && nowFrom(deps).getTime() >= quote.expiresAt.getTime()) {
    // Conditional update: if checkout used the quote meanwhile, leave it alone.
    const { count } = await deps.db.quote.updateMany({
      where: { id: quoteId, status: "open" },
      data: { status: "expired" },
    });
    if (count === 1) return toView({ ...quote, status: "expired" });
    const fresh = await deps.db.quote.findUnique({ where: { id: quoteId } });
    return fresh ? toView(fresh) : null;
  }
  return toView(quote);
}
