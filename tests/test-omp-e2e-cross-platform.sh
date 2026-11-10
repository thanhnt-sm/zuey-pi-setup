#!/usr/bin/env bash
#
# tests/test-omp-e2e-cross-platform.sh - End-to-end validation of portable tarball
# on both Windows Git Bash and simulated Darwin/macOS targets.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARBALL="$ROOT/backups/omp-setup-portable.tar.gz"
RESTORE_SCRIPT="$ROOT/scripts/omp-setup-restore.sh"

[ -f "$TARBALL" ] || { echo "FAIL: Portable tarball missing at $TARBALL" >&2; exit 1; }

TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/test-omp-e2e-XXXXXX")"
trap 'rm -rf "$TEST_TMP"' EXIT

TAR_LIST_FILE="$TEST_TMP/tar.list"
tar -tzf "$(command -v cygpath >/dev/null && cygpath -u "$TARBALL" || echo "$TARBALL")" > "$TAR_LIST_FILE"
for bad in '\.db$' '\.db-wal$' '\.db-shm$' '\.sqlite$' 'agent/\.env$' '\.pyc$'; do
  if grep -qE "$bad" "$TAR_LIST_FILE"; then
    echo "FAIL: Tarball contains forbidden entry matching $bad" >&2
    exit 1
  fi
done
grep -q "agent/skills/pmo-project-suite/SKILL.md" "$TAR_LIST_FILE" || { echo "FAIL: Missing pmo-project-suite in tarball" >&2; exit 1; }
grep -q "agent/skills/office-doc-suite/SKILL.md" "$TAR_LIST_FILE" || { echo "FAIL: Missing office-doc-suite in tarball" >&2; exit 1; }
grep -q "agent/skills/email-intelligence-suite/SKILL.md" "$TAR_LIST_FILE" || { echo "FAIL: Missing email-intelligence-suite in tarball" >&2; exit 1; }
grep -q "agent/skills/system-maintenance-suite/SKILL.md" "$TAR_LIST_FILE" || { echo "FAIL: Missing system-maintenance-suite in tarball" >&2; exit 1; }
grep -q "agent/agents/pmo-ba.md" "$TAR_LIST_FILE" || { echo "FAIL: Missing pmo-ba.md in tarball" >&2; exit 1; }
grep -q "agent/tools-requirements.txt" "$TAR_LIST_FILE" || { echo "FAIL: Missing tools-requirements.txt in tarball" >&2; exit 1; }
grep -q "agent/extensions/typesafe-planner/tools/jev-paired-workspace.ts" "$TAR_LIST_FILE" || { echo "FAIL: Missing recursive ../tools/ deref in typesafe-planner" >&2; exit 1; }

echo "=== [E2E] Restoring to Windows target & simulated Darwin/macOS target ==="
TGT_WIN="$TEST_TMP/win_omp"
TGT_MAC="$TEST_TMP/mac_omp"
OS_OVERRIDE="MINGW64_NT" "$BASH" "$RESTORE_SCRIPT" --source-tar "$TARBALL" --target-dir "$TGT_WIN" --no-install
OS_OVERRIDE="Darwin" "$BASH" "$RESTORE_SCRIPT" --source-tar "$TARBALL" --target-dir "$TGT_MAC" --no-install

grep -qE 'shellPath:.*bash\.exe' "$TGT_WIN/agent/config.yml" || { echo "FAIL: Windows shellPath wrong" >&2; exit 1; }
grep -qE 'shellPath:.*(/bin/zsh|/bin/bash)' "$TGT_MAC/agent/config.yml" || { echo "FAIL: Darwin shellPath wrong" >&2; exit 1; }
test -f "$TGT_MAC/agent/APPEND_SYSTEM.md"
test -f "$TGT_MAC/agent/.env"
test -f "$TGT_MAC/agent/extensions/typesafe-planner/tools/jev-paired-workspace.ts"
echo "✓ PASS: Both Windows and simulated Darwin restores succeeded with OS-specific shellPath & overlays."

echo "=== [E2E] Smoke-running restored dual-mode CLIs from Darwin target ==="
PY_BIN="python3"
command -v "$PY_BIN" >/dev/null 2>&1 || PY_BIN="python"
CPM_JSON="$TEST_TMP/cpm.json"
echo '{"tasks":[{"id":"A","duration":2},{"id":"B","duration":3,"depends_on":["A"]}]}' > "$CPM_JSON"
"$PY_BIN" "$TGT_MAC/agent/skills/pmo-project-suite/scripts/pmo_cli.py" --cmd cpm --input "$CPM_JSON" --json | grep -q '"project_duration": 5.0'
"$PY_BIN" "$TGT_MAC/agent/skills/system-maintenance-suite/scripts/maintenance_cli.py" --cmd analyze --os darwin --dry-run --json | grep -q '"os": "darwin"'
"$PY_BIN" "$TGT_MAC/agent/skills/office-doc-suite/scripts/office_cli.py" --cmd init-kpi --output "$TEST_TMP/kpi.xlsx" --json | grep -q '"initialized"'

echo "=== ALL CROSS-OS E2E VALIDATION TESTS PASSED ==="
