import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth, HEALTH_DB_TIMEOUT_MS } from "./health";

const fakeDb = (impl: () => Promise<unknown>) => ({ $queryRaw: vi.fn(impl) }) as never;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("checkHealth", () => {
  it("returns 200 { ok: true, version } when the database answers", async () => {
    const db = fakeDb(async () => [{ "?column?": 1 }]);
    const res = await checkHealth(db, "1.2.3");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, version: "1.2.3" });
  });

  it("returns 503 { ok: false } with no details or logs when the database fails", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb(async () => {
      throw new Error("connect ECONNREFUSED postgresql://user:SECRET@db.example.com");
    });
    const res = await checkHealth(db, "1.2.3");
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ ok: false });
    expect(body).not.toContain("SECRET");
    expect(logs).not.toHaveBeenCalled();
  });

  it("returns 503 when the database hangs past the timeout", async () => {
    vi.useFakeTimers();
    const db = fakeDb(() => new Promise(() => {}));
    const pending = checkHealth(db, "1.2.3");
    await vi.advanceTimersByTimeAsync(HEALTH_DB_TIMEOUT_MS);
    expect((await pending).status).toBe(503);
  });
});
