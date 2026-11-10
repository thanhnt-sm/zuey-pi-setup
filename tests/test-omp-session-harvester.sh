#!/usr/bin/env bash
#
# tests/test-omp-session-harvester.sh - Test suite for V2 multi-source session harvester CLI
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/test-omp-harvester-XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[*] Setting up mock OMP, Claude, history.db, and project .omp/.claude fixtures..."
MOCK_SESSIONS="$TMP_DIR/sessions/mock-workspace"
MOCK_CLAUDE_PROJ="$TMP_DIR/claude-projects/mock-proj"
MOCK_PROJECT="$TMP_DIR/work/demo-proj"
MOCK_GLOBAL_OMP="$TMP_DIR/global-omp/agent"
MOCK_GLOBAL_CLAUDE="$TMP_DIR/global-claude"
mkdir -p "$MOCK_SESSIONS" "$MOCK_CLAUDE_PROJ" "$MOCK_PROJECT/.claude/skills/custom-skill" "$MOCK_PROJECT/.omp/agents" "$MOCK_GLOBAL_OMP/skills" "$MOCK_GLOBAL_OMP/agents" "$MOCK_GLOBAL_CLAUDE/skills"

# 1. Mock OMP session with write, edit, TWO eval calls (verifying zero collision), bash heredoc, and __advisor skip
cat << 'EOF' > "$MOCK_SESSIONS/session-001.jsonl"
{"type":"session","title":"Test PMO Session"}
{"type":"message","message":{"role":"user","content":[{"type":"text","text":"Create PMO and Office helpers"}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"write","arguments":{"path":"scripts/cpm_calc.py","content":"import math\ndef calculate_cpm_float(tasks):\n    # CPM WBS calculation\n    critical_path = []\n    for t in tasks:\n        if t.get('float') == 0:\n            critical_path.append(t)\n    return critical_path\n"}}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"edit","arguments":{"path":"scripts/note_helper.py","newText":"def parse_raid_notes(text):\n    # RAID daily parser edit test\n    return [ln.strip() for ln in text.splitlines() if ln.strip()]\n"}}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"eval","arguments":{"language":"py","code":"import openpyxl\ndef export_report_one(data):\n    wb = openpyxl.Workbook()\n    ws = wb.active\n    ws.title = 'SummaryOne'\n    return wb\n"}}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"eval","arguments":{"language":"py","code":"import docx\ndef export_report_two(data):\n    d = docx.Document()\n    d.add_paragraph('Second distinct eval call')\n    return d\n"}}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"bash","arguments":{"command":"cat << 'PY' > scripts/clean_helper.py\nimport shutil\ndef clean_temp_dir(p):\n    # wiztree clean_temp helper\n    return shutil.disk_usage(p)\nPY\n"}}]}}
EOF
echo '{"type":"advisor"}' > "$MOCK_SESSIONS/__advisor.jsonl"

# 2. Mock Claude Code session JSONL + history.jsonl
cat << 'EOF' > "$MOCK_CLAUDE_PROJ/claude-001.jsonl"
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"Write","input":{"file_path":"scripts/email_scan.py","content":"import email\ndef parse_eml_msg(raw):\n    # email_parser extract_msg test\n    return email.message_from_string(raw)\n"}}]}}
EOF
echo '{"display":"test","project":"D:/demo","sessionId":"s1","timestamp":1}' > "$TMP_DIR/claude-history.jsonl"

# 3. Mock history.db + secret leakage fixture in workspace
FAKE_SK="sk-ant-api03-$(printf 'a%.0s' $(seq 1 32))"
cat << EOF > "$MOCK_PROJECT/secret_probe.py"
API_TOKEN = "$FAKE_SK"
CORP_EMAIL = "ops@internal.corp"
CLIENT_PROJ = "ACME_CORP ProjAlpha"
def run_probe():
    return API_TOKEN, CORP_EMAIL, CLIENT_PROJ
EOF

WIN_TMP="$TMP_DIR"
if command -v cygpath >/dev/null 2>&1; then
  WIN_TMP="$(cygpath -m "$TMP_DIR")"
fi

