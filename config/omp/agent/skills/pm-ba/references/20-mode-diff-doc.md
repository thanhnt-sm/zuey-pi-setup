# Mode: Document Comparison / Diff

## 1. Trigger

- Flag: `--diff <doc-a> <doc-b>`
- Natural language: "so sánh URD v1 v2", "compare documents", "diff hai bản", "phiên bản mới thay đổi gì"

---

## 2. Input Handling

Both `doc-a` and `doc-b` can be:
- File paths (absolute or relative to project root)
- Pasted text inline (user provides content directly)
- URLs (fetch and convert to markdown)

Ingest both per `references/document-ingest-protocol.md` rules:
- Use `mcp__markitdown__convert_to_markdown` for PDF/DOCX/XLSX files
- Save each as evidence file in `plans/reports/` before processing

---

## 3. Workflow Steps

### Step 3a — Ingest Both Documents
```
DOC_A: ingest [DOC_A_PATH_OR_CONTENT]
  → Save evidence: plans/reports/evidence-diff-{date}-doc-a-{slug}.md

DOC_B: ingest [DOC_B_PATH_OR_CONTENT]
  → Save evidence: plans/reports/evidence-diff-{date}-doc-b-{slug}.md
```

Confirm to user: "Đã ingested cả hai tài liệu. Bắt đầu so sánh..."

### Step 3b — Structured Comparison
Run subagent comparison analysis with this exact prompt structure:
```
So sánh hai phiên bản tài liệu:

=== Version A (Cũ / Baseline) ===
[DOC_A_CONTENT]

=== Version B (Mới / Revised) ===
[DOC_B_CONTENT]

Phân tích theo thứ tự:

1. ADDITIONS — Nội dung mới trong B không có trong A
   Format: { Section | Added Content | Business Impact }

2. REMOVALS — Nội dung có trong A không còn trong B
   Format: { Section | Removed Content | Reason if inferable }

3. MATERIAL CHANGES — Nội dung thay đổi đáng kể (không chỉ format/wording)
   Format: { Section | Old Content | New Content | Nature of Change }

4. MINOR CHANGES — Typo, formatting, reordering không ảnh hưởng substance
   Format: { Type | Count | Examples }

5. IMPACT ASSESSMENT — Những thay đổi nào ảnh hưởng đến:
   - Design / Architecture
   - Development (FR/US scope change)
   - Testing (TC/UAT need update)
   - Timeline / Effort
   - Previously signed-off items

Output: VN language, structured sections, actionable findings
```

### Step 3c — Categorize Changes by Impact Type

After extraction, classify each Material Change as:

| Category | Definition | Recommended Action |
|----------|-----------|-------------------|
| `scope-impacting` | Changes design, FR, US, or AC | Recommend --cr mode |
| `clarification` | Adds detail/context without changing scope | Update relevant docs directly |
| `cosmetic` | Formatting, typos, reordering | Update silently or note only |

### Step 3d — Check Against Signed-off Status
Read `docs/pm-signoff-log.md`:
- If DOC_A is a signed-off version AND changes are scope-impacting:
  ```
  Cảnh báo: Version A [DOC_NAME] v[VERSION] đã được ký duyệt (SO-[ID]).
  Các thay đổi scope-impacting cần Change Request.
  Đề xuất tạo CR cho [X] thay đổi. Tiến hành --cr không?
  ```

### Step 3e — Save Diff Report
Save complete comparison to `plans/reports/diff-{date}-{a-slug}-vs-{b-slug}.md`.

---

## 4. Output Report Structure

```markdown
# Document Diff Report — [DOC_A_NAME] vs [DOC_B_NAME]
**Ngày:** YYYY-MM-DD  
**Version A:** [path/version]  
**Version B:** [path/version]

## Executive Summary
- Additions: [N] items
- Removals: [N] items  
- Material Changes: [N] items ([X] scope-impacting, [Y] clarification, [Z] cosmetic)
- Minor Changes: [N] items

## Additions (Nội dung mới trong B)
| Section | Nội dung thêm | Business Impact |
|---------|--------------|----------------|

## Removals (Nội dung bị xóa trong A)
| Section | Nội dung bị xóa | Nhận xét |
|---------|----------------|---------|

## Material Changes
| Section | Version A | Version B | Loại thay đổi |
|---------|-----------|-----------|--------------|

## Minor Changes
- [N] typos corrected
- [N] sections reordered
- [N] formatting updates

## Impact Assessment
| Khía cạnh | Bị ảnh hưởng | Chi tiết |
|----------|-------------|---------|
| Design | Yes/No | |
| Development | Yes/No | |
| Testing | Yes/No | |
| Timeline | Yes/No | |
| Signed-off docs | Yes/No | |

## Recommended Actions
1. [scope-impacting changes] → Tạo CR: --cr "[description]"
2. [clarification changes] → Cập nhật [target docs]
3. [cosmetic changes] → Update silently (no CR needed)
```

---

## 5. Outputs

| File | Description |
|------|-------------|
| `plans/reports/evidence-diff-{date}-doc-a-{slug}.md` | Doc A evidence |
| `plans/reports/evidence-diff-{date}-doc-b-{slug}.md` | Doc B evidence |
| `plans/reports/diff-{date}-{a-slug}-vs-{b-slug}.md` | Full diff report |
