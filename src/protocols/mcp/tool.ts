import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { CheckoutDeps } from "@/core/checkout";
import { TOOL_DEADLINE_MS, withDeadline } from "@/core/deadline";
import { toolError } from "./results";

/** What a tool handler gets besides its arguments. */
export interface ToolEnv {
  /** Core dependencies plus APP_URL (for checkout return links). */
  deps: CheckoutDeps;
  /** The caller's AgentSession, when one could be created. */
  agentSessionId?: string;
}

export interface ToolDefinition<Input extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  /** Written for AI agents. Static text only: merchant-supplied data must never appear here. */
  description: string;
  inputSchema: Input;
  outputSchema: z.ZodObject;
  annotations: ToolAnnotations;
  /**
   * Never throws: every failure becomes an error result with a stable code. Runs under a
   * TOOL_DEADLINE_MS deadline; provider calls past it fail as PROVIDER_ERROR.
   */
  handler: (input: z.infer<Input>, env: ToolEnv) => Promise<CallToolResult>;
}

export function defineTool<Input extends z.ZodObject>(
  def: Omit<ToolDefinition<Input>, "handler"> & {
    run: (input: z.infer<Input>, env: ToolEnv) => Promise<CallToolResult>;
  },
): ToolDefinition<Input> {
  const { run, ...rest } = def;
  return {
    ...rest,
    handler: async (input, env) => {
      try {
        // One deadline for the whole call, shared by every provider request inside it.
        return await withDeadline(TOOL_DEADLINE_MS, () => run(input, env));
      } catch (err) {
        return toolError(err);
      }
    },
  };
}
