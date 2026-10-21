// Provider-neutral types. Nothing here may import a provider SDK.
// Money is always integer minor units (cents, paise). Currency is an ISO 4217 code.

export type ProviderEnvironment = "test_mode" | "live_mode";

export type BillingInterval = "day" | "week" | "month" | "year";

export interface BillingPeriod {
  interval: BillingInterval;
  /** Number of intervals between charges, e.g. 3 + "month" = quarterly. */
  count: number;
}

export interface Product {
  id: string;
  name: string | null;
  description: string | null;
  /** List price in minor units. For pay-what-you-want products this is the minimum. Null if the provider omits it. */
  price: number | null;
  currency: string | null;
  kind: "one_time" | "subscription";
  /** Set for subscriptions, null for one-time products. */
  billing: BillingPeriod | null;
  /** True when the subscription also bills metered usage on top of the fixed price. */
  usageBased: boolean;
  payWhatYouWant: boolean;
  /** Null means the provider endpoint used did not tell us (e.g. list vs. detail). */
  licenseKeys: boolean | null;
  credits: boolean | null;
  /** Provider entitlement kinds attached to the product, e.g. "github", "digital_files". */
  entitlementTypes: string[];
}

export interface QuoteItemInput {
  productId: string;
  quantity: number;
}

export interface QuoteInput {
  items: QuoteItemInput[];
  /** ISO 3166-1 alpha-2 buyer country, e.g. "DE". */
  country: string;
  state?: string;
  zip?: string;
  discountCodes?: string[];
}

export interface QuoteBreakup {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

export interface ProviderQuoteItem {
  productId: string;
  quantity: number;
  /** Tax rate in basis points: 1900 = 19% VAT. Integer, like money. */
  taxRateBps: number;
  /** Tax on this line in minor units. */
  tax: number;
  taxInclusive: boolean;
  subscription: boolean;
}

export interface ProviderQuote extends QuoteBreakup {
  currency: string;
  items: ProviderQuoteItem[];
  /** What each renewal costs, for carts with a subscription. Null for one-time carts. */
  recurring: QuoteBreakup | null;
  /** False when the provider says tax is not included (e.g. Dodo BYOP). Non-binding quotes must not be charged as-is. */
  isBinding: boolean;
}

// The types below back methods that are not implemented yet. They are a first cut
// and will firm up when checkout, webhooks and fulfillment are built.

export interface CheckoutInput {
  quote: QuoteInput;
  customer: { email: string; name?: string };
  returnUrl: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSession {
  sessionId: string;
  checkoutUrl: string;
}

export interface SavedMethodChargeInput extends CheckoutInput {
  customerId: string;
  paymentMethodId: string;
}

export type PaymentStatus = "processing" | "succeeded" | "failed" | "cancelled";

export interface Payment {
  paymentId: string;
  status: PaymentStatus;
  currency: string;
  /** Amount charged including tax, in minor units. */
  total: number;
  tax: number;
  checkoutSessionId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  /** Metadata we attached at checkout (e.g. openmor_order_id), as strings. */
  metadata: Record<string, string>;
}

export interface DeliveredLicenseKey {
  id: string;
  /** SECRET. Fetched live for the buyer's agent; never stored or logged by OpenMoR. */
  key: string;
  status: string;
  activationsLimit: number | null;
  expiresAt: string | null;
}

/** What a paid order delivered, read live from the provider. Contains secrets: never persist it. */
export interface Fulfillment {
  paymentId: string;
  licenseKeys: DeliveredLicenseKey[];
  subscription: { id: string; status: string; nextBillingDate: string | null } | null;
  credits: { name: string; balance: string; unit: string }[];
  /** Short-lived link where the buyer manages purchases and subscriptions. Treat as a secret. */
  portalUrl: string | null;
}

/** Who the buyer is actually paying, shown on quotes so agents can tell the buyer. */
export interface PaymentIdentity {
  provider: string;
  merchantOfRecord: string;
}

export interface WebhookInput {
  headers: Record<string, string>;
  rawBody: string;
}

/** A verified provider webhook, normalized. Unknown event kinds come through as type only. */
export interface WebhookEvent {
  /** Delivery id, stable across retries (Standard Webhooks `webhook-id`). */
  id: string;
  type: string;
  occurredAt: string;
  /** Set for payment events. */
  payment?: Payment;
}

export interface ProviderAdapter {
  listProducts(): Promise<Product[]>;
  getProduct(productId: string): Promise<Product>;
  quote(input: QuoteInput): Promise<ProviderQuote>;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  chargeSavedMethod(input: SavedMethodChargeInput): Promise<Payment>;
  getPayment(paymentId: string): Promise<Payment>;
  getFulfillment(paymentId: string): Promise<Fulfillment>;
  paymentIdentity(): PaymentIdentity;
  verifyWebhook(input: WebhookInput): Promise<WebhookEvent>;
}
