// One MCP endpoint (streamable HTTP) for every merchant in the network.
import { getServerDeps } from "@/app/server-deps";
import { createOpenMorMcpHandler } from "@/protocols/mcp/http";
import pkg from "../../../../package.json";

// No `runtime`/`dynamic` exports: Next 16 with cacheComponents rejects them. Route handlers
// already run on Node (which Prisma's pg driver needs), and request handlers are never cached.

let handler: ((req: Request) => Promise<Response>) | undefined;

// Built on first request so importing this route (e.g. during `next build`) needs no env vars.
async function getHandler(): Promise<(req: Request) => Promise<Response>> {
  handler ??= createOpenMorMcpHandler(await getServerDeps(), pkg.version);
  return handler;
}

async function handle(req: Request): Promise<Response> {
  return (await getHandler())(req);
}

export { handle as GET, handle as POST };
