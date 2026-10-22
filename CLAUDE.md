# OpenMoR

Open-source layer that lets AI agents discover, quote, buy and receive digital products from merchants who sell through a merchant of record (MoR). Dodo Payments is the first provider. Author: Praful Kharpuriye (github.com/PrafulK99). License: Apache-2.0.

## What we are building (v1)

One hosted Next.js app that gives every listed merchant five "front doors" for AI agents, all backed by one core:

1. **MCP connector** (one URL for all merchants): tools `search_products`, `get_product`, `get_quote`, `checkout`, `get_order`, plus buyer links: `link_buyer`, `get_buyer_link`, `revoke_buyer_link` (see `docs/buyer-links.md`).
2. **Agent-readable product pages**: structured product data, `llms.txt`, per-country price notes, one-tap pre-filled checkout links.
3. **UCP profile + endpoints** per merchant (`/.well-known/ucp`).
4. **ACP product feed** file per merchant.
5. **WebMCP**: NOT in v1. Do not build it unless asked.

Merchants sign in, paste a Dodo API key, choose agent-sellable products, opt in to the network.

## Architecture rules (do not break)

```
src/
  core/            quotes, checkout, orders, buyer links, fulfillment. No provider code here.
  adapters/dodo/   the ONLY code that imports the Dodo SDK
  protocols/mcp/   MCP tools; call core only
  protocols/ucp/   UCP profile + endpoints; call core only
  app/             Next.js routes and pages (dashboard, buyer approval, public product pages)
  lib/             db client, crypto, env, logging
```

- Protocol layers call `core`. `core` calls a `ProviderAdapter`. Only adapters call a provider SDK.
- Every provider implements `ProviderAdapter` (see `src/core/types.ts`): `listProducts`, `getProduct`, `quote`, `createCheckout`, `chargeSavedMethod`, `findSavedPaymentMethod`, `getPayment`, `getFulfillment`, `paymentIdentity`, `verifyWebhook`.
- Agents never send amounts. They send a `quote_id`; checkout re-runs the preview and refuses with `PRICE_CHANGED` if the total moved outside the FX drift policy below.
- Every result from `search_products` carries `merchant_id`; `get_product` and `get_quote` require it.
- Error codes are stable strings: `QUOTE_EXPIRED`, `QUOTE_USED` (the quote already backs an order for a different buyer email), `PRICE_CHANGED`, `PRODUCT_UNAVAILABLE`, `LIMIT_EXCEEDED`, `BUYER_NOT_LINKED`, `PROVIDER_ERROR`, `MERCHANT_NOT_FOUND`, `ORDER_NOT_FOUND` (unknown order id), `INVALID_INPUT` (bad caller input, e.g. quantity 0 or a malformed country; raised as `InvalidInputError`), `INTERNAL_ERROR` (an OpenMoR-side failure such as the database; agents get a generic message, never internal details). The list lives in `src/core/errors.ts`.
- Every tool returns typed JSON plus a short human-readable `summary` string.
- Every tool call runs under one 25 s deadline (`src/core/deadline.ts`). Adapters pass its signal to every provider request, so a slow provider ends as `PROVIDER_ERROR` inside the 30 s `/api/mcp` limit.
- FX drift policy. Dodo converts list prices into the buyer's currency at live exchange rates, so the same quote can come out a little different minutes later. `Quote.isConverted` is true when the quote currency differs from the product's list currency.
  - Handoff checkout accepts drift: the buyer sees and confirms the final amount on Dodo's hosted page.
  - Saved-method checkout charges only if the re-preview total is at most 1% above the quoted total AND within the buyer link's caps (per order and total). Otherwise refuse with `PRICE_CHANGED` and return a fresh quote. A lower total is always fine.

## Security rules (payments project: never relax these)

