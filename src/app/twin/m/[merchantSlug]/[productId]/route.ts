// /m/{merchantSlug}/{productId}.md, reached through the rewrite in next.config.ts. Unknown, malformed,
// opted-out, hidden and retired all get the same bare 404.
import { isPublicProductId, isPublicSlug } from "@/core/public-catalog";
import { markdownNotFound, markdownResponse } from "../../../../markdown-response";
import { cachedProductMarkdown, staticProductParams } from "../../../../public-data";

export async function generateStaticParams() {
  return staticProductParams();
}

export async function GET(_request: Request, ctx: RouteContext<"/twin/m/[merchantSlug]/[productId]">): Promise<Response> {
  const { merchantSlug, productId } = await ctx.params;
  if (!isPublicSlug(merchantSlug) || !isPublicProductId(productId)) return markdownNotFound();
  const body = await cachedProductMarkdown(merchantSlug, productId);
  return body === null ? markdownNotFound() : markdownResponse(body);
}
