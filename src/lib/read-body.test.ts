import { describe, expect, it } from "vitest";
import { readBodyBytes } from "./read-body";

const streamOf = (...parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(new TextEncoder().encode(p));
      controller.close();
    },
  });

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", body, headers, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);

describe("readBodyBytes", () => {
  it("returns the bytes of a body within the limit, and nothing for no body", async () => {
    const r = await readBodyBytes(post("hello"), 5);
    expect(r.ok && Buffer.from(r.bytes).toString()).toBe("hello");
    const none = await readBodyBytes(new Request("http://localhost/x", { method: "POST" }), 5);
    expect(none.ok && none.bytes.byteLength).toBe(0);
  });

  it("rejects a body over the limit", async () => {
    expect((await readBodyBytes(post("123456"), 5)).ok).toBe(false);
  });

  it("measures the real body when the declared length is too small or missing", async () => {
    expect((await readBodyBytes(post("x".repeat(100), { "content-length": "3" }), 10)).ok).toBe(false);
    expect((await readBodyBytes(post(streamOf("x".repeat(6), "x".repeat(6))), 10)).ok).toBe(false);
    expect((await readBodyBytes(post(streamOf("x".repeat(5), "x".repeat(5))), 10)).ok).toBe(true);
  });

  it("rejects on a declared length over the limit without reading", async () => {
    expect((await readBodyBytes(post("x", { "content-length": "11" }), 10)).ok).toBe(false);
  });

  it("ignores a content-length that is not a number and measures the body instead", async () => {
    expect((await readBodyBytes(post("abc", { "content-length": "abc" }), 10)).ok).toBe(true);
  });
});
