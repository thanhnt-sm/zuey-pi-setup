#!/usr/bin/env bash
#
# tests/test-omp-private-restore.sh - TDD verification for scripts/omp-private-restore.sh
#
# Real gpg (symmetric, passphrase file) covers the data path: extraction, WAL cleanup,
# failure safety. A gpg shim on PATH covers branch selection (GPG_TTY, pinentry-mac vs loopback)
# because the interactive branches cannot be driven without a terminal.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESTORE_SCRIPT="$ROOT/scripts/omp-private-restore.sh"

TEST_TMP="$(mktemp -d -t omp-restore-test-XXXXXX)"
export GNUPGHOME="$TEST_TMP/gnupg"
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"
trap 'gpgconf --kill gpg-agent >/dev/null 2>&1 || true; rm -rf "$TEST_TMP"' EXIT

fail() {
  echo "✗ FAIL: $*" >&2
  exit 1
}

# Runs the restore script; stdout+stderr go to $TEST_TMP/out. Sets rc.
run_restore() {
  set +e
  timeout 60 "$BASH" "$RESTORE_SCRIPT" "$@" >"$TEST_TMP/out" 2>&1 </dev/null
  rc=$?
  set -e
}

echo "=== [TDD] Restore script exists ==="
[ -f "$RESTORE_SCRIPT" ] || fail "missing $RESTORE_SCRIPT"
"$BASH" -n "$RESTORE_SCRIPT" || fail "syntax error in $RESTORE_SCRIPT"

echo "=== [TDD] Building encrypted fixture archive ==="
PASS_FILE="$TEST_TMP/pass"
BAD_PASS_FILE="$TEST_TMP/badpass"
printf 'correct horse battery\n' >"$PASS_FILE"
printf 'wrong passphrase\n' >"$BAD_PASS_FILE"

STAGE="$TEST_TMP/stage"
mkdir -p "$STAGE/.omp/agent/memories/mnemopi/banks/b1"
echo 'restored-memory' >"$STAGE/.omp/agent/memories/mnemopi/banks/b1/mnemopi.db"
echo 'restored-history' >"$STAGE/.omp/agent/history.db"

ARCHIVE="$TEST_TMP/omp-private-test.tar.gz.gpg"
tar -czf - -C "$STAGE" . | gpg --batch --pinentry-mode loopback --passphrase-file "$PASS_FILE" \
  --symmetric --cipher-algo AES256 --yes --output "$ARCHIVE"
PLAIN_TAR="$TEST_TMP/plain.tar.gz"
tar -czf "$PLAIN_TAR" -C "$STAGE" .

new_home() {
  local h="$TEST_TMP/home_$1"
  mkdir -p "$h/.omp/agent"
  echo 'old-history' >"$h/.omp/agent/history.db"
  echo 'stale wal' >"$h/.omp/agent/history.db-wal"
  echo 'stale shm' >"$h/.omp/agent/history.db-shm"
  echo 'keep: local config' >"$h/.omp/agent/config.yml"
  echo "$h"
}

echo "=== [TDD] Success path: extract, prune WAL/SHM, leave unrelated files ==="
H="$(new_home ok)"
OMP_BACKUP_PASSPHRASE_FILE="$PASS_FILE" run_restore --home "$H" "$ARCHIVE"
[ "$rc" -eq 0 ] || fail "restore rc=$rc: $(cat "$TEST_TMP/out")"
[ "$(cat "$H/.omp/agent/history.db")" = "restored-history" ] || fail "history.db not restored"
[ "$(cat "$H/.omp/agent/memories/mnemopi/banks/b1/mnemopi.db")" = "restored-memory" ] || fail "mnemopi.db not restored"
[ ! -e "$H/.omp/agent/history.db-wal" ] || fail "stale -wal survived restore"
[ ! -e "$H/.omp/agent/history.db-shm" ] || fail "stale -shm survived restore"
[ "$(cat "$H/.omp/agent/config.yml")" = "keep: local config" ] || fail "unrelated file was modified"
echo "✓ PASS: restore extracts archive and prunes WAL/SHM only."

echo "=== [TDD] Wrong passphrase: non-zero rc, destination untouched ==="
H="$(new_home badpass)"
OMP_BACKUP_PASSPHRASE_FILE="$BAD_PASS_FILE" run_restore --home "$H" "$ARCHIVE"
[ "$rc" -ne 0 ] || fail "wrong passphrase must fail"
[ "$rc" -ne 124 ] || fail "wrong passphrase hung until timeout"
[ "$(cat "$H/.omp/agent/history.db")" = "old-history" ] || fail "history.db changed on failed decrypt"
[ -e "$H/.omp/agent/history.db-wal" ] || fail "WAL pruned although restore failed"
echo "✓ PASS: failed decrypt leaves destination and WAL intact."

