import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { canonicalDigest, nativeTodoInputDigest, normalizeNativeTodoInput, readNativeTodoOperation, type ContractHistoryProjection, type NativeIncarnationReference, type NormalizedNativeTodoInput } from "./task-contract";
import { writeRecoveryReport } from "./typesafe-evidence-file.cjs";
import { readHostBranch } from "./host-history";
import { isSolvableTechnicalFailure } from "./anti-blocking-guards";

interface LifecycleContext { hasUI?: boolean; ui?: { confirm?(title: string, message: string): Promise<boolean> } }
export interface RecoveryHandoff {
  owner: string; nextAction: string; unblockCondition: string; resumeCommand: string;
}
export interface LifecyclePreparationInput { input: unknown; handoff?: RecoveryHandoff }
export type LifecyclePreparationOutcome =
  | { status: "PREPARED"; operation: string; expiresAt: number; report: string; reportReference: string; reportStorage: "workspace-file" | "session-custom-entry"; reportPath?: string; reportDigest: string }
  | { status: "EVIDENCE_REQUIRED" | "HUMAN_REQUIRED"; reasons: readonly string[] };
export interface LifecycleAuthorityOptions {
  appendEntry(customType: string, data: unknown): void;
  project(context: unknown): ContractHistoryProjection | undefined;
  hasDebt(context: unknown, incarnation: NativeIncarnationReference): boolean;
  allowVerifiedDrop?(context: unknown, input: NormalizedNativeTodoInput): Promise<boolean>;
  apiKey?: string;
}
interface LifecycleGrant { inputDigest: string; targetDigest: string; sessionId: string; expiresAt: number; reportReference: string; verifiedDrop: boolean }
interface PreparedLifecycleTargets { sessionId: string; operation: "init" | "rm" | "drop" | "block"; targets: NativeIncarnationReference[]; targetDigest: string }
export interface TodoLifecycleAuthority {
  prepare(context: unknown, proposal: LifecyclePreparationInput): Promise<LifecyclePreparationOutcome>;
  consume(context: unknown, input: unknown): Promise<{ allowed: true; reportReference?: string } | { allowed: false; reason: string }>;
  invalidate(): void;
}
export const LIFECYCLE_RECOVERY_ENTRY = "omp.typesafe.lifecycle-recovery.v1";
const GRANT_TTL_MS = 60_000;

function selectTargets(context: unknown, input: NormalizedNativeTodoInput, options: LifecycleAuthorityOptions): PreparedLifecycleTargets | undefined {
  const branch = readHostBranch(context);
  const projection = options.project(context);
  if (!branch || !projection) return undefined;
  const neverInitialized = projection.nativePhases === undefined && !branch.entries.some(entry =>
    entry.type === "message" && entry.message?.role === "toolResult" && entry.message.toolName === "todo");
  if (!projection.nativeStateReliable && !neverInitialized) return undefined;
  const operation = readNativeTodoOperation(input, projection.nativePhases);
  if (operation !== "init" && operation !== "rm" && operation !== "drop" && operation !== "block") return undefined;
  let targets = projection.incarnations;
  if (operation !== "init") {
    if (input.task) {
      const first = targets.find(target => target.target.content === input.task);
      targets = first && (!input.phase || first.target.phase === input.phase) ? [first] : [];
    } else if (input.phase) targets = targets.filter(target => target.target.phase === input.phase);
  }
  if (operation === "block") targets = targets.filter(target =>
    ["pending", "in_progress", "blocked"].includes(projection.nativePhases?.[target.target.phaseOrdinal]?.tasks[target.target.ordinal]?.status ?? ""));
  return { sessionId: branch.sessionId, operation, targets, targetDigest: canonicalDigest(targets.map(target => ({
    incarnationId: target.incarnationId, target: target.target,
    status: projection.nativePhases?.[target.target.phaseOrdinal]?.tasks[target.target.ordinal]?.status,
    blocker: projection.nativePhases?.[target.target.phaseOrdinal]?.tasks[target.target.ordinal]?.blocker,
    revisionId: projection.contracts.find(contract => contract.incarnationId === target.incarnationId)?.revisionId,
    hasDebt: options.hasDebt(context, target),
  }))) };
}

