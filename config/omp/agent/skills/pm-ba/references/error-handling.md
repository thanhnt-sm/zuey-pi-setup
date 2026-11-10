# Error Handling & Recovery

## Failure Modes Table

| Failure | Detected When | Recovery Action | User Action Required |
|---|---|---|---|
| Subagent timeout / error | Subagent returns error or no response after attempt | Retry with smaller chunk (split input in half); after 3 retries → save partial results to `plans/reports/partial-{mode}-{YYMMDD}.md` → log failure → continue with available data | Ask user: continue with partial results or skip this document? |
| markitdown conversion fails | Tool returns error or empty output | Retry once; if still failing → for `.txt`-like files try Read tool directly; log as `unsupported-format` in state; continue with remaining docs | Inform user: "Không thể chuyển đổi [file]. Tiếp tục với các tài liệu còn lại." |
| Missing `/ck:*` skill | Skill not found in system-reminder available-skills list | Use fallback per `skill-routing-fallback.md`; log: `Fallback: [skill] không khả dụng, dùng [alternative]` in output under `## Skill Availability` | None — proceed silently with fallback; mention in output |
| Vietnamese encoding garbled | Converted content contains `á»›`, `Ã`, `Ä'` or similar byte sequences | Run `iconv -f utf-8 -t utf-8 -c "file" > "file-clean"` via Bash → re-read cleaned file | None — auto-recovered; log fix applied |
| Overwrite collision | Existing artifact found at target path with different content | Produce a diff of existing vs new content → invoke `AskUserQuestion` with options: overwrite / merge / save-new-version | Required — must choose before any write |
| CR-without-approval | Mode attempts to set CR status to `propagated` without `approved` first | Hard block — refuse to update; log error: "CR [ID] chưa được phê duyệt. Không thể đặt trạng thái propagated." | User must run `--signoff` or manually set CR to `approved` first |
| File >500KB | File size check before ingest (via `stat` or `wc -c`) | Auto-route to Tier 3 chunked subagent processing per `document-ingest-protocol.md` | None — auto-handled; inform user of chunking |
| Mixed-encoding folder | Folder scan returns files with different encodings | Process each file individually; log per-file success/failure; continue with successfully processed files | Summary of failed files presented at end |
| Path with spaces on macOS | Bash command fails with "No such file" on unquoted path | Always double-quote paths; if Google Drive sync lag suspected → warn user to verify file is fully synced | Warn: "Kiểm tra file đã được đồng bộ Google Drive chưa" |
| State file missing | Read of `docs/pm-ba-document-status.md` returns file-not-found | Create fresh state file from `templates/tpl-document-status.md`; if template missing → create minimal state file with schema from `state-and-continuity.md` | Inform user: "Tạo mới file trạng thái dự án." |
| Privacy block hook triggered | Hook output contains `@@PRIVACY_PROMPT_START@@` JSON marker | Parse JSON from hook output → invoke `AskUserQuestion` with approval question per CLAUDE.md protocol | Required — user must explicitly approve before file is accessed |
| Required slot empty | Mode flag provided but required input (e.g., document path) is absent | Invoke `AskUserQuestion` to request the missing slot; do not proceed without it | Required — provide missing input |
| No files found in folder | `find` returns zero results for provided folder path | Check path validity; verify folder exists with `ls`; suggest correct path to user | Inform user: folder is empty or path is incorrect |
| Partial ingest (chunked failure) | One or more chunks fail during Tier 3 processing | Save successfully processed chunks; mark failed chunks in manifest; synthesize from available chunks only | Inform user which chunks failed; offer to retry failed chunks |

---

## Rollback Protocol

Before overwriting any existing document:

1. **Create backup:** copy existing file to `plans/reports/backup-{YYMMDD}-{original-slug}.md`
   ```bash
   cp "docs/pm-risk-register.md" "plans/reports/backup-260517-pm-risk-register.md"
   ```
2. **Apply the change** to the original path
3. **Log backup location** in state file run history:
   ```
   - 2026-05-17: pm-ba backed up docs/pm-risk-register.md → plans/reports/backup-260517-pm-risk-register.md before --risk update
   ```
4. **If user requests rollback:** restore from backup:
   ```bash
   cp "plans/reports/backup-260517-pm-risk-register.md" "docs/pm-risk-register.md"
   ```
5. **Rollback trigger phrases:** "hoàn tác", "khôi phục", "rollback", "undo last change", "restore previous version"

---

## Partial Success

When a multi-step mode partially completes before an error:

1. **Save progress checkpoint** to `plans/reports/partial-{mode}-{YYMMDD}.md` containing:
   - Steps completed (checked list)
   - Steps not yet run (unchecked)
   - Data processed so far (document names, extracted sections)
   - Error that caused the halt
2. **Update state file** with status `partial` for any documents partially processed
3. **On next invocation** of the same mode:
   - Detect partial file: `ls plans/reports/partial-{mode}-*` sorted by date → take most recent
   - Present to user: "Tìm thấy tiến trình chưa hoàn thành từ [date]. Tiếp tục từ bước [N]? [Y/n]"
   - If yes → skip completed steps, resume from checkpoint
   - If no → start fresh (clear partial file)

---

## Never-Fail Guarantee

pm-ba must never crash silently or leave the user without actionable next steps. In every failure scenario:

1. **Log what happened** — write error description to state file run history
2. **Produce minimum output** — even on total failure, output a plain text summary of: what was attempted, what failed, what partial data was collected
3. **Update state** — set document status to `partial` or add a blocker entry; never leave state inconsistent
4. **Present next steps** — always end with at least one concrete action the user can take:
   - Retry with `--force`
   - Provide a different file path
   - Run a prerequisite mode first
   - Resolve a specific blocker
5. **Never swallow exceptions** — if a tool call fails, capture the error message and include it in the output; do not pretend the step succeeded
