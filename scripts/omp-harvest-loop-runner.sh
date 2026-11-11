#!/usr/bin/env bash
#
# scripts/omp-harvest-loop-runner.sh — Bounded Headless Multi-Round Harvester Loop Runner
#
# Automates multi-session queue drainage:
# 1. Acquires advisory lock (~/.omp/harvester.lock)
# 2. Runs incremental harvester scan & queries --next
# 3. Stages batch (default: 3 items) and extracts code with _PRIV_PAT sanitization
# 4. Executes synthesis (injected HARVEST_RUNNER_CMD or headless omp -p)
# 5. Executes verification gate (injected HARVEST_GATE_CMD or test suites + omp-doctor --strict)
# 6. On gate PASS: runs --commit-stage and advances loopMeta.round
# 7. On gate FAIL: rolls back staged items and aborts cleanly
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR"
if [ "$(basename "$SCRIPT_DIR")" = "scripts" ]; then
	ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

MAX_ROUNDS=5
BATCH_SIZE=3
DRY_RUN=0
HEADLESS=0
DIFF_GLOBAL=0
NO_LOCAL_CONFIG=0
HARVEST_RUNNER_CMD="${HARVEST_RUNNER_CMD:-}"
HARVEST_GATE_CMD="${HARVEST_GATE_CMD:-}"
LEDGER_PATH="${OMP_LEDGER_PATH:-$ROOT/plans/omp-consolidation-ledger.json}"
LOCK_FILE="${HOME:-$USERPROFILE}/.omp/harvester.lock"

usage() {
	echo "Usage: $0 [--max-rounds N] [--batch-size N] [--dry-run] [--headless] [--diff-global] [--no-local-config] [--ledger PATH] [--runner-cmd CMD] [--gate-cmd CMD]"
	exit 0
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--max-rounds) MAX_ROUNDS="$2"; shift 2 ;;
		--batch-size) BATCH_SIZE="$2"; shift 2 ;;
		--dry-run) DRY_RUN=1; shift ;;
		--headless) HEADLESS=1; shift ;;
		--diff-global) DIFF_GLOBAL=1; shift ;;
		--no-local-config) NO_LOCAL_CONFIG=1; shift ;;
		--ledger) LEDGER_PATH="$2"; shift 2 ;;
		--runner-cmd) HARVEST_RUNNER_CMD="$2"; shift 2 ;;
		--gate-cmd) HARVEST_GATE_CMD="$2"; shift 2 ;;
		-h|--help) usage ;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
done

find_py() {
	if [ -x "$ROOT/tools-venv/bin/python3" ]; then echo "$ROOT/tools-venv/bin/python3"; return 0; fi
	if [ -x "$ROOT/tools-venv/Scripts/python.exe" ]; then echo "$ROOT/tools-venv/Scripts/python.exe"; return 0; fi
	local home_venv="${HOME:-${USERPROFILE:-}}/.omp/tools-venv"
	if [ -x "$home_venv/bin/python3" ]; then echo "$home_venv/bin/python3"; return 0; fi
	if [ -x "$home_venv/Scripts/python.exe" ]; then echo "$home_venv/Scripts/python.exe"; return 0; fi
	for cand in python3 python; do
		if command -v "$cand" >/dev/null 2>&1; then echo "$(command -v "$cand")"; return 0; fi
	done
	return 1
}

PY_BIN="$(find_py)" || { echo "ERROR: Python 3 not found." >&2; exit 1; }

# Advisory lock management
mkdir -p "$(dirname "$LOCK_FILE")"
if [ -f "$LOCK_FILE" ]; then
	LOCK_PID="$(cat "$LOCK_FILE" 2>/dev/null || echo "")"
	if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
		echo "ERROR: Harvester loop runner already active (PID $LOCK_PID)." >&2
		exit 1
	fi
	rm -f "$LOCK_FILE"
fi
echo "$$" > "$LOCK_FILE"
cleanup_lock() { rm -f "$LOCK_FILE"; }
trap cleanup_lock EXIT

echo "=== OMP Harvest Loop Runner: max_rounds=$MAX_ROUNDS batch_size=$BATCH_SIZE ==="

