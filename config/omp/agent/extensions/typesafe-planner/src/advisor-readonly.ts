import { createRequire } from "node:module";
import { canonicalDigest } from "./task-contract-source";
import { record, type AdvisorRequest } from "./advisor-protocol";
import { isPrivateEvidencePath } from "./evidence-privacy";

export interface AdvisorReadLimits { maxFileBytes: number; maxOutputBytes: number; maxContextBytes: number }
export const defaultAdvisorReadLimits: Readonly<AdvisorReadLimits> = Object.freeze({ maxFileBytes: 4194304, maxOutputBytes: 16384, maxContextBytes: 262144 });
interface GuardedFileClient { readWorkspaceFile(root: string, relative: string, options: { maxBytes: number }): { bytes: Buffer; sha256: string; identity: unknown } }
interface RedactionClient { redactEvidenceState(state: unknown, options: { apiKey?: string }): unknown }
export interface AdvisorReadResult {
  content: { type: "text"; text: string }[];
  details: { advisorRead: { tool: string; sources: readonly { path: string; sha256: string; startLine?: number; endLine?: number }[]; completeWithinAuthorizedSelection: boolean; provesGlobalAbsence: false }; publicDigest: string };
  isError: false;
}
export interface AdvisorPublicTransaction { id: string; name: "read" | "grep" | "glob"; arguments: Record<string, unknown>; text: string; isError?: boolean }
const files = createRequire(import.meta.url)("./typesafe-evidence-file.cjs") as GuardedFileClient;
function loadRedaction(): RedactionClient {
  const client = createRequire(import.meta.url)("./typesafe-api-client.cjs") as RedactionClient;
  if (!client || typeof client.redactEvidenceState !== "function") throw new Error("advisor_public_redaction_unavailable");
  return client;
}
function authorizedGlob(pattern: string): RegExp {
  if (pattern.length > 512 || /[{}[\]]/.test(pattern)) throw new Error("advisor_glob_pattern_unsupported");
  return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000\//g, "(?:.*/)?").replace(/\u0000/g, ".*")}$`);
}
function selectedFiles(request: AdvisorRequest, input: Record<string, unknown>, tool: string): { path: string; sha256: string; start?: number; end?: number }[] {
  if (request.scope.files.some(file => isPrivateEvidencePath(file.path))) throw new Error("advisor_private_source_scope_denied");
  const raw = input.path;
  if (tool === "read" && (typeof raw !== "string" || raw === "." || raw === request.scope.workspaceRoot)) throw new Error("advisor_explicit_read_path_required");
  if (raw === undefined || raw === "." || raw === request.scope.workspaceRoot) return [...request.scope.files];
  if (typeof raw !== "string" || raw.includes(";") || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) throw new Error("advisor_path_scope_denied");
  const selector = /^(.*):(\d+)(?:-(\d*))?$/.exec(raw);
  const name = (selector ? selector[1] : raw).replaceAll("\\", "/");
  if (/^[a-z]:|^[/\\]|(?:^|[/\\])\.\.(?:[/\\]|$)/i.test(name) || isPrivateEvidencePath(name)) throw new Error("advisor_path_scope_denied");
  const file = request.scope.files.find(candidate => candidate.path === name);
  if (!file && tool !== "read" && !selector) {
    if (/[*?]/.test(name)) {
      const matcher = authorizedGlob(name);
      return request.scope.files.filter(candidate => matcher.test(candidate.path));
    }
    const prefix = `${name.replace(/\/$/, "")}/`;
    const children = request.scope.files.filter(candidate => candidate.path.startsWith(prefix));
    if (children.length) return children;
  }
  if (!file) throw new Error("advisor_path_scope_denied");
  if (selector && tool !== "read") throw new Error("advisor_search_selector_unsupported");
  const start = selector ? Number(selector[2]) : undefined;
  const end = selector?.[3] ? Number(selector[3]) : undefined;
  if (start !== undefined && (!Number.isSafeInteger(start) || start < 1 || end !== undefined && (!Number.isSafeInteger(end) || end < start))) throw new Error("advisor_read_selector_invalid");
  return [{ ...file, ...(start === undefined ? {} : { start, end }) }];
}
export function authorizeAdvisorRead(request: AdvisorRequest, name: string, raw: unknown): raw is Record<string, unknown> {
  if (!["read", "grep", "glob"].includes(name) || !record(raw)) return false;
  try {
    selectedFiles(request, raw, name);
    if (name === "grep" && (typeof raw.pattern !== "string" || !raw.pattern.trim() || raw.pattern.length > 512 || /[.\\[\]{}()*+?|^$]/.test(raw.pattern) || raw.skip !== undefined && raw.skip !== null && raw.skip !== 0)) return false;
    if (name === "glob" && raw.limit !== undefined && (typeof raw.limit !== "number" || !Number.isSafeInteger(raw.limit) || raw.limit < 1 || raw.limit > 200)) return false;
    return true;
  } catch { return false; }
}
/** Every actual read comes from the shared root/link/identity guard, never a native reread. */
export function executeAdvisorRead(request: AdvisorRequest, name: "read" | "grep" | "glob", input: Record<string, unknown>, limits: AdvisorReadLimits, apiKey?: string): AdvisorReadResult {
  if (!authorizeAdvisorRead(request, name, input)) throw new Error("advisor_read_arguments_denied");
  const selection = selectedFiles(request, input, name);
  const sources: { path: string; sha256: string; startLine?: number; endLine?: number }[] = [];
  const output: unknown[] = [];
  let outputBytes = 0;
  const append = (entry: Record<string, unknown>) => {
    if (typeof entry.content === "string" && Buffer.byteLength(entry.content, "utf8") > limits.maxOutputBytes) throw new Error("advisor_read_output_budget_select_fewer_lines");
    outputBytes += Buffer.byteLength(JSON.stringify(entry), "utf8");
    if (outputBytes > limits.maxOutputBytes) throw new Error("advisor_read_output_budget_select_fewer_lines");
    output.push(entry);
  };
  for (const source of selection) {
    if (name === "glob") {
      if (output.length >= (typeof input.limit === "number" ? input.limit : 200)) throw new Error("advisor_glob_result_budget_select_narrower_scope");
      append({ path: source.path, sha256: source.sha256 });
      continue;
    }
    const file = files.readWorkspaceFile(request.scope.workspaceRoot, source.path, { maxBytes: limits.maxFileBytes });
    if (file.sha256 !== source.sha256) throw new Error("advisor_evaluated_file_changed");
    if (file.bytes.includes(0)) throw new Error("advisor_binary_public_representation_required");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
    if (name === "read") {
      const start = source.start ?? 1; const requestedEnd = source.end ?? Number.MAX_SAFE_INTEGER;
      const parts: string[] = []; let line = 0; let consumed = 0; let selectedBytes = 0;
      for (const match of text.matchAll(/[^\n]*\n|[^\n]+$/g)) {
        line++; consumed += match[0].length;
        if (line >= start) {
          selectedBytes += Buffer.byteLength(match[0], "utf8");
          if (selectedBytes > limits.maxOutputBytes) throw new Error("advisor_read_output_budget_select_fewer_lines");
          parts.push(match[0]);
        }
        if (line >= requestedEnd) break;
      }
      if (line < start && text.length > 0) throw new Error("advisor_read_range_outside_source");
      const end = text.length ? line : 0;
      sources.push({ path: source.path, sha256: source.sha256, startLine: start, endLine: end });
      append({ path: source.path, fullFileDigest: source.sha256, startLine: start, endLine: end, content: parts.join(""), completeFile: start === 1 && consumed === text.length });
    } else {
      const pattern = String(input.pattern); const insensitive = input.case === false || input.ignore_case === true;
      const needle = insensitive ? pattern.toLowerCase() : pattern;
      sources.push({ path: source.path, sha256: source.sha256 });
      let line = 0;
      for (const match of text.matchAll(/[^\n]*\n|[^\n]+$/g)) {
        line++;
        if ((insensitive ? match[0].toLowerCase() : match[0]).includes(needle)) append({ path: source.path, fullFileDigest: source.sha256, line, content: match[0] });
      }
    }
  }
  const projected = loadRedaction().redactEvidenceState({ tool: name, selection: output, scope: "Only exact authorized files and requested lines; excerpts/search results never prove global absence." }, { apiKey: apiKey ?? process.env.TYPESAFE_API_KEY });
  const text = JSON.stringify(projected);
  if (Buffer.byteLength(text, "utf8") > limits.maxOutputBytes) throw new Error("advisor_read_output_budget_select_fewer_lines");
  const content = [{ type: "text" as const, text }];
  return { isError: false, content, details: { advisorRead: { tool: name, sources, completeWithinAuthorizedSelection: true, provesGlobalAbsence: false }, publicDigest: canonicalDigest(content) } };
}
