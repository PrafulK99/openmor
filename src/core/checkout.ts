import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Quote } from "@/generated/prisma/client";
import { nowFrom, type CoreDeps } from "@/core/deps";
import { InvalidInputError, OpenMorError } from "@/core/errors";
import { loadOrderView, type OrderView } from "@/core/orders";
import { loadSellable } from "@/core/products";

export interface CheckoutDeps extends CoreDeps {
  /** Public base URL of this app, for the buyer's return link (APP_URL). */
  appUrl: string;
}

export interface CreateCheckoutInput {
  quoteId: string;
  buyerEmail: string;
  agentSessionId?: string;
}

export interface CheckoutResult {
  order: OrderView;
  /** False when an earlier identical call already created this order. */
  created: boolean;
}

export const emailSchema = z.email().max(320);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** sha256(quote_id + ":" + normalized email), hex. The ":" keeps the two parts from running together. */
export function checkoutIdempotencyKey(quoteId: string, normalizedEmail: string): string {
  return createHash("sha256").update(`${quoteId}:${normalizedEmail}`).digest("hex");
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/** Throw the error for a quote that cannot be claimed: QUOTE_USED if another order took it, else QUOTE_EXPIRED. */
export function refuseQuote(quote: Quote, quoteId: string): never {
  if (quote.status === "used") {
    throw new OpenMorError("QUOTE_USED", `Quote "${quoteId}" was already checked out with a different buyer email`);
  }
  throw new OpenMorError("QUOTE_EXPIRED", `Quote "${quoteId}" is expired`);
}

export function isClaimable(quote: Quote, now: Date): boolean {
  return quote.status === "open" && quote.expiresAt > now;
}

/**
 * Start a hosted (handoff) checkout for a quote. Idempotent per quote and buyer email: a repeat
 * returns the same order and checkout URL.
 *
 * The provider session is created first. Only when it succeeds is the quote claimed and the
 * order created, together in one transaction, so a provider failure leaves the quote open for
 * a retry. The claim is atomic, so a quote backs at most one order; a concurrent request that
 * loses the race leaves an unused provider session behind, which simply expires unpaid.
 * Per the FX drift policy, handoff accepts small price drift: the buyer sees and confirms the
 * final amount on the provider's checkout page, so no re-preview is done here.
 */
export async function createCheckout(deps: CheckoutDeps, input: CreateCheckoutInput): Promise<CheckoutResult> {
  const quoteId = input.quoteId.trim();
  const email = normalizeEmail(input.buyerEmail);
  if (!emailSchema.safeParse(email).success) {
    throw new InvalidInputError("buyer_email must be a valid email address, e.g. buyer@example.com.");
  }
  if (!quoteId) throw new InvalidInputError("quote_id is required; use the quote_id from get_quote.");
  const idempotencyKey = checkoutIdempotencyKey(quoteId, email);

  const existing = await deps.db.order.findUnique({ where: { idempotencyKey } });
  if (existing) return { order: await loadOrderView(deps, { id: existing.id }), created: false };

  const quote = await deps.db.quote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new OpenMorError("QUOTE_EXPIRED", `No quote "${quoteId}"`);
  if (!isClaimable(quote, nowFrom(deps))) refuseQuote(quote, quoteId);
  const { merchant, product } = await loadSellable(deps, quote.merchantId, quote.productId);

  // The order id goes into the return URL and session metadata, so it is chosen up front.
  const orderId = randomUUID();
  const session = await deps.adapterFor(merchant).createCheckout({
    quote: {
      items: [{ productId: product.providerProductId, quantity: quote.quantity }],
      country: quote.country,
      ...(quote.state ? { state: quote.state } : {}),
      ...(quote.zip ? { zip: quote.zip } : {}),
      ...(quote.discountCodes.length ? { discountCodes: quote.discountCodes } : {}),
    },
    customer: { email },
    returnUrl: `${deps.appUrl.replace(/\/+$/, "")}/orders/${orderId}`,
    metadata: { openmor_order_id: orderId, openmor_quote_id: quote.id },
  });

  const now = nowFrom(deps);
  let order: { id: string } | null;
  try {
    order = await deps.db.$transaction(async (tx) => {
      // Claim the quote: only an open, unexpired quote can become an order, and only once.
      const { count } = await tx.quote.updateMany({
        where: { id: quote.id, status: "open", expiresAt: { gt: now } },
        data: { status: "used" },
      });
      if (count !== 1) return null;
      return tx.order.create({
        data: {
          id: orderId,
          merchantId: quote.merchantId,
          quoteId: quote.id,
          agentSessionId: input.agentSessionId ?? null,
          idempotencyKey,
          buyerEmail: email,
          status: "pending_payment",
          checkoutMode: "handoff",
          currency: quote.currency,
          taxAmount: quote.taxAmount,
          totalAmount: quote.totalAmount,
          providerCheckoutSessionId: session.sessionId,
          checkoutUrl: session.checkoutUrl,
        },
        select: { id: true },
      });
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    order = null; // A concurrent identical request won; read its order below.
  }
  if (order) return { order: await loadOrderView(deps, { id: order.id }), created: true };

  // Lost the claim: a concurrent identical call created the order, or the quote was taken or expired meanwhile.
  const winner = await deps.db.order.findUnique({ where: { idempotencyKey } });
  if (winner) return { order: await loadOrderView(deps, { id: winner.id }), created: false };
  const latest = await deps.db.quote.findUnique({ where: { id: quote.id } });
  refuseQuote(latest ?? quote, quoteId);
}