echo "=== [TDD] Argument and pre-flight errors ==="
run_restore --home "$H"
[ "$rc" -eq 1 ] || fail "missing archive argument must exit 1 (got $rc)"
run_restore --home "$H" "$TEST_TMP/does-not-exist.gpg"
[ "$rc" -eq 1 ] || fail "unreadable archive must exit 1 (got $rc)"
run_restore --bogus
[ "$rc" -eq 1 ] || fail "unknown option must exit 1 (got $rc)"
run_restore --help
[ "$rc" -eq 0 ] && grep -q 'GPG_TTY' "$TEST_TMP/out" || fail "--help must exit 0 and document GPG_TTY"
echo "✓ PASS: argument and archive pre-flight errors exit 1; --help documents GPG_TTY."

echo "=== [TDD] Active process guard: aborts if omp is running ==="
MOCK_PGREP_DIR="$TEST_TMP/mock_pgrep"
mkdir -p "$MOCK_PGREP_DIR"
cat >"$MOCK_PGREP_DIR/pgrep" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$MOCK_PGREP_DIR/pgrep"

H="$(new_home omp_running)"
PATH="$MOCK_PGREP_DIR:$PATH" run_restore --home "$H" "$ARCHIVE"
[ "$rc" -eq 1 ] || fail "active omp process check must exit 1 (got $rc)"
grep -q "ERROR: 'omp' is currently running" "$TEST_TMP/out" || fail "missing running omp error message: $(cat "$TEST_TMP/out")"
echo "✓ PASS: active omp process check aborts with exit code 1."

echo "=== [TDD] Stale gpg locks are cleared ==="
H="$(new_home locks)"
touch "$GNUPGHOME/stale.lock"
OMP_BACKUP_PASSPHRASE_FILE="$PASS_FILE" run_restore --home "$H" "$ARCHIVE"
[ "$rc" -eq 0 ] || fail "restore rc=$rc: $(cat "$TEST_TMP/out")"
[ ! -e "$GNUPGHOME/stale.lock" ] || fail "stale .lock survived"
echo "✓ PASS: stale *.lock removed."

echo "=== [TDD] Branch selection via gpg shim ==="
SHIM_DIR="$TEST_TMP/shim"
PIN_DIR="$TEST_TMP/pin"
mkdir -p "$SHIM_DIR" "$PIN_DIR"
cat >"$SHIM_DIR/gpg" <<'EOF'
#!/usr/bin/env bash
{ echo "GPG_TTY=${GPG_TTY:-}"; printf 'ARG=%s\n' "$@"; } > "$SHIM_LOG"
cat "$SHIM_PLAYLOAD"
EOF
chmod +x "$SHIM_DIR/gpg"
printf '#!/bin/sh\nexit 0\n' >"$PIN_DIR/pinentry-mac"
chmod +x "$PIN_DIR/pinentry-mac"
export SHIM_LOG="$TEST_TMP/shim.log"
export SHIM_PLAYLOAD="$PLAIN_TAR"

shim_run() { # shim_run <os> <extra-path-dir|-> <gnupghome> <home>
  local os="$1" extra="$2" gh="$3" h="$4" p="$SHIM_DIR:$PATH"
  [ "$extra" = "-" ] || p="$extra:$p"
  rm -f "$SHIM_LOG"
  env -u OMP_BACKUP_PASSPHRASE_FILE GNUPGHOME="$gh" OS_OVERRIDE="$os" PATH="$p" \
    timeout 60 "$BASH" "$RESTORE_SCRIPT" --home "$h" "$ARCHIVE" >"$TEST_TMP/out" 2>&1 </dev/null && rc=0 || rc=$?
}

# Linux: no GUI pinentry -> loopback, terminal bound, loopback allowed in agent conf
H="$(new_home shim_linux)"
shim_run Linux - "$TEST_TMP/gh_linux" "$H"
[ "$rc" -eq 0 ] || fail "linux shim run rc=$rc: $(cat "$TEST_TMP/out")"
grep -qx 'ARG=--pinentry-mode' "$SHIM_LOG" && grep -qx 'ARG=loopback' "$SHIM_LOG" || fail "non-macOS must use --pinentry-mode loopback"
grep -q '^GPG_TTY=.\+' "$SHIM_LOG" || fail "GPG_TTY must be exported (fell back to /dev/tty)"
grep -qx 'allow-loopback-pinentry' "$TEST_TMP/gh_linux/gpg-agent.conf" || fail "allow-loopback-pinentry missing from gpg-agent.conf"
[ "$(cat "$H/.omp/agent/history.db")" = "restored-history" ] || fail "shim restore did not extract"

