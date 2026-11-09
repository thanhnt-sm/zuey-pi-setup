import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { canonicalDigest, freezeContractValue, isDigest, nonempty } from "./task-contract-source";
import { readHostBranch, type HostBranch } from "./host-history";
import { validateHostToolInvocation } from "./host-tool-invocation";
import type { VerificationHistory } from "./task-verification-history";
import type { TaskVerificationRuntimeOptions } from "./task-verification-types";
import type { HistoricalDebtCatalogue, HistoricalDebtResolutionFact, HistoricalDebtResolutionOutcome, HistoricalDebtResolutionProposal, HistoricalDebtResolver } from "./task-verification-debt-types";

interface StateRedactor { redactEvidenceState(value: unknown, options: { apiKey?: string; homeDirs?: readonly string[] }): unknown }
interface ConfirmationUI { confirm(title: string, message: string): Promise<boolean> }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function historicalResolutionId(fact: Omit<HistoricalDebtResolutionFact, "resolutionId">): string { return `historical-human:${canonicalDigest(fact)}`; }
export function validHistoricalResolution(branch: HostBranch, fact: HistoricalDebtResolutionFact): boolean {
  if (fact.contextKey !== `${branch.sessionId}|${branch.branchId}` || fact.decision !== "human_accept_historical_obligation_no_native_approval"
    || !nonempty(fact.nonce) || !nonempty(fact.incarnationId) || !nonempty(fact.reason) || !isDigest(fact.scopeDigest)
    || !Array.isArray(fact.debtIds) || !fact.debtIds.length || !fact.debtIds.every(nonempty) || !object(fact.invocation)
    || fact.invocation.toolName !== "typesafe_resolve_historical_debt" || !validateHostToolInvocation(branch, fact.invocation)) return false;
  const { resolutionId, ...body } = fact;
  return resolutionId === historicalResolutionId(body);
}
function realConfirmationUI(context: unknown): ConfirmationUI | undefined {
  if (!object(context) || context.hasUI !== true || !object(context.ui) || typeof context.ui.confirm !== "function") return undefined;
  const confirm = context.ui.confirm; const ui = context.ui;
  return { async confirm(title, message) { return await Reflect.apply(confirm, ui, [title, message]) === true; } };
}

