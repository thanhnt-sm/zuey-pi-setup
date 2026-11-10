# Mode: Project Kickoff

## 1. Trigger

- Flag: `--kickoff`
- Natural language: "khởi tạo dự án", "start project", "bắt đầu dự án", "kick off"

---

## 2. Required Slots

Use `AskUserQuestion` if any of the following are missing. Batch all into a single question call.

| Slot | Description | Example |
|------|-------------|---------|
| `project_name` | Full official project name | "Hệ thống Quản lý Sau Vay [CLIENT]" |
| `sponsor` | Executive sponsor name + title | "Nguyễn Văn A — Giám đốc Khối CNTT" |
| `business_owner` | Party A business owner name + unit | "Trần Thị B — Phòng Quản lý Sau Vay" |
| `vendor_poc` | Party B vendor PoC name + company | "Lê Văn C — ABC Solutions" |
| `timeline_goal` | Target duration or end date | "6 tháng" or "30/12/2025" |
| `regulatory_deadline` | Hard regulatory or compliance deadline | "31/03/2026 (NHNN requirement)" or "N/A" |

**AskUserQuestion prompt template:**
```
Để khởi tạo dự án, tôi cần thu thập thông tin sau:
1. Tên dự án chính thức?
2. Nhà tài trợ (Sponsor) — tên và chức vụ?
3. Business Owner (Bên A) — tên và phòng ban?
4. Đầu mối liên hệ Vendor (Bên B) — tên và công ty?
5. Mục tiêu timeline — bao nhiêu tháng hoặc ngày hoàn thành?
6. Deadline quy định bắt buộc (nếu có)?
```

---

## 3. Workflow Steps

### Step 3a — Collect Required Slots
Call `AskUserQuestion` with all 6 slots in one batch. Do not proceed until all 6 are provided.

### Step 3b — Check Existing Charter
```
IF docs/pm-project-charter.md EXISTS:
  → Read file
  → Diff existing content against new slot values provided
  → AskUserQuestion:
      "Tài liệu pm-project-charter.md đã tồn tại với thông tin [SUMMARY].
       Bạn muốn:
       A) Cập nhật thông tin mới vào charter hiện tại
       B) Tạo phiên bản mới (v2.0) và archive phiên bản cũ
       C) Hủy — giữ nguyên charter hiện tại"
  → Execute based on user selection
ELSE:
  → Proceed to Step 3c
```

### Step 3c — Stakeholder & Risk Exploration
Invoke `/ck:brainstorm` with the following prompt:
```
Dự án: [PROJECT_NAME]
Bên A: [BUSINESS_OWNER] / Bên B: [VENDOR_POC]
Timeline: [TIMELINE_GOAL]

Brainstorm:
1. Stakeholder map — ai là stakeholders chính, secondary, và ảnh hưởng gián tiếp?
2. Key risks — 5-8 rủi ro hàng đầu cho dự án này (kỹ thuật, nghiệp vụ, tích hợp, compliance)
3. Critical dependencies — các phụ thuộc quan trọng cần giải quyết sớm
4. Open questions — câu hỏi cần làm rõ với stakeholders ngay từ đầu

Output format: phân mục rõ ràng, dùng tiếng Việt
```

Save brainstorm output to `plans/reports/pm-{date}-kickoff-brainstorm.md`.

### Step 3d — Create/Update Documents

Create or update ALL of the following documents using their respective templates. Populate with actual data from slots and brainstorm output — NEVER leave placeholder text unfilled for fields where data is available.

1. **`docs/pm-project-charter.md`** — from `templates/tpl-project-charter.md`
   - Populate: project name, sponsor, business owner, vendor PoC, timeline, milestones (derive from timeline goal)

2. **`docs/pm-stakeholder-map.md`** — from `templates/tpl-stakeholder-map.md`
   - Populate: all stakeholders identified in brainstorm, with roles and engagement strategy

3. **`docs/pm-risk-register.md`** — from `templates/tpl-risk-register.md`
   - Populate: all risks identified in brainstorm with R-ID (R-001, R-002, ...), likelihood/impact assessment

4. **`docs/pm-ba-document-status.md`** — from `templates/tpl-document-status.md`
   - Create ONLY if not exists
   - Set: Last Mode Run = "kickoff", Last Run Date = today, PM-01 row = Charter created

### Step 3e — Update State File
Update `docs/pm-ba-document-status.md`:
```
Last Mode Run: kickoff
Last Run Date: [TODAY]
Active Blockers: [any identified in brainstorm, or "None"]
Next Recommended Action: Run --brd when BRD document is available from Party A
```

### Step 3f — Journal Entry
Invoke `/ck:journal` with:
```
Recorded project kickoff for [PROJECT_NAME].
Sponsor: [SPONSOR]. Timeline: [TIMELINE_GOAL].
Key risks identified: [COUNT] risks logged in risk register.
Documents created: charter, stakeholder map, risk register, document status.
```

---

## 4. Outputs

| File | Description |
|------|-------------|
| `docs/pm-project-charter.md` | Project Charter v1.0 |
| `docs/pm-stakeholder-map.md` | Initial stakeholder map |
| `docs/pm-risk-register.md` | Initial risk register |
| `docs/pm-ba-document-status.md` | State file (created/updated) |
| `plans/reports/pm-{date}-kickoff-brainstorm.md` | Brainstorm evidence |

---

## 5. Next Actions

After kickoff completes, present the following suggestions:
```
Kickoff hoàn tất. Các bước tiếp theo được khuyến nghị:

1. --brd [path]       → Khi có tài liệu BRD từ Bên A, phân tích ngay
2. --meeting pre      → Chuẩn bị agenda cho cuộc họp kickoff chính thức với stakeholders
3. --risk             → Cập nhật thêm risks sau khi có thêm context
4. --status sponsor   → Tạo báo cáo khởi động cho Sponsor/Bên A
```
