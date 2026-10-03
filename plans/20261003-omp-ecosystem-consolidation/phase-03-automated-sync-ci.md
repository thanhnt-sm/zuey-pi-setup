---
phase: 3
title: "Automated Upstream Sync CI & Alert Workflow"
status: pending
priority: P2
effort: "2.5h"
dependencies: [1, 2]
---

# Phase 3: Automated Upstream Sync CI & Alert Workflow

## Overview
Implement an automated synchronization check and continuous integration pipeline that periodically monitors the upstream `zuey-pi` repository, detects safe configuration updates, validates them against TDD test suites, and generates Pull Requests without human intervention.

## Requirements
- Functional:
  - Create `scripts/omp-sync-check-upstream.sh`:
    - Checks upstream refs without modifying local working directory.
    - Exits 0 if local is up-to-date with upstream safe files.
    - Exits 2 if new upstream changes are available to cherry-pick.
  - Create GitHub Actions workflow `.github/workflows/upstream-sync.yml`:
    - Runs on schedule (daily cron) and manual `workflow_dispatch`.
    - Fetches upstream, executes `omp-sync-upstream.sh`.
    - Runs all 3 test suites (`test-omp-syncignore.sh`, `test-omp-sync-extraction.sh`, `test-omp-migration.sh`).
    - Uses `peter-evans/create-pull-request` to open a PR if safe changes exist and all tests pass.
- Non-functional:
  - CI must never push directly to `main` branch.
  - Fail-fast: if any test fails, abort PR creation immediately and open a failure issue.

## Architecture
```
Cron Schedule / Manual Dispatch
               │
               ▼
.github/workflows/upstream-sync.yml
               │
       [git fetch upstream]
               │
   scripts/omp-sync-check-upstream.sh
        ┌──────┴──────┐
   (No diff)      (New changes)
        │             │
      Exit 0          ▼
             scripts/omp-sync-upstream.sh
                      │
            Run TDD Test Suites
               (100% Pass Required)
                      │
                      ▼
         Create Pull Request:
       "feat(upstream): sync safe updates"
```

## Related Code Files
- Create: `scripts/omp-sync-check-upstream.sh`
- Create: `.github/workflows/upstream-sync.yml`
- Create: `tests/test-sync-check.sh`
- Modify: `scripts/omp-sync-upstream.sh`

## Implementation Steps
1. **3.3.T (TDD Tests First)**:
   - Create `tests/test-sync-check.sh`.
   - Setup a mock upstream repo and mock local clone.
   - Assert `scripts/omp-sync-check-upstream.sh` returns exit code 0 when identical.
   - Commit a new safe file (`config/APPEND_SYSTEM.md`) in upstream mock.
   - Assert `scripts/omp-sync-check-upstream.sh` detects changes and exits code 2 without modifying local files.
2. **3.3.I (Implementation)**:
   - Implement `scripts/omp-sync-check-upstream.sh` using `git rev-parse` and `git diff --name-only <upstream-ref> HEAD`.
   - Implement `.github/workflows/upstream-sync.yml` with automated test validation and PR generation.
3. **3.3.V (Verification)**:
   - Run `bash tests/test-sync-check.sh` (Expect: 100% PASS).
   - Validate YAML syntax of `.github/workflows/upstream-sync.yml`.

## Success Criteria
- [ ] `tests/test-sync-check.sh` passes cleanly.
- [ ] `scripts/omp-sync-check-upstream.sh` detects new upstream changes non-destructively.
- [ ] GitHub Actions workflow file is valid and enforces 100% test pass gate before opening PRs.

## Risk Assessment
- **Risk**: GitHub Actions bot creating PRs with conflicting upstream changes.
  - *Mitigation*: The workflow runs `test-omp-syncignore.sh` and `test-omp-sync-extraction.sh` inside CI. If conflict plugins are detected or tests fail, the workflow immediately fails and cancels PR creation.
