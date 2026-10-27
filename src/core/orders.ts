import type { Order, OrderStatus } from "@/generated/prisma/client";
import { nowFrom, type CoreDeps } from "@/core/deps";
import type { Payment } from "@/core/types";
import { isTestMerchant, merchantModeSelect, type MerchantModeFields } from "@/core/visibility";

/**
 * How far an order has progressed. Status only ever moves to a higher rank, so a late or
 * re-delivered webhook can never move an order backwards (a paid order stays paid).
 * failed and cancelled share a rank: a buyer can retry and still pay after either.
 */
export const ORDER_RANK: Record<OrderStatus, number> = {
  pending_payment: 0,
  failed: 1,
  cancelled: 1,
  paid: 2,
  fulfilled: 3,
  refunded: 4,
};

/** Statuses an order may move from to reach `target`. */
export function statusesBefore(target: OrderStatus): OrderStatus[] {
  return (Object.keys(ORDER_RANK) as OrderStatus[]).filter((s) => ORDER_RANK[s] < ORDER_RANK[target]);
}

/** Non-secret references kept on the order for fulfillment lookups. Never keys or URLs. */
export interface FulfillmentRefs {
  provider: "dodo";
  customerId: string | null;
  subscriptionId: string | null;
}

export interface OrderView {
  id: string;
  merchantId: string;
  quoteId: string;
  productId: string;
  productName: string;
  /** The merchant is in test mode: this order is not a real purchase. */
  isTest: boolean;
  status: OrderStatus;
  checkoutMode: "handoff" | "saved_method";
  checkoutUrl: string | null;
  /** Amounts from the accepted quote. */
  quoted: { currency: string; tax: number; total: number };
  /** What the provider actually charged; null until paid. */
  charged: { currency: string; tax: number; total: number } | null;
  paidAt: Date | null;
  createdAt: Date;
}

const orderInclude = {
  quote: { include: { product: { select: { id: true, name: true } } } },
  merchant: { select: merchantModeSelect },
} as const;

type OrderWithProduct = Order & { quote: { product: { id: string; name: string } }; merchant: MerchantModeFields };

export function toOrderView(o: OrderWithProduct): OrderView {
  return {
    id: o.id,
    merchantId: o.merchantId,
    quoteId: o.quoteId,
    productId: o.quote.product.id,
    productName: o.quote.product.name,
    isTest: isTestMerchant(o.merchant),
    status: o.status,
    checkoutMode: o.checkoutMode,
    checkoutUrl: o.checkoutUrl,
    quoted: { currency: o.currency, tax: o.taxAmount, total: o.totalAmount },
    charged:
      // Loose checks: treat a missing column (undefined) like NULL, never as a charge.
      o.chargedCurrency != null && o.chargedTotalAmount != null
        ? { currency: o.chargedCurrency, tax: o.chargedTaxAmount ?? 0, total: o.chargedTotalAmount }
        : null,
    paidAt: o.paidAt,
    createdAt: o.createdAt,
  };
}

export async function getOrder(deps: CoreDeps, orderId: string): Promise<OrderView | null> {
  const order = await deps.db.order.findUnique({ where: { id: orderId }, include: orderInclude });
  return order ? toOrderView(order) : null;
}

export async function loadOrderView(deps: CoreDeps, where: { id: string }): Promise<OrderView> {
  const order = await deps.db.order.findUniqueOrThrow({ where, include: orderInclude });
  return toOrderView(order);
}

/** Find the order a payment belongs to: our metadata first, then the checkout session, then the payment id. */
export async function findOrderForPayment(deps: CoreDeps, merchantId: string, payment: Payment): Promise<Order | null> {
  const orderId = payment.metadata.openmor_order_id;
  if (orderId) {
    const order = await deps.db.order.findFirst({ where: { id: orderId, merchantId } });
    if (order) return order;
  }
  if (payment.checkoutSessionId) {
    const order = await deps.db.order.findFirst({
      where: { providerCheckoutSessionId: payment.checkoutSessionId, merchantId },
    });
    if (order) return order;
  }
  return deps.db.order.findFirst({ where: { providerPaymentId: payment.paymentId, merchantId } });
}

function parseDate(iso: string, fallback: Date): Date {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/**
 * Apply a payment outcome to its order, forward only. Returns the matched order id (null when
 * the payment is not one of ours, e.g. the merchant's other sales) and whether anything changed.
 */
export async function applyPaymentEvent(
  deps: CoreDeps,
  merchantId: string,
  payment: Payment,
  occurredAt: string,
): Promise<{ orderId: string | null; changed: boolean }> {
  const order = await findOrderForPayment(deps, merchantId, payment);
  if (!order) return { orderId: null, changed: false };

  const target: OrderStatus | null =
    payment.status === "succeeded" ? "paid" : payment.status === "failed" ? "failed" : payment.status === "cancelled" ? "cancelled" : null;
  if (!target) return { orderId: order.id, changed: false };

  const refs: FulfillmentRefs = { provider: "dodo", customerId: payment.customerId, subscriptionId: payment.subscriptionId };
  const data =
    target === "paid"
      ? {
          status: target,
          providerPaymentId: payment.paymentId,
          paidAt: parseDate(occurredAt, nowFrom(deps)),
          chargedCurrency: payment.currency,
          chargedTaxAmount: payment.tax,
          chargedTotalAmount: payment.total,
          fulfillment: { ...refs },
        }
      : { status: target };

  // Conditional update: only applies if the order is still behind the target status.
  const { count } = await deps.db.order.updateMany({
    where: { id: order.id, status: { in: statusesBefore(target) } },
    data,
  });
  return { orderId: order.id, changed: count === 1 };
}
