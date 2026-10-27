// Routing for the markdown twins, kept apart from next.config.ts so tests can read it.
//
// Rewrites: the twin of /m/{slug} is /m/{slug}.md, and of /m/{slug}/{productId} is
// /m/{slug}/{productId}.md. The route handlers live under /twin.
export const TWIN_REWRITES = [
  { source: "/m/:merchantSlug.md", destination: "/twin/m/:merchantSlug" },
  { source: "/m/:merchantSlug/:productId.md", destination: "/twin/m/:merchantSlug/:productId" },
] as const;

// Link headers on the HTML pages, pointing at the twin (RFC 8288, section 3):
//   Link: <URI-Reference>; rel="alternate"; type="text/markdown"
// The URI-Reference is relative and the client resolves it against the page address. The parameter
// patterns only match well-formed slugs and ids, so a ".md" address never gets this header (a
// well-formed but unknown slug does, as the header cannot tell: the page's 404 and an opted-out
// merchant's 404 stay identical).
const SLUG = ":merchantSlug([a-z0-9][a-z0-9-]{0,62})";
const PRODUCT_ID = ":productId([A-Za-z0-9_-]{1,64})";

const link = (target: string) => ({ key: "Link", value: `<${target}>; rel="alternate"; type="text/markdown"` });

export const TWIN_LINK_HEADERS = [
  { source: `/m/${SLUG}`, headers: [link("/m/:merchantSlug.md")] },
  { source: `/m/${SLUG}/${PRODUCT_ID}`, headers: [link("/m/:merchantSlug/:productId.md")] },
] as const;
