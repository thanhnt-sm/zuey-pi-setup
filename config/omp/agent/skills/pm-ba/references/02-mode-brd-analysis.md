# Mode: BRD Analysis

## 1. Trigger

Activated when:
- CLI flag `--brd <path>` is provided
- Natural language patterns detected: "phân tích BRD", "BRD mới", "đọc BRD", "review BRD", "analyze BRD"

## 2. Required Slots

| Slot | Description | Prompt if Missing |
|------|-------------|-------------------|
| `brd_path` | Path to BRD file or folder | Use `/ck:ask` → "Vui lòng cung cấp đường dẫn đến file BRD (hoặc thư mục chứa BRD):" |
| `project_slug` | Short project identifier | Infer from filename or ask: "Tên viết tắt của dự án (dùng cho file output):" |

If `brd_path` is missing, invoke `AskUserQuestion` with options:
- "Nhập đường dẫn file BRD"
- "Nhập đường dẫn thư mục chứa BRD"
- "Skip — BRD chưa có"

## 3. Workflow Steps

### Step a — Read State
Read `docs/pm-ba-document-status.md` to determine:
- Which BRD version is current
- Whether a previous BRD analysis exists (to run incremental diff instead of full analysis)
- Active modules in scope

### Step b — Ingest BRD
Follow `references/document-ingest-protocol.md` to ingest the BRD file or folder.

Save raw extract immediately to disk (before any synthesis):
```
plans/reports/raw-extract-{YYYYMMDD}-brd-{slug}.md
```

The raw extract must contain:
- Source file name and page/section references
- Verbatim excerpts of all requirement statements
- Table of contents from the original document
- Any diagrams described in text form

### Step c — Sequential Thinking Analysis

Dependency matrix (see `references/44-parallel-protocol.md`):
| Sub-step | Outputs | Depends On |
|----------|---------|------------|
| BƯỚC 1 (FR) | FR table | raw extract |
| BƯỚC 2 (NFR) | NFR table | raw extract |
| BƯỚC 3 (BR) | BR table | raw extract |
| BƯỚC 4 (Ambiguities) | Ambiguity table | BƯỚC 1+2+3 |
| BƯỚC 5 (Conflicts) | Conflicts list | BƯỚC 1+2+3+4 |

BƯỚC 1-3 run in parallel (internal to `/ck:sequential-thinking` reasoning).
BƯỚC 4-5 sequential after batch.

Invoke `/ck:sequential-thinking` with the following prompt (replace `[BRD_CONTENT]` with the raw extract content):

```
Phân tích tài liệu BRD sau đây:

[BRD_CONTENT]

Thực hiện tuần tự từng bước sau:

BƯỚC 1 — FUNCTIONAL REQUIREMENTS:
- Liệt kê tất cả Functional Requirements từ BRD
- Gán ID theo format FR-XXX (FR-001, FR-002, ...)
- Mỗi FR ghi: ID | Mô tả ngắn gọn | Module | Nguồn (section BRD) | Mức độ ưu tiên (Must/Should/Could)

BƯỚC 2 — NON-FUNCTIONAL REQUIREMENTS:
- Liệt kê tất cả Non-Functional Requirements
- Gán ID theo format NFR-XXX
- Phân loại: Performance | Security | Usability | Availability | Scalability | Compliance

BƯỚC 3 — BUSINESS RULES:
- Identify tất cả Business Rules quan trọng (điều kiện, ràng buộc nghiệp vụ)
- Gán ID theo format BR-XXX
- Mỗi BR ghi: ID | Mô tả | FRs liên quan | Nguồn

BƯỚC 4 — AMBIGUITIES & ASSUMPTIONS:
- List các điểm chưa rõ ràng trong BRD (mô tả mơ hồ, thiếu detail)
- List các assumptions đã được implicit trong BRD
- Gán mức độ impact: High/Medium/Low

BƯỚC 5 — CONFLICTS & GAPS:
- Flag các conflicts giữa requirements (mâu thuẫn nhau)
- Flag các gaps (FR được mention nhưng thiếu detail)
- Đề xuất câu hỏi cần làm rõ cho từng conflict/gap
```

### Step d — Structure Output as Tables

Invoke `/ck:ask` with:

```
Dựa trên kết quả phân tích trên, định dạng thành các bảng sau:

BẢNG 1 — FUNCTIONAL REQUIREMENTS:
| FR-ID | Mô Tả | Module | Section BRD | Ưu Tiên | Status |
Điền đầy đủ tất cả FRs đã identify.

BẢNG 2 — NON-FUNCTIONAL REQUIREMENTS:
| NFR-ID | Loại | Mô Tả | Metric/Target | Section BRD |
Điền đầy đủ tất cả NFRs.

BẢNG 3 — BUSINESS RULES:
| BR-ID | Mô Tả Rule | FR Liên Quan | Section BRD | Tác Động |
Điền đầy đủ tất cả BRs.

BẢNG 4 — AMBIGUITIES & OPEN QUESTIONS:
| # | Vị Trí (Section) | Vấn Đề | Impact | Câu Hỏi Đề Xuất | Ưu Tiên |
Điền tất cả điểm mơ hồ và conflict.
```

### Step e — Module Mindmap

Invoke `/ck:mermaidjs-v11` with:

```
Vẽ mindmap Mermaid v11 thể hiện cấu trúc modules của hệ thống từ BRD.

Yêu cầu:
- Root node: tên hệ thống
- Level 1: các Module chính
- Level 2: Sub-modules / Features chính của từng Module
- Level 3 (nếu có): màn hình hoặc process chính
- Sử dụng Mermaid v11 mindmap syntax:
  mindmap
    root((Tên Hệ Thống))
      Module A
        Feature 1
        Feature 2
      Module B
        ...
- Đặt tên nodes bằng tiếng Việt (tên nghiệp vụ, không phải tên kỹ thuật)
```

