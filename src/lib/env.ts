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
});

export type Env = z.infer<typeof envSchema>;

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
