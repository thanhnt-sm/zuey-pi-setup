import { preparePayloadSafe, type TypeSafePayload } from "./payload-safety";
import { encloseUntrusted } from "./xml-enclosure";

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
  skipTriage?: boolean;
}

export interface TriageResult {
  valid: boolean;
  reasons: string[];
}

export interface PlanEvaluationResult {
  approved: boolean;
  score?: number;
  noul?: number;
  scopeMode?: "HOLD" | "EXPANSION" | "REDUCTION";
  claudeIsolationSafe: boolean;
  triagePassed?: boolean;
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
 * Structural triage layer that deterministically checks whether a plan contains
 * concrete target files, valid sequential dependencies, and verification criteria
 * before deploying expensive semantic model evaluation.
 */
export function preEvaluationTriage(planContent: string): TriageResult {
  const reasons: string[] = [];

  // 1. Concrete target files or paths check
  const hasFiles =
    /(?:[\w.-]+[/\\][\w.-]+|\b[\w-]+\.(?:ts|js|json|md|py|rs|go|html|css|yaml|yml|tsx|jsx)\b)/i.test(
      planContent
    );
  if (!hasFiles) {
    reasons.push("Plan missing concrete file paths or targets to modify.");
  }

  // 2. Sequential dependencies and floating/forward references check
  const lines = planContent.split("\n");
  const definedSteps = new Set<number>();
  const stepDependencies: Array<{ step: number; dependsOn: number }> = [];

  for (const line of lines) {
    const stepMatch = line.match(/^\s*(?:(\d+)\.|\bStep\s+(\d+)\b|\bPhase\s+(\d+)\b)/i);
    if (stepMatch) {
      const stepNum = parseInt(stepMatch[1] || stepMatch[2] || stepMatch[3], 10);
      if (!isNaN(stepNum)) {
        definedSteps.add(stepNum);
      }
    }
  }

  let currentStep: number | null = null;
  for (const line of lines) {
    const stepMatch = line.match(/^\s*(?:(\d+)\.|\bStep\s+(\d+)\b|\bPhase\s+(\d+)\b)/i);
    if (stepMatch) {
      currentStep = parseInt(stepMatch[1] || stepMatch[2] || stepMatch[3], 10);
    }
    if (currentStep !== null) {
      const depMatches = line.matchAll(
        /(?:depends\s+on|after|following|requires)\s+(?:step|phase)?\s*(\d+)/gi
      );
      for (const m of depMatches) {
        const depNum = parseInt(m[1], 10);
        if (!isNaN(depNum)) {
          stepDependencies.push({ step: currentStep, dependsOn: depNum });
        }
      }
    }
  }

  for (const dep of stepDependencies) {
    if (!definedSteps.has(dep.dependsOn) || dep.dependsOn >= dep.step) {
      reasons.push(
        `Floating/forward dependency detected: Step ${dep.step} depends on Step ${dep.dependsOn} which is undefined or subsequent.`
      );
    }
  }

  // 3. Verification or test strategy check
  const hasVerification =
    /(?:verification|acceptance criteria|tests?|assert(?:ion)?|validate|validation|run\s+bun\s+test)/i.test(
      planContent
    );
  if (!hasVerification) {
    reasons.push("Plan missing verification or test strategy.");
  }

  return {
    valid: reasons.length === 0,
    reasons,
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
      criteria: {
        HOLD: "Faithfully implements all requested features and constraints without omitting requirements.",
        EXPANSION: "Covers all requested features and adds helpful, justifiable enhancements.",
        REDUCTION: "Omits requested features, cuts corners, or drops required constraints.",
        other: "Unrecognized scope alteration",
      },
    },
    algorithm_depth: {
      type: "score",
      instructions: "Evaluate the algorithmic rigor, edge-case coverage, and boundary handling in this plan.",
      criteria: [
        "Superficial, happy-path only, no error handling or edge cases.",
        "Basic validation, missing timeout, concurrency, or failure modes.",
        "Comprehensive error handling, boundary validation, and cleanup.",
        "Production invariants, rollback strategies, and strict typing.",
      ],
    },
    task_actionability: {
      type: "noul",
      instructions:
        "Rate the probability that every atomic task in this plan specifies concrete, verifiable commands and deterministic pass/fail criteria.",
      criteria: {
        true: "Tasks are concrete, verifiable, and deterministic",
        false: "Tasks are vague, lack commands, or are missing criteria",
      },
    },
    claude_isolation_adherence: {
      type: "noul",
      instructions:
        "Rate whether this plan strictly adheres to zero-touch isolation of the user's Anthropic / Claude configuration and credentials.",
      criteria: {
        true: "Strict isolation maintained",
        false: "Plan attempts to touch configuration or credentials",
      },
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

  // 2. Fast deterministic structural triage check
  if (!input.skipTriage) {
    const triage = preEvaluationTriage(input.planContent);
    if (!triage.valid) {
      return {
        approved: false,
        claudeIsolationSafe: true,
        triagePassed: false,
        reasons: [
          "Structural triage failed: plan lacks essential structural integrity or contains broken dependencies.",
          ...triage.reasons,
        ],
        escalateToUser: attempt >= 3,
        feedback: `Plan rejected on attempt ${attempt}/3:\n- Structural triage failed:\n  • ${triage.reasons.join("\n  • ")}\n\nPlease ensure the plan includes explicit target file paths, sequential dependencies without forward references, and clear verification steps.`,
      };
    }
  }

  // 2. Build questions and evaluate
  const questions = constructPlanQuestions();
  const safeTitle = encloseUntrusted(input.planTitle, "plan_title");
  const safePrompt = encloseUntrusted(input.userPrompt ?? "N/A", "user_prompt");
  const safeContent = encloseUntrusted(input.planContent, "plan_content");
  const state = `<plan_evaluation_state>\n${safeTitle}\n${safePrompt}\n${safeContent}\n</plan_evaluation_state>`;
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
    triagePassed: !input.skipTriage ? true : undefined,
    reasons,
    feedback,
    escalateToUser,
  };
}
