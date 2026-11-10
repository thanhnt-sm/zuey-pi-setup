# Mode: Screen / UI Specification

## 1. Trigger

Activated when:
- CLI flag `--screen <path>` is provided
- Natural language patterns detected: "spec màn hình", "screen URD", "đặc tả màn hình", "UI spec", "giao diện màn hình"
- Auto-routed from `03-mode-urd-analysis.md` when Screen URD is detected in folder scan

## 2. Required Slots

| Slot | Description | Prompt if Missing |
|------|-------------|-------------------|
| `screen_urd_path` | Path to screen URD file/folder | "Vui lòng cung cấp đường dẫn đến file Screen URD:" |
| `project_slug` | Short project identifier | Infer from filename |

## 3. Screen Specification Table (per screen)

Each screen must be documented with all of the following fields:

| Field | Description |
|-------|-------------|
| **Screen ID** | SC-XXX (sequential, e.g. SC-001, SC-002) |
| **Screen Name (VN)** | Vietnamese business name (e.g. "Màn hình Đăng ký Hợp đồng") |
| **Role / Actor** | Which persona(s) use this screen |
| **Access Condition** | When/how is it accessible (e.g. "After login, role = CBTD") |
| **Parent Screen** | Screen that navigates to this one (SC-XXX or "Login") |
| **Child Screens** | Screens navigated to from this one |
| **Fields** | See field sub-table below |
| **Actions / Buttons** | See action sub-table below |
| **Error Messages** | See error sub-table below |
| **Business Rules** | BR-XXX references enforced on this screen |
| **Linked User Story** | US-XXX |
| **Linked URD Section** | Section reference in source URD |

### Field Sub-Table (per screen)

| Field Name (VN) | Field Name (EN/Code) | Type | Required | Validation | Default | Read-Only | Notes |
|-----------------|----------------------|------|----------|------------|---------|-----------|-------|
| | | Text/Number/Date/Select/Checkbox/File | Y/N | Rule | | Y/N | |

### Action/Button Sub-Table (per screen)

| Button Label (VN) | Action | Enabled Condition | Navigate To | Business Rule | Confirmation Required |
|-------------------|--------|-------------------|-------------|---------------|-----------------------|
| | Save/Submit/Cancel/Search/Export | | SC-XXX or none | BR-XXX | Y/N |

### Error Message Sub-Table (per screen)

| Trigger (Field/Action) | Error Message (Vietnamese) | Display Type | BR Reference |
|------------------------|---------------------------|--------------|--------------|
| | | Inline/Toast/Modal | |

## 4. Workflow Steps

### Step a — Ingest Screen URD

1. Convert to markdown using `mcp__markitdown__convert_to_markdown(uri)`
2. If multiple screens in one doc: identify section headings as screen boundaries
3. Save raw extract to `plans/reports/raw-extract-{date}-screen-{slug}.md`

### Step b — Extract All Screens

Invoke `/ck:ask` with:

```
Từ Screen URD sau, extract tất cả các màn hình (screens) thành structured tables.

[SCREEN_URD_CONTENT]

Cho MỖI màn hình, tạo đầy đủ:

1. SCREEN OVERVIEW TABLE:
   - Screen ID: SC-XXX (đặt ID tuần tự)
   - Tên VN / Tên code
   - Actor/Role
   - Access Condition
   - Parent Screen / Child Screens

2. FIELDS TABLE:
   - Tên field VN | Tên code | Loại (Text/Number/Date/Select/Checkbox/File) | Bắt buộc | Validation rules | Default | Read-only | Ghi chú

3. ACTIONS TABLE:
   - Label button VN | Hành động | Điều kiện enable | Navigate đến | Business rule | Cần confirm?

4. ERROR MESSAGES TABLE:
   - Trigger | Thông báo lỗi (VN) | Loại hiển thị | BR reference

5. OPEN ISSUES:
   - Fields chưa rõ validation rule
   - Actions chưa rõ behavior
   - Missing error messages
   → Mỗi open issue sẽ thành Q-XXX trong clarification register

Lưu ý: KHÔNG bỏ sót bất kỳ field hoặc button nào. Nếu không chắc, ghi vào Open Issues.
```

### Step c — Screen Navigation Flow

Invoke `/ck:mermaidjs-v11` with:

```
Vẽ screen navigation flow diagram (Mermaid v11 stateDiagram-v2) cho các màn hình sau:

[LIST OF SCREENS WITH PARENT/CHILD RELATIONSHIPS]

Yêu cầu:
- Mỗi state = 1 màn hình (dùng Screen ID + tên ngắn)
- Transitions = button actions (label bằng tên button VN)
- Note các điều kiện access trên transition (nếu có role-based)
- Group các screens theo module nếu nhiều hơn 8 screens
- Syntax mẫu:
  stateDiagram-v2
    [*] --> SC001_Login
    SC001_Login --> SC002_DanhSach : Đăng nhập thành công
    SC002_DanhSach --> SC003_ChiTiet : Chọn hồ sơ
    ...
```

### Step d — Identify Clarification Items

For each Open Issue found in Step b:
- Add to `plans/reports/pm-ba-clarification-register.md` via `10-mode-clarification.md`
- Category: "UI/UX" or "Business Rule" or "Validation"
- Directed to: Client (nghiệp vụ) or Dev (kỹ thuật)

### Step e — Save Screen Spec

Save to `docs/ba-screen-spec.md`:

```markdown
# Screen Specification — {Module/Project Name}
**Date:** YYYY-MM-DD | **Source:** {URD path}

## Screen Navigation Flow
{Mermaid stateDiagram from Step c}

## Screen Inventory
| SC-ID | Tên Màn Hình | Actor | Linked US | Status |
|-------|-------------|-------|-----------|--------|
| SC-001 | ... | ... | US-XXX | Draft |

## Screen Details

### SC-001 — [Screen Name]
{Complete tables from Step b for this screen}

### SC-002 — [Screen Name]
{...}
```

### Step f — Link to Traceability

For each screen SC-XXX:
- Identify linked US-XXX (from screen spec or semantic match)
- Add SC-XXX column to `docs/pm-traceability-matrix.md` if not present
- Link SC-XXX → US-XXX

## 5. Outputs

| Artifact | Location | Description |
|----------|----------|-------------|
| Raw screen extract | `plans/reports/raw-extract-{date}-screen-{slug}.md` | Verbatim |
| Screen Spec document | `docs/ba-screen-spec.md` | All screens + nav diagram |
| Screen nav flow | Embedded in screen spec | Mermaid stateDiagram |
| Clarification items | `plans/reports/pm-ba-clarification-register.md` | Q-XXX for open issues |

## 6. Deliverables Checklist

- [ ] All screens identified and assigned SC-XXX IDs
- [ ] Field tables complete for each screen
- [ ] Action/button tables complete for each screen
- [ ] Error message tables complete (or noted as missing)
- [ ] Business rules linked (BR-XXX)
- [ ] Screen navigation flow diagram (Mermaid stateDiagram)
- [ ] Open issues added to clarification register
- [ ] `docs/ba-screen-spec.md` saved
- [ ] Each screen linked to US-XXX in traceability matrix
