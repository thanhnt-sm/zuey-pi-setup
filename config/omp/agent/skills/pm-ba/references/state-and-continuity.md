# State & Session Continuity

## State Source of Truth

`docs/pm-ba-document-status.md` is the canonical state file for the pm-ba skill. It persists across sessions, tracks all document statuses, and records every mode run. The skill reads it at the start of every mode and writes it back at the end — even on partial failure.

If the file does not exist, create it from `templates/tpl-document-status.md`. If that template also does not exist, create a minimal state file using the schema below.

---

## State Schema

The state file maintains two managed sections plus free-form content:

### `## State Snapshot` (auto-managed by skill)

```markdown
## State Snapshot

- **Last Mode:** --brd
- **Last Run:** 2026-05-17
- **Last Input:** docs/requirements/BRD_v2.docx
- **Last Output:** docs/pm-brd-analysis.md, plans/reports/raw-extract-260517-brd-v2.md
- **Next Recommended Action:** Run --urd on URD_v1.docx to align with BRD findings
- **Active Blockers:** See ## Active Blockers section
```

### Document Tracking Table

```markdown
## Document Registry

| Doc ID | Doc Name | Path | Status | Last Updated | Owner | Notes |
|--------|----------|------|--------|--------------|-------|-------|
| DOC-001 | BRD Module Vay | docs/requirements/BRD_v2.docx | approved | 2026-05-17 | PM | Analyzed; gaps logged |
| DOC-002 | URD Thanh Toan | docs/requirements/URD_TT_v1.docx | in-review | 2026-05-15 | BA | Pending CR-003 resolution |
```

**Status values:** `draft` | `in-review` | `approved` | `outdated` | `superseded` | `partial` (ingest incomplete)

### `## Active Blockers` (auto-managed)

```markdown
## Active Blockers

| Blocker ID | Description | Owned By | Target Date | Status |
|------------|-------------|----------|-------------|--------|
| BLK-001 | URD §4.2 ambiguous — awaiting BA clarification | BA Lead | 2026-05-20 | open |
```

### `## Run History` (append-only log)

```markdown
## Run History

- 2026-05-17: pm-ba ran --brd on BRD_v2.docx → produced pm-brd-analysis.md, raw-extract-260517-brd-v2.md
- 2026-05-16: pm-ba ran --meeting-post on meeting-notes-260516.md → produced pm-260516-meeting-post.md
```

---

## Read Protocol

At the start of every mode run:

1. Read `docs/pm-ba-document-status.md` using the Read tool
2. Extract: last mode, last run date, document statuses for any docs relevant to current mode
3. Check idempotency: if current mode + same input was already run and document is unchanged → log skip and exit (unless `--force` is passed)
4. Extract active blockers that may affect current mode — surface them to the user before proceeding
5. Note any documents with status `outdated` or `superseded` — warn user if the current task depends on them

---

## Write Protocol

At the end of every mode run (success, partial, or error):

1. Update `## State Snapshot`: set last-mode, last-run, last-input, last-output, next-recommended-action
2. Update `## Document Registry`: add new rows for documents created; update status/date for documents modified
3. Append to `## Run History`: one line per mode run in format `- {date}: pm-ba ran {mode} on {input} → produced {outputs}`
4. Update `## Active Blockers`: add new blockers discovered; mark resolved blockers as `resolved`
5. Write the updated file back — do not truncate; only update the managed sections

---

## Resume-from-Previous-Session

When a new session starts without explicit context:

1. Read `docs/pm-ba-document-status.md`
2. Scan `plans/reports/` for most recent pm-ba reports sorted by date prefix: `ls plans/reports/pm-* ba-* | sort -r | head -10`
3. Reconstruct a context summary from: state snapshot + last 3 run history entries + active blockers
4. Present to user:

```
Phiên trước: [mode] chạy ngày [date] trên [input].
Trạng thái: [summary of doc statuses].
Blockers: [active blockers if any].
Hành động tiếp theo được đề xuất: [next-recommended-action].
Tiếp tục từ đây? [Y/n]
```

5. If user confirms → proceed with next recommended action; if user provides new input → route normally via intent detection

---

## Idempotency Check

Before processing any document:

