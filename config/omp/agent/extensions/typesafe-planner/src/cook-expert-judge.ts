import { evaluateAtomicJevStep, type AtomicEvaluationResult } from "./atomic-jev-evaluator";
import {
  createSemanticJudgeClient, choiceValue, choiceConfidence, noulValue, scoreValue,
  type SemanticResponse, type SemanticTransportMetadata,
} from "./semantic-judge-client";
import { isSecretInKey, clampText } from "./payload-safety";
import type { TaskContract, VerificationOutcome } from "./types/verification";
import { freezeContractValue } from "./task-contract-source";
import { encloseUntrusted } from "./xml-enclosure";
import { analyzeDiffForTestEvasion } from "./ast-analyzer";

import { DEFAULT_SEMANTIC_APPROVAL_OPTIONS, passesSemanticApproval, type SemanticApprovalOptions } from "./semantic-approval-policy";
import { semanticFailureDisposition } from "./semantic-failure";
import {
  touchesClaudeBoundary,
  hasProductCodeChanges,
  DELIVERABLE_ARTIFACT_MAX_BYTES,
} from "./evidence-collector";

export interface MicroCheckEvidence {
  gitStatus: string;
  gitDiff: string;
  testExitCode: number | null;
  testOutput: string;
  cleanWorkingTree: boolean;
  changedFiles?: string[];
  nonGitFallbackUsed?: boolean;
  taskDoneProven?: boolean;
  todoCompleted?: boolean;
  agentWorkLog?: string;
}

export interface MicroCheckResult {
  passed: boolean;
  reasons: string[];
  testPassed: boolean;
  claudeSafe: boolean;
  assertionDeleted?: boolean;
  testEvasion?: boolean;
  nonGitFallbackUsed?: boolean;
}

export interface MacroCheckContext {
  todoTask: string;
  phaseTitle?: string;
  planRequirements: string[];
  planContext?: string[];
  diffSummary: string;
  unifiedDiff: string;
  testSummary: string;
  attemptCount?: number;
  taskType?: "code_change" | "analysis_research" | "doc_specification";
  deliverableArtifacts?: string;
  userRequest?: string;
  agentWorkLog?: string;
  diffScope?: string;
  testCommand?: string;
  /** Host-owned contract/evidence; never inferred from an agent's task label. */
  contract?: TaskContract;
  criterionEvidence?: Readonly<Record<string, readonly string[]>>;
}

export type JevVerdict = "APPROVE" | "REJECT" | "NEXT_ACTION_REQUIRED" | "ESCALATE";
export type DropVerdict = "APPROVE" | "REJECT" | "ESCALATE";
export type DeliverablesVerdict = "APPROVE" | "REJECT" | "NEXT_ACTION_REQUIRED";
export type DriftChoice = "no_drift" | "unapproved_deviation" | "scope_creep";
export type ScopeChoice = "HOLD" | "EXPANSION" | "REDUCTION";

export interface MacroCheckResult {
  approved: boolean;
  reasons: string[];
  verdict?: DeliverablesVerdict;
  deliverablesVerdict?: DeliverablesVerdict;
  meetsCriteriaNoul?: number;
  driftChoice?: DriftChoice;
  scopeChoice?: ScopeChoice;
  riskScore?: number;
  expertConfidence?: number;
  escalateToUser?: boolean;
  error?: string;
  outcome?: VerificationOutcome;
  metadata?: SemanticTransportMetadata;
  rawAnswers?: Readonly<Record<string, unknown>>;
}

export interface ExpertJudgeQuestion {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria?: string[] | Record<string, string>;
}

export interface ExpertJudgeResponse extends SemanticResponse {}

export interface ExpertJudgeClient {
  evaluate: (params: {
    state: string | Record<string, unknown>;
    questions: Record<string, ExpertJudgeQuestion>;
  }) => Promise<ExpertJudgeResponse>;
}

