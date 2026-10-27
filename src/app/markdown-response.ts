// Responses for the markdown twins (/m/{slug}.md and /m/{slug}/{productId}.md). Every response at a
// .md address is markdown and never a redirect, including the 404, which is one fixed body for every
// missing page: it must not hint at what exists. Twins are noindex so they do not compete with the
// HTML pages in search.
import { MARKDOWN_TYPE } from "@/core/public-markdown";

const HEADERS = { "content-type": `${MARKDOWN_TYPE}; charset=utf-8`, "x-robots-tag": "noindex" } as const;

export function markdownResponse(body: string): Response {
  return new Response(body, { status: 200, headers: HEADERS });
}

export function markdownNotFound(): Response {
  return new Response("Not found\n", { status: 404, headers: HEADERS });
}
