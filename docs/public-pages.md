# Agent-readable public pages

OpenMoR publishes plain, server-rendered pages for every merchant that opted in to the network, so an
agent (or a search engine, or a person) can see what is for sale without using the connector first.

| URL | What it is |
| --- | --- |
| `/m/{merchantSlug}` | The merchant, its agent-sellable products (name and short description), and how to get a price. |
| `/m/{merchantSlug}/{productId}` | One product: description, **list price before tax**, and schema.org `Product` + `Offer` JSON-LD. |
| `/llms.txt` | A plain-text index of the network for LLMs ([llmstxt.org](https://llmstxt.org/) format). |
| `/m/{merchantSlug}/llms.txt` | The same for one merchant: its products, list prices, how to buy. |
| `/sitemap.xml` | Every public merchant and product page. |
| `/robots.txt` | Allows `/m/` and `/llms.txt`; keeps crawlers off `/api/` and `/orders/`; points to the sitemap. |

## What is public

- A **merchant** appears only if it has opted in to the network.
- A **product** appears only if it is marked agent-sellable and is still active.
- Anything else (unknown slug, malformed slug, opted-out merchant, hidden or retired product) returns
  the **same bare 404**. Nothing says which of those it was.
- Never shown: merchant API keys or secrets, emails, internal merchant ids, provider ids, raw provider
  data, buyer data. The only id shown is the public product id (the one agents pass as `product_id`).

## Prices

Pages show the **list price with its own currency, before tax**, and say that tax is added per country
and that only a quote is binding. The binding price comes from `get_quote` through the OpenMoR connector.
JSON-LD marks the price `valueAddedTaxIncluded: false`. There is deliberately no tax-inclusive price
anywhere, because it would depend on the buyer's country and could be wrong.

## Merchant text is data

Names and descriptions are written by merchants, so they are treated as untrusted:

- Length-limited (names 120 characters, short descriptions 240, full descriptions 800).
- Invisible and bidirectional control characters removed; all whitespace including line breaks
  collapsed, so merchant text can never start a new line.
- On HTML pages React escapes it, and it is never placed in a link, attribute or one of our sentences.
- In JSON-LD it is escaped so it cannot end the script tag.
- In `llms.txt` (a file models read) it is also stripped of URLs, link syntax, HTML and code spans, shown
  only inside a quoted "Merchant description", and the file states that it is data about products and
  never instructions.

This reduces the risk of prompt injection through a product description. It cannot remove it: a model
that reads the file can still be influenced by words in a quoted description. Our own instructions
(connector URL, tool names, how to get a quote) are static text.

## Caching and freshness

Pages read our own database (filled by `pnpm merchant:sync` and `pnpm merchant:sellable`). They never call
Dodo. Reads are cached with `use cache`:

- served from cache for 5 minutes, refreshed in the background after **15 minutes**, dropped after a day;
- the build prerenders the merchants and products that exist at build time (up to 200 products); anything
  else is rendered completely on its first visit and then cached;
- the sync scripts run outside the Next.js server, so they cannot clear the cache. **A catalog or opt-in
  change shows up within about 15 minutes, or immediately on the next deploy.** Every entry is tagged
  `public-catalog`, so a future admin action can call `revalidateTag("public-catalog")`.

Pages use `ensureStatic = "navigation"`, so the first response is always complete HTML (not a loading
shell, which crawlers and LLM fetchers would see) and a missing page is a real 404 status.

## Where the code is

- `src/core/public-catalog.ts`: what is public, safe columns only, text cleaning (core, no provider code).
- `src/core/public-formats.ts`: llms.txt and JSON-LD builders.
- `src/app/public-data.ts`: the cached reads. `src/app/m/`: the pages. `src/app/llms.txt/`, `sitemap.ts`, `robots.ts`.
- `src/lib/public-url.ts`: the base URL for absolute links.

## Check the pages locally

Needs the dev database in `.env` with at least one opted-in merchant that has a sellable product
(`pnpm merchant:sync <slug>` then `pnpm merchant:sellable <slug> --all`).

```powershell
pnpm build
pnpm start          # http://localhost:3000   (use `pnpm dev` while editing; it behaves the same)
```

Open in a browser, or use `curl.exe` (PowerShell's `curl` is an alias, so write `curl.exe`):

```powershell
curl.exe -i http://localhost:3000/m/<slug>                      # 200, complete HTML, with all products
curl.exe -s http://localhost:3000/m/<slug>/<productId>          # contains <script type="application/ld+json">
curl.exe http://localhost:3000/llms.txt
curl.exe http://localhost:3000/m/<slug>/llms.txt
curl.exe http://localhost:3000/sitemap.xml
curl.exe http://localhost:3000/robots.txt
curl.exe -i http://localhost:3000/m/no-such-merchant            # 404
```

Things to look at:

- The pages and files say prices are before tax and name `get_quote`; none shows a tax-inclusive price.
- JSON-LD: `price`, `priceCurrency`, and `"valueAddedTaxIncluded": false`. Paste a product URL into
  Google's [Rich Results Test](https://search.google.com/test/rich-results) or the
  [Schema Markup Validator](https://validator.schema.org/) once it is public.
- A merchant with `networkOptIn` off, and a product with `agentSellable` off, return the 404 and appear
  nowhere (not in `/llms.txt` or `/sitemap.xml`). Compare the 404 body for an unknown slug and for an
  opted-out one: it is identical.
- The absolute links use `APP_URL` as it was at build time. If they show an old address, rebuild.

## Check them on a Vercel preview

1. Push the branch. Vercel builds a preview and comments the URL (also under **Deployments**).
2. The preview needs the environment variables from [deploy.md](deploy.md) for the **Preview**
   environment, including a `DATABASE_URL` (a separate test database is best). If the preview database
   is empty or unreachable the build still succeeds and the pages are generated on first visit.
3. **Preview deployments are normally behind Vercel's Deployment Protection** (Vercel Authentication), so
   `curl` receives an authentication page instead of ours, and LLM fetchers cannot read them. Either open
   the preview in a browser where you are signed in to Vercel, or create a Protection Bypass for
   Automation secret (Project, Settings, Deployment Protection; available on all plans) and send it as
   the `x-vercel-protection-bypass` header (or, for tools that cannot set headers, as a query parameter of
   the same name):

   ```powershell
   curl.exe -i -H "x-vercel-protection-bypass: <token>" https://<preview-url>/llms.txt
   ```
4. On a preview the links inside the pages, `llms.txt`, the sitemap and `robots.txt` point at the
   **preview's own address** (from `VERCEL_URL`), so you can follow them. On production they use `APP_URL`.
5. Run the same checks as locally. Vercel does not let search engines index preview deployments
   (it sends a noindex header), so the real indexing check is on production.
6. After changing a merchant's catalog or opt-in, give it up to 15 minutes, or redeploy, before expecting
   the pages to change.
