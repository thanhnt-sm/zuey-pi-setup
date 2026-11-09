import { createRequire } from "node:module";
import { canonicalDigest } from "./task-contract-source";
import type { JudgeEvidencePacket, EvidencePacketSetManifest } from "./judge-evidence-packet";
import type { TaskContract } from "./types/verification";
import { advisorOutputSchema } from "./advisor-protocol";
import { isPrivateEvidencePath } from "./evidence-privacy";

interface RedactionClient { redactEvidenceState(state: unknown, options: { apiKey?: string; homeDirs?: readonly string[] }): unknown }
export interface PreparedAdvisorPublicContext { publicPrompt: string; publicContextDigest: string; packetDigest: string; criterionIds: readonly string[]; parentRequirementIds: readonly string[]; evidenceRefs: readonly string[]; integrationEvidenceRefs: readonly string[]; authorizedFiles: readonly { path: string; sha256: string }[] }
export interface AdvisorPublicContextOptions {
  contract: TaskContract; evidenceManifest?: EvidencePacketSetManifest; question: string; apiKey?: string; homeDirs?: readonly string[]; maxContextBytes?: number;
  authorizedFiles?: readonly { path: string; sha256: string }[];
  /** Host guard authorization, not permission inferred from a file name in the request. */
  isAuthorizedSource(path: string, sha256: string): boolean;
}
/** Hashes authenticated by the host are identities, not arbitrary high-entropy prose. */
function validatePublicReferences(client: RedactionClient, references: { authorizedFiles: readonly { path: string; sha256: string }[]; evidenceRefs: readonly string[] }, privacy: { apiKey?: string; homeDirs?: readonly string[] }, generatedDigests: readonly string[] = []): void {
  const digests = [...new Set([...references.authorizedFiles.map(file => file.sha256), ...generatedDigests])];
  if (digests.some(digest => !/^[a-f0-9]{64}$/.test(digest) || privacy.apiKey && digest.includes(privacy.apiKey))) throw new Error("advisor_public_reference_redaction_required");
  const masked = JSON.stringify(references).replace(/[a-f0-9]{64}/g, digest => digests.includes(digest) ? `host-hash-${digests.indexOf(digest)}` : digest);
  const publicReferences = client.redactEvidenceState(JSON.parse(masked), privacy);
  if (canonicalDigest(publicReferences) !== canonicalDigest(JSON.parse(masked))) throw new Error("advisor_public_reference_redaction_required");
}
/** Complete guarded packet, shared secret redaction, no ambient history or raw reasoning. */
export function prepareAdvisorPublicContext(packet: JudgeEvidencePacket, options: AdvisorPublicContextOptions): PreparedAdvisorPublicContext {
  if (packet.omissions.some(omission => omission.required) || !packet.criteria.length || !options.question.trim()) throw new Error("advisor_complete_public_packet_required");
  if (packet.binding.contractId !== options.contract.contractId || packet.binding.revisionId !== options.contract.revisionId || packet.binding.incarnationId !== options.contract.incarnationId
    || options.evidenceManifest && canonicalDigest(options.evidenceManifest.criteria) !== canonicalDigest(options.contract.criteria)) throw new Error("advisor_original_contract_required");
  const files = [...(options.evidenceManifest?.source.map(source => ({ path: source.path, sha256: source.fullFileDigest })) ?? packet.source.map(source => ({ path: source.path, sha256: source.sha256 }))), ...(options.authorizedFiles ?? [])];
  const authorizedFiles = [...new Map(files.map(file => [file.path, file])).values()];
  if (files.some(file => authorizedFiles.find(candidate => candidate.path === file.path)?.sha256 !== file.sha256)) throw new Error("advisor_conflicting_source_scope_digest");
  const maxContextBytes = options.maxContextBytes ?? 262144;
  if (!Number.isSafeInteger(maxContextBytes) || maxContextBytes < 1 || maxContextBytes > 4194304) throw new Error("advisor_trusted_context_budget_invalid");
  for (const source of [...authorizedFiles, ...packet.artifacts]) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source.path) || isPrivateEvidencePath(source.path)
      || !options.isAuthorizedSource(source.path, source.sha256)) throw new Error("advisor_source_scope_denied");
  }
  const client = createRequire(import.meta.url)("./typesafe-api-client.cjs") as RedactionClient;
  const state = client.redactEvidenceState({ question: options.question, originalCriteria: options.contract.criteria, originalUserRequest: options.contract.originalUserRequest,
    parentRequirements: options.contract.parentRequirements, evidence_packet: packet, evidence_manifest: options.evidenceManifest }, { apiKey: options.apiKey ?? process.env.TYPESAFE_API_KEY, homeDirs: options.homeDirs });
  const integrationEvidenceRefs = [...new Set((packet.integrationReceipts ?? []).map(receipt => receipt.receiptId))];
  const evidenceRefs = [...new Set([...packet.obligations.flatMap(obligation => obligation.evidenceIds), ...authorizedFiles.map(file => `source:${file.path}:${file.sha256}`), ...integrationEvidenceRefs])];
  if (!evidenceRefs.length) throw new Error("advisor_evidence_manifest_required");
  validatePublicReferences(client, { authorizedFiles, evidenceRefs }, { apiKey: options.apiKey ?? process.env.TYPESAFE_API_KEY, homeDirs: options.homeDirs });
  const publicReferences = { authorizedFiles, evidenceRefs };
  const publicPrompt = JSON.stringify({ instruction: "Independently assess EVERY original criterion, not just those selected in the initial bounded packet. Preserve contradictions, omissions and uncovered obligations. Retrieve necessary source using guarded read/grep/glob against the exact authorized file SHA manifest; prefer explicit line ranges. A span/search result never proves global absence or whole-file correctness. Assess parent integration separately; child passes do not establish compatibility. Do not infer human approval or native commit. Submit one terminal yield with data matching outputSchema. No ambient history, shell, writes, web search or private context is authorized.", state, authorizedFiles: publicReferences.authorizedFiles, outputSchema: advisorOutputSchema });
  if (Buffer.byteLength(publicPrompt, "utf8") > maxContextBytes) throw new Error("advisor_complete_public_context_exceeds_budget");
  return { publicPrompt, publicContextDigest: canonicalDigest([{ role: "user", content: publicPrompt }]), packetDigest: canonicalDigest(packet), criterionIds: options.contract.criteria.map(criterion => criterion.id),
    parentRequirementIds: (options.evidenceManifest?.parentRequirements ?? options.contract.parentRequirements).map(parent => `parent:${parent.parentContractId}:${parent.criterionId}`), evidenceRefs, integrationEvidenceRefs, authorizedFiles };
}
export interface AdvisorConsultationInput { question: string; options?: readonly string[]; constraints?: readonly string[] }
export interface AdvisorConsultationOptions {
  apiKey?: string; homeDirs?: readonly string[]; maxContextBytes?: number;
  authorizedFiles?: readonly { path: string; sha256: string }[]; workspaceRoot?: string;
  /** Authenticated current source manifest, not caller-proposed path permission. */
  isAuthorizedSource?(path: string, sha256: string): boolean;
  publicResearchContext?: unknown;
  criterionIds?: readonly string[];
}
export interface PreparedAdvisorConsultationContext {
  publicPrompt: string; publicContextDigest: string; evidenceRefs: readonly string[]; integrationEvidenceRefs: readonly string[];
  criterionIds: readonly string[]; questionDigest: string; authorizedFiles: readonly { path: string; sha256: string }[];
}
export function prepareAdvisorConsultationContext(input: AdvisorConsultationInput, privacy: AdvisorConsultationOptions = {}): PreparedAdvisorConsultationContext {
  if (!input.question.trim() || input.options?.some(option => !option.trim()) || input.constraints?.some(constraint => !constraint.trim())) throw new Error("advisor_consultation_question_required");
  const authorizedFiles = (privacy.authorizedFiles ?? []).map(file => ({ ...file }));
  if (authorizedFiles.length) {
    if (!privacy.workspaceRoot || !privacy.isAuthorizedSource) throw new Error("advisor_consultation_authenticated_source_scope_required");
    const guard = createRequire(import.meta.url)("./typesafe-evidence-file.cjs") as { readWorkspaceFile(root: string, relativePath: string, options: { maxBytes: number }): { sha256: string } };
    for (const file of authorizedFiles) {
      if (!/^[a-f0-9]{64}$/.test(file.sha256) || /^[a-z][a-z0-9+.-]*:\/\//i.test(file.path)
        || isPrivateEvidencePath(file.path)
        || !privacy.isAuthorizedSource(file.path, file.sha256) || guard.readWorkspaceFile(privacy.workspaceRoot, file.path, { maxBytes: 4194304 }).sha256 !== file.sha256) throw new Error("advisor_consultation_source_scope_denied");
    }
  }
  const client = createRequire(import.meta.url)("./typesafe-api-client.cjs") as RedactionClient;
  const state = client.redactEvidenceState({ ...input, publicResearchContext: privacy.publicResearchContext }, { apiKey: privacy.apiKey ?? process.env.TYPESAFE_API_KEY, homeDirs: privacy.homeDirs });
  if (privacy.criterionIds && (!privacy.criterionIds.length || new Set(privacy.criterionIds).size !== privacy.criterionIds.length || privacy.criterionIds.some(id => !id.trim()))) throw new Error("advisor_original_consultation_criteria_required");
  const questionDigest = canonicalDigest({ state, authorizedFiles, selectedCriterionIds: privacy.criterionIds ?? null });
  const criterionIds = privacy.criterionIds ?? [`consultation:${questionDigest}`];
  const evidenceRefs = [`public-question:${questionDigest}`, ...authorizedFiles.map(file => `source:${file.path}:${file.sha256}`)];
  validatePublicReferences(client, { authorizedFiles, evidenceRefs }, { apiKey: privacy.apiKey ?? process.env.TYPESAFE_API_KEY, homeDirs: privacy.homeDirs }, [questionDigest]);
  const publicReferences = { authorizedFiles, evidenceRefs };
  const publicPrompt = JSON.stringify({ instruction: "Give an independent read-only technical consultation, including research or repair advice when completion evidence is missing. No todo, mutation, completion, or human permission is authorized. Inspect only exact-SHA authorized files through guarded read/grep/glob. Missing proof stays explicit; an excerpt never establishes global absence. Cover the consultation criterion with actual public evidence references. Mark parent integration not_applicable: this consultation cannot approve parent integration or native completion. Submit a concrete recommendation, ranked options, findings, confidence, open questions and criterion coverage through one terminal yield(data).", state, authorizedFiles: publicReferences.authorizedFiles, criterionIds, evidenceRefs: publicReferences.evidenceRefs, outputSchema: advisorOutputSchema });
  const maxContextBytes = privacy.maxContextBytes ?? 262144;
  if (!Number.isSafeInteger(maxContextBytes) || maxContextBytes < 1 || maxContextBytes > 4194304) throw new Error("advisor_trusted_context_budget_invalid");
  if (Buffer.byteLength(publicPrompt, "utf8") > maxContextBytes) throw new Error("advisor_public_consultation_exceeds_budget");
  return { publicPrompt, publicContextDigest: canonicalDigest([{ role: "user", content: publicPrompt }]), evidenceRefs, integrationEvidenceRefs: [], criterionIds, questionDigest, authorizedFiles };
}
