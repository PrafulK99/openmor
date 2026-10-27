import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  // 32 bytes, base64-encoded: the AES-256-GCM key for merchant API keys at rest.
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "ENCRYPTION_KEY must be 32 bytes, base64-encoded",
    }),
  DODO_ENVIRONMENT: z.enum(["test_mode", "live_mode"]).default("test_mode"),
  APP_URL: z.url(),
  // Show merchants that are in test mode on every public surface. Off unless exactly "true".
  PUBLIC_INCLUDE_TEST_MERCHANTS: z.enum(["true", "false"]).optional(),
});

export type Env = z.infer<typeof envSchema>;

/** True only when PUBLIC_INCLUDE_TEST_MERCHANTS is exactly "true". Anything else, including a typo, keeps test merchants hidden. */
export function includeTestMerchants(source: Record<string, string | undefined> = process.env): boolean {
  return source.PUBLIC_INCLUDE_TEST_MERCHANTS === "true";
}

let cached: Env | undefined;

/** Parse and validate process.env once. Throws with a readable message on bad config. */
export function env(): Env {
  if (cached) return cached;
  cached = parseEnv(process.env);
  return cached;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

const REQUIRED_IN_PRODUCTION = ["DATABASE_URL", "ENCRYPTION_KEY", "APP_URL"] as const;

/**
 * Problems that must stop a production server from starting. Messages name the variable,
 * never its value: these are secrets. Empty in development and tests.
 */
export function productionEnvProblems(source: Record<string, string | undefined>): string[] {
  if (source.NODE_ENV !== "production") return [];
  const problems = REQUIRED_IN_PRODUCTION.filter((name) => !source[name]?.trim()).map((name) => `${name} is not set`);

  const appUrl = source.APP_URL?.trim();
  if (appUrl) {
    let protocol: string | undefined;
    try {
      protocol = new URL(appUrl).protocol;
    } catch {
      problems.push("APP_URL is not a valid URL");
    }
    if (protocol && protocol !== "https:") problems.push("APP_URL must start with https:// in production");
  }
  if (problems.length) return problems;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Paths and zod messages only (e.g. "ENCRYPTION_KEY must be 32 bytes"); never input values.
    for (const issue of parsed.error.issues) problems.push(`${issue.path.join(".")}: ${issue.message}`);
  }
  return problems;
}

/** Throw at server startup in production if required config is missing or unsafe. */
export function assertProductionEnv(source: Record<string, string | undefined> = process.env): void {
  const problems = productionEnvProblems(source);
  if (!problems.length) return;
  throw new Error(
    [
      "OpenMoR cannot start: the production environment is not configured.",
      ...problems.map((p) => `  - ${p}`),
      "Set these in Vercel (Project > Settings > Environment Variables), then redeploy. See docs/deploy.md.",
    ].join("\n"),
  );
}
