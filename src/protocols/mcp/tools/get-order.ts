import { z } from "zod";
import { normalizeEmail } from "@/core/checkout";
import { getOrderFulfillment } from "@/core/fulfillment";
import { getOrder } from "@/core/orders";
import { money, moneySchema } from "../format";
import { invalid, ok } from "../results";
import { defineTool } from "../tool";

const inputSchema = z.object({
  order_id: z.string().describe("order_id from checkout."),
  buyer_email: z
    .string()
    .optional()
    .describe("The email used at checkout. Required to receive the licence key and portal link once paid."),
});

const fulfillmentSchema = z.object({
  license_keys: z.array(
    z.object({
      key: z
        .string()
        .nullable()
        .describe('Give this to the buyer. Do not store or repeat it elsewhere. Null while status is "pending".'),
      status: z.string(),
      activations_limit: z.number().int().nullable(),
      expires_at: z.string().nullable(),
    }),
  ),
  subscription: z
    .object({ id: z.string(), status: z.string(), next_billing_date: z.string().nullable() })
    .nullable(),
  credits: z.array(z.object({ name: z.string(), balance: z.string(), unit: z.string() })),
  portal_url: z.string().nullable().describe("Short-lived link where the buyer manages the purchase. Private to the buyer."),
});

const outputSchema = z.object({
  order_id: z.string(),
  status: z.enum(["pending_payment", "paid", "failed", "cancelled", "fulfilled", "refunded"]),
  product_name: z.string(),
  quoted_total: moneySchema,
  amount_charged: moneySchema.nullable().describe("What was actually charged. Null until paid."),
  paid_at: z.string().nullable(),
  checkout_url: z.string().nullable().describe("Payment link, while the order is not paid."),
  fulfillment: fulfillmentSchema.nullable().describe("What the buyer received, fetched live. Null until paid, or without buyer_email."),
});

const PAID = new Set(["paid", "fulfilled"]);

export const getOrderTool = defineTool({
  name: "get_order",
  title: "Get order status and delivery",
  description: [
    "Check an order's payment status and, once paid, get what the buyer bought.",
    "Call it after the buyer says they have paid; do not poll it in a loop.",
    "Pass buyer_email (the one used at checkout) to receive the delivery: licence keys, subscription status, credits and a customer portal link, fetched live from Dodo Payments.",
    "Give the licence key and portal link only to the buyer, and do not store or repeat them anywhere else. The buyer also gets Dodo's receipt email.",
    "If status is pending_payment the buyer has not finished paying: give them the checkout_url again. If it is failed, they can retry on the same link.",
    "Report amount_charged as what the buyer paid; it can differ slightly from quoted_total for converted prices. Never invent a status, price or licence key.",
  ].join(" "),
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  run: async (input, { deps }) => {
    const orderId = input.order_id.trim();
    if (!orderId) invalid("order_id is required; use the order_id from checkout.");
    const order = await getOrder(deps, orderId);
    if (!order) invalid(`No order "${orderId}". Use the order_id exactly as returned by checkout.`);

    const paid = PAID.has(order.status);
    let emailMatches = false;
    if (input.buyer_email !== undefined && input.buyer_email.trim() !== "") {
      const row = await deps.db.order.findUnique({ where: { id: order.id }, select: { buyerEmail: true } });
      emailMatches = row?.buyerEmail === normalizeEmail(input.buyer_email);
      if (!emailMatches) invalid("buyer_email does not match this order; use the email given at checkout.");
    }

    // Secrets (licence keys, portal link) are fetched live, only for the buyer, and never stored.
    const f = paid && emailMatches ? await getOrderFulfillment(deps, order.id) : null;
    const fulfillment = f
      ? {
          license_keys: f.licenseKeys.map((k) => ({
            key: k.key,
            status: k.status,
            activations_limit: k.activationsLimit,
            expires_at: k.expiresAt,
          })),
          subscription: f.subscription
            ? { id: f.subscription.id, status: f.subscription.status, next_billing_date: f.subscription.nextBillingDate }
            : null,
          credits: f.credits,
          portal_url: f.portalUrl,
        }
      : null;

    const quoted = money(order.quoted.total, order.quoted.currency);
    const charged = order.charged ? money(order.charged.total, order.charged.currency) : null;

    let summary: string;
    if (paid) {
      const amount = charged ? charged.formatted : quoted.formatted;
      const drift = charged && charged.amount_minor !== quoted.amount_minor ? ` (quoted ${quoted.formatted})` : "";
      if (fulfillment) {
        const issued = fulfillment.license_keys.filter((k) => k.key !== null).length;
        const pending = fulfillment.license_keys.length - issued;
        const parts = [
          issued ? `${issued} licence key${issued === 1 ? "" : "s"}` : null,
          pending ? `${pending} licence key${pending === 1 ? "" : "s"} still being issued (call get_order again later)` : null,
          fulfillment.subscription ? `subscription ${fulfillment.subscription.status}` : null,
          fulfillment.portal_url ? "a customer portal link" : null,
        ].filter(Boolean);
        summary = `Payment received: ${amount}${drift} for ${order.productName}.${parts.length ? ` Delivered: ${parts.join(", ")}; give them to the buyer.` : ""}`;
      } else {
        summary = `Payment received: ${amount}${drift} for ${order.productName}. Call get_order again with buyer_email to get the licence key and portal link.`;
      }
    } else if (order.status === "pending_payment") {
      summary = `Waiting for payment of ${quoted.formatted} for ${order.productName}. If the buyer has not paid yet, give them the checkout link again.`;
    } else if (order.status === "failed" || order.status === "cancelled") {
      summary = `The last payment attempt for ${order.productName} ${order.status === "failed" ? "failed" : "was cancelled"}. The buyer can try again on the same checkout link.`;
    } else {
      summary = `Order for ${order.productName} is ${order.status}.`;
    }

    return ok(
      {
        order_id: order.id,
        status: order.status,
        product_name: order.productName,
        quoted_total: quoted,
        amount_charged: charged,
        paid_at: order.paidAt ? order.paidAt.toISOString() : null,
        checkout_url: paid ? null : order.checkoutUrl,
        fulfillment,
      },
      summary,
    );
  },
});
