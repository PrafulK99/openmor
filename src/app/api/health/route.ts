// GET /api/health: liveness plus a cheap database check, for uptime monitors and deploy checks.
import { connection } from "next/server";
import pkg from "../../../../package.json";
import { checkHealth } from "./health";

export async function GET(): Promise<Response> {
  // Checked on every request: never prerendered or cached.
  await connection();
  try {
    // Loaded lazily so `next build` needs no env vars.
    const { db } = await import("@/lib/db");
    return await checkHealth(db, pkg.version);
  } catch {
    // Bad config (e.g. no DATABASE_URL) is unhealthy too, and its message stays private.
    return new Response(JSON.stringify({ ok: false }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}
