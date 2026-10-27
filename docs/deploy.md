# Deploying OpenMoR to Vercel

This guide deploys the app to Vercel, with functions in Mumbai (`bom1`) next to the Supabase database. Vercel only builds and runs the app. Database migrations are never run by Vercel: you run them from your own machine.

`vercel.json` already sets the install command, build command and region, so you don't need to change those in the dashboard.

| Setting | Value | Set by |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | `vercel.json` |
| Build | `pnpm build` = `prisma generate && next build`. No migrations. It reads the database (read-only) to prerender the public pages, see below | `vercel.json`, `package.json` |
| Function region | `bom1` (Mumbai) | `vercel.json` |
| Node.js | 20 or newer | `package.json` `engines` |

## 1. Create the project

1. In Vercel, choose **Add New > Project** and import the `openmor` GitHub repository.
2. Leave **Framework Preset** as Next.js and **Root Directory** as the repository root.
3. Don't deploy yet. Open **Environment Variables** first (step 2).

## 2. Set environment variables

Set these under **Project > Settings > Environment Variables**, for the **Production** environment:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase **Transaction pooler** connection string (port `6543`). Find it under Supabase **Project Settings > Database > Connection string**. |
| `ENCRYPTION_KEY` | **The same key** as the environment whose database you point at. Merchant Dodo API keys and webhook secrets are encrypted with it; a different key makes every stored key unreadable. |
| `APP_URL` | The public `https://` URL of the deployment, with no trailing slash, e.g. `https://openmor.vercel.app`. It's used in checkout return URLs. |
| `PUBLIC_INCLUDE_TEST_MERCHANTS` | `true` while the only merchant is a test-mode one, otherwise leave it unset. Test-mode merchants are **hidden from every public page, file, catalog and MCP tool** unless this is exactly `true`; with it on they are marked `[TEST]` and kept out of the sitemap. Remove it when a live merchant exists. Redeploy after changing it. See [public-pages.md](public-pages.md#test-mode-merchants). |
| `DODO_ENVIRONMENT` | `test_mode`. Leave it in test mode until live mode is deliberately enabled per merchant. |

Do **not** set these in Vercel:

- `DIRECT_URL`: only the Prisma CLI uses it, on your machine, for migrations. The build doesn't need it.

**The build reads the database.** The public pages (`/m/...`, `/llms.txt`, `/sitemap.xml`) are prerendered from the catalog, so the build reads it through `DATABASE_URL`, read-only, and needs `DATABASE_URL`, `ENCRYPTION_KEY` and `APP_URL` at build time (Vercel provides project variables to the build by default). If the database cannot be reached during a build (a new project, or an outage), the build still succeeds and those pages are generated on their first visit instead. The links inside the pages use `APP_URL` as it was at build time, so redeploy after changing it. See [public-pages.md](public-pages.md).
- `DODO_TEST_API_KEY`: only local scripts use it.

In production the server refuses to start if `DATABASE_URL`, `ENCRYPTION_KEY` or `APP_URL` is missing, if `APP_URL` isn't `https://`, or if `ENCRYPTION_KEY` isn't 32 bytes in base64. Every route then returns 500, and **Runtime Logs** show a message starting `OpenMoR cannot start:` that names each problem variable (never its value).

**Preview deployments:** these also run in production mode, so the same check applies. Either set the same variables for the **Preview** environment (with `APP_URL` set to any valid https URL, and preferably a separate test database), or don't rely on previews. On a preview, the public pages build their links from the preview's own address (`VERCEL_URL`), not from `APP_URL`. Vercel puts previews behind sign-in by default; see [public-pages.md](public-pages.md) for how to check one.

## 3. Run migrations (from your machine)

Run migrations **before** deploying code that needs a new schema. Write migrations so the version already running still works with the new schema (add columns, don't drop or rename in the same release).

1. In your local `.env`, point `DIRECT_URL` at the production database. Use the Supabase **Session pooler** (port `5432`) or **Direct connection** string. The transaction pooler can't run migrations.
2. From the repository root (PowerShell or any shell):

   ```sh
   pnpm prisma migrate status
   pnpm prisma migrate deploy
   ```

   `migrate status` shows which migrations are pending. `migrate deploy` applies them without prompting and never resets data. Never use `prisma migrate dev` or `prisma db push` against production.

3. Point `DIRECT_URL` in your `.env` back at your development database if you normally use a different one.

## 4. Deploy

Deploy from the Vercel dashboard (**Deployments > Redeploy**, or the first deploy after import), or by pushing to the production branch.

Then check that functions run in Mumbai: open the deployment, then **Functions** (or **Project > Settings > Functions**), and confirm the region is `bom1`.

## 5. Point Dodo webhooks at the deployment

Each merchant has its own webhook URL:

```
https://<APP_URL host>/api/webhooks/dodo/<merchantId>
```

`pnpm merchant:webhook <slug>` prints the path for a merchant (its id is in the URL).

For each merchant, in the Dodo Payments dashboard (in the mode you're using, test or live):

1. Open **Developer > Webhooks**.
2. Edit the existing endpoint's URL to the address above. If you create a new endpoint instead, it gets a **new signing secret**.
3. If the signing secret changed, store the new one, encrypted, by running this from your machine (with `DATABASE_URL` in `.env` pointing at the production database):

   ```sh
   pnpm merchant:webhook <slug>
   ```

   Deliveries with the old secret are rejected with 401 until you do.

4. Send a test event from Dodo and confirm the endpoint answers `200`.

Checkout return URLs need no change: they're built from `APP_URL` for every new checkout.

The MCP connector URL for agents is `https://<APP_URL host>/api/mcp`.

## 6. Check the deployment

```sh
curl -i https://<APP_URL host>/api/health
```

| Response | Meaning |
| --- | --- |
| `200 {"ok":true,"version":"0.1.0"}` | Healthy: the app is running and the database answered. |
| `503 {"ok":false}` | The database is unreachable or too slow (over 3 s). Check `DATABASE_URL` and the Supabase project status. |
| `500` on every route | Startup config check failed. Look for `OpenMoR cannot start:` in **Runtime Logs**. |

The health check never shows error details. They stay out of the response on purpose.

Also confirm the security headers are present (on any route):

```sh
curl -sI https://<APP_URL host>/ | grep -iE "content-security-policy|x-frame-options|x-content-type-options|referrer-policy"
```

## Rate limiting

The app has no rate limiter of its own. The public, unauthenticated endpoints are limited by a **Vercel Firewall rule**, configured in the Vercel dashboard (**Project → Firewall → Configure → Custom Rules**), not in code or `vercel.json`:

| Setting | Value |
| --- | --- |
| Match | Request path **equals** `/api/mcp` **or** request path **starts with** `/ucp/` |
| Rate limit | Fixed window, 60 s |
| Limit | 100 requests per IP |
| Action | 429 (Too Many Requests) |

- The Hobby plan allows **one** rate-limit rule, so both paths share this one rule (and one counter per IP).
- `/api/webhooks/dodo/...` and `/api/health` are **deliberately excluded**. Webhooks come from Dodo, not from buyers or agents, and a throttled webhook is a lost payment update; the health check must keep answering.
- If the rule is lost (a new Vercel project, a plan change), re-create it from this table. `/.well-known/ucp` and the `/m/...` pages are cached and not covered.

## Logging and secrets

- App code logs almost nothing. The only log line is a failed webhook, with the merchant id and error class name. A lint rule (`no-console`) blocks new logging without a reviewed exception.
- Dodo appends the buyer's licence key to the return URL (`/orders/<id>?...`). The proxy strips it with a redirect before the page renders, and the app never logs it. **Vercel's own request logs record request URLs, so the first hit on a return URL may appear there with its query string.** Limit who can see the project's logs, and don't forward them to a log drain that keeps them.
- Webhook bodies, API keys, licence keys and portal links are never logged by the app.
