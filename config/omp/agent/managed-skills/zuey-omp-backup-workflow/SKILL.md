---
name: zuey-omp-backup-workflow
description: "Use when backing up, restoring, syncing, or testing oh-my-pi (omp) config in the zuey-pi-setup repo on Windows (Git Bash, public repo)."
---

# zuey-pi-setup omp backup workflow

Repo: D:/100.Software/Github/zuey-pi-setup (PUBLIC fork, origin thanhnt-sm). Never commit private state.

## Layout / ownership
- `config/omp/` = live snapshot; owned by `scripts/omp-setup-backup.sh --config-dir config/omp` (wipes dir each run).
- `config/omp-upstream/` = upstream-ported overlay (APPEND_SYSTEM.md, compaction-policy.ts, pi-footer*, extra plugin deps, .omp-syncignore); owned by `scripts/omp-sync-upstream.sh`.
- `backups/omp-setup-portable.tar.gz` (tracked) = snapshot at root + overlay under `upstream/`. .gitignore cannot protect its contents; backup refuses *.db and token patterns (exit 2).
- Private state (mnemopi banks, history.db, ~/.claude TypeSafe kit) → `scripts/omp-private-backup.sh --all` (gpg AES256, refuses output inside git work trees); restore via `scripts/omp-private-restore.sh <archive>`. OAuth in agent.db is NOT exported; re-login.

## Running scripts from the omp bash tool
- `bash` resolves to WSL System32 bash and `$BASH` is empty → always use `"C:/Program Files/Git/bin/bash.exe" scripts/...`.
- jq not installed: sync tests need it. Download temp: `curl -sSL -o $D/jq.exe https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-windows-amd64.exe`, prepend to PATH inside the Git Bash `-c`, delete after.
- No sqlite3/age; bun (`bun:sqlite` VACUUM INTO) and Git's gpg exist.

## Procedure
1. Tests: `tests/test-omp-migration.sh`, `tests/test-omp-private-restore.sh`, `tests/test-omp-syncignore.sh`, `tests/test-omp-sync-extraction.sh` (all via Git Bash; latter two need jq).
2. Re-snapshot: `"C:/Program Files/Git/bin/bash.exe" scripts/omp-setup-backup.sh --source ~/.omp --config-dir config/omp -o backups/omp-setup-portable.tar.gz`.
3. Check: extensions contain real source (live typesafe-planner.ts is a shim to C:/Users/thant/Projects/omp_extension; backup dereferences to `extensions/typesafe-planner/{index.ts,src/}`), `.env.example` lists provider vars, tarball has no .db.
4. Smoke restore into temp: `restore.sh --target-dir $(mktemp -d) --no-install`; verify .env, extensions, overlay-added files, merged plugins.
5. Secret-scan staged diff, commit in groups (fix scripts / feat / docs / chore snapshot), push.

## Never
- Run restore onto this machine's live ~/.omp to 'sync' (live config.yml/models.yml newer). Direction is live → repo.
- Run backup `--config-dir` against `config/omp-upstream`.
- Commit key-shaped literals in tests (build fake keys at runtime; GitHub push protection).

## Known pitfalls
- TypeSafe Gate 1 may false-positive 'Claude boundary violation' when diffs merely mention `.claude/` paths; verify with git status, don't bypass, report.
- Tests source scripts; run new invocations in `( . script )` subshells; `if run_backup` disables errexit → assert exact rc.
- macOS M1 GPG restore hang: GnuPG hangs without terminal device binding (`GPG_TTY`) or Apple Silicon pinentry. Fix: use `scripts/omp-private-restore.sh <archive>`, or manually export `GPG_TTY=$(tty 2>/dev/null || echo /dev/tty)` and use `gpg --pinentry-mode loopback -d <archive> | tar -xzf - -C ~`. If configuring GUI pinentry on macOS M1, point `pinentry-program` to Apple Silicon path `/opt/homebrew/bin/pinentry-mac` (`/usr/local/bin/pinentry-mac` on Intel) in `~/.gnupg/gpg-agent.conf` and restart via `gpgconf --kill gpg-agent`.