const defaultJudgeClient: ExpertJudgeClient = createSemanticJudgeClient({ purpose: "expert" });
const nativeDoneJudgeClient = createSemanticJudgeClient({ purpose: "native_done" });
const nativeDropJudgeClient = createSemanticJudgeClient({ purpose: "native_drop" });

/**
 * Gate 1: Fast deterministic micro-check running locally in <150ms with 0 tokens.
 */
export async function runTaskMicroCheck(evidence: MicroCheckEvidence): Promise<MicroCheckResult> {
  const reasons: string[] = [];

  const touchesClaude = touchesClaudeBoundary(
    evidence.gitStatus,
    evidence.gitDiff,
    evidence.changedFiles
  );

  const claudeSafe = !touchesClaude;
  if (!claudeSafe) {
    reasons.push("Claude boundary violation: task modified files under .claude or Claude configuration.");
  }

  const codeChanges = hasProductCodeChanges(evidence.gitStatus, evidence.gitDiff, evidence.changedFiles);
  const testRequired = codeChanges;
  const testPassed = !testRequired ? (evidence.testExitCode === null || evidence.testExitCode === 0) : (evidence.testExitCode === 0);
  if (testRequired && evidence.testExitCode === null) {
    reasons.push("Product code changes detected but no test exit code was provided (testExitCode is null).");
  } else if (!testPassed) {
    reasons.push(`Test suite failed with exit code ${evidence.testExitCode}. Test failure must be resolved before completing task.`);
  }

  const atomicEval = await evaluateAtomicJevStep({
    taskGoal: evidence.agentWorkLog || "MicroCheck execution",
    gitDiff: evidence.gitDiff || "",
    testExitCode: evidence.testExitCode,
    testOutput: evidence.testOutput,
    changedFiles: evidence.changedFiles,
    testRequired,
  });
  for (const reason of atomicEval.reasons) {
    if (!reasons.includes(reason)) reasons.push(reason);
  }

  const testEvasion = analyzeDiffForTestEvasion(evidence.gitDiff);
  const assertionDeleted = testEvasion.deletedAssertions.length > 0;
  if (testEvasion.testEvasion) {
    reasons.push(...testEvasion.issues);
  }
  const hasGitEvidence = (evidence.gitStatus?.trim().length ?? 0) > 0 || (evidence.gitDiff?.trim().length ?? 0) > 0;
  const hasTestEvidence = evidence.testExitCode !== null || (evidence.testOutput?.trim().length ?? 0) > 0;
  const zeroEvidence = !hasGitEvidence && !hasTestEvidence && !(evidence.agentWorkLog?.trim());
  if (zeroEvidence) {
    reasons.push("Zero evidence: no test execution or git modifications observed for task completion.");
  }
  if (evidence.taskDoneProven === false || evidence.todoCompleted === false) {
    reasons.push(
      "Task completion precondition failed: agent must prove task and todo items are completed before invoking TypeSafe judge."
    );
  }

  const passed = claudeSafe && testPassed && !testEvasion.testEvasion && !zeroEvidence && evidence.taskDoneProven !== false && evidence.todoCompleted !== false;
  return {
    passed,
    reasons,
    testPassed,
    claudeSafe,
    assertionDeleted,
    testEvasion: testEvasion.testEvasion,
    nonGitFallbackUsed: evidence.nonGitFallbackUsed ?? false,
  };
}

/**
 * Gate 2: Semantic macro-check against TypeSafe System One.
 */
