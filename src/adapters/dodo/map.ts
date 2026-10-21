// Pure mapping from Dodo SDK shapes to our core types. No network calls here.
import type { CheckoutSessionPreviewResponse } from "dodopayments/resources/checkout-sessions";
import type {
  Price,
  Product as DodoProduct,
  ProductListResponse,
} from "dodopayments/resources/products/products";
import type { TimeInterval } from "dodopayments/resources/subscriptions";
import type { Payment as DodoPayment } from "dodopayments/resources/payments";
import { limitText, TEXT_LIMITS } from "@/core/text";
import type { BillingPeriod, Payment, Product, ProviderQuote, QuoteBreakup, WebhookEvent } from "@/core/types";

const INTERVALS: Record<TimeInterval, BillingPeriod["interval"]> = {
  Day: "day",
  Week: "week",
  Month: "month",
  Year: "year",
};

interface PriceFacts {
  price: number | null;
  currency: string | null;
  billing: BillingPeriod | null;
  usageBased: boolean;
  payWhatYouWant: boolean;
}

function priceFacts(detail: Price | null | undefined): PriceFacts | null {
  if (!detail) return null;
  switch (detail.type) {
    case "one_time_price":
      return {
        price: detail.price,
        currency: detail.currency,
        billing: null,
        usageBased: false,
        payWhatYouWant: detail.pay_what_you_want ?? false,
      };
    case "recurring_price":
      return {
        price: detail.price,
        currency: detail.currency,
        billing: {
          interval: INTERVALS[detail.payment_frequency_interval],
          count: detail.payment_frequency_count,
        },
        usageBased: false,
        payWhatYouWant: false,
      };
    case "usage_based_price":
      return {
        price: detail.fixed_price,
        currency: detail.currency,
        billing: {
          interval: INTERVALS[detail.payment_frequency_interval],
          count: detail.payment_frequency_count,
        },
        usageBased: true,
        payWhatYouWant: false,
      };
  }
}

function base(p: ProductListResponse | DodoProduct, facts: PriceFacts | null) {
  return {
    id: p.product_id,
    name: limitText(p.name, TEXT_LIMITS.name),
    description: limitText(p.description, TEXT_LIMITS.description),
    kind: p.is_recurring ? ("subscription" as const) : ("one_time" as const),
    billing: facts?.billing ?? null,
    usageBased: facts?.usageBased ?? false,
    payWhatYouWant: facts?.payWhatYouWant ?? false,
    entitlementTypes: p.entitlements.map((e) => e.integration_type),
  };
}

/** Map a row from `products.list`. The list endpoint omits credit entitlements and the legacy license-key flag. */
export function mapListedProduct(p: ProductListResponse): Product {
  const facts = priceFacts(p.price_detail);
  const hasLicenseEntitlement = p.entitlements.some((e) => e.integration_type === "license_key");
  return {
    ...base(p, facts),
    price: facts?.price ?? p.price ?? null,
    currency: facts?.currency ?? p.currency ?? null,
    // A legacy license-key product shows no entitlement in the list, so "none seen" means unknown.
    licenseKeys: hasLicenseEntitlement ? true : null,
    credits: null,
  };
}

/** Map a full product from `products.retrieve`. */
export function mapProduct(p: DodoProduct): Product {
  const facts = priceFacts(p.price);
  return {
    ...base(p, facts),
    price: facts?.price ?? null,
    currency: facts?.currency ?? null,
    licenseKeys:
      p.license_key_enabled || p.entitlements.some((e) => e.integration_type === "license_key"),
    credits: p.credit_entitlements.length > 0,
  };
}

function breakup(b: {
  subtotal: number;
  discount: number;
  tax?: number | null;
  total_amount: number;
}): QuoteBreakup {
  return { subtotal: b.subtotal, discount: b.discount, tax: b.tax ?? 0, total: b.total_amount };
}

/** Map a checkout preview. `total` is Dodo's total_amount: the amount charged, not subtotal - discount + tax. */
export function mapQuote(r: CheckoutSessionPreviewResponse): ProviderQuote {
  return {
    currency: r.currency,
    ...breakup(r.current_breakup),
    items: r.product_cart.map((item) => ({
      productId: item.product_id,
      quantity: item.quantity,
      taxRateBps: item.tax_rate,
      tax: item.tax ?? 0,
      taxInclusive: item.tax_inclusive,
      subscription: item.is_subscription,
    })),
    recurring: r.recurring_breakup ? breakup(r.recurring_breakup) : null,
    // With BYOP the merchant's own processor handles tax, so Dodo's numbers exclude it.
    isBinding: !r.is_byop,
  };
}

const PAYMENT_STATUS: Partial<Record<NonNullable<DodoPayment["status"]>, Payment["status"]>> = {
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

/** Map a Dodo payment. `statusOverride` comes from the webhook event type, which is authoritative. */
export function mapPayment(p: DodoPayment, statusOverride?: Payment["status"]): Payment {
  return {
    paymentId: p.payment_id,
    status: statusOverride ?? (p.status ? (PAYMENT_STATUS[p.status] ?? "processing") : "processing"),
    currency: p.currency,
    total: p.total_amount,
    tax: p.tax ?? 0,
    checkoutSessionId: p.checkout_session_id ?? null,
    customerId: p.customer?.customer_id ?? null,
    subscriptionId: p.subscription_id ?? null,
    metadata: Object.fromEntries(Object.entries(p.metadata ?? {}).map(([k, v]) => [k, String(v)])),
  };
}

const PAYMENT_EVENTS: Record<string, Payment["status"]> = {
  "payment.succeeded": "succeeded",
  "payment.failed": "failed",
  "payment.cancelled": "cancelled",
  "payment.processing": "processing",
};

/** Normalize a verified webhook body. Only payment events carry a payment. */
export function mapWebhookEvent(webhookId: string, body: unknown): WebhookEvent {
  const event = (typeof body === "object" && body !== null ? body : {}) as {
    type?: unknown;
    timestamp?: unknown;
    data?: unknown;
  };
  const type = typeof event.type === "string" ? event.type.slice(0, 64) : "unknown";
  const occurredAt = typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
  const status = PAYMENT_EVENTS[type];
  if (status && typeof event.data === "object" && event.data !== null && "payment_id" in event.data) {
    return { id: webhookId, type, occurredAt, payment: mapPayment(event.data as DodoPayment, status) };
  }
  return { id: webhookId, type, occurredAt };
}