# macOS without pinentry-mac: automatic loopback fallback
H="$(new_home shim_mac_nopin)"
shim_run Darwin - "$TEST_TMP/gh_mac_nopin" "$H"
[ "$rc" -eq 0 ] || fail "darwin/no-pinentry rc=$rc: $(cat "$TEST_TMP/out")"
grep -qx 'ARG=loopback' "$SHIM_LOG" || fail "macOS without pinentry-mac must fall back to loopback"

# macOS with pinentry-mac: configured in agent conf, no loopback forced
H="$(new_home shim_mac_pin)"
shim_run Darwin "$PIN_DIR" "$TEST_TMP/gh_mac_pin" "$H"
[ "$rc" -eq 0 ] || fail "darwin/pinentry rc=$rc: $(cat "$TEST_TMP/out")"
grep -q '^pinentry-program .*pinentry-mac' "$TEST_TMP/gh_mac_pin/gpg-agent.conf" || fail "pinentry-program not configured"
! grep -qx 'ARG=loopback' "$SHIM_LOG" || fail "loopback must not be forced when pinentry-mac is available"

# An operator-chosen pinentry-program is never overwritten
echo 'pinentry-program /custom/pinentry' >"$TEST_TMP/gh_mac_pin/gpg-agent.conf"
H="$(new_home shim_mac_custom)"
shim_run Darwin "$PIN_DIR" "$TEST_TMP/gh_mac_pin" "$H"
[ "$rc" -eq 0 ] || fail "darwin/custom rc=$rc: $(cat "$TEST_TMP/out")"
[ "$(grep -c '^pinentry-program' "$TEST_TMP/gh_mac_pin/gpg-agent.conf")" -eq 1 ] \
  && grep -qx 'pinentry-program /custom/pinentry' "$TEST_TMP/gh_mac_pin/gpg-agent.conf" || fail "existing pinentry-program was overwritten"
echo "✓ PASS: GPG_TTY bound; pinentry-mac vs loopback chosen correctly; user config preserved."

echo "=== [TDD] Phase 4: mnemopi scratch filter, --sessions staging & Darwin nvm node probe ==="
P4_HOME="$TEST_TMP/p4_src_home"
P4_OMP="$P4_HOME/.omp"
mkdir -p "$P4_OMP/agent/memories/mnemopi/banks/real-workspace" \
         "$P4_OMP/agent/memories/mnemopi/banks/omp-verify-workspace-123" \
         "$P4_OMP/agent/memories/mnemopi/banks/scratch-cwd-9" \
         "$P4_OMP/agent/memories/mnemopi/banks/a-deadbeef" \
         "$P4_OMP/agent/sessions/ws1" \
         "$P4_HOME/.claude/projects/proj1/memory" \
         "$P4_HOME/.claude"
P4_WIN_HOME="$P4_HOME"
if command -v cygpath >/dev/null 2>&1; then
  P4_WIN_HOME="$(cygpath -m "$P4_HOME")"
fi
for b in real-workspace omp-verify-workspace-123 scratch-cwd-9 a-deadbeef; do
  python -c "import sqlite3; c=sqlite3.connect('$P4_WIN_HOME/.omp/agent/memories/mnemopi/banks/$b/mnemopi.db'); c.execute('CREATE TABLE IF NOT EXISTS k(v TEXT)'); c.commit(); c.close()"
done
echo '{"type":"session"}' > "$P4_OMP/agent/sessions/ws1/s1.jsonl"
touch "$P4_OMP/agent/sessions/ws1/s1.lock"
echo '{"type":"assistant"}' > "$P4_HOME/.claude/projects/proj1/c1.jsonl"
echo '# Mem' > "$P4_HOME/.claude/projects/proj1/memory/MEMORY.md"
echo '{"display":"hi"}' > "$P4_HOME/.claude/history.jsonl"