export async function runPhaseMacroCheck(
  ctx: MacroCheckContext,
  client: ExpertJudgeClient = nativeDoneJudgeClient,
  options: SemanticApprovalOptions = DEFAULT_SEMANTIC_APPROVAL_OPTIONS,
): Promise<MacroCheckResult> {
  const reasons: string[] = [];

  // Shared applicability is rubric selection, never a permission boundary.
  const taskKind = ctx.contract?.taskKind;
  const effectiveTaskType = hasProductCodeChanges(ctx.diffSummary || "", ctx.todoTask, ctx.contract)
    ? "code_change" : taskKind === "research" || taskKind === "review"
      ? "analysis_research" : (ctx.taskType ?? "code_change");
  if (Buffer.byteLength(ctx.deliverableArtifacts || "", "utf8") > DELIVERABLE_ARTIFACT_MAX_BYTES) {
    return {
      approved: false,
      reasons: ["insufficient_deliverable_evidence: required artifact evidence exceeds the UTF-8 delivery budget."],
      error: "insufficient_deliverable_evidence",
      outcome: { status: "EVIDENCE_REQUIRED", missingCriterionIds: ctx.contract?.criteria.map((c) => c.id) ?? [], reasons: ["Required artifact evidence exceeds the delivery budget; provide a complete bounded evidence packet."] },
    };
  }

  const statePayload: Record<string, string> = {
    todo_task: encloseUntrusted(ctx.contract?.target.content ?? ctx.todoTask ?? ctx.phaseTitle ?? "", "todo_task"),
    task_requirements: encloseUntrusted((ctx.contract?.criteria.map((c) => `${c.id}: ${c.text}`) ?? ctx.planRequirements ?? []).join("\n"), "task_requirements"),
    user_request: encloseUntrusted(ctx.userRequest || "unavailable", "user_request"),
    agent_work_log: encloseUntrusted(ctx.agentWorkLog || "unavailable", "agent_work_log"),
    diff_scope: encloseUntrusted(
      ctx.diffScope === "task-baseline"
        ? "task-baseline: only files changed since this task started"
        : "full-working-tree: no task-start baseline; may include unrelated pre-existing changes",
      "diff_scope"
    ),
    diff_summary: encloseUntrusted(ctx.diffSummary || "", "diff_summary"),
    unified_diff: encloseUntrusted(ctx.unifiedDiff || "", "unified_diff"),
    test_summary: encloseUntrusted(ctx.testSummary || "", "test_summary"),
  };
  if (ctx.planContext && ctx.planContext.length > 0) {
    statePayload.plan_context = encloseUntrusted(ctx.planContext.join("\n"), "plan_context");
  }
  if (ctx.deliverableArtifacts) {
    statePayload.deliverable_artifacts = encloseUntrusted(ctx.deliverableArtifacts, "deliverable_artifacts");
  }
  if (ctx.contract) statePayload.task_contract = encloseUntrusted(JSON.stringify(ctx.contract), "task_contract");
  if (ctx.criterionEvidence) statePayload.criterion_evidence = encloseUntrusted(JSON.stringify(ctx.criterionEvidence), "criterion_evidence");
  const rawState = JSON.stringify(statePayload);

  const hasExplicitTestCmd = Boolean(
    ctx.testCommand &&
      ctx.testSummary &&
      !ctx.testSummary.includes("No testCommand provided")
  );
  const scopeNote =
    " Evaluate ONLY the full current task and each task criterion; preserve exact criterion IDs. `user_request` and `plan_context` describe wider obligations, not unstarted task deliverables. Investigation/report tasks require concrete findings and task-bound evidence, not unrelated implementation or test changes." +
    (effectiveTaskType === "code_change"
      ? " Note: `unified_diff` may be summarized per file for size budget; corroborate with `diff_summary`, `test_summary`, and `agent_work_log`."
      : "") +
    (hasExplicitTestCmd
      ? ""
      : " Note: No separate testCommand was configured; do not penalize for 'No testCommand provided' in `test_summary`.");

  let deliverablesQuestion: ExpertJudgeQuestion;
  if (effectiveTaskType === "analysis_research" || effectiveTaskType === "doc_specification") {
    deliverablesQuestion = {
      type: "choice",
      instructions:
        "Based on `deliverable_artifacts`, `test_summary`, and `agent_work_log`, does the completed work satisfy `todo_task` and `task_requirements`?" +
        scopeNote,
      criteria: {
        APPROVE: "Deliverables satisfy the research or documentation criteria with concrete analysis or specifications",
        REJECT: "Deliverables fail to address the task requirements or omit required analysis",
        NEXT_ACTION_REQUIRED: "Deliverables are partial and need follow-up actions",
      },
    };
  } else {
    deliverablesQuestion = {
      type: "choice",
      instructions:
        "Based on `unified_diff`, `diff_summary`, `test_summary`, and `agent_work_log`, does the completed work satisfy `todo_task` and `task_requirements`?" +
        scopeNote,
      criteria: {
        APPROVE: hasExplicitTestCmd
          ? "Implementation fulfills the task acceptance criteria with passing tests"
          : "Implementation fulfills the task acceptance criteria based on unified_diff, diff_summary, and agent_work_log",
        REJECT: "Implementation fails to address the task requirements or stubs out needed functionality",
        NEXT_ACTION_REQUIRED: "Implementation is partial, has failing tests, or needs follow-up actions",
      },
    };
  }

  const questions: Record<string, ExpertJudgeQuestion> = {
    deliverables_verdict: deliverablesQuestion,
    meets_criteria: {
      type: "noul",
      instructions:
        (effectiveTaskType === "analysis_research" || effectiveTaskType === "doc_specification"
          ? "Does the research or specification evidence in `deliverable_artifacts` and `agent_work_log` satisfy `todo_task` and `task_requirements`?"
          : "Does the implementation in `unified_diff`, `diff_summary`, `test_summary`, and `agent_work_log` satisfy `todo_task` and `task_requirements`?") +
        scopeNote,
      criteria: {
        true: "Deliverables and evidence satisfy the current sub-task requirements",
        false: "Deliverables are incomplete, missing required evidence, or fail the current sub-task criteria",
      },
    },
    architectural_drift: {
      type: "choice",
      instructions:
        "Assess whether the changes adhere to planned architecture and safety boundaries. Updating companion unit tests (`tests/*`), plans (`plans/*`), documentation/ADRs/journals (`docs/*`), or supporting `src/*` modules is standard engineering practice and is NOT drift or scope creep:",
      criteria: {
        no_drift: "Strict adherence to architecture and boundaries (including companion tests, docs, plans, and supporting modules)",
        unapproved_deviation: "Unplanned architectural deviation or broken safety contract",
        scope_creep: "Scope creep into unrelated external projects or prohibited directories",
        other: "Unrecognized architectural change",
      },
    },
    scope_mode: {
      type: "choice",
      instructions:
        "Assess whether scope was maintained, expanded, or reduced relative to `todo_task` and `task_requirements` (not the whole plan):",
      criteria: {
        HOLD: "Preserves planned requirements exactly",
        EXPANSION: "Justified addition of edge cases, tests, or documentation",
        REDUCTION: "Omits requested functionality",
        other: "Other scope modification",
      },
    },
  };
  const criterionQuestions = ctx.contract?.criteria.map((criterion, index) => ({ key: `criterion_${index}`, criterion })) ?? [];
  for (const { key, criterion } of criterionQuestions) {
    questions[key] = {
      type: "choice",
      instructions: `Assess only criterion ${criterion.id}: ${criterion.text}. Select evidence_missing for missing task evidence; do not invent implementation requirements for investigation/report tasks.`,
      criteria: { satisfied: "Task-bound evidence satisfies this criterion", violated: "Evidence contradicts this exact criterion", evidence_missing: "A required evidence prerequisite for this criterion is absent" },
    };
  }
  for (const key of Object.keys(questions)) {
    if (isSecretInKey(key)) {
      throw new Error(`Security violation: secret token detected in question key "${key}"`);
    }
  }

  let response: ExpertJudgeResponse;
  try {
    response = await client.evaluate({ state: rawState, questions });
  } catch {
    response = { error: "transport_unavailable" };
  }
  const unavailable = (reason: string): MacroCheckResult => ({
    approved: false, reasons: [reason], error: "unavailable", metadata: response.metadata, escalateToUser: false,
    outcome: { status: "UNAVAILABLE", component: "semantic_judge", reasons: [reason] },
    rawAnswers: response.answers ? freezeContractValue(structuredClone(response.answers)) : undefined,
  });
  if (response.error || !response.answers) {
    const outcome = semanticFailureDisposition(response.error, ctx.contract?.criteria.map(criterion => criterion.id));
    return { ...unavailable(outcome.reasons.join(" ")), outcome };
  }
  const answers = response.answers;
  const deliverablesVerdict = choiceValue(answers.deliverables_verdict, ["APPROVE", "REJECT", "NEXT_ACTION_REQUIRED"] as const);
  const meetsCriteriaNoul = noulValue(answers.meets_criteria);
  const driftChoice = choiceValue(answers.architectural_drift, ["no_drift", "unapproved_deviation", "scope_creep"] as const);
  const scopeChoice = choiceValue(answers.scope_mode, ["HOLD", "EXPANSION", "REDUCTION"] as const);
  if (!deliverablesVerdict || meetsCriteriaNoul === undefined || !driftChoice || !scopeChoice) {
    return unavailable("Required judgment dimensions are missing or malformed: deliverables_verdict, actual finite meets_criteria probability in [0,1], architectural_drift, scope_mode. No categorical confidence substitutes for probability.");
  }
  const violated: string[] = [];
  const missing: string[] = [];
  for (const { key, criterion } of criterionQuestions) {
    const status = choiceValue(answers[key], ["satisfied", "violated", "evidence_missing"] as const);
    if (!status) return unavailable(`Required criterion assessment missing or invalid: ${criterion.id}.`);
    if (status === "violated") violated.push(criterion.id);
    if (status === "evidence_missing") missing.push(criterion.id);
  }
  // Preserve the existing explicit comparator captured by the trusted policy factory.
  const passesThreshold = passesSemanticApproval(meetsCriteriaNoul, options.approvalPolicy);
  if (deliverablesVerdict !== "APPROVE" || !passesThreshold) {
    reasons.push(`${deliverablesVerdict === "NEXT_ACTION_REQUIRED" ? "Next actions required" : "Deliverable verification rejected"} (${effectiveTaskType}): raw JEV ${deliverablesVerdict}, P=${meetsCriteriaNoul.toFixed(2)}. ${violated.length ? `Violated criteria: ${violated.join(", ")}.` : "Evidence prerequisite: obtain exact criterion-level diagnosis before assigning source edits."}`);
  }
  if (driftChoice !== "no_drift") reasons.push(`Violated boundary criterion architectural_drift: ${driftChoice}.`);
  if (scopeChoice === "REDUCTION") reasons.push("Violated scope criterion scope_mode: required task deliverables were omitted.");
  if (violated.length) reasons.push(`Violated criteria: ${violated.join(", ")}.`);
  if (missing.length) reasons.push(`Evidence prerequisites missing for criteria: ${missing.join(", ")}.`);
  const approved = reasons.length === 0;
  const evidenceRequired = missing.length > 0 || deliverablesVerdict === "NEXT_ACTION_REQUIRED" || (deliverablesVerdict === "APPROVE" && !passesThreshold && meetsCriteriaNoul >= 0.25);
  const escalated = !approved && !evidenceRequired && (ctx.attemptCount ?? 0) >= 3;
  if (escalated) reasons.push("3 semantic revision failures reached; require fresh independent diagnosis or exact human resolution, not an unchanged retry.");
  const outcome: VerificationOutcome | undefined = approved ? undefined
    : escalated ? { status: "HUMAN_REQUIRED", reasons }
    : evidenceRequired
      ? { status: "EVIDENCE_REQUIRED", missingCriterionIds: missing, reasons }
      : { status: "REJECTED", criterionIds: violated, reasons };
  return {
    approved, reasons, verdict: deliverablesVerdict, deliverablesVerdict,
    meetsCriteriaNoul, driftChoice, scopeChoice,
    expertConfidence: choiceConfidence(answers.deliverables_verdict),
    metadata: response.metadata, rawAnswers: freezeContractValue(structuredClone(answers)),
    outcome, escalateToUser: escalated,
  };
}

