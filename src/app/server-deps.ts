// Wires core's dependencies for Next.js routes and pages: the real database, real provider
// adapters and APP_URL. Loaded lazily so importing a route (e.g. during `next build`) needs
// no env vars.
import type { CheckoutDeps } from "@/core/checkout";

let deps: Promise<CheckoutDeps> | undefined;

export function getServerDeps(): Promise<CheckoutDeps> {
  deps ??= (async () => {
    const [{ db }, { adapterFor }, { env, includeTestMerchants }] = await Promise.all([
      import("@/lib/db"),
      import("@/adapters"),
      import("@/lib/env"),
    ]);
    return { db, adapterFor, appUrl: env().APP_URL, includeTestMerchants: includeTestMerchants() };
  })();
  return deps;
}
