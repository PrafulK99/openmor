// Store a merchant's Dodo webhook signing secret, encrypted. The secret is typed with echo off.
// Usage: pnpm merchant:webhook <slug>
import { deps, run, usage } from "./_core";
import { getMerchantBySlug, setWebhookSecret } from "../src/core/merchants";
import { readHidden } from "./_prompt";

const slug = process.argv[2];
if (!slug || slug.startsWith("-")) usage("pnpm merchant:webhook <slug>");

void run(async () => {
  const merchant = await getMerchantBySlug(deps, slug);
  console.log(`Merchant: ${merchant.name} (${merchant.slug}, ${merchant.dodoEnvironment})`);
  console.log("In Dodo, the webhook endpoint for this merchant is:");
  console.log(`  https://<your-public-host>/api/webhooks/dodo/${merchant.id}\n`);

  const secret = (await readHidden("Webhook signing secret from Dodo, whsec_... (hidden): ")).trim();
  console.log(secret ? `Secret received (${secret.length} characters).` : "No secret entered.");

  await setWebhookSecret(deps, merchant.id, secret);
  console.log("Stored encrypted. Webhooks for this merchant will now be verified with it.");
});
