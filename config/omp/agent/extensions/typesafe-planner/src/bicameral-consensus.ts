import type {
  DropCheckContext,
  MacroCheckContext,
  MacroCheckResult as PhaseMacroCheckResult,
  ExpertJudgeClient,
  ExpertJudgeQuestion,
} from "./cook-expert-judge";
import {
  runDropJustificationCheck,
  runPhaseMacroCheck,
} from "./cook-expert-judge";
import { validateAdvisorReceipt, type AdvisorReceipt, type ReviewSnapshot } from "./advisor-protocol";
import { canonicalDigest, freezeContractValue } from "./task-contract-source";
import type { ReviewBinding, VerificationOutcome } from "./types/verification";
import { createSemanticJudgeClient, noulValue, scoreValue, choiceValue, type SemanticTransportMetadata } from "./semantic-judge-client";
import { DEFAULT_SEMANTIC_APPROVAL_OPTIONS, passesSemanticApproval, type SemanticApprovalOptions } from "./semantic-approval-policy";

export type AdvisorIntentVerdict = "ALLOW" | "DISALLOW" | "UNCERTAIN";
export type CkAdvisorVerdict = "proceed" | "revise" | "block";
export type AdvisorDecisionKind =
  | "approach"
  | "plan-review"
  | "phase-risk"
  | "stuck"
  | "pre-merge"
  | "general";

export interface AdvisorOptionCandidate {
  label: string;
  description?: string;
  preview?: string;
  recommended?: boolean;
}

export interface RankedAdvisorOption {
  option: string;
  score: number;
  rationale: string;
}

export interface AdvisorFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  claim: string;
  evidence?: string;
}

export interface AdvisorContext {
  operation: "done" | "drop" | "mutate" | "decision" | "ask";
  task: string | string[];
  decisionKind?: AdvisorDecisionKind;
  question?: string;
  options?: Array<string | AdvisorOptionCandidate>;
  recommendedIndex?: number;
  constraints?: string | string[];
  evidencePaths?: string[];
  userRequest?: string;
  agentWorkLog?: string;
  reason?: string;
  conversationHistory?: string;
  hasCleanBuildEvidence?: boolean;
  testSummary?: string;
  diffSummary?: string;
  deliverableArtifacts?: string;
  taskType?: "code_change" | "analysis_research" | "doc_specification";
}

export interface AdvisorIntentResult {
  verdict: AdvisorIntentVerdict;
  ckVerdict?: CkAdvisorVerdict;
  confidence: number;
  reason: string;
  recommendation?: string;
  recommendedOption?: string;
  recommendedIndex?: number;
  rankedOptions?: RankedAdvisorOption[];
  findings?: AdvisorFinding[];
  openQuestions?: string[];
  userIntentDetected?: boolean;
  authority?: "none";
  source?: "heuristic";
}

export type JevConsensusVerdict =
  | "APPROVE"
  | "REJECT"
  | "NEXT_ACTION_REQUIRED"
  | "ESCALATE"
  | "UNAVAILABLE";

export interface JevResult {
  verdict: JevConsensusVerdict;
  confidence?: number;
  reasons: string[];
  probability?: number;
  outcome?: VerificationOutcome;
  metadata?: SemanticTransportMetadata;
}

export type ConsensusVerdict =
  | "AUTO_APPROVE"
  | "AUTO_REJECT"
  | "HUMAN_ESCALATION"
  | "RECONCILE_PLAN";

export interface BicameralConsensusDecision {
  verdict: ConsensusVerdict;
  advisor: AdvisorIntentResult;
  jev: JevResult;
  reasons: string[];
  escalationMessage?: string;
  reconciliationDirectives?: string[];
  /** Sole native staging decision; legacy verdict labels are presentation only. */
  disposition: VerificationOutcome;
  reasoning?: AdvisorReceipt;
}

const CANCELLATION_PATTERNS = [
  /\b(?:cancel|cancelled|cancelling)\b/i,
  /\b(?:drop|dropped|dropping)\b/i,
  /\b(?:skip|skipped|skipping)\b/i,
  /\b(?:remove|removed|removing|delete|deleted)\b/i,
  /\b(?:omit|omitted|ignore|ignored)\b/i,
  /\b(?:deprecate|deprecated|supersede|superseded)\b/i,
  /\b(?:don't need|no longer need|not needed|not required)\b/i,
  /\b(?:bỏ qua|hủy|không cần|xóa)\b/i,
];

const CLEAN_BUILD_PATTERNS = [
  /\bclean build\b/i,
  /\bbuilt successfully\b/i,
  /\bbuild succeeded\b/i,
  /\bzero errors\b/i,
  /\bno errors\b/i,
  /\b0 errors\b/i,
  /\bmsbuild success\b/i,
  /\ball tests pass\b/i,
  /\btests pass\b/i,
  /\b100% pass\b/i,
];

const UNSAFE_DECISION_PATTERNS = [
  /\.omp[\/\\]agent[\/\\]extensions[\/\\]typesafe-planner\.ts/i,
  /~\s*[\/\\]\.claude[\/\\]/i,
  /\b(?:rm\s+-rf\s+\/|drop\s+database|skip\s+all\s+tests|disable\s+verification\s+gate)\b/i,
];

const STOPWORDS: Record<string, true> = {
  with: true, from: true, that: true, this: true, have: true, been: true,
  will: true, should: true, would: true, could: true, into: true, your: true,
  their: true, please: true, task: true, step: true, phase: true, item: true,
  toolcall: true, toolresult: true, reading: true, searching: true, listing: true, running: true,
};

function extractContentTokens(text: string): string[] {
  if (!text) return [];
  const stripped = text
    .replace(/\[toolCall:[^\]]*\]/gi, " ")
    .replace(/\[toolResult:[^\]]*\]:?/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u1EF9\s]/gi, " ");
  const seen = new Set<string>();
  for (const w of stripped.split(/\s+/)) {
    if (w.length > 3 && !STOPWORDS[w]) seen.add(w);
  }
  return Array.from(seen);
}

