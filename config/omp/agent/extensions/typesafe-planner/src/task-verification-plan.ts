import path from "node:path";
import { canonicalDigest } from "./task-contract-source";
import type { FrozenContractSourceContext } from "./contract-runtime";
import type { AdvisorHostReview } from "./advisor-host";
import { validateAdvisorReceipt } from "./advisor-protocol";

export type ApprovedPlanPhaseSource = NonNullable<FrozenContractSourceContext["parentSource"]>;
/** A real approved source contract; deliberately contains no native todo target/permission. */
export function planPhaseReviewDigest(source: ApprovedPlanPhaseSource): string {
  return canonicalDigest({ kind: "approved_plan_phase", source });
}
export function samePlanPath(cwd: string, expected: string, proposed: string): boolean {
  const left = path.resolve(cwd, expected).replace(/\\/g, "/");
  const right = path.resolve(cwd, proposed).replace(/\\/g, "/");
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
export function usablePlanPhaseReview(review: AdvisorHostReview, source: ApprovedPlanPhaseSource): boolean {
  const request = review.request;
  const ids = source.criteria.map(criterion => criterion.id);
  return request.binding.purpose === "consultation" && request.snapshot.contractDigest === planPhaseReviewDigest(source) &&
    review.receipt.authority === "none" && review.receipt.assessment.verdict === "proceed" &&
    canonicalDigest([...request.criterionIds].sort()) === canonicalDigest([...ids].sort()) &&
    review.receipt.assessment.criterionCoverage.length === ids.length && review.receipt.assessment.criterionCoverage.every(criterion => ids.includes(criterion.criterionId) && criterion.status === "covered") &&
    validateAdvisorReceipt(review.receipt, { binding: request.binding, snapshot: request.snapshot, criterionIds: ids, request }).valid;
}
