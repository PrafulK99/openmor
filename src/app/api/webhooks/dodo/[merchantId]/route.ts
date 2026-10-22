// Dodo Payments webhooks, one URL per merchant: /api/webhooks/dodo/{merchantId}.
// Each merchant's deliveries are verified with that merchant's own signing secret.
import { getServerDeps } from "@/app/server-deps";
import { handleDodoWebhook } from "../handler";

export async function POST(req: Request, ctx: RouteContext<"/api/webhooks/dodo/[merchantId]">): Promise<Response> {
  const { merchantId } = await ctx.params;
  return handleDodoWebhook(await getServerDeps(), req, merchantId);
}
