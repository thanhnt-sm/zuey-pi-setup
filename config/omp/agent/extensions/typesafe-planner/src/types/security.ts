export interface ASTAnalysisResult {
  isSafe: boolean;
  issues: string[];
  deletedAssertions: string[];
  modifiedSuites: string[];
}

export interface XMLEnclosureSchema {
  boundary: string;
  validTags: string[];
  sanitized: boolean;
}

export interface AuthState {
  status: "authenticated" | "unauthenticated" | "refreshing" | "revoked";
  tokenHash?: string;
  retryCount: number;
}

export interface RemediationDirective {
  instruction: string;
  immutableConstraints: string[];
  failureReasons: string[];
  actionItems: string[];
  taskId?: string;
  criteria?: string[];
}
