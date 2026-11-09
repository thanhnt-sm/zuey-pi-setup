import { canonicalDigest, isDigest } from "./task-contract-source";
import type { DeterministicCheck } from "./atomic-judge";

export interface DeterministicCheckOutcome { id: string; criterionId: string; passed: boolean }
/** Exact arithmetic/identity belongs to host code, never probabilistic judgments. */
export function runAtomicDeterministicChecks(checks: readonly DeterministicCheck[]): DeterministicCheckOutcome[] {
  return checks.map(check => ({ id: check.id, criterionId: check.criterionId,
    passed: check.kind === "digest" ? isDigest(check.actual) && isDigest(check.expected) && check.actual === check.expected
      : check.kind === "exit_status" ? Number.isInteger(check.actual) && check.actual === check.expected
        : canonicalDigest(check.actual) === canonicalDigest(check.expected) }));
}
