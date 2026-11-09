import path from "node:path";

export const CORE_VERIFICATION_TESTS = Object.freeze([
  "tests/multi-dialect-wire.test.ts",
  "tests/typesafe-transport-retry.test.ts",
  "tests/typesafe-resolver.test.ts",
  "tests/payload-safety.test.ts",
  "tests/trusted-tool-policy.test.ts",
  "tests/anti-blocking-middleware.test.ts",
  "tests/atomic-jev-judge.test.ts",
]);

/**
 * Deterministically select verification test assets based on fixed core invariants
 * and changed module paths. Never uses todo text or unauthenticated prose to steer test selection.
 */
export function selectVerificationTestAssets(
  _cwd: string,
  allTests: readonly string[],
  changedFiles: readonly string[] = []
): string[] {
  const existingAll = new Set(allTests);
  const core = CORE_VERIFICATION_TESTS.filter((t) => existingAll.has(t));
  // Directly include any changed file that is itself an existing test
  const directChangedTests = changedFiles.filter((f) => existingAll.has(f) || existingAll.has(f.replace(/\\/g, "/")));

  const changedBaseNames = changedFiles
    .map((f) => path.basename(f, path.extname(f)).replace(/\.test$/, "").replace(/\.(cjs|mjs|ts|js)$/, ""))
    .filter((n) => n.length > 0);
  const matchedByModule = allTests.filter((testPath) => {
    const testBase = path.basename(testPath, path.extname(testPath)).replace(/\.test$/, "");
    return changedBaseNames.some((changedBase) => {
      if (testBase === changedBase) return true;
      if (testBase.startsWith(`${changedBase}-`) || testBase.endsWith(`-${changedBase}`)) return true;
      return false;
    });
  });

  const combined = [...new Set([...core, ...directChangedTests, ...matchedByModule])];
  return combined.sort();
}
