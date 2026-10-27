# Agent-readable public pages

OpenMoR publishes plain, server-rendered pages for every merchant that opted in to the network, so an
agent (or a search engine, or a person) can see what is for sale without using the connector first.

| URL | What it is |
| --- | --- |
| `/m/{merchantSlug}` | The merchant, its agent-sellable products (name and short description), and how to get a price. |
| `/m/{merchantSlug}/{productId}` | One product: description, **list price before tax**, and schema.org `Product` + `Offer` JSON-LD. |
| `/m/{merchantSlug}.md` | Markdown twin of the merchant page: the same facts in few tokens, for agents. |
| `/m/{merchantSlug}/{productId}.md` | Markdown twin of the product page: list price before tax, description, how to buy. |
| `/llms.txt` | A plain-text index of the network for LLMs ([llmstxt.org](https://llmstxt.org/) format). |
| `/m/{merchantSlug}/llms.txt` | The same for one merchant: its products, list prices, how to buy. |
| `/.well-known/ucp`, `/ucp/catalog/*` | UCP profile and read-only catalog for agents: see [ucp-acp.md](ucp-acp.md). |
| `/sitemap.xml` | Every public merchant and product page. |
| `/robots.txt` | Allows `/m/` and `/llms.txt`; keeps crawlers off `/api/` and `/orders/`; points to the sitemap. |

## Markdown twins

Every merchant and product page has a markdown twin at the same address plus `.md`. There is no content
negotiation and no user-agent sniffing: a twin is served only at its `.md` address, and the HTML address
always returns HTML.

- Responses are `Content-Type: text/markdown; charset=utf-8` with `X-Robots-Tag: noindex` (so twins do not
  compete with the HTML pages in search). A twin is never a redirect, including its 404.
- The HTML pages advertise their twin twice: a `<link rel="alternate" type="text/markdown" href="…">` in the
  head, and an HTTP header such as `Link: </m/{slug}.md>; rel="alternate"; type="text/markdown"`
  (RFC 8288, section 3: a URI-Reference in angle brackets, then parameters; relative references are
  resolved against the page address). The header is set from `next.config.ts` (`src/lib/twin-config.ts`),
  so it cannot know whether the page exists: a well-formed but unknown address carries it too, and the
  404 stays identical to an opted-out merchant's 404.
- `llms.txt` and `/m/{slug}/llms.txt` link to each twin.
- Visibility, text cleaning, length limits and the list-price rule are the same as for the HTML pages (a
  twin reads the same cached functions, never Dodo). Merchant text sits on its own quoted line behind a
  fixed label; it cannot add headings, links, HTML, code spans or lines.
- Routing: Next.js dynamic segments match dots, so `/m/{slug}/abc.md` would reach the product page with the
  id `abc.md`. A `beforeFiles` rewrite in `next.config.ts` sends `.md` addresses to the route handlers under
  `src/app/twin/` first (and the product page rejects such an id anyway). The internal path `/twin/m/…`
  returns the same content; it is not advertised anywhere.

## What is public

- A **merchant** appears only if it has opted in to the network **and is in live mode** (see
  [Test-mode merchants](#test-mode-merchants)).
- A **product** appears only if it is marked agent-sellable and is still active.
- Anything else (unknown slug, malformed slug, opted-out or test-mode merchant, hidden or retired product) returns
  the **same bare 404**. Nothing says which of those it was.
- Never shown: merchant API keys or secrets, emails, internal merchant ids, provider ids, raw provider
  data, buyer data. The only id shown is the public product id (the one agents pass as `product_id`).

## Test-mode merchants

A merchant is in test mode unless it has both `dodoEnvironment = live_mode` and `liveModeEnabled` set (the
same rule that picks the Dodo environment). One shared rule, `src/core/visibility.ts`, decides who is
visible on **every** surface: the pages and index, the markdown twins, `llms.txt` and `sitemap.xml`, the
UCP catalog, and the MCP tools `search_products`, `get_product`, `get_quote` and `checkout`.

- **Flag off (the default):** test-mode merchants are hidden. Every surface answers exactly as for an
  unknown merchant: the same bare 404 for pages and twins, the same UCP "not found", the same
  `MERCHANT_NOT_FOUND` from MCP. A quote made while a merchant was visible cannot be checked out once it
  is hidden.
- **`PUBLIC_INCLUDE_TEST_MERCHANTS=true`:** test-mode merchants are shown and marked with fixed strings
  (never merchant text):
  - `[TEST]` in front of product names in `search_products`, `get_product`, `get_quote`, `checkout` and
    `get_order`, an `is_test` field, and the sentence "TEST CATALOG: ..." in their summaries;
  - a banner on the merchant and product pages and on the markdown twins;
  - a line in `/llms.txt` and in the merchant's `llms.txt`;
  - in the UCP catalog, `[TEST]` in front of the product and variant titles, `metadata.test_catalog: true`
    on the variant, and a `test_catalog` info message.
- Test merchants' pages are `noindex` (page metadata; twins always send `X-Robots-Tag: noindex`) and are
  **left out of `sitemap.xml`**.
- The flag accepts only `true` or `false`; anything else stops the server from starting. Only the exact
  value `true` turns it on. It is read when the cache is filled, so a change shows up after a redeploy.
- Set it to `true` only where a test merchant is the only merchant (today's production). Remove it once
  there is a live merchant, so a test catalog never shows next to real ones.

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
- `src/core/public-formats.ts`: llms.txt and JSON-LD builders. `src/core/public-markdown.ts`: the twin builders.
- `src/app/twin/`: the twin route handlers. `src/lib/twin-config.ts`: the rewrites and Link headers.
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
curl.exe -i http://localhost:3000/m/<slug>.md                   # 200, text/markdown; charset=utf-8, x-robots-tag: noindex
curl.exe -i http://localhost:3000/m/<slug>/<productId>.md       # the product twin
curl.exe -I http://localhost:3000/m/<slug>                      # HTML, with: link: </m/<slug>.md>; rel="alternate"; type="text/markdown"
curl.exe -i http://localhost:3000/m/no-such-merchant.md         # 404, same body as any hidden or unknown twin
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
- A merchant in test mode (the default for a new merchant) is hidden the same way unless
  `PUBLIC_INCLUDE_TEST_MERCHANTS=true` is set; with it set, its pages show the TEST banner and it is not in
  `/sitemap.xml`. Restart the server after changing the variable.
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