python -c "
import sqlite3
conn = sqlite3.connect('$WIN_TMP/history.db')
conn.execute('CREATE TABLE history (id INTEGER PRIMARY KEY, prompt TEXT NOT NULL, created_at INT, cwd TEXT, session_id TEXT, use_count INT)')
conn.execute('CREATE TABLE session_titles (session_id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INT)')
conn.execute('CREATE TABLE session_recaps (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, cwd TEXT NOT NULL, recap TEXT NOT NULL, created_at INT)')
conn.execute(\"INSERT INTO history VALUES (1, 'sensitive prompt', 1, 'D:/work/ACME/Demo', 's1', 1)\")
conn.execute(\"INSERT INTO session_titles VALUES ('s1', 'Demo Title', 1)\")
conn.execute(\"INSERT INTO session_recaps VALUES (1, 's1', 'D:/work/ACME/Demo', 'Recap', 1)\")
conn.commit()
conn.close()
"
cat << EOF > "$TMP_DIR/harvest-config.json"
{
  "scanRoots": ["$WIN_TMP/work"],
  "additionalWorkspaces": ["$WIN_TMP/work/demo-proj"],
  "excludeDirNames": [".git", "node_modules"],
  "tierCExcludeGlobs": []
}
EOF
echo "---" > "$MOCK_PROJECT/.claude/skills/custom-skill/SKILL.md"
echo "---" > "$MOCK_PROJECT/.omp/agents/pmo-ba.md"

LEDGER_OUT="$TMP_DIR/ledger.json"
REPORT_OUT="$TMP_DIR/report.md"

echo "[*] Running harvester V2 in scan + diff-global mode..."
OMP_SENSITIVE_TERMS="ACME_CORP,ProjAlpha,internal.corp" python "$ROOT/scripts/omp-session-harvester.py" \
  --scan \
  --diff-global \
  --no-local-config \
  --sessions-dir "$WIN_TMP/sessions" \
  --claude-projects-dir "$WIN_TMP/claude-projects" \
  --claude-history "$WIN_TMP/claude-history.jsonl" \
  --history-db "$WIN_TMP/history.db" \
  --config "$WIN_TMP/harvest-config.json" \
  --ledger "$WIN_TMP/ledger.json" \
  --report "$WIN_TMP/report.md" \
  --workspaces "$WIN_TMP/work/demo-proj"

python -c "
import json
with open('$WIN_TMP/ledger.json', encoding='utf-8') as f:
    data = json.load(f)
s = data['summary']
assert data['status'] == 'HARVESTED', data['status']
assert s['ompSessionsScouted'] == 1, f'Expected 1 OMP session (advisor skipped), got {s[\"ompSessionsScouted\"]}'
assert s['claudeSessionsScouted'] == 1, f'Expected 1 Claude session, got {s[\"claudeSessionsScouted\"]}'
assert s['historyDbPrompts'] == 1, s
assert s['harvestedArtifactsCount'] >= 7, f'Expected >=7 artifacts (write, edit, 2 evals, bash, claude, workspace), got {s[\"harvestedArtifactsCount\"]}'
assert s['projectDeltasCount'] >= 1, 'Expected missing custom-skill/pmo-ba detected in global diff'
raw = open('$WIN_TMP/ledger.json', encoding='utf-8').read()
for bad in ('sk-ant-api03', 'internal.corp', 'ProjAlpha', 'ACME_CORP', 'sensitive prompt'):
    assert bad not in raw, f'Leaked sensitive string: {bad}'
print('[v] Multi-source counts, zero eval collision, edit/Claude/history.db, global diff, and secret scrub assertions passed.')
"

grep -q "OMP Harvest Inventory & Deduplication Report" "$REPORT_OUT"
grep -q "pmo_project_suite" "$REPORT_OUT"
grep -q "office_doc_suite" "$REPORT_OUT"
grep -q "email_intelligence_suite" "$REPORT_OUT"
grep -q "system_maintenance_suite" "$REPORT_OUT"
grep -q "Global vs Project" "$REPORT_OUT"

# Bare relative filename check (--ledger / --report with empty dirname)
(cd "$TMP_DIR" && python "$ROOT/scripts/omp-session-harvester.py" --scan --no-local-config --sessions-dir "$WIN_TMP/sessions" --claude-projects-dir "" --history-db "" --workspaces "" --ledger bare-ledger.json --report bare-report.md >/dev/null)
test -f "$TMP_DIR/bare-ledger.json" && test -f "$TMP_DIR/bare-report.md"

# --next smoke check
python "$ROOT/scripts/omp-session-harvester.py" --next --no-local-config --ledger "$WIN_TMP/ledger.json" | grep -q '"type"'

# Phase 1 V3 TDD Assertions
echo "[*] Testing local override merge, --no-local-config isolation, promote _PRIV_PAT scrub, and standalone harvest_cli.py..."
MOCK_HOME="$TMP_DIR/mock_home"
MOCK_LOCAL_WS="$TMP_DIR/local_only_ws"
mkdir -p "$MOCK_HOME/.omp/agent" "$MOCK_LOCAL_WS"
cat << 'EOF' > "$MOCK_LOCAL_WS/local_tool_a.py"
def local_helper():
    # padding comment so workspace file size safely exceeds the 150-byte threshold
    msg = "SECRET_LOCAL_TERM_XYZ and extra payload bytes for deterministic verification 1234567890"
    return msg * 3
EOF
cp "$MOCK_LOCAL_WS/local_tool_a.py" "$MOCK_LOCAL_WS/local_tool_b.py"
cat << EOF > "$MOCK_HOME/.omp/harvest-workspaces.local.json"
{
  "additionalWorkspaces": ["$WIN_TMP/local_only_ws"],
  "privateKeywords": ["SECRET_LOCAL_TERM_XYZ"]
}
EOF

# (a) Local override merges into harvester & scrubs privateKeywords
HOME="$WIN_TMP/mock_home" USERPROFILE="$WIN_TMP/mock_home" python "$ROOT/scripts/omp-session-harvester.py" \
  --scan --sessions-dir "" --claude-projects-dir "" --history-db "" \
  --config "$WIN_TMP/harvest-config.json" \
  --ledger "$WIN_TMP/merged-ledger.json" --report "$WIN_TMP/merged-report.md" >/dev/null
python -c "
import json
raw = open('$WIN_TMP/merged-ledger.json', encoding='utf-8').read()
rep = open('$WIN_TMP/merged-report.md', encoding='utf-8').read()
data = json.loads(raw)
assert data['summary']['harvestedArtifactsCount'] >= 2, data['summary']
assert 'local_tool_a.py' in raw, 'Expected local override workspace to be merged and scanned'
assert 'SECRET_LOCAL_TERM_XYZ' not in raw and 'SECRET_LOCAL_TERM_XYZ' not in rep, 'Expected privateKeywords from local config to scrub artifacts'
"

# (b) --no-local-config ignores mock_home/.omp/harvest-workspaces.local.json
HOME="$WIN_TMP/mock_home" USERPROFILE="$WIN_TMP/mock_home" python "$ROOT/scripts/omp-session-harvester.py" \
  --scan --no-local-config --sessions-dir "" --claude-projects-dir "" --history-db "" \
  --config "$WIN_TMP/harvest-config.json" \
  --ledger "$WIN_TMP/iso-ledger.json" --report "$WIN_TMP/iso-report.md" \
  --workspaces "" >/dev/null
python -c "
import json
raw = open('$WIN_TMP/iso-ledger.json', encoding='utf-8').read()
data = json.loads(raw)
assert data['summary']['harvestedArtifactsCount'] == 0, data['summary']
assert 'local_tool' not in raw, '--no-local-config failed to ignore harvest-workspaces.local.json'
"

# (c) omp-promote-assets.py wires _PRIV_PAT after CLI flags and scrubs OMP_SENSITIVE_TERMS + privateKeywords
PROMOTE_SRC="$TMP_DIR/promote_src_skill"
PROMOTE_TARGET="$TMP_DIR/promote_target/agent"
mkdir -p "$PROMOTE_SRC" "$PROMOTE_TARGET"
cat << 'EOF' > "$PROMOTE_SRC/SKILL.md"
---
name: sample-promo
description: "Scrub SECRET_LOCAL_TERM_XYZ and ENV_CUSTOM_SECRET_ABC cleanly"
---
# Sample
EOF
cat << EOF > "$TMP_DIR/promote-cfg.json"
{
  "tierAPromoteSources": {
    "skills": [{"name": "sample-promo", "source": "$WIN_TMP/promote_src_skill"}],
    "agents": [],
    "commands": [],
    "rules": []
  },
  "tierBOptInSources": []
}
EOF
OMP_SENSITIVE_TERMS="ENV_CUSTOM_SECRET_ABC" HOME="$WIN_TMP/mock_home" USERPROFILE="$WIN_TMP/mock_home" \
  python "$ROOT/scripts/omp-promote-assets.py" --config "$WIN_TMP/promote-cfg.json" --target "$WIN_TMP/promote_target/agent" >/dev/null
python -c "
out = open('$WIN_TMP/promote_target/agent/skills/sample-promo/SKILL.md', encoding='utf-8').read()
assert 'SECRET_LOCAL_TERM_XYZ' not in out, 'promote_assets leaked privateKeywords'
assert 'ENV_CUSTOM_SECRET_ABC' not in out, 'promote_assets leaked OMP_SENSITIVE_TERMS'
"

# (d) Standalone harvest_cli.py --next works outside repo using ~/.omp/agent/omp-consolidation-ledger.json
STANDALONE_SKILL_COPY="$TMP_DIR/standalone_home/.omp/agent/skills/omp-session-harvester/scripts"
ISOLATED_CWD="$TMP_DIR/isolated_cwd"
mkdir -p "$STANDALONE_SKILL_COPY" "$ISOLATED_CWD"
cp "$ROOT/config/omp/agent/skills/omp-session-harvester/scripts/"*.py "$STANDALONE_SKILL_COPY/"
cp "$WIN_TMP/ledger.json" "$TMP_DIR/standalone_home/.omp/agent/omp-consolidation-ledger.json"
(cd "$ISOLATED_CWD" && env -u ZUEY_PI_REPO HOME="$WIN_TMP/standalone_home" USERPROFILE="$WIN_TMP/standalone_home" \
  python "$STANDALONE_SKILL_COPY/harvest_cli.py" --next | grep -q '"type"')
test ! -d "$ISOLATED_CWD/plans" || { echo "FAIL: standalone harvest_cli.py created ./plans/ in CWD"; exit 1; }

# (e) Wrapper scripts/omp-session-harvester.py delegates to harvester_core
grep -q "harvester_core" "$ROOT/scripts/omp-session-harvester.py" || { echo "FAIL: scripts/omp-session-harvester.py must delegate to harvester_core"; exit 1; }

echo "[v] PASS: test-omp-session-harvester.sh V2+V3 passed all assertions."