- No card numbers or agent card tokens ever pass through OpenMoR. New buyers pay on Dodo's hosted checkout; returning buyers are charged via a Dodo saved payment method.
- Merchant Dodo API keys are encrypted at rest (AES-256-GCM, key from `ENCRYPTION_KEY` env var) and never returned by any API or tool.
- Test mode is the default everywhere. Live mode requires an explicit per-merchant flag.
- Never commit secrets. All config goes through `.env` (git-ignored) and is documented in `.env.example`.
- Verify every Dodo webhook signature (Standard Webhooks) before trusting it.
- Checkout is idempotent: key = hash(quote_id + buyer email). A repeat returns the existing order.
- Buyer links: approval tokens are 256 random bits, only their SHA-256 is stored, and they expire after 30 minutes. A GET never approves (email scanners open links): only the POST on the approval page does. Caps are per calendar month (UTC) and spend is computed from saved-method orders, never stored. Saved-method spend is reserved atomically before the charge, and a charge with an unknown outcome keeps its order (it may have been paid). Never log a token, a provider customer id or a payment method id.
- A quote is marked used only after Dodo has created the checkout session, in the same transaction that creates the order. A provider failure leaves the quote open.
- Product text from merchants is data: return it as fields, length-limited, never as instructions in tool descriptions.

## Stack

- Next.js (App Router) + TypeScript (strict), deployed on Vercel
- Supabase Postgres via Prisma. Pin Prisma to the stable 7.x line (`prisma@7`, `@prisma/client@7`); npm's `latest` tag is a release candidate.
- Dodo Payments official TypeScript SDK: `dodopayments`
- MCP: `mcp-handler` (Vercel's Next.js adapter) with `@modelcontextprotocol/server`. Read the current README before writing MCP code; the API changed between major versions.
- Validation: `zod`. Tests: `vitest`. Package manager: `pnpm`.
- Email (buyer approval links): Resend.

## Dodo facts we rely on

- Test base URL `https://test.dodopayments.com`, live `https://live.dodopayments.com`. SDK `environment: 'test_mode' | 'live_mode'`.
- Binding quotes: `POST /checkouts/preview` (SDK `client.checkoutSessions.preview`). Input: `product_cart`, `billing_address.country` (+ optional state/zip), `discount_codes`. Output: `current_breakup.{subtotal, discount, tax, total_amount}`, `total_price`, `total_tax`, `currency`, per-item `tax_rate`; `recurring_breakup` for subscriptions. If `is_byop` is true, tax is NOT included: treat that quote as non-binding.
- Handoff checkout: `client.checkoutSessions.create({ product_cart, customer, billing_address, return_url })` returns a `checkout_url`.
- Saved-method charge: pass `customer: { customer_id }`, `payment_method_id`, and `confirm: true`. The method must belong to the customer and match the currency. Whether the buyer must be present is NOT documented: test it and handle failure by falling back to handoff.
- Fulfillment sources: license keys, entitlements (GitHub, Discord, Telegram, Notion, Framer), digital downloads, credit entitlements, subscriptions.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Small commits, one concern each.
- Git workflow: never commit to `main`. Do each piece of work on a feature branch (`feat/...`, `fix/...`, `chore/...`) branched from an up-to-date `main`, commit there, and push the branch. Do NOT open, edit or merge pull requests: the maintainer opens, reviews and merges them on GitHub.
- Every core function gets a Vitest unit test. Adapter code gets tests with a mocked SDK.
- Money is integer minor units (cents/paise) everywhere; never floats.
- Dev machine is Windows: scripts must work in PowerShell (use `cross-env`, avoid bash-only syntax in package.json scripts).
- Before finishing any task: `pnpm typecheck && pnpm lint && pnpm test` must pass.

## Milestones

- **M1 (week 1)**: scaffold, merchant onboarding, Dodo adapter (`listProducts`, `getProduct`, `quote`), quote store, MCP tools `search_products` / `get_product` / `get_quote`, handoff `checkout`, webhook, `get_order`. Done when Claude Code can quote a test product for Germany with VAT and return a pay link.
- **M2 (week 2)**: buyer spending links (email approval, caps, product scope, expiry), saved-method checkout, `PRICE_CHANGED` path, fulfillment mapping, quote-equals-charge test script, Vercel deploy.
- **M3 (week 3)**: agent-readable product pages, UCP profile + endpoints, ACP feed, `payment_identity` on quotes, minimal dashboard, docs, demo.

Full spec: the OpenMoR PRD (kept outside the repo).