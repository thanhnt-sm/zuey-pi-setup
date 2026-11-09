import { createRequire } from "node:module";
import type { TypeSafeAttemptReceipt } from "./payload-safety";

export type SemanticPurpose = "expert" | "advisory" | "native_done" | "native_drop" | "decision";
export interface SemanticQuestion {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria?: string[] | Record<string, string>;
}
export interface SemanticTransportMetadata {
  readonly [key: string]: unknown;
  policyIdentity: string;
  purpose: string;
  maxQuestionsPerRequest: number;
  questionIds: readonly string[];
  questionCount: number;
  bodyBytes: number;
  attempts: number;
  resolvedModel?: string;
  usage?: unknown;
  bodyDigest?: string;
  attemptReceipts?: readonly TypeSafeAttemptReceipt[];
}
export interface SemanticResponse {
  answers?: Record<string, unknown>;
  metadata?: SemanticTransportMetadata;
  error?: string;
}
interface PolicyClient {
  resolveTrustedToolPolicy(purpose: SemanticPurpose, trustedPolicy?: unknown): unknown;
  judgeWithPolicy(options: {
    args: { state: string | Record<string, unknown>; questions: Record<string, SemanticQuestion> };
    trustedPolicy: unknown;
    purpose: SemanticPurpose;
    apiKey: string;
    fetchImpl: typeof fetch;
    signal?: AbortSignal;
  }): Promise<
    | { ok: true; answers: Record<string, unknown>; metadata: SemanticTransportMetadata }
    | { ok: false; code: string; metadata?: SemanticTransportMetadata }
  >;
}

/** Bind a host-selected purpose/policy once; model state cannot override either. */
export function createSemanticJudgeClient(options: {
  purpose: SemanticPurpose;
  trustedPolicy?: unknown;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): { evaluate(params: { state: string | Record<string, unknown>; questions: Record<string, SemanticQuestion> }): Promise<SemanticResponse> } {
  let transport: PolicyClient | undefined;
  let policy: unknown;
  try {
    transport = createRequire(import.meta.url)("./typesafe-policy-client.cjs") as PolicyClient;
    policy = transport.resolveTrustedToolPolicy(options.purpose, options.trustedPolicy);
  } catch { /* Evaluation reports the unavailable prerequisite without inventing answers. */ }
  return {
    async evaluate(params) {
      const apiKey = process.env.TYPESAFE_API_KEY?.trim();
      if (!apiKey) return { error: "credential_unavailable" };
      if (!transport) return { error: "policy_client_unavailable" };
      try {
        const result = await transport.judgeWithPolicy({
          args: params, trustedPolicy: policy, purpose: options.purpose, apiKey,
          fetchImpl: options.fetchImpl ?? globalThis.fetch, signal: options.signal,
        });
        return result.ok
          ? { answers: result.answers, metadata: result.metadata }
          : { error: result.code, metadata: result.metadata };
      } catch {
        return { error: "transport_unavailable" };
      }
    },
  };
}

export function finiteNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

/** Only the real provider Noul is probability; categorical confidence never substitutes. */
export function noulValue(answer: unknown): number | undefined {
  if (!answer || typeof answer !== "object" || !("noul" in answer)) return undefined;
  return finiteNumber(answer.noul, 0, 1) ? answer.noul : undefined;
}

export function choiceValue<T extends string>(answer: unknown, allowed: readonly T[]): T | undefined {
  if (!answer || typeof answer !== "object" || !("choice" in answer)) return undefined;
  if ("confidence" in answer && !finiteNumber(answer.confidence, 0, 1)) return undefined;
  return typeof answer.choice === "string" && allowed.includes(answer.choice as T) ? answer.choice as T : undefined;
}

export function choiceConfidence(answer: unknown): number | undefined {
  return answer && typeof answer === "object" && "confidence" in answer && finiteNumber(answer.confidence, 0, 1)
    ? answer.confidence : undefined;
}

export function scoreValue(answer: unknown, maximum: number): number | undefined {
  return answer && typeof answer === "object" && "score" in answer && finiteNumber(answer.score, 0, maximum)
    ? answer.score : undefined;
}
