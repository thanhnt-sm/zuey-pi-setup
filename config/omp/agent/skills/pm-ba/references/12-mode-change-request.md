# Mode: Change Request Lifecycle

## 1. Trigger

- Flag: `--cr <description>`
- Natural language: "change request", "thay đổi BRD", "cần CR cho", "scope thay đổi"

---

## 2. CR Schema

| Field | Description | Allowed Values |
|-------|-------------|----------------|
| CR-ID | Sequential ID | CR-001, CR-002, ... |
| Date | Creation date | YYYY-MM-DD |
| Requested By | Requester name + role | Free text |
| Description | What needs to change | Free text |
| Affected Documents | Specific doc IDs | BR-XXX, FR-XXX, US-XXX, etc. |
| Impact Summary | Count of FR/US/TC/UAT items affected | "3 FR, 2 US, 5 TC" |
| Risk | Risk level + rationale | H/M/L + explanation |
| Priority | Business priority | P1 (urgent) / P2 (important) / P3 (nice-to-have) |
| Status | Lifecycle state | open → impact-assessed → approved → propagated → closed |
| Approved By | Approver name + date | Free text |
| Notes | Additional context | Free text |

---

## 3. Lifecycle Enforcement Rules

**HARD BLOCK — enforce without exception:**

```
RULE 1: Cannot set status = "propagated" unless status is currently "approved"
  Error: "CR không thể chuyển sang propagated khi chưa được approved. 
          Vui lòng xác nhận approval trước."

RULE 2: Cannot modify a signed-off document without an open CR with status >= "approved"
  Error: "Tài liệu [DOC_NAME] đã được ký duyệt (v[VERSION]).
          Mọi thay đổi phải đi qua Change Request.
          Tạo CR mới (--cr) hoặc sử dụng CR-[ID] đã approved."

RULE 3: CR-ID must be sequential — read existing log before assigning
  Error: "CR-ID [X] đã tồn tại. ID tiếp theo là CR-[X+1]."
```

---

## 4. Workflow Steps

### Step 4a — Collect CR Information
Call `AskUserQuestion`:
```
Để tạo Change Request, cần thông tin:
1. Mô tả thay đổi cần thực hiện?
2. Người/bộ phận yêu cầu thay đổi (tên + vai trò)?
3. Tài liệu/khu vực nào bị ảnh hưởng (BRD, URD, FR, TC...)?
4. Mức độ ưu tiên (P1/P2/P3)?
```

### Step 4b — Impact Analysis

Dependency matrix (see `references/44-parallel-protocol.md`):
| Sub-step | Outputs | Depends On |
|----------|---------|------------|
| Bước 1 (doc impact) | affected docs | CR description |
| Bước 2 (stakeholder) | notify list | CR description |
| Bước 3 (timeline) | time estimate | CR description |
| Bước 4 (risk) | risk assessment | CR description |
| Bước 5 (dependencies) | dep list | Bước 1+2+3+4 |

Bước 1-4 parallel. Bước 5 sequential after batch.

Invoke `/ck:sequential-thinking` with:
```
Change Request mới:
Mô tả: [DESCRIPTION]
Khu vực ảnh hưởng: [AFFECTED_AREA]

Phân tích tuần tự:

Bước 1 — Documents bị ảnh hưởng:
  List tất cả docs (BR/FR/US/AC/TC/UAT) cần thay đổi.
  Với mỗi doc: mô tả cụ thể thay đổi cần làm.

Bước 2 — Stakeholders cần notify:
  Ai cần biết về CR này? (Party A owners, dev leads, QA, BA)

Bước 3 — Timeline impact:
  Estimate thời gian implement CR này.
  Ảnh hưởng đến sprint/milestone nào?

Bước 4 — Risk của CR này:
  Rủi ro khi implement: technical, regression, UAT.
  Rủi ro khi KHÔNG implement.

Bước 5 — Dependencies:
  CR này phụ thuộc vào CR/task nào khác không?

Output: VN language, structured, actionable
```

### Step 4b1 — Authority Routing via Capability Map (Optional)
If `docs/pm-capability-map.md` exists:
- Read § 2 (Authority Map), match CR scope against `Decision Type` rows
- Identify correct approver; set `Approved By` candidate in CR schema
- If matched authority row has `evidence-tier = ASSUMED`:
  ```
  ⚠️ Authority ASSUMED: approver for this CR scope not confirmed in contract/RACI.
  Recommended: verify with PM before presenting for sign-off.
  ```
