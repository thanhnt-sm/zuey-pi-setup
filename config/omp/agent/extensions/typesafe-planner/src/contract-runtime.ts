import path from "node:path";
import { contractHostHistoryDigest, projectHostHistory, readHostBranch, type HostBranch, type HostContractValidators } from "./host-history";
import { canonicalDigest, contractDigest, freezeContractValue, isDigest, nativeTaskSourceUri, parseContractCriteria } from "./task-contract-source";
import { CONTRACT_HISTORY_CUSTOM_TYPE, createContractHistoryRecord, createTaskContract, reviseTaskContract, type ContractAuthority, type CreateTaskContractInput } from "./task-contract";
import { readContractRuntimeJournal, type ContractRuntimeJournal } from "./task-contract-runtime-journal";
import { activeContractBindingCall, currentNativeContractTarget, originalHostTaskRequest } from "./task-contract-runtime-provenance";
import { approvedContractScope, parentSourceCriteriaIdentity, resolveParentSource, trustedNativeTaskKind } from "./task-contract-runtime-sources";
import { captureCookInput } from "./task-contract-cook-input";
import {
  CONTRACT_BIND_TOOL_NAME, CONTRACT_CONFIRMATION_CUSTOM_TYPE, CONTRACT_SOURCE_CUSTOM_TYPE, type ContractBindingOutcome, type ContractBindingProposal,
  type ContractConfirmationJournalRecord, type ContractRuntime, type ContractRuntimeOptions, type ContractSourceAuthorization,
  type ContractSourceJournalRecord, type FrozenContractSourceContext,
} from "./task-contract-runtime-types";
import type { ContractHistoryProjection } from "./task-contract-history";
import type { TaskContract } from "./types/verification";

export type * from "./task-contract-runtime-types";
interface RuntimeHostState { branch: HostBranch; cwd: string; journal: ContractRuntimeJournal; projection: ContractHistoryProjection }
interface HostConfirmationUI { confirm(title: string, message: string): Promise<boolean> }
const unavailableValidators: HostContractValidators = {
  validateContract: () => false, validateReference: () => false, validateSourceSpan: () => false, validateAmendment: () => false,
};

