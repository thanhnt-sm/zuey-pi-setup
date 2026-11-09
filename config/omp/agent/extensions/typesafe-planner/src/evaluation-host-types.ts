import type { AdvisorHostContext, AdvisorHostExecuteContext, AdvisorHostRegistration, AdvisorHostServices, AdvisorHostToolResult } from "./advisor-host-types";
import type { PairedReviewDriver, PairedReviewDriverOptions } from "./atomic-evaluation";
import type { WorkspaceBenchmarkOptions } from "../tools/jev-paired-workspace";
export interface EvaluationHostFacts {
  branchId:string; requestEntryId:string; policyDigest:string; privacyDigest:string; candidateSourceManifestDigest:string;
}
export interface EvaluationHostOptions {
  getRegistration():AdvisorHostRegistration|undefined;
  facts(context:AdvisorHostContext|AdvisorHostExecuteContext):EvaluationHostFacts;
  driverOptions(context:AdvisorHostExecuteContext):Omit<WorkspaceBenchmarkOptions,"authorize"|"dispatchAdvisor">;
  /** Must invoke the actual native UI. No tool argument, corpus JSON flag or model judgment is approval. */
  requestHumanApproval(summary:string,context:AdvisorHostExecuteContext):Promise<boolean>;
  appendEntry(type:string,data:unknown):void;
  projectPublic(value:unknown):unknown;
  createDriver:(options:PairedReviewDriverOptions)=>PairedReviewDriver;
}
export interface EvaluationHostParameters { run?:string; protocolPath?:string; requestId?:string }
export interface EvaluationHost {
  identity(context:AdvisorHostExecuteContext):Promise<AdvisorHostToolResult>;
  authorizeRun(parameters:EvaluationHostParameters,context:AdvisorHostExecuteContext):Promise<AdvisorHostToolResult>;
  prepare(parameters:EvaluationHostParameters,context:AdvisorHostExecuteContext):Promise<AdvisorHostToolResult>;
  collect(parameters:EvaluationHostParameters,context:AdvisorHostExecuteContext,signal?:AbortSignal):Promise<AdvisorHostToolResult>;
  shadowServices:AdvisorHostServices;
}
