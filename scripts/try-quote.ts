// Local smoke test: list your Dodo test products and quote each for DE, IN and US.
// Usage: pnpm try:quote   (needs DODO_TEST_API_KEY in .env; always runs in test mode)
import { config } from "dotenv";
import { DodoAdapter } from "../src/adapters/dodo";
import { ProviderError } from "../src/core/errors";
import { formatMoney } from "../src/core/money";
import type { Product, QuoteInput } from "../src/core/types";

config({ quiet: true });

const BUYERS: { label: string; address: Omit<QuoteInput, "items"> }[] = [
  { label: "DE", address: { country: "DE" } },
  { label: "IN", address: { country: "IN" } },
  { label: "US (CA 94102)", address: { country: "US", state: "CA", zip: "94102" } },
];

const HEADERS = ["Country", "Currency", "Subtotal", "Discount", "Tax", "Total", "Tax rate"];

function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function printTable(rows: string[][]): void {
  const widths = HEADERS.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    "  " + cells.map((c, i) => (i < 2 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ");
  console.log(line(HEADERS));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
}

function describeProduct(p: Product): string {
  const price = p.price !== null && p.currency ? formatMoney(p.price, p.currency) : "no price";
  const cadence = p.billing ? ` every ${p.billing.count} ${p.billing.interval}(s)` : " one-time";
  return `${p.name ?? "(unnamed)"}  [${p.id}]  list price ${price}${cadence}`;
}

async function main(): Promise<void> {
  const apiKey = process.env.DODO_TEST_API_KEY;
  if (!apiKey) {
    console.error("DODO_TEST_API_KEY is not set. Add your Dodo test-mode key to .env.");
    process.exit(1);
  }

  const dodo = new DodoAdapter({ apiKey, environment: "test_mode" });
  const products = await dodo.listProducts();
  console.log(`Found ${products.length} test product(s).\n`);

  for (const product of products) {
    console.log(describeProduct(product));
    const rows: string[][] = [];
    const notes: string[] = [];

    for (const buyer of BUYERS) {
      try {
        const q = await dodo.quote({ items: [{ productId: product.id, quantity: 1 }], ...buyer.address });
        const m = (minor: number) => formatMoney(minor, q.currency);
        const rates = [...new Set(q.items.map((i) => bpsToPercent(i.taxRateBps)))].join(", ");
        rows.push([buyer.label, q.currency, m(q.subtotal), m(q.discount), m(q.tax), m(q.total), rates]);
        if (q.recurring) {
          notes.push(`${buyer.label}: renews at ${m(q.recurring.total)} (tax ${m(q.recurring.tax)})`);
        }
        if (!q.isBinding) notes.push(`${buyer.label}: NON-BINDING quote (BYOP, tax not included)`);
      } catch (err) {
        const msg = err instanceof ProviderError ? err.message : String(err);
        rows.push([buyer.label, "-", "-", "-", "-", "-", "-"]);
        notes.push(`${buyer.label}: ${msg}`);
      }
    }

    printTable(rows);
    for (const n of notes) console.log(`  * ${n}`);
    console.log("");
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