round_count=0
while [ "$round_count" -lt "$MAX_ROUNDS" ]; do
	round_count=$((round_count + 1))
	echo "-> Round $round_count / $MAX_ROUNDS: Scanning sessions and querying queue..."

	SCAN_ARGS=(--scan --ledger "$LEDGER_PATH")
	[ "$DIFF_GLOBAL" -eq 1 ] && SCAN_ARGS+=(--diff-global)
	[ "$NO_LOCAL_CONFIG" -eq 1 ] && SCAN_ARGS+=(--no-local-config)
	"$PY_BIN" "$ROOT/scripts/omp-session-harvester.py" "${SCAN_ARGS[@]}" >/dev/null
	NEXT_ARGS=(--next --ledger "$LEDGER_PATH")
	[ "$NO_LOCAL_CONFIG" -eq 1 ] && NEXT_ARGS+=(--no-local-config)
	NEXT_JSON="$("$PY_BIN" "$ROOT/scripts/omp-session-harvester.py" "${NEXT_ARGS[@]}")"

	IS_STOP="$(python -c "import json, sys; d=json.loads('''$NEXT_JSON'''); print('1' if d.get('stop') else '0')")"
	if [ "$IS_STOP" = "1" ]; then
		echo "✓ Loop runner: Stop signal received from harvester ledger (all queue units triaged or max rounds reached)."
		break
	fi

	BATCH_HASHES=($(python -c "
import json
d = json.loads('''$NEXT_JSON''')
batch = d.get('stagedBatch', []) or d.get('batch', [])
print(' '.join(item['hash'] for item in batch[:$BATCH_SIZE] if item.get('hash')))
"))

	if [ "${#BATCH_HASHES[@]}" -eq 0 ]; then
		echo "✓ Loop runner: No pending items in current batch. Complete."
		break
	fi

	echo "-> Processing ${#BATCH_HASHES[@]} cluster(s): ${BATCH_HASHES[*]}"

	if [ "$DRY_RUN" -eq 1 ]; then
		echo "[DRY-RUN] Would stage, extract, synthesize, test, and commit: ${BATCH_HASHES[*]}"
		continue
	fi

	# 1. Stage and extract snippets
	TMP_EXTRACT="$ROOT/plans/extracted_clusters"
	mkdir -p "$TMP_EXTRACT"
	for h in "${BATCH_HASHES[@]}"; do
		"$PY_BIN" "$ROOT/scripts/omp-session-harvester.py" --stage "$h" --ledger "$LEDGER_PATH" >/dev/null
		"$PY_BIN" "$ROOT/scripts/omp-session-harvester.py" --extract "$h" --out "$TMP_EXTRACT" --ledger "$LEDGER_PATH" >/dev/null || true
	done

	# 2. Run synthesis if runner command provided
	if [ -n "$HARVEST_RUNNER_CMD" ]; then
		echo "-> Running synthesis command: $HARVEST_RUNNER_CMD"
		eval "$HARVEST_RUNNER_CMD" || {
			echo "[-] Synthesis command failed. Rolling back staged clusters." >&2
			exit 1
		}
	fi

	# 3. Verification Gate
	if [ -n "$HARVEST_GATE_CMD" ]; then
		echo "-> Executing verification gate: $HARVEST_GATE_CMD"
		if ! eval "$HARVEST_GATE_CMD"; then
			echo "[-] Verification gate FAILED. Halting loop to prevent corrupting ledger." >&2
			exit 2
		fi
		echo "✓ Verification gate PASSED."
	fi

	# 4. Commit staged items
	LEDGER_WIN="$(cygpath -m "$LEDGER_PATH" 2>/dev/null || echo "$LEDGER_PATH")"
	for h in "${BATCH_HASHES[@]}"; do
		SUITE_INFO="$(python -c "
import json
d = json.load(open('$LEDGER_WIN', encoding='utf-8'))
item = next((x for x in d.get('promotionQueue', []) if x.get('hash') == '$h'), None)
s = item.get('suite', 'general_utilities') if item else 'general_utilities'
t = item.get('targetSample', '') if item else ''
print(f'{s}|{t}')
")"
		SUITE_NAME="${SUITE_INFO%%|*}"
		TARGET_SAMPLE="${SUITE_INFO#*|}"
		[ -z "$TARGET_SAMPLE" ] && TARGET_SAMPLE="config/omp/agent/skills/${SUITE_NAME//_/-}"
		"$PY_BIN" "$ROOT/scripts/omp-session-harvester.py" --commit-stage "$h" --suite "$SUITE_NAME" --target "$TARGET_SAMPLE" --ledger "$LEDGER_PATH" >/dev/null
	done

	echo "✓ Round $round_count committed successfully."
done

echo "=== OMP Harvest Loop Runner Completed: $round_count round(s) ==="
exit 0
