---
name: omp-session-harvester
description: "Multi-source session & workspace harvester for OMP (.jsonl + history.db), Claude Code (.jsonl + history.jsonl), and project .omp/.claude/.agent diffing against global, driving multi-session consolidation loops via --next."
---

# OMP Session & Workspace Harvester (Priority-100)

Standalone harvester powered by `scripts/harvester_core.py` (with `scripts/harvest_cli.py` and repo wrapper `scripts/omp-session-harvester.py`). Scans OMP session transcripts (`~/.omp/agent/sessions/**/*.jsonl`), Claude transcripts (`~/.claude/projects/**/*.jsonl`), `history.db`, and local workspaces configured via `config/harvest-workspaces.json` + `~/.omp/harvest-workspaces.local.json`.

## Usage
```bash
# 1. Run standalone from anywhere (defaults ledger/report to ~/.omp/agent/ outside repo)
python3 ~/.omp/agent/skills/omp-session-harvester/scripts/harvest_cli.py --scan --diff-global

# 2. Check next incomplete consolidation unit in multi-session loop
python3 ~/.omp/agent/skills/omp-session-harvester/scripts/harvest_cli.py --next

# 3. Verify ledger target paths exist on disk
python3 ~/.omp/agent/skills/omp-session-harvester/scripts/harvest_cli.py --verify-ledger

# 4. Run isolated fixture scan ignoring ~/.omp/harvest-workspaces.local.json
python3 scripts/omp-session-harvester.py --scan --no-local-config --config tests/cfg.json
```

## Multi-Session Continuity Loop Protocol
1. Run `--next` to identify the next incomplete suite or gap in the active consolidation ledger (`plans/omp-consolidation-ledger.json` inside repo, or `~/.omp/agent/omp-consolidation-ledger.json` standalone).
2. Implement/upgrade the target skill under `~/.omp/agent/skills/<suite>/` and verify its unit tests exit `0`.
3. Re-run `--scan --diff-global` and `--verify-ledger` before committing and starting the next loop iteration.
