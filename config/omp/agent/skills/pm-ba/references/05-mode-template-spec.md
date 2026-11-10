# Mode: Biên Bản / Template Specification

## 1. Trigger

Activated when:
- CLI flag `--template <path>` is provided
- Natural language patterns detected: "phân tích biên bản", "template spec", "mẫu biên bản", "form spec", "phân tích mẫu"
- Auto-routed from `03-mode-urd-analysis.md` when Template/Biên Bản URD detected

## 2. Required Slots

| Slot | Description | Prompt if Missing |
|------|-------------|-------------------|
| `template_path` | Path to template/biên bản file | "Vui lòng cung cấp đường dẫn đến file biên bản/template:" |
| `project_slug` | Short project identifier | Infer from filename |

## 3. Per-Template Analysis Schema

For each Biên Bản / Form template found, document the following:

| Field | Content |
|-------|---------|
| **Template ID** | T-XX (T-01, T-02, ...) |
| **Template Name** | Full Vietnamese name (e.g. "Biên Bản Giải Ngân Vốn Vay") |
| **Purpose** | Business purpose — what event does this document record |
| **Trigger** | When is this document created (event or action that initiates it) |
| **Parties** | Who signs / approves / witnesses (roles + responsibilities) |
| **System Generation** | Is it system-generated or manually filled? |
| **Fields** | See field sub-table below |
| **Validation Rules** | Business rules on field values (constraints, format, range) |
| **Signature Workflow** | Step-by-step approval and signature chain |
| **Storage** | Where stored (system / physical), retention period per regulation |
| **Version Control** | How versions are managed (if applicable) |
| **Related Documents** | Links to other templates, processes, or FRs this template supports |
| **Legal Reference** | Regulatory/legal basis if any (Thông tư, Quyết định, etc.) |

### Field Sub-Table (per template)

| STT | Tên Trường | Tên Code | Loại | Bắt Buộc | Validation | Nguồn Dữ Liệu | Ghi Chú |
|-----|-----------|----------|------|----------|------------|----------------|---------|
| 1 | | | Text/Number/Date/Checkbox | Y/N | | Manual/System/Lookup | |

### Signature Workflow Steps

For each signature/approval step:

| Bước | Người Ký/Duyệt | Vai Trò | Điều Kiện | Hành Động | Thời Hạn |
|------|----------------|---------|----------|-----------|---------|
| 1 | | | | Ký/Đóng dấu/Phê duyệt | |

## 4. Workflow Steps

### Step a — Ingest Template File

1. Convert to markdown: `mcp__markitdown__convert_to_markdown(uri)`
2. Identify how many distinct templates are in the file
   - Single template per file: process directly
   - Multiple templates: split by template name/section and process each
3. Save raw extract to `plans/reports/raw-extract-{date}-template-{slug}.md`

### Step b — Extract Structured Spec

Invoke `/ck:ask` with:

```
Từ tài liệu biên bản/template sau, extract structured specification:

[TEMPLATE_CONTENT]

Cho MỖI biên bản/mẫu form, cung cấp:

1. METADATA TABLE:
   - Template ID (T-XX)
   - Tên đầy đủ (VN)
   - Mục đích nghiệp vụ
   - Trigger: điều kiện/sự kiện tạo biên bản
   - Các bên liên quan (ai ký, ai lưu)
   - Cơ sở pháp lý (nếu có)

2. FIELDS TABLE:
   - STT | Tên trường VN | Tên code | Loại dữ liệu | Bắt buộc | Validation | Nguồn dữ liệu | Ghi chú
   - Bao gồm: header fields, body fields, footer/signature fields

3. SIGNATURE WORKFLOW TABLE:
   - Bước | Người thực hiện | Vai trò | Điều kiện tiên quyết | Hành động | Thời hạn
   - Ghi rõ thứ tự ký: draft → review → approve → sign → seal

4. STORAGE & RETENTION:
   - Lưu ở đâu trong hệ thống (module, folder path)
   - Lưu bản cứng ở đâu (nếu có)
   - Thời gian lưu trữ (regulatory requirement)

5. OPEN ISSUES:
   - Fields chưa rõ validation
   - Quy trình ký chưa rõ
   - Legal basis chưa confirm
   → Mỗi item thành Q-XXX trong clarification register
```

### Step c — Signature Flow Diagram (if complex)

If a template has 3+ signature steps or multiple approval paths, invoke `/ck:mermaidjs-v11` with:

```
Vẽ approval/signature flow diagram (Mermaid v11 flowchart) cho biên bản "[TÊN BIÊN BẢN]":

[SIGNATURE WORKFLOW DESCRIPTION]

Yêu cầu:
- Mỗi bước là 1 node với tên người ký/duyệt + hành động
- Decision diamonds cho conditional approvals (if any)
- Parallel paths nếu có multi-party signing
- Kết thúc: "Hoàn tất / Lưu trữ"
- Syntax Mermaid v11 flowchart TD hoặc LR tùy độ phức tạp
```

### Step d — Add Open Issues to Clarification Register

For each Open Issue found in Step b:
- Invoke `10-mode-clarification.md` to add Q-XXX entries
- Category: "Business Rule" (validation issues) or "Legal" (regulatory references) or "Process" (workflow gaps)

### Step e — Save Template Spec

Save to `docs/ba-template-spec.md`:

```markdown
# Template / Biên Bản Specification — {Module/Project}
**Date:** YYYY-MM-DD | **Source:** {path}

## Template Inventory
| T-ID | Tên Biên Bản | Trigger | Parties | Status |
|------|-------------|---------|---------|--------|

## Template Details

### T-01 — [Template Name]
{Metadata table}
{Fields table}
{Signature workflow table}
{Mermaid diagram if applicable}
{Storage & retention info}
{Open issues}

### T-02 — [Template Name]
{...}
```

## 5. Outputs

| Artifact | Location | Description |
|----------|----------|-------------|
| Raw extract | `plans/reports/raw-extract-{date}-template-{slug}.md` | Verbatim |
| Template Spec | `docs/ba-template-spec.md` | All templates + workflows |
| Signature diagrams | Embedded in spec | Mermaid flowcharts |
| Clarification items | `plans/reports/pm-ba-clarification-register.md` | Q-XXX entries |

## 6. Deliverables Checklist

- [ ] All templates identified and assigned T-XX IDs
- [ ] Metadata table complete for each template
- [ ] Fields table complete (all fields including header/footer)
- [ ] Signature workflow table complete
- [ ] Signature flow diagram for complex workflows (3+ steps)
- [ ] Storage and retention policy documented
- [ ] Legal reference noted (or flagged as Q-XXX if unknown)
- [ ] Open issues added to clarification register
- [ ] `docs/ba-template-spec.md` saved and formatted
