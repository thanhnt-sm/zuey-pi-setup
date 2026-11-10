# Mode: URD Analysis

## 1. Trigger

Activated when:
- CLI flag `--urd <path>` is provided
- Natural language patterns detected: "phân tích URD", "URD đã có", "đọc URD", "user requirement", "yêu cầu người dùng"

## 2. Required Slots

| Slot | Description | Prompt if Missing |
|------|-------------|-------------------|
| `urd_path` | Path to URD file or folder | "Vui lòng cung cấp đường dẫn đến file URD (hoặc thư mục chứa URDs):" |
| `project_slug` | Short project identifier | Infer from filename or ask |

## 3. Folder Scan (when folder path provided)

If `urd_path` is a directory:

1. List all files in the folder (`.docx`, `.pdf`, `.md`, `.xlsx`)
2. Classify each file by detecting keywords in filename/content:
   - **Screen URD** — keywords: "màn hình", "screen", "UI", "giao diện" → route to `04-mode-screen-spec.md`
   - **Report URD** — keywords: "báo cáo", "report", "biểu mẫu in" → route to `06-mode-report-spec.md`
   - **Template URD** — keywords: "biên bản", "template", "form", "mẫu" → route to `05-mode-template-spec.md`
   - **Process Flow URD** — keywords: "quy trình", "tác nghiệp", "sơ đồ", ".vsdx", "visio", "bpmn", "luồng xử lý" OR file contains `%% No connections found` / `Auto-generated from Visio` → **process in Step h** (below)
   - **General URD** — all others → process in this mode (Steps a–g)

3. Report classification to user before proceeding:
   ```
   Tìm thấy {N} file URD:
   - Screen URD (sẽ xử lý bằng --screen): {list}
   - Report URD (sẽ xử lý bằng --report): {list}
   - Template URD (sẽ xử lý bằng --template): {list}
   - Process Flow URD (sẽ xử lý tại Step h): {list}
   - General URD (xử lý trong mode này): {list}
   
   Tiếp tục xử lý General URD + Process Flow URD và tự động route các loại khác không?
   ```

## 4. Workflow Steps

### Step a — Ingest URD (Chunk-Aware)

URDs can be 500KB+ (large Word/PDF files). Follow chunk-aware ingestion:

1. Use `mcp__markitdown__convert_to_markdown(uri)` to convert to markdown first
2. If document > 50 pages / 3000 lines: split into logical chunks by section headings
3. Process each chunk independently with `/ck:sequential-thinking`
4. Merge results at end

Save raw extract to:
```
plans/reports/raw-extract-{YYYYMMDD}-urd-{slug}.md
```

### Step b — Identify Personas/Actors

Before extracting User Stories, first identify all personas from the document:

Invoke `/ck:ask` with:
```
Từ URD sau, identify tất cả personas/actors (người dùng của hệ thống):

[URD_CONTENT]

Cho mỗi persona, ghi:
- Tên role (VN)
- Mô tả ngắn (vai trò trong nghiệp vụ)
- Mục tiêu chính khi dùng hệ thống
- Permissions/quyền hạn (nếu mention)
- Màn hình / chức năng sẽ dùng (nếu mention)

Format: bảng Persona | Mô Tả | Mục Tiêu | Màn Hình Chính
```

### Step c — Sequential Thinking: User Stories & ACs

Invoke `/ck:sequential-thinking` with the following prompt:

```
Từ URD sau, thực hiện phân tích theo từng bước:

[URD_CONTENT]

BƯỚC 1 — USER STORIES:
Tạo danh sách User Stories theo từng persona đã identify.
- Format ID: US-XXX (US-001, US-002, ...)
- Format story: "As a [role], I want [action], so that [benefit]"
- Mỗi US ghi: ID | Actor | Story | Priority (P1/P2/P3) | Module | FR-XXX liên quan (nếu BRD đã phân tích)

BƯỚC 2 — ACCEPTANCE CRITERIA:
Với mỗi User Story, viết Acceptance Criteria theo Given-When-Then.
- Format ID: AC-XXX (AC-001, AC-002, ...)
- Mỗi US cần ít nhất 2 AC: happy path + 1 negative/edge case
- Mỗi AC ghi: AC-ID | US-ID | Given | When | Then | Type (Positive/Negative/Edge)

BƯỚC 3 — PROCESS FLOWS CẦN DIAGRAM:
List các quy trình cần vẽ diagram (flow phức tạp, nhiều actor, nhiều bước).
Ưu tiên: quy trình có decision points, quy trình cross-system, quy trình approval.

BƯỚC 4 — DATA TOUCH POINTS:
List tất cả entities/data objects được mention trong URD.
Mỗi entity: tên | attributes mention | relationships mention | source section
(Đây là input cho --data-model mode)

BƯỚC 5 — GAPS vs BRD:
Nếu BRD đã được phân tích (đọc từ docs/pm-ba-document-status.md):
- US nào trong URD không có FR tương ứng trong BRD? → Gap in BRD
- FR nào trong BRD không có US trong URD? → Gap in URD
- List cả hai loại gap
```

