import type { HostToolInvocation } from "./host-tool-invocation";
import type { ContractReference, NativeIncarnationReference, TaskContract } from "./types/verification";

export interface HistoricalRawJev {
  verdict?: string;
  probability?: number;
  confidence?: number;
  driftChoice?: string;
  scopeChoice?: string;
  rawAnswersDigest?: string;
  bodyDigest?: string;
}
export interface HistoricalDebtRecord {
  debtId: string;
  kind: "semantic_rejection" | "contract_debt" | "unclassified_native_failure";
  contract?: ContractReference;
  criterionIds: readonly string[];
  reasons: readonly string[];
  sourceEntryId: string;
  callId?: string;
  bindingDigest?: string;
  rawJev?: HistoricalRawJev;
}
export interface HistoricalDebtCatalogue {
  incarnation: NativeIncarnationReference;
  lifecycle: "completed" | "abandoned" | "removed" | "open" | "unknown";
  nativeProvenanceDigest: string;
  contracts: readonly TaskContract[];
  debts: readonly HistoricalDebtRecord[];
}
export interface HistoricalDebtResolutionProposal { incarnationId: string; reason: string }
export type HistoricalDebtResolutionOutcome =
  | { status: "HUMAN_RECONCILED_NO_NATIVE_APPROVAL"; resolutionId: string; incarnationId: string; debtIds: readonly string[] }
  | { status: "HUMAN_REQUIRED" | "EVIDENCE_REQUIRED"; reasons: readonly string[] }
  | { status: "UNAVAILABLE"; component: string; reasons: readonly string[] };
export interface HistoricalDebtResolver {
  (context: unknown, callId: string, proposal: HistoricalDebtResolutionProposal): Promise<HistoricalDebtResolutionOutcome>;
}
export interface HistoricalDebtResolutionFact {
  schemaVersion: 1;
  kind: "historical_resolution";
  contextKey: string;
  resolutionId: string;
  incarnationId: string;
  debtIds: readonly string[];
  scopeDigest: string;
  reason: string;
  nonce: string;
  invocation: HostToolInvocation;
  decision: "human_accept_historical_obligation_no_native_approval";
}
