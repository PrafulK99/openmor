// The only module that talks to the Dodo Payments SDK.
import DodoPayments, { APIError } from "dodopayments";
import type { CountryCode } from "dodopayments/resources/misc";
import { NotImplementedError, ProviderError, WebhookVerificationError } from "@/core/errors";
import type {
  CheckoutInput,
  CheckoutSession,
  DeliveredLicenseKey,
  Fulfillment,
  Payment,
  PaymentIdentity,
  Product,
  ProviderAdapter,
  ProviderEnvironment,
  ProviderQuote,
  QuoteInput,
  WebhookEvent,
  WebhookInput,
} from "@/core/types";
import { mapListedProduct, mapPayment, mapProduct, mapQuote, mapWebhookEvent } from "./map";

export interface DodoAdapterOptions {
  apiKey: string;
  environment: ProviderEnvironment;
  /** Standard Webhooks secret ("whsec_..."). Only needed for verifyWebhook. */
  webhookSecret?: string | null;
}

const PROVIDER = "Dodo Payments";
const WEBHOOK_HEADERS = ["webhook-id", "webhook-timestamp", "webhook-signature"] as const;

function billingAddress(q: QuoteInput) {
  return {
    country: q.country.toUpperCase() as CountryCode,
    ...(q.state ? { state: q.state } : {}),
    ...(q.zip ? { zipcode: q.zip } : {}),
  };
}

export class DodoAdapter implements ProviderAdapter {
  readonly #client: DodoPayments;
  readonly #apiKey: string;
  readonly #webhookSecret: string | null;
  readonly environment: ProviderEnvironment;

