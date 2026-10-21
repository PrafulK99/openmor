// One MCP endpoint (streamable HTTP) for every merchant in the network.
import { createMcpHandler } from "mcp-handler";
import { getServerDeps } from "@/app/server-deps";
import { registerOpenMorTools, SERVER_INSTRUCTIONS } from "@/protocols/mcp/server";
import { withRequestInfo } from "@/protocols/mcp/request-info";
import pkg from "../../../../package.json";

// No `runtime`/`dynamic` exports: Next 16 with cacheComponents rejects them. Route handlers
// already run on Node (which Prisma's pg driver needs), and request handlers are never cached.

let handler: ((req: Request) => Promise<Response>) | undefined;

// Built on first request so importing this route (e.g. during `next build`) needs no env vars.
async function getHandler(): Promise<(req: Request) => Promise<Response>> {
  if (handler) return handler;
  const deps = await getServerDeps();
  handler = withRequestInfo(
    createMcpHandler((server) => registerOpenMorTools(server, deps), {
      serverInfo: { name: "openmor", version: pkg.version },
      instructions: SERVER_INSTRUCTIONS,
    }),
  );
  return handler;
}

async function handle(req: Request): Promise<Response> {
  return (await getHandler())(req);
}

export { handle as GET, handle as POST };
