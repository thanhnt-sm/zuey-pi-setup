import { createRequire } from "node:module";
import { egcRecord } from "./egc-native";
import { egcBoundaryCode, prepareEgcData } from "./egc-safety";

export interface EgcJudgeContext {
  judge?: (args: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
}
interface PolicyClient {
  resolveTrustedToolPolicy(purpose: "egc"): unknown;
  judgeWithPolicy(options: { args: unknown; purpose: "egc"; trustedPolicy: unknown; apiKey?: string; judgeFn?: EgcJudgeContext["judge"] }): Promise<unknown>;
}
export type EgcAssessment = { kind: "UNAVAILABLE"; code: string } | { kind: "ASSESSED"; probabilities: Record<string, number> };
/** The trusted purpose is closure-bound, never read from model state or questions. */
export function createEgcJudge(): (ctx: EgcJudgeContext, state: unknown, instructions: Record<string, string>) => Promise<EgcAssessment> {
  let client: PolicyClient | undefined, boundPolicy: unknown;
  try {
    const loaded = createRequire(import.meta.url)("./typesafe-policy-client.cjs") as PolicyClient;
    if (typeof loaded.resolveTrustedToolPolicy === "function" && typeof loaded.judgeWithPolicy === "function") {
      client = loaded; boundPolicy = client.resolveTrustedToolPolicy("egc");
    }
  } catch { /* Capability absence has no fallback approval or transport. */ }
  return async (ctx, state, instructions) => {
    try {
      if (!client || !boundPolicy) return { kind: "UNAVAILABLE", code: "policy_client_missing" };
      const apiKey = process.env.TYPESAFE_API_KEY?.trim();
      if (!apiKey && typeof ctx.judge !== "function") return { kind: "UNAVAILABLE", code: "egc_judge_unavailable" };
      // Validate unknown input before enumerating it or building question maps.
      const validated = egcRecord(prepareEgcData({ state, questions: instructions })), cleanInstructions = egcRecord(validated.questions);
      const limit = egcRecord(boundPolicy).maxQuestionsPerRequest, count = Object.keys(cleanInstructions).length;
      if (typeof limit !== "number" || count < 1) return { kind: "UNAVAILABLE", code: "egc_invalid_question" };
      if (count > limit) return { kind: "UNAVAILABLE", code: "question_limit_exceeded" };
      const questions: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const [id, text] of Object.entries(cleanInstructions)) {
        if (typeof text !== "string") return { kind: "UNAVAILABLE", code: "egc_invalid_question" };
        questions[id] = { type: "noul", instructions: text, criteria: { true: "Yes, clearly.", false: "No, or unclear." } };
      }
      const args = prepareEgcData({ state: validated.state, questions });
      const raw = await client.judgeWithPolicy({ args, trustedPolicy: boundPolicy, purpose: "egc", apiKey,
        ...(!apiKey && ctx.judge ? { judgeFn: ctx.judge.bind(ctx) } : {}) });
      const result = egcRecord(raw), answers = egcRecord(result.answers);
      if (result.ok !== true) {
        if (result.code === "payload too large") return { kind: "UNAVAILABLE", code: "payload_too_large" };
        const knownCodes: Record<string, true> = { policy_invalid: true, policy_client_missing: true, question_limit_exceeded: true, payload_too_large: true, input_invalid: true, question_identity_changed: true, model_not_allowed: true };
        return { kind: "UNAVAILABLE", code: typeof result.code === "string" && knownCodes[result.code] ? result.code : "egc_judge_unavailable" };
      }
      const probabilities: Record<string, number> = Object.create(null) as Record<string, number>;
      for (const id of Object.keys(questions)) {
        const probability = egcRecord(answers[id]).noul;
        if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) return { kind: "UNAVAILABLE", code: "egc_missing_noul" };
        probabilities[id] = probability;
      }
      return { kind: "ASSESSED", probabilities };
    } catch (error) { return { kind: "UNAVAILABLE", code: egcBoundaryCode(error) }; }
  };
}