  constructor({ apiKey, environment, webhookSecret }: DodoAdapterOptions) {
    if (!apiKey) throw new Error("DodoAdapter needs an API key");
    this.#apiKey = apiKey;
    this.#webhookSecret = webhookSecret || null;
    this.environment = environment;
    // Pass every option explicitly: left out, the SDK falls back to DODO_PAYMENTS_* env vars
    // and to live_mode. The caller decides the key and mode, never process.env.
    this.#client = new DodoPayments({
      bearerToken: apiKey,
      environment,
      baseURL: null,
      webhookKey: null,
    });
  }

  async listProducts(): Promise<Product[]> {
    return this.#call(async () => {
      const products: Product[] = [];
      for await (const p of this.#client.products.list()) {
        products.push(mapListedProduct(p));
      }
      return products;
    });
  }

  async getProduct(productId: string): Promise<Product> {
    return this.#call(async () => mapProduct(await this.#client.products.retrieve(productId)));
  }

  async quote(input: QuoteInput): Promise<ProviderQuote> {
    const preview = await this.#call(() =>
      this.#client.checkoutSessions.preview({
        product_cart: input.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
        billing_address: billingAddress(input),
        ...(input.discountCodes?.length ? { discount_codes: input.discountCodes } : {}),
      }),
    );
    return mapQuote(preview);
  }

  /** Hosted (handoff) checkout: the buyer pays on Dodo's page. No card data touches OpenMoR. */
  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const session = await this.#call(() =>
      this.#client.checkoutSessions.create({
        product_cart: input.quote.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
        customer: { email: input.customer.email, ...(input.customer.name ? { name: input.customer.name } : {}) },
        billing_address: billingAddress(input.quote),
        ...(input.quote.discountCodes?.length ? { discount_codes: input.quote.discountCodes } : {}),
        return_url: input.returnUrl,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      }),
    );
    if (!session.checkout_url) {
      throw new ProviderError(PROVIDER, undefined, "checkout session has no checkout_url");
    }
    return { sessionId: session.session_id, checkoutUrl: session.checkout_url };
  }

  async chargeSavedMethod(): Promise<Payment> {
    throw new NotImplementedError("DodoAdapter.chargeSavedMethod");
  }

  async getPayment(paymentId: string): Promise<Payment> {
    return this.#call(async () => mapPayment(await this.#client.payments.retrieve(paymentId)));
  }

  /**
   * Read what a payment delivered, live. The result holds secrets (licence keys, portal link):
   * callers pass it straight to the buyer's agent and must not store or log it.
   */
  async getFulfillment(paymentId: string): Promise<Fulfillment> {
    return this.#call(async () => {
      const payment = await this.#client.payments.retrieve(paymentId);
      const customerId = payment.customer?.customer_id;
      const subscriptionId = payment.subscription_id ?? null;

      const subscription = subscriptionId ? await this.#client.subscriptions.retrieve(subscriptionId) : null;
      const productIds = new Set([
        ...(payment.product_cart ?? []).map((p) => p.product_id),
        ...(subscription ? [subscription.product_id] : []),
      ]);

      // Is this grant/key from this order? A grant records the payment (one-time) or the
      // subscription (recurring) that triggered it, which ties the key to this exact order.
      const ours = (r: { payment_id?: string | null; subscription_id?: string | null }) =>
        r.payment_id === paymentId || (subscriptionId !== null && r.subscription_id === subscriptionId);

      const licenseKeys: DeliveredLicenseKey[] = [];
      if (customerId) {
        for (const productId of productIds) {
          const product = await this.#client.products.retrieve(productId);
          const entitlementIds = product.entitlements
            .filter((e) => e.integration_type === "license_key")
            .map((e) => e.id);

          // Current model: licence keys are an entitlement on the product, delivered as grants.
          // Grants can be filtered by customer, not payment, so the payment is matched here.
          for (const entitlementId of entitlementIds) {
            for await (const g of this.#client.entitlements.grants.list(entitlementId, { customer_id: customerId })) {
              if (g.integration_type !== "license_key" || !ours(g) || g.status === "Revoked" || g.status === "Failed") {
                continue;
              }
              licenseKeys.push(
                g.license_key
                  ? {
                      id: g.license_key.id,
                      key: g.license_key.key,
                      status: g.license_key.status,
                      activationsLimit: g.license_key.activations_limit ?? null,
                      expiresAt: g.license_key.expires_at ?? null,
                    }
                  : // A manually fulfilled grant has no key until the merchant delivers it.
                    { id: g.id, key: null, status: "pending", activationsLimit: null, expiresAt: null },
              );
            }
          }

          // Legacy products use the deprecated license_key_enabled flag and have no entitlement.
          // Their keys carry payment_id/subscription_id, matched the same way.
          if (entitlementIds.length === 0 && product.license_key_enabled) {
            for await (const k of this.#client.licenseKeys.list({ customer_id: customerId, product_id: productId })) {
              if (!ours(k)) continue;
              licenseKeys.push({
                id: k.id,
                key: k.key,
                status: k.status,
                activationsLimit: k.activations_limit ?? null,
                expiresAt: k.expires_at ?? null,
              });
            }
          }
        }
      }

      const credits = customerId
        ? (await this.#client.customers.listCreditEntitlements(customerId)).items.map((c) => ({
            name: c.name,
            balance: c.balance,
            unit: c.unit,
          }))
        : [];
      const portalUrl = customerId
        ? (await this.#client.customers.customerPortal.create(customerId, { send_email: false })).link
        : null;

      return {
        paymentId,
        licenseKeys,
        subscription: subscription
          ? { id: subscription.subscription_id, status: subscription.status, nextBillingDate: subscription.next_billing_date ?? null }
          : null,
        credits,
        portalUrl,
      };
    });
  }

  paymentIdentity(): PaymentIdentity {
    throw new NotImplementedError("DodoAdapter.paymentIdentity");
  }

  /**
   * Verify a Standard Webhooks signature and normalize the event. Always verifies: the SDK's
   * unwrap() silently skips verification when no headers are passed, so we require all three.
   */
  async verifyWebhook({ headers, rawBody }: WebhookInput): Promise<WebhookEvent> {
    if (!this.#webhookSecret) throw new WebhookVerificationError("no webhook secret configured for this merchant");
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const signed: Record<string, string> = {};
    for (const name of WEBHOOK_HEADERS) {
      const value = lower[name];
      if (!value) throw new WebhookVerificationError(`missing ${name} header`);
      signed[name] = value;
    }
    let body: unknown;
    try {
      body = this.#client.webhooks.unwrap(rawBody, { headers: signed, key: this.#webhookSecret });
    } catch {
      // Don't echo the library's reason: it can include signature material.
      throw new WebhookVerificationError("invalid signature");
    }
    return mapWebhookEvent(signed["webhook-id"]!, body);
  }

  /** Run an SDK call and turn any failure into a ProviderError that never contains a secret. */
  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw this.#toProviderError(err);
    }
  }

  #toProviderError(err: unknown): ProviderError {
    const status = err instanceof APIError ? err.status : undefined;
    let message = err instanceof Error ? err.message : String(err);
    // The SDK prefixes the status ("404 Not found"); we carry status separately.
    if (status !== undefined && message.startsWith(`${status} `)) {
      message = message.slice(String(status).length + 1);
    }
    return new ProviderError(PROVIDER, status, redact(redact(message, this.#apiKey), this.#webhookSecret));
  }
}

function redact(text: string, secret: string | null): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}
