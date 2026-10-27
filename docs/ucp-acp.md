# UCP and ACP

Two open protocols let AI agents discover commerce endpoints. OpenMoR implements the first as a
**read-only catalog** and defers the second. Neither lets an agent buy through OpenMoR: every purchase
still goes through the OpenMoR connector (`get_quote`, then `checkout`), and the buyer pays on Dodo's
hosted page.

## UCP (Universal Commerce Protocol), version 2026-08-25

Spec: <https://ucp.dev/2026-08-25/specification/overview> and the catalog capability at
`.../specification/shopping/catalog`. Source and JSON schemas: <https://github.com/Universal-Commerce-Protocol/ucp>
(tag `v2026-08-25`, Apache-2.0).

| URL | What it is |
| --- | --- |
| `GET /.well-known/ucp` | The business profile for the whole OpenMoR network (one profile, not one per merchant). |
| `POST /ucp/catalog/search` | `dev.ucp.shopping.catalog.search`: free-text search with a price filter, paginated. |
| `POST /ucp/catalog/lookup` | `dev.ucp.shopping.catalog.lookup`: up to 25 ids at once. |
| `POST /ucp/catalog/product` | `get_product` (part of lookup): one product by id. |

### What the profile claims, and what it leaves out

The profile advertises **exactly two capabilities**: catalog search and catalog lookup, over one REST
service (`https://<host>/ucp`), with `payment_handlers: {}` (required by the spec, and empty because
there are none).

It deliberately does **not** list: checkout (which would require Create, Get, Update, Complete and
Cancel, plus tax and cart handling), order, identity linking, any payment handler, signing keys, or
the MCP, A2A and embedded transports. OpenMoR only hands the buyer to a hosted Dodo checkout, has no
saved-method or agent-initiated payment, no cart or order management on the merchant's behalf, and no
refunds. The catalog says so itself: UCP catalog responses are "not transactional commitments", and
every response here also carries a message saying prices are list prices before tax and only a quote is
binding. Catalog ids therefore cannot be used in a UCP checkout (there is none); they are for finding
products. To buy, an agent follows the product `url` or uses the OpenMoR connector.

A test keeps the profile within that list: adding any other capability fails it.

### Products and ids

- One UCP product per OpenMoR product, with exactly one variant. Product id and variant id are the same
  string: **`{merchantSlug}~{productId}`**, because a product id alone is not unique across the network.
- `price` and `price_range` are the **list price in minor units, before tax**, in the product's own
  currency (no conversion). `variants[].seller.name` is the merchant. `url` is the public product page.
- Only opted-in merchants and agent-sellable, active products appear. An unknown, hidden, retired or
  opted-out product gives the same answer.
- No images, ratings, categories or stock counts are claimed. `availability.available` is `true` for
  every listed product. A `categories` filter matches nothing, because there are no categories.
- The price filter is in `context.currency`. Products in other currencies never match it, because we do
  not convert. A price filter without `context.currency` is a 400.
- Search is plain substring matching over merchant name, product name and descriptions, one term per
  word (up to 10). The query is never used as a pattern.

### Public input is untrusted

The catalog endpoints are public and unauthenticated.

- Request bodies are limited to **8 KB** (declared length checked first, and the stream is cut off at
  the limit regardless): larger gets **413**.
- Bodies are validated with strict zod schemas: unknown keys, wrong types and out-of-range values get
  **400**. Lists and strings are length-limited; a page returns at most **50** products (default 10)
  and pages with an opaque cursor.
- Error bodies are fixed text in the UCP error format. They never contain any part of the request, and
  a database failure is a generic 500 that logs only the error class name.
- Lookups of ids that do not resolve say how many failed, not which. (The spec's examples repeat the
  id; we deliberately do not.)
- Reads come from the same cached public-catalog functions as the public pages, so a request never
  reaches the database on every call, let alone Dodo. A catalog or opt-in change shows up within about
  15 minutes (see [public-pages.md](public-pages.md)).
- Merchant text is data: length-limited, on one line, and stripped of links of any scheme, HTML, link
  syntax and code spans. It appears only in `title`, `description.plain` and `seller.name`, never in a
  URL or in `metadata`. The remaining risk is the same as for `llms.txt`: it cannot be removed, only reduced.
- There is no rate limit in the application. Put one in front (Vercel Firewall) before this takes
  real traffic.

### Deliberate deviation: the caller's `UCP-Agent` profile is not fetched

UCP says a business MUST fetch and validate the calling platform's profile (sent in the `UCP-Agent`
header) and negotiate a version. OpenMoR **does not**. Fetching a URL chosen by an anonymous caller
from our server is a server-side request forgery (SSRF) risk: it could be pointed at internal
addresses or used to probe other hosts. The catalog is public, read-only and pinned to one version, so
there is nothing to negotiate. We therefore ignore the `UCP-Agent` header, always answer in version
2026-08-25, and never return `version_unsupported`. This is a choice, not an oversight; revisit it if
we ever add capabilities that depend on the caller's profile.

### What the profile endpoint guarantees

