/** Number of minor-unit digits for an ISO 4217 currency (USD 2, JPY 0, KWD 3). */
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

/** Format integer minor units for display, e.g. (1999, "EUR") -> "€19.99". Display only: never parse it back. */
export function formatMoney(minor: number, currency: string, locale = "en-US"): string {
  if (!Number.isInteger(minor)) {
    throw new TypeError(`formatMoney expects integer minor units, got ${minor}`);
  }
  const digits = currencyDigits(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 10 ** digits);
}