/**
 * Scope Arbiter: Evaluates scope compliance (HOLD, EXPANSION, REDUCTION).
 */
export async function evaluateScopeArbiter(
  plan: string,
  prompt: string,
  client: ExpertJudgeClient = defaultJudgeClient
): Promise<{ approved: boolean; choice: ScopeChoice; reason?: string; metadata?: SemanticTransportMetadata }> {
  const state = JSON.stringify({
    plan: encloseUntrusted(plan, "plan_content"),
    prompt: encloseUntrusted(prompt, "user_prompt")
  });
  const questions: Record<string, ExpertJudgeQuestion> = {
    scope_arbiter: {
      type: "choice",
      instructions: "Evaluate the implementation scope relative to plan requirements:",
      criteria: {
        HOLD: "Diff precisely matches requirements",
        EXPANSION: "Justified additions",
        REDUCTION: "Drops requirements",
        other: "Unrecognized scope alteration",
      },
    },
  };

  const response = await client.evaluate({ state, questions });
  if (response.error) {
    throw new Error(`TypeSafe error during scope evaluation: ${response.error}`);
  }
  const choice = choiceValue(response.answers?.scope_arbiter, ["HOLD", "EXPANSION", "REDUCTION"] as const);
  if (!choice) throw new Error("Invalid or missing scope_arbiter choice from TypeSafe");
  const approved = choice !== "REDUCTION";

  return {
    approved,
    choice,
    metadata: response.metadata,
    reason: approved ? undefined : "Scope reduction detected: required functionality was dropped.",
  };
}

