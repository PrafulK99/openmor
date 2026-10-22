// One deadline per unit of work (an MCP tool call), shared by every provider call inside it.
// Carried with AsyncLocalStorage so core functions need no extra parameter; adapters read it
// and pass the signal to each provider request.
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Budget for one tool call. Leaves room under the /api/mcp maxDuration (30 s) to turn a hit
 * deadline into a clean PROVIDER_ERROR answer instead of a killed function.
 */
export const TOOL_DEADLINE_MS = 25_000;

const storage = new AsyncLocalStorage<AbortSignal>();

/** The current deadline's signal, or undefined outside withDeadline (webhooks, scripts). */
export function currentDeadline(): AbortSignal | undefined {
  return storage.getStore();
}

/** Run fn with a deadline of `ms`. Nested deadlines never extend an outer one. */
export async function withDeadline<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const outer = storage.getStore();
  const signal = outer ? AbortSignal.any([outer, controller.signal]) : controller.signal;
  try {
    return await storage.run(signal, fn);
  } finally {
    clearTimeout(timer);
  }
}
