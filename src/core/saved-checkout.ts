// Saved-method checkout: charge a buyer's saved card through an approved buyer link, with no
// buyer present. No card data touches OpenMoR: only the provider's customer and payment-method
// ids, stored when the buyer approved the link.
//
// Safety rules, in the order they are applied:
//  1. The link must be active, unexpired, for this buyer and this merchant, and cover the product.
//  2. The price is re-checked with the provider. FX drift policy: charge only if the new total is
//     at most 1% above the quoted total; otherwise PRICE_CHANGED with a fresh quote.
//  3. The new total must fit the per-order cap and what is left of this month's cap.
//  4. Spend is reserved atomically (the link row is locked) BEFORE the charge, so two quick calls
//     cannot both fit under the cap. The reserved order is a saved-method order awaiting payment.
//  5. If the provider says the buyer must be present, the reserved order becomes a normal hosted
//     checkout the buyer pays themselves. If the charge fails with an unknown outcome (timeout,
//     5xx), the reservation is KEPT: the payment may exist, and its webhook will settle the order.
import { randomUUID } from "node:crypto";
import type { BuyerLink } from "@/generated/prisma/client";
import {
  checkoutIdempotencyKey,
  createCheckout,
  emailSchema,
  isClaimable,
  isUniqueViolation,
  normalizeEmail,
  refuseQuote,
  type CheckoutDeps,
} from "@/core/checkout";
import { nowFrom } from "@/core/deps";
import { BuyerActionRequiredError, InvalidInputError, OpenMorError, PriceChangedError } from "@/core/errors";
import { formatMoney } from "@/core/money";
import { applyPaymentEvent, loadOrderView, type OrderView } from "@/core/orders";
import { loadSellable } from "@/core/products";
import { storeQuote } from "@/core/quotes";
import { monthlyAllowance, type MonthlyAllowance } from "@/core/spend";
import type { QuoteInput } from "@/core/types";

/** FX drift policy: a saved-method charge may be at most this much (percent) above the quoted total. */
export const MAX_DRIFT_PERCENT = 1;

/** True if `newTotal` is at most 1% above `quotedTotal`. Integer math: exactly 1.01x passes, 1.02x fails. A lower total always passes. */
export function withinDrift(newTotal: number, quotedTotal: number): boolean {
  return newTotal * 100 <= quotedTotal * (100 + MAX_DRIFT_PERCENT);
}

export interface SavedCheckoutInput {
  quoteId: string;
  buyerEmail: string;
  buyerLinkId: string;
  agentSessionId?: string;
}

/** What happened: charged now, charge sent and being confirmed, a hosted link instead, or an earlier identical call. */
export type SavedCheckoutOutcome = "paid" | "processing" | "handoff" | "existing";

/** Why the buyer is asked to pay on the hosted page instead. */
export type FallbackReason = "buyer_must_be_present" | "non_binding_price" | "subscription";

