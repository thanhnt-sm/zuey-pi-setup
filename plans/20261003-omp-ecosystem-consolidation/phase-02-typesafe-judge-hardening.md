---
phase: 2
title: "TypeSafe Judge & Evidence Collector Hardening"
status: pending
priority: P1
effort: "3h"
dependencies: [1]
---

# Phase 2: TypeSafe Judge & Evidence Collector Hardening

## Overview
Remediate the root cause of false-positive Gate 2 Macro-Check rejections in `typesafe-planner.ts` and `evidence-collector.ts`, ensuring that committed changes are recognized in evidence collection and task-interception heuristics do not deadlock on clean working trees.

## Requirements
- Functional:
  - Enhance `evidence-collector.ts` to inspect recent git commits (`git diff HEAD~1` or staged changes `git diff --cached`) when the working tree is clean (`git diff` is empty).
  - Update `handleTodoInterception` in `typesafe-planner.ts` to support reading plan criteria from active plan files or context rather than falling back to literal `taskId` text.
  - Implement a CLI verification utility `scripts/omp-verify-gate.sh` that bundles ground-truth test outputs, plan criteria, and git diff into a validated TypeSafe System One payload.
- Non-functional:
  - Strict adherence to zero-secret egress redaction.
  - Non-breaking compatibility with both OMP extension runtime and Claude Code MCP hook invocations.

## Architecture
```
Current Flawed Flow:
todo(done, "Perform Gate 2 check") ──► typesafe-planner.ts
                                             │ (matches /gate/i)
                                             ▼
                                    evidence-collector.ts
                                             │ (runs: git diff)
                                             ▼
                                    Diff is empty (+ // No diff)
                                             │
                                             ▼
                                    TypeSafe Judge: P=0.17 (FAIL)

Hardened Flow:
todo(done, "task") ──► typesafe-planner.ts
                              │
                              ▼
                     evidence-collector.ts
                              │ (Checks unstaged -> staged -> HEAD~1)
                              ▼
                     Real diff retrieved + Plan criteria loaded
                              │
                              ▼
                     TypeSafe Judge: P >= 0.70 (PASS)
```

## Related Code Files
- Create: `scripts/omp-verify-gate.sh`
- Create: `tests/test-typesafe-evidence.sh`
- Modify: `C:/Users/thant/Projects/omp_extension/src/evidence-collector.ts`
- Modify: `C:/Users/thant/Projects/omp_extension/typesafe-planner.ts`
- Modify: `config/omp/agent/extensions/typesafe-planner.ts`

## Implementation Steps
1. **3.2.T (TDD Tests First)**:
   - Create `tests/test-typesafe-evidence.sh`.
   - Setup a mock git repository with a committed change (clean working tree).
   - Test that the evidence collection logic retrieves the commit diff (`git diff HEAD~1`) instead of returning empty.
   - Assert that an empty git diff on a clean tree does not cause false-positive zero completeness ratings.
2. **3.2.I (Implementation)**:
   - Update `evidence-collector.ts`:
     ```ts
     let gitDiff = gitDiffRes.output.trim();
     if (!gitDiff) {
       const cachedDiff = await executeTestCommand("git diff --cached", cwd, 5000);
       gitDiff = cachedDiff.output.trim();
     }
     if (!gitDiff) {
       const commitDiff = await executeTestCommand("git diff HEAD~1 HEAD", cwd, 5000);
       gitDiff = commitDiff.output.trim();
     }
     ```
   - Update `typesafe-planner.ts` to locate active plan files from `plans/` if `planPath` is omitted from `todo` args.
   - Build `scripts/omp-verify-gate.sh` as an autonomous tool to run Gate 2 evaluations with explicit plan files.
3. **3.2.V (Verification)**:
   - Run `bash tests/test-typesafe-evidence.sh` (Expect: 100% PASS).
   - Execute `scripts/omp-verify-gate.sh` on the existing commit `de7e0ba` and assert `meets_criteria >= 0.70`.

## Success Criteria
- [ ] `tests/test-typesafe-evidence.sh` passes cleanly.
- [ ] Evidence collector properly reports non-empty diff for committed work.
- [ ] `scripts/omp-verify-gate.sh` correctly interfaces with `xd://typesafe_judge`.

## Risk Assessment
- **Risk**: Modifying `evidence-collector.ts` might impact Claude Code hooks outside OMP.
  - *Mitigation*: Fallback to `HEAD~1` only triggers when `git diff` is completely empty, preserving identical behavior for active worktree diffs.