### Step f — Process Flow Diagrams

For each major process identified in BRD (max 5), invoke `/ck:preview --diagram` with:

```
Vẽ sơ đồ process flow cho quy trình "[TÊN QUY TRÌNH]":

[QUY TRÌNH DESCRIPTION]

Yêu cầu:
- Swimlane diagram nếu có nhiều actor
- Hiển thị: Start → Activities → Decision points → End
- Label các decision branches bằng tiếng Việt
- Highlight bước nào cần business rule validation
```

### Step g — Trigger Clarification Mode

After analysis, automatically invoke `references/10-mode-clarification.md` to:
- Convert all items from Ambiguities table (Step d, Bảng 4) into Q-XXX entries
- Add to `plans/reports/pm-ba-clarification-register.md`
- Priority mapping: High impact → P1 | Medium → P2 | Low → P3

### Step h — Save Analysis Report

Save final structured report to:
```
plans/reports/ba-{YYYYMMDD}-brd-analysis-{slug}.md
```

Report structure:
```markdown
# BRD Analysis Report — {Project Name}
**Date:** YYYY-MM-DD
**BRD Source:** {file path}
**Analyst:** Claude (pm-ba skill)

## Executive Summary
[3-5 bullet points: scope, total FR/NFR/BR count, key risks]

## Functional Requirements
{FR table from Step d}

## Non-Functional Requirements
{NFR table from Step d}

## Business Rules
{BR table from Step d}

## Module Structure
{Mermaid mindmap from Step e}

## Process Flows
{Diagrams from Step f}

## Open Issues & Ambiguities
{Ambiguity table from Step d}
[Note: Full clarification register in plans/reports/pm-ba-clarification-register.md]

## Traceability Seed
[Instruction: run --trace to build full matrix from these FRs]
```

### Step i — Update State

Update `docs/pm-ba-document-status.md`:
- Set BRD status: Analyzed
- Record FR count, NFR count, BR count
- Set `brd_analysis_path`: path to report from Step h
- Increment version if re-analysis

## 4. Quick Mode (`--brd --quick`)

Fast-path analysis (~40% tokens vs full run). Add `--quick` after `--brd` to activate.

**What runs:**
1. Read state (cross-cutting — same as full mode)
2. Ingest document — full protocol (not skipped)
3. Quick analysis using schemas from `references/output-schemas.md`:
   - **One-Page Summary** (§ One-Page Summary Format) — scope, key findings, recommended next step
   - **Top risks** — use § Risk-Mitigation Table; no quota, pick the most impactful ones
   - **Key assumptions** — all ASSUMED-labeled items from the document
   - **Must-clarify questions** — use § Clarification Question Format; categorized by functional / data / security / timeline / decision
   - **Missing info** — use § Missing Info Report for gaps blocking further analysis
4. Write state back (D3 — same as full mode; no exceptions)
5. Update output registry (cross-cutting)
6. Suggest: "Chạy `--brd` (full) để có phân tích đầy đủ FR/NFR/BR và diagrams."

**What is skipped in `--quick`:**
- User story generation
- Timeline drafting
- Internal assignment suggestions
- Test case generation
- Process flow diagrams
- Module mindmap

**Evidence labeling:** Every item (risks, assumptions, questions) MUST carry FACT/INFERRED/ASSUMED label per Invariant #17. No item is unlabeled.

**Note:** For documents >10 pages, `--brd` (full) provides significantly more complete analysis. `--quick` is best for initial triage or time-constrained reviews.

---

## 5. Outputs

| Artifact | Location | Description |
|----------|----------|-------------|
| Raw BRD extract | `plans/reports/raw-extract-{date}-brd-{slug}.md` | Verbatim extracts, preserved for audit |
| BRD Analysis Report | `plans/reports/ba-{date}-brd-analysis-{slug}.md` | Structured FRs, NFRs, BRs, tables, diagrams |
| Module Mindmap | Embedded in analysis report | Mermaid mindmap of system modules |
| Clarification Questions | `plans/reports/pm-ba-clarification-register.md` | Q-XXX entries from ambiguities |
| State Update | `docs/pm-ba-document-status.md` | Updated BRD status fields |

## 6. Next Recommended Actions

After BRD analysis, recommend in order:

1. **Clarify open questions** — run `--clarify` → send Q-XXX register to stakeholders
2. **Analyze URD** — run `--urd <path>` → extract User Stories linked to FRs
3. **Build Data Model** — run `--data-model` → extract entities from BRD scope
4. **API Contract** — run `--api <path>` if BRD includes integration requirements
5. **Build Traceability** — run `--trace` after URD analyzed → BR → FR → US matrix

## 7. Deliverables Checklist

- [ ] Raw extract saved to `plans/reports/`
- [ ] FR table complete (all FRs assigned FR-XXX IDs)
- [ ] NFR table complete (all NFRs assigned NFR-XXX IDs)
- [ ] BR table complete (all BRs assigned BR-XXX IDs)
- [ ] Ambiguities table complete
- [ ] Module mindmap rendered (Mermaid v11)
- [ ] Process flow diagrams created (minimum 1 per major process)
- [ ] Clarification questions added to register (Q-XXX)
- [ ] BRD analysis report saved
- [ ] `docs/pm-ba-document-status.md` updated
- [ ] `docs/pm-traceability-matrix.md` seeded with FR-XXX entries
