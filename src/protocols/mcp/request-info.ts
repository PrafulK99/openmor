// Carries HTTP request details into tool handlers. The MCP SDK's handler context
// exposes no headers, so the route stores them here for the duration of a request.
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestInfo {
  userAgent?: string;
  ip?: string;
}

const storage = new AsyncLocalStorage<RequestInfo>();

export function currentRequestInfo(): RequestInfo {
  return storage.getStore() ?? {};
}

function infoFrom(req: Request): RequestInfo {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip")?.trim() || undefined;
  const userAgent = req.headers.get("user-agent")?.slice(0, 300) || undefined;
  return { ...(ip ? { ip } : {}), ...(userAgent ? { userAgent } : {}) };
}

export function withRequestInfo(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return (req) => storage.run(infoFrom(req), () => handler(req));
}