### Step d — Save US + AC to Disk

Save User Stories and Acceptance Criteria table to:
```
plans/reports/ba-{YYYYMMDD}-urd-user-stories-{slug}.md
```

File structure:
```markdown
# URD User Stories & Acceptance Criteria — {Project/Module}
**Date:** YYYY-MM-DD | **Source URD:** {path}

## Personas
{persona table from Step b}

## User Stories
{US table from Step c, Bước 1}

## Acceptance Criteria
{AC table from Step c, Bước 2}

## Data Touch Points
{entity list from Step c, Bước 4}

## Gap Analysis vs BRD
{gap list from Step c, Bước 5}
```

### Step e — Process Flow Diagrams

For each process identified in Step c Bước 3, invoke `/ck:mermaidjs-v11` with:

```
Vẽ sơ đồ process flow cho quy trình "[TÊN QUY TRÌNH]" từ URD:

[QUY TRÌNH DESCRIPTION]

Yêu cầu Mermaid v11 flowchart:
- Swimlanes cho các actor khác nhau (subgraph)
- Decision diamonds cho các điều kiện phân nhánh
- Color coding: user actions (xanh) | system actions (xám) | external system (cam)
- Kết nối với US-XXX ở bước bắt đầu
```

### Step f — Update Traceability Matrix

Link US-XXX → FR-XXX:

1. Read FR list from `plans/reports/ba-*-brd-analysis-*.md` (if exists)
2. For each US, identify matching FR(s) by keyword/semantic match
3. Update `docs/pm-traceability-matrix.md`:
   - Add new rows for each US
   - Populate FR-IDs column with matched FR-XXX
   - Flag unmatched US as "Orphan — No FR"
4. If BRD not yet analyzed: add note "FR-XXX pending BRD analysis"

### Step g — Update State

Update `docs/pm-ba-document-status.md`:
- Set URD status: Analyzed
- Record US count, AC count
- Set `urd_analysis_path`: path to report from Step d

### Step h — Process Flow URD Analysis (Visio-Converted or BPMN Diagrams)

**Trigger:** File classified as "Process Flow URD" in Step 3, OR file contains Visio-MD markers (see `document-ingest-protocol.md` → Visio-Converted Markdown section).

**Goal:** Extract structured process knowledge from operational flow diagrams → produce FRs, BRs, roles, approval chains, and task assignments — **not** US/AC like standard URD steps.

#### Step h.1 — Ingest using Visio-MD protocol
Follow `document-ingest-protocol.md` → Visio-Converted Markdown section.
Save raw shape inventory to `plans/reports/raw-extract-{date}-process-flow-{slug}.md`.

#### Step h.2 — Extract via sequential thinking
For each page/diagram:
```
Input: shape labels from page "{PageName}"

Bước 1 — Actors: Identify swimlane headers = actors/roles in this flow
Bước 2 — Steps: Order shapes by numeric prefix → reconstruct step sequence
Bước 3 — Decision Points: shapes with YES/NO/Từ chối/Phê duyệt → map approval chain
Bước 4 — Variants: pages that share the same step structure but differ by actors/conditions → flag as flow variants
Bước 5 — System Actions: steps done by "Hệ thống" swimlane → automation candidates → FR candidates
Bước 6 — Manual/Exception Steps: steps labeled "ngoài hệ thống" or without actor = out-of-scope → flag for scope clarification
```

#### Step h.3 — Produce Process Flow Analysis Report
Save to `plans/reports/ba-{date}-process-flow-analysis-{slug}.md`. Include:

