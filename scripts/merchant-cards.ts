// What does the payment provider know about a buyer's email? Prints how many Dodo customers match
// it and how many payment methods the API lists for each, then whether one is usable for a buyer
// link. Counts only: no ids and no card details.
// Usage: pnpm merchant:cards <slug> <buyer-email>
import { deps, run, usage } from "./_core";
import { DodoAdapter } from "../src/adapters/dodo";

const [slug, email] = process.argv.slice(2);
if (!slug || !email || slug.startsWith("-")) usage("pnpm merchant:cards <slug> <buyer-email>");

void run(async () => {
  const merchant = await deps.db.merchant.findUnique({ where: { slug } });
  if (!merchant) throw new Error(`No merchant with slug "${slug}"`);
  console.log(`Merchant: ${merchant.name} (${merchant.slug}, ${merchant.dodoEnvironment})`);
  const adapter = deps.adapterFor(merchant);
  if (!(adapter instanceof DodoAdapter)) throw new Error("This script only knows Dodo merchants");

  const { customers, methodCounts } = await adapter.inspectSavedMethods(email);
  console.log(`Dodo customers matching ${email}: ${customers}`);
  methodCounts.forEach((n, i) => console.log(`  customer ${i + 1}: ${n} payment method${n === 1 ? "" : "s"} listed by the API`));

  const usable = await adapter.findSavedPaymentMethod(email);
  console.log(
    usable
      ? "Usable for a buyer link: yes (a saved card the API lists)."
      : "Usable for a buyer link: no. The API lists no saved card, so a buyer link cannot be approved yet.",
  );
});
