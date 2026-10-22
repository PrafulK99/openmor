import { z } from "zod";
import { createBuyerLink, DEFAULT_LINK_DAYS, MAX_LINK_DAYS } from "@/core/buyer-links";
import { money, moneySchema } from "../format";
import { invalid, ok } from "../results";
import { defineTool } from "../tool";

const capInput = (what: string) =>
  z.object({
    amount: z.number().describe(`${what} in minor units (cents, paise), a whole number, e.g. 5000 for 50.00.`),
    currency: z.string().describe("ISO 4217 code, e.g. EUR or USD. Use the currency the buyer will be quoted in."),
  });

const inputSchema = z.object({
  merchant_id: z.string().describe("merchant_id exactly as returned by search_products."),
  buyer_email: z.string().describe("The buyer's email address. The approval link is sent here."),
  monthly_cap: capInput("The most that may be spent each calendar month (UTC)").describe(
    "Monthly spending limit the buyer chose. Resets on the 1st of each month, UTC.",
  ),
  per_order_cap: capInput("The most any single purchase may cost")
    .optional()
    .describe("Optional limit per purchase, in the same currency as monthly_cap and not above it."),
  product_ids: z
    .array(z.string())
    .optional()
    .describe("Optional: only allow these product_id values from search_products. Leave out to allow any product from this merchant."),
  expires_in_days: z
    .number()
    .optional()
    .describe(`How long the permission lasts, 1 to ${MAX_LINK_DAYS} days. Defaults to ${DEFAULT_LINK_DAYS}.`),
});

const outputSchema = z.object({
  buyer_link_id: z.string().describe("Use this with checkout (mode saved_method) once the buyer has approved."),
  status: z.literal("pending_approval").describe("Stays pending until the buyer approves in their email."),
  merchant_id: z.string(),
  monthly_cap: moneySchema,
  per_order_cap: moneySchema.nullable(),
  product_ids: z.array(z.string()).nullable().describe("Null means any product from the merchant."),
  expires_at: z.iso.datetime().describe("When the permission ends, ISO 8601 UTC, if approved."),
  approval_expires_at: z.iso.datetime().describe("When the emailed approval link stops working (30 minutes after sending)."),
});

export const linkBuyerTool = defineTool({
  name: "link_buyer",
  title: "Ask the buyer for spending permission",
  description: [
    "Ask a buyer for permission to buy from one merchant on their behalf without sending a payment link each time.",
    "This emails the buyer a one-time link where they review the limits and approve or decline. Nothing can be charged until they approve.",
    "Call it only when the buyer has asked for this and told you the limits. Never choose the monthly cap, per-order cap or product list yourself; use what the buyer said. Never invent the buyer's email address or any id.",
    "It sends a real email each time, so do not call it repeatedly: if you already have a buyer_link_id for this buyer and merchant, use get_buyer_link to check its status instead.",
    "The buyer needs a saved card with the merchant's payment provider: if they have never bought from this merchant, they must buy once with a normal checkout first.",
    "After calling it, tell the buyer to check their email to approve (the link works for 30 minutes), then call get_buyer_link to see when they have approved.",
    "Then pass the buyer_link_id to checkout with mode saved_method. Money amounts are whole numbers in minor units (5000 = 50.00).",
  ].join(" "),
  inputSchema,
  outputSchema,
  // Creates a record and sends an email: not read-only, and not idempotent (each call emails again).
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  run: async (input, { deps, agentSessionId }) => {
    const merchantId = input.merchant_id.trim();
    if (!merchantId) invalid("merchant_id is required; use the merchant_id from search_products.");
    const link = await createBuyerLink(deps, {
      merchantId,
      buyerEmail: input.buyer_email,
      monthlyCap: { amountMinor: input.monthly_cap.amount, currency: input.monthly_cap.currency },
      ...(input.per_order_cap ? { perOrderCap: { amountMinor: input.per_order_cap.amount, currency: input.per_order_cap.currency } } : {}),
      ...(input.product_ids ? { productIds: input.product_ids } : {}),
      ...(input.expires_in_days !== undefined ? { expiresInDays: input.expires_in_days } : {}),
      ...(agentSessionId ? { agentSessionId } : {}),
    });
    return ok(
      {
        buyer_link_id: link.buyerLinkId,
        status: "pending_approval",
        merchant_id: link.merchantId,
        monthly_cap: money(link.monthlyCap, link.currency),
        per_order_cap: link.perOrderCap === null ? null : money(link.perOrderCap, link.currency),
        product_ids: link.productIds,
        expires_at: link.expiresAt.toISOString(),
        approval_expires_at: link.approvalExpiresAt.toISOString(),
      },
      "Check your email to approve. A one-time approval link was sent to the buyer and works for 30 minutes. Nothing can be charged until they approve.",
    );
  },
});
