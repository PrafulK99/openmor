import { z } from "zod";
import { createCheckout } from "@/core/checkout";
import { nowFrom } from "@/core/deps";
import { PriceChangedError } from "@/core/errors";
import type { OrderView } from "@/core/orders";
import { getProductDetails } from "@/core/products";
import { createSavedMethodCheckout, type FallbackReason, type SavedCheckoutOutcome } from "@/core/saved-checkout";
import { money, moneySchema } from "../format";
import { buildQuoteOutput } from "../quote-output";
import { ERROR_HINTS, invalid, ok, toolError } from "../results";
import { defineTool } from "../tool";

const inputSchema = z.object({
  quote_id: z.string().describe("quote_id from get_quote. It must not be expired (check expires_in_seconds)."),
  buyer_email: z.string().describe("The buyer's email address. Dodo sends the receipt and access details there."),
  mode: z
    .enum(["handoff", "saved_method"])
    .optional()
    .describe(
      'handoff (default): the buyer pays on a secure page you give them. saved_method: charge the card the buyer saved earlier, with no page, using a buyer_link_id the buyer approved via link_buyer.',
    ),
  buyer_link_id: z
    .string()
    .optional()
    .describe("Required with mode saved_method: the buyer_link_id from link_buyer, after the buyer approved it. Not used with handoff."),
});

const ORDER_STATUS = z.enum(["pending_payment", "paid", "failed", "cancelled", "fulfilled", "refunded"]);
const FALLBACK = z.enum(["buyer_must_be_present", "non_binding_price", "subscription"]);

const outputSchema = z.object({
  order_id: z.string().describe("Pass this to get_order after the buyer says they have paid."),
  status: ORDER_STATUS,
  checkout_url: z.string().nullable().describe("Secure Dodo Payments page where the buyer pays. Give it to the buyer. Null after a saved-card payment."),
  product_name: z.string(),
  amount_due: moneySchema.describe("The quoted total. The checkout page shows the final amount."),
  is_new_order: z.boolean().describe("False when this exact quote and email were already checked out: same order and link."),
  mode: z.enum(["handoff", "saved_method"]).describe("How this order is being paid. A saved_method request becomes handoff if the buyer has to pay on the page."),
  fell_back_to_handoff: z.boolean().describe("True when you asked for saved_method but the buyer must pay on checkout_url instead."),
  fallback_reason: FALLBACK.nullable().describe(
    "Why: buyer_must_be_present (the card could not be charged without them), subscription (renews by itself, so the buyer subscribes on the page) or non_binding_price (the final amount must be seen on the page).",
  ),
});

const FALLBACK_TEXT: Record<FallbackReason, string> = {
  buyer_must_be_present: "The saved card could not be charged without the buyer being present",
  subscription: "This is a subscription, which renews by itself, so the buyer needs to subscribe themselves",
  non_binding_price: "The final amount has to be seen by the buyer before they pay",
};

function summarize(order: OrderView, outcome: SavedCheckoutOutcome | "handoff", fallback: FallbackReason | null, requestedSaved: boolean): string {
  const due = money(order.quoted.total, order.quoted.currency).formatted;
  const name = order.productName;
  if (order.status === "paid" || order.status === "fulfilled") {
    const amount = order.charged ? money(order.charged.total, order.charged.currency).formatted : due;
    return order.checkoutMode === "saved_method" && outcome === "paid"
      ? `Paid ${amount} for ${name} with the buyer's saved card. Call get_order with order_id and buyer_email to get what they bought.`
      : `This order for ${name} is already paid. Call get_order to get what the buyer received.`;
  }
  if (order.checkoutMode === "saved_method") {
    return `${due} for ${name} was charged to the buyer's saved card and is being confirmed. Call get_order in a minute. Do not start another checkout for this: it would not charge again.`;
  }
  if (!order.checkoutUrl) {
    return `The order for ${name} has no payment link yet. Call checkout again with the same quote_id and buyer_email.`;
  }
  if (fallback) {
    return `${FALLBACK_TEXT[fallback]}, so give the buyer this link to pay ${due} for ${name}. The final amount is shown on the checkout page. This was not charged automatically.`;
  }
  if (requestedSaved) {
    return `This order for ${name} was already started with a payment link. Give the buyer the checkout_url to pay ${due}.`;
  }
  return `Open this link to pay ${due} for ${name}. The final amount is shown on the checkout page.`;
}