function computeTokenOverlap(source: string, target: string): number {
  const srcTokens = extractContentTokens(source);
  if (srcTokens.length === 0) return 0;
  const targetLower = (target || "").toLowerCase();
  let matched = 0;
  for (const tok of srcTokens) {
    if (targetLower.includes(tok)) matched++;
  }
  return matched / srcTokens.length;
}

function hasExplicitTestFailure(text?: string): boolean {
  if (!text || !text.trim()) return false;
  const hasFailSignal =
    /\bexit\s+[1-9]\d*\b/i.test(text) ||
    /\b[1-9]\d*\s+fail(?:ed|ures?)?\b/i.test(text) ||
    /(?:^|\n)\s*FAIL\s+\S+/m.test(text) ||
    /\bAssertionError\b/i.test(text);
  if (!hasFailSignal) return false;
  const tail = text.slice(-400);
  const recoveredInTail =
    /\bexit\s+0\b/i.test(tail) && /\b0\s+fail(?:ed|ures?)?\b/i.test(tail);
  return !recoveredInTail;
}

function normalizeOptions(
  options?: Array<string | AdvisorOptionCandidate>,
  recommendedIndex?: number
): AdvisorOptionCandidate[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((item, idx) => {
      if (typeof item === "string") {
        return {
          label: item.trim(),
          recommended: recommendedIndex === idx || /\(recommended\)/i.test(item),
        };
      }
      if (item && typeof item === "object" && typeof item.label === "string") {
        return {
          label: item.label.trim(),
          description: typeof item.description === "string" ? item.description.trim() : undefined,
          preview: typeof item.preview === "string" ? item.preview.trim() : undefined,
          recommended:
            item.recommended === true ||
            recommendedIndex === idx ||
            /\(recommended\)/i.test(item.label),
        };
      }
      return { label: "" };
    })
    .filter((o) => o.label.length > 0);
}

