# Mode: --process-map — AS-IS/TO-BE Process Modeling

## 1. Trigger

- Flag: `--process-map`
- Natural language: "vẽ process", "quy trình hiện tại", "AS-IS TO-BE", "mô hình hóa quy trình", "process flow", "luồng nghiệp vụ", "cải tiến quy trình"

---

## 2. Required Input

| Source | Description | Example |
|--------|-------------|---------|
| File path OR inline text | Process description (BRD section, meeting notes) | `plans/raw/process-description.md` |
| `process_name` | Name of the business process | "Quy trình phê duyệt khoản vay" |
| `scope` (optional) | Actors/systems in scope | "CBTD, KSTD, CBS — loại trừ Core Banking API" |
| `goal` | AS-IS only, or AS-IS + TO-BE | "Both" |

If no input, call `AskUserQuestion`:
```
1. Mô tả quy trình (file path hoặc paste)?
2. Tên quy trình?
3. Phạm vi actors/systems? Ngoài phạm vi?
4. Chỉ cần AS-IS hay cả AS-IS + TO-BE?
```

---

## 3. Workflow Steps

### Step 3a — Ingest
- Read provided file or parse inline text
- Read `docs/pm-ba-document-status.md` → project phase, stakeholder context
- If BRD referenced in state file: read relevant sections for process context
- Extract: actors (who), steps (what), systems (which), triggers (when), outputs (what)

### Step 3b — Build AS-IS via /ck:sequential-thinking
```
Process description: [CONTENT] | Name: [NAME] | Scope: [SCOPE]

Bước 1 — Actors & Roles: initiator / approver / executor / system
Bước 2 — Steps (tuần tự): actor + action + output; flag decision gateways & parallel steps
Bước 3 — Pain Points:
  Bước nào thủ công thừa? Bottleneck? Duplicate effort?
  Thiếu audit trail? Risk cao (manual error, data loss)?
Bước 4 — Metrics (nếu có): avg time/step, error rate, handoff count

Output: VN, structured list sẵn sàng cho Mermaid
```

### Step 3c — Design TO-BE via /ck:brainstorm
```
AS-IS pain points: [PAIN_POINTS]

Brainstorm:
1. Automation opportunities (full/semi-auto)
2. Eliminated/merged steps
3. Reordering to reduce bottleneck
4. New controls (validation, notification, audit trail)
5. System integrations to reduce manual handoff

Output: VN, options với pros/cons ngắn
```

### Step 3d — Gap Analysis via /ck:sequential-thinking
```
AS-IS steps: [LIST] | TO-BE improvements: [SELECTED]

Bước 1 — Delta: AS-IS step → TO-BE equivalent (or "Eliminated")
Bước 2 — Effort: Low (config) / Medium (dev) / High (new integration)
Bước 3 — Dependencies: implement order
Bước 4 — FR traceability: TO-BE step → FR-XXX (flag gaps needing CR/new FR)

Output: VN, gap table: AS-IS | TO-BE | Delta | Effort | FR-Ref
```

### Step 3e — Generate Mermaid Diagrams via /ck:mermaidjs-v11
Two diagrams:
- **AS-IS**: `flowchart LR` (≤ 3 actors) or `sequenceDiagram` (> 3 actors); annotate pain points
- **TO-BE**: same syntax; comment eliminated steps; style automated steps distinctly

Rules: use `flowchart` not `graph` (deprecated v11); decision nodes = `{question}`; swimlanes = `subgraph ActorName`.

### Step 3f — Produce Process Map Document
Create `plans/reports/pm-{date}-process-map-{slug}.md` using `templates/tpl-process-map.md`.

Include: process name + scope, AS-IS narrative + diagram, pain points table, TO-BE narrative + diagram, gap analysis table, FR gaps flagged for CR, implementation roadmap ordered by effort + dependency.

### Step 3g — Update State File
```
Last Mode Run: process-map | Last Run Date: [TODAY]
Process Map: plans/reports/pm-{date}-process-map-{slug}.md | [PROCESS_NAME] | Draft
FR Gaps: [N] items — recommend --cr or FR update
```

---

## 4. Outputs

| File | Description |
|------|-------------|
| `plans/reports/pm-{date}-process-map-{slug}.md` | Full process map: AS-IS, TO-BE, gap analysis |
| Mermaid diagrams (embedded) | AS-IS + TO-BE flowcharts |

---

## 5. Sub-Skills

| Sub-Skill | When |
|-----------|------|
| `/ck:sequential-thinking` | Step 3b — AS-IS decomposition; Step 3d — gap analysis |
| `/ck:brainstorm` | Step 3c — TO-BE improvement options |
| `/ck:mermaidjs-v11` | Step 3e — BPMN-style Mermaid diagrams |

---

## 6. State Update

Written at Step 3g. Includes process map path and FR gap count.

## 7. End-of-Mode Hook

Journal: **No.** Process mapping is analytical, not a project milestone event.