/**
 * Architectural Drift Guard: Detects unapproved deviations and scope creep.
 */
export async function evaluateDriftGuard(
  diff: string,
  criteria: string[],
  client: ExpertJudgeClient = defaultJudgeClient
): Promise<{ approved: boolean; choice: DriftChoice; reason?: string; metadata?: SemanticTransportMetadata }> {
  const state = JSON.stringify({
    diff: encloseUntrusted(diff, "unified_diff"),
    criteria: encloseUntrusted(criteria.join("\n"), "criteria")
  });
  const questions: Record<string, ExpertJudgeQuestion> = {
    architectural_drift_guard: {
      type: "choice",
      instructions: "Evaluate whether code adheres to planned architecture and contracts:",
      criteria: {
        no_drift: "Strict adherence",
        unapproved_deviation: "Deviates from planned architecture",
        scope_creep: "Touches unrelated areas",
        other: "Other drift type",
      },
    },
  };

  const response = await client.evaluate({ state, questions });
  if (response.error) {
    throw new Error(`TypeSafe error during drift evaluation: ${response.error}`);
  }
  const choice = choiceValue(response.answers?.architectural_drift_guard, ["no_drift", "unapproved_deviation", "scope_creep"] as const);
  if (!choice) throw new Error("Invalid or missing architectural_drift_guard choice from TypeSafe");
  const approved = choice === "no_drift";

  return {
    approved,
    choice,
    metadata: response.metadata,
    reason: approved ? undefined : `Architectural drift violation: ${choice}`,
  };
}

