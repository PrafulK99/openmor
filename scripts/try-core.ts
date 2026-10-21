// End-to-end check of core against the real database and Dodo test mode:
// search "sharethings", quote the first result for Germany, read the stored quote back.
// Usage: pnpm try:core
import { deps, printTable, run } from "./_core";
import { formatMoney } from "../src/core/money";
import { createQuote, getQuote } from "../src/core/quotes";
import { searchProducts } from "../src/core/search";

const IST = "Asia/Kolkata";

/** "2026-10-22 00:12:00" in the given IANA time zone. */
function formatTime(date: Date, timeZone: string): string {
  // sv-SE gives an ISO-like "YYYY-MM-DD HH:mm:ss" layout.
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

void run(async () => {
  const results = await searchProducts(deps, { query: "sharethings" });
  console.log(`Search "sharethings": ${results.length} result(s)\n`);
  printTable(
    ["#", "Product id", "Merchant", "Name", "List price", "Type"],
    results.map((r, i) => [
      String(i + 1),
      r.productId,
      `${r.merchantName} (${r.merchantSlug})`,
      r.name,
      formatMoney(r.price, r.currency),
      r.billingType,
    ]),
    [4],
  );
  const first = results[0];
  if (!first) {
    console.log("\nNothing to quote. Run merchant:sync and merchant:sellable first.");
    return;
  }

  console.log(`\nQuoting "${first.name}" for a buyer in Germany (DE)...`);
  const quote = await createQuote(deps, {
    merchantId: first.merchantId,
    productId: first.productId,
    quantity: 1,
    buyer: { country: "DE" },
  });

  const stored = await getQuote(deps, quote.id);
  if (!stored) throw new Error(`Quote ${quote.id} was not found after creating it`);
  const m = (n: number) => formatMoney(n, stored.currency);
  console.log(`  quote id    ${stored.id}`);
  console.log(`  status      ${stored.status}${stored.isBinding ? "" : " (NON-BINDING)"}`);
  console.log(`  subtotal    ${m(stored.subtotal)}`);
  console.log(`  discount    ${m(stored.discount)}`);
  console.log(`  tax         ${m(stored.tax)}`);
  console.log(`  total       ${m(stored.total)}`);
  console.log(`  tax rate    ${stored.taxRateBps === null ? "n/a" : `${(stored.taxRateBps / 100).toFixed(2)}%`}`);
  console.log(`  converted   ${stored.isConverted ? `yes (list price in ${first.currency})` : "no"}`);
  if (stored.recurring) console.log(`  renews at   ${m(stored.recurring.total)}`);
  const minutesLeft = Math.round((stored.expiresAt.getTime() - Date.now()) / 60000);
  console.log(`  expires at  ${formatTime(stored.expiresAt, IST)} IST (${formatTime(stored.expiresAt, "UTC")} UTC), in ${minutesLeft} min`);
});
