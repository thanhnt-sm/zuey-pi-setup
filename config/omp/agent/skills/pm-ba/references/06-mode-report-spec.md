# Mode: Reporting Specification

## 1. Trigger

Activated when:
- CLI flag `--report <path>` is provided
- Natural language patterns detected: "spec báo cáo", "reporting spec", "đặc tả báo cáo", "report URD", "biểu mẫu báo cáo"
- Auto-routed from `03-mode-urd-analysis.md` when Report URD detected

## 2. Required Slots

| Slot | Description | Prompt if Missing |
|------|-------------|-------------------|
| `report_urd_path` | Path to report URD/specification file | "Vui lòng cung cấp đường dẫn đến file báo cáo URD:" |
| `project_slug` | Short project identifier | Infer from filename |

## 3. Per-Report Specification Schema

For each report, document the following fields completely:

| Field | Content |
|-------|---------|
| **Report ID** | R-XX (R-01, R-02, ...) |
| **Report Name** | Full Vietnamese name (e.g. "Báo Cáo Dư Nợ Theo Sản Phẩm") |
| **Purpose** | Business purpose — what decision does this report support |
| **Consumers** | Who uses this report (role + department) |
| **Trigger** | Scheduled / On-demand / Event-triggered |
| **Schedule** | If scheduled: frequency (daily/weekly/monthly), exact time, business day rule |
| **Data Sources** | Tables / APIs / External systems providing data |
| **Date Range** | Default date range logic (e.g. "current month", "as-of-date") |
| **Filters** | User-configurable filter parameters |
| **Columns** | See column sub-table below |
| **Grouping** | Default grouping logic (e.g. "Group by chi nhánh, sản phẩm") |
| **Sorting** | Default sort order |
| **Totals / Subtotals** | Which columns have sum/count/average at group/grand total |
| **Output Format** | Screen only / Excel export / PDF export / All |
| **Print Layout** | Paper size, orientation (if PDF/print) |
| **Permissions** | Which roles can view / export / schedule |
| **Retention** | How long report outputs are kept in system |
| **Business Rules** | Calculation rules, edge cases, special handling |
| **Linked URD** | Section reference in source URD |
| **Linked FR** | FR-XXX from BRD |

### Column Sub-Table (per report)

| STT | Tên Cột (VN) | Tên Code | Mô Tả | Nguồn Dữ Liệu (Table.Column) | Công Thức (nếu tính toán) | Định Dạng | Bắt Buộc |
|-----|-------------|----------|-------|-------------------------------|---------------------------|-----------|---------|

### Filter Parameter Sub-Table (per report)

| Tên Filter | Loại | Bắt Buộc | Giá Trị Mặc Định | Validation | Phụ Thuộc Filter Khác |
|-----------|------|----------|-----------------|------------|----------------------|

## 4. Workflow Steps

### Step a — Ingest Report URD

1. Convert to markdown: `mcp__markitdown__convert_to_markdown(uri)`
2. Identify how many distinct reports are specified
3. Save raw extract to `plans/reports/raw-extract-{date}-report-{slug}.md`

### Step b — Extract Report Specifications

Invoke `/ck:ask` with:

```
Từ tài liệu báo cáo URD sau, extract structured specification cho TẤT CẢ báo cáo:

[REPORT_URD_CONTENT]

Cho MỖI báo cáo, cung cấp đầy đủ:

1. METADATA TABLE:
   - Report ID (R-XX) | Tên đầy đủ VN | Mục đích nghiệp vụ
   - Người dùng (role/phòng ban) | Trigger | Lịch chạy
   - Format output | Quyền truy cập

2. DATA SOURCES:
   - List tất cả bảng DB / API / hệ thống nguồn cần lấy dữ liệu
   - Với mỗi nguồn: tên table/API | fields cần lấy | điều kiện join/filter
   - Flag các nguồn chưa xác định → thành Q-XXX

3. COLUMNS TABLE:
   - STT | Tên cột VN | Tên code | Mô tả | Table.Column nguồn | Công thức tính (nếu có) | Định dạng (số, %, tiền tệ, ngày) | Có tổng cộng?

4. FILTERS TABLE:
   - Tên filter | Loại (dropdown/date range/text search) | Bắt buộc? | Default | Validation

5. GROUPING & TOTALS:
   - Group by fields
   - Subtotal tại mỗi nhóm (fields nào)
   - Grand total (fields nào)
   - Sort order default

6. BUSINESS RULES:
   - Quy tắc tính toán đặc biệt
   - Edge cases (null values, kỳ chưa có dữ liệu, etc.)
   - Điều kiện lọc nghiệp vụ (ví dụ: "chỉ tính hợp đồng trạng thái Active")

7. OPEN ISSUES:
   - Data sources chưa xác định rõ table/column
   - Công thức tính chưa rõ
   - Permission chưa define
   → Mỗi item thành Q-XXX
```

### Step c — Flag Data Sources Needing API/DB Access

After extraction:
1. Identify all data sources mentioned
2. Cross-check against known system entities (from `docs/ba-data-model.md` if exists)
3. Flag unresolved sources:
   - Unknown tables → Q-XXX (Category: Technical, Directed to: Dev/DBA)
   - External system APIs → Q-XXX (Category: Technical, Directed to: Vendor)
4. Add all flags to clarification register via `10-mode-clarification.md`

### Step d — Save Report Spec

Save to `docs/ba-report-spec.md`:

```markdown
# Reporting Specification — {Module/Project}
**Date:** YYYY-MM-DD | **Source:** {path}

## Report Inventory
| R-ID | Tên Báo Cáo | Trigger | Consumers | Output | Status |
|------|------------|---------|-----------|--------|--------|

## Report Details

### R-01 — [Report Name]
{Metadata table}
{Data sources}
{Columns table}
{Filters table}
{Grouping & totals}
{Business rules}
{Open issues → Q-XXX}

### R-02 — [Report Name]
{...}

## Data Source Registry
| Table/API | System | Used By Reports | Status |
|-----------|--------|-----------------|--------|
| | | R-01, R-02 | Confirmed/Unknown |
```

## 5. Outputs

| Artifact | Location | Description |
|----------|----------|-------------|
| Raw extract | `plans/reports/raw-extract-{date}-report-{slug}.md` | Verbatim |
| Report Spec | `docs/ba-report-spec.md` | All reports + data source registry |
| Clarification items | `plans/reports/pm-ba-clarification-register.md` | Q-XXX for unknown sources/formulas |

## 6. Deliverables Checklist

- [ ] All reports identified and assigned R-XX IDs
- [ ] Metadata complete for each report
- [ ] Data source tables identified (or flagged as Q-XXX)
- [ ] Column definitions complete (including calculated field formulas)
- [ ] Filter parameters defined
- [ ] Grouping, sorting, totals documented
- [ ] Business rules and edge cases captured
- [ ] Unknown data sources flagged in clarification register
- [ ] `docs/ba-report-spec.md` saved
- [ ] Each report linked to FR-XXX in traceability matrix