export function createContractRuntime(options: ContractRuntimeOptions): ContractRuntime {
  if (typeof options.appendEntry !== "function" || !isDigest(options.policyDigest) || !Array.isArray(options.approvedCommandIds)
    || !options.approvedCommandIds.every((id) => typeof id === "string" && id.trim())
    || new Set(options.approvedCommandIds).size !== options.approvedCommandIds.length
    || typeof options.invocations?.run !== "function" || typeof options.invocations.current !== "function") throw new Error("contract_runtime_configuration_invalid");
  const commandIds = Object.freeze([...options.approvedCommandIds]);
  const policyDigest = options.policyDigest;
  const appendEntry = options.appendEntry;
  const invocations = options.invocations;
  const contexts = new Map<string, { digest: string; context: FrozenContractSourceContext }>();
  const inFlight = new Set<string>();
  let cached: { key: string; value: RuntimeHostState } | undefined;
  const state = (ctx: unknown): RuntimeHostState | undefined => {
    if (!ctx || typeof ctx !== "object" || !("cwd" in ctx) || typeof ctx.cwd !== "string" || !path.isAbsolute(ctx.cwd)) { contexts.clear(); cached = undefined; return undefined; }
    const branch = readHostBranch(ctx);
    if (!branch) { contexts.clear(); cached = undefined; return undefined; }
    try {
      // Detect changed public/native/journal payloads too, not merely a moving leaf or record count.
      const key = canonicalDigest([ctx.cwd, contractHostHistoryDigest(branch)]);
      if (cached?.key === key) return cached.value;
      const journal = readContractRuntimeJournal(branch, ctx.cwd);
      const projection = projectHostHistory(branch, ctx.cwd, journal.validators);
      contexts.clear();
      for (const contract of projection.contractRevisions) {
        const context = journal.contextFor(contract);
        if (context) contexts.set(contract.revisionId, { digest: canonicalDigest(contract), context });
      }
      const value = { branch, cwd: ctx.cwd, journal, projection };
      cached = { key, value };
      return value;
    } catch { contexts.clear(); cached = undefined; return undefined; }
  };
  const append = (ctx: unknown, before: HostBranch, customType: string, data: unknown): { branch: HostBranch; entryId: string } | undefined => {
    const frozen = freezeContractValue(structuredClone(data));
    appendEntry(customType, frozen);
    const branch = readHostBranch(ctx);
    if (!branch || branch.sessionId !== before.sessionId || branch.branchId !== before.branchId) return undefined;
    const digest = canonicalDigest(frozen);
    const matches = branch.entries.filter((entry) => !before.byId.has(entry.id) && entry.type === "custom"
      && entry.customType === customType && canonicalDigest(entry.data) === digest);
    return matches.length === 1 ? { branch, entryId: matches[0].id } : undefined;
  };
  const bind = async (ctx: unknown, toolCallId: string, proposal: ContractBindingProposal): Promise<ContractBindingOutcome> => {
    let host = state(ctx);
    if (!host) return { status: "UNAVAILABLE", reasons: ["Actual host getBranch/getSessionId and workspace context are required."] };
    const invocation = invocations.current(ctx, CONTRACT_BIND_TOOL_NAME, toolCallId, proposal);
    if (!invocation) return { status: "UNAVAILABLE", reasons: ["The actual registered execute callback and its shared host invocation observation are required."] };
    const call = activeContractBindingCall(host.branch, toolCallId, proposal, invocation);
    if (!call) return { status: "REJECTED", reasons: ["A unique current actual typesafe_bind_task invocation with these exact parameters is required."] };
    const native = currentNativeContractTarget(host.projection, call.proposal);
    if (!native) return { status: "EVIDENCE_REQUIRED", reasons: ["Resolve one exact native target with genuine matched creation provenance; observed or ambiguous text is not creation authority."] };
    const lock = `${host.branch.sessionId}:${native.incarnationId}`;
    if (inFlight.has(lock)) return { status: "EVIDENCE_REQUIRED", reasons: ["Another binding of this native incarnation is still in progress."] };
    inFlight.add(lock);
    try {
      const existing = host.projection.contracts.filter((contract) => contract.incarnationId === native.incarnationId);
      if (existing.length > 1) return { status: "REJECTED", reasons: ["The native incarnation has ambiguous existing contracts."] };
      const previous = existing[0];
      const previousContext = previous && host.journal.contextFor(previous);
      const previousFact = previous && host.journal.sourceFor(previous);
      if (previous && (!previousContext || !previousFact || proposal.originalUserEntryId !== undefined && proposal.originalUserEntryId !== previous.originalUserRequest.entryId)) {
        return { status: "HUMAN_REQUIRED", reasons: ["An existing original user obligation cannot be rebound or replaced by model proposal."] };
      }
      const original = originalHostTaskRequest(host.branch, native, previous?.originalUserRequest.entryId ?? call.proposal.originalUserEntryId);
      if (!original) return { status: "EVIDENCE_REQUIRED", reasons: ["A genuine earlier meaningful role:user request is required; Continue/Retry, skill boilerplate and automated notices cannot replace it."] };
      const resolved = resolveParentSource(host.branch, host.cwd, call.proposal, call.entryId);
      if (call.proposal.planPath !== undefined && !resolved) return { status: "EVIDENCE_REQUIRED", reasons: ["The explicit workspace plan and exact phase criteria must resolve; an unavailable proposal cannot fall back to a different source."] };
      let parent = resolved?.parent ?? previousContext?.parentSource;
      if (parent && previousContext?.parentSource && parentSourceCriteriaIdentity(parent) === parentSourceCriteriaIdentity(previousContext.parentSource)) parent = previousContext.parentSource;
      const kind = previous?.taskKind ?? trustedNativeTaskKind(native.target.content, original.text);
      let authorization: ContractSourceAuthorization = { kind: "readonly" };
      if (previousContext && canonicalDigest({ parent }) === canonicalDigest({ parent: previousContext.parentSource })) authorization = previousContext.authorization;
      const priorObservation = previousContext?.observedCookInput;
      const observedCookInput = host.journal.observations.find((observation) => observation.userRequest.entryId === resolved?.observedCookRequest?.entryId
        && observation.documents.some((document) => document.path === parent?.path))
        ?? (priorObservation?.documents.some((document) => document.path === parent?.path) ? priorObservation : undefined);
      const observedDocument = observedCookInput?.documents.find((document) => document.path === parent?.path);
      const changedParent = previousContext?.parentSource !== undefined
        && parentSourceCriteriaIdentity(parent) !== parentSourceCriteriaIdentity(previousContext.parentSource);
      const ui = ctx && typeof ctx === "object" && "hasUI" in ctx && ctx.hasUI === true && "ui" in ctx && ctx.ui && typeof ctx.ui === "object"
        && "confirm" in ctx.ui && typeof ctx.ui.confirm === "function" ? ctx.ui as HostConfirmationUI : undefined;
      const executionApproved = authorization.kind === "host_confirmation" && authorization.execution;
      const isExplicitReadOnly = /\b(?:without changing implementation|implementation has not been approved|review source only|chỉ xem|không sửa mã)\b/i.test(original.text)
        || /^(?:research|review|investigate|inspect|analy[sz]e|nghiên cứu|rà soát|đánh giá)\s*(?:the\s+)?current\s+source\b/i.test(original.text);
      const autonomousExecution = !ui && !call.proposal.planPath && (kind === "implementation" || kind === "operations") && !isExplicitReadOnly;
      const askExecution = call.proposal.planPath !== undefined || autonomousExecution || (!previous && !parent && !!ui && (kind === "implementation" || kind === "operations"));
      const permissions = approvedContractScope(kind, parent, executionApproved || askExecution, commandIds);
      const requiresUI = !autonomousExecution && (original.requiresConfirmation && !previous || changedParent
        || call.proposal.planPath !== undefined && !executionApproved
        || previous && previous.policyDigest !== policyDigest && authorization.kind === "readonly"
        || !previous && !parent && authorization.kind === "readonly" && askExecution
        || previous && authorization.kind === "host_confirmation" && (previous.policyDigest !== policyDigest
          || canonicalDigest(previous.allowedMutationScope) !== canonicalDigest(permissions.scope)
          || canonicalDigest(previous.approvedCommandIds) !== canonicalDigest(permissions.commandIds)
          || canonicalDigest({ parent }) !== canonicalDigest({ parent: previousContext?.parentSource })));
      if (requiresUI || (autonomousExecution && !executionApproved)) {
        if (requiresUI) {
          if (!ui) return { status: "HUMAN_REQUIRED", reasons: ["Exact material source/scope requires actual host UI confirmation; observed cook text is not raw-input or byte approval."] };
        }
        const confirmation: ContractConfirmationJournalRecord = {
          schemaVersion: 1, sessionId: host.branch.sessionId, branchId: host.branch.branchId, toolCallId, callEntryId: call.entryId,
          invocation: call.invocation,
          originalUserRequest: original.reference, taskDigest: contractDigest(native.target.content), parentDigest: parent?.digest,
          nativeBinding: { creation: native.creation, target: native.target }, parentContextDigest: canonicalDigest({ parent }),
          inputObservation: observedCookInput?.reference,
          previousRevisionId: previous?.revisionId, previousParentDigest: previousContext?.parentSource?.digest,
          taskKind: kind, execution: true, allowedMutationScope: permissions.scope,
          approvedCommandIds: permissions.commandIds, policyDigest,
          decision: "confirmed_source_scope",
        };
        const question = [`Task: ${native.target.phase}/${native.target.content}`, `Native incarnation: ${native.incarnationId}`,
          `Original user ${original.reference.entryId}: ${original.text}`, `Frozen task kind: ${kind}`,
          `Source: ${parent ? `${parent.path} (${parent.digest}), heading ${parent.phaseHeading}` : nativeTaskSourceUri(native.creation, native.target)}`,
          parent?.master ? `Parent master context: ${parent.master.path} (${parent.master.digest})` : "",
          observedCookInput ? `Earlier observed input source (not permission): ${observedCookInput.reference.entryId}; ${observedCookInput.documents.map((document) => `${document.path} (${document.digest})`).join(", ")}` : "",
          observedDocument ? `Earlier observed selected source bytes:\n${observedDocument.text}` : "",
          `Allowed workspace paths: ${permissions.scope.paths.join(", ")}`, `Operations: ${permissions.scope.operations.join(", ")}`,
          `Approved command IDs: ${permissions.commandIds.join(", ") || "none"}`,
          parent ? `Full parent criteria (context, not this child's acceptance):\n${parent.criteria.map((criterion) => criterion.text).join("\n")}` : "",
          changedParent ? `Previously accepted parent criteria:\n${previousContext?.parentSource?.criteria.map((criterion) => criterion.text).join("\n")}` : "",
          "Confirm this task's exact source/scope only, not whole-plan authority. No parent obligations are waived. This does not approve completion, native mutation, deployment, credentials, or global changes."].filter(Boolean).join("\n\n");
        if (requiresUI && await ui!.confirm("Bind exact task source and permissions?", question) !== true) return { status: "HUMAN_REQUIRED", reasons: ["Source/scope confirmation was not granted."] };
        const refreshed = state(ctx);
        const refreshedInvocation = invocations.current(ctx, CONTRACT_BIND_TOOL_NAME, toolCallId, proposal);
        if (!refreshed || !refreshedInvocation || refreshedInvocation.nonce !== call.invocation.nonce
          || !activeContractBindingCall(refreshed.branch, toolCallId, proposal, refreshedInvocation)
          || currentNativeContractTarget(refreshed.projection, proposal)?.incarnationId !== native.incarnationId) {
          return { status: "EVIDENCE_REQUIRED", reasons: ["Host branch/target changed during confirmation; no approval was staged."] };
        }
        const persisted = append(ctx, refreshed.branch, CONTRACT_CONFIRMATION_CUSTOM_TYPE, confirmation);
        if (!persisted) return { status: "UNAVAILABLE", reasons: ["Host confirmation did not appear as one genuine appended entry."] };
        authorization = { kind: "host_confirmation", execution: true,
          reference: { kind: "host_confirmation", sessionId: persisted.branch.sessionId, entryId: persisted.entryId, digest: canonicalDigest(confirmation) }, sourcePath: parent?.path };
        host = state(ctx);
        if (!host) return { status: "UNAVAILABLE", reasons: ["Host context became unavailable after source confirmation."] };
      }
      if ((kind === "implementation" || kind === "operations") && (authorization.kind === "readonly"
        || authorization.kind === "host_confirmation" && !authorization.execution)) {
        return { status: "HUMAN_REQUIRED", reasons: ["The native goal is not source-execution permission. Actual UI execution approval is required; an earlier cook path or input source flag is insufficient."] };
      }
      if (previous && previousContext && previous.policyDigest === policyDigest
        && canonicalDigest(previous.allowedMutationScope) === canonicalDigest(permissions.scope)
        && canonicalDigest(previous.approvedCommandIds) === canonicalDigest(permissions.commandIds)
        && canonicalDigest({ parent: previousContext.parentSource }) === canonicalDigest({ parent })) return { status: "BOUND", contract: previous, sourceContext: previousContext };
      if (previous && authorization.kind === "readonly") return { status: "HUMAN_REQUIRED", reasons: ["An authenticated source/scope amendment is required to revise the existing contract."] };
      const taskPath = nativeTaskSourceUri(native.creation, native.target);
      const taskSource = { kind: "native_task" as const, path: taskPath, text: native.target.content, digest: contractDigest(native.target.content),
        nativeBinding: { creation: native.creation, target: native.target } };
      const source: ContractSourceJournalRecord = {
        schemaVersion: 1, sessionId: host.branch.sessionId, branchId: host.branch.branchId, toolCallId, callEntryId: call.entryId,
        invocation: call.invocation, invocationInput: call.invocationInput,
        revision: previous ? previous.revision + 1 : 1, previousRevisionId: previous?.revisionId,
        amendment: previous && authorization.kind === "host_confirmation" ? { ...authorization.reference, kind: "host_confirmation" } : undefined,
        proposal: call.proposal, originalUserRequest: { reference: original.reference, text: original.text },
        taskSource: { ...taskSource, spans: parseContractCriteria(taskSource).map((criterion) => criterion.source) }, parentSource: parent,
        inputObservation: observedCookInput?.reference,
        taskKind: kind, readScope: ["**"], allowedMutationScope: permissions.scope, approvedCommandIds: permissions.commandIds,
        policyDigest, authorization,
      };
      const persisted = append(ctx, host.branch, CONTRACT_SOURCE_CUSTOM_TYPE, source);
      const current = state(ctx);
      const fact = persisted && current?.journal.facts.find((candidate) => candidate.entryId === persisted.entryId);
      if (!current || !fact || currentNativeContractTarget(current.projection, proposal)?.incarnationId !== native.incarnationId) {
        return { status: "EVIDENCE_REQUIRED", reasons: ["The appended source fact or current native incarnation did not validate."] };
      }
      const sourceInput = { ...taskSource, approval: authorization.kind === "host_confirmation" ? authorization.reference : original.reference };
      const approved = { source: sourceInput, originalUserRequest: original.reference, creation: native.creation, target: native.target,
        taskKind: kind, allowedMutationScope: permissions.scope, approvedCommandIds: permissions.commandIds, parentRequirements: [], policyDigest };
      const authority: ContractAuthority = {
        validateReference: current.journal.validators.validateReference,
        validateCreation: (creation, target) => canonicalDigest(creation) === canonicalDigest(native.creation) && canonicalDigest(target) === canonicalDigest(native.target)
          && current.projection.incarnations.some((candidate) => candidate.creationKnown && candidate.incarnationId === native.incarnationId),
        validateProposal: (input: CreateTaskContractInput) => {
          const { authority: _authority, ...candidate } = input;
          return canonicalDigest(candidate) === canonicalDigest(approved);
        },
      };
      let contract: TaskContract;
      if (previous) {
        const amendment = source.amendment;
        if (!amendment) return { status: "HUMAN_REQUIRED", reasons: ["A genuine scope amendment reference is required."] };
        contract = reviseTaskContract(previous, { source: sourceInput, amendment, authority,
          allowedMutationScope: permissions.scope, approvedCommandIds: permissions.commandIds, policyDigest,
          validateAmendment: (old, input) => current.journal.validators.validateContract(old) && old.revisionId === source.previousRevisionId
            && canonicalDigest(input.amendment) === canonicalDigest(amendment) });
      } else contract = createTaskContract({ ...approved, authority });
      const record = createContractHistoryRecord(current.branch, `bind:${toolCallId}:${contract.revision}`, fact.entryId, { kind: "contract", contract });
      if (!append(ctx, current.branch, CONTRACT_HISTORY_CUSTOM_TYPE, record)) return { status: "UNAVAILABLE", reasons: ["Canonical contract was not persisted by the actual host."] };
      const committed = state(ctx);
      const bound = committed?.projection.contracts.find((candidate) => candidate.revisionId === contract.revisionId);
      const sourceContext = bound && committed?.journal.contextFor(bound);
      return bound && sourceContext ? { status: "BOUND", contract: bound, sourceContext }
        : { status: "EVIDENCE_REQUIRED", reasons: ["Persisted contract did not survive authentic host-history projection."] };
    } catch (error) {
      return { status: "UNAVAILABLE", reasons: [error instanceof Error ? error.message : "Host source binding is unavailable."] };
    } finally { inFlight.delete(lock); }
  };
  return {
    bind, projection: (ctx) => state(ctx)?.projection,
    captureCookInput: (ctx, event) => captureCookInput(ctx, event, appendEntry),
    validators: (ctx) => state(ctx)?.journal.validators ?? unavailableValidators,
    contractFor: (ctx, selector) => {
      const current = state(ctx);
      if (!current) return undefined;
      const native = currentNativeContractTarget(current.projection, selector);
      const contracts = current.projection.contracts.filter((contract) => contract.incarnationId === native?.incarnationId && contract.policyDigest === policyDigest
        && contract.approvedCommandIds.every((id) => commandIds.includes(id)));
      return contracts.length === 1 ? contracts[0] : undefined;
    },
    sourceContext: (contract) => {
      const known = contexts.get(contract.revisionId);
      return known?.digest === canonicalDigest(contract) ? known.context : undefined;
    },
  };
}
