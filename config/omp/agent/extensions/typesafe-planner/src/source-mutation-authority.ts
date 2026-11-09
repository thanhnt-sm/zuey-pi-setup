import path from "node:path";
import type { ContractRuntime } from "./contract-runtime";
import type { NativeMutationScopeGrant } from "./advisor-mutation-delegation";
import { canonicalDigest, freezeContractValue } from "./task-contract-source";
import { pathInScope } from "./evidence-collector";

/** Source-file permission only. Never semantic approval, native completion or deployment permission. */
export function currentSourceMutationGrant(contracts: ContractRuntime, context: unknown, cwd: string, policyDigest: string): NativeMutationScopeGrant | undefined {
  const projection = contracts.projection(context);
  if (!projection?.nativeStateReliable) return undefined;
  const applicable = projection.contracts.filter(contract => {
    const source = contracts.sourceContext(contract);
    const native = projection.incarnations.find(incarnation => incarnation.incarnationId === contract.incarnationId);
    const task = native && projection.nativePhases?.[native.target.phaseOrdinal]?.tasks[native.target.ordinal];
    return source && source.authorization.kind !== "readonly" && contract.policyDigest === policyDigest
      && (contract.taskKind === "implementation" || contract.taskKind === "operations")
      && native?.target.content === task?.content && (task?.status === "pending" || task?.status === "in_progress")
      && contract.allowedMutationScope.operations.some(operation => operation === "create" || operation === "modify" || operation === "delete");
  });
  if (!applicable.length) return undefined;
  // A single flattened grant cannot retain a contract-to-path association.
  // Intersect both axes rather than allowing contract A's operation on contract
  // B's path through a paths×operations cross-product.
  const operations = applicable[0].allowedMutationScope.operations.filter(operation => applicable.every(contract => contract.allowedMutationScope.operations.includes(operation)));
  const paths = applicable[0].allowedMutationScope.paths.filter(scope => applicable.every(contract => contract.allowedMutationScope.paths.includes(scope)));
  if (!paths.length || !operations.some(operation => operation === "create" || operation === "modify" || operation === "delete")) return undefined;
  return freezeContractValue({ workspaceRoot: path.resolve(cwd), policyDigest,
    scope: { paths: [...new Set(paths)].sort(), operations },
    contractRefs: applicable.map(contract => ({ contractId: contract.contractId, revisionId: contract.revisionId, incarnationId: contract.incarnationId })),
  });
}

export function sourceMutationGrantCurrent(grant: NativeMutationScopeGrant, contracts: ContractRuntime, context: unknown, cwd: string, policyDigest: string): boolean {
  if (path.resolve(cwd) !== path.resolve(grant.workspaceRoot) || policyDigest !== grant.policyDigest) return false;
  const actual = currentSourceMutationGrant(contracts, context, cwd, policyDigest);
  if (!actual) return false;
  return grant.contractRefs.every(reference => actual.contractRefs.some(candidate => canonicalDigest(candidate) === canonicalDigest(reference)))
    && grant.scope.operations.every(operation => actual.scope.operations.includes(operation))
    && grant.scope.paths.every(value => actual.scope.paths.includes(value));
}

export function sourceMutationAllowed(grant: NativeMutationScopeGrant | undefined, cwd: string, file: string, operation: "create" | "modify" | "delete"): boolean {
  if (!grant || path.resolve(cwd) !== path.resolve(grant.workspaceRoot) || !grant.scope.operations.includes(operation)) return false;
  const relative = path.relative(cwd, path.resolve(cwd, file)).replace(/\\/g, "/");
  return relative.length > 0 && !path.isAbsolute(relative) && !relative.split("/").includes("..") && pathInScope(relative, grant.scope.paths);
}
