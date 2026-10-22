// The only module that talks to the Dodo Payments SDK.
import DodoPayments, { APIError } from "dodopayments";
import type { CountryCode } from "dodopayments/resources/misc";
import { currentDeadline } from "@/core/deadline";
import { BuyerActionRequiredError, NotImplementedError, ProviderError, WebhookVerificationError } from "@/core/errors";
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
  SavedMethodChargeInput,
  SavedPaymentMethod,
  WebhookEvent,
  WebhookInput,
} from "@/core/types";
import { createDodoClient } from "./client";
import { mapListedProduct, mapPayment, mapProduct, mapQuote, mapWebhookEvent } from "./map";

export interface DodoAdapterOptions {
  apiKey: string;
  environment: ProviderEnvironment;
  /** Standard Webhooks secret ("whsec_..."). Only needed for verifyWebhook. */
  webhookSecret?: string | null;
}

/** The SDK's per-request options (it does not export the type publicly). */
type RequestOptions = NonNullable<Parameters<DodoPayments["products"]["retrieve"]>[1]>;

const PROVIDER = "Dodo Payments";
/** Most customers with one email we look through when searching for a saved card. */
const MAX_CUSTOMERS_PER_EMAIL = 5;
/**
 * Payment statuses after a confirmed saved-method charge that mean the buyer has to do
 * something (authenticate, pick another card). A failed or cancelled payment counts too.
 * UNVERIFIED against live Dodo behaviour: confirm in test mode (see docs/buyer-links.md).
 */
