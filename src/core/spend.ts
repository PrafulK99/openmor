// What a buyer link has spent this calendar month. Never stored: always computed from orders,
// so there is no running total to drift out of step and a new month starts at zero by itself.
import type { PrismaClient } from "@/generated/prisma/client";

/** [start, end) of the UTC calendar month containing `now`. */
export function utcMonthWindow(now: Date): { start: Date; end: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) };
}

/**
 * Orders that count as spend: saved-method orders on the link that are paid or fulfilled, plus
 * saved-method orders still waiting for the provider to confirm (the charge was sent, so the
 * money is committed; counting it stops quick repeat calls from overshooting the cap).
 * Failed, cancelled and refunded orders do not count. Handoff orders never do: the buyer
 * pays those themselves on the provider's page.
 */
export const SPEND_STATUSES = ["pending_payment", "paid", "fulfilled"] as const;

export interface MonthlyAllowance {
  /** Spent so far this month, in minor units of the link's currency. */
  spent: number;
  /** What is left of the monthly cap. Never negative. */
  remaining: number;
  /** When the monthly cap resets: the start of next month, UTC. */
  resetsAt: Date;
}

export async function monthlyAllowance(
  db: Pick<PrismaClient, "order">,
  link: { id: string; currency: string; monthlyCapAmount: number },
  now: Date,
): Promise<MonthlyAllowance> {
  const { start, end } = utcMonthWindow(now);
  const orders = await db.order.findMany({
    where: {
      buyerLinkId: link.id,
      checkoutMode: "saved_method",
      status: { in: [...SPEND_STATUSES] },
      createdAt: { gte: start, lt: end },
    },
    select: { totalAmount: true, chargedTotalAmount: true, chargedCurrency: true },
  });
  // What was actually charged, when known (it can differ slightly from the quoted total).
  const spent = orders.reduce(
    (sum, o) => sum + (o.chargedTotalAmount != null && o.chargedCurrency === link.currency ? o.chargedTotalAmount : o.totalAmount),
    0,
  );
  return { spent, remaining: Math.max(0, link.monthlyCapAmount - spent), resetsAt: end };
}