/**
 * Risk & Security Triage: Rates technical trade-offs and security posture (0..3).
 */
export async function evaluateRiskSecurityTriage(
  context: string | Record<string, unknown>,
  client: ExpertJudgeClient = defaultJudgeClient
): Promise<{ score: number; acceptable: boolean; metadata?: SemanticTransportMetadata }> {
  const rawContext = typeof context === "string" ? context : JSON.stringify(context, null, 2);
  const state = JSON.stringify({
    context: encloseUntrusted(rawContext, "triage_context")
  });
  const questions: Record<string, ExpertJudgeQuestion> = {
    risk_security_triage: {
      type: "score",
      instructions: "Rate technical trade-offs, security invariants, and edge case resilience:",
      criteria: [
        "Zero Risk — robust implementation, full error handling",
        "Low Risk — minor edge case gaps with clean trade-offs",
        "Moderate Risk — trade-offs made without sufficient handling",
        "Critical Risk — severe flaw or security hole",
      ],
    },
  };

  const response = await client.evaluate({ state, questions });
  if (response.error) {
    throw new Error(`TypeSafe error during risk evaluation: ${response.error}`);
  }
  const score = scoreValue(response.answers?.risk_security_triage, 3);
  if (score === undefined) throw new Error("Invalid or missing risk_security_triage score in [0,3] from TypeSafe");

  return {
    score,
    acceptable: score <= 1.5,
    metadata: response.metadata,
  };
}