function evaluateAdvisorDecision(ctx: AdvisorContext): AdvisorIntentResult {
  const userReq = (ctx.userRequest || "").trim();
  const workLog = (ctx.agentWorkLog || "").trim();
  const taskText = Array.isArray(ctx.task) ? ctx.task.join(", ") : (ctx.task || "");
  const questionText = (ctx.question || taskText || "").trim();
  const constraintsText = Array.isArray(ctx.constraints)
    ? ctx.constraints.join("\n")
    : (ctx.constraints || "");
  const combinedContext = `${userReq}\n${workLog}\n${ctx.reason || ""}\n${ctx.conversationHistory || ""}\n${constraintsText}`;
  const normalizedOptions = normalizeOptions(ctx.options, ctx.recommendedIndex);
  const findings: AdvisorFinding[] = [];

  if (normalizedOptions.length > 0) {
    const userReqLower = userReq.toLowerCase();
    const workLogLower = `${workLog}\n${ctx.reason || ""}\n${ctx.conversationHistory || ""}`.toLowerCase();
    const scored = normalizedOptions.map((opt, idx) => {
      let score = 0.50;
      const rationales: string[] = [];
      const optFullText = `${opt.label} ${opt.description || ""} ${opt.preview || ""}`;

      if (UNSAFE_DECISION_PATTERNS.some((p) => p.test(optFullText))) {
        score -= 0.40;
        rationales.push("Violates workspace safety or isolation constraints");
        findings.push({
          severity: "high",
          claim: `Option "${opt.label}" touches protected boundaries or unsafe operations`,
        });
      }

      if (opt.recommended) {
        score += 0.21;
        rationales.push("Marked as recommended default");
      }

      const userOverlap = userReqLower.length > 0 ? computeTokenOverlap(optFullText, userReqLower) : 0;
      if (userOverlap > 0) {
        score += 0.12 + 0.16 * userOverlap;
        rationales.push("Directly aligns with user request");
      }

      const workOverlap = workLogLower.length > 0 ? computeTokenOverlap(optFullText, workLogLower) : 0;
      if (workOverlap > 0) {
        score += 0.08 + 0.11 * workOverlap;
        rationales.push("Supported by codebase and work-log evidence");
      }

      const safeMatches = optFullText.match(
        /\b(?:autonomous|auto|standard|safe|test|verify|root\s*cause|bicameral|consensus|preserve|non-blocking|incremental|recommended)\b/gi
      );
      if (safeMatches && safeMatches.length > 0) {
        score += Math.min(0.14, 0.05 + safeMatches.length * 0.03);
        rationales.push("Follows safe, maintainable engineering practice");
      }

      if (/\b(?:skip\s*test\w*|bypass\w*|force\s*delete|ignore\s*error\w*|hardcod\w*|threshold\s+wall\w*|do\s+nothing)\b/i.test(optFullText)) {
        score -= 0.25;
        rationales.push("Introduces avoidable verification or maintenance risk");
      }

      const clampedScore = Math.max(0.05, Math.min(0.98, Number(score.toFixed(2))));
      return {
        option: opt.label,
        originalIndex: idx,
        score: clampedScore,
        rationale:
          rationales.length > 0
            ? rationales.join("; ")
            : idx === 0
            ? "Primary conservative candidate option"
            : "Alternative candidate option",
      };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.originalIndex - b.originalIndex;
    });

    const top = scored[0];
    const second = scored[1];
    const rankedOptions: RankedAdvisorOption[] = scored.map((s) => ({
      option: s.option,
      score: s.score,
      rationale: s.rationale,
    }));

    if (top.score < 0.30) {
      const blockConf = Number(Math.min(0.96, Math.max(0.78, 1 - top.score)).toFixed(2));
      return {
        verdict: "DISALLOW",
        ckVerdict: "block",
        confidence: blockConf,
        reason: `All candidate options violate constraints (${top.rationale})`,
        recommendation: `Reject unsafe options and revise approach to respect workspace constraints.`,
        rankedOptions,
        findings,
        userIntentDetected: userReq.length > 0,
      };
    }

    const hasDifferentiation =
      normalizedOptions.length === 1 ||
      top.score > 0.50 ||
      (second !== undefined && top.score > second.score);

    if (hasDifferentiation) {
      const margin = second !== undefined ? Math.max(0, top.score - second.score) : 0.20;
      const calibratedConf = Number(
        Math.min(0.98, Math.max(0.75, top.score * 0.88 + margin * 0.25)).toFixed(2)
      );
      return {
        verdict: "ALLOW",
        ckVerdict: "proceed",
        confidence: calibratedConf,
        reason: `Advisor recommends "${top.option}" (${top.rationale})`,
        recommendation: `Select "${top.option}" — ${top.rationale}.`,
        recommendedOption: top.option,
        recommendedIndex: top.originalIndex,
        rankedOptions,
        findings,
        openQuestions: [],
        userIntentDetected: userReq.length > 0,
      };
    }

    return {
      verdict: "ALLOW",
      ckVerdict: "proceed",
      confidence: 0.68,
      reason: `Advisor defaults to conservative first option "${top.option}" (${top.rationale})`,
      recommendation: `Select "${top.option}" (${top.rationale}).`,
      recommendedOption: top.option,
      recommendedIndex: top.originalIndex,
      rankedOptions,
      findings,
      openQuestions: [],
      userIntentDetected: userReq.length > 0,
    };
  }

  // Open-ended decision / consultation without explicit option array
  if (UNSAFE_DECISION_PATTERNS.some((p) => p.test(`${questionText}\n${combinedContext}`))) {
    findings.push({
      severity: "critical",
      claim: "Proposal references protected global extension or unsafe command",
    });
    return {
      verdict: "DISALLOW",
      ckVerdict: "block",
      confidence: 0.93,
      reason: "Proposed action violates workspace safety or isolation invariants",
      recommendation: "Block the unsafe mutation and restrict changes to the local development workspace.",
      findings,
      openQuestions: [],
      userIntentDetected: userReq.length > 0,
    };
  }

  if (questionText.length > 0 || userReq.length > 0 || workLog.length > 0) {
    const kind = ctx.decisionKind || "general";
    let recommendation: string;
    if (kind === "plan-review") {
      recommendation =
        "Proceed with the plan; ensure each phase has concrete file ownership and deterministic test verification.";
    } else if (kind === "phase-risk" || kind === "pre-merge") {
      recommendation =
        "Proceed with execution while enforcing regression test suites and workspace boundary guards.";
    } else if (kind === "stuck") {
      recommendation =
        "Trace the failing invariant from first-hand logs/tests, fix the root cause in-place, and verify before retrying task completion.";
    } else {
      recommendation =
        "Proceed with the conservative, evidence-backed implementation aligned with user intent and project conventions.";
    }

    const overlap = computeTokenOverlap(questionText || userReq, `${userReq}\n${workLog}`);
    const signalDensity = Math.min(1, (questionText.length + userReq.length + workLog.length) / 600);
    const calibratedConf = Number(
      Math.min(0.94, Math.max(0.76, 0.76 + overlap * 0.11 + signalDensity * 0.06)).toFixed(2)
    );

    return {
      verdict: "ALLOW",
      ckVerdict: "proceed",
      confidence: calibratedConf,
      reason: recommendation,
      recommendation,
      recommendedOption: "proceed",
      findings,
      openQuestions: [],
      userIntentDetected: userReq.length > 0,
    };
  }

  return {
    verdict: "UNCERTAIN",
    ckVerdict: "revise",
    confidence: 0.50,
    reason: "Insufficient context provided for advisor decision; provide question or candidate options",
    recommendation: "Supply explicit decision question, options, or evidence before proceeding.",
    findings,
    openQuestions: ["What are the specific candidate options and constraints for this decision?"],
    userIntentDetected: false,
  };
}

/**
 * Non-authoritative local intent signal. Heuristic confidence is not JEV probability or real Advisor provenance.
 */
