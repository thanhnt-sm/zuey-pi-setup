/** Pinned omp/18.12.3 task/structured-subagent.ts + subagent-user-prompt.md.
 * The SDK's prompt.render uses noEscape and post-format trims the template's final LF.
 * Host preparation serializes the public assignment as one JSON line; no general template emulation.
 */
export function nativeAdvisorPrompt(publicAssignment: string): string {
  if (!publicAssignment || publicAssignment !== publicAssignment.trim() || /[\r\n]/.test(publicAssignment)) throw new Error("advisor_single_line_public_assignment_required");
  return `Complete assignment thoroughly:\n\n${publicAssignment}`;
}
export const ADVISOR_NATIVE_CONTEXT = "Independent host-bound read-only review. Only the public task assignment and exact-SHA guarded source manifest are authorized; no ambient context, mutation, or authority reuse.";
export const ADVISOR_SOLUTION_SPACE = "Independently assess original obligations using public packets and guarded exact-SHA source reads; no mutation or authority reuse.";
