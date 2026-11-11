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

# Phase 2 V3 TDD Assertions: Incremental Watermarks, Rehydration, Extract, Advisors, Container Symlinks & Drift
echo "[*] Testing Phase 2 incremental watermarks, rehydration, --extract, --include-advisors, container symlinks & DRIFT_DETECTED..."
P2_SESS="$TMP_DIR/p2_sessions/ws"
P2_LEDGER="$TMP_DIR/p2-ledger.json"
P2_REPORT="$TMP_DIR/p2-report.md"
P2_CFG="$TMP_DIR/p2-cfg.json"
P2_WORK="$TMP_DIR/p2_work"
P2_PROJ="$P2_WORK/proj_a"
P2_RULES_TGT="$TMP_DIR/p2_global_rules"
mkdir -p "$P2_SESS" "$P2_PROJ/.omp" "$P2_RULES_TGT"
echo "# Rule" > "$P2_RULES_TGT/rule1.md"

# Create container-level symlink/junction at <proj>/.omp/rules -> $P2_RULES_TGT
if command -v cygpath >/dev/null 2>&1; then
  cmd.exe //c mklink //J "$(cygpath -w "$P2_PROJ/.omp/rules")" "$(cygpath -w "$P2_RULES_TGT")" >/dev/null
else
  ln -s "$P2_RULES_TGT" "$P2_PROJ/.omp/rules"
fi

cat << EOF > "$P2_CFG"
{
  "scanRoots": ["$WIN_TMP/p2_work"],
  "additionalWorkspaces": [],
  "excludeDirNames": [".git", "node_modules"],
  "tierCExcludeGlobs": []
}
EOF

# Session with >280-char script carrying a trailing marker well beyond 200-char snippet preview
cat << 'EOF' > "$P2_SESS/s1.jsonl"
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"write","arguments":{"path":"scripts/long_util.py","content":"import math\ndef compute_long_pipeline(items):\n    total = 0\n    for idx, val in enumerate(items):\n        total += (idx + 1) * float(val)\n    # padding commentary ensuring total payload easily exceeds two hundred chars\n    return round(total, 4)  # END_OF_FULL_SCRIPT_MARKER_V3\n"}}]}}
EOF
cat << 'EOF' > "$P2_SESS/__advisor_check.jsonl"
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"write","arguments":{"path":"scripts/advisor_probe.py","content":"def verify_advisor_code(items):\n    # advisor verification helper script beyond length threshold\n    return [x for x in items if x is not None]\n"}}]}}
EOF

# 1) First scan: populates fileWatermarks + clusterIndex; skips __advisor_check.jsonl by default
python "$ROOT/scripts/omp-session-harvester.py" --scan --diff-global --no-local-config \
  --sessions-dir "$WIN_TMP/p2_sessions" --claude-projects-dir "" --history-db "" \
  --config "$WIN_TMP/p2-cfg.json" --ledger "$WIN_TMP/p2-ledger.json" --report "$WIN_TMP/p2-report.md" >/dev/null

LONG_HASH="$(python -c "
import json
d = json.load(open('$WIN_TMP/p2-ledger.json', encoding='utf-8'))
s = d['summary']
assert s['ompSessionsScouted'] == 1, s
assert s['ompAdvisorsSkipped'] == 1, s
assert len(d.get('fileWatermarks', {})) == 1, d.get('fileWatermarks')
ci = d.get('clusterIndex', {})
assert len(ci) == 1, ci
# Container-level junction/symlink at .omp/rules must be detected in global diff summary or deltas
assert d.get('globalDiffSummary', {}).get('containerLinksCount', 0) >= 1, d.get('globalDiffSummary')
print(next(iter(ci.keys())))
")"

# 2) Second scan (unchanged): must skip unchanged .jsonl while rehydrating identical counts & clusters
python "$ROOT/scripts/omp-session-harvester.py" --scan --diff-global --no-local-config \
  --sessions-dir "$WIN_TMP/p2_sessions" --claude-projects-dir "" --history-db "" \
  --config "$WIN_TMP/p2-cfg.json" --ledger "$WIN_TMP/p2-ledger.json" --report "$WIN_TMP/p2-report.md" >/dev/null
python -c "
import json
d = json.load(open('$WIN_TMP/p2-ledger.json', encoding='utf-8'))
s = d['summary']
assert s.get('skippedUnchanged', 0) >= 1, f'Expected skippedUnchanged >= 1, got {s}'
assert s['harvestedArtifactsCount'] == 1, f'Expected rehydrated count 1, got {s}'
assert s['uniqueCodeClusters'] == 1, f'Expected rehydrated uniqueCodeClusters 1, got {s}'
assert d['suites']['general_utilities']['harvestedCount'] == 1, d['suites']
"

