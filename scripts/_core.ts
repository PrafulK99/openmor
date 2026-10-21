// Shared wiring for local scripts: real database, real adapters, readable errors.
import "./_env";
import { adapterFor } from "../src/adapters";
import type { CatalogProduct } from "../src/core/catalog";
import type { CoreDeps } from "../src/core/deps";
import { InvalidInputError, OpenMorError } from "../src/core/errors";
import { formatMoney } from "../src/core/money";
import { db } from "../src/lib/db";

export const deps: CoreDeps = { db, adapterFor };

/** Run a script body, print errors without stack traces, and always close the DB pool. */
export async function run(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (err) {
    if (err instanceof OpenMorError) console.error(`Error ${err.code}: ${err.message}`);
    else if (err instanceof InvalidInputError) console.error(`Invalid input: ${err.message}`);
    else console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

export function usage(text: string): never {
  console.error(`Usage: ${text}`);
  process.exit(2);
}

export function printTable(headers: string[], rows: string[][], rightAlign: number[] = []): void {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    "  " + cells.map((c, i) => (rightAlign.includes(i) ? c.padStart(widths[i]!) : c.padEnd(widths[i]!))).join("  ");
  console.log(line(headers));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
}

export function printCatalog(products: CatalogProduct[]): void {
  printTable(
    ["Product id", "Dodo id", "Name", "Price", "Type", "Sellable", "Active"],
    products.map((p) => [
      p.id,
      p.providerProductId,
      p.name,
      formatMoney(p.priceAmount, p.currency),
      p.isRecurring ? "subscription" : "one-time",
      p.agentSellable ? "yes" : "no",
      p.active ? "yes" : "no",
    ]),
    [3],
  );
}
