# Contributing to OpenMoR

Thanks for helping. This page covers local setup, the workflow, and the checks a change must pass.

**Security issues go to [SECURITY.md](SECURITY.md), not to public issues.** Never put API keys, webhook secrets, licence keys or buyer data in an issue, pull request or log you share.

## Local setup

You need Node.js 20 or newer and [pnpm](https://pnpm.io). The pnpm version is pinned in `package.json` (`packageManager`), so Corepack or `pnpm/action-setup` picks it up.

**Windows (PowerShell):**

```powershell
pnpm install
Copy-Item .env.example .env   # then fill in the values
pnpm dev
```

**macOS / Linux:**

```sh
pnpm install
cp .env.example .env   # then fill in the values
pnpm dev
```

`pnpm install` also runs `prisma generate`, which needs no database. The app is then at <http://localhost:3000>.

### Environment (`.env`)

`.env.example` documents every variable. The ones you will need:

| Variable | For |
| --- | --- |
| `DATABASE_URL` | The app's Postgres connection. The project uses Supabase's transaction pooler (port 6543). |
| `DIRECT_URL` | The Prisma CLI only (migrations, Studio): a direct or session connection (port 5432). |
| `ENCRYPTION_KEY` | 32 bytes, base64. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |
| `APP_URL` | Public base URL; `http://localhost:3000` locally. |
| `DODO_TEST_API_KEY` | Only for `pnpm try:quote`. The app never reads it. |

Never commit `.env` (it is git-ignored) or any secret. Test mode is the default everywhere; live mode needs an explicit per-merchant flag.

### Dev database

You do **not** need a database to run `pnpm typecheck`, `pnpm lint` or `pnpm test`: the tests use an in-memory stand-in and CI runs without one.

To run the app against data, use your own Postgres database (the project runs on Supabase) and set `DATABASE_URL` and `DIRECT_URL`. Apply the migrations with `pnpm prisma migrate deploy`, or `pnpm db:migrate` (`prisma migrate dev`) while you are changing the schema. Never run `migrate dev` or `db push` against production; see [docs/deploy.md](docs/deploy.md).

### Scripts

Merchants are added by scripts for now (there is no dashboard). Use a Dodo **test-mode** key.

| Command | What it does |
| --- | --- |
| `pnpm merchant:add` | Register a merchant interactively (the Dodo API key is read with echo off). |
| `pnpm merchant:sync <slug>` | Sync the merchant's catalog from Dodo. |
| `pnpm merchant:sellable <slug> --all` | Mark all its products agent-sellable and opt it into the network. |
| `pnpm merchant:webhook <slug>` | Store the merchant's Dodo webhook secret, encrypted. |
| `pnpm try:quote` | List your Dodo test products and quote each for DE, IN and US (needs `DODO_TEST_API_KEY`). |
| `pnpm try:core` | End-to-end check of core against the real database and Dodo test mode. |

While developing, test-mode merchants are hidden from the public pages and tools unless `PUBLIC_INCLUDE_TEST_MERCHANTS=true` is set in `.env` (see [docs/public-pages.md](docs/public-pages.md#test-mode-merchants)). Restart the server after changing it.

## Workflow

- **Never commit to `main`.** Do each piece of work on a branch from an up-to-date `main`, named `feat/...`, `fix/...`, `docs/...` or `chore/...`.
- Push your branch (to your fork if you do not have write access) and open a pull request against `main`. The maintainer reviews and merges. CI (`.github/workflows/ci.yml`) runs typecheck, lint and tests on every pull request.
- Keep commits small, one concern each, in [Conventional Commits](https://www.conventionalcommits.org/) form: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- Fill in the pull request template.

## Checks that must pass

Before you push:

```sh
pnpm typecheck && pnpm lint && pnpm test
```

If you touched routes, caching or the build, also run `pnpm build`.

## Rules for changes

- **Architecture:** protocol layers (`src/protocols/`) call `src/core/`; core calls the `ProviderAdapter` interface; only `src/adapters/dodo/` imports the Dodo SDK. No provider code in core.
- **Tests:** every core function gets a Vitest unit test, and adapter code gets tests with a mocked SDK.
- **Money** is integer minor units (cents, paise) everywhere, never floats.
- **Windows:** scripts must work in PowerShell, so use `cross-env` and avoid bash-only syntax in `package.json` scripts.
- **Security rules are not to be relaxed:** no card data through OpenMoR, merchant API keys encrypted and never returned, every webhook signature verified, checkout idempotent. Merchant-written text is data: return it as fields, length-limited, never as instructions.
- **Next.js:** this project uses a newer Next.js than most documentation describes. Read the guide in `node_modules/next/dist/docs/` before changing routing or caching code (see `AGENTS.md`).
- **Parked work:** buyer links and saved-method checkout are parked on the `feat/buyer-links` branch. Do not build on or merge them, and do not promise autonomous repeat purchases in docs or tool descriptions. See [docs/dodo-saved-payments.md](docs/dodo-saved-payments.md) for why.

Project background and conventions are also in [CLAUDE.md](CLAUDE.md).