function evaluateIntentHeuristic(ctx: AdvisorContext): AdvisorIntentResult {
  const userReq = (ctx.userRequest || "").trim();
  const workLog = (ctx.agentWorkLog || "").trim();
  const taskText = Array.isArray(ctx.task) ? ctx.task.join(", ") : (ctx.task || "");
  const combinedContext = `${userReq}\n${workLog}\n${ctx.reason || ""}\n${ctx.conversationHistory || ""}`;

  if (
    ctx.operation === "decision" ||
    ctx.operation === "ask" ||
    (Array.isArray(ctx.options) && ctx.options.length > 0)
  ) {
    return evaluateAdvisorDecision(ctx);
  }

  if (ctx.operation === "drop") {
    const taskOverlapWithReq = computeTokenOverlap(taskText, userReq);
    const userWantsCancel = userReq
      .split(/[.!?;\n]+/)
      .some((clause) => {
        // Negated cancellation never supplies permission, including "don't skip" and "not obsolete".
        if (/\b(?:do\s+not|don't|dont|must\s+not|never|not|cannot|can't)\s+(?:(?:ever|just|simply|currently)\s+)*(?:cancel|drop|skip|remove|delete|omit|ignore|deprecate|supersede|obsolete)\b/i.test(clause) || /\bkhông\s+(?:được\s+)?(?:hủy|bỏ qua|xóa)\b/i.test(clause)) return false;
        const clauseOverlap = computeTokenOverlap(taskText, clause);
        const cancellationTargetsTask =
          clauseOverlap > 0 ||
          /\b(?:this|current)\s+(?:task|todo|item|step)\b/i.test(clause);
        const explicitCancelVerb =
          /\b(?:cancel|cancelled|cancelling|drop|dropped|dropping|skip|skipped|skipping|omit|omitted|deprecate|deprecated|supersede|superseded|don't need|no longer need|not needed|not required|bỏ qua|hủy|không cần)\b/i.test(
            clause
          );
        const contextualRemoveVerb =
          /\b(?:remove|removed|removing|delete|deleted|ignore|ignored|xóa)\b/i.test(clause);
        return cancellationTargetsTask && (
          explicitCancelVerb ||
          contextualRemoveVerb ||
          CANCELLATION_PATTERNS.some((pattern) => pattern.test(clause))
        );
      });
    if (userWantsCancel) {
      const reason = "User explicitly authorized or requested dropping the task in context";
      const cancelConf = Number(
        Math.min(0.97, Math.max(0.87, 0.88 + taskOverlapWithReq * 0.08)).toFixed(2)
      );
      return {
        verdict: "ALLOW",
        ckVerdict: "proceed",
        confidence: cancelConf,
        reason,
        recommendation: reason,
        userIntentDetected: true,
      };
    }

    // 2. A task the user still explicitly requests cannot be made obsolete by
    // clean-build inference. Cancellation above is the only scoped override.
    if (userReq.length > 0) {
      const taskWords = extractContentTokens(taskText);
      const matchesUserRequest = taskWords.some((w) => userReq.toLowerCase().includes(w));
      if (matchesUserRequest) {
        const reason = "User requested task implementation and no valid cancellation was expressed";
        const disallowConf = Number(
          Math.min(0.94, Math.max(0.82, 0.82 + taskOverlapWithReq * 0.11)).toFixed(2)
        );
        return {
          verdict: "DISALLOW",
          ckVerdict: "block",
          confidence: disallowConf,
          reason,
          recommendation: reason,
          userIntentDetected: true,
        };
      }
    }

    // A clean build alone cannot prove that a task is obsolete or already satisfied.
    const hasBuildEvidence =
      ctx.hasCleanBuildEvidence === true ||
      CLEAN_BUILD_PATTERNS.some((p) => p.test(combinedContext));
    if (hasBuildEvidence) {
      const reason = "Clean build is only a local signal; task-scoped obsolescence or satisfaction evidence is still required";
      return {
        verdict: "UNCERTAIN", ckVerdict: "revise", confidence: 0.50,
        reason, recommendation: reason, userIntentDetected: false,
      };
    }

    // 4. Ambiguous intent
    const reason = "Ambiguous / uncertain user intent; task drop requires sovereign human confirmation";
    return {
      verdict: "UNCERTAIN",
      ckVerdict: "revise",
      confidence: 0.50,
      reason,
      recommendation: reason,
      userIntentDetected: false,
    };
  }

  if (ctx.operation === "done") {
    const combinedDoneEvidence = `${workLog}\n${ctx.reason || ""}\n${ctx.testSummary || ""}\n${ctx.diffSummary || ""}\n${ctx.deliverableArtifacts || ""}`;

    // 1. Negative evidence check -> First-class DISALLOW
    if (UNSAFE_DECISION_PATTERNS.some((p) => p.test(combinedDoneEvidence))) {
      const reason = "Task evidence touches protected boundaries or unsafe operations";
      return {
        verdict: "DISALLOW",
        ckVerdict: "block",
        confidence: 0.94,
        reason,
        recommendation: reason,
        userIntentDetected: userReq.length > 0,
      };
    }

    if (hasExplicitTestFailure(ctx.testSummary) || (!ctx.testSummary && hasExplicitTestFailure(workLog))) {
      const reason = "Test or build failure detected in verification evidence; resolve failing assertions before completing task";
      return {
        verdict: "DISALLOW",
        ckVerdict: "block",
        confidence: 0.89,
        reason,
        recommendation: reason,
        userIntentDetected: userReq.length > 0,
      };
    }

    const strippedWorkLog = workLog
      .replace(/\[toolCall:[^\]]*\]/gi, " ")
      .replace(/\[toolResult:[^\]]*\]:?/gi, " ")
      .trim();
    const taskOverlap = computeTokenOverlap(taskText, combinedDoneEvidence);
    const userOverlap = computeTokenOverlap(userReq, `${taskText}\n${combinedDoneEvidence}`);
    const hasPassingTest =
      ctx.hasCleanBuildEvidence === true ||
      CLEAN_BUILD_PATTERNS.some((p) => p.test(combinedDoneEvidence)) ||
      /\bexit\s+0\b|\b0\s+fail\b|\b\d+\s+pass(?:ing|ed)?\b/i.test(`${ctx.testSummary || ""}\n${workLog}`);
    const hasConcreteDiff =
      Boolean(
        ctx.diffSummary &&
          ctx.diffSummary !== "No unstaged changes observed" &&
          ctx.diffSummary.trim().length > 0
      );
    const hasArtifacts = Boolean(ctx.deliverableArtifacts && ctx.deliverableArtifacts.trim().length > 0);

    if (hasPassingTest) {
      const reason = "Verified test or build evidence confirms task completion";
      const conf = Number(
        Math.min(0.97, Math.max(0.86, 0.86 + taskOverlap * 0.06 + (hasConcreteDiff || hasArtifacts ? 0.03 : 0) + userOverlap * 0.02)).toFixed(2)
      );
      return {
        verdict: "ALLOW",
        ckVerdict: "proceed",
        confidence: conf,
        reason,
        recommendation: reason,
        userIntentDetected: userReq.length > 0,
      };
    }

    if (
      strippedWorkLog.length > 0 &&
      /\b(?:pass|passing|passed|implement\w*|added|completed|fixed|moved|organized|refactor\w*|verified|updated|tested|scout\w*|diagnos\w*|analy[sz]\w*|investigat\w*|identif\w*|found|trac\w*|review\w*|plan|planned|document\w*|sync\w*|deploy\w*|resolv\w*|root\s*cause|deliver\w*|wrote|creat\w*|built|\[Advisor\]:|hoàn thành|đã sửa|đã kiểm tra|thành công|đã xong|xác minh|báo cáo)\b/i.test(
        strippedWorkLog
      )
    ) {
      const reason = "Agent work log documents concrete implementation and verification evidence";
      const conf = Number(
        Math.min(0.96, Math.max(0.85, 0.85 + taskOverlap * 0.06 + (hasConcreteDiff || hasArtifacts ? 0.03 : 0) + userOverlap * 0.02)).toFixed(2)
      );
      return {
        verdict: "ALLOW",
        ckVerdict: "proceed",
        confidence: conf,
        reason,
        recommendation: reason,
        userIntentDetected: userReq.length > 0,
      };
    }

    if (hasConcreteDiff || hasArtifacts) {
      const reason = "Concrete deliverable artifacts or workspace changes observed for task completion";
      const conf = Number(
        Math.min(0.93, Math.max(0.83, 0.83 + taskOverlap * 0.07 + userOverlap * 0.03)).toFixed(2)
      );
      return {
        verdict: "ALLOW",
        ckVerdict: "proceed",
        confidence: conf,
        reason,
        recommendation: reason,
        userIntentDetected: userReq.length > 0,
      };
    }

    const isImplLead =
      /^\s*(?:(?:step|task|phase)\s*\d+\s*[:.-]\s*)?(?:implement\w*|fix\w*|build\w*|add\w*|create\s+src|refactor\w*|patch\w*|deploy\w*)\b/i.test(
        taskText
      );
    const isCognitiveTask =
      /\b(?:scout\w*|diagnos\w*|investigat\w*|research\w*|analy[sz]\w*|explor\w*|find|audit\w*|review\w*|check\w*|trac\w*|inspect\w*|read\w*|clarif\w*|brainstorm\w*|plan|planning|design\w*|synthesi[sz]\w*|consult\w*|evaluat\w*|assess\w*|document\w*|journal\w*|organi[sz]\w*|verif\w*|ask\w*|propos\w*|validat\w*|compar\w*|summariz\w*|kiểm tra|phân tích|tìm|nghiên cứu|lập kế hoạch)\b/i.test(
        taskText
      );
    if (ctx.taskType === "analysis_research" || (!isImplLead && isCognitiveTask)) {
      const reason = "Investigation or analysis task completed within active session context";
      const conf = Number(
        Math.min(0.93, Math.max(0.85, 0.85 + taskOverlap * 0.05 + userOverlap * 0.03)).toFixed(2)
      );
      return {
        verdict: "ALLOW",
        ckVerdict: "proceed",
        confidence: conf,
        reason,
        recommendation: reason,
        userIntentDetected: userReq.length > 0,
      };
    }

    const reason = "Agent work log is incomplete or unverified; deferring to JEV code diff analysis";
    return {
      verdict: "UNCERTAIN",
      ckVerdict: "revise",
      confidence: 0.58,
      reason,
      recommendation: reason,
      userIntentDetected: userReq.length > 0,
    };
  }

  if (ctx.operation === "mutate") {
    if (ctx.question || (Array.isArray(ctx.options) && ctx.options.length > 0)) {
      return evaluateAdvisorDecision(ctx);
    }
    if (workLog.length > 0 || userReq.length > 0 || (ctx.reason && ctx.reason.trim().length > 0)) {
      const reason = "Task state mutation aligns with active workflow context";
      const mutOverlap = computeTokenOverlap(taskText, combinedContext);
      const mutConf = Number(Math.min(0.91, Math.max(0.78, 0.78 + mutOverlap * 0.10)).toFixed(2));
      return {
        verdict: "ALLOW",
        ckVerdict: "proceed",
        confidence: mutConf,
        reason,
        recommendation: reason,
        userIntentDetected: userReq.length > 0,
      };
    }
  }

  return {
    verdict: "UNCERTAIN",
    ckVerdict: "revise",
    confidence: 0.50,
    reason: "Unrecognized mutation operation; defaulting to uncertain",
  };
}

