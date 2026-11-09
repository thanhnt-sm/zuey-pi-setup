import { createHash } from "node:crypto";
import type { ContractCriterion, CreationProvenance, NativeTaskSourceBinding, NativeTaskTarget, SourceSpan } from "./types/verification";

export function contractDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalDigest(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item !== null && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical((item as Record<string, unknown>)[key])]));
    return item;
  };
  return contractDigest(JSON.stringify(canonical(value)));
}

export function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export interface ContractSourceInput {
  kind: "plan" | "user_request" | "native_task";
  path: string;
  text: string;
  digest: string;
  /** Exact heading text, not a substring or a filename heuristic. */
  phaseHeading?: string;
  nativeBinding?: NativeTaskSourceBinding;
}

export function nativeTaskSourceUri(creation: CreationProvenance, target: NativeTaskTarget): string {
  if (!nonempty(creation.sessionId) || !nonempty(creation.entryId) || !Number.isInteger(target.phaseOrdinal) || target.phaseOrdinal < 0
    || !Number.isInteger(target.ordinal) || target.ordinal < 0) throw new Error("contract_native_source_identity_invalid");
  return `native-todo://${encodeURIComponent(creation.sessionId)}/${encodeURIComponent(creation.entryId)}?phaseOrdinal=${target.phaseOrdinal}&ordinal=${target.ordinal}`;
}

export function parseContractCriteria(source: ContractSourceInput): ContractCriterion[] {
  if (!["plan", "user_request", "native_task"].includes(source.kind) || !nonempty(source.path) || !nonempty(source.text) || contractDigest(source.text) !== source.digest) {
    throw new Error("contract_source_digest_mismatch");
  }
  const lines = source.text.split(/\r?\n/);
  const span = (start: number, end: number): SourceSpan => ({
    path: source.path, digest: source.digest, startLine: start + 1, endLine: end + 1,
    text: lines.slice(start, end + 1).join(source.text.includes("\r\n") ? "\r\n" : "\n"),
  });
  const criterion = (kind: ContractCriterion["kind"], start: number, end: number, text: string): ContractCriterion => ({
    id: canonicalDigest({ path: source.path, digest: source.digest, kind, start, end, text }),
    kind, text, source: span(start, end),
  });
  if (source.kind === "native_task") {
    const binding = source.nativeBinding;
    if (!binding?.creation || !binding.target || source.text !== binding.target.content
      || source.path !== nativeTaskSourceUri(binding.creation, binding.target)) throw new Error("contract_native_source_binding_invalid");
    return [criterion("native_task", 0, lines.length - 1, source.text)];
  }
  if (source.kind === "user_request") {
    if (/^(?:continue|proceed|resume|go ahead)[.!\s]*$/i.test(source.text)) throw new Error("contract_original_request_required");
    return [criterion("original_request", 0, lines.length - 1, source.text)];
  }
  if (!nonempty(source.phaseHeading)) throw new Error("contract_explicit_phase_required");
  let fence: { character: string; length: number } | undefined;
  const codeLines = lines.map((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { character: marker[0], length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = undefined;
      return true;
    }
    return fence !== undefined;
  });
  const headings = lines.flatMap((line, index) => {
    if (codeLines[index]) return [];
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    return match ? [{ index, depth: match[1].length, title: match[2] }] : [];
  });
  const matches = headings.filter((heading) => heading.title === source.phaseHeading);
  if (matches.length !== 1) throw new Error("contract_phase_missing_or_ambiguous");
  const selected = matches[0];
  const end = headings.find((heading) => heading.index > selected.index && heading.depth <= selected.depth)?.index ?? lines.length;
  const criteria: ContractCriterion[] = [];
  let section: { depth: number; kind: ContractCriterion["kind"] } | undefined;
  for (let index = selected.index + 1; index < end; index++) {
    if (codeLines[index]) continue;
    const heading = headings.find((item) => item.index === index);
    if (heading) {
      if (section && heading.depth <= section.depth) section = undefined;
      if (/^(requirements|success criteria|acceptance criteria|parent (?:requirements|integration requirements))$/i.test(heading.title)) {
        section = { depth: heading.depth, kind: /^requirements$/i.test(heading.title) ? "requirement" : /^parent /i.test(heading.title) ? "parent_integration" : "acceptance" };
      }
      continue;
    }
    if (!section) continue;
    const bullet = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)(\S.*)$/.exec(lines[index]);
    if (!lines[index].trim() || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[index])) continue;
    const start = index;
    let text = bullet?.[1] ?? lines[index].trim();
    while (index + 1 < end && !codeLines[index + 1] && /^\s{2,}\S/.test(lines[index + 1]) && !/^\s*(?:[-*+] |\d+[.)] )/.test(lines[index + 1])) {
      text += `\n${lines[++index].trim()}`;
    }
    if (/^(?:TODO|TBD|placeholder|lorem ipsum|\.\.\.)[.!\s]*$/i.test(text)) throw new Error("contract_placeholder_criterion");
    criteria.push(criterion(section.kind, start, index, text));
  }
  if (!criteria.length) throw new Error("contract_phase_has_no_criteria");
  return criteria;
}

export function freezeContractValue<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeContractValue(child);
    Object.freeze(value);
  }
  return value;
}
