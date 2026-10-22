// The emailed link, /approve/{token}, does exactly one thing: it hands the token to the approval
// page and redirects to /approve, so the token never sits in the address bar, browser history,
// the page's Referer or a screenshot. It reads no data and changes nothing: email scanners and
// link previews open links with GET, and a GET must never approve anything. Only the POST on the
// approval page (the Approve or Decline button) does.
//
// The token travels in a short-lived HttpOnly cookie scoped to /approve. SameSite=Lax lets the
// cookie ride along on the redirect that follows a click in an email client, and still keeps it
// off cross-site POSTs, so another website cannot submit a decision on the buyer's behalf.

export const APPROVAL_COOKIE = "openmor_approval";
/** The cookie lives as long as the emailed link does. The database enforces the real expiry. */
export const APPROVAL_COOKIE_MAX_AGE_S = 30 * 60;

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,128}$/;

export function approvalCookie(token: string, secure: boolean): string {
  return `${APPROVAL_COOKIE}=${token}; Path=/approve; HttpOnly; SameSite=Lax; Max-Age=${APPROVAL_COOKIE_MAX_AGE_S}${secure ? "; Secure" : ""}`;
}

/** Headers that clear the cookie (once a decision is final). */
export function clearedApprovalCookie(secure: boolean): string {
  return `${APPROVAL_COOKIE}=; Path=/approve; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** 303 to /approve, carrying the token in the cookie. Never logs or echoes the token. */
export function approvalLanding(token: string, secure: boolean): Response {
  const headers = new Headers({
    location: "/approve",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  // A malformed token gets no cookie: /approve then shows the "link not valid" page.
  if (TOKEN_SHAPE.test(token)) headers.append("set-cookie", approvalCookie(token, secure));
  return new Response(null, { status: 303, headers });
}
