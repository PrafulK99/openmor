import { z } from "zod";
import { nowFrom } from "@/core/deps";
import { getProductDetails } from "@/core/products";
import { createQuote } from "@/core/quotes";
import { buildQuoteOutput, quoteOutputSchema } from "../quote-output";
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
  outputSchema: quoteOutputSchema,
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

    const { structured, summary } = buildQuoteOutput(q, product, nowFrom(deps));
    return ok(structured, summary);
  },
});