export function evaluateAdvisorIntent(ctx: AdvisorContext): AdvisorIntentResult {
  return freezeContractValue({ ...evaluateIntentHeuristic(ctx), authority: "none", source: "heuristic" });
}

export interface ConsensusReasoningInput {
  receipt: AdvisorReceipt;
  binding: ReviewBinding;
  snapshot: ReviewSnapshot;
  criterionIds: readonly string[];
  requireParentIntegration?: boolean;
}

/** Preserve independent raw assessments; only real, exactly bound reasoning can authorize staging. */
export function arbitrateConsensus(
  advisor: AdvisorIntentResult,
  jev: JevResult,
  reasoning?: ConsensusReasoningInput,
  options: SemanticApprovalOptions = DEFAULT_SEMANTIC_APPROVAL_OPTIONS,
): BicameralConsensusDecision {
  const rawAdvisor = freezeContractValue(structuredClone(advisor));
  const rawJev = freezeContractValue(structuredClone(jev));
  const reasons = [...jev.reasons];
  let disposition: VerificationOutcome;
  let receipt: AdvisorReceipt | undefined;
  if (reasoning && validateAdvisorReceipt(reasoning.receipt, reasoning).valid) {
    receipt = freezeContractValue(structuredClone(reasoning.receipt));
  }
  const verdict = receipt?.assessment.verdict;
  const rawProbabilityValid = typeof jev.probability === "number" && Number.isFinite(jev.probability) && jev.probability >= 0 && jev.probability <= 1;
  const thresholdSatisfied = rawProbabilityValid && passesSemanticApproval(jev.probability!, options.approvalPolicy);
  const primitivesValid = ["APPROVE", "REJECT", "NEXT_ACTION_REQUIRED", "ESCALATE", "UNAVAILABLE"].includes(jev.verdict) &&
    (jev.confidence === undefined || (typeof jev.confidence === "number" && Number.isFinite(jev.confidence) && jev.confidence >= 0 && jev.confidence <= 1));
  if (jev.verdict === "UNAVAILABLE" || jev.outcome?.status === "UNAVAILABLE" || !rawProbabilityValid || !primitivesValid) {
    disposition = { status: "UNAVAILABLE", component: "semantic_judge", reasons: reasons.length ? reasons : ["Actual finite JEV probability and complete required answers are prerequisites."] };
  } else if (reasoning && !receipt) {
    disposition = { status: "EVIDENCE_REQUIRED", missingCriterionIds: [...reasoning.criterionIds], reasons: ["Real Advisor receipt is stale, invalid, or noncovering; obtain a fresh exact-binding review."] };
  } else if (verdict === "unavailable") {
    disposition = { status: "UNAVAILABLE", component: "advisor", reasons: [receipt!.assessment.recommendation] };
  } else if (verdict === "human_required" || jev.verdict === "ESCALATE" || jev.outcome?.status === "HUMAN_REQUIRED") {
    disposition = { status: "HUMAN_REQUIRED", reasons: [...reasons, receipt?.assessment.recommendation ?? "Resolve the exact bound task conflict through trusted host context."] };
  } else if ((verdict === "proceed" && jev.verdict === "REJECT") || (verdict === "block" && jev.verdict === "APPROVE")) {
    disposition = { status: "HUMAN_REQUIRED", reasons: ["Independent real Advisor and raw JEV disagree; neither assessment has been rewritten.", ...reasons, receipt!.assessment.recommendation] };
  } else if (jev.outcome?.status === "REJECTED" || jev.verdict === "REJECT" || verdict === "block") {
    disposition = { status: "REJECTED", criterionIds: jev.outcome?.status === "REJECTED" ? [...jev.outcome.criterionIds] : receipt?.assessment.criterionCoverage.filter(c => c.status === "contradicted").map(c => c.criterionId) ?? [], reasons: [...reasons, ...(receipt ? [receipt.assessment.recommendation] : [])] };
  } else if (jev.outcome?.status === "EVIDENCE_REQUIRED" || jev.verdict === "NEXT_ACTION_REQUIRED" || verdict === "revise") {
    disposition = { status: "EVIDENCE_REQUIRED", missingCriterionIds: jev.outcome?.status === "EVIDENCE_REQUIRED" ? [...jev.outcome.missingCriterionIds] : receipt?.assessment.criterionCoverage.filter(c => c.status === "uncovered").map(c => c.criterionId) ?? [], reasons: reasons.length ? reasons : ["Provide exact criterion-level evidence and fresh independent review."] };
  } else if (jev.verdict === "APPROVE" && !thresholdSatisfied) {
    disposition = { status: "EVIDENCE_REQUIRED", missingCriterionIds: [...(reasoning?.criterionIds ?? [])], reasons: ["Actual JEV probability does not satisfy the existing approval policy; obtain criterion-level diagnosis and relevant evidence changes."] };
  } else if (!receipt || receipt.authority !== "task_bound" || !reasoning || !["task_review", "parent_review"].includes(reasoning.binding.purpose)) {
    disposition = { status: "EVIDENCE_REQUIRED", missingCriterionIds: [...(reasoning?.criterionIds ?? [])], reasons: ["A real, task-bound Advisor receipt is required. Local intent labels and standalone consultations have no native authority."] };
  } else if (receipt.assessment.criterionCoverage.some(c => c.status !== "covered") || (reasoning.requireParentIntegration && receipt.assessment.parentIntegration.status !== "supported")) {
    disposition = { status: "HUMAN_REQUIRED", reasons: ["Unresolved real reasoning criterion coverage or parent integration conflict forbids approval."] };
  } else if (jev.verdict === "APPROVE" && verdict === "proceed") {
    const bindingDigest = canonicalDigest(reasoning.binding);
    disposition = { status: "APPROVED_PENDING_COMMIT", bindingDigest, receiptId: `consensus:${canonicalDigest({ advisorReceipt: receipt.receiptId, jev: rawJev, bindingDigest })}` };
  } else {
    disposition = { status: "UNAVAILABLE", component: "composition", reasons: ["Unrecognized or unresolved verification outcome; no native approval."] };
  }
  const resultReasons = "reasons" in disposition ? [...disposition.reasons] : ["Independent bound assessments support staging only; matching native success is still required."];
  const legacyVerdict: ConsensusVerdict = disposition.status === "APPROVED_PENDING_COMMIT" ? "AUTO_APPROVE"
    : disposition.status === "REJECTED" ? "AUTO_REJECT"
    : disposition.status === "EVIDENCE_REQUIRED" ? "RECONCILE_PLAN" : "HUMAN_ESCALATION";
  return freezeContractValue({
    verdict: legacyVerdict, advisor: rawAdvisor, jev: rawJev, disposition, reasoning: receipt,
    reasons: resultReasons,
    escalationMessage: disposition.status === "HUMAN_REQUIRED" ? resultReasons.join("; ") : undefined,
    reconciliationDirectives: disposition.status === "EVIDENCE_REQUIRED" ? resultReasons : undefined,
  });
}