| Section | Content |
|---------|---------|
| Luồng tổng thể | N-step overview common to all variants |
| Hạng mục kiểm tra / Sub-processes | Comparison table across variants (KHCN vs KHDN, v02 vs v03…) |
| Ma trận roles | Actors × permissions matrix (new roles flagged) |
| Chuỗi phê duyệt | Numbered approval chains for each sub-process (4A, 4B…) |
| Business Rules | BR-PXX: auto-calculated, threshold, trigger, exception rules |
| FR candidates | FR-PXX: system functions inferred from steps, with confidence % |
| Delta vs prior analysis | What's new/changed compared to BRD or URD already analyzed |
| Ambiguities | Q-PXX questions that block implementation, with target stakeholder |

#### Step h.4 — Three-Track Task Output
After extracting ambiguities, invoke `references/35-output-task-triaging.md` to generate:
- **Track A** (BA-PXX): Customer-facing clarification workshops
- **Track B** (INT-XX): Internal alignment sessions (Techlead, Solution Architect)
- **Track C** (DEV-PXX): Dev items with confidence ≥80% that can start without clarification

Output artifacts and update targets: see `references/35-output-task-triaging.md` § Output Artifacts.

#### Step h.5 — Update State
Update `docs/pm-ba-document-status.md`: set Process Flow URD status = Analyzed, record BR/FR/task counts, set analysis path.

---

## 5. Quick Mode (`--urd --quick`)

Fast-path analysis (~40% tokens vs full run). Add `--quick` after `--urd` to activate.

**What runs:**
1. Read state (cross-cutting — same as full mode)
2. Ingest document — full protocol (not skipped)
3. Quick analysis using schemas from `references/output-schemas.md`:
   - **One-Page Summary** (§ One-Page Summary Format) — scope, actors, key user goals
   - **Top risks** — use § Risk-Mitigation Table; no quota, pick the most impactful ones
   - **Key assumptions** — all ASSUMED items extracted from user stories / AC intent
   - **Must-clarify questions** — use § Clarification Question Format; categorized by functional / data / security / timeline / decision
   - **Missing info** — use § Missing Info Report for gaps blocking US/AC extraction
4. Write state back (D3 — same as full mode; no exceptions)
5. Update output registry (cross-cutting)
6. Suggest: "Chạy `--urd` (full) để có US/AC đầy đủ, diagrams, và gap analysis vs BRD."

**What is skipped in `--quick`:**
- Full User Story + AC extraction (all stories)
- Process flow diagrams
- Data touch points inventory
- Gap analysis vs BRD
- Traceability matrix update

**Evidence labeling:** Every item MUST carry FACT/INFERRED/ASSUMED label per Invariant #17.

**Note:** For URDs >10 pages or URDs with complex screen specs, `--urd` (full) is recommended. `--quick` is best for initial triage before a requirements meeting.

---

## 6. Outputs

| Artifact | Location | Description |
|----------|----------|-------------|
| Raw URD extract | `plans/reports/raw-extract-{date}-urd-{slug}.md` | Verbatim extract |
| US + AC report | `plans/reports/ba-{date}-urd-user-stories-{slug}.md` | Full US/AC tables |
| Process diagrams | Embedded in report | Mermaid flowcharts per process |
| Traceability update | `docs/pm-traceability-matrix.md` | US-XXX → FR-XXX links |
| **Step h only** | | |
| Raw shape inventory | `plans/reports/raw-extract-{date}-process-flow-{slug}.md` | Visio shape labels per page |
| Process flow analysis | `plans/reports/ba-{date}-process-flow-analysis-{slug}.md` | BR/FR/roles/approval chains |

## 7. Deliverables Checklist

- [ ] URD ingested (chunk-aware if large)
- [ ] Persona/actor table complete
- [ ] All User Stories extracted (US-XXX IDs assigned)
- [ ] Acceptance Criteria written (min 2 AC per US)
- [ ] Process flow diagrams created
- [ ] Data touch points identified (input for --data-model)
- [ ] Gap analysis vs BRD complete (or noted as "BRD pending")
- [ ] US+AC report saved to `plans/reports/`
- [ ] Traceability matrix updated with US → FR links
- [ ] `docs/pm-ba-document-status.md` updated

## 8. Cross-References

- Screen URD detected → automatically suggest `--screen` flag
- Data entities found → automatically suggest `--data-model`
- Report URD detected → automatically suggest `--report`
- Template/Biên Bản detected → automatically suggest `--template`
- Process Flow URD detected → execute Step h; invoke `references/35-output-task-triaging.md`
- Visio-MD markers detected → follow `references/document-ingest-protocol.md` → Visio-Converted Markdown section
