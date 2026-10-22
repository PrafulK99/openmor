// Dodo appends the buyer's licence key (and other payment details) as query parameters to
// the checkout return_url. Our order page needs no query parameters at all, so any query
// string on /orders/{id} is dropped with a server-side redirect before the page renders.
// That keeps keys out of browser history (a redirected URL gets no history entry), out of
// page analytics and Referer headers, and out of our own logs. Never log the incoming URL.

const ORDER_PATH = /^\/orders\/[^/]+\/?$/;

/** The same order URL without its query string, or null when there is nothing to strip. */
export function strippedOrderUrl(url: URL): URL | null {
  if (!ORDER_PATH.test(url.pathname) || url.search === "") return null;
  const clean = new URL(url.href);
  clean.search = "";
  clean.hash = "";
  return clean;
}

/** Headers for the redirect: never cache it, never send the dirty URL as a Referer. */
export const REDIRECT_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
} as const;
