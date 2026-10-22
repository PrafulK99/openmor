// Does the merchant's payment provider have a saved card for this buyer's email? Prints yes or no.
// Use it after a test purchase to check a card was saved before approving a buyer link.
// Prints no ids and no card details.
// Usage: pnpm merchant:cards <slug> <buyer-email>
import { deps, run, usage } from "./_core";

const [slug, email] = process.argv.slice(2);
if (!slug || !email || slug.startsWith("-")) usage("pnpm merchant:cards <slug> <buyer-email>");

void run(async () => {
  const merchant = await deps.db.merchant.findUnique({ where: { slug } });
  if (!merchant) throw new Error(`No merchant with slug "${slug}"`);
  console.log(`Merchant: ${merchant.name} (${merchant.slug}, ${merchant.dodoEnvironment})`);
  const saved = await deps.adapterFor(merchant).findSavedPaymentMethod(email);
  console.log(
    saved
      ? `Saved card found for ${email}: a buyer link for this buyer can be approved.`
      : `No saved card found for ${email}: the buyer must pay once with a normal checkout first, and the card must be saved.`,
  );
});