/**
 * Formats a clear dual-perspective message for UI confirmation.
 */
export function formatConsensusEscalation(decision: BicameralConsensusDecision): string {
  const jevReasons = decision.jev.reasons.length > 0 ? decision.jev.reasons.join("; ") : "No specific reasons provided";
  return [
    "Bicameral Consensus Escalation (Sovereign Human Review)",
    "─────────────────────────────────────────────────────────────",
    `Local intent signal (not real Advisor): ${decision.advisor.verdict} (Heuristic confidence ${decision.advisor.confidence.toFixed(2)})`,
    `Intent Rationale:        ${decision.advisor.reason.slice(0, 500)}`,
    `Lobe 2 (TypeSafe JEV Judge): ${decision.jev.verdict}`,
    `Composed result: ${decision.disposition.status}`,
    `Real Advisor receipt: ${decision.reasoning?.receiptId ?? "missing (no reasoning authority)"}`,
    `Evidence Findings:       ${jevReasons.slice(0, 500)}`,
    "─────────────────────────────────────────────────────────────",
    "Sovereign human confirmation needed: Approve or reject.",
  ].join("\n");
}

/**
 * Evaluates a drop request through the Bicameral Consensus Engine.
 */
export async function runBicameralDropCheck(
  ctx: DropCheckContext, client?: ExpertJudgeClient, reasoning?: ConsensusReasoningInput,
  options: SemanticApprovalOptions = DEFAULT_SEMANTIC_APPROVAL_OPTIONS,
): Promise<BicameralConsensusDecision> {
  const intent = evaluateAdvisorIntent({ operation: "drop", task: ctx.tasks, userRequest: ctx.userRequest,
    agentWorkLog: ctx.agentWorkLog, reason: ctx.reason, conversationHistory: (ctx.planContext || []).join("\n") });
  const result = await runDropJustificationCheck(ctx, client, options);
  return arbitrateConsensus(intent, {
    verdict: result.decision === "unavailable" ? "UNAVAILABLE" : result.verdict ?? "UNAVAILABLE",
    probability: result.dropJustifiedNoul, reasons: result.reasons, metadata: result.metadata,
    outcome: result.decision === "reject" ? { status: "REJECTED", criterionIds: [], reasons: result.reasons }
      : result.decision === "undecided" ? { status: "HUMAN_REQUIRED", reasons: result.reasons } : undefined,
  }, reasoning, options);
}