export interface SavedCheckoutResult {
  order: OrderView;
  /** False when an earlier identical call already created this order. */
  created: boolean;
  outcome: SavedCheckoutOutcome;
  fallbackReason: FallbackReason | null;
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const notLinked = (message: string) => new OpenMorError("BUYER_NOT_LINKED", message);

/** The link must belong to this buyer and merchant and be approved, unrevoked and unexpired. */
function usableLink(link: BuyerLink | null, email: string, merchantId: string, now: Date) {
  // One message for "no such link" and "someone else's link": do not reveal which ids exist.
  if (!link || link.buyerEmail !== email || link.merchantId !== merchantId) {
    throw notLinked("No buyer link with this id for this buyer and merchant. Create one with link_buyer.");
  }
  if (link.status === "pending_approval") {
    throw notLinked("The buyer has not approved this link yet. Ask them to check their email, or send a new link with link_buyer.");
  }
  if (link.status === "revoked") {
    throw notLinked("The buyer revoked this link. Ask them to approve a new one with link_buyer.");
  }
  if (link.status === "expired" || link.expiresAt.getTime() <= now.getTime()) {
    throw notLinked("This buyer link has expired. Ask the buyer to approve a new one with link_buyer.");
  }
  if (!link.providerCustomerId || !link.providerPaymentMethodId) {
    throw notLinked("This buyer link has no saved card on file. Ask the buyer to approve a new link.");
  }
  return { ...link, providerCustomerId: link.providerCustomerId, providerPaymentMethodId: link.providerPaymentMethodId };
}

function limitError(total: number, currency: string, link: BuyerLink, allowance: MonthlyAllowance): OpenMorError {
  const m = (n: number) => formatMoney(n, currency);
  if (link.perOrderCapAmount !== null && total > link.perOrderCapAmount) {
    return new OpenMorError(
      "LIMIT_EXCEEDED",
      `This purchase costs ${m(total)}, which is over the buyer's limit of ${m(link.perOrderCapAmount)} per purchase.`,
      { reason: "per_order_cap", currency, requested_minor: total, limit_minor: link.perOrderCapAmount },
    );
  }
  return new OpenMorError(
    "LIMIT_EXCEEDED",
    `This purchase costs ${m(total)}, but only ${m(allowance.remaining)} is left of the buyer's ${m(link.monthlyCapAmount)} monthly limit. It resets on ${dayFormat.format(allowance.resetsAt)} (UTC).`,
    {
      reason: "monthly_cap",
      currency,
      requested_minor: total,
      limit_minor: link.monthlyCapAmount,
      spent_minor: allowance.spent,
      remaining_minor: allowance.remaining,
      resets_at: allowance.resetsAt.toISOString(),
    },
  );
}

/**
 * Pay for a quote with the buyer's saved card, through an approved buyer link. Idempotent per
 * quote and buyer email, like handoff checkout: a repeat returns the existing order and never
 * charges twice.
 */
export async function createSavedMethodCheckout(deps: CheckoutDeps, input: SavedCheckoutInput): Promise<SavedCheckoutResult> {
  const quoteId = input.quoteId.trim();
  const linkId = input.buyerLinkId.trim();
  const email = normalizeEmail(input.buyerEmail);
  if (!emailSchema.safeParse(email).success) {
    throw new InvalidInputError("buyer_email must be a valid email address, e.g. buyer@example.com.");
  }
  if (!quoteId) throw new InvalidInputError("quote_id is required; use the quote_id from get_quote.");
  if (!linkId) throw new InvalidInputError("buyer_link_id is required for saved_method checkout; use the one from link_buyer.");
  const idempotencyKey = checkoutIdempotencyKey(quoteId, email);

  const existing = await deps.db.order.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return { order: await loadOrderView(deps, { id: existing.id }), created: false, outcome: "existing", fallbackReason: null };
  }

  const quote = await deps.db.quote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new OpenMorError("QUOTE_EXPIRED", `No quote "${quoteId}"`);
  if (!isClaimable(quote, nowFrom(deps))) refuseQuote(quote, quoteId);

  const link = usableLink(await deps.db.buyerLink.findUnique({ where: { id: linkId } }), email, quote.merchantId, nowFrom(deps));
  const { merchant, product } = await loadSellable(deps, quote.merchantId, quote.productId);

  // When the buyer has to see the final amount themselves, use a normal hosted checkout.
  const payOnHostedPage = async (fallbackReason: FallbackReason): Promise<SavedCheckoutResult> => {
    const { order, created } = await createCheckout(deps, {
      quoteId,
      buyerEmail: email,
      ...(input.agentSessionId ? { agentSessionId: input.agentSessionId } : {}),
    });
    return { order, created, outcome: "handoff", fallbackReason };
  };

  // Caps limit what an agent spends. A subscription renews by itself, outside any cap, so the
  // buyer subscribes on the hosted page. A non-binding quote has no firm total to check against.
  if (product.isRecurring) return payOnHostedPage("subscription");
  if (!quote.isBinding) return payOnHostedPage("non_binding_price");

