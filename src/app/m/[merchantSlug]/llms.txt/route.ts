// /m/{merchantSlug}/llms.txt: a plain-text summary of one merchant for LLMs. Unknown, malformed and
// opted-out slugs all get the same bare 404.
import { isPublicSlug } from "@/core/public-catalog";
import { llmsNotFound, llmsResponse } from "../../../llms-response";
import { cachedMerchantLlmsTxt, staticMerchantParams } from "../../../public-data";

export async function generateStaticParams() {
  return staticMerchantParams();
}

export async function GET(_request: Request, ctx: RouteContext<"/m/[merchantSlug]/llms.txt">): Promise<Response> {
  const { merchantSlug } = await ctx.params;
  if (!isPublicSlug(merchantSlug)) return llmsNotFound();
  const body = await cachedMerchantLlmsTxt(merchantSlug);
  return body === null ? llmsNotFound() : llmsResponse(body);
}