/** Human scope changes happen here, never inside the short native todo preflight. */
export function createTodoLifecycleAuthority(options: LifecycleAuthorityOptions): TodoLifecycleAuthority {
  const grants = new Map<string, LifecycleGrant>();
  return {
    async prepare(context, proposal) {
      const normalized = normalizeNativeTodoInput(proposal.input);
      if (!normalized.valid) return { status: "EVIDENCE_REQUIRED", reasons: [normalized.reason] };
      const input = normalized.input;
      const selected = selectTargets(context, input, options);
      if (!selected) return { status: "EVIDENCE_REQUIRED", reasons: ["Current exact native lifecycle history and a supported lifecycle mutation are required."] };
      const { operation, targets } = selected;
      if (operation === "block" && isSolvableTechnicalFailure(input.reason)) {
        return {
          status: "EVIDENCE_REQUIRED",
          reasons: [
            "CẤM đóng băng todo vì lỗi kiểm thử hoặc thiếu cài đặt kỹ thuật. Tác tử BẮT BUỘC phải thực hiện quy trình tự chữa lành: triệu hồi Advisor (typesafe_prepare_advisor) để lập kế hoạch giải quyết, sau đó sửa mã nguồn và chạy lại kiểm thử đến khi đạt."
          ]
        };
      }
      if ((operation === "block" || operation === "drop") && !input.reason?.trim()) {
        return { status: "EVIDENCE_REQUIRED", reasons: ["A concrete public reason is required; a lifecycle label is not a repair."] };
      }
      const handoff = proposal.handoff ? structuredClone(proposal.handoff) : undefined;
      if (operation === "block" && (!handoff || ["owner", "nextAction", "unblockCondition", "resumeCommand"].some(key =>
        typeof handoff[key as keyof RecoveryHandoff] !== "string" || !handoff[key as keyof RecoveryHandoff].trim()))) {
        return { status: "EVIDENCE_REQUIRED", reasons: ["Blocking requires an owner, executable next action, observable unblock condition, and exact resume command."] };
      }
      const before = selected.targetDigest;
      const digest = nativeTodoInputDigest(input);
      let verifiedDrop = false;
      if (operation === "drop" && targets.length && !targets.some(target => options.hasDebt(context, target))) {
        try { verifiedDrop = await options.allowVerifiedDrop?.(context, input) === true; } catch { /* No authenticated automatic cancellation proof. */ }
      }
      const needsHuman = operation === "block" || operation !== "block" && !verifiedDrop || targets.some(target => options.hasDebt(context, target));
      if (needsHuman && (targets.length > 0 || operation === "block")) {
        const contextValue = context as LifecycleContext | undefined;
        if (contextValue?.hasUI !== true || typeof contextValue.ui?.confirm !== "function") return { status: "HUMAN_REQUIRED", reasons: ["Prepare the exact scope change through a real host UI confirmation; proposed flags and model judgments cannot authorize it."] };
        let confirmed = false;
        try {
          confirmed = await contextValue.ui.confirm("TypeSafe: authorize exact lifecycle change?", JSON.stringify({ operation, targets: targets.map(target => target.target), reason: input.reason, handoff, warning: "This does not complete work or forgive rejection debt. Removed obligations remain in recovery history." }, null, 2));
        } catch { return { status: "HUMAN_REQUIRED", reasons: ["Host confirmation was unavailable."] }; }
        if (!confirmed) return { status: "HUMAN_REQUIRED", reasons: ["The human did not authorize this exact lifecycle change."] };
      }
      const current = selectTargets(context, input, options);
      if (!current || current.sessionId !== selected.sessionId || current.targetDigest !== before) return { status: "EVIDENCE_REQUIRED", reasons: ["Native targets changed during preparation; prepare the new exact scope."] };
      const id = randomUUID();
      const redact = createRequire(import.meta.url)("./typesafe-api-client.cjs").redactEvidenceState as (state: unknown, options: { apiKey?: string }) => unknown;
      const report = JSON.stringify(redact({ schemaVersion: 1, id, operation, targets: targets.map(target => ({ incarnationId: target.incarnationId, target: target.target })), reason: input.reason, handoff, completionClaimed: false, debtReleased: false, dependencyClaim: "reported, not independently verified", humanConfirmed: needsHuman && (targets.length > 0 || operation === "block"), verifiedAutomaticDrop: verifiedDrop }, { apiKey: options.apiKey }), null, 2);
      const cwd = context && typeof context === "object" && "cwd" in context && typeof context.cwd === "string" ? context.cwd : undefined;
      if (!cwd) return { status: "EVIDENCE_REQUIRED", reasons: ["An actual host workspace is required for the durable public handoff."] };
      let exported: { path: string; sha256: string } | undefined;
      if (!verifiedDrop) {
        try { exported = writeRecoveryReport(cwd, { id, content: `# TypeSafe lifecycle recovery\n\n\`\`\`json\n${report}\n\`\`\`\n` }); }
        catch { return { status: "EVIDENCE_REQUIRED", reasons: ["The guarded public recovery report could not be persisted; do not park the native task without a usable handoff."] }; }
      }
      const reportDigest = exported?.sha256 ?? canonicalDigest(report);
      const reportStorage = exported ? "workspace-file" as const : "session-custom-entry" as const;
      options.appendEntry(LIFECYCLE_RECOVERY_ENTRY, { id, report, reportPath: exported?.path, reportDigest, reportStorage, sessionId: selected.sessionId, inputDigest: digest, targetDigest: before });
      const branch = readHostBranch(context);
      const entry = branch?.entries.findLast(candidate => candidate.type === "custom" && candidate.customType === LIFECYCLE_RECOVERY_ENTRY && candidate.data && typeof candidate.data === "object" && "id" in candidate.data && candidate.data.id === id);
      if (!entry || branch?.sessionId !== selected.sessionId) return { status: "EVIDENCE_REQUIRED", reasons: ["Persistent recovery report could not be authenticated in the actual host branch."] };
      const reportReference = `session://${encodeURIComponent(branch.sessionId)}/${encodeURIComponent(entry.id)}`;
      const expiresAt = Date.now() + GRANT_TTL_MS;
      grants.set(digest, { inputDigest: digest, targetDigest: before, sessionId: selected.sessionId, expiresAt, reportReference, verifiedDrop });
      return { status: "PREPARED", operation, expiresAt, report, reportReference, reportPath: exported?.path, reportDigest, reportStorage };
    },
    async consume(context, rawInput) {
      const normalized = normalizeNativeTodoInput(rawInput);
      if (!normalized.valid) return { allowed: false, reason: normalized.reason };
      const selected = selectTargets(context, normalized.input, options);
      if (!selected) return { allowed: false, reason: "native_lifecycle_history_required" };
      if (!selected.targets.length) return { allowed: true };
      const digest = nativeTodoInputDigest(normalized.input);
      const grant = grants.get(digest);
      grants.delete(digest);
      if (!grant || grant.expiresAt < Date.now() || grant.sessionId !== selected.sessionId || grant.targetDigest !== selected.targetDigest) {
        return { allowed: false, reason: "Prepare this exact lifecycle mutation with typesafe_prepare_todo_mutation first; preserve its recovery report." };
      }
      if (grant.verifiedDrop) {
        let valid = false;
        try { valid = await options.allowVerifiedDrop?.(context, normalized.input) === true; } catch { /* Stale or missing proof cannot authorize scope reduction. */ }
        const fresh = selectTargets(context, normalized.input, options);
        if (!valid || !fresh || fresh.sessionId !== selected.sessionId || fresh.targetDigest !== grant.targetDigest
          || fresh.targets.some(target => options.hasDebt(context, target))) {
          return { allowed: false, reason: "Automatic drop proof changed or debt appeared; collect relevant proof and prepare this exact operation again." };
        }
      }
      return { allowed: true, reportReference: grant.reportReference };
    },
    invalidate() { grants.clear(); },
  };
}
