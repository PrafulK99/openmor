// Register a merchant interactively. The Dodo API key is read with echo off and never printed.
// Usage: pnpm merchant:add
import { deps, run } from "./_core";
import { createInterface } from "node:readline/promises";
import { createMerchant } from "../src/core/merchants";
import { readHidden } from "./_prompt";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

void run(async () => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let name: string, slug: string, email: string;
  try {
    name = (await rl.question("Merchant name: ")).trim();
    const suggested = slugify(name);
    slug = (await rl.question(`Slug [${suggested}]: `)).trim() || suggested;
    email = (await rl.question("Contact email: ")).trim();
  } finally {
    rl.close();
  }

  const dodoApiKey = (await readHidden("Dodo test-mode API key (hidden): ")).trim();
  console.log(dodoApiKey ? `Key received (${dodoApiKey.length} characters). Checking it with Dodo...` : "No key entered.");

  const merchant = await createMerchant(deps, { name, slug, email, dodoApiKey });
  console.log("\nMerchant created:");
  console.log(`  id           ${merchant.id}`);
  console.log(`  name         ${merchant.name}`);
  console.log(`  slug         ${merchant.slug}`);
  console.log(`  email        ${merchant.email}`);
  console.log(`  environment  ${merchant.dodoEnvironment}${merchant.liveModeEnabled ? " (live enabled)" : ""}`);
  console.log(`  in network   ${merchant.networkOptIn ? "yes" : "no"}`);
  console.log(`\nNext: pnpm merchant:sync ${merchant.slug}`);
});
