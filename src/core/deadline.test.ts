import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDeadline, TOOL_DEADLINE_MS, withDeadline } from "@/core/deadline";

afterEach(() => vi.useRealTimers());

describe("withDeadline", () => {
  it("has no deadline outside withDeadline", () => {
    expect(currentDeadline()).toBeUndefined();
  });

  it("exposes one signal to all work inside, aborted when the time is up", async () => {
    vi.useFakeTimers();
    const seen: AbortSignal[] = [];
    const run = withDeadline(1000, async () => {
      seen.push(currentDeadline()!);
      await Promise.resolve();
      seen.push(currentDeadline()!);
      await vi.advanceTimersByTimeAsync(1000);
      return currentDeadline()!.aborted;
    });
    expect(await run).toBe(true);
    expect(seen[0]).toBe(seen[1]);
  });

  it("clears its timer and returns the result when work finishes in time", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const result = await withDeadline(1000, async () => {
      signal = currentDeadline();
      return 42;
    });
    expect(result).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
    expect(signal!.aborted).toBe(false);
    expect(currentDeadline()).toBeUndefined();
  });

  it("never lets a nested deadline outlive the outer one", async () => {
    vi.useFakeTimers();
    await withDeadline(100, async () =>
      withDeadline(10_000, async () => {
        await vi.advanceTimersByTimeAsync(100);
        expect(currentDeadline()!.aborted).toBe(true);
      }),
    );
  });

  it("keeps concurrent deadlines apart", async () => {
    const a = withDeadline(1000, async () => currentDeadline());
    const b = withDeadline(1000, async () => currentDeadline());
    const [sa, sb] = await Promise.all([a, b]);
    expect(sa).toBeDefined();
    expect(sa).not.toBe(sb);
  });

  it("gives tool calls 25 s", () => {
    expect(TOOL_DEADLINE_MS).toBe(25_000);
  });
});