export async function runBicameralMacroCheck(
  ctx: MacroCheckContext, client?: ExpertJudgeClient, reasoning?: ConsensusReasoningInput,
  options: SemanticApprovalOptions = DEFAULT_SEMANTIC_APPROVAL_OPTIONS,
): Promise<BicameralConsensusDecision & { macroResult: PhaseMacroCheckResult }> {
  const macroResult = freezeContractValue(await runPhaseMacroCheck(ctx, client, options));
  const decision = await evaluateBicameralDoneConsensus({
    todoTask: ctx.todoTask, phaseTitle: ctx.phaseTitle, userRequest: ctx.userRequest,
    agentWorkLog: ctx.agentWorkLog, evidence: { testOutput: ctx.testSummary, gitStatus: ctx.diffSummary },
    macroResult, reasoning,
  }, options);
  return freezeContractValue({ ...decision, macroResult });
}

export async function evaluateBicameralDoneConsensus(ctx: {
  todoTask: string; phaseTitle?: string; userRequest?: string; agentWorkLog?: string;
  evidence?: unknown; macroResult: PhaseMacroCheckResult; reasoning?: ConsensusReasoningInput;
}, options: SemanticApprovalOptions = DEFAULT_SEMANTIC_APPROVAL_OPTIONS): Promise<BicameralConsensusDecision> {
  const evidence = ctx.evidence && typeof ctx.evidence === "object" ? ctx.evidence as Record<string, unknown> : undefined;
  const intent = evaluateAdvisorIntent({
    operation: "done", task: ctx.todoTask || ctx.phaseTitle || "", userRequest: ctx.userRequest,
    agentWorkLog: ctx.agentWorkLog,
    testSummary: typeof evidence?.testOutput === "string" ? evidence.testOutput : undefined,
    diffSummary: typeof evidence?.gitStatus === "string" ? evidence.gitStatus : undefined,
  });
  const macro = ctx.macroResult;
  const validDimensions = ["APPROVE", "REJECT", "NEXT_ACTION_REQUIRED"].includes(macro.verdict ?? "") &&
    ["no_drift", "unapproved_deviation", "scope_creep"].includes(macro.driftChoice ?? "") &&
    ["HOLD", "EXPANSION", "REDUCTION"].includes(macro.scopeChoice ?? "");
  const outcome = macro.outcome ?? (validDimensions && (macro.driftChoice !== "no_drift" || macro.scopeChoice === "REDUCTION")
    ? { status: "REJECTED" as const, criterionIds: [], reasons: ["Actual architectural_drift/scope_mode boundary criterion violated."] } : undefined);
  return arbitrateConsensus(intent, {
    verdict: macro.error || !validDimensions ? "UNAVAILABLE" : macro.verdict!,
    confidence: macro.expertConfidence, probability: macro.meetsCriteriaNoul,
    reasons: macro.reasons, outcome, metadata: macro.metadata,
  }, ctx.reasoning, options);
}

export interface DecisionCheckContext {
  decision?: AdvisorDecisionKind;
  question: string;
  options?: Array<string | AdvisorOptionCandidate>;
  recommendedIndex?: number;
  constraints?: string | string[];
  evidencePaths?: string[];
  userRequest?: string;
  agentWorkLog?: string;
  context?: string | Record<string, unknown>;
}

export interface BicameralDecisionResult extends BicameralConsensusDecision {
  ckVerdict: CkAdvisorVerdict;
  recommendation: string;
  recommendedOption?: string;
  recommendedIndex?: number;
  rankedOptions: RankedAdvisorOption[];
  findings: AdvisorFinding[];
  openQuestions: string[];
  report: string;
}

/**
 * Formats the fixed 6-section ck:advisor contract:
 * Verdict, Recommendation, Ranked options, Findings, Confidence, Open questions.
 */
