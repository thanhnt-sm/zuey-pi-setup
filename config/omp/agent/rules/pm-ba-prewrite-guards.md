# PM/BA Pre-Write Protection Guards (Opt-In)

Applies **only** inside active PM/BA analysis workspaces containing `docs/.pm-ba/io-mapping.json` or `docs/pm-ba-kpi-state-*.md` (zero interference in unrelated repositories).

## 1. IO-Mapping Lock Protection
- Before overwriting any file registered in `docs/.pm-ba/io-mapping.json`, run:
  ```bash
  node ~/.omp/agent/skills/pm-ba/scripts/io-mapping-validator.cjs --root . --check
  ```
- Locked human-edited deliverables (`LOCKED` / `.docs_human/`) MUST NOT be overwritten directly; route updates through `pm-ba --accept` / `handler-unlock.cjs`.

## 2. KPI State Fence & `body_hash` Integrity
- KPI state files (`docs/pm-ba-kpi-state-*.md`) wrap protected Task Register & Weekly Snapshots tables inside `<!-- KPI-PROTECTED-START -->` ... `<!-- KPI-PROTECTED-END -->`.
- Validate integrity before and after edits using:
  ```bash
  python3 ~/.omp/agent/skills/pm-ba/scripts/kpi-state-integrity.py --verify --file <state-md>
  ```
- Mutations to protected KPI bodies must update `body_hash` atomically via `kpi-atomic-write.py` rather than raw text rewrites.
