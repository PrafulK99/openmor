import { CLIENT_INFO_META_KEY, type McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { agentTokenHash } from "@/core/agent-sessions";
import { seedMerchant, seedProduct, setup } from "@/test/core-fixtures";
import { withRequestInfo } from "./request-info";
import { clientInfoOf, nameFromUserAgent, registerOpenMorTools, TOOLS } from "./server";

type Callback = (input: unknown, ctx: ServerContext) => Promise<unknown>;

function fakeServer(initializeClient?: { name: string; version: string }) {
  const tools = new Map<string, { config: Record<string, unknown>; cb: Callback }>();
  const server = {
    registerTool: vi.fn((name: string, config: Record<string, unknown>, cb: Callback) => {
      tools.set(name, { config, cb });
    }),
    server: { getClientVersion: () => initializeClient },
  };
  return { server: server as unknown as McpServer, tools };
}

function ctxWith(clientInfo?: unknown): ServerContext {
  return {
    mcpReq: { id: 1, method: "tools/call", ...(clientInfo ? { envelope: { [CLIENT_INFO_META_KEY]: clientInfo } } : {}) },
  } as unknown as ServerContext;
}

// Run a callback inside a fake HTTP request so request-info is populated.
async function inRequest<T>(fn: () => Promise<T>, headers: Record<string, string> = {}): Promise<T> {
  let out: T;
  await withRequestInfo(async () => {
    out = await fn();
    return new Response();
  })(new Request("http://localhost/api/mcp", { method: "POST", headers }));
  return out!;
}

describe("registerOpenMorTools", () => {
  it("registers all eight tools with schemas and annotations", () => {
    const t = setup();
    const { server, tools } = fakeServer();
    registerOpenMorTools(server, { ...t.deps, appUrl: "http://localhost:3000" });
    expect([...tools.keys()]).toEqual(["search_products", "get_product", "get_quote", "link_buyer", "get_buyer_link", "revoke_buyer_link", "checkout", "get_order"]);
    for (const def of TOOLS) {
      const { config } = tools.get(def.name)!;
      expect(config).toMatchObject({ description: def.description, annotations: def.annotations });
      // Wrapped for portable JSON Schema, but validation is still zod's.
      const out = (config.outputSchema as { "~standard": { validate: unknown; vendor: string } })["~standard"];
      expect(out.validate).toBe(def.outputSchema["~standard"].validate);
    }
  });

  it("creates an AgentSession per agent, stores the client name, and attaches it to quotes", async () => {
    const t = setup();
    const merchantId = seedMerchant(t.db).id;
    const productId = seedProduct(t.db, merchantId).id;
    const { server, tools } = fakeServer();
    registerOpenMorTools(server, { ...t.deps, appUrl: "http://localhost:3000" });
    const ctx = ctxWith({ name: "claude-code", version: "2.1.0" });
    const headers = { "user-agent": "claude-code/2.1.0", "x-forwarded-for": "203.0.113.7, 10.0.0.1" };

    await inRequest(() => tools.get("search_products")!.cb({ query: "" }, ctx), headers);
    await inRequest(
      () => tools.get("get_quote")!.cb({ merchant_id: merchantId, product_id: productId, buyer_country: "DE" }, ctx),
      headers,
    );

    expect(t.db.tables.agentSession).toHaveLength(1);
    const session = t.db.tables.agentSession[0]!;
    expect(session).toMatchObject({
      clientName: "claude-code",
      tokenHash: agentTokenHash("claude-code|2.1.0|claude-code/2.1.0|203.0.113.7"),
    });
    expect(t.db.tables.quote[0]!.agentSessionId).toBe(session.id);
  });

  it("still answers when the AgentSession cannot be written", async () => {
    const t = setup();
    vi.spyOn(t.db.agentSession, "upsert").mockRejectedValueOnce(new Error("db down"));
    const { server, tools } = fakeServer();
    registerOpenMorTools(server, { ...t.deps, appUrl: "http://localhost:3000" });
    const r = (await inRequest(() => tools.get("search_products")!.cb({ query: "" }, ctxWith()))) as { isError?: boolean };
    expect(r.isError).toBeUndefined();
  });
});

describe("nameFromUserAgent", () => {
  it("takes the first product token and rejects junk", () => {
    expect(nameFromUserAgent("claude-code/2.1.0 (win32)")).toBe("claude-code");
    expect(nameFromUserAgent("node")).toBe("node");
    expect(nameFromUserAgent(undefined)).toBeUndefined();
    expect(nameFromUserAgent("<script>/1")).toBeUndefined();
  });

  it("names the session from the User-Agent when the client reports no name", async () => {
    const t = setup();
    const { server, tools } = fakeServer();
    registerOpenMorTools(server, { ...t.deps, appUrl: "http://localhost:3000" });
    await inRequest(() => tools.get("search_products")!.cb({ query: "" }, ctxWith()), { "user-agent": "smoke-test/1.0" });
    expect(t.db.tables.agentSession[0]!.clientName).toBe("smoke-test");
  });
});

describe("clientInfoOf", () => {
  it("prefers the per-request envelope and falls back to the initialize-time client info", () => {
    const { server } = fakeServer({ name: "inspector", version: "0.1" });
    expect(clientInfoOf(server, ctxWith({ name: "claude-code", version: "2" }))).toEqual({ name: "claude-code", version: "2" });
    expect(clientInfoOf(server, ctxWith())).toEqual({ name: "inspector", version: "0.1" });
    expect(clientInfoOf(fakeServer().server, ctxWith({ name: 42 }))).toEqual({});
  });
});
