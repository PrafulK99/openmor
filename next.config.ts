import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// A basic CSP that keeps the order page working. Next.js hydrates with inline scripts and our
// pages use inline styles, so both allow 'unsafe-inline' (no nonces yet). Dev also needs eval
// for React's debugging tools. Everything else is same-origin only, and nothing may frame us.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Dev only: let Cloudflare quick tunnels (e.g. for Dodo webhooks and return URLs) load dev assets.
  allowedDevOrigins: ["*.trycloudflare.com"],
  logging: {
    incomingRequests: {
      // The dev request log prints full URLs. Dodo's return URL to /orders/{id} carries the
      // licence key as a query parameter, and the emailed /approve/{token} link carries the
      // approval token in its path. Never log those requests.
      ignore: [/\/orders\//, /\/approve\//],
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
