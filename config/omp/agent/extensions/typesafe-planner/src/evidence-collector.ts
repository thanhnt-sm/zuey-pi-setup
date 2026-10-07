import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export class SecurityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityViolationError";
  }
}

export interface TaskEvidenceOptions {
  cwd?: string;
  taskId?: string;
  planPath?: string;
  testCommand?: string;
  timeoutMs?: number;
  untrustedAgentState?: string;
}

export interface TaskEvidenceResult {
  gitStatus: string;
  gitDiff: string;
  testExitCode: number | null;
  testOutput: string;
  criteria: string[];
  cleanWorkingTree: boolean;
  timestamp: string;
}

/**
 * Validates that a path does NOT target ~/.claude, .claude subdirectories,
 * or Claude configuration credentials.
 */
export function assertPathIsClaudeSafe(targetPath: string): void {
  const resolved = path.resolve(targetPath);
  const home = os.homedir();
  const claudeHomeDir = path.join(home, ".claude");
  const claudeJsonPath = path.join(home, ".claude.json");

  const normalized = resolved.replace(/\\/g, "/");
  const normalizedClaudeHome = claudeHomeDir.replace(/\\/g, "/");
  const normalizedClaudeJson = claudeJsonPath.replace(/\\/g, "/");

  if (
    normalized === normalizedClaudeHome ||
    normalized.startsWith(normalizedClaudeHome + "/") ||
    normalized === normalizedClaudeJson ||
    normalized.includes("/.claude/") ||
    normalized.endsWith("/.claude")
  ) {
    throw new SecurityViolationError(
      `Access to Claude configuration or directory is strictly prohibited: ${targetPath}`
    );
  }
}

/**
 * Sanitizes environment variables to prevent leaking Anthropic or Claude
 * credentials to spawned child processes.
 */
export function sanitizeEnvironment(
  env?: Record<string, string | undefined>
): Record<string, string> {
  const source = env ?? process.env;
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (
      value !== undefined &&
      !key.startsWith("ANTHROPIC_") &&
      !key.startsWith("CLAUDE_")
    ) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Extracts acceptance criteria checklists and tasks from markdown plan content.
 */
export function extractCriteriaFromPlan(
  planContent: string,
  _taskId?: string
): string[] {
  const lines = planContent.split("\n");
  const criteria: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Matches markdown checkboxes: - [ ] text or - [x] text
    const checkboxMatch = trimmed.match(/^-\s*\[([ xX])\]\s*(.+)$/);
    if (checkboxMatch && checkboxMatch[2]) {
      criteria.push(checkboxMatch[2].trim());
    }
  }

  if (criteria.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const numMatch = trimmed.match(/^\d+\.\s+\*\*(.+?)\*\*:\s*(.+)$/);
      if (numMatch && numMatch[1] && numMatch[2]) {
        criteria.push(`${numMatch[1]}: ${numMatch[2]}`);
      }
    }
  }

  return criteria;
}
/**
 * Executes a shell command securely in an isolated child process with timeout and sanitized env.
 */
export async function executeTestCommand(
  command: string,
  cwd: string,
  timeoutMs = 15000
): Promise<{ exitCode: number; output: string }> {
  const cleanEnv = sanitizeEnvironment();
  const { promise, resolve } = Promise.withResolvers<{ exitCode: number; output: string }>();

  const child = spawn(command, {
    cwd,
    env: cleanEnv,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });

  const timer = setTimeout(() => {
    child.kill();
    resolve({
      exitCode: 124,
      output: output + `\n[Command timed out after ${timeoutMs}ms]`,
    });
  }, timeoutMs);

  child.on("close", (code) => {
    clearTimeout(timer);
    resolve({
      exitCode: code ?? 1,
      output,
    });
  });

  child.on("error", (err) => {
    clearTimeout(timer);
    resolve({
      exitCode: 1,
      output: output + `\n[Process spawn error: ${err.message}]`,
    });
  });

  return promise;
}

/**
 * Collects ground-truth OS evidence for a task: Git diff, working tree status,
 * test suite exit code, and authoritative criteria from plan.
 */
export async function collectTaskEvidence(
  options: TaskEvidenceOptions
): Promise<TaskEvidenceResult> {
  const cwd = options.cwd ?? process.cwd();

  if (options.planPath) {
    assertPathIsClaudeSafe(options.planPath);
  }

  // 1. Git working tree status
  const gitStatusRes = await executeTestCommand("git status --porcelain", cwd, 5000);
  const gitStatus = gitStatusRes.output.trim();

  // 2. Git diff
  // 2. Git diff (capture staged and unstaged changes, fall back to plain git diff if HEAD doesn't exist)
  let gitDiffRes = await executeTestCommand("git diff HEAD", cwd, 5000);
  if (gitDiffRes.exitCode !== 0) {
    gitDiffRes = await executeTestCommand("git diff", cwd, 5000);
  }
  const gitDiff = gitDiffRes.output.trim();
  // 3. Test execution if command provided
  let testExitCode: number | null = null;
  let testOutput = "";
  if (options.testCommand) {
    const testRes = await executeTestCommand(options.testCommand, cwd, options.timeoutMs ?? 15000);
    testExitCode = testRes.exitCode;
    testOutput = testRes.output;
  }

  // 4. Criteria extraction from plan if path provided
  let criteria: string[] = [];
  if (options.planPath) {
    try {
      const planContent = await fs.readFile(options.planPath, "utf8");
      criteria = extractCriteriaFromPlan(planContent, options.taskId);
    } catch {
      criteria = [];
    }
  }

  return {
    gitStatus,
    gitDiff,
    testExitCode,
    testOutput,
    criteria,
    cleanWorkingTree: gitStatus.length === 0,
    timestamp: new Date().toISOString(),
  };
}
