import { preparePayloadSafe, isSecretInKey } from "./payload-safety";

export interface MicroCheckEvidence {
  gitStatus: string;
  gitDiff: string;
  testExitCode: number | null;
  testOutput: string;
  cleanWorkingTree: boolean;
  nonGitFallbackUsed?: boolean;
}

export interface MicroCheckResult {
  passed: boolean;
  reasons: string[];
  testPassed: boolean;
  claudeSafe: boolean;
  assertionDeleted?: boolean;
  nonGitFallbackUsed?: boolean;
}

export interface MacroCheckContext {
  phaseTitle: string;
  planRequirements: string[];
  diffSummary: string;
  unifiedDiff: string;
  testSummary: string;
  attemptCount?: number;
}

export type DriftChoice = "no_drift" | "unapproved_deviation" | "scope_creep";
export type ScopeChoice = "HOLD" | "EXPANSION" | "REDUCTION";

export interface MacroCheckResult {
  approved: boolean;
  reasons: string[];
  meetsCriteriaNoul?: number;
  driftChoice?: DriftChoice;
  scopeChoice?: ScopeChoice;
  riskScore?: number;
  expertConfidence?: number;
  escalateToUser?: boolean;
  error?: string;
}

export interface ExpertJudgeQuestion {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria?: string[] | Record<string, string>;
}

export interface ExpertJudgeResponse {
  answers?: {
    meets_criteria?: { noul: number; confidence?: number };
    architectural_drift?: { choice: DriftChoice };
    architectural_drift_guard?: { choice: DriftChoice };
    scope_mode?: { choice: ScopeChoice };
    scope_arbiter?: { choice: ScopeChoice };
    risk_score?: { score: number };
    risk_security_triage?: { score: number };
  };
  error?: string;
}

export interface ExpertJudgeClient {
  evaluate: (params: {
    state: string;
    questions: Record<string, ExpertJudgeQuestion>;
  }) => Promise<ExpertJudgeResponse>;
}

