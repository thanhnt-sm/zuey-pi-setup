#!/usr/bin/env bash
#
# tests/test-omp-doctor-loader-topology.sh - omp-doctor.py loader/package topology check
#
# Uses temp HOME/target dirs only; never reads or writes the real ~/.omp or ~/Projects.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCTOR="$ROOT/scripts/omp-doctor.py"

PY_BIN="python3"
command -v "$PY_BIN" >/dev/null 2>&1 && "$PY_BIN" -c "import sys" >/dev/null 2>&1 || PY_BIN="python"

TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/test-omp-doctor-loader-XXXXXX")"
trap 'rm -rf "$TEST_TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }

# new_machine <name> -> prints home dir; creates home/.omp/agent/extensions and the dev target
new_machine() {
  local home="$TEST_TMP/$1"
  mkdir -p "$home/.omp/agent/extensions" "$home/Projects/omp_extension"
  echo 'export default {};' > "$home/Projects/omp_extension/typesafe-planner.ts"
  echo "$home"
}

# topology_warnings <home> -> loader-topology warnings, one per line.
# The doctor exits non-zero on unrelated errors in a bare temp home; only its JSON is inspected.
topology_warnings() {
  local home="$1" json
  json="$("$PY_BIN" "$DOCTOR" --target-dir "$(native "$home/.omp")" --home "$(native "$home")" --no-local-config --json 2>/dev/null || true)"
  printf '%s' "$json" | "$PY_BIN" -c "import json,sys; [print(w) for w in json.load(sys.stdin)['warnings'] if w.startswith('Loader topology')]"
}

# expect_warning <home> <substring> <failure message>
expect_warning() {
  local out
  out="$(topology_warnings "$1")"
  case "$out" in *"$2"*) ;; *) fail "$3 (got: ${out:-none})" ;; esac
}

write_loader() {
  local home="$1"
  printf 'export { default } from "%s";\n' "$(native "$home/Projects/omp_extension/typesafe-planner.ts")" \
    > "$home/.omp/agent/extensions/typesafe-planner.ts"
}

echo "=== [TDD] omp-doctor loader topology ==="

# 1. Healthy: loader + existing target, no package dir
H1="$(new_machine healthy)"
write_loader "$H1"
[ -z "$(topology_warnings "$H1")" ] || fail "healthy loader topology produced warnings: $(topology_warnings "$H1")"
echo "✓ PASS: loader + target, no package dir -> no warning."

# 2. Loader and package dir both present -> duplicate load warning
H2="$(new_machine dual)"
write_loader "$H2"
mkdir -p "$H2/.omp/agent/extensions/typesafe-planner/src"
echo 'export default {};' > "$H2/.omp/agent/extensions/typesafe-planner/index.ts"
expect_warning "$H2" "both exist" "doctor did not warn when typesafe-planner.ts and typesafe-planner/ both exist"
echo "✓ PASS: loader + package dir -> duplicate-load warning."

# 3. Loader missing while the target exists (also the post-incident state: package dir only)
H3="$(new_machine lost)"
expect_warning "$H3" "loader is missing" "doctor did not warn about a missing loader whose target exists"
mkdir -p "$H3/.omp/agent/extensions/typesafe-planner"
echo 'export default {};' > "$H3/.omp/agent/extensions/typesafe-planner/index.ts"
expect_warning "$H3" "loader is missing" "doctor did not warn about package-only state while the target exists"
echo "✓ PASS: missing loader while target exists -> warning."

# 4. Loader pointing at a missing target -> warning
H4="$(new_machine broken)"
write_loader "$H4"
rm -f "$H4/Projects/omp_extension/typesafe-planner.ts"
expect_warning "$H4" "points at missing" "doctor did not warn about a loader with a missing target"
echo "✓ PASS: loader with missing target -> warning."

# 5. Portable machine (no dev target, dereferenced package only) -> no warning
H5="$(new_machine portable)"
rm -rf "$H5/Projects"
mkdir -p "$H5/.omp/agent/extensions/typesafe-planner"
echo 'export default {};' > "$H5/.omp/agent/extensions/typesafe-planner/index.ts"
[ -z "$(topology_warnings "$H5")" ] || fail "portable (package-only, no target) machine must not warn: $(topology_warnings "$H5")"
echo "✓ PASS: package-only machine without target -> no warning."

echo "=== ALL TDD TESTS PASSED ==="
