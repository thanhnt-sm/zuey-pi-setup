import path from "node:path";

interface SessionPolicy {
  sessionId: string;
  sessionFile?: string;
  agentId: string;
  excluded: boolean;
}
const sessionPolicies = new WeakMap<object, Map<string, SessionPolicy>>();

/**
 * Governance is latched on the first host observation of a native session. Config
 * reload can stop transport immediately, but cannot relax an existing session's
 * guards. Children inherit their observed parent's decision, including worktrees.
 * An unobserved parent never grants a bypass. Restart OMP to reload this policy;
 * branch/switch/turn events and changes to cwd do not replace a session snapshot.
 * No history is rewritten and this snapshot is not a verification receipt.
 */
export function createProjectExclusionPolicy(host: object, resolve: (cwd: string) => boolean): (context: unknown) => boolean {
  let sessions = sessionPolicies.get(host);
  if (!sessions) { sessions = new Map(); sessionPolicies.set(host, sessions); }
  const unscoped = new Map<string, boolean>();
  return context => {
    const raw = context && typeof context === "object" ? context as {
      cwd?: unknown;
      agent?: { kind?: string; id?: string; parentId?: string };
      sessionManager?: { getSessionId?(): string; getSessionFile?(): string | undefined; getHeader?(): { parentSession?: string } | null };
    } : undefined;
    const cwd = typeof raw?.cwd === "string" && raw.cwd.trim() ? raw.cwd : process.cwd();
    try {
      const id = raw?.sessionManager?.getSessionId?.();
      if (!id) {
        if (raw?.agent?.kind === "sub") return false;
        const key = path.resolve(cwd);
        if (!unscoped.has(key)) unscoped.set(key, resolve(cwd));
        return unscoped.get(key) === true;
      }
      const existing = sessions.get(id);
      if (existing) return existing.excluded;
      let excluded: boolean;
      if (raw?.agent?.kind === "sub") {
        const parentSession = raw.sessionManager?.getHeader?.()?.parentSession;
        const parent = [...sessions.values()].find(candidate => candidate.agentId === raw.agent?.parentId
          && typeof parentSession === "string" && (candidate.sessionId === parentSession
            || candidate.sessionFile !== undefined && path.resolve(candidate.sessionFile) === path.resolve(parentSession)));
        excluded = parent?.excluded === true;
      } else {
        excluded = resolve(cwd);
      }
      sessions.set(id, { sessionId: id, sessionFile: raw?.sessionManager?.getSessionFile?.(), agentId: raw?.agent?.id ?? id, excluded });
      return excluded;
    } catch {
      // Missing actual host identity or resolver failures never relax governance.
      return false;
    }
  };
}

export function projectExcludedResult() {
  const details = { status: "DISABLED", reason: "global-excluded", authority: "none",
    message: "TypeSafe extension workflow is disabled for this explicitly excluded session. Use ordinary native tools and Advisor; no approval or historical debt reconciliation is granted." };
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
}
