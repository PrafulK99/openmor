// /m/{merchantSlug}.md, reached through the rewrite in next.config.ts. Unknown, malformed and
// opted-out slugs all get the same bare 404.
import { isPublicSlug } from "@/core/public-catalog";
import { markdownNotFound, markdownResponse } from "../../../markdown-response";
import { cachedMerchantMarkdown, staticMerchantParams } from "../../../public-data";

export async function generateStaticParams() {
  return staticMerchantParams();
}

export async function GET(_request: Request, ctx: RouteContext<"/twin/m/[merchantSlug]">): Promise<Response> {
  const { merchantSlug } = await ctx.params;
  if (!isPublicSlug(merchantSlug)) return markdownNotFound();
  const body = await cachedMerchantMarkdown(merchantSlug);
  return body === null ? markdownNotFound() : markdownResponse(body);
}