  if (link.productScope.length > 0 && !link.productScope.includes(product.id)) {
    throw new OpenMorError("LIMIT_EXCEEDED", `This buyer link does not cover "${product.name}": the buyer approved other products only.`, {
      reason: "product_scope",
    });
  }
  if (link.currency !== quote.currency) {
    throw new OpenMorError(
      "LIMIT_EXCEEDED",
      `This buyer link's limits are in ${link.currency}, but this quote is in ${quote.currency}. Get a quote in ${link.currency}, or ask the buyer to approve a link in ${quote.currency}.`,
      { reason: "currency", link_currency: link.currency, quote_currency: quote.currency },
    );
  }

  const adapter = deps.adapterFor(merchant);
  const quoteInput: QuoteInput = {
    items: [{ productId: product.providerProductId, quantity: quote.quantity }],
    country: quote.country,
    ...(quote.state ? { state: quote.state } : {}),
    ...(quote.zip ? { zip: quote.zip } : {}),
    ...(quote.discountCodes.length ? { discountCodes: quote.discountCodes } : {}),
  };

  // Re-run the preview: the quoted price may have moved (FX).
  const preview = await adapter.quote(quoteInput);
  if (!preview.isBinding) return payOnHostedPage("non_binding_price");
  if (preview.currency !== quote.currency || !withinDrift(preview.total, quote.totalAmount)) {
    const fresh = await storeQuote(deps, {
      merchant,
      product,
      preview,
      quantity: quote.quantity,
      country: quote.country,
      state: quote.state ?? undefined,
      zip: quote.zip ?? undefined,
      discountCodes: quote.discountCodes,
      ...(input.agentSessionId ? { agentSessionId: input.agentSessionId } : {}),
    });
    // The old quote is stale: retire it so only the fresh one can be used.
    await deps.db.quote.updateMany({ where: { id: quote.id, status: "open" }, data: { status: "expired" } });
    const m = (n: number, c: string) => formatMoney(n, c);
    throw new PriceChangedError(
      preview.currency !== quote.currency
        ? `The currency changed from ${quote.currency} to ${preview.currency}. The old quote can no longer be used.`
        : `The price moved from ${m(quote.totalAmount, quote.currency)} to ${m(preview.total, preview.currency)}, more than the ${MAX_DRIFT_PERCENT}% change allowed for saved-card payments. The old quote can no longer be used.`,
      fresh,
    );
  }

  // Caps, checked before reserving so a refusal costs nothing.
  const now = nowFrom(deps);
  const allowance = await monthlyAllowance(deps.db, link, now);
  if ((link.perOrderCapAmount !== null && preview.total > link.perOrderCapAmount) || preview.total > allowance.remaining) {
    throw limitError(preview.total, preview.currency, link, allowance);
  }