P4_ARC="$TEST_TMP/p4-mem-sessions.tar.gz"
"$BASH" "$ROOT/scripts/omp-private-backup.sh" --source "$P4_OMP" --home "$P4_HOME" --memory --sessions --no-encrypt -o "$P4_ARC"
P4_LIST="$(tar -tzf "$(cygpath -u "$P4_ARC" 2>/dev/null || echo "$P4_ARC")")"
echo "$P4_LIST" | grep -q "real-workspace/mnemopi.db" || fail "real-workspace bank missing"
! echo "$P4_LIST" | grep -qE "omp-verify-workspace|scratch-cwd|a-deadbeef" || fail "scratch mnemopi banks leaked into default --memory backup"
echo "$P4_LIST" | grep -q ".omp/agent/sessions/ws1/s1.jsonl" || fail "OMP session missing from --sessions backup"
echo "$P4_LIST" | grep -q ".claude/projects/proj1/c1.jsonl" || fail "Claude session missing from --sessions backup"
echo "$P4_LIST" | grep -q ".claude/projects/proj1/memory/MEMORY.md" || fail "Claude memory missing from --sessions backup"
! echo "$P4_LIST" | grep -q "\.lock" || fail ".lock file leaked into --sessions backup"

# --include-scratch-banks restores scratch banks
P4_ARC_INC="$TEST_TMP/p4-mem-inc.tar.gz"
"$BASH" "$ROOT/scripts/omp-private-backup.sh" --source "$P4_OMP" --home "$P4_HOME" --memory --include-scratch-banks --no-encrypt -o "$P4_ARC_INC"
P4_INC_LIST="$(tar -tzf "$(cygpath -u "$P4_ARC_INC" 2>/dev/null || echo "$P4_ARC_INC")")"
echo "$P4_INC_LIST" | grep -q "omp-verify-workspace-123" || fail "--include-scratch-banks omitted scratch bank"

# Darwin nvm node probe when Homebrew/PATH node absent
P4_RESTORE="$TEST_TMP/p4_restore_darwin"
mkdir -p "$P4_RESTORE/.nvm/versions/node/v22.11.0/bin" "$P4_HOME/.claude"
printf '#!/bin/sh\necho node\n' > "$P4_RESTORE/.nvm/versions/node/v22.11.0/bin/node"
chmod +x "$P4_RESTORE/.nvm/versions/node/v22.11.0/bin/node"
echo '{"hooks":{"PreToolUse":[{"command":"{{CLAUDE_NODE}} {{USER_HOME}}/.claude/hooks/x.cjs"}]}}' > "$P4_HOME/.claude/settings.json"
P4_CLAUDE_ARC="$TEST_TMP/p4-claude.tar.gz"
"$BASH" "$ROOT/scripts/omp-private-backup.sh" --source "$P4_OMP" --home "$P4_HOME" --claude --no-encrypt -o "$P4_CLAUDE_ARC"
# Isolate PATH without homebrew/local node to exercise nvm probe (nvm precedes command -v node)
OS_OVERRIDE="Darwin" "$BASH" "$RESTORE_SCRIPT" --home "$P4_RESTORE" "$P4_CLAUDE_ARC"
grep -qE "\.nvm/versions/node/v22\.11\.0/bin/node" "$P4_RESTORE/.claude/settings.json" || fail "Darwin nvm node probe failed: $(cat "$P4_RESTORE/.claude/settings.json")"
echo "✓ PASS: Phase 4 scratch bank filter, --sessions staging & Darwin nvm node probe passed."

echo "=== [TDD] Phase 4: private backup/restore rehydrates ~/.omp/agent/mcp.json across OS ==="
MCP_PRIV_SRC_HOME="$TEST_TMP/mcp_priv_src"
MCP_PRIV_DST_HOME="$TEST_TMP/mcp_priv_dst"
mkdir -p "$MCP_PRIV_SRC_HOME/.omp/agent" "$MCP_PRIV_SRC_HOME/.claude/mcp/typesafe" "$MCP_PRIV_SRC_HOME/.claude/hooks/lib"
mkdir -p "$MCP_PRIV_DST_HOME/.nvm/versions/node/v22.11.0/bin" "$MCP_PRIV_DST_HOME/.omp/agent"
printf '#!/bin/sh\necho node\n' > "$MCP_PRIV_DST_HOME/.nvm/versions/node/v22.11.0/bin/node"
chmod +x "$MCP_PRIV_DST_HOME/.nvm/versions/node/v22.11.0/bin/node"
echo 'export default {}' > "$MCP_PRIV_SRC_HOME/.claude/mcp/typesafe/srv.cjs"
echo 'module.exports = {}' > "$MCP_PRIV_SRC_HOME/.claude/hooks/lib/typesafe-enabled-resolver.cjs"
echo '{}' > "$MCP_PRIV_SRC_HOME/.claude/.ck.json"
MCP_PRIV_WIN_SRC="$MCP_PRIV_SRC_HOME"
if command -v cygpath >/dev/null 2>&1; then
  MCP_PRIV_WIN_SRC="$(cygpath -m "$MCP_PRIV_SRC_HOME")"
