import { preparePayloadSafe, type TypeSafePayload } from "./payload-safety";

export interface PlanQuestion {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria?: string[];
}

export interface PlanEvaluationInput {
  planTitle: string;
  planContent: string;
  userPrompt?: string;
  attempt?: number;
}

export interface PlanEvaluationResult {
  approved: boolean;
  score?: number;
  noul?: number;
  scopeMode?: "HOLD" | "EXPANSION" | "REDUCTION";
  claudeIsolationSafe: boolean;
  reasons: string[];
  feedback?: string;
  escalateToUser?: boolean;
}

export interface PlanJudgeClient {
  evaluatePlan: (params: {
    state: string;
    questions: Record<string, PlanQuestion>;
  }) => Promise<{
    answers?: {
      scope_mode?: { choice: string };
      algorithm_depth?: { score: number };
      task_actionability?: { noul: number };
      claude_isolation_adherence?: { noul: number };
    };
    error?: string;
  }>;
}

const CLAUDE_PROHIBITED_PATTERNS = [
  /~[/\\]\.claude/i,
  /(?:^|[\s/\\])\.claude[/\\]/i,
  /\.claude\.json/i,
  /ANTHROPIC_API_KEY/i,
  /CLAUDE_CODE_TOKEN/i,
];

/**
 * Deterministically checks if plan text attempts to read, edit, or configure
 * Claude/Anthropic directory files or session tokens.
 */
export function checkClaudePlanIsolation(
  planContent: string
): { safe: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const pattern of CLAUDE_PROHIBITED_PATTERNS) {
    if (pattern.test(planContent)) {
      violations.push(`Plan references prohibited path/credential matching ${pattern.toString()}`);
    }
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

/**
 * Builds the standard 3-question evaluation rubric for TypeSafe System One plan elevation.
 */
export function constructPlanQuestions(): Record<string, PlanQuestion> {
  return {
    scope_mode: {
      type: "choice",
      instructions: "Does this implementation plan preserve, expand, or reduce the requested scope?",
      criteria: [
        "HOLD: Faithfully implements all requested features and constraints without omitting requirements.",
        "EXPANSION: Covers all requested features and adds helpful, justifiable enhancements.",
        "REDUCTION: Omits requested features, cuts corners, or drops required constraints.",
      ],
    },
    algorithm_depth: {
      type: "score",
      instructions: "Evaluate the algorithmic rigor, edge-case coverage, and boundary handling in this plan.",
      criteria: [
        "Level 0: Superficial, happy-path only, no error handling or edge cases.",
        "Level 1: Basic validation, missing timeout, concurrency, or failure modes.",
        "Level 2: Comprehensive error handling, boundary validation, and cleanup.",
        "Level 3: Production invariants, rollback strategies, and strict typing.",
      ],
    },
    task_actionability: {
      type: "noul",
      instructions:
        "Rate the probability that every atomic task in this plan specifies concrete, verifiable commands and deterministic pass/fail criteria.",
    },
    claude_isolation_adherence: {
      type: "noul",
      instructions:
        "Rate whether this plan strictly adheres to zero-touch isolation of the user's Anthropic / Claude configuration and credentials.",
    },
  };
}

/**
 * Default network client for TypeSafe System One.
 */
async function defaultJudgeClient(
  state: string,
  questions: Record<string, PlanQuestion>
): Promise<{
  answers?: {
    scope_mode?: { choice: string };
    algorithm_depth?: { score: number };
    task_actionability?: { noul: number };
    claude_isolation_adherence?: { noul: number };
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
        scope_mode?: { choice: string };
        algorithm_depth?: { score: number };
        task_actionability?: { noul: number };
        claude_isolation_adherence?: { noul: number };
      },
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "network_error" };
  }
}

/**
 * Evaluates a draft plan against the TypeSafe System One rubric and Claude isolation rules.
 */
export async function evaluatePlanDraft(
  input: PlanEvaluationInput,
  judgeClient?: PlanJudgeClient
): Promise<PlanEvaluationResult> {
  const attempt = input.attempt ?? 1;

  // 1. Fast deterministic Claude isolation check
  const isolationCheck = checkClaudePlanIsolation(input.planContent);
  if (!isolationCheck.safe) {
    return {
      approved: false,
      claudeIsolationSafe: false,
      reasons: [
        "Claude zero-touch account isolation violation: plan must not modify or reference ~/.claude or Anthropic credentials.",
        ...isolationCheck.violations,
      ],
      escalateToUser: attempt >= 3,
      feedback:
        "Reject plan: Prohibited attempt to access or modify ~/.claude or Claude configuration. Remove all references to .claude files and retry.",
    };
  }

  // 2. Build questions and evaluate
  const questions = constructPlanQuestions();
  const state = `Plan Title: ${input.planTitle}\nUser Prompt: ${input.userPrompt ?? "N/A"}\n\nPlan Content:\n${input.planContent}`;

  const response = judgeClient
    ? await judgeClient.evaluatePlan({ state, questions })
    : await defaultJudgeClient(state, questions);

  if (response.error || !response.answers) {
    return {
      approved: false,
      claudeIsolationSafe: true,
      reasons: [`TypeSafe evaluation error: ${response.error ?? "No answers received"}`],
      escalateToUser: attempt >= 3,
      feedback: "TypeSafe evaluation failed. Check network connectivity or API key.",
    };
  }

  const { answers } = response;
  const reasons: string[] = [];

  const scopeChoice = answers.scope_mode?.choice?.toUpperCase() as
    | "HOLD"
    | "EXPANSION"
    | "REDUCTION"
    | undefined;
  if (scopeChoice === "REDUCTION") {
    reasons.push("Scope reduction forbidden: plan omits requested features or constraints.");
  }

  const depthScore = answers.algorithm_depth?.score;
  if (depthScore !== undefined && depthScore < 2.0) {
    reasons.push(
      `Algorithm depth score (${depthScore}) is below 2.0 minimum threshold. Plan lacks comprehensive error handling or edge case coverage.`
    );
  }

  const actionability = answers.task_actionability?.noul;
  if (actionability !== undefined && actionability < 0.70) {
    reasons.push(
      `Task actionability probability (${actionability}) is below 0.70 threshold. Tasks lack concrete verification commands.`
    );
  }

  const isolationNoul = answers.claude_isolation_adherence?.noul;
  if (isolationNoul !== undefined && isolationNoul < 0.95) {
    reasons.push(
      `Claude isolation adherence probability (${isolationNoul}) is below 0.95 threshold.`
    );
  }

  const approved = reasons.length === 0;
  const escalateToUser = !approved && attempt >= 3;

  let feedback: string | undefined;
  if (!approved) {
    feedback = `Plan rejected on attempt ${attempt}/3:\n- ${reasons.join("\n- ")}\n\nPlease revise the plan to address these specific gaps before proceeding.`;
  }

  return {
    approved,
    score: depthScore,
    noul: actionability,
    scopeMode: scopeChoice,
    claudeIsolationSafe: true,
    reasons,
    feedback,
    escalateToUser,
  };
}