export function formatCkAdvisorReport(
  advisor: AdvisorIntentResult,
  jev?: JevResult
): string {
  const ckVerdict: CkAdvisorVerdict =
    advisor.ckVerdict ||
    (advisor.verdict === "ALLOW"
      ? "proceed"
      : advisor.verdict === "DISALLOW"
      ? "block"
      : "revise");
  const recommendation = advisor.recommendation || advisor.reason;
  const rankedLines =
    advisor.rankedOptions && advisor.rankedOptions.length > 0
      ? advisor.rankedOptions
          .map(
            (r, i) =>
              `${i + 1}. **${r.option}** (score: ${r.score.toFixed(2)}) — ${r.rationale}`
          )
          .join("\n")
      : `- **${advisor.recommendedOption || ckVerdict}** — ${recommendation}`;

  const findingLines: string[] = [];
  if (advisor.findings && advisor.findings.length > 0) {
    for (const f of advisor.findings) {
      findingLines.push(
        `- [${f.severity.toUpperCase()}] ${f.claim}${f.evidence ? ` (${f.evidence})` : ""}`
      );
    }
  }
  if (jev && jev.reasons.length > 0) {
    for (const r of jev.reasons) {
      findingLines.push(`- [JEV:${jev.verdict}] ${r}`);
    }
  }
  if (findingLines.length === 0) {
    findingLines.push("- [INFO] No blocking architectural or safety findings detected.");
  }

  const openQuestions =
    advisor.openQuestions && advisor.openQuestions.length > 0
      ? advisor.openQuestions.map((q) => `- ${q}`).join("\n")
      : "None";

  return [
    `## Verdict`,
    ckVerdict,
    ``,
    `## Recommendation`,
    recommendation,
    ``,
    `## Ranked options`,
    rankedLines,
    ``,
    `## Findings`,
    findingLines.join("\n"),
    ``,
    `## Confidence`,
    advisor.confidence.toFixed(2),
    ``,
    `## Open questions`,
    openQuestions,
    ``,
    `Authority: local heuristic signal only; not a real Advisor receipt, calibrated JEV probability, native approval, or debt release.`,
  ].join("\n");
}

/**
 * Evaluates an agent or orchestrator decision through Both Lobes:
 * Lobe 1 (Advisor / ck:advisor) + Lobe 2 (TypeSafe JEV Judge),
 * returning a concrete decision answer and the fixed ck:advisor contract.
 */
export async function runBicameralDecisionCheck(
  ctx: DecisionCheckContext,
  client: ExpertJudgeClient = createSemanticJudgeClient({ purpose: "decision" }),
): Promise<BicameralDecisionResult> {
  const advisor = freezeContractValue(evaluateAdvisorIntent({
    operation: "decision", task: ctx.question, decisionKind: ctx.decision || "general",
    question: ctx.question, options: ctx.options, recommendedIndex: ctx.recommendedIndex,
    constraints: ctx.constraints, evidencePaths: ctx.evidencePaths, userRequest: ctx.userRequest,
    agentWorkLog: [ctx.agentWorkLog, typeof ctx.context === "string" ? ctx.context : JSON.stringify(ctx.context)].filter(Boolean).join("\n"),
  }));
  const options = normalizeOptions(ctx.options, ctx.recommendedIndex);
  const questions: Record<string, ExpertJudgeQuestion> = {
    risk_posture: { type: "score", instructions: "Rate technical/security risk on the declared 0..3 scale.",
      criteria: ["Zero Risk", "Low Risk", "Moderate Risk", "Critical Risk"] },
    decision_clarity: { type: "noul", instructions: "Is this decision well-scoped and supported by sufficient evidence?",
      criteria: { true: "Clear, bounded and supported", false: "Ambiguous or missing context" } },
  };
  if (options.length >= 2) questions.recommended_option = {
    type: "choice", instructions: "Which candidate is best supported by evidence and constraints?",
    criteria: Object.fromEntries([...options.map(option => [option.label, option.description || option.label]),
      ["insufficient_evidence", "Evidence does not justify preferring a candidate"]]),
  };
  let jev: JevResult;
  try {
    const response = await client.evaluate({ state: JSON.stringify({
      decision: ctx.decision || "general", question: ctx.question, options, constraints: ctx.constraints,
      user_request: ctx.userRequest, agent_work_log: ctx.agentWorkLog, context: ctx.context,
    }), questions });
    const risk = scoreValue(response.answers?.risk_posture, 3);
    const clarity = noulValue(response.answers?.decision_clarity);
    const recommendation = options.length >= 2 ? choiceValue(response.answers?.recommended_option,
      [...options.map(option => option.label), "insufficient_evidence"]) : undefined;
    if (response.error || risk === undefined || clarity === undefined || (options.length >= 2 && !recommendation)) {
      jev = { verdict: "UNAVAILABLE", reasons: ["Decision consultation unavailable: required real risk score, Noul probability, or choice is missing/invalid."], metadata: response.metadata };
    } else {
      jev = { verdict: risk > 2 ? "REJECT" : recommendation === "insufficient_evidence" ? "NEXT_ACTION_REQUIRED" : "APPROVE",
        probability: clarity, metadata: response.metadata,
        reasons: [`Risk ${risk}/3; actual decision_clarity P=${clarity}.`, ...(recommendation ? [`Independent JEV recommendation: ${recommendation}.`] : [])] };
    }
  } catch { jev = { verdict: "UNAVAILABLE", reasons: ["Decision consultation service unavailable; local intent remains a non-authoritative signal."] }; }
  const consensus = arbitrateConsensus(advisor, jev);
  const ckVerdict: CkAdvisorVerdict = consensus.disposition.status === "REJECTED" ? "block" : "revise";
  const recommendation = advisor.recommendation || advisor.reason;
  return freezeContractValue({
    ...consensus, ckVerdict, recommendation,
    recommendedOption: advisor.recommendedOption, recommendedIndex: advisor.recommendedIndex,
    rankedOptions: advisor.rankedOptions || [], findings: advisor.findings || [],
    openQuestions: advisor.openQuestions || [],
    report: `${formatCkAdvisorReport({ ...advisor, ckVerdict, recommendation }, jev)}\n\nAuthority: standalone consultation only; no native approval or debt release.`,
  });
}
