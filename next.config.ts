import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Dev only: let Cloudflare quick tunnels (e.g. for Dodo webhooks and return URLs) load dev assets.
  allowedDevOrigins: ["*.trycloudflare.com"],
  logging: {
    incomingRequests: {
      // The dev request log prints full URLs, and Dodo's return URL to /orders/{id} carries
      // the licence key as a query parameter. Never log those requests.
      ignore: [/\/orders\//],
    },
  },
};

export default nextConfig;