# 3) --full-rescan forces re-parse (skippedUnchanged == 0)
python "$ROOT/scripts/omp-session-harvester.py" --scan --full-rescan --no-local-config \
  --sessions-dir "$WIN_TMP/p2_sessions" --claude-projects-dir "" --history-db "" \
  --config "$WIN_TMP/p2-cfg.json" --ledger "$WIN_TMP/p2-ledger.json" --report "$WIN_TMP/p2-report.md" >/dev/null
python -c "
import json
d = json.load(open('$WIN_TMP/p2-ledger.json', encoding='utf-8'))
assert d['summary'].get('skippedUnchanged', -1) == 0, d['summary']
"

# 4) --extract <hash> --out <dir> recovers complete original script beyond 200-char preview
EXTRACT_OUT="$TMP_DIR/extracted"
python "$ROOT/scripts/omp-session-harvester.py" --extract "$LONG_HASH" --out "$WIN_TMP/extracted" \
  --no-local-config --sessions-dir "$WIN_TMP/p2_sessions" --ledger "$WIN_TMP/p2-ledger.json" >/dev/null
grep -q "END_OF_FULL_SCRIPT_MARKER_V3" "$EXTRACT_OUT"/*.py

# 5) --include-advisors indexes __advisor*.jsonl separately
python "$ROOT/scripts/omp-session-harvester.py" --scan --include-advisors --full-rescan --no-local-config \
  --sessions-dir "$WIN_TMP/p2_sessions" --claude-projects-dir "" --history-db "" \
  --config "$WIN_TMP/p2-cfg.json" --ledger "$WIN_TMP/p2-ledger.json" --report "$WIN_TMP/p2-report.md" >/dev/null
python -c "
import json
d = json.load(open('$WIN_TMP/p2-ledger.json', encoding='utf-8'))
s = d['summary']
assert s['ompSessionsScouted'] == 1, s
assert s.get('ompAdvisorsIncluded', 0) == 1, s
assert s['harvestedArtifactsCount'] == 2, s
"

# 6) COMPLETED -> DRIFT_DETECTED when new unpromoted cluster appears
python -c "
import json
d = json.load(open('$WIN_TMP/p2-ledger.json', encoding='utf-8'))
d['status'] = 'COMPLETED'
d['promotedHashes'] = {h: {'suite': 'general_utilities', 'promotedAt': '2026-11-10T00:00:00Z'} for h in d['clusterIndex'].keys()}
json.dump(d, open('$WIN_TMP/p2-ledger.json', 'w', encoding='utf-8'), indent=2)
"
cat << 'EOF' > "$P2_SESS/s2.jsonl"
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"write","arguments":{"path":"scripts/new_drift.py","content":"import openpyxl\ndef drift_trigger_export(rows):\n    wb = openpyxl.Workbook()\n    ws = wb.active\n    ws.append(rows)\n    return wb\n"}}]}}
EOF
python "$ROOT/scripts/omp-session-harvester.py" --scan --no-local-config \
  --sessions-dir "$WIN_TMP/p2_sessions" --claude-projects-dir "" --history-db "" \
  --config "$WIN_TMP/p2-cfg.json" --ledger "$WIN_TMP/p2-ledger.json" --report "$WIN_TMP/p2-report.md" >/dev/null
python -c "
import json
d = json.load(open('$WIN_TMP/p2-ledger.json', encoding='utf-8'))
assert d['status'] == 'DRIFT_DETECTED', f'Expected DRIFT_DETECTED, got {d[\"status\"]}'
"
python "$ROOT/scripts/omp-session-harvester.py" --next --no-local-config --ledger "$WIN_TMP/p2-ledger.json" | grep -q "DRIFT_DETECTED"
# Phase 1 V4 TDD Assertions: Noise Filter, dev_ops_automation, Two-Phase Stage/Commit, Triage Dispositions & Stop Condition
echo "[*] Testing Phase 1 V4 noise filter, promotionQueue, --include-noise, --stage/--commit-stage & --triage..."
P4_SESS="$TMP_DIR/p4_sessions/ws"
P4_LEDGER="$TMP_DIR/p4-ledger.json"
P4_NOISE_LEDGER="$TMP_DIR/p4-noise-ledger.json"
P4_REPORT="$TMP_DIR/p4-report.md"
P4_CFG="$TMP_DIR/p4-cfg.json"
mkdir -p "$P4_SESS" "$TMP_DIR/p4_work"
cat << EOF > "$P4_CFG"
{
  "scanRoots": ["$WIN_TMP/p4_work"],
  "additionalWorkspaces": [],
  "excludeDirNames": [".git", "node_modules"],
  "tierCExcludeGlobs": []
}
EOF
cat << 'EOF' > "$P4_SESS/v4_mix.jsonl"
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"edit","arguments":{"path":"scripts/patch_target.py","newText":"def patched_helper_only_edit(items):\n    # edit hunk should be filtered from promotionQueue\n    return [x for x in items if x]\n"}}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"write","arguments":{"path":"tests/widget.test.ts","content":"import { expect, test } from 'bun:test';\ntest('widget renders cleanly', () => {\n  expect(1 + 1).toBe(2);\n});\n"}}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"write","arguments":{"path":"tmp/scratchpad/one_off_run.py","content":"def scratch_tmp_check():\n    # scratchpad temporary check script over length limit\n    return {'scratch': True, 'ok': 1}\n"}}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"eval","arguments":{"language":"py","code":"import unittest\nclass QuickTest(unittest.TestCase):\n    def test_one(self):\n        self.assertEqual(2, 1 + 1)\nunittest.main()\n"}}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"write","arguments":{"path":"scripts/svn_migrator.py","content":"import subprocess\ndef sync_svn_runtime_branch(repo_dir):\n    # real standalone dev_ops_automation utility script\n    return subprocess.check_output(['svn', 'status', repo_dir], text=True)\n"}}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"eval","arguments":{"language":"py","code":"import sqlite3\ndef inspect_db_schema_map(db_path):\n    conn = sqlite3.connect(db_path)\n    rows = conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()\n    conn.close()\n    return [r[0] for r in rows]\n"}}]}}
EOF

# 1) Default scan excludes ephemeral noise from promotionQueue while retaining clusterIndex
python "$ROOT/scripts/omp-session-harvester.py" --scan --diff-global --no-local-config \
  --sessions-dir "$WIN_TMP/p4_sessions" --claude-projects-dir "" --history-db "" \
  --config "$P4_CFG" --ledger "$P4_LEDGER" --report "$P4_REPORT" >/dev/null

read -r SVN_HASH DB_HASH <<EOF
$(python -c "
import json
d = json.load(open('$WIN_TMP/p4-ledger.json', encoding='utf-8'))
s = d['summary']
assert s.get('ephemeralNoiseArtifactsCount', 0) >= 4, f'Expected >=4 noise artifacts, got {s}'
assert len(d.get('clusterIndex', {})) == 6, f'clusterIndex must retain all 6 clusters for audit: {len(d.get(\"clusterIndex\", {}))}'
pq = d.get('promotionQueue', [])
targets = ' '.join(item.get('targetSample', '') for item in pq)
assert 'svn_migrator.py' in targets, f'Missing standalone svn_migrator.py in promotionQueue: {pq}'
assert 'eval_py_' in targets, f'Missing multi-line eval db utility in promotionQueue: {pq}'
for noise_tok in ('#edit', 'widget.test.ts', 'scratchpad', 'QuickTest'):
    assert noise_tok not in targets, f'Noise item leaked into default promotionQueue: {noise_tok} -> {pq}'
svn_h = next(i['hash'] for i in pq if 'svn_migrator.py' in i['targetSample'])
db_h = next(i['hash'] for i in pq if 'eval_py_' in i['targetSample'])
assert any(i.get('suite') == 'dev_ops_automation' for i in pq if i['hash'] == svn_h), pq
print(svn_h, db_h)
")
EOF

# 2) --include-noise restores noise entries into promotionQueue
python "$ROOT/scripts/omp-session-harvester.py" --scan --include-noise --full-rescan --no-local-config \
  --sessions-dir "$WIN_TMP/p4_sessions" --claude-projects-dir "" --history-db "" \
  --config "$P4_CFG" --ledger "$P4_NOISE_LEDGER" --report "$P4_REPORT" >/dev/null
python -c "
import json
d = json.load(open('$WIN_TMP/p4-noise-ledger.json', encoding='utf-8'))
pq = d.get('promotionQueue', [])
assert len(pq) == 6, f'Expected all 6 clusters with --include-noise, got {len(pq)}: {pq}'
assert any(i.get('isNoise') is True for i in pq), pq
"

# 3) --stage surfaces staged item in --next; --commit-stage records promotedHashes & advances loopMeta.round
python "$ROOT/scripts/omp-session-harvester.py" --stage "$SVN_HASH" --no-local-config --ledger "$P4_LEDGER" >/dev/null
python "$ROOT/scripts/omp-session-harvester.py" --next --no-local-config --ledger "$P4_LEDGER" | python -c "
import json, sys
nxt = json.load(sys.stdin)
staged = nxt.get('stagedBatch', [])
assert any(x.get('hash') == '$SVN_HASH' and x.get('state') == 'staged' for x in staged), nxt
"
python "$ROOT/scripts/omp-session-harvester.py" --commit-stage "$SVN_HASH" --suite dev_ops_automation \
  --target config/omp/agent/skills/dev-ops-automation --no-local-config --ledger "$P4_LEDGER" >/dev/null
python -c "
import json
d = json.load(open('$WIN_TMP/p4-ledger.json', encoding='utf-8'))
assert '$SVN_HASH' in d.get('promotedHashes', {}), d.get('promotedHashes')
assert d.get('loopMeta', {}).get('round', 0) >= 1, d.get('loopMeta')
"

# 4) --triage ignored_noise persists across repeated --scan --diff-global runs, then --next signals stop
python "$ROOT/scripts/omp-session-harvester.py" --triage "$DB_HASH" --disposition ignored_noise --no-local-config --ledger "$P4_LEDGER" >/dev/null
python "$ROOT/scripts/omp-session-harvester.py" --scan --diff-global --no-local-config \
  --sessions-dir "$WIN_TMP/p4_sessions" --claude-projects-dir "" --history-db "" \
  --config "$P4_CFG" --ledger "$P4_LEDGER" --report "$P4_REPORT" >/dev/null
python -c "
import json
d = json.load(open('$WIN_TMP/p4-ledger.json', encoding='utf-8'))
assert d.get('clusterDispositions', {}).get('$DB_HASH', {}).get('disposition') == 'ignored_noise', d.get('clusterDispositions')
assert not any(i.get('state') in ('pending', 'staged') for i in d.get('promotionQueue', [])), d.get('promotionQueue')
"
python "$ROOT/scripts/omp-session-harvester.py" --round-summary --no-local-config --ledger "$P4_LEDGER" | python -c "
import json, sys
rs = json.load(sys.stdin)
assert rs.get('stop') is True and rs.get('pendingCount') == 0, rs
"

echo "=== [TDD] Phase 2 V5: skills-optin in g_skills, override/archive filter, and workspace script extract ==="
P5_GLOBAL="$TMP_DIR/p5_global"
P5_PROJ="$TMP_DIR/p5_proj"
mkdir -p "$P5_GLOBAL/skills" "$P5_GLOBAL/skills-optin/shared-optin-tool" "$P5_GLOBAL/agents" "$P5_GLOBAL/commands" "$P5_GLOBAL/rules"
mkdir -p "$P5_PROJ/.claude/skills/shared-optin-tool" "$P5_PROJ/.claude/skills/override-custom-tool"
P5_CFG="$TMP_DIR/p5_harvest_config.json"
P5_LOCAL_CFG="$TMP_DIR/p5_harvest_local.json"
cat <<EOF > "$P5_CFG"
{
  "version": "2.0.0",
  "scanRoots": ["$P5_PROJ"],
  "excludeDirNames": ["node_modules", ".git"]
}
EOF
cat <<EOF > "$P5_LOCAL_CFG"
{
  "version": "2.0.0",
  "workspaceClassification": {
    "override": ["$P5_PROJ/.claude"]
  }
}
EOF

# 5a) By default, classified override dir and skills-optin match are suppressed from unpromotedDeltaDirs
python "$ROOT/scripts/omp-session-harvester.py" --scan --diff-global --no-local-config \
  --sessions-dir "$WIN_TMP/p4_sessions" --claude-projects-dir "" --history-db "" \
  --config "$P5_CFG" --ledger "$WIN_TMP/p5_ledger.json" --report "$WIN_TMP/p5_report.md" >/dev/null

python -c "
import json
d = json.load(open('$WIN_TMP/p5_ledger.json', encoding='utf-8'))
deltas = d.get('driftDetails', {}).get('unpromotedDeltaDirs', [])
assert not any('shared-optin-tool' in x for x in deltas), f'skills-optin leaked as missing: {deltas}'
"

echo "[v] PASS: test-omp-session-harvester.sh V2+V3+V4+V5 passed all assertions."
