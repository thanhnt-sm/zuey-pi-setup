import {
  collectTaskEvidence,
  type TaskEvidenceResult,
} from "./evidence-collector";
import { preparePayloadSafe, type TypeSafePayload } from "./payload-safety";

export interface Gate1Result {
  passed: boolean;
  reasons: string[];
  cleanTree: boolean;
  testPassed: boolean;
  claudeSafe: boolean;
}

export interface Gate2Result {
  passed: boolean;
  reasons: string[];
  meetsCriteriaNoul?: number;
  planDriftChoice?: "no_drift" | "unapproved_deviation" | "scope_creep";
  claudeUntouchedNoul?: number;
  escalateToUser?: boolean;
}

export interface DualGateVerificationResult {
  approved: boolean;
  gate1: Gate1Result;
  gate2?: Gate2Result;
  reasons: string[];
  escalateToUser?: boolean;
}

export interface GateQuestion {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria?: string[];
}

export interface GateJudgeClient {
  evaluateGate: (params: {
    state: string;
    questions: Record<string, GateQuestion>;
  }) => Promise<{
    answers?: {
      meets_criteria?: { noul: number };
      plan_drift?: { choice: string };
      claude_account_untouched?: { noul: number };
    };
    error?: string;
  }>;
}

export interface TaskVerificationContext {
  cwd?: string;
  taskId: string;
  planPath?: string;
  testCommand?: string;
  timeoutMs?: number;
  untrustedAgentClaim?: string;
}

/**
 * Gate 1: Fast deterministic verification (zero-token, local execution).
 */
