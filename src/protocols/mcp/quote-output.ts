// Turns a stored quote into the structured result and one-line summary agents see. Shared by
// get_quote and by checkout's PRICE_CHANGED answer, which carries a fresh quote.
import { z } from "zod";
import type { ProductDetails } from "@/core/products";
import type { QuoteView } from "@/core/quotes";
import { bpsToPercent, cadence, countryName, money, moneySchema, taxName } from "./format";

export const quoteOutputSchema = z.object({
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

export function buildQuoteOutput(
  q: QuoteView,
  product: ProductDetails,
  now: Date,
): { structured: z.infer<typeof quoteOutputSchema>; summary: string } {
  const quantity = q.quantity;
  const country = q.country;
  const state = q.state ?? undefined;
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
  const expiresInSeconds = Math.max(0, Math.floor((q.expiresAt.getTime() - now.getTime()) / 1000));
  const minutes = Math.round(expiresInSeconds / 60);
  const untilUtc = q.expiresAt.toISOString().slice(11, 16);
  const validFor = minutes >= 1 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : "less than a minute";
  summary += ` Quote valid for ${validFor} (until ${untilUtc} UTC).`;

  return {
    structured: {
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
  };
}