const BUYER_NEEDED_STATUSES = new Set(["requires_customer_action", "requires_payment_method", "requires_confirmation"]);
/** What the agent sees when a tool call's deadline cuts Dodo off. */
export const DODO_SLOW_MESSAGE = "Dodo is slow right now, try again in a minute";
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
    // Explicit key, mode, timeout and retries: see createDodoClient.
    this.#client = createDodoClient({ apiKey, environment });
  }

  async listProducts(): Promise<Product[]> {
    return this.#call(async (opts) => {
      const products: Product[] = [];
      for await (const p of this.#client.products.list(undefined, opts)) {
        products.push(mapListedProduct(p));
      }
      return products;
    });
  }

  async getProduct(productId: string): Promise<Product> {
    return this.#call(async (opts) => mapProduct(await this.#client.products.retrieve(productId, opts)));
  }

  async quote(input: QuoteInput): Promise<ProviderQuote> {
    const preview = await this.#call((opts) =>
      this.#client.checkoutSessions.preview(
        {
        product_cart: input.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
        billing_address: billingAddress(input),
          ...(input.discountCodes?.length ? { discount_codes: input.discountCodes } : {}),
        },
        opts,
      ),
    );
    return mapQuote(preview);
  }

  /** Hosted (handoff) checkout: the buyer pays on Dodo's page. No card data touches OpenMoR. */
  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const session = await this.#call((opts) =>
      this.#client.checkoutSessions.create(
        {
        product_cart: input.quote.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
        customer: { email: input.customer.email, ...(input.customer.name ? { name: input.customer.name } : {}) },
        billing_address: billingAddress(input.quote),
        ...(input.quote.discountCodes?.length ? { discount_codes: input.quote.discountCodes } : {}),
        return_url: input.returnUrl,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
        opts,
      ),
    );
    if (!session.checkout_url) {
      throw new ProviderError(PROVIDER, undefined, "checkout session has no checkout_url");
    }
    return { sessionId: session.session_id, checkoutUrl: session.checkout_url };
  }

  /**
   * Charge a card the buyer saved earlier, without them present: a confirmed checkout session
   * for an existing customer and payment method. No card data touches OpenMoR.
   * Throws BuyerActionRequiredError when Dodo cannot complete it without the buyer.
   */
  async chargeSavedMethod(input: SavedMethodChargeInput): Promise<Payment> {
    return this.#call(async (opts) => {
      let session;
      try {
        session = await this.#client.checkoutSessions.create(
          {
            product_cart: input.quote.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
            customer: { customer_id: input.customerId },
            payment_method_id: input.paymentMethodId,
            confirm: true,
            billing_address: billingAddress(input.quote),
            ...(input.quote.discountCodes?.length ? { discount_codes: input.quote.discountCodes } : {}),
            return_url: input.returnUrl,
            ...(input.metadata ? { metadata: input.metadata } : {}),
          },
          opts,
        );
      } catch (err) {
        // A 4xx means Dodo refused the request, so no payment exists: the buyer can pay on the
        // hosted page instead. Anything else (timeout, 5xx) leaves the outcome unknown and is
        // rethrown, because a payment may exist.
        if (err instanceof APIError && err.status !== undefined && err.status >= 400 && err.status < 500) {
          throw new BuyerActionRequiredError(`Dodo refused the charge (HTTP ${err.status})`);
        }
        throw err;
      }
      if (!session.payment_id) throw new BuyerActionRequiredError("Dodo created no payment for the saved method");
      const payment = await this.#client.payments.retrieve(session.payment_id, opts);
      const mapped = mapPayment(payment);
      const needsBuyer = (payment.status && BUYER_NEEDED_STATUSES.has(payment.status)) || mapped.status === "failed" || mapped.status === "cancelled";
      if (needsBuyer) throw new BuyerActionRequiredError(`payment status ${payment.status ?? mapped.status}`);
      return mapped;
    });
  }

  /**
   * The buyer's saved card, found through their Dodo customer record (matched on exact email).
   * Prefers cards that are not marked unusable for repeat charges, most recently used first.
   */
  async findSavedPaymentMethod(email: string): Promise<SavedPaymentMethod | null> {
    const wanted = email.trim().toLowerCase();
    return this.#call(async (opts) => {
      let checked = 0;
      // The email filter may match loosely, so compare exactly.
      for await (const customer of this.#client.customers.list({ email: wanted }, opts)) {
        if (customer.email.trim().toLowerCase() !== wanted) continue;
        if (++checked > MAX_CUSTOMERS_PER_EMAIL) break;
        const { items } = await this.#client.customers.retrievePaymentMethods(customer.customer_id, opts);
        const best = items
          .filter((m) => m.payment_method === "card" && m.recurring_enabled !== false)
          .sort((a, b) => (Date.parse(b.last_used_at ?? "") || 0) - (Date.parse(a.last_used_at ?? "") || 0))[0];
        if (best) return { customerId: customer.customer_id, paymentMethodId: best.payment_method_id };
      }
      return null;
    });
  }

  async getPayment(paymentId: string): Promise<Payment> {
    return this.#call(async (opts) => mapPayment(await this.#client.payments.retrieve(paymentId, opts)));
  }

  /**
   * Read what a payment delivered, live. The result holds secrets (licence keys, portal link):
   * callers pass it straight to the buyer's agent and must not store or log it.
   */
  async getFulfillment(paymentId: string): Promise<Fulfillment> {
    return this.#call(async (opts) => {
      const payment = await this.#client.payments.retrieve(paymentId, opts);
      const customerId = payment.customer?.customer_id;
      const subscriptionId = payment.subscription_id ?? null;

      const subscription = subscriptionId ? await this.#client.subscriptions.retrieve(subscriptionId, opts) : null;
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
          const product = await this.#client.products.retrieve(productId, opts);
          const entitlementIds = product.entitlements
            .filter((e) => e.integration_type === "license_key")
            .map((e) => e.id);

          // Current model: licence keys are an entitlement on the product, delivered as grants.
          // Grants can be filtered by customer, not payment, so the payment is matched here.
          for (const entitlementId of entitlementIds) {
            for await (const g of this.#client.entitlements.grants.list(entitlementId, { customer_id: customerId }, opts)) {
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
            for await (const k of this.#client.licenseKeys.list({ customer_id: customerId, product_id: productId }, opts)) {
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
        ? (await this.#client.customers.listCreditEntitlements(customerId, opts)).items.map((c) => ({
            name: c.name,
            balance: c.balance,
            unit: c.unit,
          }))
        : [];
      const portalUrl = customerId
        ? (await this.#client.customers.customerPortal.create(customerId, { send_email: false }, opts)).link
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

  /**
   * Run SDK calls and turn any failure into a ProviderError that never contains a secret.
   * `opts` carries the current tool call's deadline (see core/deadline): every SDK request
   * inside fn must receive it, so all of them share one time budget. When it fires, the SDK
   * aborts the request in flight and does not retry.
   */
  async #call<T>(fn: (opts: RequestOptions) => Promise<T>): Promise<T> {
    const deadline = currentDeadline();
    try {
      return await fn(deadline ? { signal: deadline } : {});
    } catch (err) {
      if (deadline?.aborted) throw new ProviderError(PROVIDER, undefined, "tool call deadline exceeded", DODO_SLOW_MESSAGE);
      if (err instanceof ProviderError || err instanceof BuyerActionRequiredError) throw err;
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