/**
 * Formats verification metrics into standard scorecard box.
 */
export function generateVerificationScorecard(results: {
  deliverablesVerdict?: DeliverablesVerdict;
  meetsCriteriaNoul?: number;
  driftChoice: DriftChoice;
  scopeChoice: ScopeChoice;
  expertConfidence?: number;
}): string {
  const driftLabel =
    results.driftChoice === "no_drift" ? "None (Strict adherence)" : results.driftChoice;
  const scopeDesc =
    results.scopeChoice === "HOLD"
      ? "All requirements covered"
      : results.scopeChoice === "EXPANSION"
      ? "Justified additions"
      : "Requirements dropped";

  const confidence = results.expertConfidence === undefined ? "not returned" : results.expertConfidence.toFixed(2);

  let deliverablesLine: string;
  if (results.deliverablesVerdict) {
    const vLabel = results.deliverablesVerdict === "APPROVE" ? "APPROVED" : results.deliverablesVerdict === "NEXT_ACTION_REQUIRED" ? "NEXT ACTION REQ" : "REJECTED";
    deliverablesLine = `│ Meets Plan Deliverables: VERDICT: ${vLabel} (JEV Confidence ${confidence}) │`;
  } else if (results.meetsCriteriaNoul !== undefined) {
    deliverablesLine = `│ Meets Plan Deliverables: P = ${results.meetsCriteriaNoul.toFixed(2)} (categorical verdict unavailable) │`;
  } else {
    deliverablesLine = "│ Meets Plan Deliverables: UNAVAILABLE (no verdict or probability) │";
  }

  return [
    "┌─────────────────────────────────────────────────────────┐",
    "│ TypeSafe System One Verification Scorecard              │",
    "├─────────────────────────────────────────────────────────┤",
    deliverablesLine,
    `│ Architectural Drift:     ${driftLabel.padEnd(28)}│`,
    `│ Scope Mode:              ${results.scopeChoice} (${scopeDesc})│`,
    `│ Choice Confidence:       ${confidence} (not approval authority) │`,
    "└─────────────────────────────────────────────────────────┘",
  ].join("\n");
}

export const DROP_REJECT_FLOOR = 0.30;

export interface DropCheckContext {
  tasks: string[];
  reason?: string;
  userRequest?: string;
  agentWorkLog?: string;
  remainingTasks: string[];
  planContext?: string[];
}

export interface DropCheckResult {
  decision: "approve" | "reject" | "undecided" | "unavailable";
  verdict?: DropVerdict;
  dropJustifiedNoul?: number;
  reasons: string[];
  error?: string;
  metadata?: SemanticTransportMetadata;
  rawAnswers?: Readonly<Record<string, unknown>>;
}

