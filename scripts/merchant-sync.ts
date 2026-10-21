// Sync a merchant's catalog from Dodo and print it.
// Usage: pnpm merchant:sync <slug>
import { deps, printCatalog, run, usage } from "./_core";
import { syncCatalog } from "../src/core/catalog";
import { getMerchantBySlug } from "../src/core/merchants";

const slug = process.argv[2];
if (!slug || slug.startsWith("-")) usage("pnpm merchant:sync <slug>");

void run(async () => {
  const merchant = await getMerchantBySlug(deps, slug);
  console.log(`Syncing catalog for ${merchant.name} (${merchant.slug}, ${merchant.dodoEnvironment})...`);
  const r = await syncCatalog(deps, merchant.id);
  console.log(`Created ${r.created}, updated ${r.updated}, deactivated ${r.deactivated}.`);
  if (r.skipped.length) console.log(`Skipped (no price): ${r.skipped.join(", ")}`);
  console.log("");
  printCatalog(r.products);
});
