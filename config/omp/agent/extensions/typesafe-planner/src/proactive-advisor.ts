/**
 * Proactive Advisor Dispatcher & Structured Response Parser.
 * Prepares consultation requests when Judge rejects or tests fail,
 * and validates the 6 fixed contract sections from agents/advisor.md.
 */

export interface ProactiveAdvisorRequestInput {
  task: string;
  phase?: string;
  errorLog?: string;
  gitDiff?: string;
  reasons?: string[];
  role?: "advisor" | "ck:advisor";
}

export interface NativeTaskParameters {
  agent: string;
  decision: "stuck" | "approach" | "plan-review" | "phase-risk" | "pre-merge";
  task: string;
  phase?: string;
  question: string;
  solutionSpace: string;
}

export interface ProactiveAdvisorDispatchDescriptor {
  nativeTool: "task";
  parameters: NativeTaskParameters;
}

export interface ParsedAdvisorResponse {
  valid: boolean;
  verdict?: "proceed" | "revise" | "block";
  recommendation?: string;
  rankedOptions?: string;
  findings?: string;
  confidence?: number;
  openQuestions?: string;
  actionItems: string[];
  missingSections: string[];
}

export function prepareProactiveAdvisorConsultation(input: ProactiveAdvisorRequestInput): ProactiveAdvisorDispatchDescriptor {
  const agent = input.role || "advisor";
  const errorDetails = [
    input.reasons && input.reasons.length ? `Lý do từ chối: ${input.reasons.join("; ")}` : "",
    input.errorLog ? `Log lỗi kiểm thử:\n\`\`\`\n${input.errorLog.slice(0, 2000)}\n\`\`\`` : "",
    input.gitDiff ? `Diff mã nguồn gần nhất:\n\`\`\`diff\n${input.gitDiff.slice(0, 2000)}\n\`\`\`` : "",
  ].filter(Boolean).join("\n\n");

  const question = `Nhiệm vụ gặp lỗi kiểm thử hoặc bị Judge từ chối. Hãy chẩn đoán nguyên nhân gốc rễ và lập kế hoạch sửa chữa từng bước:\n${errorDetails}`;

  return {
    nativeTool: "task",
    parameters: {
      agent,
      decision: "stuck",
      task: `[Advisor Remediation] ${input.task}`,
      ...(input.phase ? { phase: input.phase } : {}),
      question,
      solutionSpace: "single-flight diagnosis and actionable remediation plan for test/judge failure",
    },
  };
}

const REQUIRED_SECTIONS = [
  "## Verdict",
  "## Recommendation",
  "## Ranked options",
  "## Findings",
  "## Confidence",
  "## Open questions",
];

export function parseAdvisorStructuredResponse(output: string): ParsedAdvisorResponse {
  const missingSections: string[] = [];
  for (const section of REQUIRED_SECTIONS) {
    if (!output.includes(section)) {
      missingSections.push(section);
    }
  }

  if (missingSections.length > 0) {
    return {
      valid: false,
      actionItems: [],
      missingSections,
    };
  }

  // Extract sections
  const getSectionContent = (header: string, nextHeader?: string): string => {
    const startIdx = output.indexOf(header);
    if (startIdx === -1) return "";
    const contentStart = startIdx + header.length;
    if (!nextHeader) return output.slice(contentStart).trim();
    const endIdx = output.indexOf(nextHeader, contentStart);
    return endIdx === -1 ? output.slice(contentStart).trim() : output.slice(contentStart, endIdx).trim();
  };

  const rawVerdict = getSectionContent("## Verdict", "## Recommendation").toLowerCase();
  const verdict: "proceed" | "revise" | "block" | undefined =
    rawVerdict.includes("proceed") ? "proceed"
      : rawVerdict.includes("revise") ? "revise"
        : rawVerdict.includes("block") ? "block"
          : undefined;

  const recommendation = getSectionContent("## Recommendation", "## Ranked options");
  const rankedOptions = getSectionContent("## Ranked options", "## Findings");
  const findings = getSectionContent("## Findings", "## Confidence");
  const rawConfidence = getSectionContent("## Confidence", "## Open questions");
  const openQuestions = getSectionContent("## Open questions");

  const confidence = parseFloat(rawConfidence);

  // Extract numbered action items from Recommendation (e.g. "1. ...", "2. ...")
  const actionItems: string[] = [];
  const lines = recommendation.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\d+\.\s+(.+)$/);
    if (match) {
      actionItems.push(match[1]);
    }
  }

  return {
    valid: Boolean(verdict && !isNaN(confidence)),
    verdict,
    recommendation,
    rankedOptions,
    findings,
    confidence: isNaN(confidence) ? undefined : confidence,
    openQuestions,
    actionItems,
    missingSections: [],
  };
}
