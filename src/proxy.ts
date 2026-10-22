// Next.js proxy (formerly middleware). Runs before the order page renders and strips the
// query string Dodo adds to the return URL, which can contain the licence key.
import { NextResponse, type NextRequest } from "next/server";
import { REDIRECT_HEADERS, strippedOrderUrl } from "@/lib/return-url";

export function proxy(request: NextRequest): NextResponse {
  // Deliberately no logging here: the incoming URL may hold a licence key.
  const clean = strippedOrderUrl(request.nextUrl);
  if (!clean) return NextResponse.next();
  // 303: the browser fetches the clean URL with GET and does not keep the dirty one in history.
  const res = NextResponse.redirect(clean, 303);
  for (const [name, value] of Object.entries(REDIRECT_HEADERS)) res.headers.set(name, value);
  return res;
}

export const config = {
  matcher: "/orders/:id",
};
