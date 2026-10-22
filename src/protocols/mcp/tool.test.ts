import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { currentDeadline, TOOL_DEADLINE_MS } from "@/core/deadline";
import { ProviderError } from "@/core/errors";
import { DODO_SLOW_MESSAGE } from "@/adapters/dodo/adapter";
import { ok } from "./results";
import { defineTool, type ToolEnv } from "./tool";

const env = {} as ToolEnv;

function tool(run: () => Promise<ReturnType<typeof ok>>) {
  return defineTool({
    name: "t",
    title: "t",
    description: "t",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    annotations: {},
    run,
  });
}

afterEach(() => vi.useRealTimers());

describe("defineTool deadline", () => {
  it("runs every tool call under a 25 s deadline that is cleared afterwards", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const pending = tool(async () => {
      signal = currentDeadline();
      // Work that waits for the deadline, like a hung provider request.
      await new Promise<void>((resolve) => signal!.addEventListener("abort", () => resolve(), { once: true }));
      return ok({}, "done");
    }).handler({}, env);
    await vi.advanceTimersByTimeAsync(TOOL_DEADLINE_MS - 1);
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal!.aborted).toBe(true);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives each call its own deadline", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const t = tool(async () => {
      seen.push(currentDeadline());
      return ok({}, "done");
    });
    await t.handler({}, env);
    await t.handler({}, env);
    expect(seen[0]).toBeDefined();
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("returns a hit deadline as PROVIDER_ERROR with the 'Dodo is slow' message", async () => {
    const r = await tool(async () => {
      throw new ProviderError("Dodo Payments", undefined, "tool call deadline exceeded", DODO_SLOW_MESSAGE);
    }).handler({}, env);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      error: { code: "PROVIDER_ERROR", message: "Dodo is slow right now, try again in a minute." },
    });
    expect((r.content[0] as { text: string }).text).toMatch(/^PROVIDER_ERROR: Dodo is slow right now, try again in a minute\./);
  });
});
