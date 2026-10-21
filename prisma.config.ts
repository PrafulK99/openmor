import "dotenv/config";
import { defineConfig } from "prisma/config";

// The CLI (migrate, studio, db pull) uses DIRECT_URL: a session connection on
// port 5432. Supabase's transaction pooler (DATABASE_URL, port 6543) can't run
// migrations. The app connects with DATABASE_URL in src/lib/db.ts.
function directUrl(): string | undefined {
  const raw = process.env.DIRECT_URL;
  if (!raw) return undefined;
  const url = new URL(raw);
  // The schema engine's default connect timeout (5s) is too short for slow
  // links to remote poolers and surfaces as P1001. Respect an explicit value.
  if (!url.searchParams.has("connect_timeout")) {
    url.searchParams.set("connect_timeout", "30");
  }
  return url.toString();
}

const url = directUrl();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // `prisma generate` (run on install) needs no database, so only wire the
  // datasource when DIRECT_URL is set. Migrate/studio will fail without it.
  ...(url ? { datasource: { url } } : {}),
});