const defaultJudgeClient: ExpertJudgeClient = {
  async evaluate({ state, questions }) {
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) {
      return { error: "TYPESAFE_API_KEY environment variable is missing" };
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const sanitized = preparePayloadSafe({
        state,
        questions: questions as Record<string, { type: "choice" | "score" | "noul"; instructions: string; criteria?: string[] }>,
      });
      const res = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: "jev-latest", ...sanitized }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        return { error: `TypeSafe API returned HTTP ${res.status}: ${res.statusText}` };
      }
      return (await res.json()) as ExpertJudgeResponse;
    } catch (err) {
      return { error: `TypeSafe network error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

/**
 * Gate 1: Fast deterministic micro-check running locally in <150ms with 0 tokens.
 */
export async function runTaskMicroCheck(evidence: MicroCheckEvidence): Promise<MicroCheckResult> {
  const reasons: string[] = [];

  const touchesClaude =
    /(?:^|[\s/\\])\.claude[/\\]/i.test(evidence.gitStatus) ||
    /(?:^|[\s/\\])\.claude[/\\]/i.test(evidence.gitDiff) ||
    /\.claude\.json/i.test(evidence.gitStatus);

  const claudeSafe = !touchesClaude;
  if (!claudeSafe) {
    reasons.push("Claude boundary violation: task modified files under .claude or Claude configuration.");
  }

  const testPassed = evidence.testExitCode === null || evidence.testExitCode === 0;
  if (!testPassed) {
    reasons.push(`Test suite failed with exit code ${evidence.testExitCode}. Test failure must be resolved before completing task.`);
  }

  const assertionDeleted =
    /(?:^|\n)-\s*(?:expect\(|assert\(|assert\.[a-zA-Z]+\()/m.test(evidence.gitDiff);
  if (assertionDeleted) {
    reasons.push("Test evasion detected: git diff contains deleted assertions (expect/assert). Deleting tests to fake completion is prohibited.");
  }

  const passed = claudeSafe && testPassed && !assertionDeleted;

  return {
    passed,
    reasons,
    testPassed,
    claudeSafe,
    assertionDeleted,
    nonGitFallbackUsed: evidence.nonGitFallbackUsed ?? false,
  };
}

/**
 * Gate 2: Semantic macro-check against TypeSafe System One.
 */
export async function runPhaseMacroCheck(
  ctx: MacroCheckContext,
  client: ExpertJudgeClient = defaultJudgeClient
): Promise<MacroCheckResult> {
  const reasons: string[] = [];

  if (ctx.attemptCount && ctx.attemptCount >= 3) {
    return {
      approved: false,
      reasons: ["3 consecutive failed revision attempts reached. Halting autonomous loop for user escalation."],
      escalateToUser: true,
    };
  }

  const rawState = JSON.stringify({
    phase_title: ctx.phaseTitle,
    plan_requirements: ctx.planRequirements,
    diff_summary: ctx.diffSummary,
    unified_diff: ctx.unifiedDiff,
    test_summary: ctx.testSummary,
  });

  const questions: Record<string, ExpertJudgeQuestion> = {
    meets_criteria: {
      type: "noul",
      instructions: "Does `unified_diff` satisfy all deliverables in `plan_requirements` without skipping requirements or faking tests?",
      criteria: {
        true: "Implementation fulfills all listed acceptance criteria with real passing tests",
        false: "Implementation is partial, missing requirements, or stubs out needed functionality",
      },
    },
    architectural_drift: {
      type: "choice",
      instructions: "Assess whether the `unified_diff` adheres to planned architecture and file ownership boundaries:",
      criteria: {
        no_drift: "Strict adherence to architecture",
        unapproved_deviation: "Unplanned architectural deviation",
        scope_creep: "Scope creep into unrelated files",
        other: "Unrecognized architectural change",
      },
    },
    scope_mode: {
      type: "choice",
      instructions: "Assess whether scope was maintained, expanded, or reduced based on `plan_requirements`:",
      criteria: {
        HOLD: "Preserves planned requirements exactly",
        EXPANSION: "Justified addition of edge cases or tests",
        REDUCTION: "Omits requested functionality",
        other: "Other scope modification",
      },
    },
  };

  for (const key of Object.keys(questions)) {
    if (isSecretInKey(key)) {
      throw new Error(`Security violation: secret token detected in question key "${key}"`);
    }
  }

  const response = await client.evaluate({ state: rawState, questions });

  if (response.error || !response.answers) {
    return {
      approved: false,
      reasons: [`TypeSafe verification error: ${response.error ?? "No answers returned"}`],
      escalateToUser: true,
      error: response.error ?? "Unknown error",
    };
  }

  const answers = response.answers;
  const meetsCriteriaNoul = answers.meets_criteria?.noul;
  const driftChoice = (answers.architectural_drift?.choice ?? answers.architectural_drift_guard?.choice) as DriftChoice | undefined;
  const scopeChoice = (answers.scope_mode?.choice ?? answers.scope_arbiter?.choice) as ScopeChoice | undefined;
  const riskScore = answers.risk_score?.score ?? answers.risk_security_triage?.score;
  const expertConfidence = answers.architectural_drift?.confidence ?? answers.scope_mode?.confidence ?? meetsCriteriaNoul ?? 0.0;

  if (meetsCriteriaNoul === undefined || !driftChoice || !scopeChoice) {
    return {
      approved: false,
      reasons: ["Incomplete TypeSafe evaluation: one or more required judgment dimensions were missing."],
      escalateToUser: true,
      error: "incomplete_response",
      meetsCriteriaNoul: meetsCriteriaNoul ?? 0,
      driftChoice: driftChoice ?? "unapproved_deviation",
      scopeChoice: scopeChoice ?? "REDUCTION",
      riskScore,
      expertConfidence,
    };
  }
  let approved = true;

  if (meetsCriteriaNoul < 0.7) {
    approved = false;
    reasons.push(`Implementation score P=${meetsCriteriaNoul.toFixed(2)} is below required threshold 0.70.`);
  }

  if (driftChoice !== "no_drift") {
    approved = false;
    reasons.push(`Architectural drift detected: ${driftChoice}. Must maintain strict adherence to planned boundaries.`);
  }

  if (scopeChoice === "REDUCTION") {
    approved = false;
    reasons.push("Scope reduction detected: implementation omitted planned deliverables.");
  }

  return {
    approved,
    reasons,
    meetsCriteriaNoul,
    driftChoice,
    scopeChoice,
    riskScore,
    expertConfidence,
    escalateToUser: !approved && (ctx.attemptCount ? ctx.attemptCount >= 3 : false),
  };
}

/**
 * Scope Arbiter: Evaluates scope compliance (HOLD, EXPANSION, REDUCTION).
 */
export async function evaluateScopeArbiter(
  plan: string,
  prompt: string,
  client: ExpertJudgeClient = defaultJudgeClient
): Promise<{ approved: boolean; choice: ScopeChoice; reason?: string }> {
  const state = JSON.stringify({ plan, prompt });
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
  const choice = response.answers?.scope_arbiter?.choice as ScopeChoice;
  if (!choice) throw new Error("Missing scope_arbiter choice from TypeSafe");
  const approved = choice !== "REDUCTION";

  return {
    approved,
    choice,
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
): Promise<{ approved: boolean; choice: DriftChoice; reason?: string }> {
  const state = JSON.stringify({ diff, criteria });
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
  const choice = response.answers?.architectural_drift_guard?.choice as DriftChoice;
  if (!choice) throw new Error("Missing architectural_drift_guard choice from TypeSafe");
  const approved = choice === "no_drift";

  return {
    approved,
    choice,
    reason: approved ? undefined : `Architectural drift violation: ${choice}`,
  };
}

/**
 * Risk & Security Triage: Rates technical trade-offs and security posture (0..3).
 */
export async function evaluateRiskSecurityTriage(
  context: string | Record<string, unknown>,
  client: ExpertJudgeClient = defaultJudgeClient
): Promise<{ score: number; acceptable: boolean }> {
  const state = typeof context === "string" ? context : JSON.stringify(context);
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
  const score = response.answers?.risk_security_triage?.score;
  if (score === undefined) throw new Error("Missing risk_security_triage score from TypeSafe");

  return {
    score,
    acceptable: score <= 1.5,
  };
}

/**
 * Formats verification metrics into standard scorecard box.
 */
export function generateVerificationScorecard(results: {
  meetsCriteriaNoul: number;
  driftChoice: DriftChoice;
  scopeChoice: ScopeChoice;
  expertConfidence: number;
}): string {
  const driftLabel =
    results.driftChoice === "no_drift" ? "None (Strict adherence)" : results.driftChoice;
  const scopeDesc =
    results.scopeChoice === "HOLD"
      ? "All requirements covered"
      : results.scopeChoice === "EXPANSION"
      ? "Justified additions"
      : "Requirements dropped";

  return [
    "┌─────────────────────────────────────────────────────────┐",
    "│ TypeSafe System One Verification Scorecard              │",
    "├─────────────────────────────────────────────────────────┤",
    `│ Meets Plan Deliverables: P = ${results.meetsCriteriaNoul.toFixed(2)} (Threshold >= 0.70)   │`,
    `│ Architectural Drift:     ${driftLabel.padEnd(28)}│`,
    `│ Scope Mode:              ${results.scopeChoice} (${scopeDesc})│`,
    `│ Expert Evaluator:        Approved (Confidence ${results.expertConfidence.toFixed(2)})     │`,
    "└─────────────────────────────────────────────────────────┘",
  ].join("\n");
}
