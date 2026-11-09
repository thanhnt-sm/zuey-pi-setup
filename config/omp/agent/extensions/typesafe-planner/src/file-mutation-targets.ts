export interface FileMutationTarget {
  path: string;
  operation: "modify" | "create" | "delete";
  content: string;
  renameFrom?: string;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** The native freeform edit wire is {input: hashlinePatch}; body lines start '+'. */
export function fileMutationTargets(toolName: "write" | "edit", input: unknown): FileMutationTarget[] {
  if (!record(input)) return [];
  if (toolName === "write") {
    return typeof input.path === "string" && typeof input.content === "string"
      ? [{ path: input.path, operation: "modify", content: input.content }] : [];
  }
  if (typeof input.input !== "string") return [];
  const targets: FileMutationTarget[] = [];
  let current: FileMutationTarget | undefined;
  const bodies: string[] = [];
  function finish(): void {
    if (current) { current.content = bodies.join("\n"); targets.push(current); }
    bodies.length = 0;
  }
  for (const line of input.input.split(/\r?\n/)) {
    const header = /^\[([^#\r\n]+)#[0-9A-F]{4}\]$/.exec(line);
    if (header) { finish(); current = { path: header[1], operation: "modify", content: "" }; continue; }
    if (!current) continue;
    if (line === "REM") current.operation = "delete";
    else if (line.startsWith("MV ")) {
      const raw = line.slice(3).trim();
      const destination = raw.length > 1 && (raw.startsWith('"') && raw.endsWith('"') || raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1) : raw;
      if (!destination) return [];
      targets.push({ path: destination, operation: "create", content: "", renameFrom: current.path });
      current.operation = "delete";
    }
    bodies.push(line);
  }
  finish();
  return targets;
}

export function requestsPlanCompletion(content: string): boolean {
  const lines = content.split(/\r?\n/).map(line => line.startsWith("+") ? line.slice(1) : line);
  const first = lines.findIndex(line => line.trim().length > 0);
  const frontmatterEnd = first >= 0 && lines[first].trim() === "---"
    ? lines.findIndex((line, index) => index > first && line.trim() === "---") : -1;
  let fence: { character: string; length: number } | undefined;
  for (const line of frontmatterEnd > first && first >= 0 ? lines.slice(first + 1, frontmatterEnd) : lines) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { character: marker[0], length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (!fence && /^\s*status:\s*["']?complete(?:d)?["']?\s*(?:#.*)?$/i.test(line)) return true;
  }
  return false;
}