  // Reserve the spend. The link row is locked first so concurrent checkouts on this link run
  // one at a time: each sees the others' reservations when it re-checks the cap.
  const orderId = randomUUID();
  let reserved: "ok" | "duplicate" | "not_linked" | "quote_taken" | { limit: MonthlyAllowance };
  try {
    reserved = await deps.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BuyerLink" WHERE id = ${link.id} FOR UPDATE`;
      // An identical call may have finished while we waited for the lock: that order is the answer.
      if (await tx.order.findUnique({ where: { idempotencyKey }, select: { id: true } })) return "duplicate" as const;
      const fresh = await tx.buyerLink.findUnique({ where: { id: link.id } });
      if (!fresh || fresh.status !== "active" || fresh.expiresAt.getTime() <= now.getTime()) return "not_linked" as const;
      const current = await monthlyAllowance(tx, fresh, now);
      if (preview.total > current.remaining) return { limit: current };
      // Claim the quote: only an open, unexpired quote can become an order, and only once.
      const { count } = await tx.quote.updateMany({
        where: { id: quote.id, status: "open", expiresAt: { gt: now } },
        data: { status: "used" },
      });
      if (count !== 1) return "quote_taken" as const;
      await tx.order.create({
        data: {
          id: orderId,
          merchantId: quote.merchantId,
          quoteId: quote.id,
          buyerLinkId: link.id,
          agentSessionId: input.agentSessionId ?? null,
          idempotencyKey,
          buyerEmail: email,
          status: "pending_payment",
          checkoutMode: "saved_method",
          // What we are about to charge (the re-checked total), not the older quoted amount.
          currency: preview.currency,
          taxAmount: preview.tax,
          totalAmount: preview.total,
        },
      });
      return "ok" as const;
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // A concurrent identical request won the idempotency key: return its order.
    const winner = await deps.db.order.findUnique({ where: { idempotencyKey } });
    if (!winner) throw err;
    return { order: await loadOrderView(deps, { id: winner.id }), created: false, outcome: "existing", fallbackReason: null };
  }
  if (reserved === "duplicate") {
    const winner = await deps.db.order.findUniqueOrThrow({ where: { idempotencyKey } });
    return { order: await loadOrderView(deps, { id: winner.id }), created: false, outcome: "existing", fallbackReason: null };
  }
  if (typeof reserved === "object") throw limitError(preview.total, preview.currency, link, reserved.limit);
  if (reserved === "not_linked") throw notLinked("This buyer link is no longer active.");
  if (reserved === "quote_taken") {
    const latest = await deps.db.quote.findUnique({ where: { id: quote.id } });
    refuseQuote(latest ?? quote, quoteId);
  }

  const returnUrl = `${deps.appUrl.replace(/\/+$/, "")}/orders/${orderId}`;
  const metadata = { openmor_order_id: orderId, openmor_quote_id: quote.id };

  let payment;
  try {
    payment = await adapter.chargeSavedMethod({
      quote: quoteInput,
      customer: { email },
      returnUrl,
      metadata,
      customerId: link.providerCustomerId,
      paymentMethodId: link.providerPaymentMethodId,
    });
  } catch (err) {
    // Any other failure (timeout, 5xx) leaves the outcome unknown: a payment may exist. Keep the
    // reserved order, which still counts against the cap; the payment webhook settles it. A retry
    // with the same quote and email returns this order and never charges again.
    if (!(err instanceof BuyerActionRequiredError)) throw err;

    // The provider needs the buyer present (or refused the automatic charge): turn the reserved
    // order into a hosted checkout. No payment exists, so releasing on failure is safe.
    try {
      const session = await adapter.createCheckout({ quote: quoteInput, customer: { email }, returnUrl, metadata });
      await deps.db.order.update({
        where: { id: orderId },
        data: { checkoutMode: "handoff", providerCheckoutSessionId: session.sessionId, checkoutUrl: session.checkoutUrl },
      });
    } catch (fallbackErr) {
      await deps.db.$transaction(async (tx) => {
        await tx.order.deleteMany({ where: { id: orderId, status: "pending_payment", providerPaymentId: null } });
        await tx.quote.updateMany({ where: { id: quote.id, status: "used" }, data: { status: "open" } });
      });
      throw fallbackErr;
    }
    return { order: await loadOrderView(deps, { id: orderId }), created: true, outcome: "handoff", fallbackReason: "buyer_must_be_present" };
  }

  // Record the payment on the order first, so a webhook that arrives at any moment matches it.
  await deps.db.order.update({
    where: { id: orderId },
    data: {
      providerPaymentId: payment.paymentId,
      ...(payment.checkoutSessionId ? { providerCheckoutSessionId: payment.checkoutSessionId } : {}),
    },
  });
  if (payment.status === "succeeded") await applyPaymentEvent(deps, merchant.id, payment, nowFrom(deps).toISOString());

  return {
    order: await loadOrderView(deps, { id: orderId }),
    created: true,
    outcome: payment.status === "succeeded" ? "paid" : "processing",
    fallbackReason: null,
  };
}
