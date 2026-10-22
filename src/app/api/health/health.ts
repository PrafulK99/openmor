// Health check logic, kept apart from route.ts so it can be tested with a fake database.
import type { PrismaClient } from "@/generated/prisma/client";

/** Give up on the database after this long, so a hung connection still answers quickly. */
export const HEALTH_DB_TIMEOUT_MS = 3000;

const headers = { "content-type": "application/json", "cache-control": "no-store" };

/**
 * 200 { ok: true, version } when the database answers a trivial query, else 503 { ok: false }.
 * The failure body and logs carry no details: error messages can include hosts or credentials.
 */
export async function checkHealth(db: Pick<PrismaClient, "$queryRaw">, version: string): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), HEALTH_DB_TIMEOUT_MS);
      }),
    ]);
    return new Response(JSON.stringify({ ok: true, version }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}
