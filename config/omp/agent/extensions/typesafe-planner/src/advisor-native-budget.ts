import { createRequire } from "node:module";
import type { AdvisorRequest } from "./advisor-protocol";
import type { TrustedToolPolicy, ResolvedToolPolicy } from "./payload-safety";
interface Job { signal: AbortSignal; admitPacket(id: string): { ok: boolean; code?: string }; beforeDispatch(): { ok: boolean; code?: string }; markCovered(id: string): void }
interface Scheduler { run(manifest: { id: string; criteria: readonly string[] }[], worker: (job: Job) => Promise<{ ok: boolean }>, options: { signal: AbortSignal }): Promise<{ ok: boolean; code?: string }> }
interface SharedPolicyClient {
  resolveTrustedToolPolicy(purpose: "advisor", supplied?: TrustedToolPolicy | ResolvedToolPolicy): ResolvedToolPolicy;
  createSemanticReviewScheduler(policy: ResolvedToolPolicy): Scheduler;
}
export type AdvisorNativeBudgetResult = { ok: true; result: unknown; started: true } | { ok: false; code: string; started: boolean; result?: unknown };
export interface AdvisorNativeBudget {
  run(request: AdvisorRequest, deadline: number | undefined, signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<unknown>): Promise<AdvisorNativeBudgetResult>;
  beforeProvider(requestId: string): { ok: boolean; code?: string };
  cancel(reason: string): void;
}
/** Reuses the canonical trusted scheduler; this module never sends HTTP or selects a native model. */
export function createAdvisorNativeBudget(supplied?: TrustedToolPolicy | ResolvedToolPolicy, injectedClient?: SharedPolicyClient): AdvisorNativeBudget {
  const client = injectedClient ?? (createRequire(import.meta.url)("./typesafe-policy-client.cjs") as SharedPolicyClient);
  const policy = client.resolveTrustedToolPolicy("advisor", supplied);
  const scheduler = policy.ok ? client.createSemanticReviewScheduler(policy) : undefined;
  const jobs = new Map<string, Job>(); const controllers = new Set<AbortController>();
  return {
    async run(request, deadline, signal, operation) {
      if (!policy.ok || !scheduler) return { ok: false, code: "advisor_trusted_review_policy_required", started: false };
      if (deadline !== undefined && (!Number.isSafeInteger(deadline) || deadline <= Date.now())) return { ok: false, code: "advisor_review_deadline_elapsed_or_invalid", started: false };
      const controller = new AbortController(); controllers.add(controller);
      const abort = () => controller.abort(signal?.reason);
      if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
      const remaining = Math.min(policy.semanticReviewLimits.deadlineMs, deadline === undefined ? policy.semanticReviewLimits.deadlineMs : deadline - Date.now());
      const timer = setTimeout(() => controller.abort(new Error("advisor_review_deadline")), Math.max(1, remaining));
      const observed: { promise?: Promise<unknown>; result?: unknown; started: boolean } = { started: false };
      try {
        const result = await scheduler.run([{ id: request.requestId, criteria: request.criterionIds }], async job => {
          if (!job.admitPacket(request.requestId).ok || job.signal.aborted) return { ok: false };
          jobs.set(request.requestId, job); observed.started = true;
          observed.promise = operation(job.signal);
          try { observed.result = await observed.promise; job.markCovered(request.requestId); return { ok: true }; }
          finally { jobs.delete(request.requestId); }
        }, { signal: controller.signal });
        // Only drain an already invoked, abort-signalled native operation. Never dispatch again.
        if (observed.promise) {
          let drainTimer: ReturnType<typeof setTimeout> | undefined;
          const drainMs = Math.max(1, Math.min(250, (deadline ?? Date.now() + 250) - Date.now()));
          const drainOutcome = await Promise.race([
            observed.promise.then(r => { observed.result = r; return "done" as const; }, () => "done" as const),
            new Promise<"timeout">(resolve => { drainTimer = setTimeout(() => resolve("timeout"), drainMs); }),
          ]);
          clearTimeout(drainTimer);
          if (drainOutcome === "timeout") return { ok: false, code: "advisor_native_drain_timeout", started: true };
        }
        return result.ok ? { ok: true, result: observed.result, started: true }
          : { ok: false, code: result.code ?? "advisor_native_review_unavailable", started: observed.started, ...(observed.started ? { result: observed.result } : {}) };
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); controllers.delete(controller); jobs.delete(request.requestId); }
    },
    beforeProvider(id) { const job = jobs.get(id); return job ? job.beforeDispatch() : { ok: false, code: "advisor_current_trusted_review_job_required" }; },
    cancel(reason) { for (const controller of controllers) controller.abort(new Error(reason)); },
  };
}
