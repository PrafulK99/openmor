// Wires core's dependencies for Next.js routes and pages: the real database, real provider
// adapters, APP_URL and the email sender. Loaded lazily so importing a route (e.g. during `next build`) needs
// no env vars.
import type { CheckoutDeps } from "@/core/checkout";

let deps: Promise<CheckoutDeps> | undefined;

export function getServerDeps(): Promise<CheckoutDeps> {
  deps ??= (async () => {
    const [{ db }, { adapterFor }, { env }, { createEmailSender, unconfiguredEmailSender }] = await Promise.all([
      import("@/lib/db"),
      import("@/adapters"),
      import("@/lib/env"),
      import("@/lib/email"),
    ]);
    const { APP_URL, RESEND_API_KEY, EMAIL_FROM } = env();
    const email = RESEND_API_KEY
      ? createEmailSender({ apiKey: RESEND_API_KEY, ...(EMAIL_FROM ? { from: EMAIL_FROM } : {}) })
      : unconfiguredEmailSender;
    return { db, adapterFor, appUrl: APP_URL, email };
  })();
  return deps;
}
