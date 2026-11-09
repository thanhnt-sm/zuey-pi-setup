import { randomUUID } from "node:crypto";
import { canonicalDigest, contractDigest, freezeContractValue, nonempty } from "./task-contract-source";
import { readHostBranch, userRequestText, validateUserReference } from "./host-history";
import { createAdvisorRequest, type AdvisorRequest } from "./advisor-protocol";
import { prepareAdvisorPublicContext, prepareAdvisorConsultationContext } from "./advisor-public-context";
import { matchingReview } from "./task-verification-state";
import { planPhaseReviewDigest, samePlanPath, usablePlanPhaseReview, type ApprovedPlanPhaseSource } from "./task-verification-plan";
import type { AdvisorHostServices, AdvisorHostContext, AdvisorHostReview, AdvisorRequestDraft, AdvisorHostOutcome, AdvisorDispatchPreparation } from "./advisor-host";
import type { TaskReviewState, TaskVerificationRuntimeOptions, TaskVerificationTarget } from "./task-verification-types";
import type { ReviewBindingContext } from "./task-contract-review";
import type { TaskEvidenceRecord } from "./task-evidence-runtime";

export interface TaskAdvisorServicesOptions {
  runtime: TaskVerificationRuntimeOptions;
  states: ReadonlyMap<string, TaskReviewState>;
  isCurrent(context: unknown, state: TaskReviewState): Promise<boolean>;
}
export interface TaskAdvisorServiceRegistration {
  services: AdvisorHostServices;
  getCurrentPlanPhaseReview(context: unknown, planPath: string, phaseHeading?: string): Promise<AdvisorHostReview | undefined>;
}
interface DraftSource { draft: AdvisorRequestDraft; state?: TaskReviewState; record?: TaskEvidenceRecord; context: ReviewBindingContext; planPhase?: ApprovedPlanPhaseSource }
function unwrappedPrompt(prompt: string): string {
  try { const body: unknown = JSON.parse(prompt); if (body && typeof body === "object" && "reviewHandle" in body && nonempty(body.reviewHandle) && "publicReview" in body && typeof body.publicReview === "string") return body.publicReview; } catch { /* A normal public prompt is not a dispatch envelope. */ }
  return prompt;
}
function draftIdentity(draft: AdvisorRequestDraft | AdvisorRequest): string {
  return canonicalDigest({ binding: draft.binding, snapshot: draft.snapshot, criterionIds: draft.criterionIds, parentRequirementIds: draft.parentRequirementIds, evidenceRefs: draft.evidenceRefs,
    integrationEvidenceRefs: draft.integrationEvidenceRefs, scope: { ...draft.scope, publicContextDigest: "host-dispatch-wrapper" },
    publicPrompt: unwrappedPrompt(draft.publicPrompt), sessionEpoch: draft.sessionEpoch, parentAgentId: draft.parentAgentId, agent: draft.agent });
}
export function taskSelector(params: Record<string, unknown>): TaskVerificationTarget | undefined {
  const nested = params.context && typeof params.context === "object" && !Array.isArray(params.context) ? params.context as Record<string, unknown> : undefined;
  const task = params.task ?? nested?.task;
  const phase = params.phase ?? nested?.phase;
  return typeof task === "string" && task.trim() ? { task, ...(typeof phase === "string" && phase.trim() ? { phase } : {}) } : undefined;
}

function publicConsultationValues(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value]).map(item => {
    if (typeof item === "string") return item;
    const serialized = JSON.stringify(item);
    if (!serialized) throw new Error("Public consultation options/constraints must be serializable values.");
    return serialized;
  });
}

