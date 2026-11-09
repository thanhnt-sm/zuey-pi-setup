import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import type { AllowedMutationScope, ContractReference } from "./types/verification";
import type { AdvisorHostAPI, AdvisorHostContext, AdvisorHostExecuteContext } from "./advisor-host-types";
import { advisorAgent, advisorHub, hostContext, type HostScope } from "./advisor-host-state";
import { freezeContractValue, nonempty } from "./task-contract-source";
import { record } from "./advisor-protocol";

/** File-mutation scope only: never a command, native lifecycle, semantic, or human approval. */
export interface NativeMutationScopeGrant {
  workspaceRoot: string;
  scope: AllowedMutationScope;
  contractRefs: readonly ContractReference[];
  policyDigest: string;
}
export interface NativeMutationDelegationOptions {
  capture(context: AdvisorHostContext): NativeMutationScopeGrant | undefined;
  isCurrent(grant: NativeMutationScopeGrant, context: AdvisorHostContext): boolean | Promise<boolean>;
}
interface Owner { scope: HostScope; epoch: string; grant: NativeMutationScopeGrant; services: NativeMutationDelegationOptions }
interface Spawn { agent: string; bound: boolean }
interface Lineage { scope: HostScope; epoch: string }
interface Frame { owner: Owner; parent: AdvisorHostContext; parentSessionId: string; toolCallId: string; spawns: Spawn[]; lineage: readonly Lineage[] }
interface Route { owner: Owner; parent: AdvisorHostContext; sessionId: string; agentId: string; agentName: string; sessionManager: object; registration: object; lineage: readonly Lineage[] }
const frames = new AsyncLocalStorage<Frame>();
const routes = new WeakMap<object, Route>();
const normalized = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
function sameRoot(left: string, right: string): boolean { return normalized(left) === normalized(right); }
function ownsParent(owner: Owner): boolean {
  return owner.scope.active && owner.scope.epoch === owner.epoch
    && advisorHub(owner.scope.api).roots.get(owner.scope.context.sessionManager) === owner.scope
    && owner.scope.context.sessionManager.getSessionId() === owner.scope.sessionId;
}
function validGrant(value: NativeMutationScopeGrant, context: AdvisorHostContext): boolean {
  return record(value) && nonempty(value.workspaceRoot) && path.isAbsolute(value.workspaceRoot) && sameRoot(value.workspaceRoot, context.cwd)
    && /^[a-f0-9]{64}$/.test(value.policyDigest) && record(value.scope) && Array.isArray(value.scope.paths) && value.scope.paths.length > 0
    && value.scope.paths.every(nonempty) && Array.isArray(value.scope.operations)
    && value.scope.operations.every(operation => ["read", "create", "modify", "delete", "execute"].includes(operation))
    && value.scope.operations.some(operation => ["create", "modify", "delete"].includes(operation))
    && Array.isArray(value.contractRefs) && value.contractRefs.length > 0
    && value.contractRefs.every(reference => record(reference) && nonempty(reference.contractId) && nonempty(reference.revisionId) && nonempty(reference.incarnationId));
}
function matchesRoute(route: Route, raw: AdvisorHostExecuteContext): boolean {
  const parentFile = route.parent.sessionManager.getSessionFile(); const parent = raw.sessionManager.getHeader()?.parentSession;
  return raw.agent.kind === "sub" && !advisorAgent(raw.agent.name) && route.sessionManager === raw.sessionManager
    && route.sessionId === raw.sessionManager.getSessionId() && route.agentId === raw.agent.id && route.agentName === raw.agent.name
    && raw.agent.parentId === route.parent.agent.id && sameRoot(raw.cwd, route.owner.grant.workspaceRoot)
    && !!parent && (parent === route.parent.sessionManager.getSessionId() || !!parentFile && sameRoot(parent, parentFile));
}
async function current(owner: Owner): Promise<boolean> {
  if (!ownsParent(owner)) return false;
  try { return await owner.services.isCurrent(owner.grant, owner.scope.context) && ownsParent(owner); } catch { return false; }
}
function currentLineage(lineage: readonly Lineage[]): boolean {
  return lineage.every(({ scope, epoch }) => scope.active && scope.epoch === epoch && scope.sessionId === scope.context.sessionManager.getSessionId()
    && advisorHub(scope.api).roots.get(scope.context.sessionManager) === scope);
}
export interface NativeMutationDelegationRuntime {
  run(scope: HostScope, actualCallId: string, context: AdvisorHostExecuteContext, operation: () => Promise<unknown>): Promise<unknown>;
  observeSpawn(event: unknown, context: AdvisorHostExecuteContext): Promise<void>;
  bindChild(context: AdvisorHostExecuteContext): Promise<void>;
  scope(context: AdvisorHostExecuteContext): Promise<NativeMutationScopeGrant | undefined>;
}
/** Private actual-SDK lineage. Nothing is inferred from agent names, task JSON, workspace caches, or a Main ID. */
export function createNativeMutationDelegation(api: AdvisorHostAPI, services?: NativeMutationDelegationOptions): NativeMutationDelegationRuntime {
  const registration = {};
  async function delegated(raw: AdvisorHostExecuteContext): Promise<NativeMutationScopeGrant | undefined> {
    const route = routes.get(raw.sessionManager);
    return route && route.registration === registration && currentLineage(route.lineage) && matchesRoute(route, raw) && await current(route.owner) ? route.owner.grant : undefined;
  }
  return {
    async run(scope, toolCallId, raw, operation) {
      if (!services || advisorAgent(raw.agent.name)) return operation();
      const parent = hostContext(raw, scope.epoch);
      const inherited = routes.get(raw.sessionManager);
      let owner: Owner | undefined;
      if (inherited) {
        if (inherited.registration !== registration || !currentLineage(inherited.lineage) || !matchesRoute(inherited, raw) || !(await current(inherited.owner))) return operation();
        owner = inherited.owner;
      } else {
        const captured = services.capture(parent);
        if (captured && validGrant(captured, parent)) {
          const grant = freezeContractValue(structuredClone(captured));
          const proposed = { scope, epoch: scope.epoch, grant, services };
          if (await current(proposed)) owner = proposed;
        }
      }
      if (!owner) return operation();
      // The frame contains no invokeTool, execute callback, or arbitrary dispatcher.
      return frames.run({ owner, parent, parentSessionId: parent.sessionManager.getSessionId(), toolCallId, spawns: [],
        lineage: inherited?.lineage ?? [{ scope, epoch: scope.epoch }] }, operation);
    },
    async observeSpawn(event, raw) {
      const frame = frames.getStore();
      if (!frame || !record(event) || event.invocationKind !== "task" || !nonempty(event.agent) || advisorAgent(event.agent)
        || raw.sessionManager !== frame.parent.sessionManager || raw.sessionManager.getSessionId() !== frame.parentSessionId
        || raw.agent.id !== frame.parent.agent.id || !nonempty(event.spawnKey) || !currentLineage(frame.lineage) || !(await current(frame.owner))) return;
      // spawnKey is a host observation, never treated as an allocated child ID.
      frame.spawns.push({ agent: event.agent, bound: false });
    },
    async bindChild(raw) {
      if (routes.has(raw.sessionManager) || raw.agent.kind !== "sub" || advisorAgent(raw.agent.name)) return;
      const frame = frames.getStore();
      if (!frame || raw.agent.parentId !== frame.parent.agent.id || !currentLineage(frame.lineage) || !(await current(frame.owner)) || !sameRoot(raw.cwd, frame.owner.grant.workspaceRoot)) return;
      const parent = raw.sessionManager.getHeader()?.parentSession; const parentFile = frame.parent.sessionManager.getSessionFile();
      if (!parent || parent !== frame.parentSessionId && (!parentFile || !sameRoot(parent, parentFile))) return;
      const spawn = frame.spawns.find(value => !value.bound && value.agent === raw.agent.name);
      if (!spawn || !nonempty(raw.agent.id) || !nonempty(raw.sessionManager.getSessionId())) return;
      const childScope = advisorHub(api).roots.get(raw.sessionManager);
      if (!childScope?.active || childScope.sessionId !== raw.sessionManager.getSessionId()) return;
      spawn.bound = true;
      routes.set(raw.sessionManager, { owner: frame.owner, parent: frame.parent, sessionId: raw.sessionManager.getSessionId(), agentId: raw.agent.id, agentName: raw.agent.name, sessionManager: raw.sessionManager, registration, lineage: [...frame.lineage, { scope: childScope, epoch: childScope.epoch }] });
    },
    scope: delegated,
  };
}
