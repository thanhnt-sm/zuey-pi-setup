---
name: omp-session-harvester
description: "Multi-source session & workspace harvester for OMP (.jsonl + history.db), Claude Code (.jsonl + history.jsonl), and project .omp/.claude/.agent diffing against global, driving incremental multi-session loops via --next and --extract."
---

# OMP Session & Workspace Harvester (Priority-100)

Standalone incremental harvester powered by `scripts/harvester_core.py` (with `scripts/harvest_cli.py`, repo wrapper `scripts/omp-session-harvester.py`, and native extension `/harvest-loop`). Tracks per-file `fileWatermarks` (`mtime_ns`, `size`, `sha256`, rehydrated `artifacts`), `promotedHashes`, `clusterIndex`, and auto-transitions `COMPLETED` -> `DRIFT_DETECTED`.

## Usage
```bash
# 1. Run incremental scan + global diff (defaults ledger/report to ~/.omp/agent/ outside repo)
python3 ~/.omp/agent/skills/omp-session-harvester/scripts/harvest_cli.py --scan --diff-global

# 2. Extract full original script from indexed session transcript by cluster hash
python3 ~/.omp/agent/skills/omp-session-harvester/scripts/harvest_cli.py --extract <hash> --out ./extracted_clusters

# 3. Force full re-parse or include __advisor*.jsonl transcripts separately
python3 ~/.omp/agent/skills/omp-session-harvester/scripts/harvest_cli.py --scan --full-rescan --include-advisors

# 4. Check next incomplete unit or drift item in multi-session loop
python3 ~/.omp/agent/skills/omp-session-harvester/scripts/harvest_cli.py --next
python3 ~/.omp/agent/skills/omp-session-harvester/scripts/harvest_cli.py --verify-ledger
```

## Multi-Session Continuity Loop Protocol
1. Run `/harvest-loop status` (or `harvest_cli.py --next`) to resume from `loop-checkpoint.json` / ledger.
2. When `DRIFT_DETECTED` or a suite appears, use `--extract <hash>` (`omp_extract_cluster`) to materialize full utilities, promote into `skills/<suite>/`, and record in `promotedHashes`.
3. Re-run `--scan --diff-global` and `--verify-ledger` before committing and starting the next round.
