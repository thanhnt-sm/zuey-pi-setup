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
grep -q "agent/agents/planner.md" "$TAR_LIST_FILE" || { echo "FAIL: Missing ported Claude planner.md in tarball" >&2; exit 1; }
grep -q "agent/rules/orchestration-protocol.md" "$TAR_LIST_FILE" || { echo "FAIL: Missing ported orchestration-protocol.md in tarball" >&2; exit 1; }
grep -q "agent/commands/ck-council.md" "$TAR_LIST_FILE" || { echo "FAIL: Missing ck-council.md in tarball" >&2; exit 1; }
grep -q "agent/skills/omp-session-harvester/scripts/harvester_core.py" "$TAR_LIST_FILE" || { echo "FAIL: Missing harvester_core.py in tarball" >&2; exit 1; }
grep -q "agent/extensions/omp-toolkit-hub.ts" "$TAR_LIST_FILE" || { echo "FAIL: Missing omp-toolkit-hub.ts in tarball" >&2; exit 1; }
grep -q "agent/tools-requirements.txt" "$TAR_LIST_FILE" || { echo "FAIL: Missing tools-requirements.txt in tarball" >&2; exit 1; }
grep -q "plugins/omp-plugins.lock.json" "$TAR_LIST_FILE" || { echo "FAIL: Missing plugins/omp-plugins.lock.json in tarball" >&2; exit 1; }
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

# Pure-Python PDF extraction smoke check on Darwin target
PDF_PATH="$TEST_TMP/darwin_sample.pdf"
"$PY_BIN" - "$PDF_PATH" <<'PY'
import pathlib, sys
txt = "Darwin Pure Python PDF Test"
stream = f"BT /F1 12 Tf 72 720 Td ({txt}) Tj ET\n".encode("ascii")
objs = [
    b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    f"4 0 obj\n<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"endstream\nendobj\n",
    b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
]
buf = bytearray(b"%PDF-1.4\n")
offs = [0]
for o in objs:
    offs.append(len(buf))
    buf.extend(o)
xp = len(buf)
buf.extend(f"xref\n0 {len(offs)}\n0000000000 65535 f \n".encode("ascii"))
for o in offs[1:]:
    buf.extend(f"{o:010d} 00000 n \n".encode("ascii"))
buf.extend(f"trailer\n<< /Size {len(offs)} /Root 1 0 R >>\nstartxref\n{xp}\n%%EOF\n".encode("ascii"))
pathlib.Path(sys.argv[1]).write_bytes(bytes(buf))
PY
"$PY_BIN" "$TGT_MAC/agent/skills/office-doc-suite/scripts/office_cli.py" --cmd to-md --input "$PDF_PATH" --json | grep -q "Darwin Pure Python PDF Test"

# Standalone harvest_cli.py --next smoke check outside repo from Darwin target
ISO_HOME="$TEST_TMP/darwin_home"
ISO_CWD="$TEST_TMP/darwin_cwd"
mkdir -p "$ISO_HOME/.omp/agent" "$ISO_CWD"
echo '{"status":"COMPLETED","suites":{}}' > "$ISO_HOME/.omp/agent/omp-consolidation-ledger.json"
(cd "$ISO_CWD" && env -u ZUEY_PI_REPO HOME="$ISO_HOME" USERPROFILE="$ISO_HOME" \
  "$PY_BIN" "$TGT_MAC/agent/skills/omp-session-harvester/scripts/harvest_cli.py" --next | grep -q '"COMPLETED"')

echo "=== [E2E] Phase 4: omp-doctor.py & omp-bootstrap.sh unified validation ==="
DOCTOR_SCRIPT="$ROOT/scripts/omp-doctor.py"
BOOTSTRAP_SH="$ROOT/scripts/omp-bootstrap.sh"
BOOTSTRAP_PS1="$ROOT/scripts/omp-bootstrap.ps1"
test -f "$DOCTOR_SCRIPT" || { echo "FAIL: Missing $DOCTOR_SCRIPT" >&2; exit 1; }
test -f "$BOOTSTRAP_SH" || { echo "FAIL: Missing $BOOTSTRAP_SH" >&2; exit 1; }
test -f "$BOOTSTRAP_PS1" || { echo "FAIL: Missing $BOOTSTRAP_PS1" >&2; exit 1; }

# 1) Doctor flags unexpanded/Windows paths inside Darwin mcp.json
echo '{"mcpServers":{"bad":{"command":"C:\\Users\\demo\\node.exe"}}}' > "$TGT_MAC/agent/mcp.json"
set +e
OS_OVERRIDE="Darwin" "$PY_BIN" "$DOCTOR_SCRIPT" --target-dir "$TGT_MAC" --repo-dir "$ROOT" --json > "$TEST_TMP/doc_bad.json"
doc_bad_rc=$?
set -e
[ "$doc_bad_rc" -ne 0 ] || { echo "FAIL: omp-doctor must fail when Darwin mcp.json contains Windows path"; exit 1; }

# 2) Bootstrap --mode restore --skip-pull --no-install + --mode doctor on clean target
BOOT_TGT="$TEST_TMP/boot_omp"
"$BASH" "$BOOTSTRAP_SH" --mode restore --skip-pull --no-install --target-dir "$BOOT_TGT" --home "$TEST_TMP/boot_home" --no-local-config >/dev/null
test -f "$BOOT_TGT/agent/mcp.json" || { echo "FAIL: bootstrap restore missing mcp.json"; exit 1; }
"$PY_BIN" "$DOCTOR_SCRIPT" --target-dir "$BOOT_TGT" --repo-dir "$ROOT" --no-local-config --json | grep -q '"ok": true'
grep -q "System32" "$BOOTSTRAP_PS1" || { echo "FAIL: omp-bootstrap.ps1 must guard against WSL System32\\bash.exe"; exit 1; }
echo "✓ PASS: Phase 4 omp-doctor.py and omp-bootstrap.{sh,ps1} verified."

echo "=== ALL CROSS-OS E2E VALIDATION TESTS PASSED ==="