fi
python -c "
import pathlib
p = pathlib.Path('$MCP_PRIV_WIN_SRC/.omp/agent/mcp.json')
h = '$MCP_PRIV_WIN_SRC'.replace('\\\\', '/')
p.write_text('{\"mcpServers\":{\"typesafe\":{\"type\":\"stdio\",\"command\":\"' + h + '/.claude/runtime/node/node.exe\",\"args\":[\"' + h + '/.claude/mcp/typesafe/srv.cjs\"]}}}', encoding='utf-8')
"
echo '{"mcpServers":{"old":{"command":"old-cmd"}}}' > "$MCP_PRIV_DST_HOME/.omp/agent/mcp.json"
MCP_PRIV_ARC="$TEST_TMP/mcp-priv-kit.tar.gz"
"$BASH" "$ROOT/scripts/omp-private-backup.sh" --source "$MCP_PRIV_SRC_HOME/.omp" --home "$MCP_PRIV_SRC_HOME" --typesafe-kit --no-encrypt -o "$MCP_PRIV_ARC"
OS_OVERRIDE="Darwin" "$BASH" "$RESTORE_SCRIPT" --home "$MCP_PRIV_DST_HOME" "$MCP_PRIV_ARC"
grep -qE "\.nvm/versions/node/v22\.11\.0/bin/node" "$MCP_PRIV_DST_HOME/.omp/agent/mcp.json" || fail "mcp.json node rehydration failed on Darwin: $(cat "$MCP_PRIV_DST_HOME/.omp/agent/mcp.json")"
! grep -qi "mcp_priv_src" "$MCP_PRIV_DST_HOME/.omp/agent/mcp.json" || fail "mcp.json still contains source user home path"
find "$MCP_PRIV_DST_HOME/.omp/restore-backups" -name "mcp.json" | grep -q "mcp.json" || fail "pre-existing mcp.json not backed up before private restore overwrite"
echo "✓ PASS: private backup/restore templatizes, backs up, and rehydrates mcp.json cleanly."
echo "=== [TDD] Phase 1 V5: --include-dev-repos archives and restores external git repos safely ==="
DEV_SRC_HOME="$TEST_TMP/dev_src_home"
DEV_DST_HOME="$TEST_TMP/dev_dst_home"
mkdir -p "$DEV_SRC_HOME/Projects/omp_extension/src" "$DEV_SRC_HOME/Projects/omp_extension/node_modules/dummy" "$DEV_SRC_HOME/Projects/omp_extension/.git"
echo "console.log('typesafe-planner');" > "$DEV_SRC_HOME/Projects/omp_extension/typesafe-planner.ts"
echo "console.log('internal');" > "$DEV_SRC_HOME/Projects/omp_extension/src/index.ts"
echo "ref: refs/heads/main" > "$DEV_SRC_HOME/Projects/omp_extension/.git/HEAD"
echo "dummy_module" > "$DEV_SRC_HOME/Projects/omp_extension/node_modules/dummy/index.js"
DEV_ARC="$TEST_TMP/dev-repo-priv.tar.gz"
"$BASH" "$ROOT/scripts/omp-private-backup.sh" --home "$DEV_SRC_HOME" --include-dev-repos --no-encrypt -o "$DEV_ARC"
DEV_LIST="$(tar -tzf "$(cygpath -u "$DEV_ARC" 2>/dev/null || echo "$DEV_ARC")")"
echo "$DEV_LIST" | grep -q "Projects/omp_extension/typesafe-planner.ts" || fail "Projects/omp_extension source missing from --include-dev-repos backup"
echo "$DEV_LIST" | grep -q "Projects/omp_extension/.git/HEAD" || fail ".git/HEAD missing from --include-dev-repos backup"
! echo "$DEV_LIST" | grep -q "node_modules" || fail "node_modules leaked into --include-dev-repos backup"
OS_OVERRIDE="Darwin" "$BASH" "$RESTORE_SCRIPT" --home "$DEV_DST_HOME" "$DEV_ARC"
[ -f "$DEV_DST_HOME/Projects/omp_extension/typesafe-planner.ts" ] || fail "Projects/omp_extension source not restored"
[ -f "$DEV_DST_HOME/Projects/omp_extension/.git/HEAD" ] || fail "Projects/omp_extension .git not restored"
[ ! -d "$DEV_DST_HOME/Projects/omp_extension/node_modules" ] || fail "node_modules should not be present in restore target"
echo "✓ PASS: --include-dev-repos archives and restores external dev repositories cleanly without node_modules."

echo "=== ALL TDD TESTS PASSED ==="
