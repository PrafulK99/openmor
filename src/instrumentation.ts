// Runs once when a Next.js server instance starts. In production it refuses to start with
// missing or unsafe config, so a bad deploy fails loudly at boot instead of on a buyer's request.
export async function register(): Promise<void> {
  // `next build` may load this file; env checks are for the running server only.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionEnv } = await import("@/lib/env");
  assertProductionEnv();
}
