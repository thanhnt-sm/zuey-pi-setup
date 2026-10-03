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

echo "=== ALL TDD TESTS PASSED ==="
