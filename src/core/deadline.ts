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

/** Thrown by raceDeadline when the deadline fires before the work finishes. */
export class DeadlineExceededError extends Error {
  constructor() {
    super("The tool call's time budget ran out");
    this.name = "DeadlineExceededError";
  }
}

/**
 * Reject as soon as the current deadline fires, even if the work cannot be cancelled (it keeps
 * running in the background). Without a deadline, the work is returned as is.
 */
export function raceDeadline<T>(work: Promise<T>): Promise<T> {
  const signal = currentDeadline();
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new DeadlineExceededError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DeadlineExceededError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
