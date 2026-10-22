// HTTP wiring for the MCP endpoint, kept apart from the Next.js route so it can be tested.
import { createMcpHandler } from "mcp-handler";
import type { CheckoutDeps } from "@/core/checkout";
import { withRequestInfo } from "./request-info";
import { registerOpenMorTools, SERVER_INSTRUCTIONS } from "./server";

/**
 * Build the MCP request handler (protocol 2026-07-28, plus the SDK's stateless fallback for
 * 2025-era clients).
 *
 * `tools.listChanged` is false on purpose: the tool list is fixed per deployment, and on
 * serverless there is no shared event bus to deliver change notifications anyway. The SDK
 * defaults it to true when a tool is registered, which made it hold every client's
 * `subscriptions/listen` stream open (with keep-alives) until Vercel killed the function at
 * its time limit. With nothing to honor, the SDK acknowledges the subscription with an empty
 * filter and ends it with a `complete` result, as the spec's graceful closure describes.
 */
export function createOpenMorMcpHandler(deps: CheckoutDeps, version: string): (req: Request) => Promise<Response> {
  return withRequestInfo(
    createMcpHandler((server) => registerOpenMorTools(server, deps), {
      serverInfo: { name: "openmor", version },
      instructions: SERVER_INSTRUCTIONS,
      capabilities: { tools: { listChanged: false } },
      // Verbose logs print raw errors, which can hold tool arguments (buyer emails).
      verboseLogs: false,
    }),
  );
}

