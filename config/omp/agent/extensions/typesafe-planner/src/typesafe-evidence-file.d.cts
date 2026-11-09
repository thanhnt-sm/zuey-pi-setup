import type { Buffer } from "node:buffer";

export interface WorkspaceFileIdentity {
  readonly dev: string;
  readonly ino: string;
  readonly mode: string;
  readonly nlink: string;
  readonly size: string;
  readonly mtimeNs: string;
  readonly ctimeNs: string;
  readonly birthtimeNs: string;
}
export interface WorkspaceFileRead {
  bytes: Buffer;
  sha256: string;
  identity: WorkspaceFileIdentity;
}
export interface WorkspaceFileReadOptions { maxBytes: number }
export interface WorkspaceFileListOptions { maxFiles: number }
export type WorkspaceFileFailureKind = "security" | "unavailable";
export class WorkspaceFileError extends Error {
  constructor(code: string, kind?: WorkspaceFileFailureKind);
  readonly code: string;
  readonly kind: WorkspaceFileFailureKind;
}
export function readWorkspaceFile(root: string, relativePath: string, options: WorkspaceFileReadOptions): WorkspaceFileRead;
export function listWorkspaceFiles(root: string, relativeDirectory: string, options: WorkspaceFileListOptions): string[];
export interface RecoveryReportInput { id: string; content: string }
export interface RecoveryReportWrite { path: string; sha256: string }
export function writeRecoveryReport(root: string, input: RecoveryReportInput): RecoveryReportWrite;
