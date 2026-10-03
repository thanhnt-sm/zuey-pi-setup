# macOS M1 GPG Restore Freeze Resolution Plan

## Context
Restoring an encrypted private archive on a fresh macOS M1 system halts indefinitely immediately after printing `gpg: directory '/Users/thannt/.gnupg' created`. This occurs because GnuPG launches `gpg-agent` during pipeline execution without an active terminal device binding (`GPG_TTY`), without an Apple Silicon pinentry configured (`pinentry-mac` under `/opt/homebrew/bin/pinentry-mac`), or with background GUI dialogs detached from the active terminal session. The intended end state is a robust, fail-safe restore sequence and documentation ensuring clean execution across macOS M1, Linux, and Windows environments without stalling, while maintaining the external host account boundary and preserving external assistant profiles without modifying isolated external boundaries.

## Approach
1. **Create Dedicated Restore Script `scripts/omp-private-restore.sh` and Update Backup References**:
   - Per Red Team Finding 1 and Confirmed Decisions, create an edge-case-resilient restore executable `scripts/omp-private-restore.sh`:
     - Pre-flight check: Verify archive readability, tar availability, and gpg binary presence.
     - Running process guard: Refuse restore if omp is currently running to prevent database corruption or lock contention.
     - Stale lock and daemon resolution: Terminate unresponsive daemons via `gpgconf --kill gpg-agent 2>/dev/null || true` and clear leftover locks via `rm -f ~/.gnupg/*.lock`.
     - Terminal device binding: Bind active terminal via `export GPG_TTY=$(tty 2>/dev/null || echo /dev/tty)`.
     - Agent configuration: Ensure `allow-loopback-pinentry` is present in `~/.gnupg/gpg-agent.conf`.
     - Apple Silicon detection & fallback: On Darwin, detect `pinentry-mac` under Apple Silicon `/opt/homebrew/bin/pinentry-mac` or Intel `/usr/local/bin/pinentry-mac`. If absent, automatically fallback to `--pinentry-mode loopback`.
     - Execution branch:
       - If `OMP_BACKUP_PASSPHRASE_FILE` is defined: execute non-interactive restore `gpg --batch --pinentry-mode loopback --passphrase-file "$OMP_BACKUP_PASSPHRASE_FILE" -d "$ARCHIVE" | tar -xzf - -C "$USER_HOME"`.
       - If interactive: execute decryption with detected pinentry or `--pinentry-mode loopback`.
     - Pipeline safety: Enforce `set -euo pipefail` so decryption failures halt extraction immediately without corrupting local destination files.
     - Post-extraction WAL cleanup: Prune temporary SQLite `*.db-wal` and `*.db-shm` files only upon successful pipe completion.
   - In `scripts/omp-private-backup.sh`, update header comment (lines 25–32) and completion output (lines 194–200) to reference `./scripts/omp-private-restore.sh <archive>` along with manual fallback commands.
   - Verification commands: `"C:/Program Files/Git/bin/bash.exe" -n scripts/omp-private-restore.sh` and `"C:/Program Files/Git/bin/bash.exe" -n scripts/omp-private-backup.sh`.
2. **Update Migration Guide in `docs/omp-setup-migration.md`**:
   - In section "Bước 6 (tùy chọn): Khôi phục dữ liệu riêng tư" (lines 165–199), document `./scripts/omp-private-restore.sh` as the primary automated procedure, and detail manual GUI configuration and terminal fallback:
     - Primary macOS M1 procedure:
       1. Install native prompt: `brew install pinentry-mac`
       2. Direct `gpg-agent` to Apple Silicon path: `echo "pinentry-program /opt/homebrew/bin/pinentry-mac" >> ~/.gnupg/gpg-agent.conf`
       3. Reload agent: `gpgconf --kill gpg-agent`
     - Terminal/Headless fallback procedure:
       1. Enable loopback entry: `echo "allow-loopback-pinentry" >> ~/.gnupg/gpg-agent.conf`
       2. Export terminal variable: `export GPG_TTY=$(tty 2>/dev/null || echo /dev/tty)`
       3. Run decryption with `--pinentry-mode loopback -d <archive> | tar -xzf - -C ~`
       4. Grouped WAL cleanup: `find ~/.omp/agent \( -name "*.db-wal" -o -name "*.db-shm" \) -delete`
     - Recovery from frozen state: Kill hung `gpg-agent` processes and remove `.lock` files before retry.
     - Verification command: `grep -F "pinentry-mac" docs/omp-setup-migration.md` ensuring exact match.
3. **Synchronize Managed Skill in `config/omp/agent/managed-skills/zuey-omp-backup-workflow/SKILL.md`**:
   - In `## Known pitfalls` (lines 33–36), document the macOS M1 GPG terminal hang condition, Apple Silicon Homebrew path distinction (`/opt/homebrew` vs `/usr/local`), and the exact `GPG_TTY` / `pinentry-mode loopback` remediation steps.
   - Verification command: `grep -F "GPG_TTY" config/omp/agent/managed-skills/zuey-omp-backup-workflow/SKILL.md` ensuring exact match.

