import { createRequire } from "node:module";

export interface TypeSafeQuestion {
  type: "noul" | "choice" | "score";
  instructions: string;
  choices?: string[];
  criteria?: string[];
}

export interface DebatePersonaVerdict {
  score?: number;
  verdict?: string;
}

export interface MultiPersonaDebateResult {
  approved: boolean;
  status: "approved" | "rejected" | "unavailable" | "insufficient";
  advisoryOnly: true;
  /** Requested selector, not a claim about the model actually used by the provider. */
  modelTier: string;
  requestedModel: string;
  resolvedModel?: string;
  metadata?: Record<string, unknown>;
  consensusScore?: number;
  errorCode?: string;
  reasons: string[];
  personas: Record<"architect" | "security" | "performance" | "ux" | "devils_advocate", DebatePersonaVerdict>;
}

export interface DebateJudgeResponse {
  answers?: Record<string, unknown>;
  modelUsed?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface DebateJudgeRequest {
  state: string;
  questions: Record<string, TypeSafeQuestion>;
  model?: string;
}

export interface DebateJudgeClient {
  evaluateDebate: (params: DebateJudgeRequest) => Promise<DebateJudgeResponse>;
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

const PERSONAS = ["architect", "security", "performance", "ux", "devils_advocate"] as const;

async function defaultDebateClient(
  params: DebateJudgeRequest
): Promise<DebateJudgeResponse> {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) return { error: "api_key_missing" };
  let policyClient: {
    resolveTrustedToolPolicy: (purpose: "debate") => unknown;
    judgeWithPolicy: (options: {
      args: DebateJudgeRequest;
      trustedPolicy: unknown;
      purpose: "debate";
      apiKey: string;
      fetchImpl: typeof fetch;
    }) => Promise<
      { ok: true; answers: Record<string, unknown>; metadata?: Record<string, unknown> }
      | { ok: false; code: string; metadata?: Record<string, unknown> }
    >;
  };
  try {
    policyClient = createRequire(import.meta.url)("./typesafe-policy-client.cjs");
  } catch {
    return { error: "policy_client_missing" };
  }
  try {
    if (typeof policyClient.resolveTrustedToolPolicy !== "function" || typeof policyClient.judgeWithPolicy !== "function") {
      return { error: "policy_client_missing" };
    }
    const result = await policyClient.judgeWithPolicy({
      args: params,
      trustedPolicy: policyClient.resolveTrustedToolPolicy("debate"),
      purpose: "debate",
      apiKey,
      fetchImpl: globalThis.fetch,
    });
    return result.ok
      ? { answers: result.answers, metadata: result.metadata }
      : { error: result.code, metadata: result.metadata };
  } catch {
    return { error: "policy_client_unavailable" };
  }
}

/**
 * Advisory rubric scores are not probabilities or independent votes. Preserve
 * every existing veto: mean >= 1.5 AND architect/security/devil each >= 1.
 * Disagreement never overrides those vetoes; incomplete output has no verdict.
 */
export async function runMultiPersonaDebate(
  planContent: string,
  client?: DebateJudgeClient,
  options?: { model?: string }
): Promise<MultiPersonaDebateResult> {
  const targetModel = options?.model?.trim() || resolveDebateModel();
  const result: MultiPersonaDebateResult = {
    approved: false,
    status: "unavailable",
    advisoryOnly: true,
    modelTier: targetModel,
    requestedModel: targetModel,
    reasons: [],
    personas: { architect: {}, security: {}, performance: {}, ux: {}, devils_advocate: {} },
  };
  if (!planContent.trim()) {
    return { ...result, status: "insufficient", reasons: ["Plan evidence is empty."] };
  }
  // Preserve all source bytes. A large plan needs phase/advisor review, not truncation.
  if (Buffer.byteLength(planContent, "utf8") > 32_768) {
    return { ...result, status: "insufficient", reasons: ["Plan evidence exceeds the local request budget; review explicit phases with an Advisor without dropping whole-plan obligations."] };
  }
  const questions = constructMultiPersonaQuestions();
  // JSON protects the data boundary; it does not confer semantic injection immunity.
  const state = JSON.stringify({
    context: "Multi-Persona Pre-Analysis Debate (ck:predict)",
    source: { plan: planContent },
  });
  let response: DebateJudgeResponse;
  try {
    response = await (client ? client.evaluateDebate({ state, questions, model: targetModel }) : defaultDebateClient({ state, questions, model: targetModel }));
  } catch {
    return { ...result, errorCode: "client_failed", reasons: ["TypeSafe debate unavailable: judge client failed."] };
  }
  if (!response || typeof response !== "object") {
    return { ...result, errorCode: "bad_response", reasons: ["TypeSafe debate unavailable: no response."] };
  }
  result.metadata = response.metadata;
  const resolvedModel = response.metadata?.resolvedModel ?? response.modelUsed;
  if (typeof resolvedModel === "string" && resolvedModel.trim()) result.resolvedModel = resolvedModel;
  if (response.error || !response.answers || typeof response.answers !== "object") {
    return { ...result, errorCode: response.error ?? "bad_response", reasons: [`TypeSafe debate unavailable: ${response.error || "required persona scores are missing"}.`] };
  }
  for (const persona of PERSONAS) {
    const answer = response.answers[persona];
    if (!answer || typeof answer !== "object" || !("score" in answer)
      || typeof answer.score !== "number" || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > 3) {
      return { ...result, errorCode: "bad_response", reasons: [`TypeSafe debate unavailable: ${persona} requires a finite rubric score in [0, 3].`] };
    }
    result.personas[persona] = {
      score: answer.score,
      ...("verdict" in answer && typeof answer.verdict === "string" ? { verdict: answer.verdict } : {}),
    };
  }
  // All roles validated above; never round before the acceptance comparison.
  const consensusScore = PERSONAS.reduce((total, persona) => total + result.personas[persona].score!, 0) / PERSONAS.length;
  result.consensusScore = consensusScore;
  if (consensusScore < 1.5) result.reasons.push(`Multi-persona rubric mean (${consensusScore}) is below 1.5.`);
  for (const persona of ["architect", "security", "devils_advocate"] as const) {
    if (result.personas[persona].score! < 1) result.reasons.push(`${persona} veto: score below 1.`);
  }
  result.approved = result.reasons.length === 0;
  result.status = result.approved ? "approved" : "rejected";
  return result;
}
