import { collectTaskEvidence, touchesClaudeBoundary, type TaskEvidenceResult, type TaskEvidenceOptions } from "./evidence-collector";
import { analyzeDiffForTestEvasion } from "./ast-analyzer";
import { generateRemediationBlock } from "./remediation-generator";
import { createSemanticJudgeClient, noulValue, choiceValue, type SemanticResponse, type SemanticTransportMetadata } from "./semantic-judge-client";
import type { TaskContract, VerificationOutcome } from "./types/verification";
import { DEFAULT_SEMANTIC_APPROVAL_OPTIONS, passesSemanticApproval, type SemanticApprovalOptions } from "./semantic-approval-policy";
import { semanticFailureDisposition } from "./semantic-failure";

export interface Gate1Result {
  passed: boolean;
  reasons: string[];
  cleanTree: boolean;
  testPassed: boolean;
  claudeSafe: boolean;
  testEvasion?: boolean;
  outcome?: VerificationOutcome;
}
export interface Gate2Result {
  passed: boolean;
  reasons: string[];
  deliverablesVerdict?: "APPROVE" | "REJECT" | "NEXT_ACTION_REQUIRED";
  meetsCriteriaNoul?: number;
  planDriftChoice?: "no_drift" | "unapproved_deviation" | "scope_creep";
  claudeUntouchedNoul?: number;
  escalateToUser?: boolean;
  outcome?: VerificationOutcome;
  metadata?: SemanticTransportMetadata;
}
export interface DualGateVerificationResult {
  approved: boolean;
  gate1: Gate1Result;
  gate2?: Gate2Result;
  reasons: string[];
  remediation?: string;
  escalateToUser?: boolean;
  disposition?: VerificationOutcome;
}
export interface GateQuestion {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria?: string[] | Record<string, string>;
}
export interface GateJudgeResponse extends SemanticResponse {}
export interface GateJudgeClient {
  evaluateGate(params: { state: string; questions: Record<string, GateQuestion> }): Promise<GateJudgeResponse>;
}
export interface TaskVerificationContext extends Pick<TaskEvidenceOptions, "baseline" | "afterSnapshot" | "verificationReceipt" | "authorizedMutationReceipts" | "signal"> {
  cwd?: string;
  taskId: string;
  planPath?: string;
  testCommand?: string;
  timeoutMs?: number;
  untrustedAgentClaim?: string;
  taskDoneProven?: boolean;
  todoCompleted?: boolean;
  contract?: TaskContract;
}


export function checkDeterministicPreconditions(evidence: TaskEvidenceResult): Gate1Result {
  const reasons: string[] = [];
  const claudeSafe = !touchesClaudeBoundary(evidence.gitStatus, evidence.gitDiff, evidence.changedFiles);
  if (!claudeSafe) reasons.push("Claude boundary violation: task modified files under .claude or Claude configuration.");
  const testPassed = evidence.testExitCode === null || evidence.testExitCode === 0;
  if (!testPassed) reasons.push(`Test suite failed with exit code ${evidence.testExitCode}. Resolve the failing applicable verification before completion.`);
  const astResult = analyzeDiffForTestEvasion(evidence.gitDiff);
  if (!astResult.isSafe) reasons.push(...astResult.issues);
  if (evidence.taskDoneProven === false || evidence.todoCompleted === false) {
    reasons.push("Task completion precondition failed: actual task and todo completion evidence is required.");
  }
  let outcome: VerificationOutcome | undefined = reasons.length
    ? { status: "REJECTED", criterionIds: [], reasons: [...reasons] } : undefined;
  const omissions = evidence.omissions?.filter(item => item.required) ?? [];
  if (evidence.evidenceStatus === "EVIDENCE_REQUIRED" || omissions.length) {
    const missing = omissions.map(item => `Evidence prerequisite: ${item.reason}${item.path ? ` (${item.path})` : ""}.`);
    if (!missing.length) missing.push("Required task-bound evidence is incomplete.");
    reasons.push(...missing);
    if (!outcome) outcome = { status: "EVIDENCE_REQUIRED", missingCriterionIds: evidence.contract?.criteria.map(c => c.id) ?? [], reasons: missing };
  }
  return {
    passed: reasons.length === 0, reasons, cleanTree: evidence.cleanWorkingTree,
    testPassed, claudeSafe, testEvasion: astResult.testEvasion, outcome,
  };
}