## Critical files & anchors
- `scripts/omp-private-restore.sh`: Dedicated restore executable.
- `scripts/omp-private-backup.sh`: Header comment (lines 25–32) and completion output (lines 194–200).
- `docs/omp-setup-migration.md`: Section "Bước 6 (tùy chọn): Khôi phục dữ liệu riêng tư" (lines 165–199).
- `config/omp/agent/managed-skills/zuey-omp-backup-workflow/SKILL.md`: "## Known pitfalls" (lines 33–36).
- `tests/test-omp-private-restore.sh`: TDD test suite covering restore paths and edge cases.
## Verification
- **Consistency Verification**: Run `grep -rn "gpg -d" .` to confirm every reference across code, docs, and skills includes `GPG_TTY` or `--pinentry-mode loopback`. Expected output: all occurrences match updated pattern with zero legacy unadorned commands.
- **Syntax Verification**: Run `"C:/Program Files/Git/bin/bash.exe" -n scripts/omp-private-backup.sh`. Expected output: exit code 0, no syntax errors.
- **Suite Regression Check**: Run `"C:/Program Files/Git/bin/bash.exe" tests/test-omp-migration.sh`. Expected output: exit code 0 with all test cases passing.
- **Execution Proof**: Run `"C:/Program Files/Git/bin/bash.exe" scripts/omp-private-backup.sh --help`. Expected output: exits cleanly displaying updated restore instructions.

## Assumptions & contingencies
- *Assumption*: The operator on macOS M1 has Homebrew installed in the standard Apple Silicon prefix `/opt/homebrew`. All operations strictly respect the external host account boundary and preserve external assistant profiles.
- *Contingency*: If Homebrew or GUI access is unavailable, the fallback sequence utilizing `allow-loopback-pinentry` and `export GPG_TTY=$(tty)` guarantees execution strictly within the existing terminal without requiring window management.

## Red Team Review

### Session — 2026-10-04
**Findings:** 2 (2 accepted, 0 rejected)
**Severity breakdown:** 1 Critical, 1 High, 0 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Restoring pipeline script block placed inside an echo block | Critical | Accept | Phase 1 |
| 2 | Non-existent 'Bước 5' section in docs/omp-setup-migration.md | High | Accept | Phase 2 |

### Finding 1: Restoring pipeline script block placed inside an echo block — Critical
**Reviewer:** Assumption Destroyer
**Location:** Phase 1, "Refactor Restore Command Sequence"
**Flaw:** The plan proposes replacing "the single piped command" on lines 191-193 of `scripts/omp-private-backup.sh` with a script execution block. But those lines are actually `echo` statements intended to print manual restore instructions to the user.
**Failure scenario:** The script will output raw, unescaped shell logic instead of executing it, or if it's placed outside echo, it will execute the restore pipeline during a backup operation.
**Disposition:** Accept
**Rationale:** Verified by TypeSafe Judge (validity: 0.8, actionability: 1.85). The target lines are `echo` statements. The fix must be to create a separate restore script `scripts/omp-private-restore.sh` instead of injecting logic into the backup script's echo block.

### Finding 2: Non-existent 'Bước 5' section in docs/omp-setup-migration.md — High
**Reviewer:** Fact Checker
**Location:** Phase 2, "Update Migration Guide"
**Flaw:** The plan references updating lines 167-172 of `docs/omp-setup-migration.md` under "Bước 5: Restore dữ liệu riêng tư". This section does not exist in the document.
**Failure scenario:** The implementer will not find the target section and will be blocked or forced to guess where to put the new instructions.
**Disposition:** Accept
**Rationale:** Verified by TypeSafe Judge (validity: 0.9, actionability: 1.56). The document does not contain this section. The plan needs to explicitly state that it adds a *new* section rather than updating an existing one.

## Validation Log

### Session 1 — 2026-10-04
**Trigger:** Validating plan after Red Team Review identified critical flaws
**Questions asked:** 3

#### Questions & Answers

1. **[Architecture]** Since the backup script only echoes restore instructions, how should the restore logic be implemented?
   - Options: Create a new script `scripts/omp-private-restore.sh` for the execution block | Just update the echo instructions in the backup script | Inject the execution logic into the backup script (Dangerous)
   - **Answer:** Create a new script `scripts/omp-private-restore.sh` for the execution block
   - **Rationale:** Prevents destructive behavior during backup and aligns with standard script boundaries.

2. **[Tradeoffs]** Should we automate the fallback to `pinentry-mode loopback` if `pinentry-mac` is not found, or rely on manual user configuration?
   - Options: Automate the fallback logic in the restore script | Rely entirely on manual user configuration documented in guides
   - **Answer:** Automate the fallback logic in the restore script
   - **Rationale:** Ensures a robust, fail-safe restore sequence across environments without stalling.

3. **[Scope]** Where should the new 'Bước 5' documentation be placed in the migration guide?
   - Options: Append it at the very end of the document as Step 5 | Insert it immediately after Step 4
   - **Answer:** Append it at the very end of the document as Step 5
   - **Rationale:** Logically follows the existing sequence without disrupting the current layout.

#### Confirmed Decisions
- Architecture: Create a dedicated restore script instead of modifying echo blocks.
- Tradeoffs: Automate the fallback logic for resilience.
- Scope: Append the documentation as a new step at the end.

#### Action Items
- [x] Create `scripts/omp-private-restore.sh`
- [x] Update `scripts/omp-private-backup.sh` to reference the new restore script
- [x] Update Bước 6 in `docs/omp-setup-migration.md` to reference `scripts/omp-private-restore.sh` and document pinentry-mac / GPG_TTY remediation

#### Impact on Phases
- Phase 1: Shift focus from modifying the echo block to creating a new executable script `scripts/omp-private-restore.sh`.
- Phase 2: Create a new section "Bước 5" instead of modifying an existing block.
