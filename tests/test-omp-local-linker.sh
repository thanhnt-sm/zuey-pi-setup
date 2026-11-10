#!/usr/bin/env bash
#
# tests/test-omp-local-linker.sh - TDD tests for opt-in local reference linker (scripts/omp-link-local.py)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LINKER="$ROOT/scripts/omp-link-local.py"

TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/test-omp-linker-XXXXXX")"
trap 'rm -rf "$TEST_TMP"' EXIT

WIN_TMP="$TEST_TMP"
if command -v cygpath >/dev/null 2>&1; then
  WIN_TMP="$(cygpath -m "$TEST_TMP")"
fi

MOCK_GLOBAL="$TEST_TMP/global_omp/agent"
MOCK_BACKUP="$TEST_TMP/restore_bak"
SHARED_PROJ="$TEST_TMP/proj_shared"
MIXED_PROJ="$TEST_TMP/proj_mixed"
OVERRIDE_PROJ="$TEST_TMP/proj_override"
UNPROMOTED_PROJ="$TEST_TMP/proj_unpromoted"

mkdir -p "$MOCK_GLOBAL/skills/demo-skill" "$MOCK_GLOBAL/rules" \
         "$SHARED_PROJ/.omp/skills/demo-skill" \
         "$MIXED_PROJ/.omp/rules" \
         "$OVERRIDE_PROJ/.omp/skills/demo-skill" \
         "$UNPROMOTED_PROJ/.omp/skills/local-only-skill"

echo "# Global Demo Skill v2" > "$MOCK_GLOBAL/skills/demo-skill/SKILL.md"
echo "# Global Rule" > "$MOCK_GLOBAL/rules/core-rule.md"
echo "# Local Stale Copy" > "$SHARED_PROJ/.omp/skills/demo-skill/SKILL.md"
echo "# Stale Rule" > "$MIXED_PROJ/.omp/rules/core-rule.md"
echo "# Local Custom Rule" > "$MIXED_PROJ/.omp/rules/project-custom.md"
echo "# Override Skill" > "$OVERRIDE_PROJ/.omp/skills/demo-skill/SKILL.md"
echo "# Unpromoted Skill" > "$UNPROMOTED_PROJ/.omp/skills/local-only-skill/SKILL.md"

CFG="$TEST_TMP/linker-cfg.json"
cat << EOF > "$CFG"
{
  "workspaceClassification": {
    "override": ["$WIN_TMP/proj_override/.omp"],
    "shared_mirror": [
      "$WIN_TMP/proj_shared/.omp",
      "$WIN_TMP/proj_mixed/.omp",
      "$WIN_TMP/proj_unpromoted/.omp"
    ],
    "archive": []
  }
}
EOF

echo "=== [1] --plan makes zero filesystem mutations & classifies override vs shared_mirror ==="
PLAN_JSON="$(python "$LINKER" --plan --json --no-local-config --config "$WIN_TMP/linker-cfg.json" --global-agent-dir "$WIN_TMP/global_omp/agent" --backup-dir "$WIN_TMP/restore_bak")"
python -c "
import json, sys
d = json.loads(sys.argv[1])
actions = {item['target']: item for item in d.get('actions', [])}
assert any('proj_override' in k and v['action'] == 'skip_override' for k, v in actions.items()), d
assert any('proj_shared' in k and v['action'] == 'link_dir' for k, v in actions.items()), d
assert any('proj_mixed' in k and v['action'] == 'hash_sync_fallback' for k, v in actions.items()), d
assert any('proj_unpromoted' in k and v['action'] == 'refuse_unpromoted' for k, v in actions.items()), d
" "$PLAN_JSON"
grep -q "Local Stale Copy" "$SHARED_PROJ/.omp/skills/demo-skill/SKILL.md"
test ! -d "$MOCK_BACKUP"

echo "=== [2] --apply links pure-subset dir, syncs mixed dir, backs up, leaves override & unpromoted untouched ==="
python "$LINKER" --apply --json --no-local-config --config "$WIN_TMP/linker-cfg.json" --global-agent-dir "$WIN_TMP/global_omp/agent" --backup-dir "$WIN_TMP/restore_bak" >/dev/null
grep -q "Global Demo Skill v2" "$SHARED_PROJ/.omp/skills/demo-skill/SKILL.md"
grep -q "Global Rule" "$MIXED_PROJ/.omp/rules/core-rule.md"
grep -q "Local Custom Rule" "$MIXED_PROJ/.omp/rules/project-custom.md"
grep -q "Override Skill" "$OVERRIDE_PROJ/.omp/skills/demo-skill/SKILL.md"
grep -q "Unpromoted Skill" "$UNPROMOTED_PROJ/.omp/skills/local-only-skill/SKILL.md"
# Backup snapshot of replaced local mirror must exist
find "$MOCK_BACKUP" -type f -name "SKILL.md" | grep -q "SKILL.md"

echo "=== [3] --verify confirms valid link targets and synced hashes ==="
VER_JSON="$(python "$LINKER" --verify --json --no-local-config --config "$WIN_TMP/linker-cfg.json" --global-agent-dir "$WIN_TMP/global_omp/agent")"
python -c "
import json, sys
d = json.loads(sys.argv[1])
assert d.get('valid') is True, d
assert d.get('brokenLinks', 1) == 0, d
" "$VER_JSON"

echo "✓ PASS: test-omp-local-linker.sh passed all assertions."