export function constructGateQuestions(criteria: string[], taskKind?: TaskContract["taskKind"]): Record<string, GateQuestion> {
  const joined = criteria.join("; ") || "Concrete evidence satisfies this task's actual deliverables";
  const applicability = taskKind === "research" || taskKind === "review"
    ? "Investigation/review/report work requires concrete findings and task-bound artifacts, not unrelated implementation or automated tests."
    : "Judge task-relevant deliverables and applicable verification commands, not unrelated missing implementation.";
  return {
    deliverables_verdict: {
      type: "choice", instructions: `Assess the current task against its exact criteria. ${applicability}`,
      criteria: { APPROVE: `Satisfies criteria: ${joined}`, REJECT: "Evidence violates an actual task criterion", NEXT_ACTION_REQUIRED: "A named criterion or evidence prerequisite needs action" },
    },
    meets_criteria: {
      type: "noul", instructions: `Rate the probability that the task-bound evidence satisfies its exact criteria. ${applicability}`,
      criteria: { true: `Satisfies criteria: ${joined}`, false: "An actual criterion is incomplete or unsupported" },
    },
    plan_drift: {
      type: "choice", instructions: "Assess drift relative to the current task's authorized scope, not unstarted future tasks.",
      criteria: { no_drift: "Strict task scope adherence", unapproved_deviation: "Unapproved architectural deviation", scope_creep: "Unrelated extra scope" },
    },
    claude_account_untouched: {
      type: "noul", instructions: "Confirm no .claude configuration or Anthropic credential modification. Defensive isolation guard symbol names are not violations.",
      criteria: { true: "No configuration or credential modifications", false: "Configuration or credentials modified" },
    },
  };
}

export interface RemediationOptions {
  taskId?: string;
  criteria?: string[];
  testCommand?: string;
  testEvasion?: boolean;
  outcome?: VerificationOutcome;
}
export function generateFallbackRemediation(reasons: string[], options?: RemediationOptions): string {
  const infrastructure = options?.outcome?.status === "UNAVAILABLE";
  const human = options?.outcome?.status === "HUMAN_REQUIRED";
  return generateRemediationBlock({
    instruction: infrastructure
      ? "Verification is unavailable, not semantically rejected. Restore the service prerequisite; do not edit code to simulate progress."
      : human ? "Obtain an exact host-validated resolution and fresh task review binding."
      : "Resolve the named violated criteria or evidence prerequisites while preserving the full task scope and immutable constraints.",
    immutableConstraints: [
      "Do not delete, comment out, or weaken tests/assertions to evade verification.",
      "Do not modify .claude configuration or credentials.",
      "Preserve all deliverables; source edits are required only for actual violated implementation criteria.",
      "Unchanged semantic rejection cannot be retried. Same-evidence service retry requires a real availability change.",
    ],
    failureReasons: reasons,
    actionItems: infrastructure
      ? ["Service owner: restore the named service or credential prerequisite and record a successful availability observation; parent then requests one fresh review."]
      : human ? ["Parent: request exact-target trusted human resolution; bind any validated amendment to a fresh review before native staging."]
      : [
        "Advisor: diagnose the exact criterion or missing evidence prerequisite and specify the smallest task-relevant correction.",
        "Scoped executor: apply the diagnosed correction or collect missing evidence, without unrelated implementation.",
        `Parent: run affected task-applicable verification${options?.testCommand ? ` (${options.testCommand})` : ""} and collect fresh task-bound evidence.`,
        "Independent reviewer: review the fresh evidence; parent reevaluates the same bound target only after relevant progress.",
      ],
    taskId: options?.taskId, criteria: options?.criteria, outcome: options?.outcome,
    testEvasion: infrastructure || human ? false : options?.testEvasion,
  });
}

const defaultGateClient = createSemanticJudgeClient({ purpose: "native_done" });