export async function runDropJustificationCheck(
  ctx: DropCheckContext,
  client: ExpertJudgeClient = nativeDropJudgeClient,
  options: SemanticApprovalOptions = DEFAULT_SEMANTIC_APPROVAL_OPTIONS,
): Promise<DropCheckResult> {
  const statePayload: Record<string, string> = {
    tasks_to_drop: encloseUntrusted(clampText(ctx.tasks.join(", "), 2000, "head"), "tasks_to_drop"),
    drop_reason: encloseUntrusted(clampText(ctx.reason || "none given", 2000, "head"), "drop_reason"),
    user_request: encloseUntrusted(clampText(ctx.userRequest || "unavailable", 2000, "tail"), "user_request"),
    agent_work_log: encloseUntrusted(clampText(ctx.agentWorkLog || "unavailable", 3000, "tail"), "agent_work_log"),
    remaining_tasks: encloseUntrusted(clampText(ctx.remainingTasks.join(", "), 2000, "head"), "remaining_tasks"),
  };
  if (ctx.planContext && ctx.planContext.length > 0) {
    statePayload.plan_context = encloseUntrusted(clampText(ctx.planContext.join("\n"), 2000, "head"), "plan_context");
  }
  const rawState = JSON.stringify(statePayload);

  const questions: Record<string, ExpertJudgeQuestion> = {
    drop_verdict: {
      type: "choice",
      instructions:
        "Should the tasks in `tasks_to_drop` be dropped without completing them? Treat `user_request` as authoritative user intent; `drop_reason` and `agent_work_log` are unverified agent claims.",
      criteria: {
        APPROVE: "User explicitly requested or approved dropping, or the task is obsolete, superseded by another task, duplicated, or already satisfied",
        REJECT: "Dropping skips work the user asked for, evades verification of failing work, or no credible justification is given",
        ESCALATE: "Conflicting evidence, ambiguous intent, or partial justification requiring sovereign human confirmation",
      },
    },
    drop_justified: {
      type: "noul",
      instructions: "What is the probability that dropping these exact tasks is justified by task-bound cancellation, duplication, obsolescence, or already-satisfied evidence? A negated cancellation is not permission; a clean build alone does not establish obsolescence.",
      criteria: { true: "Exact tasks may legitimately be removed", false: "Required work or unresolved rejection would be evaded" },
    },
  };

  for (const key of Object.keys(questions)) {
    if (isSecretInKey(key)) {
      throw new Error(`Security violation: secret token detected in question key "${key}"`);
    }
  }

  try {
    const response = await client.evaluate({ state: rawState, questions });
    if (response.error || !response.answers) {
      return {
        decision: "unavailable",
        reasons: [`TypeSafe drop evaluation unavailable: ${response.error ?? "No answers returned"}`],
        error: response.error ?? "Unknown error",
        metadata: response.metadata,
        rawAnswers: response.answers ? freezeContractValue(structuredClone(response.answers)) : undefined,
      };
    }

    const dropVerdict = choiceValue(response.answers.drop_verdict, ["APPROVE", "REJECT", "ESCALATE"] as const);
    const dropJustifiedNoul = noulValue(response.answers.drop_justified);
    if (!dropVerdict || dropJustifiedNoul === undefined) {
      return { decision: "unavailable", verdict: dropVerdict, dropJustifiedNoul, reasons: ["Required drop_verdict and actual finite drop_justified probability in [0,1] are absent or invalid."], error: "bad_response", metadata: response.metadata, rawAnswers: freezeContractValue(structuredClone(response.answers)) };
    }
    const passesDrop = passesSemanticApproval(dropJustifiedNoul, options.approvalPolicy);
    const decision = dropVerdict === "REJECT" ? "reject"
      : dropVerdict === "APPROVE" && passesDrop ? "approve"
      : dropJustifiedNoul < DROP_REJECT_FLOOR ? "reject" : "undecided";
    return {
      decision, verdict: dropVerdict, dropJustifiedNoul,
      reasons: [`Drop ${decision}: raw verdict ${dropVerdict}, actual Noul P=${dropJustifiedNoul.toFixed(2)}. ${decision === "approve" ? "Requires independent bound reasoning before native removal." : "Resolve exact task justification or evidence prerequisite; do not infer permission from a negated request."}`],
      metadata: response.metadata, rawAnswers: freezeContractValue(structuredClone(response.answers)),
    };
  } catch (err) {
    return {
      decision: "unavailable",
      reasons: [`TypeSafe drop evaluation unavailable: ${err instanceof Error ? err.message : String(err)}`],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

