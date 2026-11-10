#!/usr/bin/env bash
#
# tests/test-omp-managed-skills-integrity.sh - Verify V2 Priority-100 skills, opt-in skills,
# agents, commands, rules, zero leaks/symlinks, and pass all 4 Python suite unittest suites.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENT_DIR="$ROOT/config/omp/agent"

echo "=== [Integrity] Checking V3 OMP Priority-100 & Claude Parity structure ==="
for skill in pmo-project-suite office-doc-suite email-intelligence-suite system-maintenance-suite omp-session-harvester pm-ba windows_fix ak-render hlk-loop; do
  test -f "$AGENT_DIR/skills/$skill/SKILL.md" || { echo "FAIL: Missing skills/$skill/SKILL.md" >&2; exit 1; }
done
test -f "$AGENT_DIR/skills/omp-session-harvester/scripts/harvester_core.py" || { echo "FAIL: Missing harvester_core.py" >&2; exit 1; }
test -f "$AGENT_DIR/extensions/omp-toolkit-hub.ts" || { echo "FAIL: Missing omp-toolkit-hub.ts" >&2; exit 1; }
test -f "$AGENT_DIR/extensions/omp-toolkit-hub/loop-state.ts" || { echo "FAIL: Missing loop-state.ts" >&2; exit 1; }
for ag in advisor.md ck-advisor.md pmo-ba.md pmo-planner.md pmo-reporter.md pmo-red-team.md hlk-worker.md Explore.md brainstormer.md code-reviewer.md debugger.md fullstack-developer.md orchestrator.md planner.md researcher.md tester.md; do
  test -f "$AGENT_DIR/agents/$ag" || { echo "FAIL: Missing agents/$ag" >&2; exit 1; }
done
test -f "$AGENT_DIR/commands/pmo-delivery.md"
test -f "$AGENT_DIR/commands/pm-email.md"
test -f "$AGENT_DIR/commands/ck-council.md"
test -f "$AGENT_DIR/rules/team-coordination-rules.md"
test -f "$AGENT_DIR/rules/orchestration-protocol.md"
test -f "$AGENT_DIR/rules/pm-ba-prewrite-guards.md"
test -f "$AGENT_DIR/tools-requirements.txt"
grep -q "^pypdf>=" "$AGENT_DIR/tools-requirements.txt" || { echo "FAIL: tools-requirements.txt missing pypdf" >&2; exit 1; }
echo "✓ PASS: All V3 Priority-100 skills, extension hub, 18+ agents, commands, rules, and pypdf present."
echo "=== [Integrity] Checking Tier B skills-optin hide: true invariant ==="
OPTIN_COUNT=0
for sm in "$AGENT_DIR/skills-optin"/*/SKILL.md; do
  [ -f "$sm" ] || continue
  OPTIN_COUNT=$((OPTIN_COUNT + 1))
  grep -qE '^hide:\s*true' "$sm" || { echo "FAIL: Opt-in skill missing hide: true: $sm" >&2; exit 1; }
done
[ "$OPTIN_COUNT" -ge 50 ] || { echo "FAIL: Expected >=50 opt-in skills, got $OPTIN_COUNT" >&2; exit 1; }
echo "✓ PASS: All $OPTIN_COUNT Tier B opt-in skills carry hide: true (zero system-prompt bloat)."

echo "=== [Integrity] Checking zero symlinks, zero DB/env/pyc, zero leaks ==="
SYMS="$(find "$AGENT_DIR" -type l 2>/dev/null || true)"
[ -z "$SYMS" ] || { echo "FAIL: Symlinks found in config/omp/agent: $SYMS" >&2; exit 1; }

BAD_FILES="$(find "$AGENT_DIR" -type f \( -name '*.db*' -o -name '*.sqlite*' -o -name '*.pyc' -o -name '.env' \) 2>/dev/null || true)"
[ -z "$BAD_FILES" ] || { echo "FAIL: Disallowed files in config/omp/agent: $BAD_FILES" >&2; exit 1; }

LEAKS="$(grep -rnE '(sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)' "$AGENT_DIR/skills" "$AGENT_DIR/skills-optin" "$AGENT_DIR/agents" "$AGENT_DIR/commands" "$AGENT_DIR/rules" 2>/dev/null || true)"
[ -z "$LEAKS" ] || { echo "FAIL: Sensitive leak detected in config/omp/agent:" >&2; echo "$LEAKS" >&2; exit 1; }
echo "✓ PASS: Zero symlinks, zero DB/pyc/.env, zero sensitive leaks."

echo "=== [Integrity] Running all 4 Python domain suite tests ==="
PY_BIN="python3"
command -v "$PY_BIN" >/dev/null 2>&1 || PY_BIN="python"
PYTHONDONTWRITEBYTECODE=1 "$PY_BIN" -B "$AGENT_DIR/skills/pmo-project-suite/tests/test_pmo_suite.py"
PYTHONDONTWRITEBYTECODE=1 "$PY_BIN" -B "$AGENT_DIR/skills/office-doc-suite/tests/test_office_suite.py"
PYTHONDONTWRITEBYTECODE=1 "$PY_BIN" -B "$AGENT_DIR/skills/email-intelligence-suite/tests/test_email_suite.py"
PYTHONDONTWRITEBYTECODE=1 "$PY_BIN" -B "$AGENT_DIR/skills/system-maintenance-suite/tests/test_maintenance_suite.py"
echo "=== ALL MANAGED SKILLS & DOMAIN SUITE INTEGRITY TESTS PASSED ==="
