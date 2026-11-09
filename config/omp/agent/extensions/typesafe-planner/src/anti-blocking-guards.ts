/**
 * Anti-blocking & anti-spam middleware guards.
 * Prevents AI agents from endlessly asking humans about solvable technical problems,
 * and prevents agents from parking tasks into blocked state instead of consulting Advisor.
 */

export function isTechnicalImplementationQuestion(text: string, _options?: Array<unknown>): boolean {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();

  // Patterns indicating debugging, test failure, code fixing, or implementation choices
  const techPatterns = [
    /\b(test|tests|assertion|failed|failing|exit code|exitcode)\b/i,
    /\b(syntax error|type error|typecheck|traceback|stack trace|compil|lint)\b/i,
    /\b(how to fix|how should i fix|fix this|repair|debug|troubleshoot)\b/i,
    /\b(how should i implement|how to implement|which function|what code to write)\b/i,
    /\b(bun test|npm test|vitest|jest|pytest)\b/i,
    /\b(todo blocked|blocked todo|why blocked|unblock)\b/i,
    /(lỗi|thất bại|sửa lỗi|viết mã|cú pháp|chạy test|test hỏng|test tạch|lỗi type|kiểm thử)/i,
  ];

  return techPatterns.some(pattern => pattern.test(lower));
}

export function isSolvableTechnicalFailure(reason?: string): boolean {
  if (!reason || typeof reason !== "string") return false;
  const lower = reason.toLowerCase();
  const solvable = [
    /\b(test|tests|assertion|failed|failing|exit code|exitcode)\b/i,
    /\b(syntax|type error|typecheck|lint|compile|compilation)\b/i,
    /\b(missing implementation|stub|todo|not implemented|unimplemented)\b/i,
    /\b(evidence required|evidence_required|review required|review_required)\b/i,
    /(lỗi|thất bại|hỏng test|chưa xong|chưa đạt|kiểm thử hỏng|hỏng)/i,
  ];
  return solvable.some(pat => pat.test(lower));
}

export function formatAdvisorAutoRemediation(task: string, phase?: string, reasons?: string[]): string {
  const params = JSON.stringify({
    decision: "stuck",
    task,
    ...(phase ? { phase } : {}),
    question: "Diagnose root cause of failure, provide ranked technical options and dependency-ordered re-plan.",
  });
  const reasonText = reasons && reasons.length ? ` Nguyên nhân từ chối: ${reasons.join("; ")}.` : "";
  return `[TỰ ĐỘNG CHỮA LÀNH / AUTO-REMEDIATION]: CẤM đóng băng hoặc bỏ cuộc khi gặp lỗi kiểm thử!${reasonText}\nHãy triệu hồi ngay Cố vấn Độc lập bằng lệnh:\ntypesafe_prepare_advisor ${params}\nsau đó thực thi task native được trả về để nhận kế hoạch sửa chữa toàn diện từ Advisor, sửa mã nguồn và chạy lại bun test.`;
}

/**
 * Intercepts an `ask` tool call. If the question is about technical implementation or debugging,
 * blocks the tool call and instructs the agent to consult Advisor instead.
 */
export function interceptAskCall(input: Record<string, unknown>): { blocked: boolean; reason?: string } {
  const firstQObj =
    Array.isArray(input.questions) && input.questions[0] && typeof input.questions[0] === "object"
      ? (input.questions[0] as Record<string, unknown>)
      : undefined;
  const primaryQuestionText =
    (typeof firstQObj?.question === "string" ? firstQObj.question : undefined) ||
    (typeof input.question === "string" ? input.question : undefined) ||
    (typeof input.i === "string" ? input.i : "");

  if (isTechnicalImplementationQuestion(primaryQuestionText)) {
    return {
      blocked: true,
      reason:
        "BLOCKED: Câu hỏi liên quan đến lỗi kỹ thuật, gỡ lỗi hoặc chi tiết triển khai mã nguồn. Tác tử BẮT BUỘC phải tự động triệu hồi Advisor (typesafe_prepare_advisor) và Thẩm phán TypeSafe Jev Judge để tự phân tích và lập giải pháp, KHÔNG ĐƯỢC tra khảo người dùng.",
    };
  }
  return { blocked: false };
}

/**
 * Intercepts a `todo` tool call. If the operation is `block` or `drop` due to a solvable
 * technical failure, blocks the operation and forces the agent to use the healing loop.
 */
export function interceptTodoCall(input: Record<string, unknown>): { blocked: boolean; reason?: string } {
  const op = typeof input.op === "string" ? input.op : "";
  const reason = typeof input.reason === "string" ? input.reason : "";
  const task = typeof input.task === "string" ? input.task : "";
  const phase = typeof input.phase === "string" ? input.phase : undefined;

  if (op === "block" && isSolvableTechnicalFailure(reason)) {
    return {
      blocked: true,
      reason:
        `CẤM đóng băng todo vì lỗi kiểm thử hoặc thiếu cài đặt kỹ thuật.\n` +
        formatAdvisorAutoRemediation(task, phase, [reason]),
    };
  }
  return { blocked: false };
}
