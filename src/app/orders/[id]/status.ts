import type { OrderView } from "@/core/orders";
import { formatMoney } from "@/core/money";

export interface OrderPageModel {
  heading: string;
  detail: string;
  productName: string;
  amount: string;
}

/**
 * What the public order page shows. Deliberately no licence keys, portal links or buyer
 * email: the page is reachable by anyone with the order id. The agent delivers the keys,
 * and the buyer also gets Dodo's receipt email.
 */
export function orderPageModel(order: OrderView): OrderPageModel {
  const paid = order.status === "paid" || order.status === "fulfilled";
  const amount = order.charged ?? order.quoted;
  const base = { productName: order.productName, amount: formatMoney(amount.total, amount.currency) };
  if (paid) {
    return {
      ...base,
      heading: "Payment received",
      detail: "You can close this page. Your agent will give you your licence key or access, and Dodo Payments has emailed your receipt.",
    };
  }
  if (order.status === "failed" || order.status === "cancelled") {
    return {
      ...base,
      heading: order.status === "failed" ? "Payment failed" : "Payment cancelled",
      detail: "No money was taken. Ask your agent for the checkout link to try again.",
    };
  }
  if (order.status === "refunded") {
    return { ...base, heading: "Refunded", detail: "This order was refunded." };
  }
  return {
    ...base,
    heading: "Waiting for payment",
    detail: "If you just paid, it can take a moment to confirm. Refresh this page shortly.",
  };
}
