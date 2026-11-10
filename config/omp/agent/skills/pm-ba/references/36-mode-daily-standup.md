# Mode: Daily Standup — Team Dev/Test Task Sync

## 1. Trigger

- Flag: `--daily [date]` (date optional, defaults to today)
- Natural language: "họp daily hôm nay", "standup sáng nay", "cập nhật task team", "báo cáo ngày", "team update hôm nay", "daily meeting xong rồi"

---

## 2. Purpose

Lightweight daily sync for dev/test teams. Lighter than `--meeting-post` — no agenda generation,
no risk routing, no CR. Purpose: update task statuses in `docs/pm-ba-master-task-list.md`
from brief standup notes, detect new blockers, surface overdue tasks.

---

## 3. Input Formats

Accept any of these:

**Format A — Per-person standup (structured):**
```
[Tên]: Done: [X] | Doing: [Y] | Blocked: [Z]
```

**Format B — Free-form notes (VN or EN):**
Any text describing task updates, e.g. "An hoàn thành DEV-P01, đang làm DEV-P02, chờ backend"

**Format C — File path:**
Path to standup notes file → ingest per `references/document-ingest-protocol.md`

**Format D — Interactive (no input):**
If no notes provided → `AskUserQuestion` with 3 options: (1) nhập inline, (2) cung cấp file path, (3) view-only mode (xem task P0 + quá hạn, không write).

---

## 4. Extraction Steps

### Step 4a — Read Current Task List
If `docs/pm-ba-master-task-list.md` does not exist → abort: "master-task-list.md not found. Run --kickoff or --sprint first."