export const checkoutTool = defineTool({
  name: "checkout",
  title: "Check out a quote",
  description: [
    "Start paying for a quote from get_quote. Call it only after the buyer has seen the quoted total and said they want to buy, and has given you their email.",
    "By default (mode handoff) it returns a checkout_url: give it to the buyer to open and pay on Dodo Payments' secure page. Never ask the buyer for card details; they enter them only on that page.",
    "With mode saved_method and a buyer_link_id (from link_buyer, after the buyer approved it) it charges the card the buyer saved earlier, with no page. Use it only when the buyer has agreed to this purchase and its total.",
    "A saved_method charge happens only if the total is within 1% of the quote and inside the buyer's per-purchase and monthly limits. If the price moved more it fails with PRICE_CHANGED and returns a fresh_quote: show the buyer the new total and ask again. If a limit is hit it fails with LIMIT_EXCEEDED and says how much is left: tell the buyer, do not try to get around it.",
    "If the card cannot be charged without the buyer, or the product is a subscription, the result has fell_back_to_handoff true and a checkout_url: give it to the buyer to pay themselves. Nothing was charged.",
    "Safe to retry: the same quote_id and buyer_email always return the same order and never charge twice. A quote can be checked out once, before it expires, for one buyer_email; on QUOTE_EXPIRED or QUOTE_USED call get_quote again.",
    "If a saved_method call fails with PROVIDER_ERROR the payment may still have gone through: retry once with the same quote_id and buyer_email (it returns the existing order and never charges again), then call get_order. Never get a new quote to try again after a PROVIDER_ERROR.",
    "The final amount can differ slightly from the quote when the price was converted (is_converted). Never invent or recalculate prices.",
    "After the buyer says they have paid (or a saved-card order shows paid), call get_order with the order_id and buyer_email.",
  ].join(" "),
  inputSchema,
  outputSchema,
  // Creates an order and either a provider checkout session or a charge, but repeats are idempotent.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  run: async (input, { deps, agentSessionId }) => {
    const session = agentSessionId ? { agentSessionId } : {};
    const savedMethod = input.mode === "saved_method";
    const linkId = input.buyer_link_id?.trim();
    if (savedMethod && !linkId) invalid("buyer_link_id is required when mode is saved_method; use the buyer_link_id from link_buyer.");
    if (!savedMethod && linkId) invalid("buyer_link_id is only used with mode saved_method.");

    let order: OrderView;
    let created: boolean;
    let outcome: SavedCheckoutOutcome | "handoff" = "handoff";
    let fallback: FallbackReason | null = null;
    try {
      if (savedMethod) {
        const r = await createSavedMethodCheckout(deps, { quoteId: input.quote_id, buyerEmail: input.buyer_email, buyerLinkId: linkId!, ...session });
        ({ order, created, outcome, fallbackReason: fallback } = r);
      } else {
        ({ order, created } = await createCheckout(deps, { quoteId: input.quote_id, buyerEmail: input.buyer_email, ...session }));
      }
    } catch (err) {
      if (!(err instanceof PriceChangedError)) throw err;
      // The price moved too far: answer with the fresh quote so the agent can ask the buyer again.
      const product = await getProductDetails(deps, { merchantId: err.freshQuote.merchantId, productId: err.freshQuote.productId });
      const fresh = buildQuoteOutput(err.freshQuote, product, nowFrom(deps));
      const base = toolError(err);
      const message = /[.!?]$/.test(err.message) ? err.message : `${err.message}.`;
      return {
        ...base,
        content: [{ type: "text", text: `PRICE_CHANGED: ${message} ${ERROR_HINTS.PRICE_CHANGED} New quote: ${fresh.summary}` }],
        structuredContent: { ...(base.structuredContent as object), fresh_quote: fresh.structured },
      };
    }

    const due = money(order.quoted.total, order.quoted.currency);
    const fellBack = savedMethod && order.checkoutMode === "handoff" && outcome === "handoff" && fallback !== null;
    return ok(
      {
        order_id: order.id,
        status: order.status,
        checkout_url: order.checkoutUrl,
        product_name: order.productName,
        amount_due: due,
        is_new_order: created,
        mode: order.checkoutMode,
        fell_back_to_handoff: fellBack,
        fallback_reason: fellBack ? fallback : null,
      },
      summarize(order, outcome, fellBack ? fallback : null, savedMethod),
    );
  },
});
