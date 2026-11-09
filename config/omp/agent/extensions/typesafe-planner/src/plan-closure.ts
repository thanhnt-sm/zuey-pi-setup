import path from "node:path";
import type { ContractRuntime } from "./contract-runtime";
import type { TaskVerificationRuntime } from "./task-verification-runtime";
import { readWorkspaceFile, listWorkspaceFiles } from "./typesafe-evidence-file.cjs";

export type PlanCliCheck = { kind: "other" } | { kind: "unsupported" } | { kind: "start"; phase: number } | { kind: "complete"; phase: number };
export class PlanClosurePrerequisiteError extends Error {
  constructor(message: string) { super(message); this.name = "PlanClosurePrerequisiteError"; }
}
/** A direct, quoted argv form only. Compound shell commands never acquire closure authority. */
export function parsePlanCliCheck(command: string): PlanCliCheck {
  if (!/plan-cli(?:\.cjs)?["']?\s+check\b/i.test(command)) return { kind: "other" };
  const tokens = command.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+/g)?.map(token => token.replace(/^(["'])([\s\S]*)\1$/, "$2")) ?? [];
  if (tokens.some(token => /[;&|<>`$]/.test(token))) return { kind: "unsupported" };
  if (/^(?:.*[\\/])?(?:node|bun)(?:\.exe)?$/i.test(tokens[0] ?? "")) tokens.shift();
  if (!/^(?:.*[\\/])?plan-cli(?:\.cjs)?$/i.test(tokens[0] ?? "") || tokens[1] !== "check" || !/^\d+$/.test(tokens[2] ?? "") || tokens.length > 4 || tokens[3] !== undefined && tokens[3] !== "--start") return { kind: "unsupported" };
  const phase = Number(tokens[2]);
  if (!Number.isSafeInteger(phase) || phase < 1) return { kind: "unsupported" };
  return { kind: tokens[3] === "--start" ? "start" : "complete", phase };
}

export function phaseFileForCheck(workspaceRoot: string, planDirectory: string, phase: number): string {
  const directory = path.relative(workspaceRoot, path.resolve(workspaceRoot, planDirectory)).replace(/\\/g, "/");
  if (path.isAbsolute(directory) || directory.split("/").includes("..")) throw new PlanClosurePrerequisiteError("EVIDENCE_REQUIRED: plan directory is outside the current workspace.");
  const matches = listWorkspaceFiles(workspaceRoot, directory || ".", { maxFiles: 2000 }).filter(file =>
    path.posix.dirname(file) === (directory || ".") && new RegExp(`^phase-0*${phase}(?:-|\\.md$)`, "i").test(path.posix.basename(file)));
  if (matches.length !== 1) throw new PlanClosurePrerequisiteError("EVIDENCE_REQUIRED: select one unambiguous phase file in the actual plan cwd.");
  return matches[0];
}

/** No latest-plan heuristic or global all-todos gate. Native obligations remain independently authoritative. */
export async function assertScopedPlanClosure(contracts: ContractRuntime | undefined, verification: TaskVerificationRuntime | undefined, context: unknown, cwd: string, target: string): Promise<void> {
  if (!contracts || !verification) throw new PlanClosurePrerequisiteError("UNAVAILABLE: supported source-bound plan review host is required.");
  const relative = path.relative(cwd, path.resolve(cwd, target)).replace(/\\/g, "/");
  if (!relative || path.isAbsolute(relative) || relative.split("/").includes("..")) throw new PlanClosurePrerequisiteError("EVIDENCE_REQUIRED: exact workspace plan source is required.");
  const projection = contracts.projection(context);
  if (!projection?.nativeStateReliable) throw new PlanClosurePrerequisiteError("EVIDENCE_REQUIRED: observe actual Core state before closing an explicitly bound plan.");
  const master = path.posix.basename(relative) === "plan.md";
  const related = projection.contracts.filter(contract => {
    const source = contracts.sourceContext(contract)?.parentSource;
    return source && (source.path === relative || master && source.master?.path === relative);
  });
  if (!related.length) throw new PlanClosurePrerequisiteError("EVIDENCE_REQUIRED: bind the explicit plan/phase to its genuine original obligation; never infer the newest plan.");
  const open = related.filter(contract => {
    const native = projection.incarnations.find(item => item.incarnationId === contract.incarnationId);
    const task = native && projection.nativePhases?.[native.target.phaseOrdinal]?.tasks[native.target.ordinal];
    return !task || task.content !== native?.target.content || task.status !== "completed" || verification.hasDebt(context, contract.incarnationId);
  });
  if (open.length) throw new PlanClosurePrerequisiteError(`EVIDENCE_REQUIRED: only this plan's bound obligations require recovery: ${open.map(contract => contract.target.content).join("; ")}. Preserve each goal; obtain Advisor diagnosis, repair its relevant evidence, run checks/smoke and finish its actual native commit. Unrelated session todos do not block this plan.`);
  const reviewSources = [...new Map(related.map(contract => {
    const source = contracts.sourceContext(contract)!.parentSource!;
    return [`${source.path}\u0000${source.phaseHeading}`, source] as const;
  })).values()];
  for (const source of reviewSources) if (!await verification.getCurrentPlanPhaseReview(context, source.path, source.phaseHeading)) {
    throw new PlanClosurePrerequisiteError("REVIEW_REQUIRED: execute an actual independent typesafe_advisor plan-review for this exact full parent source and every original criterion. Child passes and status marks are not parent acceptance.");
  }
  // Guarded read proves the named plan is a present local source, not a nonexistent filename proposal.
  readWorkspaceFile(cwd, relative, { maxBytes: 1024 * 1024 });
}
