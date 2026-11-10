# Mode: --data-migration — Data Migration Planning

## Purpose

Produce a structured data migration plan from user-provided source/target documentation: entity scope, field mapping, validation rules, cutover checklist, rollback criteria, and run schedule. Traces migration impact back to functional requirements.

## Trigger Phrases

- Flag: `--data-migration`
- VN: "kế hoạch migrate dữ liệu", "chuyển đổi dữ liệu", "migration plan", "mapping dữ liệu"
- EN: "data migration plan", "field mapping", "cutover plan", "data transfer plan"

---

## 1. Required Input

User must provide (as attached documents or pasted text):
- Source system description: entity/table list, field names, data types, sample records
- Target schema: tables, columns, constraints, relationships
- Cutover date and maintenance window

If documents not provided, call `AskUserQuestion`:
```
Để lập kế hoạch data migration, cần:
1. Mô tả hệ thống nguồn (source): danh sách bảng/entity, field, kiểu dữ liệu?
2. Schema hệ thống đích (target): cấu trúc bảng mới?
3. Ngày cutover dự kiến và maintenance window (giờ)?
4. Có dữ liệu lịch sử cần migrate không (bao nhiêu năm/bản ghi)?
```

---

## 2. Workflow Steps

### Step 2a — Read State
Read `docs/pm-ba-document-status.md` → identify approved data model docs and FR list.
Read `docs/pm-traceability-matrix.md` → pull FR items to later map migration impact.

### Step 2b — Extract Raw Entities
Save raw extract before synthesis:
`plans/reports/pm-{date}-migration-raw-extract.md`
- List all source entities/tables from user-provided docs
- List all target entities/tables
- Note any structural differences observed at a glance

### Step 2c — Scope Analysis via /ck:sequential-thinking
Invoke `/ck:sequential-thinking` with source + target entity lists:
```
Phân tích phạm vi migration:
1. Entities/tables SẼ migrate: lý do, priority
2. Entities/tables KHÔNG migrate: lý do (deprecated, out of scope, recreated fresh)
3. Entities cần transform (không thể map 1-1): mô tả transformation cần thiết
4. Estimated record volume per entity (từ user docs hoặc ước tính)
```

### Step 2d — Field Mapping via /ck:sequential-thinking
Invoke `/ck:sequential-thinking` for each in-scope entity:
```
Tạo field mapping table cho entity [ENTITY_NAME]:
| Source Field | Source Type | Target Field | Target Type | Transform Rule | Nullable? | Notes |
Đánh dấu: DIRECT (map thẳng) | TRANSFORM (cần xử lý) | DERIVED (tính từ nhiều field) | DROPPED (không migrate)
```

### Step 2e — Validation Rules via /ck:ask
Invoke `/ck:ask` with field mapping output:
```
Từ field mapping đã tạo, xác định data validation rules:
1. Type checks: kiểu dữ liệu source phải convert đúng sang target type
2. Null constraints: field nào NOT NULL ở target nhưng có thể null ở source?
3. Referential integrity: foreign key nào cần migrate theo thứ tự cụ thể?
4. Business rules: giá trị nào không hợp lệ theo nghiệp vụ (e.g. số âm, ngày tương lai)?
5. Duplicate detection: tiêu chí phát hiện record trùng lặp
6. Data quality issues: liệt kê vấn đề chất lượng dữ liệu phát hiện được

Format: bảng với cột Rule-ID | Type | Field | Condition | Action-on-fail
```

### Step 2f — Cutover Plan via /ck:ask
Invoke `/ck:ask` for cutover sequence:
```
Tạo cutover checklist cho migration [DATE] window [WINDOW]:

PRE-CUTOVER (trước khi bắt đầu):
- Freeze source system (ai thực hiện, khi nào)
- Final backup (loại backup, verification step)
- Notify stakeholders
- Verify target environment ready

DURING CUTOVER (trong khi chạy migration):
- Migration run sequence (entity order theo referential integrity)
- Validation checkpoints (chạy validation rules sau mỗi batch)
- Progress monitoring (cách theo dõi tiến độ)
- Decision point: khi nào roll back (time limit, error threshold)

POST-CUTOVER (sau khi hoàn thành):
- Data reconciliation (record count, checksum)
- Smoke test key business flows
- Unfreeze / switch traffic
- Monitor for X hours

Format: numbered steps với owner và estimated duration
```

### Step 2g — Rollback Plan
Define in artifact:
- Rollback trigger conditions (error rate > X%, time exceeded, data integrity failure)
- Rollback steps (restore backup, switch connection strings, notify stakeholders)
- Maximum rollback decision window (e.g. T+2h after cutover start)

### Step 2h — Migration Schedule
Produce run schedule:
- Dry run date (recommended: T-7 days)
- Dress rehearsal date (T-3 days)
- Production cutover date + window
- Post-migration monitoring period

### Step 2i — FR Traceability
For each in-scope entity, note which FR items it supports:
Update `docs/pm-traceability-matrix.md` — add "Migration Scope" column if not present.
Note: which FR depends on migrated data being available at go-live.

### Step 2j — Save Artifact
Create `plans/reports/pm-{date}-data-migration-plan.md` using `templates/tpl-data-migration.md`.

### Step 2k — Update State File
Update `docs/pm-ba-document-status.md`:
```
Last Mode Run: data-migration
Last Run Date: [TODAY]
Migration Plan: plans/reports/pm-{date}-data-migration-plan.md | Draft
Data quality issues found: [COUNT] — see migration plan Section 5
```

---

## 3. Output Artifacts

| File | Description |
|------|-------------|
| `plans/reports/pm-{date}-migration-raw-extract.md` | Raw entity/field extract from source docs |
| `plans/reports/pm-{date}-data-migration-plan.md` | Full migration plan (all sections) |
| `docs/pm-traceability-matrix.md` | Migration Scope column updated |

Template: `templates/tpl-data-migration.md`

---

## 4. Stakeholder

dev team (implementation), QA (validation rules), PM (schedule and rollback decisions)

## 5. Sub-Skills

| Skill | When |
|-------|------|
| `/ck:sequential-thinking` | Step 2c: scope analysis; Step 2d: field mapping per entity |
| `/ck:ask` | Step 2e: validation rules; Step 2f: cutover checklist |
| `/ck:mermaidjs-v11` | Optional: cutover flow diagram (sequenceDiagram showing pre/during/post phases) |

## 6. State Update

```
Last Mode Run: data-migration
Migration Plan: plans/reports/pm-{date}-data-migration-plan.md
FR traceability: migration scope column updated in pm-traceability-matrix.md
```

## 7. End-of-Mode Hook

Journal: NO
