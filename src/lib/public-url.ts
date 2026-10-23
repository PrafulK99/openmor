// The public base URL that absolute links on the public pages, llms.txt, the sitemap and robots.txt
// are built from. Production and local use APP_URL. A Vercel preview deployment uses its own
// address, so links on a preview point at the preview and not at production.
import { env } from "@/lib/env";

export function baseUrlFrom(input: { appUrl: string; vercelEnv?: string | undefined; vercelUrl?: string | undefined }): string {
  const preview = input.vercelEnv === "preview" && input.vercelUrl ? `https://${input.vercelUrl}` : input.appUrl;
  return preview.replace(/\/+$/, "");
}

export function publicBaseUrl(): string {
  return baseUrlFrom({ appUrl: env().APP_URL, vercelEnv: process.env.VERCEL_ENV, vercelUrl: process.env.VERCEL_URL });
}
