/**
 * Atomic TypeSafe Jev Judge Evaluator.
 * Evaluates incremental code diffs and test results at the micro/atomic level.
 * Guarantees "correct by construction from atomic parts" and auto-embeds Advisor
 * remediation descriptors upon any rejection.
 */

import { analyzeDiffForTestEvasion } from "./ast-analyzer";
import { touchesClaudeBoundary } from "./evidence-collector";
import { formatAdvisorAutoRemediation } from "./anti-blocking-guards";

export interface AtomicEvaluationInput {
  taskGoal: string;
  gitDiff: string;
  testExitCode: number | null;
  testOutput?: string;
  task?: string;
  phase?: string;
  changedFiles?: string[];
  testRequired?: boolean;
}

export interface AtomicEvaluationScores {
  integrity: boolean;
  drift: "no_drift" | "minor_drift" | "severe_drift";
  quality: number; // 0.0 to 3.0
}

export interface AtomicEvaluationResult {
  passed: boolean;
  verdict: "APPROVE" | "REJECT" | "NEXT_ACTION_REQUIRED";
  reasons: string[];
  scores: AtomicEvaluationScores;
  autoRemediation?: string;
}

export async function evaluateAtomicJevStep(input: AtomicEvaluationInput): Promise<AtomicEvaluationResult> {
  const reasons: string[] = [];
  let drift: "no_drift" | "minor_drift" | "severe_drift" = "no_drift";
  let integrity = true;
  let quality = 2.5;

  // 1. Boundary check (.claude or protected areas)
  const boundaryViolation = touchesClaudeBoundary("", input.gitDiff, input.changedFiles);
  if (boundaryViolation) {
    reasons.push("Claude boundary violation: diff touches protected .claude directory or configuration.");
    drift = "severe_drift";
    integrity = false;
    quality = 0.0;
  }

  // 2. Test evasion check
  const evasion = analyzeDiffForTestEvasion(input.gitDiff);
  if (evasion.testEvasion || evasion.deletedAssertions.length > 0) {
    reasons.push(...evasion.issues);
    integrity = false;
    drift = drift === "severe_drift" ? "severe_drift" : "minor_drift";
    quality = Math.max(0.5, quality - 1.5);
  }

  // 3. Test execution check
  const testRequired = input.testRequired !== false;
  let testPassed = false;
  if (!testRequired) {
    testPassed = input.testExitCode === null || input.testExitCode === 0;
  } else {
    testPassed = input.testExitCode === 0;
    if (input.testExitCode === null) {
      reasons.push("Test execution required but no test exit code was provided (testExitCode is null).");
      quality = Math.max(0.0, quality - 1.0);
    }
  }
  if (input.testExitCode !== null && input.testExitCode !== 0) {
    reasons.push(`Test suite failed with exit code ${input.testExitCode}. Test failure must be resolved.`);
    quality = Math.max(0.0, quality - 1.0);
  }

  const passed = reasons.length === 0 && integrity && testPassed && drift === "no_drift";
  const verdict: "APPROVE" | "REJECT" | "NEXT_ACTION_REQUIRED" = passed
    ? "APPROVE"
    : (boundaryViolation || !testPassed || !integrity)
      ? "REJECT"
      : "NEXT_ACTION_REQUIRED";

  const targetTask = input.task || input.taskGoal;
  const autoRemediation = !passed
    ? formatAdvisorAutoRemediation(targetTask, input.phase, reasons)
    : undefined;

  return {
    passed,
    verdict,
    reasons,
    scores: {
      integrity,
      drift,
      quality: passed ? Math.max(2.0, quality) : quality,
    },
    autoRemediation,
  };
}
