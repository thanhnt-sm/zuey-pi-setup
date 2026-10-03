# Context
The user needs an automated solution to safely synchronize updates from the upstream `zuey-pi` repository into their isolated Oh-My-Pi (`omp`) environment. Because `omp` natively handles features like advisors, LSP, and fallbacks, a direct merge of `pi` configurations would break the `omp` engine. The solution must automatically cherry-pick safe UI/prompt updates and filter out conflicting core extensions to maintain compatibility and stability without manual intervention.

## Validation Log
*Decisions from adversarial validation (Red Team & Architecture Review):*
- **Git Strategy**: Rejected `git merge` due to local history pollution and unmanageable conflict risks. **Resolution**: Use `git fetch upstream` + `git show` for targeted file extraction.
- **Plugin Filtering**: Rejected hardcoded Node.js script (brittle, heavy) and wildcard versions (supply-chain vulnerability). **Resolution**: Use `jq` in bash, declarative `.omp-syncignore` blocklist, and pin exact upstream plugin versions.
- **Backup Strategy**: Rejected synchronous tarball generation (wastes I/O). **Resolution**: Make backup optional or conditionally triggered on diff.
- **Error State**: Added `set -e` traps to prevent intermediate broken states.

# Approach
1. **Create the Sync Orchestrator (`scripts/omp-sync-upstream.sh`)**:
   - Script verifies `upstream` remote exists (adds `https://github.com/mrgoonie/zuey-pi-setup.git` if missing).
   - Executes `git fetch upstream` to update refs.
   - **(Red-Team Fix)** Uses `git show upstream/main:<path> > <dest>` instead of `git merge` to cleanly extract files without polluting local branch history.

2. **Automated Safe File Extraction**:
   - Extract known safe files from upstream directly to `omp` mirror:
     - `git show upstream/main:config/APPEND_SYSTEM.md > config/omp/agent/APPEND_SYSTEM.md`
     - `git show upstream/main:config/extensions/compaction-policy.ts > config/omp/agent/extensions/compaction-policy.ts`
     - `git show upstream/main:config/extensions/pi-footer.json > config/omp/agent/extensions/pi-footer.json`
     - `git show upstream/main:config/extensions/pi-footer-cache-tps.ts > config/omp/agent/extensions/pi-footer-cache-tps.ts`

3. **Declarative Plugin Deduplication (TDD-Driven)**:
   - **(Red-Team Fix)** Create `config/omp/.omp-syncignore` listing known conflicts: `pi-advisor-flow`, `pi-model-fallback`, `pi-lens`.
   - Use `jq` directly in the bash script to read `config/settings.json` (from upstream/main via `git show`).
   - Filter packages present in `.omp-syncignore`.
   - **(Security Fix)** Inject remaining valid packages into `config/omp/plugins/package.json` maintaining the exact pinned versions from upstream to prevent dependency confusion attacks.

4. **Conditional Backup (Performance Fix)**:
   - Check `git diff --quiet config/omp`. If changes exist, optionally prompt or automatically trigger `./scripts/omp-setup-backup.sh`.

# Critical files & anchors
- `scripts/omp-sync-upstream.sh`: New bash script. Handles `git fetch`, `git show`, and `jq` orchestration.
- `config/omp/.omp-syncignore`: New declarative blocklist for conflicting plugins.

# TDD (Test-Driven Development) Steps
*Write these tests before implementation:*

1. **Write `tests/test-omp-syncignore.sh`**:
   - **Test 1 (Blocklist)**: Mock an upstream `settings.json` containing `pi-lens`. Run the `jq` filter logic. Assert `pi-lens` is missing from output.
   - **Test 2 (Pinning)**: Mock an upstream `settings.json` with `"npm:pi-web-access": "^1.2.0"`. Assert the injected output retains `^1.2.0` exactly, not `latest` or `*`.
2. **Write `tests/test-omp-sync-extraction.sh`**:
   - **Test 3 (Git Show Isolation)**: Verify that running the orchestrator script on a mock repo does not advance HEAD or create a MERGE_HEAD commit, ensuring the local branch remains isolated.

# Verification
1. Run unit tests in `tests/test-omp-syncignore.sh` (Expect: Green).
2. Add a dummy safe package and a dummy dangerous package (e.g., `npm:pi-lens`) to the upstream mock.
3. Run `./scripts/omp-sync-upstream.sh`.
4. Inspect `config/omp/plugins/package.json`. Safe package must be present with a pinned version; `pi-lens` must be absent.
5. Run `git status`. Verify no merge conflicts or dirty git history (besides the intentionally modified `config/omp` files).

# Assumptions & contingencies
- **Assumption:** `jq` is installed. **Contingency:** Bash script aborts immediately with a clear prompt to `apt install jq` or `brew install jq` before touching any files.
- **Assumption:** Network connection is stable. **Contingency:** `git fetch` failure triggers the `set -e` trap and safely aborts.

# Execution & Verification Results

## Status: Complete (Green)

### 1. TDD Test Suites Executed:
- `tests/test-omp-syncignore.sh`:
  - **Test 1 (Blocklist Exclusion)**: PASS. `pi-lens`, `pi-advisor-flow`, and `pi-model-fallback` were blocked and removed from dependencies.
  - **Test 2 (Version Pinning & Wildcard Protection)**: PASS. `pi-web-access` retained pinned `^1.2.0`; unversioned packages without base versions are omitted; wildcards (`*`, `latest`) strictly forbidden.
- `tests/test-omp-sync-extraction.sh`:
  - **Test 3 (Git Show Isolation)**: PASS. HEAD did not advance (`$PRE_HEAD == $POST_HEAD`), `.git/MERGE_HEAD` not created, all safe files (`APPEND_SYSTEM.md`, `compaction-policy.ts`, `pi-footer.json`, `pi-footer-cache-tps.ts`) cleanly extracted without merge pollution.
- `tests/test-omp-migration.sh`:
  - Regression test suite: PASS (All backup and restore assertions verified).

### 2. Live Verification:
- Executed `scripts/omp-sync-upstream.sh` against upstream repository.
- Safe files mirrored into `config/omp/agent/`.
- `config/omp/plugins/package.json` maintained exact pinned versions without conflict extensions.
- Working directory clean of any merge state.

### 3. TypeSafe Evaluation:
- Gate 2 semantic check completed; human override recorded and approved.