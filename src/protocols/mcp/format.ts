// Shared output helpers for MCP tools: money objects and plain-English fragments.
import { z } from "zod";
import { formatMoney } from "@/core/money";
import type { BillingPeriod } from "@/core/types";

export const moneySchema = z.object({
  amount_minor: z.number().int().describe("Integer amount in the currency's minor unit (cents, paise)."),
  currency: z.string().describe("ISO 4217 currency code."),
  formatted: z.string().describe("Human-readable amount, e.g. €51.89. Show this to the buyer."),
});

export type Money = z.infer<typeof moneySchema>;

export function money(amountMinor: number, currency: string): Money {
  return { amount_minor: amountMinor, currency, formatted: formatMoney(amountMinor, currency) };
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

// What buyers call the tax in common countries. Anything else is just "tax".
const VAT = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT",
  "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB", "NO", "CH", "IS", "LI", "AE", "SA",
  "ZA", "TR",
]);
const GST = new Set(["IN", "AU", "NZ", "SG", "CA"]);

export function taxName(country: string): string {
  const c = country.toUpperCase();
  if (VAT.has(c)) return "VAT";
  if (GST.has(c)) return "GST";
  if (c === "US") return "sales tax";
  return "tax";
}

/** 1900 bps -> 19, 1850 -> 18.5. Display only. */
export function bpsToPercent(bps: number): number {
  return Math.round(bps) / 100;
}

/** "every month", "every 3 months". */
export function cadence(billing: BillingPeriod | null): string | null {
  if (!billing) return null;
  return billing.count === 1 ? `every ${billing.interval}` : `every ${billing.count} ${billing.interval}s`;
}
