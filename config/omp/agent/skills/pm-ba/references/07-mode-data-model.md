# Mode: Data Model / ERD

## 1. Trigger

Activated when:
- CLI flag `--data-model` is provided
- Natural language patterns detected: "data model", "ERD", "sơ đồ DB", "thiết kế database", "entity relationship", "mô hình dữ liệu"

## 2. Required Context

| Context | Source | Prompt if Missing |
|---------|--------|-------------------|
| URD content | `docs/pm-ba-document-status.md` → `urd_analysis_path` | "Chạy --urd trước để extract entities, hoặc cung cấp path URD:" |
| BRD content | `docs/pm-ba-document-status.md` → `brd_analysis_path` | Warn: "BRD chưa phân tích — data model sẽ thiếu business rules. Tiếp tục?" |
| Existing DB schema | Ask: "Có file schema DB hiện tại không? (SQL dump, ERD cũ)" | Optional — skip if greenfield |

## 3. Workflow Steps

### Step a — Load Context

1. Read `docs/pm-ba-document-status.md` to find:
   - URD analysis report path (for entity extraction)
   - BRD analysis report path (for business rules on entities)
   - Data touch points section in URD report
2. Load the Data Touch Points list from URD analysis report (entities already identified)
3. If not available: read URD/BRD source files directly

### Step b — Entity & Attribute Extraction

Invoke `/ck:ask` with:

```
Từ URD/BRD content sau, thiết kế data model:

[URD_AND_BRD_CONTENT]

Thực hiện đầy đủ các bước:

BƯỚC 1 — ENTITY LIST (Noun Extraction):
- Identify tất cả các "nouns" quan trọng trong URD (objects, documents, records)
- Loại bỏ nouns không phải entities (UI labels, report headers, etc.)
- Ghi entity name (VN + EN code) + mô tả nghiệp vụ ngắn
- Phân loại: Core Entity / Reference/Lookup / Junction/Bridge / Audit

BƯỚC 2 — ATTRIBUTES PER ENTITY:
Cho mỗi entity, list tất cả attributes được mention hoặc implied:
- Attribute name (VN + EN code)
- Data type (VARCHAR/INT/DECIMAL/DATE/DATETIME/BOOLEAN/ENUM/TEXT/UUID)
- Required (Y/N)
- Constraints (UNIQUE, NOT NULL, CHECK constraint)
- Default value (nếu có)
- Business examples (sample values)
- Source (section URD/BRD nơi attribute được mention)

BƯỚC 3 — RELATIONSHIPS:
Identify relationships giữa các entities:
- Entity A -- [relationship verb] --> Entity B
- Cardinality: ONE-TO-ONE | ONE-TO-MANY | MANY-TO-MANY
- Foreign Key direction
- Is relationship mandatory (must exist) or optional?
- Business rule của relationship (ví dụ: "Hợp đồng chỉ thuộc 1 KH")

BƯỚC 4 — CANDIDATE KEYS:
- Primary Key cho mỗi entity (surrogate UUID hoặc natural key)
- Foreign Keys với referenced table
- Candidate Unique Keys (business identifier, nếu khác PK)
- Composite Keys (nếu junction table)

BƯỚC 5 — UNDEFINED/AMBIGUOUS:
- Entities được mention nhưng không có attributes rõ ràng
- Relationships không rõ cardinality
- Attributes không rõ data type hoặc constraint
→ Mỗi item thành Open Issue → Q-XXX
```

### Step c — Render ERD

Invoke `/ck:mermaidjs-v11` with:

