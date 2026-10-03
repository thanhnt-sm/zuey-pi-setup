---
title: "OMP Ecosystem Consolidation and Upstream Sync Evolution"
description: "Consolidate documentation ground truth, harden TypeSafe evidence collection, automate upstream synchronization via CI, and validate cross-platform E2E restore."
status: pending
priority: P1
effort: "9.5h"
branch: main
tags: [omp, upstream-sync, typesafe, tdd, ci-cd, macos-m1]
blockedBy: []
blocks: []
created: 2026-10-03
---

# OMP Ecosystem Consolidation and Upstream Sync Evolution

## Context & Ground-Truth Synthesis
The Oh-My-Pi (`omp`) environment has achieved core synchronization capability with upstream `zuey-pi` via commit `de7e0ba` (`scripts/omp-sync-upstream.sh`, `.omp-syncignore`, and 3 passing TDD test suites). However, several key evolutionary requirements remain to ensure production reliability:
1. **Documentation Parity**: Legacy Pi documentation (`docs/pi-setup-migration.md`) and new OMP architecture (`docs/omp-setup-migration.md`) need a unified architectural matrix.
2. **TypeSafe Verification Hardening**: The `typesafe-planner` extension currently fails macro-checks on clean working trees after commits because `evidence-collector.ts` inspects live unstaged diffs rather than commit history.
## External Host Isolation Invariants (Mandatory & Non-Negotiable)
- **Path Isolation**: All tools, tests, and configurations MUST operate strictly within repository local paths (`config/omp/`, `scripts/`, `tests/`) or the isolated user home directory `~/.omp/`.
- **Absolute Host Boundary**: Zero modification, reading, or referencing of external host account settings or external AI assistant profiles.
- **Environment Scrubbing**: Environment variables containing external API secrets must be sanitized before spawning subprocesses or transmitting payloads to external judge endpoints.
- **Fail-Closed Egress**: All outgoing judge requests undergo secret redaction (masking API keys, Bearer tokens, private keys) before transmission.

---

## Algorithmic Architecture & Error Handling Depth

### 1. Robust Evidence Extraction Algorithm (`evidence-collector.ts`)
```ts
// Fallback hierarchy to prevent false 0% completeness scores on clean working trees
async function extractAuthoritativeDiff(cwd: string): Promise<string> {
  // 1. Check unstaged working tree modifications
  const unstaged = (await executeTestCommand("git diff", cwd, 5000)).output.trim();
  if (unstaged) return unstaged;

  // 2. Check staged modifications
  const staged = (await executeTestCommand("git diff --cached", cwd, 5000)).output.trim();
  if (staged) return staged;

  // 3. Check most recent commit if working tree is clean
  const hasParent = (await executeTestCommand("git rev-parse --verify HEAD~1", cwd, 3000)).exitCode === 0;
  if (hasParent) {
    const commitDiff = (await executeTestCommand("git diff HEAD~1 HEAD", cwd, 5000)).output.trim();
    if (commitDiff) return commitDiff;
  }

  // 4. Safe fallback for initial commit or unchanged repo
  const showHead = (await executeTestCommand("git show --stat --oneline HEAD", cwd, 5000)).output.trim();
  return showHead || "+ // No diff detected";
}
```

### 2. Upstream Non-Destructive Check Algorithm (`omp-sync-check-upstream.sh`)
```bash
# Algorithmic check without workspace mutation
set -euo pipefail
# Preflight: verify jq and git
command -v git >/dev/null 2>&1 || { echo "Git missing" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq missing" >&2; exit 1; }

# Step 1: Fetch remote refs with 15s timeout
git fetch --timeout=15 upstream main || { echo "Fetch timeout" >&2; exit 1; }

# Step 2: Check diff on safe files list
SAFE_PATHS=("config/APPEND_SYSTEM.md" "config/extensions/compaction-policy.ts" "config/extensions/pi-footer.json" "config/extensions/pi-footer-cache-tps.ts")
CHANGES_DETECTED=0
for p in "${SAFE_PATHS[@]}"; do
  if ! git diff --quiet HEAD "upstream/main:$p" 2>/dev/null; then
    CHANGES_DETECTED=1
    break
  fi
done

# Step 3: Check settings.json for new pinned packages
# Exits: 0 = up-to-date, 2 = updates available, 1 = error
if [ "$CHANGES_DETECTED" -eq 1 ]; then exit 2; else exit 0; fi
```

