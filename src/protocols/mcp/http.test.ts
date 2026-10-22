import { describe, expect, it } from "vitest";
import { setup } from "@/test/core-fixtures";
import { createOpenMorMcpHandler, methodNotAllowed } from "./http";
import * as route from "@/app/api/mcp/route";

const VERSION = "2026-07-28";

function rpc(method: string, params: Record<string, unknown> = {}, id = 1): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": VERSION,
      "mcp-method": method,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": VERSION,
          "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

/** Read a response body to its end, failing if the stream is still open after `ms`. */
async function readToEnd(res: Response, ms = 2000): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`response stream still open after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([res.text(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** JSON-RPC messages from an SSE body (`data:` lines), or the body itself when it is JSON. */
function messages(body: string): Record<string, unknown>[] {
  const data = body
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => JSON.parse(l.slice(5)) as Record<string, unknown>);
  return data.length ? data : [JSON.parse(body) as Record<string, unknown>];
}

function handler() {
  const t = setup();
  return createOpenMorMcpHandler({ ...t.deps, appUrl: "http://localhost:3000" }, "9.9.9");
}

describe("MCP HTTP endpoint", () => {
  it("does not advertise tool list change notifications", async () => {
    const res = await handler()(rpc("server/discover"));
    expect(res.status).toBe(200);
    const [msg] = messages(await readToEnd(res));
    const result = msg!.result as { capabilities: { tools?: { listChanged?: boolean } } };
    expect(result.capabilities.tools).toBeDefined();
    expect(result.capabilities.tools?.listChanged).toBe(false);
  });

  it("acknowledges subscriptions/listen with nothing honored and closes the stream at once", async () => {
    // The filter Claude Code asks for: all list-change notifications.
    const res = await handler()(
      rpc("subscriptions/listen", {
        notifications: { toolsListChanged: true, promptsListChanged: true, resourcesListChanged: true },
      }, 7),
    );
    expect(res.status).toBe(200);
    const msgs = messages(await readToEnd(res));
    expect(msgs[0]).toMatchObject({
      method: "notifications/subscriptions/acknowledged",
      params: { notifications: {}, _meta: { "io.modelcontextprotocol/subscriptionId": 7 } },
    });
    // Graceful closure: a complete result, so the client knows not to reconnect.
    expect(msgs.at(-1)).toMatchObject({ id: 7, result: { resultType: "complete" } });
  });

  it("still serves tools/list over POST", async () => {
    const res = await handler()(rpc("tools/list"));
    const [msg] = messages(await readToEnd(res));
    const tools = (msg!.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(tools).toEqual(["search_products", "get_product", "get_quote", "checkout", "get_order"]);
  });
});

describe("/api/mcp route", () => {
  it("caps the function at 30 seconds", () => {
    expect(route.maxDuration).toBe(30);
  });

  it.each([
    ["GET", route.GET],
    ["DELETE", route.DELETE],
  ])("answers %s with 405 and Allow: POST", async (_name, fn) => {
    const res = fn();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 }, id: null });
  });

  it("methodNotAllowed matches the route answer", () => {
    expect(methodNotAllowed().headers.get("allow")).toBe("POST");
  });
});
