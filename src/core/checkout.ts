import { createHash } from "node:crypto";
import { z } from "zod";
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

const emailSchema = z.email().max(320);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** sha256(quote_id + ":" + normalized email), hex. The ":" keeps the two parts from running together. */
export function checkoutIdempotencyKey(quoteId: string, normalizedEmail: string): string {
  return createHash("sha256").update(`${quoteId}:${normalizedEmail}`).digest("hex");
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/**
 * Start a hosted (handoff) checkout for a quote. Idempotent per quote and buyer email: a repeat
 * returns the same order and checkout URL. The quote is claimed atomically, so it can back only
 * one order. Per the FX drift policy, handoff accepts small price drift: the buyer sees and
 * confirms the final amount on the provider's checkout page, so no re-preview is done here.
 */
export async function createCheckout(deps: CheckoutDeps, input: CreateCheckoutInput): Promise<CheckoutResult> {
  const quoteId = input.quoteId.trim();
  const email = normalizeEmail(input.buyerEmail);
  if (!emailSchema.safeParse(email).success) {
    throw new InvalidInputError("buyer_email must be a valid email address, e.g. buyer@example.com.");
  }
  if (!quoteId) throw new InvalidInputError("quote_id is required; use the quote_id from get_quote.");
  const idempotencyKey = checkoutIdempotencyKey(quoteId, email);

  let order = await deps.db.order.findUnique({ where: { idempotencyKey } });
  let created = false;

  if (!order) {
    const quote = await deps.db.quote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new OpenMorError("QUOTE_EXPIRED", `No quote "${quoteId}"`);
    await loadSellable(deps, quote.merchantId, quote.productId);

    const now = nowFrom(deps);
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
          },
        });
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      order = null; // A concurrent identical request won; read its order below.
    }

    if (!order) {
      // Either a concurrent identical call created it, or the quote is used, expired or gone.
      order = await deps.db.order.findUnique({ where: { idempotencyKey } });
      if (!order) {
        const status = quote.status === "open" && quote.expiresAt <= now ? "expired" : quote.status;
        throw new OpenMorError("QUOTE_EXPIRED", `Quote "${quoteId}" is ${status === "used" ? "already used" : "expired"}`);
      }
    } else {
      created = true;
    }
  }

  // Create the provider session if this order has none yet (first call, or an earlier call
  // whose provider request failed). A pending order with a URL is simply returned again.
  if (!order.checkoutUrl && order.status === "pending_payment") {
    const quote = await deps.db.quote.findUniqueOrThrow({ where: { id: order.quoteId } });
    const { merchant, product } = await loadSellable(deps, order.merchantId, quote.productId);
    const session = await deps.adapterFor(merchant).createCheckout({
      quote: {
        items: [{ productId: product.providerProductId, quantity: quote.quantity }],
        country: quote.country,
        ...(quote.state ? { state: quote.state } : {}),
        ...(quote.zip ? { zip: quote.zip } : {}),
        ...(quote.discountCodes.length ? { discountCodes: quote.discountCodes } : {}),
      },
      customer: { email: order.buyerEmail },
      returnUrl: `${deps.appUrl.replace(/\/+$/, "")}/orders/${order.id}`,
      metadata: { openmor_order_id: order.id, openmor_quote_id: quote.id },
    });
    await deps.db.order.update({
      where: { id: order.id },
      data: { providerCheckoutSessionId: session.sessionId, checkoutUrl: session.checkoutUrl },
    });
  }

  return { order: await loadOrderView(deps, { id: order.id }), created };
}
