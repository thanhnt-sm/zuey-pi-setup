export interface SemanticApprovalPolicy {
  readonly threshold: number;
  readonly comparator: "gt" | "gte";
}
export interface SemanticApprovalOptions { readonly approvalPolicy: SemanticApprovalPolicy }
const issued = new WeakSet<object>();

/** Preserve the existing configured scale/clamp and exact default-boundary comparator. */
export function createSemanticApprovalPolicy(trustedEnv: Readonly<Record<string, string | undefined>>): SemanticApprovalPolicy {
  const raw = trustedEnv.TYPESAFE_AUTO_APPROVAL_THRESHOLD;
  const parsed = raw && raw.trim() !== "" ? Number(raw.trim()) : Number.NaN;
  const normalized = Number.isFinite(parsed) ? parsed > 1 ? parsed / 100 : parsed : 0.50;
  const threshold = Math.min(Math.max(normalized, 0), 1);
  const policy: SemanticApprovalPolicy = Object.freeze({ threshold, comparator: threshold === 0.50 ? "gt" : "gte" });
  issued.add(policy);
  return policy;
}

export function assertSemanticApprovalPolicy(policy: SemanticApprovalPolicy): void {
  if (!issued.has(policy)) throw new Error("semantic_approval_policy_not_factory_owned");
}

export function isSemanticApprovalPolicy(value: unknown): value is SemanticApprovalPolicy {
  return value !== null && typeof value === "object" && issued.has(value);
}

/** Parse policy data only; callers still authenticate its frozen protocol and current Root binding. */
export function parseSemanticApprovalPolicySnapshot(value: unknown): SemanticApprovalPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("threshold" in value) || !("comparator" in value)) return undefined;
  const threshold = value.threshold;
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1 || value.comparator !== (threshold === 0.50 ? "gt" : "gte")) return undefined;
  return createSemanticApprovalPolicy({ TYPESAFE_AUTO_APPROVAL_THRESHOLD: String(threshold) });
}

export function passesSemanticApproval(probability: unknown, policy: SemanticApprovalPolicy): boolean {
  assertSemanticApprovalPolicy(policy);
  return typeof probability === "number" && Number.isFinite(probability) && probability >= 0 && probability <= 1
    && (policy.comparator === "gt" ? probability > policy.threshold : probability >= policy.threshold);
}

/** Standalone library defaults are captured once, not reread during a review or arbitration. */
export const DEFAULT_SEMANTIC_APPROVAL_POLICY = createSemanticApprovalPolicy(process.env);
export const DEFAULT_SEMANTIC_APPROVAL_OPTIONS: SemanticApprovalOptions = Object.freeze({ approvalPolicy: DEFAULT_SEMANTIC_APPROVAL_POLICY });
