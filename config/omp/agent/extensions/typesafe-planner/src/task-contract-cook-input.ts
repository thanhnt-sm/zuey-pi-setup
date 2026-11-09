import { randomUUID } from "node:crypto";
import path from "node:path";
import { readHostBranch, userRequestText, type HostBranch } from "./host-history";
import { canonicalDigest, contractDigest, freezeContractValue, isDigest } from "./task-contract-source";
import { explicitCookPath, snapshotCookDocuments, workspaceSourcePath } from "./task-contract-runtime-sources";
import { CONTRACT_SOURCE_CUSTOM_TYPE, type CookInputObservation, type CookInputObservationRecord, type FrozenSourceDocument } from "./task-contract-runtime-types";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** SDK input handlers are awaited, but earlier handlers may transform text; this records observations, never permission. */
export async function captureCookInput(ctx: unknown, event: unknown, appendEntry: (customType: string, data: unknown) => void): Promise<void> {
  if (!object(ctx) || typeof ctx.cwd !== "string" || !path.isAbsolute(ctx.cwd) || !object(event)
    || event.type !== "input" || typeof event.text !== "string" || event.source !== "interactive" && event.source !== "rpc") return;
  const prompt = event.text.trim();
  const sourcePath = explicitCookPath(prompt, ctx.cwd);
  if (!sourcePath) return;
  const branch = readHostBranch(ctx);
  let sessionId = branch?.sessionId;
  let originParentId = branch?.entries.at(-1)?.id ?? null;
  if (!branch) {
    // The first genuine input can precede every SDK message; only the real manager can establish that empty session.
    if (!object(ctx.sessionManager) || typeof ctx.sessionManager.getBranch !== "function" || typeof ctx.sessionManager.getSessionId !== "function") return;
    const entries: unknown = ctx.sessionManager.getBranch();
    const actualSessionId: unknown = ctx.sessionManager.getSessionId();
    if (!Array.isArray(entries) || entries.length !== 0 || typeof actualSessionId !== "string" || !actualSessionId) return;
    sessionId = actualSessionId;
    originParentId = null;
  }
  if (!sessionId) return;
  const documents = snapshotCookDocuments(ctx.cwd, sourcePath);
  const data: CookInputObservationRecord = { schemaVersion: 1, kind: "cook_input_observation", sessionId, originParentId,
    nonce: randomUUID(), origin: event.source, prompt, promptDigest: contractDigest(prompt), sourcePath, documents };
  appendEntry(CONTRACT_SOURCE_CUSTOM_TYPE, freezeContractValue(structuredClone(data)));
  const after = readHostBranch(ctx);
  const matches = after?.sessionId === sessionId ? after.entries.filter((entry) => entry.type === "custom"
    && entry.customType === CONTRACT_SOURCE_CUSTOM_TYPE && object(entry.data) && entry.data.nonce === data.nonce
    && entry.parentId === originParentId && canonicalDigest(entry.data) === canonicalDigest(data)) : [];
  if (matches.length !== 1) throw new Error("cook_input_observation_not_persisted_by_actual_host");
}

function documentsFrom(value: unknown, cwd: string, sourcePath: string): readonly FrozenSourceDocument[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const documents: FrozenSourceDocument[] = [];
  const paths = new Set<string>();
  for (const item of value) {
    if (!object(item) || typeof item.path !== "string" || workspaceSourcePath(cwd, item.path) !== item.path
      || typeof item.text !== "string" || !isDigest(item.digest) || contractDigest(item.text) !== item.digest || paths.has(item.path)
      || Object.keys(item).some((key) => !["path", "text", "digest"].includes(key))) return undefined;
    paths.add(item.path);
    documents.push({ path: item.path, text: item.text, digest: item.digest });
  }
  const master = documents.find((document) => document.path === sourcePath);
  if (!master) return undefined;
  if (path.posix.basename(master.path).toLowerCase() !== "plan.md") return documents.length === 1 ? documents : undefined;
  const linked = new Set<string>();
  for (const match of master.text.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1].split("#")[0];
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) continue;
    const candidate = workspaceSourcePath(cwd, path.posix.normalize(path.posix.join(path.posix.dirname(master.path), href)));
    if (!candidate) continue;
    const document = documents.find((item) => item.path === candidate);
    if (/^phase-\d+.*\.md$/i.test(path.posix.basename(candidate))) {
      if (!document) return undefined;
      linked.add(candidate);
    } else if (document && /^phase:\s*\d+\s*$/m.test(document.text)) linked.add(candidate);
  }
  return documents.every((document) => document.path === sourcePath || linked.has(document.path)) ? documents : undefined;
}

/** Exact future role:user join only; imports, skill prose and ambiguous duplicate input observations do not qualify. */
export function readCookInputObservations(branch: HostBranch, cwd: string): readonly CookInputObservation[] {
  const candidates: { observation: CookInputObservation; nonce: string }[] = [];
  for (let index = 0; index < branch.entries.length; index++) {
    const entry = branch.entries[index];
    if (entry.type !== "custom" || entry.customType !== CONTRACT_SOURCE_CUSTOM_TYPE || !object(entry.data) || entry.data.kind !== "cook_input_observation") continue;
    try {
      const data = entry.data;
      if (data.schemaVersion !== 1 || data.sessionId !== branch.sessionId || data.originParentId !== entry.parentId
        || typeof data.nonce !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.nonce)
        || data.origin !== "interactive" && data.origin !== "rpc" || typeof data.prompt !== "string" || !isDigest(data.promptDigest)
        || contractDigest(data.prompt) !== data.promptDigest || typeof data.sourcePath !== "string"
        || explicitCookPath(data.prompt, cwd) !== data.sourcePath) continue;
      const documents = documentsFrom(data.documents, cwd, data.sourcePath);
      if (!documents) continue;
      const user = branch.entries.find((candidate, position) => position > index && candidate.type === "message" && candidate.message?.role === "user");
      const text = user && userRequestText(user);
      if (!user || typeof text !== "string" || text !== data.prompt || contractDigest(text) !== data.promptDigest) continue;
      candidates.push({ nonce: data.nonce, observation: { reference: { sessionId: branch.sessionId, entryId: entry.id, digest: canonicalDigest(data) },
        userRequest: { kind: "user_request", sessionId: branch.sessionId, entryId: user.id, digest: data.promptDigest },
        sourcePath: data.sourcePath, origin: data.origin, documents } });
    } catch { /* A partial source observation cannot fabricate either a user join or authority. */ }
  }
  const users = new Map<string, number>();
  const nonces = new Map<string, number>();
  for (const { observation, nonce } of candidates) {
    users.set(observation.userRequest.entryId, (users.get(observation.userRequest.entryId) ?? 0) + 1);
    nonces.set(nonce, (nonces.get(nonce) ?? 0) + 1);
  }
  return freezeContractValue(structuredClone(candidates.filter(({ observation, nonce }) => users.get(observation.userRequest.entryId) === 1
    && nonces.get(nonce) === 1).map(({ observation }) => observation)));
}
