// Every tool returns snake_case JSON in structuredContent plus a one-line summary as text.
// Errors carry a stable code and a one-line hint telling the agent how to fix the call.
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { InvalidInputError, OpenMorError, type ErrorCode } from "@/core/errors";

export function ok(structured: Record<string, unknown>, summary: string): CallToolResult {
  return { content: [{ type: "text", text: summary }], structuredContent: structured };
}

/** What to do next, per code. INVALID_INPUT messages already say how to fix the input. */
export const ERROR_HINTS: Record<ErrorCode, string> = {
  QUOTE_EXPIRED: "This quote can no longer be used (quotes last 15 minutes and check out once); call get_quote again for a fresh quote_id.",
  QUOTE_USED:
    "This quote was already checked out with a different buyer_email; call get_quote again for a fresh quote_id, or retry with the original buyer_email to get the existing order.",
  PRICE_CHANGED: "The price moved since the quote; show the buyer the fresh quote and ask again.",
  PRODUCT_UNAVAILABLE: "This product is not for sale to agents; call search_products and pick another product_id.",
  LIMIT_EXCEEDED: "This purchase is over the buyer's spending limit; ask the buyer to raise it or choose a cheaper product.",
  BUYER_NOT_LINKED: "The buyer has not approved agent purchases; send them the approval link first.",
  PROVIDER_ERROR: "The payment provider could not answer; wait a moment and retry once.",
  MERCHANT_NOT_FOUND: "Use a merchant_id exactly as returned by search_products.",
  ORDER_NOT_FOUND: "Use the order_id exactly as returned by checkout.",
  INVALID_INPUT: "Fix the argument named above and call the tool again.",
  INTERNAL_ERROR: "Something failed on OpenMoR's side; retry once, then tell the buyer to try later.",
};

export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    hint: z.string(),
  }),
});

export function toolError(err: unknown): CallToolResult {
  let code: ErrorCode = "INTERNAL_ERROR";
  // Never pass unknown errors through: they can contain hostnames, SQL or stack details.
  let message = "Internal error.";
  if (err instanceof OpenMorError) {
    code = err.code;
    // Core messages are sentence fragments; end them so the hint reads as its own sentence.
    message = /[.!?]$/.test(err.message.trim()) ? err.message.trim() : `${err.message.trim()}.`;
  }
  const hint = ERROR_HINTS[code];
  // For INVALID_INPUT the message is the fix ("buyer_country must be ..."), so one line is enough.
  const text = err instanceof InvalidInputError ? `${code}: ${message}` : `${code}: ${message} ${hint}`;
  return {
    isError: true,
    content: [{ type: "text", text }],
    structuredContent: { error: { code, message, hint } },
  };
}

/** Throw INVALID_INPUT with an agent-facing message naming the tool argument. */
export function invalid(message: string): never {
  throw new InvalidInputError(message);
}
