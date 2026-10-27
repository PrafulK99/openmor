// /.well-known/ucp: the UCP business profile for the OpenMoR network. Public, no redirects.
// Cache-Control is public with max-age 300, and the ETag lets clients revalidate (304).
import { buildUcpProfile } from "@/protocols/ucp/catalog";
import { publicBaseUrl } from "@/lib/public-url";
import { etagOf } from "../../ucp-http";

export function GET(request: Request): Response {
  const body = JSON.stringify(buildUcpProfile(publicBaseUrl()));
  const etag = etagOf(body);
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300", etag };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}
