import type { CoreDeps } from "@/core/deps";
import { OpenMorError } from "@/core/errors";
import type { Fulfillment } from "@/core/types";

/**
 * What a paid order delivered, read live from the provider every time. The result contains
 * secrets (licence keys, a customer portal link): hand it to the caller and never store or log
 * it. Order.fulfillment holds only the non-secret ids used to look it up.
 * Returns null when the order is not paid yet.
 */
export async function getOrderFulfillment(deps: CoreDeps, orderId: string): Promise<Fulfillment | null> {
  const order = await deps.db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new OpenMorError("INVALID_INPUT", `No order "${orderId}"`);
  if ((order.status !== "paid" && order.status !== "fulfilled") || !order.providerPaymentId) return null;

  const merchant = await deps.db.merchant.findUnique({ where: { id: order.merchantId } });
  if (!merchant) throw new OpenMorError("MERCHANT_NOT_FOUND", "Merchant of this order no longer exists");
  return deps.adapterFor(merchant).getFulfillment(order.providerPaymentId);
}
