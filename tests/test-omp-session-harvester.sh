#!/usr/bin/env bash
#
# tests/test-omp-session-harvester.sh - Test suite for session harvester CLI
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/test-omp-harvester-XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[*] Setting up mock session directory in $TMP_DIR..."
MOCK_SESSIONS="$TMP_DIR/sessions/mock-workspace"
mkdir -p "$MOCK_SESSIONS"

# Create mock session JSONL
cat << 'EOF' > "$MOCK_SESSIONS/session-001.jsonl"
{"type":"session","title":"Test PMO Session"}
{"type":"message","message":{"role":"user","content":[{"type":"text","text":"Create a WBS calculator"}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"thinking","text":"Generating code"},{"type":"toolCall","name":"write","arguments":{"path":"scripts/cpm_calc.py","content":"import math\ndef calculate_cpm_float(tasks):\n    # CPM WBS calculation\n    critical_path = []\n    for t in tasks:\n        if t.get('float') == 0:\n            critical_path.append(t)\n    return critical_path\n"}}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"eval","arguments":{"language":"py","code":"import openpyxl\nfrom docx import Document\ndef export_report(data):\n    wb = openpyxl.Workbook()\n    ws = wb.active\n    ws.title = 'Summary'\n    return wb\n"}}]}}
EOF

LEDGER_OUT="$TMP_DIR/ledger.json"
REPORT_OUT="$TMP_DIR/report.md"

# Convert to Windows/mixed path for Python on Windows if cygpath exists
WIN_SESSIONS="$TMP_DIR/sessions"
WIN_LEDGER="$LEDGER_OUT"
WIN_REPORT="$REPORT_OUT"
if command -v cygpath >/dev/null 2>&1; then
  WIN_SESSIONS="$(cygpath -m "$TMP_DIR/sessions")"
  WIN_LEDGER="$(cygpath -m "$LEDGER_OUT")"
  WIN_REPORT="$(cygpath -m "$REPORT_OUT")"
fi

echo "[*] Running harvester in non-interactive scan mode..."
python "$ROOT/scripts/omp-session-harvester.py" \
  --scan \
  --sessions-dir "$WIN_SESSIONS" \
  --ledger "$WIN_LEDGER" \
  --report "$WIN_REPORT" \
  --workspaces ""

echo "[*] Verifying test assertions..."

if [ ! -f "$LEDGER_OUT" ]; then
  echo "[-] FAIL: Ledger was not created at $LEDGER_OUT" >&2
  exit 1
fi

if [ ! -f "$REPORT_OUT" ]; then
  echo "[-] FAIL: Report was not created at $REPORT_OUT" >&2
  exit 1
fi

# Validate ledger contents
python -c "
import json
with open('$WIN_LEDGER') as f:
    data = json.load(f)
assert data.get('status') == 'HARVESTED', f'Unexpected status: {data.get(\"status\")}'
assert data.get('summary', {}).get('harvestedArtifactsCount', 0) >= 2, 'Failed to extract artifacts'
print('[v] Ledger schema and artifact count assertions passed.')
"

# Validate report contents
grep -q "OMP Harvest Inventory & Deduplication Report" "$REPORT_OUT" || {
  echo "[-] FAIL: Report missing title" >&2
  exit 1
}
grep -q "pmo_project_suite" "$REPORT_OUT" || {
  echo "[-] FAIL: Report missing pmo_project_suite classification" >&2
  exit 1
}
grep -q "office_doc_suite" "$REPORT_OUT" || {
  echo "[-] FAIL: Report missing office_doc_suite classification" >&2
  exit 1
}

echo "[v] PASS: test-omp-session-harvester.sh passed successfully."
