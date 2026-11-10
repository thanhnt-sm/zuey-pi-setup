# Mode: Sign-off / Approval Tracking

## 1. Trigger

- Flag: `--signoff <doc> <approver>`
- Natural language: "ký duyệt", "approval xong", "đã được approve", "sign off cho"

---

## 2. Sign-off Log Schema

File: `docs/pm-signoff-log.md`

| Field | Description | Allowed Values |
|-------|-------------|----------------|
| SO-ID | Sequential ID | SO-001, SO-002, ... |
| Document | Document path + display name | `docs/pm-project-charter.md` |
| Version | Document version at time of sign-off | v1.0, v2.0, ... |
| Approver Name | Full name of approver | Free text |
| Approver Role | Role title | Free text |
| Party | Which party | Party A / Party B / Internal |
| Date | Sign-off date | YYYY-MM-DD |
| Method | How approval was given | Email / Meeting / DocuSign / Teams Chat |
| Evidence | Reference to proof | Email subject + date / Meeting minutes ref / DocuSign ID |
| Status | Approval status | Pending / Approved / Rejected |
| Notes | Additional context | Free text |

---

## 3. Workflow Steps

### Step 3a — Collect Sign-off Information
Call `AskUserQuestion`:
```
Để ghi nhận ký duyệt, cần thông tin:
1. Tài liệu nào được ký duyệt? (tên + path)
2. Phiên bản nào? (v1.0, v2.0, ...)
3. Người phê duyệt — tên đầy đủ + vai trò?
4. Thuộc Bên A hay Bên B hay Internal?
5. Phương thức phê duyệt (Email / Họp / DocuSign / Teams)?
6. Bằng chứng — email subject + ngày / meeting minutes ref?
7. Ngày ký duyệt?
```

### Step 3b — Add Row to Sign-off Log
Read `docs/pm-signoff-log.md` → determine next SO-ID (sequential).
If log file doesn't exist: create from `templates/tpl-signoff-log.md`.

Add new row with all collected information and status = `Approved`.

### Step 3c — Update Document Status Register
Update `docs/pm-ba-document-status.md`:
- Find the row for the signed-off document
- Change Trạng Thái column to `Approved`
- Set Người Duyệt column to approver name
- Set Cập Nhật column to today's date

### Step 3d — Mark Document as Protected
**Protection enforcement:** Record in state file that this document is now signed-off.

Add entry to a `signed_off_documents` tracking section in `docs/pm-ba-document-status.md`:
```
## Signed-off Documents (Protected)
| Document Path | Version | SO-ID | Date | Protected Since |
|--------------|---------|-------|------|----------------|
| docs/pm-project-charter.md | v1.0 | SO-001 | YYYY-MM-DD | YYYY-MM-DD |
```

**From this point forward:** Any request to modify this document MUST trigger:
```
"Tài liệu [DOC_NAME] v[VERSION] đã được ký duyệt (SO-[ID] ngày [DATE] bởi [APPROVER]).
 Mọi thay đổi phải đi qua Change Request. 
 Tạo CR bằng lệnh --cr, hoặc cung cấp CR đã approved."
```

### Step 3e — Journal Entry
Invoke `/ck:journal`:
```
Sign-off recorded: [DOC_NAME] v[VERSION] approved by [APPROVER] ([PARTY]).
SO-ID: [SO-ID]. Method: [METHOD]. Evidence: [EVIDENCE].
Document is now protected — changes require CR.
```

---

## 4. Reject Handling

If the approver REJECTED the document:

### Step 4a — Record Rejection
Add row with Status = `Rejected`. Record rejection date and reason.

### Step 4b — Open Clarification Items
For each rejection point raised:
- Add to `docs/pm-clarification-register.md` as a new open question
- Assign to BA for resolution

### Step 4c — Route to Revision
Present to user:
```
Tài liệu [DOC_NAME] bị từ chối bởi [APPROVER].
Lý do: [REASON]

Clarification items đã được thêm vào register.
Bước tiếp theo:
A) --clarify → Xử lý từng rejection point
B) --update  → Cung cấp thêm context để revise tài liệu
C) Xem xét sau
```

**Do NOT** mark document status as `Approved` on rejection — keep as `Draft` or `Rejected`.

---

## 5. Pending Sign-off Tracking

The `docs/pm-signoff-log.md` Pending Sign-offs section must be kept current.

When recording a `Pending` sign-off (approval requested but not yet received):
```
IF status = Pending:
  Add to Pending section with deadline
  Update state file: "Active Blockers: Sign-off pending on [DOC_NAME] from [APPROVER] (deadline: [DATE])"
```

---

## 6. Outputs

| File | Update |
|------|--------|
| `docs/pm-signoff-log.md` | New row added |
| `docs/pm-ba-document-status.md` | Document status + Protected tracking updated |
| `/ck:journal` | Decision recorded |
