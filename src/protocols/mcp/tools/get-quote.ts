import { z } from "zod";
import { nowFrom } from "@/core/deps";
import { getProductDetails } from "@/core/products";
import { createQuote } from "@/core/quotes";
import { bpsToPercent, cadence, countryName, money, moneySchema, taxName } from "../format";
import { invalid, ok } from "../results";
import { defineTool } from "../tool";

const MAX_QUANTITY = 100;

const inputSchema = z.object({
  merchant_id: z.string().describe("merchant_id exactly as returned by search_products."),
  product_id: z.string().describe("product_id exactly as returned by search_products."),
  quantity: z.number().optional().describe(`How many to buy, a whole number from 1 to ${MAX_QUANTITY}. Defaults to 1.`),
  buyer_country: z.string().describe('Buyer\'s billing country as an ISO 3166-1 alpha-2 code, e.g. "DE", "IN", "US". Ask the buyer if unknown.'),
  buyer_state: z.string().optional().describe('Buyer\'s state or province, e.g. "CA". Needed for accurate US sales tax.'),
  buyer_zip: z.string().optional().describe('Buyer\'s postal code, e.g. "94102". Improves US sales tax accuracy.'),
});

const outputSchema = z.object({
  quote_id: z.string().describe("Pass this to checkout while expires_in_seconds is above zero."),
  merchant_id: z.string(),
  product_id: z.string(),
  product_name: z.string(),
  quantity: z.number().int(),
  buyer_country: z.string(),
  buyer_state: z.string().nullable(),
  buyer_zip: z.string().nullable(),
  currency: z.string().describe("Currency the buyer pays in. Quote prices in this currency."),
  subtotal: moneySchema,
  discount: moneySchema,
  tax: moneySchema,
  total: moneySchema.describe("What the buyer pays now, tax included (unless is_binding is false)."),
  tax_rate_percent: z.number().nullable().describe("e.g. 19 for 19% VAT. Null if the provider gave none."),
  is_converted: z.boolean().describe("True if converted from the list currency: the amount may move slightly at checkout."),
  list_currency: z.string().describe("Currency of the merchant's list price."),
  is_binding: z.boolean().describe("False means tax is not included and the total is only an estimate."),
  expires_at: z.iso
    .datetime()
    .describe('When the quote stops being usable, ISO 8601 in UTC with a trailing Z, e.g. "2026-10-21T19:37:00.000Z".'),
  expires_in_seconds: z
    .number()
    .int()
    .describe("Seconds until the quote expires, counted when this response was made. Use this to judge validity."),
  renewal: z
    .object({
      total: moneySchema,
      tax: moneySchema,
      interval: z.string().nullable().describe('e.g. "every month".'),
    })
    .nullable()
    .describe("For subscriptions: what each renewal costs. Null for one-time products."),
});

export const getQuoteTool = defineTool({
  name: "get_quote",
  title: "Get a price quote",
  description: [
    "Get the price a buyer will pay for a product, with tax for their country, and a quote_id that checkout needs.",
    "Call it after search_products (and optionally get_product), once you know the buyer's country. The quote is valid for 15 minutes; get a new one if it expires.",
    "Judge whether a quote is still valid from expires_in_seconds (seconds left when it was returned), not by comparing the expires_at date with your own idea of today's date: expires_at is in UTC, which can be a different calendar day from the buyer's.",
    "Always tell the buyer the quote's total in the quote's currency (e.g. EUR for Germany), not the list price from search.",
    "Never invent, convert or round prices yourself: use the formatted amounts returned here.",
    "If is_binding is false the merchant handles tax itself and the total excludes tax: present it as an estimate.",
    "If is_converted is true the price was converted from the list currency and the final amount may move slightly at checkout: tell the buyer.",
    "For US buyers pass buyer_state and buyer_zip for accurate sales tax.",
  ].join(" "),
  inputSchema,
  outputSchema,
  // Creates a quote record and calls the payment provider.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  run: async (input, { deps, agentSessionId }) => {
    const merchantId = input.merchant_id.trim();
    const productId = input.product_id.trim();
    if (!merchantId) invalid("merchant_id is required; use the merchant_id from search_products.");
    if (!productId) invalid("product_id is required; use the product_id from search_products.");
    const quantity = input.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      invalid(`quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
    }
    const country = input.buyer_country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) invalid("buyer_country must be a 2-letter code like DE.");
    const state = input.buyer_state?.trim() || undefined;
    const zip = input.buyer_zip?.trim() || undefined;
    if (state && state.length > 64) invalid('buyer_state must be at most 64 characters, e.g. "CA".');
    if (zip && zip.length > 32) invalid('buyer_zip must be at most 32 characters, e.g. "94102".');

    // Checks eligibility before asking the provider, and gives us the name and renewal interval.
    const product = await getProductDetails(deps, { merchantId, productId });
    const q = await createQuote(deps, {
      merchantId,
      productId,
      quantity,
      buyer: { country, ...(state ? { state } : {}), ...(zip ? { zip } : {}) },
      ...(agentSessionId ? { agentSessionId } : {}),
    });

    const m = (n: number) => money(n, q.currency);
    const every = cadence(product.billing);
    const renewal = q.recurring ? { total: m(q.recurring.total), tax: m(q.recurring.tax), interval: every } : null;
    const taxRatePercent = q.taxRateBps === null ? null : bpsToPercent(q.taxRateBps);

    const name = quantity > 1 ? `${quantity} × ${product.name}` : product.name;
    const where = `${countryName(country)}${state ? ` (${state})` : ""}`;
    const tax = taxName(country);
    const total = m(q.total).formatted;
    let summary: string;
    if (!q.isBinding) {
      summary = `${name}: estimated ${total} before tax. This merchant handles tax itself, so the final amount will differ.`;
    } else if (q.tax > 0) {
      const rate = taxRatePercent !== null ? `${taxRatePercent}% ` : `${m(q.tax).formatted} `;
      summary = `${name}: ${total} including ${rate}${tax} for ${where}.`;
    } else {
      summary = `${name}: ${total}, no ${tax} for ${where}.`;
    }
    if (q.isConverted) {
      summary += ` Converted from ${product.currency}, so the final amount may move slightly at checkout.`;
    }
    if (renewal) summary += ` Renews at ${renewal.total.formatted} ${every ?? "each billing period"}.`;
    const expiresInSeconds = Math.max(0, Math.floor((q.expiresAt.getTime() - nowFrom(deps).getTime()) / 1000));
    const minutes = Math.round(expiresInSeconds / 60);
    const untilUtc = q.expiresAt.toISOString().slice(11, 16);
    const validFor = minutes >= 1 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : "less than a minute";
    summary += ` Quote valid for ${validFor} (until ${untilUtc} UTC).`;

    return ok(
      {
        quote_id: q.id,
        merchant_id: q.merchantId,
        product_id: q.productId,
        product_name: product.name,
        quantity: q.quantity,
        buyer_country: q.country,
        buyer_state: q.state,
        buyer_zip: q.zip,
        currency: q.currency,
        subtotal: m(q.subtotal),
        discount: m(q.discount),
        tax: m(q.tax),
        total: m(q.total),
        tax_rate_percent: taxRatePercent,
        is_converted: q.isConverted,
        list_currency: product.currency,
        is_binding: q.isBinding,
        expires_at: q.expiresAt.toISOString(),
        expires_in_seconds: expiresInSeconds,
        renewal,
      },
      summary,
    );
  },
});
