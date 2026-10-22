// One MCP endpoint (streamable HTTP) for every merchant in the network.
import { getServerDeps } from "@/app/server-deps";
import { createOpenMorMcpHandler, methodNotAllowed } from "@/protocols/mcp/http";
import pkg from "../../../../package.json";

// No `runtime`/`dynamic` exports: Next 16 with cacheComponents rejects them. Route handlers
// already run on Node (which Prisma's pg driver needs), and request handlers are never cached.

// Hard cap per request on Vercel. Every tool call finishes in seconds; nothing may hang for
// the platform default (300 s) again.
export const maxDuration = 30;

let handler: ((req: Request) => Promise<Response>) | undefined;

// Built on first request so importing this route (e.g. during `next build`) needs no env vars.
async function getHandler(): Promise<(req: Request) => Promise<Response>> {
  handler ??= createOpenMorMcpHandler(await getServerDeps(), pkg.version);
  return handler;
}

export async function POST(req: Request): Promise<Response> {
  return (await getHandler())(req);
}

export function GET(): Response {
  return methodNotAllowed();
}

export function DELETE(): Response {
  return methodNotAllowed();
}