/** Historical scope acceptance never changes Core, rewrites a raw verdict or grants future native permission. */
export function createHistoricalDebtResolver(options: TaskVerificationRuntimeOptions, history: VerificationHistory): HistoricalDebtResolver {
  async function scope(context: unknown, catalogue: HistoricalDebtCatalogue) {
    const reference = catalogue.incarnation.target;
    const evidence = options.evidence.get(context, { task: reference.content, phase: reference.phase });
    const current = evidence ? await options.evidence.isCurrent(context, evidence) : false;
    return freezeContractValue({ incarnation: catalogue.incarnation, lifecycle: catalogue.lifecycle, nativeProvenanceDigest: catalogue.nativeProvenanceDigest,
      debts: catalogue.debts.map(debt => ({ ...debt, originalJev: debt.rawJev ?? { status: "not_retained", note: "No authenticated original semantic measurement is available; no probability or implementation failure was invented." } })),
      contracts: catalogue.contracts.map(contract => {
        const source = options.contracts.sourceContext(contract);
        return { contract, originalUserRequest: source?.originalUserRequest, originalTaskSource: source?.taskSource,
          originalParentSource: source?.parentSource ? { path: source.parentSource.path, digest: source.parentSource.digest, criteria: source.parentSource.criteria } : undefined };
      }),
      currentEvidence: evidence ? { status: current ? "current_owned_evidence" : "cached_evidence_stale_or_unavailable", id: evidence.id,
        snapshot: evidence.reviewSnapshot, collectionStatus: evidence.status, reasons: evidence.reasons, sourceManifest: evidence.sourceManifest,
        testExitCode: evidence.evidence.testExitCode, counterevidence: evidence.evidence.counterevidence }
        : { status: "unavailable", reason: "No current factory-owned evidence exists for this historical incarnation; fulfillment is not established." },
      warning: "This accepts only the listed historical obligation/debt. It is NOT a JEV pass, source-binding approval, native completion, future stage, or forgiveness for another incarnation or later debt." });
  }
  return async function resolveHistoricalDebt(context: unknown, callId: string, proposal: HistoricalDebtResolutionProposal): Promise<HistoricalDebtResolutionOutcome> {
    try {
      const invocation = options.invocations.current(context, "typesafe_resolve_historical_debt", callId, proposal);
      const branch = readHostBranch(context);
      if (!invocation || !branch || !nonempty(proposal.incarnationId) || !nonempty(proposal.reason?.trim())) return { status: "EVIDENCE_REQUIRED", reasons: ["An actual registered historical-resolution invocation, exact incarnation and public reason are required. Model flags or pasted approval cannot substitute."] };
      const catalogue = history.historicalCatalogue(context, proposal.incarnationId);
      if (!catalogue || catalogue.lifecycle === "open" || catalogue.lifecycle === "unknown") return { status: "EVIDENCE_REQUIRED", reasons: ["Only an actual completed, abandoned or observed-removed historical incarnation may be reconciled. First use genuine native todo view if late outer failure left Core's lifecycle unobserved; never reinterpret a live open task as historical."] };
      if (!catalogue.debts.length) return { status: "EVIDENCE_REQUIRED", reasons: ["No unresolved actual debt exists for this exact historical incarnation; no broad forgiveness or approval was recorded."] };
      const ui = realConfirmationUI(context);
      if (!ui) return { status: "HUMAN_REQUIRED", reasons: ["Exact historical scope acceptance requires the real host's available UI confirmation outside native execution. No isHuman/approved/hasUI model argument is accepted."] };
      const redactor = createRequire(import.meta.url)("./typesafe-api-client.cjs") as StateRedactor;
      const publicReason = redactor.redactEvidenceState({ reason: proposal.reason.trim() }, { apiKey: options.privacy?.apiKey, homeDirs: options.privacy?.homeDirs });
      if (!object(publicReason) || !nonempty(publicReason.reason)) throw new Error("public_historical_reason_redaction_unavailable");
      const before = await scope(context, catalogue); const scopeDigest = canonicalDigest(before);
      const shown = redactor.redactEvidenceState({ historical_obligation: before, public_reason: publicReason.reason }, { apiKey: options.privacy?.apiKey, homeDirs: options.privacy?.homeDirs });
      if (!await ui.confirm("Accept exact historical obligation — NO native approval", JSON.stringify(shown, null, 2))) return { status: "HUMAN_REQUIRED", reasons: ["The real host confirmation did not accept this historical obligation. Every debt and original raw JEV remains unchanged."] };
      const actualInvocation = options.invocations.current(context, "typesafe_resolve_historical_debt", callId, proposal);
      const afterCatalogue = history.historicalCatalogue(context, proposal.incarnationId);
      if (!actualInvocation || actualInvocation !== invocation || !afterCatalogue || canonicalDigest(await scope(context, afterCatalogue)) !== scopeDigest) return { status: "EVIDENCE_REQUIRED", reasons: ["Historical branch/incarnation/debt/contract/current-evidence scope changed while confirmation was open. Obtain a fresh exact review; no resolution was recorded."] };
      const body: Omit<HistoricalDebtResolutionFact, "resolutionId"> = { schemaVersion: 1, kind: "historical_resolution", contextKey: `${branch.sessionId}|${branch.branchId}`,
        incarnationId: proposal.incarnationId, debtIds: catalogue.debts.map(debt => debt.debtId).sort(), scopeDigest,
        reason: publicReason.reason, nonce: randomUUID(), invocation, decision: "human_accept_historical_obligation_no_native_approval" };
      const fact: HistoricalDebtResolutionFact = { ...body, resolutionId: historicalResolutionId(body) };
      if (!history.recordHistoricalResolution(context, fact)) return { status: "EVIDENCE_REQUIRED", reasons: ["The exact human source fact could not be recorded on the active authentic branch. No native approval was produced."] };
      return { status: "HUMAN_RECONCILED_NO_NATIVE_APPROVAL", resolutionId: fact.resolutionId, incarnationId: proposal.incarnationId, debtIds: fact.debtIds };
    } catch (error) { return { status: "UNAVAILABLE", component: "historical_reconciliation", reasons: [error instanceof Error ? error.message : "Actual historical reconciliation prerequisite unavailable; no authority was produced."] }; }
  };
}