---

## Phases Table

| Phase | Name | Focus | Priority | Effort | Status |
| :---: | :--- | :--- | :---: | :---: | :---: |
| **1** | [Baseline-Reconciliation](./phase-01-baseline-reconciliation.md) | Docs parity, feature matrix & automated doc test | P1 | 2.0h | Pending |
| **2** | [TypeSafe-Judge-Hardening](./phase-02-typesafe-judge-hardening.md) | Evidence collector fallback to commit diff & gate tooling | P1 | 3.0h | Pending |
| **3** | [Automated-Sync-CI](./phase-03-automated-sync-ci.md) | GitHub Actions daily cron & non-destructive check script | P2 | 2.5h | Pending |
| **4** | [Restore-Hydration-E2E](./phase-04-restore-hydration-e2e.md) | E2E restore lifecycle test on macOS M1 & Linux mock | P2 | 2.0h | Pending |

---

## Concrete Actionability & Verification Plan

### Phase 1: Baseline Synthesis & Documentation Reconciliation
- **Tasks**:
  1. Author `docs/omp-architecture-matrix.md` detailing HookAPI, ExtensionAPI, and model routing boundaries.
  2. Implement `tests/test-doc-parity.sh` checking for dead links, script references, and clean `.env.example`.
- **Concrete Verification Command**:
  ```bash
  bash tests/test-doc-parity.sh
  ```
  *Expected Output*: `=== ALL DOC PARITY TESTS PASSED ===` (Exit Code 0).

### Phase 2: TypeSafe Judge & Evidence Collector Hardening
- **Tasks**:
  1. Patch `evidence-collector.ts` with 3-tier fallback (`git diff` -> `git diff --cached` -> `git diff HEAD~1`).
  2. Author `scripts/omp-verify-gate.sh` CLI wrapper.
  3. Author `tests/test-typesafe-evidence.sh`.
- **Concrete Verification Command**:
  ```bash
  bash tests/test-typesafe-evidence.sh
  ```
  *Expected Output*: `✓ PASS: Clean committed repository yields valid diff; P >= 0.70` (Exit Code 0).

### Phase 3: Automated Upstream Sync CI & Alert Workflow
- **Tasks**:
  1. Implement `scripts/omp-sync-check-upstream.sh` (non-destructive check).
  2. Implement `.github/workflows/upstream-sync.yml` with PR creation on 100% test pass.
  3. Author `tests/test-sync-check.sh`.
- **Concrete Verification Command**:
  ```bash
  bash tests/test-sync-check.sh
  ```
  *Expected Output*: `✓ PASS: Upstream change detector returns 0 on clean and 2 on new upstream commits` (Exit Code 0).

### Phase 4: Cross-Platform Restore & Plugin Hydration E2E Validation
- **Tasks**:
  1. Enhance `scripts/omp-setup-restore.sh` with plugin healthcheck and Bun/NPM fallback.
  2. Author `tests/test-omp-restore-e2e.sh`.
  3. Update `backups/omp-setup-portable.tar.gz`.
- **Concrete Verification Command**:
  ```bash
  bash tests/test-omp-restore-e2e.sh
  ```
  *Expected Output*: `✓ PASS: Full restore, shellPath injection, and plugin hydration verified` (Exit Code 0).

---

## Full Regression Gate (Final Acceptance Gate)
```bash
bash tests/test-omp-syncignore.sh && \
bash tests/test-omp-sync-extraction.sh && \
bash tests/test-omp-migration.sh && \
bash tests/test-doc-parity.sh && \
bash tests/test-typesafe-evidence.sh && \
bash tests/test-sync-check.sh && \
bash tests/test-omp-restore-e2e.sh
```
*Inviolable Rule*: 100% pass across all 7 test suites is required before any release tag or final sign-off.
