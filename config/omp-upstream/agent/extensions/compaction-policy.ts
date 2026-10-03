/**
 * Compact at a share of the model's own context window: 40% when the window holds 500K tokens or
 * more, 75% below that.
 *
 * Pi's own trigger is `contextTokens > contextWindow - reserveTokens` with a single global
 * reserve, so one number cannot mean 40% of a million-token window and 75% of a 128K one: a reserve
 * large enough for the first would make a small model compact on its first turn, and a reserve
 * small enough for the second lets a large window run to the ceiling. This extension reads the same
 * estimate and the same window the built-in check reads, decides per model, and asks for the
 * compaction itself once the session is idle.
 *
 * The built-in trigger stays enabled and acts as the backstop: with its default 16 384 reserve it
 * fires close to the ceiling, which is the case this policy has already handled by then - unless
 * this extension failed, and then the backstop is exactly what should happen.
 *
 * The numbers are the owner's: 40% and 75%, with the split at 500K.
 *
 * A failed compaction is not retried on the next turn. The estimate is still above the share after a
 * failure, so the same request would be sent again immediately, and a failure the summarizer caused
 * - a length stop, an oversized provider error - needs a change this policy cannot make: a larger
 * `compaction.reserveTokens`, or a different model. The policy therefore stays quiet for
 * FAILURE_BACKOFF_MS after a failure and says so once, instead of buying the same error every turn.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Windows at or above this many tokens use LARGE_WINDOW_SHARE. */
const LARGE_WINDOW_TOKENS = 500_000;
const LARGE_WINDOW_SHARE = 0.4;
const SMALL_WINDOW_SHARE = 0.75;

/**
 * At most one request a minute. A compaction that does not bring the estimate under the share - a
 * session whose system prompt or recent turns alone exceed it - would otherwise ask again on every
 * turn.
 */
const MIN_REQUEST_INTERVAL_MS = 60_000;

/**
 * How long the policy stays quiet after a compaction failed for a non-abort reason. Long enough that
 * a failed state is not re-purchased on every turn, short enough that a fix applied in the settings
 * file - a raised reserveTokens - takes effect within a session.
 */
const FAILURE_BACKOFF_MS = 10 * 60_000;

/** The share of the context window at which this policy compacts. */
export function compactionShare(contextWindow: number): number {
	return contextWindow >= LARGE_WINDOW_TOKENS ? LARGE_WINDOW_SHARE : SMALL_WINDOW_SHARE;
}

/** Whether the estimate has reached the share that applies to this window. */
export function shouldCompactAtShare(
	tokens: number | null,
	contextWindow: number,
	hasRequestedRecently: boolean,
): boolean {
	if (tokens === null || contextWindow <= 0 || hasRequestedRecently) return false;
	return tokens >= contextWindow * compactionShare(contextWindow);
}

export default function (pi: ExtensionAPI) {
	let lastRequestAt = 0;
	/** No request is made before this moment; set when the last compaction failed. */
	let failedUntil = 0;
	let failureNotified = false;

	/*
	 * A failed compaction leaves the estimate above the share, so without this the policy would ask
	 * again on the next turn and buy the same failure. An abort is not a summarizer failure: the user
	 * cancelled, and the estimate still needs the compaction, so it does not arm the backoff.
	 */
	pi.on("session_compact_failed", async (event, ctx) => {
		try {
			if (event.aborted) return;
			failedUntil = Date.now() + FAILURE_BACKOFF_MS;
			if (failureNotified || !ctx.hasUI) return;
			failureNotified = true;
			const detail = event.errorMessage ? `: ${event.errorMessage.slice(0, 200)}` : "";
			ctx.ui.notify(
				`Compaction failed${detail}. Pausing compaction requests for ${FAILURE_BACKOFF_MS / 60_000} minutes.`,
				"error",
			);
		} catch (error) {
			// The backoff may be lost if this context is stale; the interval above still throttles.
			console.error("[compaction-policy] could not record the compaction failure:", error);
		}
	});

	pi.on("session_compact", async () => {
		// A later compaction succeeded, so the failure was not a permanent property of the settings.
		failedUntil = 0;
		failureNotified = false;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		/*
		 * Nothing here may throw out of the handler.
		 *
		 * An extension's handler runs inside the agent process, and a stale context - the one captured when the session
		 * was replaced or reloaded - throws on first use. That throw reached the parent node's log and took the process
		 * with it: files failed with ECONNREFUSED because the node was gone, and the cause was three steps away from the
		 * symptom. Everything is caught, including the reads that come before the decision.
		 */
		try {
			const usage = ctx.getContextUsage();
			if (!usage) return;

			if (Date.now() < failedUntil) return;

			const recent = Date.now() - lastRequestAt < MIN_REQUEST_INTERVAL_MS;
			if (!shouldCompactAtShare(usage.tokens, usage.contextWindow, recent)) return;

			lastRequestAt = Date.now();
			const share = Math.round(compactionShare(usage.contextWindow) * 100);
			ctx.compact();
			if (ctx.hasUI) {
				ctx.ui.notify(`Compacting at ${usage.percent ?? "?"}% (policy: ${share}%)`, "info");
			}
		} catch (error) {
			// A request that throws is retried on a later turn; the built-in threshold is still armed.
			console.error("[compaction-policy] could not ask for compaction:", error);
		}
	});
}