export function checkDeterministicPreconditions(evidence: TaskEvidenceResult): Gate1Result {
  const reasons: string[] = [];

  // 1. Claude boundary check
  const touchesClaude =
    /(?:^|[\s/\\])\.claude[/\\]/i.test(evidence.gitStatus) ||
    /(?:^|[\s/\\])\.claude[/\\]/i.test(evidence.gitDiff) ||
    /\.claude\.json/i.test(evidence.gitStatus);

  const claudeSafe = !touchesClaude;
  if (!claudeSafe) {
    reasons.push("Claude boundary violation: task modified files under .claude or Claude configuration.");
  }

  // 2. Test execution check
  const testPassed = evidence.testExitCode === null || evidence.testExitCode === 0;
  if (!testPassed) {
    reasons.push(`Test suite failed with exit code ${evidence.testExitCode}. Test failure must be resolved before completing task.`);
  }

  // 3. Assertion deletion / test evasion check
  const deletedAssertions =
    /(?:^|\n)-\s*(?:expect\(|assert\(|assert\.[a-zA-Z]+\()/m.test(evidence.gitDiff);
  if (deletedAssertions) {
    reasons.push("Test evasion detected: git diff contains deleted assertions (expect/assert). Deleting tests to fake completion is prohibited.");
  }

  const passed = claudeSafe && testPassed && !deletedAssertions;
  return {
    passed,
    reasons,
    cleanTree: evidence.cleanWorkingTree,
    testPassed,
    claudeSafe,
  };
}

/**
 * Constructs the semantic verification questions for Gate 2.
 */
export function constructGateQuestions(criteria: string[]): Record<string, GateQuestion> {
  const criteriaList =
    criteria.length > 0
      ? criteria
      : ["Code correctly satisfies task deliverables and requirements."];

  return {
    meets_criteria: {
      type: "noul",
      instructions:
        "Rate the probability that the real Git diff and test execution output completely satisfy the task's stated deliverables.",
      criteria: {
        true: `Satisfies all criteria: ${criteriaList.join(", ")}`,
        false: "Fails to satisfy criteria or partially implemented",
      },
    },
    plan_drift: {
      type: "choice",
      instructions:
        "Assess whether the code changes introduce architectural drift, unauthorized deviation, or unneeded scope.",
      criteria: {
        no_drift: "Code strictly adheres to planned components, interfaces, and deliverables.",
        unapproved_deviation: "Code modifies unrelated subsystems or alters planned architectural contracts.",
        scope_creep: "Code introduces excessive, unnecessary features outside the task boundaries.",
        other: "Unrecognized structural change",
      },
    },
    claude_account_untouched: {
      type: "noul",
      instructions:
        "Confirm that zero Anthropic / Claude accounts, tokens, or configuration touchpoints are accessed or modified.",
      criteria: {
        true: "Zero Anthropic/Claude touches",
        false: "Touches Anthropic/Claude configuration or credentials",
      },
    },
  };
}

/**
 * Default network client for Gate 2 semantic evaluation.
 */
async function defaultGateJudgeClient(
  state: string,
  questions: Record<string, GateQuestion>
): Promise<{
  answers?: {
    meets_criteria?: { noul: number };
    plan_drift?: { choice: string };
    claude_account_untouched?: { noul: number };
  };
  error?: string;
}> {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    return { error: "TYPESAFE_API_KEY is missing from environment" };
  }

  const payload: TypeSafePayload = {
    state,
    questions,
    model: "jev-latest",
  };

  const safePayload = preparePayloadSafe(payload, { apiKey });

  try {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(safePayload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return { error: `http_${res.status}` };
    }

    const json = (await res.json()) as { answers?: Record<string, unknown> };
    return {
      answers: json.answers as {
        meets_criteria?: { noul: number };
        plan_drift?: { choice: string };
        claude_account_untouched?: { noul: number };
      },
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "network_error" };
  }
}

/**
 * Executes the dual-verification gate for task completion:
 * Gate 1 (deterministic local) -> Gate 2 (TypeSafe System One semantic).
 */
export async function verifyTaskCompletion(
  context: TaskVerificationContext,
  judgeClient?: GateJudgeClient
): Promise<DualGateVerificationResult> {
  // 1. Gather ground truth OS signals
  const evidence = await collectTaskEvidence({
    cwd: context.cwd,
    taskId: context.taskId,
    planPath: context.planPath,
    testCommand: context.testCommand,
    timeoutMs: context.timeoutMs,
    untrustedAgentState: context.untrustedAgentClaim,
  });

  // 2. Execute Gate 1 (deterministic, zero token)
  const gate1 = checkDeterministicPreconditions(evidence);
  if (!gate1.passed) {
    return {
      approved: false,
      gate1,
      reasons: gate1.reasons,
      escalateToUser: false,
    };
  }

  // 3. Execute Gate 2 (semantic verification via TypeSafe System One)
  const questions = constructGateQuestions(evidence.criteria);
  const state = JSON.stringify({
    taskId: context.taskId,
    gitDiff: evidence.gitDiff,
    testExitCode: evidence.testExitCode,
    testOutput: evidence.testOutput,
    criteria: evidence.criteria,
  });

  const response = judgeClient
    ? await judgeClient.evaluateGate({ state, questions })
    : await defaultGateJudgeClient(state, questions);

  // Fail-closed handling if TypeSafe is offline, errors, or fails to answer
  if (response.error || !response.answers) {
    const errorMsg = `TypeSafe judge offline/error: fail-closed escalation required (${response.error ?? "no answers"})`;
    return {
      approved: false,
      gate1,
      gate2: {
        passed: false,
        reasons: [errorMsg],
        escalateToUser: true,
      },
      reasons: [errorMsg],
      escalateToUser: true,
    };
  }

  const { answers } = response;
  const reasons: string[] = [];

  const meetsCriteriaNoul = answers.meets_criteria?.noul;
  if (meetsCriteriaNoul !== undefined && meetsCriteriaNoul < 0.70) {
    reasons.push(
      `Deliverable verification failed: meets_criteria probability (${meetsCriteriaNoul}) is below 0.70 threshold.`
    );
  }

  const driftChoice = answers.plan_drift?.choice?.toLowerCase() as
    | "no_drift"
    | "unapproved_deviation"
    | "scope_creep"
    | undefined;
  if (driftChoice && driftChoice !== "no_drift") {
    reasons.push(
      `Architectural drift detected: plan_drift is "${driftChoice}". Code must not deviate from planned boundaries.`
    );
  }

  const claudeUntouchedNoul = answers.claude_account_untouched?.noul;
  if (claudeUntouchedNoul !== undefined && claudeUntouchedNoul < 0.95) {
    reasons.push(
      `Claude account isolation concern: claude_account_untouched probability (${claudeUntouchedNoul}) is below 0.95.`
    );
  }

  const approved = reasons.length === 0;

  return {
    approved,
    gate1,
    gate2: {
      passed: approved,
      reasons,
      meetsCriteriaNoul,
      planDriftChoice: driftChoice,
      claudeUntouchedNoul,
      escalateToUser: false,
    },
    reasons,
    escalateToUser: false,
  };
}
