# Mode 52 — `--kpi-decompose`

> Decompose parent task → ≤ 1mds subtasks with P-level + AC coverage + dependency graph (Phase 08 v1.5).
> Strategy detail: `kpi-decompose-strategies.md`. Heuristic NER backend (decision 8.1).
> Subtask ID convention: `T-PARENT-S01`, `T-PARENT-S02` (decision 8.2).
> No cache — always regenerate (decision 8.3).

---

## 1. Trigger

**Flag:** `--kpi-decompose <task-id-or-path> [--strategy crud|layer|verb|hybrid] [--target-mds N] [--confirm <file>]`

**VN triggers:** "tách task", "decompose task lớn", "chia nhỏ task", "task quá to"
**EN triggers:** "decompose task", "split large task", "break down task"

---

## 2. Required Slots

| Slot | Description |
|------|-------------|
| `parent_task` | Task ID (from master-task-list) OR path to URD/Story file |
| `strategy` | Auto-detect (default) OR explicit |
| `target_mds` | Sub-task ceiling, default 1.0 |

---

## 3. Workflow Steps

### 3a. Load Standards
Per loader. Read parent_task source (URD/Story/master-task-list entry).

### 3b. Parse Source
Extract:
- Description text
- Acceptance Criteria (AC) list
- Existing P-level + TP + mds (if pre-classified)
- Entities + layers + verbs (via heuristic NER per `kpi-decompose-strategies.md §6`)

### 3c. Select Strategy
Auto-detect via `kpi-decompose-strategies.md §5` OR honor `--strategy` arg.

### 3d. Generate Candidate Subtasks
Per selected strategy axis. Default IDs: `T-{PARENT_ID}-S01`, `T-{PARENT_ID}-S02`, ...

For each subtask: estimate P-level + TP + mds heuristically.

### 3e. Size Check (Recursive)
For each subtask:
- If `mds > target_mds × 1.5` → recursive decompose (cap depth = 2)
- If `mds < target_mds × 0.3` → flag for merge consideration

Cap total subtask count at 15 (anti-over-decomp).

### 3f. Dependency Inference
Heuristic:
- API before UI consumer
- Validate before Transform before Notify (verb axis)
- Create before Update before Delete (CRUD axis)
- Build mermaid graph; detect cycles → block

### 3g. AC Coverage Check
Union(subtask ACs) must cover parent ACs.
- Missing AC → flag in proposal `coverage_gap[]`
- Extra AC in subtasks → warn ("scope creep")

### 3h. Team Composition Recommendation
Based on subtask P-levels:
- List required levels (e.g., "2× Junior02 + 1× Senior01")
- Sanity check against `team_roster`

### 3i. Write Proposal File
`plans/reports/kpi-decompose-{date}-{parent_id}-{slug}.md` per `templates/kpi-decompose-proposal-template.md`.

### 3j. Exit
Print: `Edit proposal + run --kpi-decompose --confirm <file>` to lock + append to master-task-list.

### --confirm Subflow
1. Read confirmed proposal
2. Validate (no `[?]`, valid P-levels, no cycles)
3. Append subtasks to `docs/pm-ba-master-task-list.md`
4. Remove parent from active backlog (or mark as `decomposed_into: [...]`)
5. Update proposal status to `confirmed`

---

## 4. Outputs

| File | Purpose |
|------|---------|
| `plans/reports/kpi-decompose-{date}-{parent}-{slug}.md` | Proposal file with subtask register + mermaid graph + coverage check |
| `docs/pm-ba-master-task-list.md` | Appended subtasks (after --confirm) |

---

## 5. Anti-Pattern Guards

| Guard | Condition | Action |
|-------|-----------|--------|
| Over-decomp | > 15 subtasks | Block; suggest consolidate |
| Under-decomp | Parent > 5mds AND < 3 subtasks | Warn; suggest deeper |
| Circular dep | Cycle in dependency graph | Block; show cycle path |
| AC coverage gap | Parent AC missing in subtask union | Block; list missing ACs |
| Recursive depth > 2 | Subtask of subtask of subtask | Block; consider parent re-scope |
| Heuristic confidence < 60% | Entity/layer/verb counts ambiguous | Warn; suggest manual strategy |

---

## 6. End-of-Mode Hooks
- `/ck:journal`: NO (intermediate); YES on --confirm
- Suggest next: `--kpi-assign` to auto-assign decomposed subtasks