/** Standalone semantic assessment, not native completion authority or a debt release. */
export async function verifyTaskCompletion(context: TaskVerificationContext, judgeClient?: GateJudgeClient, options: SemanticApprovalOptions = DEFAULT_SEMANTIC_APPROVAL_OPTIONS): Promise<DualGateVerificationResult> {
  const evidence = await collectTaskEvidence({
    cwd: context.cwd, taskId: context.taskId, planPath: context.planPath,
    testCommand: context.testCommand, timeoutMs: context.timeoutMs,
    untrustedAgentState: context.untrustedAgentClaim,
    taskDoneProven: context.taskDoneProven, todoCompleted: context.todoCompleted,
    contract: context.contract, baseline: context.baseline, afterSnapshot: context.afterSnapshot,
    verificationReceipt: context.verificationReceipt, authorizedMutationReceipts: context.authorizedMutationReceipts, signal: context.signal,
  });
  const gate1 = checkDeterministicPreconditions(evidence);
  const criteria = context.contract?.criteria.map((c) => `${c.id}: ${c.text}`) ?? evidence.criteria;
  if (!gate1.passed) {
    const disposition: VerificationOutcome = gate1.outcome ?? { status: "REJECTED", criterionIds: [], reasons: gate1.reasons };
    return { approved: false, gate1, reasons: gate1.reasons, disposition, escalateToUser: false,
      remediation: generateFallbackRemediation(gate1.reasons, { taskId: context.taskId, criteria, testCommand: context.testCommand, testEvasion: gate1.testEvasion, outcome: disposition }) };
  }
  const questions = constructGateQuestions(criteria, context.contract?.taskKind);
  const criterionQuestions = context.contract?.criteria.map((criterion, index) => ({ criterion, key: `criterion_${index}` })) ?? [];
  for (const { criterion, key } of criterionQuestions) {
    questions[key] = { type: "choice", instructions: `Assess exact criterion ${criterion.id}: ${criterion.text}. Distinguish contradiction from an absent evidence prerequisite.`,
      criteria: { satisfied: "Task-bound evidence satisfies criterion", violated: "Evidence contradicts this exact criterion", evidence_missing: "Required criterion evidence is absent" } };
  }
  const state = JSON.stringify({ taskId: context.taskId, contract: context.contract, criteria,
    testExitCode: evidence.testExitCode, testOutput: evidence.testOutput,
    changedFiles: evidence.changedFiles, gitDiff: evidence.gitDiff,
    sourceEvidence: evidence.sourceEvidence, verificationReceipt: evidence.verificationReceipt,
    commitInterval: evidence.commitInterval, counterevidence: evidence.counterevidence,
    evaluatedTreeDigest: evidence.evaluatedTreeDigest, omissions: evidence.omissions });
  let response: SemanticResponse;
  try {
    response = judgeClient ? await judgeClient.evaluateGate({ state, questions }) : await defaultGateClient.evaluate({ state, questions });
  } catch { response = { error: "transport_unavailable" }; }
  const answers = response.answers;
  const deliverablesVerdict = choiceValue(answers?.deliverables_verdict, ["APPROVE", "REJECT", "NEXT_ACTION_REQUIRED"] as const);
  const probability = noulValue(answers?.meets_criteria);
  const isolation = noulValue(answers?.claude_account_untouched);
  const drift = choiceValue(answers?.plan_drift, ["no_drift", "unapproved_deviation", "scope_creep"] as const);
  const missing: string[] = [];
  const violated: string[] = [];
  let malformedCriterion = false;
  for (const { criterion, key } of criterionQuestions) {
    const status = choiceValue(answers?.[key], ["satisfied", "violated", "evidence_missing"] as const);
    if (!status) malformedCriterion = true;
    if (status === "violated") violated.push(criterion.id);
    if (status === "evidence_missing") missing.push(criterion.id);
  }
  if (response.error || !deliverablesVerdict || probability === undefined || isolation === undefined || !drift || malformedCriterion) {
    const disposition = semanticFailureDisposition(response.error, context.contract?.criteria.map(criterion => criterion.id));
    const reasons = [...disposition.reasons];
    return { approved: false, gate1, disposition, reasons, escalateToUser: false,
      gate2: { passed: false, reasons, outcome: disposition, metadata: response.metadata, deliverablesVerdict, meetsCriteriaNoul: probability, claudeUntouchedNoul: isolation, planDriftChoice: drift },
      remediation: generateFallbackRemediation(reasons, { taskId: context.taskId, criteria, outcome: disposition }) };
  }
  const meets = passesSemanticApproval(probability, options.approvalPolicy);
  const isolated = passesSemanticApproval(isolation, options.approvalPolicy);
  const reasons: string[] = [];
  if (deliverablesVerdict !== "APPROVE" || !meets) reasons.push(`${deliverablesVerdict === "NEXT_ACTION_REQUIRED" ? "Next actions required" : "Task deliverable verification rejected"}: raw ${deliverablesVerdict} (meets_criteria P=${probability.toFixed(2)}). ${violated.length ? `Violated criteria: ${violated.join(", ")}.` : "Evidence prerequisite: exact criterion-level diagnosis is required before assigning edits."}`);
  if (drift !== "no_drift") reasons.push(`Violated boundary criterion plan_drift: ${drift}.`);
  if (!isolated) reasons.push(`Claude account isolation concern: P=${isolation.toFixed(2)}.`);
  if (violated.length) reasons.push(`Violated criteria: ${violated.join(", ")}.`);
  if (missing.length) reasons.push(`Missing evidence prerequisites for criteria: ${missing.join(", ")}.`);
  const approved = reasons.length === 0;
  const disposition: VerificationOutcome | undefined = approved ? undefined
    : missing.length || deliverablesVerdict === "NEXT_ACTION_REQUIRED"
      ? { status: "EVIDENCE_REQUIRED", missingCriterionIds: missing, reasons }
      : { status: "REJECTED", criterionIds: violated, reasons };
  return { approved, gate1, disposition, reasons, escalateToUser: false,
    gate2: { passed: approved, reasons, deliverablesVerdict, meetsCriteriaNoul: probability,
      planDriftChoice: drift, claudeUntouchedNoul: isolation, outcome: disposition, metadata: response.metadata },
    remediation: approved ? undefined : generateFallbackRemediation(reasons, { taskId: context.taskId, criteria, testCommand: context.testCommand, outcome: disposition }) };
}
