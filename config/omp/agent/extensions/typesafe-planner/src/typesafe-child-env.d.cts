import type { Buffer } from "node:buffer";
import type { ChildProcess, ExecFileSyncOptions, ExecSyncOptions, SpawnOptions, SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";

export type ChildEnvironmentPurpose = "evidence-git" | "verification" | "egc-setup" | "deployment-acl" | "deployment-verify" | "deployment-sync" | "pointer-editor";
export type VerificationPurpose = "verification" | "deployment-verify";
export type ChildEnvironmentSource = Readonly<Record<string, string | undefined>>;
export interface ChildEnvironment extends NodeJS.ProcessEnv {}
export interface ChildPolicyOptions { source?: ChildEnvironmentSource; env?: never }
export interface ChildSpawnOptions extends Omit<SpawnOptions, "env">, ChildPolicyOptions {}
export interface ChildSpawnSyncOptions extends Omit<SpawnSyncOptions, "env">, ChildPolicyOptions {}
export interface ChildStringSpawnSyncOptions extends ChildSpawnSyncOptions { encoding: BufferEncoding }
export interface ChildBufferSpawnSyncOptions extends ChildSpawnSyncOptions { encoding?: "buffer" | null }
export type ChildStringSpawnSyncResult = SpawnSyncReturns<string>;
export type ChildBufferSpawnSyncResult = SpawnSyncReturns<Buffer>;
export type ChildSpawnSyncResult = SpawnSyncReturns<string | Buffer>;
export interface ChildExecOptions extends Omit<ExecSyncOptions, "env">, ChildPolicyOptions {}
export interface ChildExecFileOptions extends Omit<ExecFileSyncOptions, "env">, ChildPolicyOptions {}
export interface ChildStringExecOptions extends ChildExecOptions { encoding: BufferEncoding }
export interface ChildStringExecFileOptions extends ChildExecFileOptions { encoding: BufferEncoding }
export interface ChildBufferExecOptions extends ChildExecOptions { encoding?: "buffer" | null }
export interface ChildBufferExecFileOptions extends ChildExecFileOptions { encoding?: "buffer" | null }
export type ChildProcessOutput = string | Buffer;
export class ChildEnvironmentError extends Error {
  constructor(code: string);
  readonly code: string;
}
export interface VerificationHome {
  environment(purpose: VerificationPurpose, source?: ChildEnvironmentSource): ChildEnvironment;
  spawn(purpose: VerificationPurpose, command: string, args?: readonly string[], options?: ChildSpawnOptions): ChildProcess;
  execFileSync(purpose: VerificationPurpose, command: string, args: readonly string[], options: ChildStringExecFileOptions): string;
  execFileSync(purpose: VerificationPurpose, command: string, args?: readonly string[], options?: ChildBufferExecFileOptions): Buffer;
  execFileSync(purpose: VerificationPurpose, command: string, args?: readonly string[], options?: ChildExecFileOptions): ChildProcessOutput;
  cleanup(): void;
}
export function buildChildEnvironment(purpose: ChildEnvironmentPurpose, source?: ChildEnvironmentSource): ChildEnvironment;
export function spawnChild(purpose: ChildEnvironmentPurpose, command: string, args?: readonly string[], options?: ChildSpawnOptions): ChildProcess;
export function spawnChildSync(purpose: ChildEnvironmentPurpose, command: string, args: readonly string[], options: ChildStringSpawnSyncOptions): ChildStringSpawnSyncResult;
export function spawnChildSync(purpose: ChildEnvironmentPurpose, command: string, args?: readonly string[], options?: ChildBufferSpawnSyncOptions): ChildBufferSpawnSyncResult;
export function spawnChildSync(purpose: ChildEnvironmentPurpose, command: string, args?: readonly string[], options?: ChildSpawnSyncOptions): ChildSpawnSyncResult;
export function execChildSync(purpose: ChildEnvironmentPurpose, command: string, options: ChildStringExecOptions): string;
export function execChildSync(purpose: ChildEnvironmentPurpose, command: string, options?: ChildBufferExecOptions): Buffer;
export function execChildSync(purpose: ChildEnvironmentPurpose, command: string, options?: ChildExecOptions): ChildProcessOutput;
export function execFileChildSync(purpose: ChildEnvironmentPurpose, command: string, args: readonly string[], options: ChildStringExecFileOptions): string;
export function execFileChildSync(purpose: ChildEnvironmentPurpose, command: string, args?: readonly string[], options?: ChildBufferExecFileOptions): Buffer;
export function execFileChildSync(purpose: ChildEnvironmentPurpose, command: string, args?: readonly string[], options?: ChildExecFileOptions): ChildProcessOutput;
export function createVerificationHome(): VerificationHome;
