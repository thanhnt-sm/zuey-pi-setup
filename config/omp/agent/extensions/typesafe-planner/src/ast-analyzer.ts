import type { ASTAnalysisResult } from "./types/security";

interface DiffSection {
  oldPath?: string;
  newPath?: string;
  lines: string[];
}

const TEST_PATH = /(?:(?:^|\/)(?:tests?|__tests__|spec)\/.*\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$)/i;
const ASSERTION = /(?:expect\s*\(|assert(?:\s*\.\s*[a-zA-Z]+)?\s*\()/;
const SUITE = /(?:describe|it|test)\s*\(/;
const SKIPPED_SUITE = /(?<![\p{ID_Continue}$])(?:(?:describe|it|test)\s*\.\s*(?:skip|todo)\s*\(|(?:xdescribe|xit|xtest)\s*\()/u;
const COMMENTED_ASSERTION = /^\s*(?:\/\/|\/\*|\*)\s*.*(?:expect\s*\(|assert(?:\s*\.\s*[a-zA-Z]+)?\s*\()/;
const LITERAL = /(?:true|false|0|1|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')/;
const TAUTOLOGY = new RegExp(
  String.raw`expect\s*\(\s*(${LITERAL.source})\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)`
);

function normalizePatchPath(path: string | undefined): string | undefined {
  if (!path || path === "/dev/null") return undefined;
  const token = path.trim().replace(/^"|"$/g, "").split(/\t|\s+\d{4}-\d{2}-\d{2}/, 1)[0];
  return token.replace(/^[ab]\//, "");
}

function parseGitHeaderPaths(line: string): [string, string] | undefined {
  const paths = line.slice("diff --git ".length).match(/^("(?:\\.|[^"])*"|\S+)\s+("(?:\\.|[^"])*"|\S+)$/);
  return paths ? [paths[1], paths[2]] : undefined;
}

function parseDiffSections(diff: string): DiffSection[] {
  const sections: DiffSection[] = [];
  let current: DiffSection | undefined;
  const ensureCurrent = (): DiffSection => (current ??= { lines: [] });

  for (const line of diff.split(/\r?\n/)) {
    const gitPaths = line.startsWith("diff --git ") ? parseGitHeaderPaths(line) : undefined;
    if (gitPaths) {
      if (current) sections.push(current);
      current = {
        oldPath: normalizePatchPath(gitPaths[0]),
        newPath: normalizePatchPath(gitPaths[1]),
        lines: [],
      };
      continue;
    }
    const oldHeader = /^---\s+(.+)$/.exec(line);
    if (oldHeader) {
      const hasPatchContent = current?.lines.some(
        (entry) => (entry.startsWith("-") && !entry.startsWith("---")) || (entry.startsWith("+") && !entry.startsWith("+++"))
      );
      if (current && hasPatchContent) {
        sections.push(current);
        current = { lines: [] };
      }
      ensureCurrent().oldPath = normalizePatchPath(oldHeader[1]);
      continue;
    }
    const newHeader = /^\+\+\+\s+(.+)$/.exec(line);
    if (newHeader) {
      ensureCurrent().newPath = normalizePatchPath(newHeader[1]);
      continue;
    }
    ensureCurrent().lines.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

function isTestSection(section: DiffSection): boolean {
  const paths = [section.oldPath, section.newPath].filter((path): path is string => Boolean(path));
  return paths.length === 0 || paths.some((path) => TEST_PATH.test(path));
}

function addIssue(result: ASTAnalysisResult, issue: string): void {
  if (!result.issues.includes(issue)) result.issues.push(issue);
}

/**
 * Conservative, line-oriented test-evasion heuristic. It is not an AST or
 * semantic proof: only test-file patch sections (or legacy headerless snippets)
 * are classified, and removals are balanced within their own file section.
 */
export function analyzeDiffForTestEvasion(diff: string): ASTAnalysisResult {
  const result: ASTAnalysisResult = {
    isSafe: true,
    issues: [],
    deletedAssertions: [],
    modifiedSuites: [],
    testEvasion: false,
  };

  if (!diff || diff.trim() === "") return result;

  for (const section of parseDiffSections(diff)) {
    if (!isTestSection(section)) continue;

    const removedAssertions: string[] = [];
    const addedAssertions: string[] = [];
    const removedSuites: string[] = [];
    const addedSuites: string[] = [];
    const skippedSuites: string[] = [];
    let commentedAssertion = false;
    let tautology = false;

    for (const line of section.lines) {
      if (line.startsWith("-") && !line.startsWith("---")) {
        const content = line.slice(1);
        if (ASSERTION.test(content) && !COMMENTED_ASSERTION.test(content)) removedAssertions.push(line.trim());
        if (SUITE.test(content) && !/^\s*(?:\/\/|\/\*|\*)/.test(content)) removedSuites.push(line.trim());
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        const content = line.slice(1);
        if (ASSERTION.test(content) && !COMMENTED_ASSERTION.test(content)) addedAssertions.push(line.trim());
        if (SUITE.test(content) && !/^\s*(?:\/\/|\/\*|\*)/.test(content)) addedSuites.push(line.trim());
        if (COMMENTED_ASSERTION.test(content)) commentedAssertion = true;
        if (SKIPPED_SUITE.test(content)) skippedSuites.push(line.trim());
        if (TAUTOLOGY.test(content)) tautology = true;
      }
    }

    if (removedAssertions.length > addedAssertions.length) {
      result.deletedAssertions.push(...removedAssertions.slice(addedAssertions.length));
      addIssue(result, "Test evasion detected: git diff contains deleted assertions (expect/assert). Deleting tests to fake completion is prohibited.");
    }
    if (removedSuites.length > addedSuites.length) {
      result.modifiedSuites.push(...removedSuites.slice(addedSuites.length));
      addIssue(result, "Detected deletion of test block or suite.");
    }
    if (commentedAssertion) {
      addIssue(result, "Detected commented-out test assertion in additions.");
    }
    if (skippedSuites.length > 0) {
      result.modifiedSuites.push(...skippedSuites);
      addIssue(result, "Detected skipped or todo test suite in additions.");
    }
    if (tautology) {
      addIssue(result, "Detected trivial tautology assertion (e.g., expect(true).toBe(true)).");
    }
  }

  result.testEvasion = result.issues.length > 0;
  result.isSafe = !result.testEvasion;
  return result;
}
