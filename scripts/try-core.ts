// End-to-end check of core against the real database and Dodo test mode:
// search "sharethings", quote the first result for Germany, read the stored quote back.
// Usage: pnpm try:core
import { deps, printTable, run } from "./_core";
import { formatMoney } from "../src/core/money";
import { createQuote, getQuote } from "../src/core/quotes";
import { searchProducts } from "../src/core/search";

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
  if (stored.recurring) console.log(`  renews at   ${m(stored.recurring.total)}`);
  console.log(`  expires at  ${stored.expiresAt.toISOString()} (in ${Math.round((stored.expiresAt.getTime() - Date.now()) / 60000)} min)`);
});
