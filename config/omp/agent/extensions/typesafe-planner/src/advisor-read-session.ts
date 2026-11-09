import { canonicalDigest } from "./task-contract-source";
import { record, type AdvisorRequest } from "./advisor-protocol";
import { authorizeAdvisorRead, executeAdvisorRead, type AdvisorReadLimits, type AdvisorPublicTransaction } from "./advisor-readonly";

export interface AdvisorMediatedReadResult { isError: boolean; content: { type: "text"; text: string }[]; details: Record<string, unknown> }
export interface AdvisorReadSession {
  authorize(name: string, input: unknown, id?: string): { block: true; reason: string } | undefined;
  execute(name: string, input: unknown, id: string): AdvisorMediatedReadResult;
  observe(event: { toolName: string; toolCallId?: string; content?: unknown; isError?: boolean }): boolean;
  transactions(): readonly AdvisorPublicTransaction[];
}
interface ReadCall { name: "read" | "grep" | "glob"; inputDigest: string; arguments: Record<string, unknown>; result?: AdvisorMediatedReadResult; published: boolean }
export function createAdvisorReadSession(request: AdvisorRequest, limits: AdvisorReadLimits, invalidate: (reason: string) => void, apiKey?: string): AdvisorReadSession {
  const calls = new Map<string, ReadCall>();
  return {
    authorize(name, input, id) {
      if (!id || !["read", "grep", "glob"].includes(name) || !authorizeAdvisorRead(request, name, input)) return { block: true, reason: "advisor_authorized_read_arguments_and_call_identity_required" };
      const existing = calls.get(id); const inputDigest = canonicalDigest(input);
      if (existing && (existing.name !== name || existing.inputDigest !== inputDigest)) { invalidate("advisor_read_call_conflict"); return { block: true, reason: "advisor_read_call_conflict" }; }
      if (!existing) {
        const publicArguments: Record<string, unknown> = {};
        for (const key of ["path", "pattern", "case", "ignore_case"]) if (input[key] !== undefined) publicArguments[key] = input[key];
        calls.set(id, { name: name as ReadCall["name"], inputDigest, arguments: publicArguments, published: false });
      }
      return undefined;
    },
    execute(name, input, id) {
      const call = calls.get(id);
      if (!call || call.name !== name || !record(input) || canonicalDigest(input) !== call.inputDigest || call.result) {
        invalidate("advisor_read_execution_misbound");
        return { isError: true, content: [{ type: "text", text: "Advisor read execution is not bound to an approved actual call." }], details: {} };
      }
      try { call.result = executeAdvisorRead(request, call.name, input, limits, apiKey); }
      catch (error) {
        const reason = error instanceof Error && /^advisor_[a-z_]+$/.test(error.message) ? error.message : "advisor_guarded_source_unavailable";
        if (record(error) && error.kind === "security" || reason === "advisor_evaluated_file_changed") invalidate("advisor_guarded_source_integrity_failed");
        call.result = { isError: true, content: [{ type: "text", text: `${reason}: no source proof was returned; select a valid bounded range or refresh the bound evidence.` }], details: { advisorReadError: reason } };
      }
      return call.result;
    },
    observe(event) {
      const call = event.toolCallId ? calls.get(event.toolCallId) : undefined;
      if (!call?.result || !Array.isArray(event.content) || call.name !== event.toolName || Boolean(event.isError) !== call.result.isError || canonicalDigest(event.content) !== canonicalDigest(call.result.content)) return false;
      call.published = true;
      return true;
    },
    transactions() {
      return [...calls].flatMap(([id, call]) => call.published && call.result ? [{ id, name: call.name, arguments: call.arguments, text: call.result.content.map(part => part.text).join("\n"), isError: call.result.isError }] : []);
    },
  };
}
