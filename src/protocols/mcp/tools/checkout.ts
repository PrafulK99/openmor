import { z } from "zod";
import { createCheckout } from "@/core/checkout";
import { money, moneySchema } from "../format";
import { ok } from "../results";
import { defineTool } from "../tool";

const inputSchema = z.object({
  quote_id: z.string().describe("quote_id from get_quote. It must not be expired (check expires_in_seconds)."),
  buyer_email: z.string().describe("The buyer's email address. Dodo sends the receipt and access details there."),
});

const STATUS = z.enum(["pending_payment", "paid", "failed", "cancelled", "fulfilled", "refunded"]);

const outputSchema = z.object({
  order_id: z.string().describe("Pass this to get_order after the buyer says they have paid."),
  status: STATUS,
  checkout_url: z.string().nullable().describe("Secure Dodo Payments page where the buyer pays. Give it to the buyer."),
  product_name: z.string(),
  amount_due: moneySchema.describe("The quoted total. The checkout page shows the final amount."),
  is_new_order: z.boolean().describe("False when this exact quote and email were already checked out: same order and link."),
});

export const checkoutTool = defineTool({
  name: "checkout",
  title: "Check out a quote",
  description: [
    "Start paying for a quote from get_quote. Call it only after the buyer has seen the quoted total and said they want to buy, and has given you their email.",
    "Returns a checkout_url: give it to the buyer to open and pay on Dodo Payments' secure page. Never ask the buyer for card details; they enter them only on that page.",
    "Safe to retry: the same quote_id and buyer_email always return the same order and link. A quote can be checked out once, before it expires; on QUOTE_EXPIRED call get_quote again.",
    "The final amount is shown on the checkout page and can differ slightly from the quote when the price was converted (is_converted). Never invent or recalculate prices.",
    "After the buyer says they have paid, call get_order with the order_id and buyer_email.",
  ].join(" "),
  inputSchema,
  outputSchema,
  // Creates an order and a provider checkout session, but repeats are idempotent.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  run: async (input, { deps, agentSessionId }) => {
    const { order, created } = await createCheckout(deps, {
      quoteId: input.quote_id,
      buyerEmail: input.buyer_email,
      ...(agentSessionId ? { agentSessionId } : {}),
    });
    const due = money(order.quoted.total, order.quoted.currency);

    let summary: string;
    if (order.status === "paid" || order.status === "fulfilled") {
      summary = `This order for ${order.productName} is already paid. Call get_order to get what the buyer received.`;
    } else if (!order.checkoutUrl) {
      summary = `The order for ${order.productName} has no payment link yet. Call checkout again with the same quote_id and buyer_email.`;
    } else {
      summary = `Open this link to pay ${due.formatted} for ${order.productName}. The final amount is shown on the checkout page.`;
    }

    return ok(
      {
        order_id: order.id,
        status: order.status,
        checkout_url: order.checkoutUrl,
        product_name: order.productName,
        amount_due: due,
        is_new_order: created,
      },
      summary,
    );
  },
});
