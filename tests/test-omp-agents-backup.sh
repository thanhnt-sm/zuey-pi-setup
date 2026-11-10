#!/usr/bin/env bash
#
# tests/test-omp-agents-backup.sh - Verify V2 Priority-100 skills/agents/commands/rules,
# recursive extension deref (../tools/*), symlink refusal, and private --claude path rehydration.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_SCRIPT="$ROOT/scripts/omp-setup-backup.sh"
RESTORE_SCRIPT="$ROOT/scripts/omp-setup-restore.sh"
PRIV_BACKUP="$ROOT/scripts/omp-private-backup.sh"
PRIV_RESTORE="$ROOT/scripts/omp-private-restore.sh"

TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/test-omp-agents-XXXXXX")"
trap 'rm -rf "$TEST_TMP"' EXIT

echo "=== [TDD] Setting up mock OMP with agents, Priority-100 skills, opt-in skills & multi-hop extension ==="
MOCK_OMP="$TEST_TMP/mock_omp"
mkdir -p "$MOCK_OMP/agent/extensions" "$MOCK_OMP/agent/agents" "$MOCK_OMP/agent/skills/demo-suite/scripts" "$MOCK_OMP/agent/skills-optin/optin-skill" "$MOCK_OMP/agent/commands" "$MOCK_OMP/agent/rules" "$MOCK_OMP/plugins"

cat <<'EOF' > "$MOCK_OMP/agent/config.yml"
shellPath: C:\Program Files\Git\bin\bash.exe
skills:
  enableClaudeUser: true
  customDirectories:
    - "C:/Users/demo/.omp/agent/skills-optin"
EOF
echo 'providers: {}' > "$MOCK_OMP/agent/models.yml"
echo '{"typesafe":{"enabled":true}}' > "$MOCK_OMP/agent/typesafe.json"
echo 'openpyxl>=3.1.2' > "$MOCK_OMP/agent/tools-requirements.txt"
echo '{"name":"omp-plugins","private":true,"dependencies":{}}' > "$MOCK_OMP/plugins/package.json"
printf -- '---\nname: advisor\ndescription: Advisor\n---\nBody\n' > "$MOCK_OMP/agent/agents/advisor.md"
printf -- '---\nname: pmo-ba\ndescription: PMO BA\nautoloadSkills: [pmo-project-suite]\n---\nBody\n' > "$MOCK_OMP/agent/agents/pmo-ba.md"
printf -- '---\nname: demo-suite\ndescription: Demo suite\n---\n# Demo\n' > "$MOCK_OMP/agent/skills/demo-suite/SKILL.md"
printf -- '#!/usr/bin/env bash\necho ok\n' > "$MOCK_OMP/agent/skills/demo-suite/scripts/run.sh"
printf -- '---\nname: optin-skill\ndescription: Optin\nhide: true\n---\n# Optin\n' > "$MOCK_OMP/agent/skills-optin/optin-skill/SKILL.md"
printf -- '# Flow Command\n' > "$MOCK_OMP/agent/commands/pmo-delivery.md"
printf -- '# Rule\n' > "$MOCK_OMP/agent/rules/team-coordination-rules.md"

# Multi-hop shim: entry -> ./src/host.ts -> ../tools/paired.ts
EXT_SRC="$TEST_TMP/ext_pkg"
mkdir -p "$EXT_SRC/src" "$EXT_SRC/tools"
cat <<'EOF' > "$EXT_SRC/entry.ts"
import { runHost } from "./src/host";
export default function () { return runHost(); }
EOF
cat <<'EOF' > "$EXT_SRC/src/host.ts"
import { PAIRED_ID } from "../tools/paired";
export function runHost() { return PAIRED_ID; }
EOF
echo 'export const PAIRED_ID = "jev-paired-ok";' > "$EXT_SRC/tools/paired.ts"
echo "export { default } from \"$EXT_SRC/entry.ts\";" > "$MOCK_OMP/agent/extensions/planner.ts"

OUT_CFG="$TEST_TMP/cfg_out"
OUT_TAR="$TEST_TMP/portable.tar.gz"
"$BASH" "$BACKUP_SCRIPT" --source "$MOCK_OMP" --config-dir "$OUT_CFG" -o "$OUT_TAR" --no-upstream

