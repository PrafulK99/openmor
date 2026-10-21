// Mark all of a merchant's products agent-sellable and opt the merchant into the network.
// Usage: pnpm merchant:sellable <slug> --all
import { deps, printCatalog, run, usage } from "./_core";
import { listCatalog, setAgentSellable } from "../src/core/catalog";
import { getMerchantBySlug, setNetworkOptIn } from "../src/core/merchants";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("-"));
if (!slug || !args.includes("--all")) usage("pnpm merchant:sellable <slug> --all");

void run(async () => {
  const merchant = await getMerchantBySlug(deps, slug);
  const count = await setAgentSellable(deps, merchant.id, "all", true);
  const updated = await setNetworkOptIn(deps, merchant.id, true);
  console.log(`Marked ${count} product(s) agent-sellable for ${merchant.name}.`);
  console.log(`Network opt-in: ${updated.networkOptIn ? "yes" : "no"}\n`);
  printCatalog(await listCatalog(deps, merchant.id));
});