1. Look up the document in `## Document Registry` by path
2. Get the stored `Last Updated` date
3. Compare against current file mtime: `stat -f "%Sm" -t "%Y-%m-%d" "file_path"` (macOS)
4. If mtime matches stored date AND content hash is unchanged → log: `Tài liệu [name] không thay đổi kể từ lần phân tích cuối ([date]). Bỏ qua (dùng --force để xử lý lại).`
5. If `--force` flag present → skip idempotency check and reprocess

---

## IO-Mapping Integration

State file (`pm-ba-document-status.md`) and IO-Mapping (`docs/.pm-ba/io-mapping.json`) are complementary:

| Concern | Source of Truth |
|---------|-----------------|
| Document lifecycle status (draft, approved, ...) | `pm-ba-document-status.md` |
| Input ↔ Output binding + lock state | `docs/.pm-ba/io-mapping.json` |
| Per-document mtime + last analysis date | `pm-ba-document-status.md` |
| Per-mapping version + lock notes + audit | `io-mapping.json` |

### Cross-Reference Protocol

When a mode runs:
1. Read both files
2. If io-mapping says LOCKED + matching input hash → skip (overrides idempotency)
3. If io-mapping says STALE_INPUT → warn user, use state file context to summarize prior decisions

### Mapping Lifecycle Hook

After every mode run that produces output files:
1. Update `pm-ba-document-status.md` (existing protocol)
2. **NEW:** Update or create MAP entry in `io-mapping.json` with status `PENDING_REVIEW`
3. Invoke `AskUserQuestion` to lock or defer
4. On lock: status → `LOCKED`, write to audit.log

See `references/io-mapping-protocol.md` for full lifecycle.

---

## State Update Entry Format

Each run history entry follows this exact format:

```
- {YYYY-MM-DD}: pm-ba ran {mode-flag} on {input-description} → produced {comma-separated output files}
```

Examples:
```
- 2026-05-17: pm-ba ran --brd on BRD_v2.docx → produced docs/pm-brd-analysis.md, plans/reports/raw-extract-260517-brd-v2.md
- 2026-05-17: pm-ba ran --cr on CR-007 (OTP feature) → produced docs/pm-change-request-log.md (updated)
- 2026-05-16: pm-ba ran --meeting-post on meeting 16/5 → produced plans/reports/pm-260516-meeting-post.md
```

---

## Sprint-Zero State Fields

When `--sprint-zero` is active, the following fields are added to `## State Snapshot` in `docs/pm-ba-document-status.md`:

```markdown
- **sprint_zero_active:** true
- **sprint_zero_completed_steps:** [1, 2, 3]
- **sprint_zero_current_step:** 4
- **sprint_zero_input:** "inputs/brd/BRD_ProjectX_v1.docx"
- **sprint_zero_project:** "ProjectX"
- **sprint_zero_deadline:** "2026-06-30"
```

| Field | Type | Description |
|-------|------|-------------|
| `sprint_zero_active` | bool | `true` while orchestration is running; `false` when complete or stopped |
| `sprint_zero_completed_steps` | list | Step numbers completed (e.g., `[1, 2, 3]`); enables partial resume |
| `sprint_zero_current_step` | int | Next step to run on resume (1–6) |
| `sprint_zero_input` | string | Path to the BRD/URD input used at start |
| `sprint_zero_project` | string | Project name slug (for output file naming) |
| `sprint_zero_deadline` | string | Sprint-0 deadline (YYYY-MM-DD or "TBD") |

**Write protocol:** Update these fields at every checkpoint (after each step completes). On final completion (`sprint_zero_current_step` = 7 / all done): set `sprint_zero_active: false`.

---

## Blocking Items

The `## Active Blockers` section prevents progress in dependent modes:

- A blocker on a document blocks `--signoff` for that document
- A blocker tagged `CR-pending` blocks `--trace` updates until CR is resolved
- A blocker tagged `clarification-needed` is surfaced when running `--urd` or `--brd` on the same document
- Blockers are never auto-resolved — they require explicit user action or mode run (e.g., `--clarify` closes a clarification blocker)
- When a blocker is resolved, update its status to `resolved` and append: `(resolved {date} by {mode-or-user})`