echo "=== [TDD] Asserting multi-hop extension deref & Priority-100 artifacts ==="
test -f "$OUT_CFG/agent/extensions/planner/index.ts"
test -f "$OUT_CFG/agent/extensions/planner/src/host.ts"
test -f "$OUT_CFG/agent/extensions/planner/tools/paired.ts"
test ! -e "$OUT_CFG/agent/extensions/planner.ts"
test -f "$OUT_CFG/agent/agents/advisor.md"
test -f "$OUT_CFG/agent/agents/pmo-ba.md"
test -f "$OUT_CFG/agent/skills/demo-suite/SKILL.md"
test -f "$OUT_CFG/agent/skills-optin/optin-skill/SKILL.md"
test -f "$OUT_CFG/agent/commands/pmo-delivery.md"
test -f "$OUT_CFG/agent/rules/team-coordination-rules.md"
test -f "$OUT_CFG/agent/typesafe.json"
test -f "$OUT_CFG/agent/tools-requirements.txt"
grep -q '{{OMP_SKILLS_OPTIN_DIR}}' "$OUT_CFG/agent/config.yml"
echo "✓ PASS: Multi-hop deref (../tools/paired.ts), agents, Priority-100 skills, optin, commands, rules & templates captured."

# Restore under simulated Darwin/macOS (--no-install)
RESTORE_TGT="$TEST_TMP/restored_darwin"
OS_OVERRIDE="Darwin" "$BASH" "$RESTORE_SCRIPT" --source-tar "$OUT_TAR" --target-dir "$RESTORE_TGT" --no-install --no-upstream
test -f "$RESTORE_TGT/agent/agents/pmo-ba.md"
test -f "$RESTORE_TGT/agent/skills/demo-suite/SKILL.md"
test -f "$RESTORE_TGT/agent/extensions/planner/tools/paired.ts"
grep -q "$RESTORE_TGT/agent/skills-optin" "$RESTORE_TGT/agent/config.yml" || grep -q "skills-optin" "$RESTORE_TGT/agent/config.yml"
echo "✓ PASS: Darwin restore populates Priority-100 dirs and substitutes {{OMP_SKILLS_OPTIN_DIR}}."

# Private --claude backup & Darwin restore path rewrite test (strictly in $TEST_TMP outside repo)
echo "=== [TDD] Testing private --claude path templating & cross-OS restore ==="
FAKE_HOME="$TEST_TMP/fake_home"
FAKE_RESTORE_HOME="$TEST_TMP/fake_restore_home"
mkdir -p "$FAKE_HOME/.omp/agent/memories/mnemopi/banks/b1" "$FAKE_HOME/.claude/hooks" "$FAKE_HOME/.claude/skills/custom"
echo '# skill' > "$FAKE_HOME/.claude/skills/custom/SKILL.md"
echo '#!/usr/bin/env bash' > "$FAKE_HOME/.claude/hooks/test.sh"
FAKE_HOME_NAT="$FAKE_HOME"
if command -v cygpath >/dev/null 2>&1; then
  FAKE_HOME_NAT="$(cygpath -m "$FAKE_HOME")"
fi
cat <<EOF > "$FAKE_HOME/.claude/settings.json"
{
  "hooks": { "SessionStart": [{ "command": "$FAKE_HOME_NAT/.claude/runtime/node/node.exe $FAKE_HOME_NAT/.claude/hooks/session.cjs" }] }
}
EOF
cat <<EOF > "$FAKE_HOME/.claude.json"
{
  "mcpServers": {
    "typesafe": {
      "command": "$FAKE_HOME_NAT/.claude/runtime/node/node.exe",
      "args": ["$FAKE_HOME_NAT/.claude/mcp/typesafe/server.cjs"]
    }
  }
}
EOF

PRIV_OUT="$TEST_TMP/priv-out/backup.tar.gz"
"$BASH" "$PRIV_BACKUP" --source "$FAKE_HOME/.omp" --home "$FAKE_HOME" --claude --no-encrypt -o "$PRIV_OUT"
OS_OVERRIDE="Darwin" "$BASH" "$PRIV_RESTORE" --home "$FAKE_RESTORE_HOME" "$PRIV_OUT"

