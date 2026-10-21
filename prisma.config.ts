import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // `prisma generate` (run on install) needs no database, so only wire the
  // datasource when DATABASE_URL is set. Migrate/studio will fail without it.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
