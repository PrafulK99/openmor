import { createHash } from "node:crypto";
import { nowFrom, type CoreDeps } from "@/core/deps";
import { limitText, TEXT_LIMITS } from "@/core/text";

/** An agent session stays alive this long after its last tool call. */
export const AGENT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Namespaces anonymous fingerprints so they can never collide with real bearer-token hashes later.
const ANON_PREFIX = "anon-v1:";

export interface AgentIdentity {
  /**
   * Stable string identifying the calling agent, built by the protocol layer
   * (e.g. client name + version + user agent + IP). Never stored: only its SHA-256.
   */
  fingerprint: string;
  /** Self-reported client name, e.g. "claude-code". Data, not trusted. */
  clientName?: string | null;
}

export function agentTokenHash(fingerprint: string): string {
  return createHash("sha256").update(ANON_PREFIX + fingerprint).digest("hex");
}

/**
 * Create or refresh the AgentSession for an identity and return its id.
 * v1 has no auth, so the session is keyed by a hashed fingerprint and slides
 * forward 24h on every call. It is for attribution, not a security boundary.
 */
export async function touchAgentSession(deps: CoreDeps, identity: AgentIdentity): Promise<string> {
  const now = nowFrom(deps);
  const expiresAt = new Date(now.getTime() + AGENT_SESSION_TTL_MS);
  const clientName = limitText(identity.clientName, TEXT_LIMITS.name);
  const session = await deps.db.agentSession.upsert({
    where: { tokenHash: agentTokenHash(identity.fingerprint) },
    create: { tokenHash: agentTokenHash(identity.fingerprint), clientName, lastSeenAt: now, expiresAt },
    // Keep a known name if this call did not report one.
    update: { lastSeenAt: now, expiresAt, ...(clientName ? { clientName } : {}) },
    select: { id: true },
  });
  return session.id;
}