test -f "$FAKE_RESTORE_HOME/.claude/skills/custom/SKILL.md"
test -f "$FAKE_RESTORE_HOME/.claude/settings.json"
test -f "$FAKE_RESTORE_HOME/.claude.json"
if grep -qi "$FAKE_HOME_NAT" "$FAKE_RESTORE_HOME/.claude/settings.json" || grep -qi "node.exe" "$FAKE_RESTORE_HOME/.claude/settings.json"; then
  echo "FAIL: Windows node.exe or source home leaked into Darwin restored settings.json" >&2
  cat "$FAKE_RESTORE_HOME/.claude/settings.json" >&2
  exit 1
fi
grep -q "typesafe" "$FAKE_RESTORE_HOME/.claude.json"
echo "✓ PASS: Private --claude backup & Darwin restore rewrite Windows node.exe/home cleanly."

echo "=== [TDD] Checking 18 ported core Claude agents, 6 rules, and 4 workflow commands in repo ==="
REPO_AGENT="$ROOT/config/omp/agent"
for ag in Explore brainstormer code-reviewer code-simplifier council-adjudicator council-expert debugger docs-manager fullstack-developer git-manager journal-writer mcp-manager orchestrator planner project-manager researcher tester ui-ux-designer; do
  test -f "$REPO_AGENT/agents/$ag.md" || { echo "FAIL: Missing ported Claude agent $ag.md" >&2; exit 1; }
done
for keep in advisor ck-advisor pmo-ba pmo-planner pmo-reporter pmo-red-team hlk-worker; do
  test -f "$REPO_AGENT/agents/$keep.md" || { echo "FAIL: Existing agent $keep.md missing" >&2; exit 1; }
done
for rl in development-rules documentation-management orchestration-protocol primary-workflow skill-domain-routing skill-workflow-routing pm-ba-prewrite-guards; do
  test -f "$REPO_AGENT/rules/$rl.md" || { echo "FAIL: Missing ported rule $rl.md" >&2; exit 1; }
done
for cmd in ck-council ck-parallel ck-red-team ck-scout-fanout; do
  test -f "$REPO_AGENT/commands/$cmd.md" || { echo "FAIL: Missing workflow command $cmd.md" >&2; exit 1; }
done
python - "$REPO_AGENT" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
core_agents = [
    "Explore", "brainstormer", "code-reviewer", "code-simplifier",
    "council-adjudicator", "council-expert", "debugger", "docs-manager",
    "fullstack-developer", "git-manager", "journal-writer", "mcp-manager",
    "orchestrator", "planner", "project-manager", "researcher",
    "tester", "ui-ux-designer",
]
bad_tools = ("SendMessage", "WebFetch", "NotebookEdit", "Skill", "TaskCreate", "TaskGet", "TaskUpdate", "TaskList", "mcp__")
bad_fm_keys = ("memory:", "omitClaudeMd:", "maxTurns:", "effort:", "disallowedTools:", "skills:")
for name in core_agents:
    p = root / "agents" / f"{name}.md"
    txt = p.read_text(encoding="utf-8")
    assert txt.startswith("---"), f"{name}.md missing frontmatter"
    fm = txt.split("---", 2)[1]
    assert not re.search(r"^model:\s*(opus|sonnet|haiku|inherit)\s*$", fm, re.M), f"{name}.md unmapped model: {fm}"
    for fk in bad_fm_keys:
        assert not re.search(rf"^{re.escape(fk)}", fm, re.M), f"{name}.md retained unsupported frontmatter {fk}"
    m = re.search(r"^tools:\s*(.+)$", fm, re.M)
    if m:
        for bt in bad_tools:
            assert bt not in m.group(1), f"{name}.md retained Claude-only tool {bt}: {m.group(1)}"
    assert not re.search(r"[A-Za-z]:[/\\]+Users[/\\]+(?!user\b|username\b)", txt, re.I), f"{name}.md leaked personal path"
print("✓ PASS: All 18 ported Claude agents pass OMP schema, tool mapping, and leak checks.")
PY
echo "=== ALL AGENTS & PORTABILITY TESTS PASSED ==="