Served over HTTPS in production, never a redirect, `Content-Type: application/json`,
`Cache-Control: public, max-age=300`, a strong `ETag` and a 304 for `If-None-Match`.

### Other spec notes

- The profile lives at the OpenMoR origin, not at each merchant's own domain. The spec assumes a profile
  per business origin and says nothing about one host serving many merchants, so OpenMoR presents itself
  as one business whose variants carry a `seller`. Per-merchant profiles would only be discoverable if
  merchants pointed their own domains at us (custom domains, not in v1).
- Only `application/json` is used. The spec names no media type for the profile.

## ACP (Agentic Commerce Protocol): deferred

Spec: <https://github.com/agentic-commerce-protocol/agentic-commerce-protocol> (latest stable
2026-04-17, Apache-2.0). Its product feeds RFC (`rfcs/rfc.product_feeds.md`) is a **proposal, version
"unreleased"**. OpenMoR does **not** publish an ACP feed. Reasons:

- **Nothing would read it.** The feed API is hosted by the agent: merchants push their catalog to it,
  and the RFC says agents MUST NOT call feed endpoints on merchants. OpenAI's own commerce feed is also
  pushed (SFTP). A feed file on our domain would be an export for a merchant to upload, not a door an
  agent opens.
- **Feed metadata needs an id generated by the agent**, which we cannot mint.
- **The feed is meant to feed ACP checkout.** Item ids are for `POST /checkout_sessions`, which OpenMoR
  does not offer, and ACP discovery (`/.well-known/acp.json`, also unreleased) would advertise
  `checkout`, a claim we cannot back.
- OpenAI's flat feed asks for `brand`, `image_url` and seller privacy and terms URLs, which we do not hold.

If it is built later, it would be a per-merchant export of `products.jsonl` (one product per line: id,
title, description, url, variants with a minor-unit list price and `available`), with no images, brand,
GTIN, stock or policy links, and no `acp.json`.

## Check it locally

Build and start (PowerShell). Production mode needs an `https` base URL, so set it for this process:

```powershell
$env:APP_URL = "https://openmor.example.com"; pnpm build; pnpm start   # http://localhost:3000
```

```powershell
curl.exe -i http://localhost:3000/.well-known/ucp          # 200, application/json, cache-control: public, max-age=300, etag
curl.exe -i -H 'If-None-Match: \"<etag from above>\"' http://localhost:3000/.well-known/ucp   # 304
curl.exe -s -o NUL -w "%{http_code} redirects=%{num_redirects}\n" http://localhost:3000/.well-known/ucp                # 200 redirects=0

curl.exe -s -X POST http://localhost:3000/ucp/catalog/search -H "content-type: application/json" -d '{\"query\":\"<word>\",\"pagination\":{\"limit\":2}}'
curl.exe -s -X POST http://localhost:3000/ucp/catalog/lookup -H "content-type: application/json" -d '{\"ids\":[\"<slug>~<productId>\",\"x~y\"]}'
curl.exe -s -X POST http://localhost:3000/ucp/catalog/product -H "content-type: application/json" -d '{\"id\":\"<slug>~<productId>\"}'
curl.exe -s -X POST http://localhost:3000/ucp/catalog/product -H "content-type: application/json" -d '{\"id\":\"no~such\"}'   # HTTP 200, ucp.status "error", not_found

curl.exe -s -i -X POST http://localhost:3000/ucp/catalog/search -H "content-type: application/json" -d '{\"admin\":1}'   # 400, fixed message
curl.exe -s -o NUL -w "%{http_code}\n" -X POST http://localhost:3000/ucp/catalog/search -H "content-type: application/json" --data-binary "@big.json"   # 413 (a file over 8 KB)
curl.exe -s -o NUL -w "%{http_code}\n" http://localhost:3000/ucp/catalog/search    # 405: POST only
```

Things to look at: prices are list prices before tax (`price_basis: list_price_before_tax`); the
profile has only the two catalog capabilities and `"payment_handlers":{}`; error bodies never repeat
what you sent; an opted-out merchant and a hidden product appear nowhere.

### Validating against the official schemas

The UCP repository publishes JSON schemas (`source/schemas`) and a validator (`ucp-schema`, a Rust CLI
installed with `cargo install ucp-schema`). Its conformance suite (`Universal-Commerce-Protocol/conformance`)
tests checkout and order flows, which OpenMoR does not offer, so it does not apply. To check the
responses against the official schemas, load `source/schemas/**/*.json` into a JSON Schema 2020-12
validator (for example Ajv with `strict: false`) and validate the profile against
`profile.json#/$defs/business_schema`, search responses against
`shopping/catalog_search.json#/$defs/search_response`, and lookup and product responses against the
matching `$defs` in `shopping/catalog_lookup.json`.

## Where the code is

- `src/protocols/ucp/catalog.ts`: the profile, request schemas, search, lookup and product (calls core only).
- `src/core/public-catalog.ts` (`getPublicCatalog`): what is public. `src/app/public-data.ts`: the cached read.
- `src/app/ucp-http.ts`: body limit, fixed errors, ETag. Routes: `src/app/.well-known/ucp/` and `src/app/ucp/catalog/`.
