#!/usr/bin/env bash
#
# tests/test-omp-harvest-loop-runner.sh — Unit & integration tests for omp-harvest-loop-runner.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUNNER="$ROOT/scripts/omp-harvest-loop-runner.sh"
[ -f "$RUNNER" ] || { echo "Runner script missing: $RUNNER" >&2; exit 1; }

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/test-loop-runner-XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

MOCK_LEDGER="$TMP_DIR/ledger.json"
cat <<EOF > "$MOCK_LEDGER"
{
  "version": "2.2.0",
  "status": "HARVESTED",
  "summary": {},
  "suites": {},
  "loopMeta": {"round": 0, "lastRoundAt": null, "maxRounds": 5, "zeroDeltaStreak": 0},
  "promotionQueue": [
    {"hash": "mock111", "suite": "general_utilities", "targetSample": "sample1.py", "occurrences": 1, "state": "pending", "disposition": "pending"}
  ],
  "promotedHashes": {},
  "clusterDispositions": {}
}
EOF

# 1. Test dry-run
echo "=== [1] Test loop runner --dry-run ==="
bash "$RUNNER" --max-rounds 1 --batch-size 1 --dry-run --no-local-config --ledger "$MOCK_LEDGER"

# 2. Test gate failure halts runner
echo "=== [2] Test gate failure halts runner ==="
set +e
HARVEST_GATE_CMD="false" bash "$RUNNER" --max-rounds 1 --batch-size 1 --no-local-config --ledger "$MOCK_LEDGER" 2>/dev/null
GATE_RC=$?
set -e
[ "$GATE_RC" -eq 2 ] || { echo "Expected exit code 2 on gate failure, got $GATE_RC" >&2; exit 1; }
echo "✓ PASS: Gate failure halted runner with exit code 2."

# 3. Test successful round with mock gate
echo "=== [3] Test successful round with mock gate ==="
HARVEST_GATE_CMD="true" bash "$RUNNER" --max-rounds 1 --batch-size 1 --no-local-config --ledger "$MOCK_LEDGER"
MOCK_LEDGER_WIN="$(cygpath -m "$MOCK_LEDGER" 2>/dev/null || echo "$MOCK_LEDGER")"
python -c "
import json
d = json.load(open('$MOCK_LEDGER_WIN', encoding='utf-8'))
assert len(d.get('promotedHashes', {})) >= 1, f'No cluster committed: {d.get("promotedHashes")}'
assert d.get('loopMeta', {}).get('round', 0) >= 1
"
echo "✓ PASS: Successful round committed staged cluster and advanced round counter."

echo "=== ALL LOOP RUNNER TESTS PASSED ==="
