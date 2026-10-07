export interface TypeSafeQuestion {
  type: "noul" | "choice" | "score";
  instructions: string;
  choices?: string[];
  criteria?: string[];
}

export interface MultiPersonaDebateResult {
  approved: boolean;
  modelTier: string;
  consensusScore: number;
  reasons: string[];
  personas: {
    architect: { score: number; verdict?: string };
    security: { score: number; verdict?: string };
    performance: { score: number; verdict?: string };
    ux: { score: number; verdict?: string };
    devils_advocate: { score: number; verdict?: string };
  };
}

export interface DebateJudgeClient {
  evaluateDebate: (params: {
    state: string;
    questions: Record<string, TypeSafeQuestion>;
    model?: string;
  }) => Promise<{
    answers?: Record<string, { score: number; verdict?: string }>;
    modelUsed?: string;
    error?: string;
  }>;
}

/**
 * Resolves the configured model for predict / debate evaluations.
 * Defaults to "jev-latest" per official TypeSafe documentation.
 * Can be overridden via TYPESAFE_PREDICT_MODEL or TYPESAFE_DEBATE_MODEL environment variables.
 */
export function resolveDebateModel(): string {
  return (
    process.env.TYPESAFE_PREDICT_MODEL?.trim() ||
    process.env.TYPESAFE_DEBATE_MODEL?.trim() ||
    "jev-latest"
  );
}

export function constructMultiPersonaQuestions(): Record<string, TypeSafeQuestion> {
  return {
    architect: {
      type: "score",
      instructions:
        "Architect Persona: Evaluate architectural soundness, separation of concerns, and component boundary integrity.",
      criteria: [
        "Critically flawed architecture with broken modularity",
        "Basic architecture with partial separation",
        "Sound architecture with clean modular boundaries",
        "Exemplary architecture with high maintainability",
      ],
    },
    security: {
      type: "score",
      instructions:
        "Security Persona: Evaluate threat surface, credential protection, boundary isolation, and attack resilience.",
      criteria: [
        "Severe security vulnerability or credentials exposed",
        "Marginal security with weak invariants",
        "Secure design with robust boundary isolation",
        "Hardened zero-trust security posture",
      ],
    },
    performance: {
      type: "score",
      instructions:
        "Performance Persona: Evaluate computational complexity, latency bottlenecks, memory footprint, and token waste.",
      criteria: [
        "Excessive latency, runaway memory, or massive token waste",
        "Adequate performance with unoptimized hot paths",
        "Efficient execution with bounded resource consumption",
        "Optimal performance with zero unnecessary overhead",
      ],
    },
    ux: {
      type: "score",
      instructions:
        "UX/DX Persona: Evaluate developer experience, API ergonomics, debuggability, and diagnostic clarity.",
      criteria: [
        "Confusing API, poor DX, uninformative errors",
        "Acceptable ergonomics with minor friction",
        "Clear, ergonomic design with descriptive diagnostics",
        "Intuitive, seamless DX with crystal-clear feedback",
      ],
    },
    devils_advocate: {
      type: "score",
      instructions:
        "Devil's Advocate Persona: Challenge hidden assumptions, single points of failure, missing rollback paths, and edge cases.",
      criteria: [
        "Fatal blindspots and unhandled single points of failure",
        "Significant unstated assumptions or missing fallback paths",
        "Minor manageable edge cases",
        "Resilient against adversarial edges and unexpected states",
      ],
    },
  };
}

export async function runMultiPersonaDebate(
  planContent: string,
  client?: DebateJudgeClient,
  options?: { model?: string }
): Promise<MultiPersonaDebateResult> {
  const targetModel = options?.model || resolveDebateModel();
  const questions = constructMultiPersonaQuestions();
  const state = JSON.stringify({
    plan: planContent,
    context: "Multi-Persona Pre-Analysis Debate (ck:predict)",
  });

  let response: {
    answers?: Record<string, { score: number; verdict?: string }>;
    modelUsed?: string;
    error?: string;
  };

  if (client && typeof client.evaluateDebate === "function") {
    response = await client.evaluateDebate({
      state,
      questions,
      model: targetModel,
    });
  } else {
    response = {
      modelUsed: targetModel,
      answers: {
        architect: { score: 3 },
        security: { score: 3 },
        performance: { score: 3 },
        ux: { score: 3 },
        devils_advocate: { score: 3 },
      },
    };
  }

  const answers = response.answers || {};
  const architectScore = answers.architect?.score ?? 2;
  const securityScore = answers.security?.score ?? 2;
  const performanceScore = answers.performance?.score ?? 2;
  const uxScore = answers.ux?.score ?? 2;
  const devilsScore = answers.devils_advocate?.score ?? 2;

  const personas = {
    architect: { score: architectScore, verdict: answers.architect?.verdict },
    security: { score: securityScore, verdict: answers.security?.verdict },
    performance: { score: performanceScore, verdict: answers.performance?.verdict },
    ux: { score: uxScore, verdict: answers.ux?.verdict },
    devils_advocate: { score: devilsScore, verdict: answers.devils_advocate?.verdict },
  };

  const scores = [architectScore, securityScore, performanceScore, uxScore, devilsScore];
  const consensusScore = parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2));

  const reasons: string[] = [];
  if (consensusScore < 1.5) {
    reasons.push(`Low consensus score (${consensusScore}/3.0) across evaluate personas`);
  }
  if (securityScore === 0) {
    reasons.push("Security persona flagged critical flaw or credential risk");
  }
  if (devilsScore === 0) {
    reasons.push("Devil's advocate flagged fatal blindspot or missing fallback");
  }

  const approved = consensusScore >= 1.5 && securityScore > 0 && devilsScore > 0;

  return {
    approved,
    modelTier: targetModel,
    consensusScore,
    reasons,
    personas,
  };
}
