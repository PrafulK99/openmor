// /robots.txt: the public pages and llms.txt are open to everyone, crawlers and AI agents alike. The
// API (MCP connector, webhooks, health) and order pages are not for crawling.
import type { MetadataRoute } from "next";
import { publicBaseUrl } from "@/lib/public-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/m/", "/llms.txt"], disallow: ["/api/", "/orders/"] }],
    sitemap: `${publicBaseUrl()}/sitemap.xml`,
  };
}
