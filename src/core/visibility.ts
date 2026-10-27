// The one rule for which merchants agents and crawlers may see. Every surface uses it: the public
// pages and index, the markdown twins, llms.txt and the sitemap, the UCP catalog, and the MCP tools
// (search_products, get_product, get_quote, checkout).
//
// A merchant is visible only if it opted in to the network AND runs in live mode. A merchant in test
// mode is hidden unless the deployment sets PUBLIC_INCLUDE_TEST_MERCHANTS=true (deps.includeTestMerchants).
// A hidden merchant is treated exactly like an unknown one: callers return their normal "not found".
import type { Prisma } from "@/generated/prisma/client";

/** What the visibility rule needs from the caller's deps. */
export interface VisibilityDeps {
  /** True only when the deployment opted in to showing test-mode merchants. Absent means false. */
  includeTestMerchants?: boolean | undefined;
}

/** The merchant columns that decide test or live. Same rule as the provider environment (adapters/index.ts). */
export interface MerchantModeFields {
  dodoEnvironment: "test_mode" | "live_mode";
  liveModeEnabled: boolean;
}

/** Select these wherever a view needs `isTest`. Flags are never returned themselves, only the derived boolean. */
export const merchantModeSelect = { dodoEnvironment: true, liveModeEnabled: true } as const;

/** Live mode needs both the live environment and the explicit live flag. Anything else is test mode. */
export function isTestMerchant(merchant: MerchantModeFields): boolean {
  return !(merchant.dodoEnvironment === "live_mode" && merchant.liveModeEnabled === true);
}

/** Prisma filter for visible merchants. Spread it into a merchant `where`, or into a product's `merchant: { is }`. */
export function visibleMerchantWhere(deps: VisibilityDeps): Prisma.MerchantWhereInput {
  return deps.includeTestMerchants === true
    ? { networkOptIn: true }
    : { networkOptIn: true, dodoEnvironment: "live_mode", liveModeEnabled: true };
}

/** The same rule for a merchant row that is already loaded. */
export function isMerchantVisible(deps: VisibilityDeps, merchant: MerchantModeFields & { networkOptIn: boolean }): boolean {
  return merchant.networkOptIn && (deps.includeTestMerchants === true || !isTestMerchant(merchant));
}

// Fixed strings. Never built from merchant text.

/** Prefix for names and titles of test products. */
export const TEST_MARKER = "[TEST]";

/** The sentence every surface uses to say what a test catalog is. */
export const TEST_NOTE =
  "TEST CATALOG: this merchant is in test mode. Its products and checkout links are for testing only, and nothing here is a real purchase.";

/** "[TEST] Name" for a test merchant's product, the name unchanged otherwise. */
export function markTest(name: string, isTest: boolean): string {
  return isTest ? `${TEST_MARKER} ${name}` : name;
}