```
Vẽ Entity Relationship Diagram (Mermaid v11 erDiagram) từ data model sau:

[ENTITY AND RELATIONSHIP LIST FROM STEP b]

Yêu cầu Mermaid v11 erDiagram:
- Tất cả entities với key attributes (PK, FK, important fields)
- Relationships với labels và cardinality notation:
  ||--|| (one-to-one)
  ||--o{ (one-to-many optional)
  ||--|{ (one-to-many required)
  }o--o{ (many-to-many)
- Relationship label phải là verb phrase (VN hoặc EN)
- Nhóm entities liên quan lại gần nhau
- Nếu > 15 entities: vẽ 2 diagram (core domain + peripheral)

Syntax mẫu:
erDiagram
  HOP_DONG {
    uuid id PK
    string soHopDong UK
    date ngayKy
    uuid khachHangId FK
    decimal soTienVay
    string trangThai
  }
  KHACH_HANG {
    uuid id PK
    string cmnd UK
    string hoTen
  }
  KHACH_HANG ||--o{ HOP_DONG : "ký kết"
```

### Step d — Flag Open Issues

For each undefined/ambiguous item from Step b Bước 5:
- Add to `plans/reports/pm-ba-clarification-register.md` via `10-mode-clarification.md`
- Category: "Data"
- Priority: P1 if blocking relationship definition; P2 otherwise

### Step e — Cross-Reference with API Contract

If `docs/ba-api-contract.md` exists:
1. Identify which entities are exposed via APIs
2. Check for: entity fields in API responses not in data model → add to data model
3. Check for: API request fields not mapped to any entity attribute → flag as Q-XXX

### Step f — Save Data Model

Save to `docs/ba-data-model.md`:

```markdown
# Data Model — {Module/Project}
**Date:** YYYY-MM-DD | **Version:** v1.0

## Entity Relationship Diagram
{Mermaid erDiagram from Step c}

## Entity Definitions

### [ENTITY_NAME] (EN code)
**Mô tả:** [Vietnamese business description]
**Loại:** Core Entity / Reference / Junction / Audit

| Attribute | Type | Required | Constraints | Business Rule | Notes |
|-----------|------|----------|-------------|---------------|-------|
| id | UUID | Yes | PK | | |
| ... | | | | | |

*(Repeat for each entity)*

## Relationship Summary
| Entity A | Relationship | Entity B | Cardinality | Business Rule |
|----------|-------------|----------|-------------|---------------|

## Data Model Open Issues
| Issue # | Entity | Field/Relationship | Question | Impact | Status |
|---------|--------|-------------------|---------|--------|--------|
| DM-001 | | | | | Open |

## Business Rules (Data Level)
- BR-XXX: [Rule description]

## Traceability
- Entities sourced from: US-XXX, FR-XXX list
```

## 4. Open Issues Protocol

Maintain a dedicated "## Data Model Open Issues" section in `docs/ba-data-model.md`.

Each issue entry:
| Field | Description |
|-------|-------------|
| Issue # | DM-001 format |
| Entity | Which entity is affected |
| Field/Relationship | Specific attribute or relationship |
| Question | The open question (VN) |
| Impact | If unresolved: what breaks |
| Status | Open / Awaiting / Resolved |

On resolution (via `--clarify Q-XXX [answer]`):
- Update the data model with the resolved definition
- Mark DM-XXX as Resolved
- Re-render ERD if relationship/entity changed

## 5. Outputs

| Artifact | Location | Description |
|----------|----------|-------------|
| Data Model doc | `docs/ba-data-model.md` | ERD + entity definitions + open issues |
| ERD diagram | Embedded in doc | Mermaid erDiagram |
| Clarification items | `plans/reports/pm-ba-clarification-register.md` | Q-XXX for data ambiguities |

## 6. Deliverables Checklist

- [ ] All entities identified (Core + Reference + Junction)
- [ ] Attributes defined for each entity (type, required, constraints)
- [ ] Relationships mapped (all cardinalities defined)
- [ ] Primary keys and foreign keys identified
- [ ] ERD rendered as Mermaid v11 erDiagram
- [ ] Undefined entities/attributes flagged as DM-XXX open issues
- [ ] Open issues added to clarification register
- [ ] Cross-referenced with API contract (if available)
- [ ] `docs/ba-data-model.md` saved
- [ ] Entities linked to US-XXX/FR-XXX in traceability matrix