- If no matching Decision Type found → flag for PM to manually assign approver

### Step 4c — Add to CR Log with status "open" → "impact-assessed"
Create entry in `docs/pm-change-request-log.md` using `templates/tpl-change-request.md`.
If log file doesn't exist: create it.

CR starts with status `open`, then transitions to `impact-assessed` after Step 4b completes.

### Step 4d — Present Impact Summary & Await Approval Decision
Present to user:
```
CR-[ID] Impact Assessment:

Tài liệu bị ảnh hưởng: [COUNT] tài liệu
  - [DOC_1]: [CHANGE_DESCRIPTION]
  - [DOC_2]: [CHANGE_DESCRIPTION]

Timeline impact: [ESTIMATE]
Risk level: [H/M/L] — [RATIONALE]
Stakeholders cần notify: [LIST]

Quyết định:
A) Approved — Tiến hành propagate thay đổi
B) Rejected — Đóng CR, giữ nguyên tài liệu
C) Defer — Giữ status pending, quyết định sau
```

### Step 4d-kpi — KPI Append-Only Hook (v1.5 Phase 03)

If `docs/pm-ba-kpi-state-{project_slug}-{period}.md` exists AND CR scope affects sprint EP:

1. Estimate EP delta:
   - Added scope: `+Σ(TP_added)` per affected task TP estimate
   - Removed scope: `-Σ(TP_removed)`
   - Net delta → number with sign
2. Compute `expires_at = today + 30 days` (decision Q3.2)
3. Append to `kpi_state.ep_history_pending[]` (append-only, never mutate prior entries):
   ```yaml
   - cr_id: "{CR-ID}"
     timestamp: "{now ISO}"
     reason: "{CR description, ≤120 chars}"
     delta: {signed_int}
     status: pending_approval
     created_by: "{PM name from state or 'PM'}"
     expires_at: "{today + 30d}"
   ```
4. Print: "✓ CR {CR-ID} appended to ep_history_pending (delta {delta:+d}). Approval prompt next --kpi-track."
5. Do NOT modify `ep_monthly_capacity`, `ep_cumulative_through_period`, or `milestones` — Invariant 19 reserves those for --kpi-plan / --kpi-replan / --kpi-track approval flow.

**Invariant 19 v1.5 amendment:** `--cr` is permitted writer to `ep_history_pending[]` only (append-only). `--kpi-track` preamble §3a-pre is the only path that promotes pending → ep_history[] + EP mutation.

### Step 4e — If Approved: Propagate Changes
```
IF user selects Approved:
  1. Update CR status → "approved" (record approver name + date)
  2. For each affected document:
     a. Check if document is signed-off → if yes, add signed-off bypass note referencing this CR
     b. Make the specified changes
     c. Bump version: major version increment (v1.x → v2.0)
     d. Add version note: "Updated per CR-[ID] — [DATE]"
  3. Update traceability matrix: link CR-ID to affected BR/FR/US/TC items
  4. Update CR status → "propagated"
  5. Update state file: Last Mode Run = cr, note CR-[ID] closed
  6. Invoke /ck:journal:
     "CR-[ID] approved and propagated. [COUNT] documents updated. 
      Approved by: [APPROVER]. Affected: [DOC_LIST]."
```

### Step 4f — If Rejected:
```
IF user selects Rejected:
  1. Record rejection + reason in CR log
  2. Update CR status → "closed" (rejected)
  3. NO document changes
  4. Invoke /ck:journal: "CR-[ID] rejected by [APPROVER]. Reason: [REASON]."
```

---

## 5. Version Bump Convention

Document version format: `v{major}.{minor}`

| Change Type | Version Bump |
|-------------|-------------|
| Approved CR (scope/content change) | Major: v1.2 → v2.0 |
| Minor editorial / typo fix | Minor: v1.0 → v1.1 |
| Initial draft | v1.0 |
| Post-approval revision | v1.0 → v1.1 |

---

## 6. CR Log File Structure

`docs/pm-change-request-log.md` format:

```markdown
# Change Request Log — [Project Name]

| CR-ID | Date | Requested By | Description | Affected Docs | Risk | Priority | Status | Approved By |
|-------|------|-------------|-------------|--------------|------|---------|--------|-------------|
| CR-001 | | | | | | | | |
```

Full CR details in individual files: `plans/reports/cr-{date}-{id}-{slug}.md`
