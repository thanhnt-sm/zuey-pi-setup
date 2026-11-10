# Mode: Incremental Update Dispatcher

## 1. Trigger

- Flag: `--update <context>`
- Natural language: "có thêm thông tin", "cập nhật mới", "update nè", "thêm context này vào"

---

## 2. Classification Logic

Invoke `/ck:ask` to classify the incoming context:

```
Phân tích nội dung/tài liệu sau và phân loại:

[CONTEXT_PROVIDED]

Phân loại vào MỘT hoặc NHIỀU trong các nhóm sau:
A) New document provided (BRD/URD/template/report mới) → cần ingest
B) Document revision (v2 của tài liệu đã có) → cần diff trước
C) New decision made (quyết định từ họp/email) → cần cập nhật charter hoặc minutes
D) New blocker identified (chặn tiến độ) → cần cập nhật state + risk register
E) Scope change (thay đổi phạm vi/yêu cầu) → cần CR
F) Requirement clarification (làm rõ yêu cầu đã có) → resolve question trong clarification register
G) Action item update (cập nhật trạng thái task đã assign) → cập nhật tracking
H) Risk update (risk mới hoặc thay đổi status risk) → route to --risk
I) Task status update from standup/daily notes → route to --daily

Output: classification labels + brief reasoning + recommended routing action
```

---

## 3. Routing Map

| Classification | Route | Action |
|----------------|-------|--------|
| A — New document | `--brd`, `--urd`, or appropriate ingest mode | Ingest and analyze → then cascade query (Step 4e) |
| B — Document revision | `--diff` first → then `--cr` if signed-off | Compare versions → then cascade query (Step 4e) |
| C — New decision | Update meeting minutes or charter | Confirm before writing |
| D — New blocker | Update state file + `--risk` | Add to active blockers |
| E — Scope change | `--cr` mode | Create CR, do not modify docs directly |
| F — Requirement clarification | Clarification register | Resolve open question |
| G — Action item update | Meeting minutes / tracking | Mark item status |
| H — Risk update | `--risk` mode | Update risk register |
| I — Task status update | `--daily` mode | Route directly; do not process as meeting post |

---

## 4. Workflow Steps

### Step 4a — Analyze & Classify
Run classification (Step 2). Present result to user:
```
Tôi phân loại nội dung này là:
- [CLASSIFICATION_A]: [REASONING]
- [CLASSIFICATION_B]: [REASONING] (nếu có nhiều)

Hành động đề xuất:
1. [ACTION_1] — [TARGET_DOC]
2. [ACTION_2] — [TARGET_DOC]

Xác nhận tiến hành không?
```

### Step 4b — User Confirmation
Wait for user confirmation. Do NOT auto-execute routing without confirmation.

### Step 4c — Execute Routing
Delegate to the appropriate mode based on classification:
- If A: Switch to appropriate ingest mode (e.g., --brd)
- If B: Run --diff with old and new versions
- If C: Update specified document (with --cr check if signed-off)
- If D: Update state file Active Blockers + delegate to --risk
- If E: Delegate to --cr mode
- If F: Read clarification register, find matching question, mark resolved with answer
- If G: Update action item status in meeting minutes tracking
- If H: Delegate to --risk mode

### Step 4d — Multi-item Priority Order
When multiple classifications apply simultaneously, process in this order:
1. **CR first** (E) — scope changes must be documented before anything else
2. **Clarifications** (F) — resolve ambiguity before acting on it
3. **Blockers** (D) — update risk visibility
4. **Status updates** (G, H, I) — housekeeping last

### Step 4e — Cascade Query (Types A and B only)
After routing Type A or B: execute cascade query per `references/37-output-registry.md` § Read Protocol.
If `docs/pm-ba-output-registry.md` does not exist → skip, log: "Output registry not initialized; run --state to create it."

---

## 5. State File Update

After routing is complete, update `docs/pm-ba-document-status.md`:
```
Last Mode Run: update
Last Run Date: [TODAY]
Active Blockers: [updated if D was routed]
Next Recommended Action: [derived from routing result]
```
