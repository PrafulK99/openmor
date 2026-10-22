import { z } from "zod";
import { getBuyerLinkStatus, type BuyerLinkStatusView } from "@/core/buyer-links";
import { money, moneySchema } from "../format";
import { invalid, ok } from "../results";
import { defineTool } from "../tool";

const inputSchema = z.object({
  buyer_link_id: z.string().describe("buyer_link_id from link_buyer."),
  buyer_email: z.string().describe("The buyer's email address the link was created for. It must match."),
});

export const buyerLinkOutputSchema = z.object({
  buyer_link_id: z.string(),
  status: z
    .enum(["pending_approval", "active", "revoked", "expired"])
    .describe(
      "pending_approval: waiting for the buyer to approve in their email. active: you may charge with it. revoked: the buyer declined or revoked it. expired: the approval email lapsed unapproved, or the permission ended.",
    ),
  can_charge: z.boolean().describe("True only when status is active."),
  merchant_id: z.string(),
  merchant_name: z.string(),
  monthly_cap: moneySchema.describe("The most that can be spent per calendar month (UTC)."),
  per_order_cap: moneySchema.nullable().describe("The most any one purchase may cost, or null for no separate limit."),
  product_ids: z.array(z.string()).nullable().describe("Products the link covers. Null means any product from the merchant."),
  spent_this_month: moneySchema,
  remaining_this_month: moneySchema.describe("What is left of the monthly cap. Zero unless status is active."),
  month_resets_at: z.iso.datetime().describe("When the monthly cap starts again (the 1st of next month, UTC)."),
  expires_at: z.iso.datetime().describe("When the permission ends."),
  approval_expires_at: z.iso.datetime().nullable().describe("While pending: when the emailed approval link stops working."),
});

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export function linkOutput(v: BuyerLinkStatusView) {
  const m = (n: number) => money(n, v.currency);
  return {
    buyer_link_id: v.buyerLinkId,
    status: v.status,
    can_charge: v.status === "active",
    merchant_id: v.merchantId,
    merchant_name: v.merchantName,
    monthly_cap: m(v.monthlyCap),
    per_order_cap: v.perOrderCap === null ? null : m(v.perOrderCap),
    product_ids: v.productIds,
    spent_this_month: m(v.spentThisMonth),
    remaining_this_month: m(v.remainingThisMonth),
    month_resets_at: v.monthResetsAt.toISOString(),
    expires_at: v.expiresAt.toISOString(),
    approval_expires_at: v.approvalExpiresAt ? v.approvalExpiresAt.toISOString() : null,
  };
}

export function linkSummary(v: BuyerLinkStatusView): string {
  const m = (n: number) => money(n, v.currency).formatted;
  switch (v.status) {
    case "pending_approval":
      return `Waiting for the buyer to approve in their email (the link works until ${time.format(v.approvalExpiresAt ?? v.expiresAt)} UTC). Nothing can be charged yet.`;
    case "active":
      return `Active for ${v.merchantName}: ${m(v.spentThisMonth)} of ${m(v.monthlyCap)} spent this month, ${m(v.remainingThisMonth)} left (resets ${day.format(v.monthResetsAt)}, UTC).${v.perOrderCap === null ? "" : ` Up to ${m(v.perOrderCap)} per purchase.`} The permission ends ${day.format(v.expiresAt)}.`;
    case "revoked":
      return "This link was declined or revoked. Nothing can be charged with it. Ask the buyer to approve a new one with link_buyer if they want to continue.";
    case "expired":
      return "This link has expired (the approval email lapsed unapproved, or the permission ended). Nothing can be charged with it. Send a new one with link_buyer if the buyer wants to continue.";
  }
}

export const getBuyerLinkTool = defineTool({
  name: "get_buyer_link",
  title: "Check a buyer link",
  description: [
    "Check a buyer link made with link_buyer: whether the buyer has approved it, its limits, how much was spent this calendar month and how much is left.",
    "Call it after link_buyer to see whether the buyer has approved yet (do not poll in a loop: ask the buyer, or check once they say they approved), and before a saved_method checkout if you need to know what is left.",
    "Needs the buyer's email as well as the buyer_link_id. Only an active link can be charged.",
    "Report the numbers as given; never invent or estimate amounts.",
  ].join(" "),
  inputSchema,
  outputSchema: buyerLinkOutputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  run: async (input, { deps }) => {
    if (!input.buyer_link_id.trim()) invalid("buyer_link_id is required; use the buyer_link_id from link_buyer.");
    const view = await getBuyerLinkStatus(deps, { buyerLinkId: input.buyer_link_id, buyerEmail: input.buyer_email });
    return ok(linkOutput(view), linkSummary(view));
  },
});
