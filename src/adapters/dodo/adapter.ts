// The only module that talks to the Dodo Payments SDK.
import DodoPayments, { APIError } from "dodopayments";
import type { CountryCode } from "dodopayments/resources/misc";
import { NotImplementedError, ProviderError } from "@/core/errors";
import type {
  CheckoutSession,
  Fulfillment,
  Payment,
  PaymentIdentity,
  Product,
  ProviderAdapter,
  ProviderEnvironment,
  ProviderQuote,
  QuoteInput,
  WebhookEvent,
} from "@/core/types";
import { mapListedProduct, mapProduct, mapQuote } from "./map";

export interface DodoAdapterOptions {
  apiKey: string;
  environment: ProviderEnvironment;
}

const PROVIDER = "Dodo Payments";

export class DodoAdapter implements ProviderAdapter {
  readonly #client: DodoPayments;
  readonly #apiKey: string;

  constructor({ apiKey, environment }: DodoAdapterOptions) {
    if (!apiKey) throw new Error("DodoAdapter needs an API key");
    this.#apiKey = apiKey;
    // Pass every option explicitly: left out, the SDK falls back to DODO_PAYMENTS_* env vars
    // and to live_mode. The caller decides the key and environment, never the environment.
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
        billing_address: {
          country: input.country.toUpperCase() as CountryCode,
          ...(input.state ? { state: input.state } : {}),
          ...(input.zip ? { zipcode: input.zip } : {}),
        },
        ...(input.discountCodes?.length ? { discount_codes: input.discountCodes } : {}),
      }),
    );
    return mapQuote(preview);
  }

  async createCheckout(): Promise<CheckoutSession> {
    throw new NotImplementedError("DodoAdapter.createCheckout");
  }

  async chargeSavedMethod(): Promise<Payment> {
    throw new NotImplementedError("DodoAdapter.chargeSavedMethod");
  }

  async getPayment(): Promise<Payment> {
    throw new NotImplementedError("DodoAdapter.getPayment");
  }

  async getFulfillment(): Promise<Fulfillment> {
    throw new NotImplementedError("DodoAdapter.getFulfillment");
  }

  paymentIdentity(): PaymentIdentity {
    throw new NotImplementedError("DodoAdapter.paymentIdentity");
  }

  async verifyWebhook(): Promise<WebhookEvent> {
    throw new NotImplementedError("DodoAdapter.verifyWebhook");
  }

  /** Run an SDK call and turn any failure into a ProviderError that never contains the API key. */
  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
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
    return new ProviderError(PROVIDER, status, redact(message, this.#apiKey));
  }
}

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}