/** All source/draft capabilities originate here; onReceipt is only a provisional source cache. */
export function createTaskAdvisorServices(options: TaskAdvisorServicesOptions): TaskAdvisorServiceRegistration {
  const drafts = new Map<string, DraftSource>();
  const requests = new Map<string, { request: AdvisorRequest; source: DraftSource }>();
  const unavailable = (reason: string): AdvisorHostOutcome => ({ status: "EVIDENCE_REQUIRED", reasons: [reason] });
  const services: AdvisorHostServices = {
    async prepareReview(params, context, mode) {
      try {
      const branch = readHostBranch(context);
      if (!branch || !context.cwd || !context.agent.id || !context.advisorSessionEpoch) return unavailable("Actual supported parent session, public source and branch identity are required.");
      const selected = taskSelector(params);
      const pending = options.runtime.contracts.projection(context)?.nativePhases?.flatMap(phase => phase.tasks.filter(task => task.status === "in_progress").map(task => ({ task: task.content, phase: phase.name }))) ?? [];
      const target = selected ?? (pending.length === 1 ? pending[0] : undefined);
      const contract = target ? options.runtime.contracts.contractFor(context, target) : undefined;
      const sourceContext = contract ? options.runtime.contracts.sourceContext(contract) : undefined;
      const record = target ? options.runtime.evidence.get(context, target) : undefined;
      const state = target ? matchingReview(options.states, options.runtime, context, target) : undefined;
      const files = record?.authorizedSources.filter(file => record.snapshot.files.get(file.path) === file.sha256).map(file => ({ path: file.path, sha256: file.sha256 })) ?? [];
      const authorized = (path: string, sha256: string) => files.some(file => file.path === path && file.sha256 === sha256);
      let draft: AdvisorRequestDraft;
      let bindingContext: ReviewBindingContext;
      const planPhase = mode === "consultation" && params.decision === "plan-review" ? sourceContext?.parentSource : undefined;
      if (mode === "consultation" && params.decision === "plan-review" && !planPhase) return unavailable("An authenticated frozen approved plan-phase source with all original phase criteria is required; a caller's plan text or fake todo cannot replace it.");
      if (mode === "task") {
        if (!state || !contract || !sourceContext || !record || !record.packetSet.ok || !record.packetSet.manifest.coverageComplete || !await options.isCurrent(context, state)) return unavailable("Complete current task proof is required for task-bound review. First collect/bind actual evidence and run typesafe_review_task; use standalone typesafe_advisor consultation with this task selector to diagnose missing proof without pretending completion.");
        if (params.purpose !== undefined && params.purpose !== state.binding.purpose) return unavailable(`Use exact bound purpose ${state.binding.purpose}; caller purpose cannot remove parent requirements.`);
        if (params.purpose === undefined && state.binding.purpose !== "task_review") return unavailable("This task has actual parent integration obligations; explicitly prepare purpose parent_review with the same task selector.");
        const packet = record.packetSet.packets.find(value => value.packet.criteria.length === contract.criteria.length)?.packet;
        if (!packet) return unavailable("One complete-task M packet must be honestly curated before a task-bound review; standalone research consultation remains available.");
        const prepared = prepareAdvisorPublicContext(packet, { contract, evidenceManifest: record.packetSet.manifest,
          question: JSON.stringify({ question: "Independently assess CURRENT fulfillment of EVERY exact original task criterion and the full-source/global parent integration obligations. Cite actual evidence and counterevidence; missing or contradictory proof must remain uncovered or contradicted. Assess present fulfillment, not the attractiveness of a proposed plan. No other chamber's result, task count, source approval or caller's preferred answer establishes fulfillment.",
            originalPublicSource: sourceContext }),
          ...options.runtime.privacy, authorizedFiles: files, isAuthorizedSource: authorized });
        draft = { binding: state.binding, snapshot: state.snapshot,
          scope: { workspaceRoot: context.cwd, files: prepared.authorizedFiles, resources: [], publicContextDigest: prepared.publicContextDigest, egressPolicyDigest: options.runtime.policyDigest },
          publicPrompt: prepared.publicPrompt, criterionIds: prepared.criterionIds,
          parentRequirementIds: state.binding.purpose === "parent_review" ? state.binding.parentObligationIds : prepared.parentRequirementIds,
          evidenceRefs: prepared.evidenceRefs, integrationEvidenceRefs: prepared.integrationEvidenceRefs,
          sessionEpoch: context.advisorSessionEpoch, parentAgentId: context.agent.id, agent: params.role === "ck:advisor" ? "ck:advisor" : "advisor" };
        bindingContext = { sessionId: branch.sessionId, branchId: branch.branchId, purpose: state.binding.purpose, expectedProvenance: state.binding.provenance,
          authorizedScope: contract.allowedMutationScope, validateReference: reference => validateUserReference(branch, reference) || options.runtime.contracts.validators(context).validateReference?.(reference) === true,
          acceptsOriginBranch: (_origin, entryId) => branch.byId.has(entryId), contract,
          logicalOperationId: "logicalOperationId" in state.binding ? state.binding.logicalOperationId : undefined,
          ...(state.binding.purpose === "parent_review" ? { parentObligationIds: state.binding.parentObligationIds, childReceiptIds: state.binding.childReceiptIds, integrationReceiptIds: state.binding.integrationReceiptIds } : {}) };
      } else {
        const user = [...branch.entries].reverse().find(entry => userRequestText(entry));
        const userText = user && userRequestText(user);
        if (!user || !userText) return unavailable("A real public user request is required for a standalone consultation; no fake todo or ambient private history is accepted.");
        const publicQuestion = typeof params.question === "string" && params.question.trim() ? params.question : undefined;
        const question = planPhase ? JSON.stringify({
          trustedReviewPurpose: "Assess CURRENT FULL PHASE FULFILLMENT against EVERY frozen original phase criterion, not plan attractiveness or partial child success. Criterion status covered means actual current source/test evidence supports fulfillment; missing/contradictory proof must stay uncovered/contradicted. Proceed only when ALL original requirements are fulfilled. Status marks, task counts, source approval and child passes are not proof. Native mutation/human authority remain absent.",
        }) : publicQuestion ?? "Diagnose the exact task's missing evidence/rejection and provide a dependency-ordered repair/research plan.";
        const prepared = prepareAdvisorConsultationContext({ question,
          ...(!planPhase ? { options: publicConsultationValues(params.options),
            constraints: publicConsultationValues(params.constraints) } : {}) }, {
          ...options.runtime.privacy, workspaceRoot: context.cwd, authorizedFiles: files, isAuthorizedSource: authorized,
          ...(planPhase ? { criterionIds: planPhase.criteria.map(criterion => criterion.id) } : {}),
          publicResearchContext: { actualUserRequest: userText, ...(sourceContext ? { originalPublicSource: sourceContext } : {}),
            missingEvidence: record?.packetSet.reasons ?? ["No authentic cached task source manifest exists; guarded source reads require explicit evidence collection."],
            ...(!planPhase ? { currentOutcome: state?.outcome, currentRecovery: state?.recovery } : {}), sourceManifest: record?.sourceManifest,
            ...(planPhase ? { approvedPlanPhase: planPhase, originalPhaseCriteria: planPhase.criteria, nativeAuthority: "none", actualChildContract: contract } : {}) },
        });
        const provenance = { sessionId: branch.sessionId, branchId: branch.branchId, requestEntryId: user.id, dispatchId: `consultation:${randomUUID()}`,
          evidenceDigest: canonicalDigest({ publicPrompt: prepared.publicPrompt, files }), policyDigest: options.runtime.policyDigest, questionDigest: prepared.questionDigest };
        const binding = { purpose: "consultation" as const, request: { sessionId: branch.sessionId, entryId: user.id, digest: contractDigest(userText), kind: "user_request" as const }, provenance,
          authorizedScope: { paths: files.map(file => file.path), operations: ["read" as const] } };
        const empty = canonicalDigest(null);
        draft = { binding, snapshot: { contractDigest: planPhase ? planPhaseReviewDigest(planPhase) : contract ? canonicalDigest(contract) : empty, evidenceDigest: provenance.evidenceDigest,
          treeDigest: record?.snapshot.treeDigest ?? empty, testDigest: canonicalDigest(record?.verificationReceipt ?? null), policyDigest: options.runtime.policyDigest,
          parentDigest: canonicalDigest(sourceContext?.parentSource ?? null), childDigest: empty, integrationDigest: empty },
          scope: { workspaceRoot: context.cwd, files: prepared.authorizedFiles, resources: [], publicContextDigest: prepared.publicContextDigest, egressPolicyDigest: options.runtime.policyDigest },
          publicPrompt: prepared.publicPrompt, criterionIds: prepared.criterionIds, parentRequirementIds: [], evidenceRefs: prepared.evidenceRefs, integrationEvidenceRefs: [],
          sessionEpoch: context.advisorSessionEpoch, parentAgentId: context.agent.id, agent: params.role === "ck:advisor" ? "ck:advisor" : "advisor" };
        bindingContext = { sessionId: branch.sessionId, branchId: branch.branchId, purpose: "consultation", expectedProvenance: provenance, authorizedScope: binding.authorizedScope, validateReference: reference => validateUserReference(branch, reference) };
      }
      const owned = freezeContractValue(draft);
      drafts.set(draftIdentity(owned), { draft: owned, state: mode === "task" ? state : undefined, record, context: bindingContext, planPhase });
      return owned;
      } catch (error) {
        return unavailable(`Public source preparation prerequisite: ${error instanceof Error ? error.message : "authenticated source/context unavailable"}. Use an explicit source-bound consultation; no task-bound approval was produced.`);
      }
    },
    async createTaskRequest(_params, context, callId, preparation) { return finalize(context, callId, preparation, "task"); },
    async createConsultationRequest(_params, context, callId, preparation) { return finalize(context, callId, preparation, "consultation"); },
    onReceipt(receipt) {
      const state = requests.get(receipt.requestId)?.source.state;
      if (state) state.provisionalReceiptId = receipt.receiptId;
      // This is only source availability; final native history/outer result may still reject it.
    },
    async isCurrent(request, context) {
      if (request.binding.purpose === "shadow") return false;
      const source = drafts.get(draftIdentity(request));
      const branch = readHostBranch(context);
      if (!source || !branch || request.sessionEpoch !== context.advisorSessionEpoch || request.parentAgentId !== context.agent.id ||
        request.binding.provenance.sessionId !== branch.sessionId || request.binding.provenance.branchId !== branch.branchId ||
        request.scope.publicContextDigest !== canonicalDigest([{ role: "user", content: request.publicPrompt }])) return false;
      if ("requestId" in request && requests.get(request.requestId)?.request !== request) return false;
      if (source.state) return options.states.get(source.state.key) === source.state && await options.isCurrent(context, source.state);
      if (request.binding.purpose !== "consultation" || !validateUserReference(branch, request.binding.request)) return false;
      return !source.record || await options.runtime.evidence.isCurrent(context, source.record);
    },
  };
  async function finalize(context: AdvisorHostContext, actualCallId: string, preparation: AdvisorDispatchPreparation, mode: "task" | "consultation"): Promise<AdvisorRequest | AdvisorHostOutcome> {
    const draft = preparation.draft; const source = drafts.get(draftIdentity(draft));
    if (!source || preparation.mode !== mode || !await services.isCurrent(draft, context) || !nonempty(actualCallId)) return unavailable("Actual native dispatch preparation and current factory-owned source are required.");
    if (draft.publicPrompt !== JSON.stringify({ reviewHandle: preparation.token, publicReview: source.draft.publicPrompt })) return unavailable("The actual server-owned native dispatch token and exact derived public prompt are required.");
    const request = createAdvisorRequest({ ...draft, parentToolCallId: actualCallId, itemIndex: preparation.itemIndex }, source.context);
    requests.set(request.requestId, { request, source });
    if (source.state) source.state.request = request;
    return request;
  }
  return {
    services,
    async getCurrentPlanPhaseReview(context, planPath, phaseHeading) {
      const matches = new Map<string, AdvisorHostReview>();
      for (const review of await options.runtime.getAdvisorReviews(context)) {
        const source = requests.get(review.request.requestId)?.source;
        if (!source?.planPhase || !source.record || requests.get(review.request.requestId)?.request !== review.request) continue;
        const current = options.runtime.contracts.sourceContext(source.record.contract);
        const cwd = source.record.provenance.cwd;
        if (!current?.parentSource || canonicalDigest(current.parentSource) !== canonicalDigest(source.planPhase) ||
          !samePlanPath(cwd, source.planPhase.path, planPath) || (phaseHeading !== undefined && source.planPhase.phaseHeading !== phaseHeading)) continue;
        // The actual settled registry already called this service's current-source validator.
        if (usablePlanPhaseReview(review, source.planPhase)) matches.set(planPhaseReviewDigest(source.planPhase), review);
      }
      return matches.size === 1 ? [...matches.values()][0] : undefined;
    },
  };
}
