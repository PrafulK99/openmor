// GET /approve/{token}: from the buyer's email. Moves the token into a cookie and redirects to
// /approve. Reads no data and changes nothing (see ../landing.ts). Never log the request URL.
import { approvalLanding } from "../landing";

export async function GET(req: Request, ctx: RouteContext<"/approve/[token]">): Promise<Response> {
  const { token } = await ctx.params;
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  return approvalLanding(token, secure);
}