Read `docs/pm-ba-master-task-list.md`. Extract:
- All tasks with status `🔄 In Progress` — these are primary candidates for updates
- All tasks with status `⏳ Not Started` that are P0 — surface as reminders
- Any tasks with a past deadline (compare deadline vs today's date)

### Step 4b — Parse Standup Notes
From standup input, extract:
```
For each person:
- TASK_ID references (e.g., "DEV-P01", "BA-T02", "PM-T01") or keyword match
- Status change: Done | In Progress | Blocked | Not Started
- Blocker description (if blocked: what is blocking them, who needs to unblock)
- ETA if mentioned
```

**Keyword → Status mapping:**
| Keywords | Status |
|----------|--------|
| "xong", "done", "hoàn thành", "complete", "finished" | ✅ Done |
| "đang làm", "in progress", "working on", "đang xử lý" | 🔄 In Progress |
| "bị chặn", "blocked", "chờ", "waiting for", "stuck" | 🔒 Blocked |
| "chưa làm", "not started", "chưa bắt đầu", "todo" | ⏳ Not Started |
| "bỏ qua", "skip", "n/a", "không áp dụng" | ❌ Cancelled |

### Step 4c — Fuzzy Task Matching
If standup mentions task by description (not ID):
1. Search master-task-list.md by keyword match in Task column
2. If match found: confirm with user before updating
3. If ambiguous (2+ matches): use `AskUserQuestion` to pick correct task
4. If no match: create a NEW task entry (confirm with user first)

### Step 4d — Present Delta for Confirmation
Before writing, show user the changes:
```
Tôi sẽ cập nhật các task sau trong docs/pm-ba-master-task-list.md:

THAY ĐỔI TRẠNG THÁI:
  [BA-T01] Phân tích BRD → ✅ Done (An xác nhận)
  [DEV-P01] Auto-phân giao T-24 → 🔄 In Progress (Minh đang làm)
  [PM-T01] Confirm go-live date → 🔒 Blocked (chờ Sponsor phản hồi)

BLOCKER MỚI:
  [PM-T01] Blocked by: Sponsor chưa confirm date → Thêm vào Active Blockers không?

TASK QUÁ HẠN (chưa update):
  [BA-T02] URD V01 analysis — P0, Not Started, đáng lẽ bắt đầu từ tuần trước

TASK MỚI (không có trong list):
  "Setup Jira board" (Hùng đề cập) → Tạo task PM-T09? Owner: Hùng, Sprint: 1

Xác nhận? [Y/N/chỉnh sửa]:
```

<!-- KPI-START -->
### Step 4e — KPI Delta Tracking (khi KPI active) — v1.5 Invariant 19 compliant

If `docs/pm-ba-kpi-state-{project_slug}-{current_period}.md` exists (slug derived per loader §3a):

1. Load state file per `references/kpi-standards-loader.md` Load Sequence (Tier 1 only — read-only context)
2. For each task transitioning to ✅ Done in Step 4d confirmation:
   - WRITE `tasks[].status = Done` AND `tasks[].pct = 100` only (Invariant 19 §(d) whitelist)
   - DO NOT write `finished_at`, `bug_fix_days`, `TQ` — these are reserved for `--kpi-track` §3c final sweep (Phase 02 v1.5)
   - Flag transition for next `--kpi-track` resolution: state may carry `pending_bug_fix_resolution[]` listing task IDs awaiting sweep
3. Recompute AP_running = Σ(TP gross of Done tasks) for visibility only
4. Compare AP_running vs `milestones.w{current_week}.target_ap`:
   - Nếu lag > 15% → print warning:
     ```
     ⚠️ AP delta: hiện {AP_running} pts vs milestone tuần {N} = {target_ap} pts ({pct}% gap)
     Đề xuất: chạy /pm-ba --kpi-track để xem signal + bug_fix prompt + TQ compute
     ```
5. **Change detection (v1.5 efficiency fix):** Before any write, diff against current state. If `tasks[]` rows unchanged → SKIP write entirely (preserves `aggregate_cache.refreshed_at`; avoids voiding 6h cache window).
6. If write occurs: invalidate `aggregate_cache.refreshed_at = null` (Write Protocol).

### Step 4e Anti-Pattern
DO NOT prompt bug_fix_days here (moved to `--kpi-track` §3c final sweep). DO NOT write outside whitelist (Invariant 19).
<!-- KPI-END -->

---

## 5. Write Protocol

After user confirmation:

**5a — Update `docs/pm-ba-master-task-list.md`:**
For each task confirmed:
- Update `Trạng thái` column
- Update `Hiện trạng` column with brief note: "Updated [date]: [who] — [brief context]"
- For Done tasks: add completion date in Hiện trạng
- For Blocked tasks: add blocker description in Hiện trạng
- For new tasks: append to appropriate NHÓM section

**IMPORTANT:** Never restructure the file — only update cell values in existing rows or append new rows.

**5b — Update `docs/pm-ba-document-status.md`:**
Follow write protocol in `references/state-and-continuity.md`. Run history entry format:
`- {YYYY-MM-DD}: pm-ba ran --daily on master-task-list.md → updated {N} tasks, produced pm-{YYMMDD}-daily-standup.md`

**5c — Update `docs/pm-ba-output-registry.md`:**
Add daily standup report as new OUT-NNN entry (type: `report`, source: master-task-list.md, mode: --daily). Per Invariant 15, all artifact-producing runs must update the registry.

---

## 6. Output Artifact

Save daily summary to: `plans/reports/pm-{YYMMDD}-daily-standup.md`

Use template: `templates/tpl-daily-standup.md`

---

## 7. View-Only Mode

When user chooses "Chỉ xem task hôm nay":
- Show all `🔄 In Progress` tasks with owner
- Show all `⏳ Not Started` P0 tasks with next-action
- Show all `🔒 Blocked` tasks with blocker description
- Show tasks with overdue deadlines
- No file writes

---

## 8. Overdue Detection

A task is **overdue** if:
- `Trạng thái` = `⏳ Not Started` AND
- `Next Action` column contains a date/sprint reference that has passed, OR
- Task appears in the P0 section and has been Not Started for >5 business days since last --daily run

Surface overdue tasks with: `⚠️ QUÁ HẠN: [task-id] — {days} ngày chưa bắt đầu`

---

## 9. Follow-up Checklist

After daily update:
```
Daily update hoàn tất. Checklist:

□ {N} tasks đã cập nhật trạng thái
□ {N} blockers mới → owners đã được thông báo chưa?
□ {N} tasks quá hạn → cần re-prioritize hoặc re-assign?
□ Lần daily tiếp theo: ngày mai (dùng --daily để cập nhật lại)
□ Nếu có meeting hôm nay → dùng --meeting-post để ghi đầy đủ hơn
```
