# Mode: --backlog — Backlog Grooming

## 1. Trigger

- Flag: `--backlog`
- Natural language: "backlog grooming", "ưu tiên backlog", "sắp xếp backlog", "estimate user story", "MoSCoW prioritization"

---

## 2. Required Input

| Source | Description | Example |
|--------|-------------|---------|
| File path OR inline text | Backlog items list | `plans/raw/backlog-draft.md` or pasted list |
| `sprint_number` (optional) | Target sprint for readiness check | "Sprint 4" |
| `capacity` (optional) | Team SP capacity per sprint | "40 SP" |

If no input, call `AskUserQuestion`:
```
1. File backlog hoặc danh sách user stories?
2. Sprint target (nếu có)?
3. Capacity team (story points/sprint)?
```

---

## 3. Workflow Steps

### Step 3a — Ingest
- Read provided file or parse inline items
- Read `docs/pm-ba-document-status.md` → active sprint, project phase
- Read `docs/pm-traceability-matrix.md` → existing US IDs (avoid duplicates)

### Step 3b — MoSCoW Prioritization via /ck:ask
```
Backlog items: [ITEM_LIST]

Phân loại MoSCoW:
M — Must Have: thiếu thì go-live không được
S — Should Have: quan trọng, có workaround tạm
C — Could Have: nice-to-have
W — Won't Have (this sprint): defer

Tiêu chí: business value, regulatory requirement, dependency, complexity vs capacity.
Output: VN, table với MoSCoW column + rationale ngắn
```

### Step 3c — Story Point Estimation via /ck:sequential-thinking
```
Must + Should items: [MOSCOW_OUTPUT]

Fibonacci scale: 1, 2, 3, 5, 8, 13, 21 (>13 → phải split)
Baseline: 1 item trung bình = 5 SP

Bước 1 — Relative sizing vs baseline
Bước 2 — SP assignment: 1-2 (CRUD đơn), 3-5 (moderate), 8 (phức tạp), 13 (split candidate)
Bước 3 — Dependency ordering: [US-ID] → [US-ID] (lý do)
Bước 4 — Sprint readiness per item:
  ✓ AC defined? | ✓ Dependencies clear? | ✓ No blocker? | ✓ SP ≤ 8? → Ready/Not Ready

Output: VN, table đầy đủ 4 cột readiness
```

### Step 3d — Produce Backlog Register
Create `plans/reports/pm-{date}-backlog-register.md` using `templates/tpl-backlog-register.md`.

Include: MoSCoW per item, SP estimate, dependency chain, sprint readiness, recommended sprint assignment, items flagged for splitting (SP ≥ 13).

### Step 3e — Update Traceability Matrix
`docs/pm-traceability-matrix.md`: add/update MoSCoW and SP columns per US.

### Step 3f — Update State File
```
Last Mode Run: backlog | Last Run Date: [TODAY]
Backlog Register: plans/reports/pm-{date}-backlog-register.md
Must: [N] | Should: [N] | Could: [N] | Won't: [N]
Sprint Ready: [N] | Not Ready: [N]
Next Action: --sprint to commit sprint backlog
```

---

## 4. Sprint Readiness Criteria

Item is sprint-ready only when ALL pass:
- AC count ≥ 1, unambiguous
- Dependencies: none, or blocking US already Done
- No active P1 blocker
- SP ≤ 8 (≥ 13 → must split first)
- No pending scope clarification

---

## 5. Outputs

| File | Description |
|------|-------------|
| `plans/reports/pm-{date}-backlog-register.md` | Prioritized backlog (MoSCoW, SP, readiness) |
| `docs/pm-traceability-matrix.md` | Updated priority + SP columns |

---

## 6. Sub-Skills

| Sub-Skill | When |
|-----------|------|
| `/ck:ask` | Step 3b — MoSCoW prioritization |
| `/ck:sequential-thinking` | Step 3c — SP estimation + dependency ordering |

---

## 7. State Update

Written at Step 3f to `docs/pm-ba-document-status.md`. Includes counts and register path.

## 8. End-of-Mode Hook

Journal: **No.** Backlog grooming is iterative, not a milestone event.
