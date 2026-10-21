import { beforeEach, describe, expect, it } from "vitest";
import { AGENT_SESSION_TTL_MS, agentTokenHash, touchAgentSession } from "@/core/agent-sessions";
import { setup } from "@/test/core-fixtures";

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup();
});

describe("touchAgentSession", () => {
  it("creates a session keyed by the fingerprint hash, never the fingerprint", async () => {
    const id = await touchAgentSession(t.deps, { fingerprint: "claude-code|1.0|ua|1.2.3.4", clientName: "claude-code" });
    const [row] = t.db.tables.agentSession;
    expect(row).toMatchObject({ id, clientName: "claude-code", tokenHash: agentTokenHash("claude-code|1.0|ua|1.2.3.4") });
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("1.2.3.4");
    expect((row!.expiresAt as Date).getTime() - t.clock.now().getTime()).toBe(AGENT_SESSION_TTL_MS);
  });

  it("refreshes the same session on later calls and keeps a known client name", async () => {
    const first = await touchAgentSession(t.deps, { fingerprint: "fp", clientName: "claude-code" });
    t.clock.advance(60_000);
    const second = await touchAgentSession(t.deps, { fingerprint: "fp", clientName: null });
    expect(second).toBe(first);
    expect(t.db.tables.agentSession).toHaveLength(1);
    expect(t.db.tables.agentSession[0]).toMatchObject({ clientName: "claude-code", lastSeenAt: t.clock.now() });
  });

  it("separates different fingerprints", async () => {
    const a = await touchAgentSession(t.deps, { fingerprint: "a" });
    const b = await touchAgentSession(t.deps, { fingerprint: "b" });
    expect(a).not.toBe(b);
  });

  it("caps a long self-reported client name", async () => {
    await touchAgentSession(t.deps, { fingerprint: "x", clientName: "n".repeat(500) });
    expect(Array.from(t.db.tables.agentSession[0]!.clientName as string)).toHaveLength(200);
  });
});
