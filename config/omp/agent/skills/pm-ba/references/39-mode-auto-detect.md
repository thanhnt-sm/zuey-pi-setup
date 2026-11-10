# Auto-Detect Intelligence

## When It Fires

Pre-pass BEFORE NL intent detection (`00-intent-routing.md` step 1).
Condition: No explicit `--flag` in user input.
Constraint: **Explicit flags ALWAYS bypass auto-detect** (zero regression risk).

---

## Algorithm: Priority Waterfall

### P1 — State File "Next Recommended Action" (Confidence ~90%)

Read `docs/pm-ba-document-status.md` → `"Next Recommended Action:"` field.
If set → use directly.

Surface:
```
Theo trạng thái dự án, hành động tiếp theo: {mode}. Thực hiện không?
```

---

### P2 — Input Filename Pattern (Confidence ~80%)

Map filename patterns → modes:

| Filename contains | Mode |
|-------------------|------|
| "Hop-Dong", "HopDong", "Contract", "hop-dong" | `--contract` |
| "BRD", "Brd", "Yeu-Cau-Nghiep-Vu" | `--brd` |
| "URD", "Urd", "Man-Hinh", "Specification" | `--urd` or `--screen` |
| "Bien-Ban", "Meeting", "Hop-", "Phien-Hop" | `--meeting-post` |
| "UAT-Result", "Ket-Qua-UAT", "Acceptance" | `--acceptance` |
| "Sprint", "Backlog" | `--sprint` or `--backlog` |

---

### P3 — Input Folder Scan (Confidence ~65%)

Load config: `.claude/pm-ba.config.json`
Scan path: `${config.input_root}/${config.input_subfolders.{type}}/`

Scan config-driven input sub-folders vs. existing output registry.

If `${config.input_root}/${config.input_subfolders.contract}/` has files AND no MAP entry for this file in `io-mapping.json`:
```
"Tôi thấy N file trong thư mục contract chưa được phân tích. Chạy --contract không?"
```

If `${config.input_root}/${config.input_subfolders.brd}/` has files AND no row in output registry with `Mode Used = --brd`:
```
"Tôi thấy BRD chưa được phân tích. Chạy --brd không?"
```

If `${config.input_root}/${config.input_subfolders.urd}/` has files AND no row in output registry with `Mode Used = --urd`:
```
"Tôi thấy URD chưa được phân tích. Chạy --urd không?"
```

If `${config.input_root}/${config.input_subfolders.meeting}/` has files newer than last `--meeting-post` run:
```
"Tôi thấy N file biên bản mới chưa xử lý. Chạy --meeting-post không?"
```

If `${config.input_root}/${config.input_subfolders.contract}/` has files AND MAP entry EXISTS in `io-mapping.json`:
Check mtime — if contract file is newer than MAP entry's `output_mtime`:
```
"Có file hợp đồng mới hơn contract map hiện tại. Cập nhật phân tích không? (--contract --force)"
```

---

### P4 — Task List Scan (Confidence ~60%)

Read `docs/pm-ba-master-task-list.md` → find first task where:
- status = `⏳ Not Started` OR status = `🔄 In Progress`
- status ≠ `🔒 Blocked` (blocked tasks skipped — resolve via `--pm --benb` or `--clarify`)
- status ≠ `✅ Done`
- status ≠ `⚠️ Partial`

If no qualifying task found → skip P4, fall through to P5.

Match task description → mode:

| Task description contains | Mode |
|--------------------------|------|
| "Phân tích BRD", "Analyze BRD" | `--brd` |
| "Phân tích URD", "Analyze URD" | `--urd` |
| "Sprint planning", "Lập sprint" | `--sprint` |
| "UAT plan", "Kế hoạch UAT" | `--uat` |
| "Acceptance", "Nghiệm thu" | `--acceptance` |
| "Hợp đồng", "Contract analysis" | `--contract` |
| "PM dashboard", "pm cockpit", "làm gì hôm nay" | `--pm` |

---

### P5 — Doc Status Completeness Signals (Confidence ~40%)

Read `docs/pm-ba-document-status.md` → Document Registry:

| Condition | Suggested Mode |
|-----------|----------------|
| >3 docs in "draft" + BRD "approved" | `--urd` |
| BRD + URD "approved" + no traceability matrix | `--trace` |
| All approved + no UAT plan | `--uat` |
| UAT plan exists + no acceptance cert | `--acceptance` |
| contract input folder has files + no MAP entry in io-mapping.json | `--contract` |

---

## Context Summary Format

Always show before suggesting (regardless of confidence level):

```
---
Trạng thái dự án:
  Phase:    [Kickoff / Analysis / Design / Sprint N / UAT / Go-live]
  Tasks:    [X/Y completed]
  Docs pending: [Z docs chưa xử lý]
  Blockers: [N active]

Gợi ý: {mode} — {reason}
Bạn muốn tiếp tục không? (hoặc cho tôi biết bạn cần gì)
---
```

---

## Fallback

If no signal scores ≥ 40%:
1. Show context summary only (no mode suggestion)
2. Fall through to `00-intent-routing.md` NL phrase matching
3. Invoke `AskUserQuestion` if still ambiguous after NL matching

---

## Performance Budget

- Auto-detect reads max 3 files: state + task list + output registry
- No deep scanning unless P3 is triggered
- P3 scan: `find "${config.input_root}" -type f -size +0c` (one Bash call; excludes 0-byte placeholders; path from pm-ba.config.json)
- Total overhead: < 2s

---

## Integration Point

Called from `00-intent-routing.md` as Step 0 (before all other steps).
Returns: suggested mode + confidence level + context summary.
If confidence ≥ 65%: show summary + suggestion, wait for confirm.
If confidence < 65%: show summary only, fall through to NL matching.
