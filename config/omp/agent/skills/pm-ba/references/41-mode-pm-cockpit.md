# Mode: --pm (PM Cockpit Dashboard)

## When It Fires

Trigger conditions (any one sufficient):
- User passes explicit `--pm` flag
- NL phrase matches patterns in `00-intent-routing.md` → `--pm` row
- No args + auto-detect P4 maps to `--pm` (from task description pattern)
- Cold-start heuristic: no args, no NL match, 1-3 words input, state file exists

Pre-requisite: Follow Cross-Cutting Protocol (a) Read State before rendering.

---

## Algorithm: 5-Step State Read → Render

### Step 1 — Read Document Status
File: `docs/pm-ba-document-status.md`
Note: This read satisfies Cross-Cutting Protocol (a) — do NOT re-read this file later in the mode run.
Extract:
- `Phase:` field → current project phase
- `Last Mode Run:` field → last-mode
- Count active P0 blockers from `## Active Blockers` section
- `Sprint:` field if present (else "n/a")
- `Next Recommended Action:` field (use in Suggest row)

### Step 2 — Read Task List (Unblocked Tasks)
File: `docs/pm-ba-master-task-list.md`
Filter: `status ∈ {⏳ Not Started, 🔄 In Progress}` — explicitly exclude `🔒 Blocked`, `✅ Done`, `⚠️ Partial`
Sort: P0 → P1 → P2 (by Priority column); within same priority: by task ID ascending
Take: top 3 qualifying tasks
Extract per task: task-id, title, effort, priority

### Step 3 — Read Bên B Request Tracker
Locate section `## NHÓM 99 – Bên B Request Tracker` in task list file (same read from Step 2 — no extra file read)
Filter: `Status ∈ {sent, draft}`
Sort: overdue first (where SLA Deadline < today), then nearest SLA deadline; undated last
Take: top 3 entries
Extract per entry: Req ID, Yêu cầu (truncated to 35 chars), SLA Deadline, Status

### Step 4 — Read Risk Register (optional)
File: `docs/pm-risk-register.md`
If file does NOT exist → skip silently, set risk_count = "n/a"
If exists: filter `Status = new` AND `Date Added` within last 7 days → count by category
Extract: total new risks count

### Step 5 — Select Suggest from Step 2 Results
Rule: take first entry from Step 2 results where Status = `⏳ Not Started` (skip `🔄 In Progress` — already being worked).
If no Not Started task → take Step 2[0] regardless of status.
Suggest reason = "P0 unblocked" (if P0) or "highest priority unblocked".

### Step 6 — Read Capability Map (Optional)
If `docs/pm-capability-map.md` exists:
- Read § 3 (Capacity Map), check `Last-Updated` field
- If staleness > 30 days: set `capacity_alert = "⚠️ map stale {N}d"`
- Filter rows where `Status = BLOCKED` AND overlap with next 7 calendar days
- Set `blocked_count` = number of such stakeholders
- If file missing: `blocked_count = null`, skip staleness check

### Step 7 — Write-back Bên B Mirror Count (Cross-Cutting Protocol (c))
After rendering the dashboard, update `docs/pm-ba-document-status.md § Bên B Pending Requests`:
- Recount NHÓM 99 rows from Step 3 data (no extra file read — use Step 3 results)
- Update: Total REQs, Sent count, Draft count, Confirmed count, Overdue count
- This keeps the mirror count in sync with NHÓM 99 source of truth.

---

## Dashboard Render Spec

Hard cap: **18 lines terminal output** (excluding separator lines).
Do NOT use markdown tables inside terminal output — use plain text alignment.

```
═══════════════════════════════════════════════════════════════════
 PM COCKPIT — {project} | {date} | Role: PM+BA
═══════════════════════════════════════════════════════════════════
 Phase: {phase}  |  Sprint: {sprint}  |  Tasks: {done}/{total}  |  Blockers: {n} P0

 [HÔM NAY TÔI LÀM]                          [TÔI ĐANG CHỜ]
  1. {task-id}: {title} ({effort})            REQ-{n}: {subject}  ({sla})
  2. {task-id}: {title} ({effort})            REQ-{n}: {subject}  ({sla})
  3. {task-id}: {title} ({effort})            REQ-{n}: {subject}  (chưa gửi)

 [BLOCKERS ESCALATE]   [BÊN B PENDING]      [RISK FLAGS NEW]
  {n} P0 from Bên B     {sent}/{total} sent   {n} new last 7d
  → run --pm --gaps     → run --pm --benb    → run --risk

 Capacity Alert: {blocked_count} stakeholders blocked next 7d {capacity_alert}

 Suggest: {task-id} ({reason}).  Run? [Y/n]
═══════════════════════════════════════════════════════════════════
```

**Field mapping:**
- `{project}` = project name from state file header or "FlexCPC [PROJECT]"
- `{date}` = today's date (YYYY-MM-DD)
- `{phase}` = Step 1 extract
- `{sprint}` = Step 1 extract or "n/a"
- `{done}/{total}` = count rows with `✅ Done` / total task rows in task list
- `{n} P0` = P0 blocker count from Step 1
- `[HÔM NAY TÔI LÀM]` rows = Step 2 top 3 (truncate title to 30 chars)
- `[TÔI ĐANG CHỜ]` rows = Step 3 top 3 (truncate subject to 25 chars)
- `{sent}/{total} sent` = count REQs with Status=sent / total REQ rows
- `{n} new last 7d` = Step 4 count or "n/a"
- `Suggest` = Step 5 result

---

## Sub-commands

### `--pm --detail`
**Phase 2 — defer.**
<!-- Phase 2: expand dashboard to show full task list filtered by phase, all REQ rows, risk detail -->
Stub: "Chi tiết PM cockpit: chưa available — chạy `--sprint` cho task detail, `--risk` cho risk detail."

### `--pm --benb`
**Phase 2 — defer.**
<!-- Phase 2: interactive Bên B request tracker — update REQ status, add new REQ, set SLA dates -->
Stub: "Cập nhật Bên B tracker: chưa available — cập nhật thủ công trong docs/pm-ba-master-task-list.md ## NHÓM 99."

### `--pm --gaps`
**Phase 2 — defer.**
<!-- Phase 2: surface all blocked tasks + their unblock paths (which REQ resolves which block) -->
Stub: "Gap analysis: chưa available — xem docs/pm-ba-document-status.md ## Active Blockers."

---

## Performance Budget

- Max 4 file reads total (Steps 1–6 combined; Steps 1+2 share 1 read via task list dual-use)
- Actual reads: state file (1) + task list (1) + risk register (1, optional) + capability map (1, optional) = max 4 reads
- Budget locked at 4: no further optional reads may be added
- No deep scanning, no subagent spawning
- Target: < 2s wall time

---

## Fallback Rules

| Condition | Behavior |
|-----------|----------|
| No unblocked tasks (all Done or Blocked) | Show: "Không có task khả dụng — kiểm tra blockers (`--pm --gaps`)" in [HÔM NAY TÔI LÀM] rows |
| `## NHÓM 99` section absent from task list | Show: "Chưa có REQ tracker — chạy `--pm --benb` để setup" in [TÔI ĐANG CHỜ] column |
| `docs/pm-risk-register.md` missing | Skip [RISK FLAGS NEW] row, replace with blank line |
| State file missing entirely | Show error: "docs/pm-ba-document-status.md not found. Chạy `--kickoff` để khởi tạo." |
| Fewer than 3 unblocked tasks | Render available rows; pad remaining with "—" |
| Fewer than 3 REQ entries | Render available; pad with "—" |
