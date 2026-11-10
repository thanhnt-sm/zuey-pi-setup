# Mode: Meeting — Pre-brief & Post-minutes

## 1. Trigger

- Flags: `--meeting-pre [topic]` or `--meeting-post [notes/path]`
- Natural language: "vừa họp xong", "chuẩn bị họp", "meeting xong rồi", "lên agenda họp"
- **Note:** For brief daily standups (≤15 min, team dev/test task updates only) → route to `--daily` instead. Use `--meeting-post` for substantive meetings that produce decisions, risks, or requirement changes.

---

## 2. Sub-mode PRE

### Purpose
Generate a structured meeting agenda based on open project state.

### Step 0 — Hypothesis Pre-pass

Dependency matrix:
| Step | Inputs | Outputs | Depends On |
|------|--------|---------|------------|
| 0.1 | none | doc-status scan | — |
| 0.2 | none | clarification scan | — |
| 0.3 | none | BA-analysis scan | — |
| 0.4 | none | capability-map scan | — |
| 0.5 | 0.1+0.2+0.3+0.4 | hypothesis list | 0.1-0.4 |
| 0.6 | 0.5 | hypothesis pack file | 0.5 |

Run 0.1–0.4 PARALLEL (see `references/44-parallel-protocol.md`). Run 0.5–0.6 sequential.

Scan sources (read-only, skip if missing):
- `docs/pm-ba-document-status.md` → recent decisions, active blockers
- `docs/ba-clarification-register.md` → P1/P2 Open questions matching topic keyword
- `docs/ba-brd-analysis.md`, `docs/ba-urd-analysis.md` → ambiguity entries matching topic
- `docs/pm-capability-map.md` → attendees with expertise matching topic

For each item found, generate hypothesis row — enforce H1-H6:
- H1: Stated in signed doc → FACT (require `source: doc § section`)
- H2: Derived from FACT + domain logic → INFERRED (state derivation)
- H3: No evidence → ASSUMED (auto-create Q-XXX in clarification register)
- H4: Never label INFERRED as FACT
- H5: Each ASSUMED row must have Q-XXX before pack saved
- H6: FACT rows must cite `doc-name § section`

Auto-promote ASSUMED: create Q-XXX in `docs/ba-clarification-register.md` (check duplicates first).
Save: `plans/reports/hypothesis-pack-{YYMMDD}-{slug}.md`
Pack frontmatter: `evidence-tier-summary: {FACT: N, INFERRED: N, ASSUMED: N}`
If no artifacts → empty pack (all zeros) → proceed without error.

### Input Collection
Read state file `docs/pm-ba-document-status.md` to extract:
- Open questions from clarification register (`docs/pm-clarification-register.md` if exists)
- Recent decisions pending stakeholder confirmation
- Pending sign-offs (`docs/pm-signoff-log.md` if exists)

Then call `AskUserQuestion`:
```
Chuẩn bị agenda họp — cần thêm thông tin:
1. Chủ đề họp (Meeting topic)?
2. Danh sách tham dự (attendees) — tên và vai trò?
3. Ngày giờ họp?
4. Thời lượng dự kiến (phút)?
```

### Agenda Generation
Invoke `/ck:ask` with:
```
Tạo agenda cho buổi họp [TOPIC] với [ATTENDEES]:
- Open questions từ clarification register: [LIST — or "Không có"]
- Decisions pending: [LIST — or "Không có"]
- Sign-offs pending: [LIST — or "Không có"]
- Duration: [TIME] phút
- Hypothesis Pack (nếu có): FACT → slot 1-2 phút xác nhận, INFERRED → 3-5 phút drill-down, ASSUMED → 5-10 phút quyết định

Yêu cầu format:
1. Numbered agenda items
2. Time allocation cho mỗi item (phút)
3. Owner của mỗi agenda item
4. Expected outcome (decision / information / discussion)

Output: VN language, professional tone
```

### Output
Save agenda to `plans/reports/pm-{date}-meeting-agenda-{slug}.md`.
Save hypothesis pack to `plans/reports/hypothesis-pack-{YYMMDD}-{slug}.md`.

Present agenda to user and offer to adjust before finalizing.

---

## 3. Sub-mode POST

### Purpose
Extract structured information from raw meeting notes and route to affected documents.

### Input Acceptance
Accept notes in either format:
- **Inline text**: User pastes notes directly into the conversation
- **File path**: User provides path to notes file → ingest per `references/document-ingest-protocol.md`

### Extraction
Invoke `/ck:sequential-thinking` with:
```
Từ meeting notes dưới đây, thực hiện tuần tự:

[MEETING_NOTES]

Bước 1 — Extract Decisions Made:
  Format: { nội dung quyết định | người quyết định | ngày hiệu lực }

Bước 2 — Extract Action Items:
  Format: { nội dung | người phụ trách | deadline }

Bước 3 — Extract Open Issues / Questions chưa giải quyết:
  Format: { vấn đề | người xử lý | next step }

Bước 4 — Extract Risks mới được nhắc đến:
  Format: { mô tả risk | likelihood estimate | impact estimate }

Bước 5 — Extract Changes to requirements được thảo luận:
  Format: { nội dung thay đổi | scope: BRD/URD/FR | ảnh hưởng }

Output tất cả bước trong một response, phân mục rõ ràng.
```

### Bước 6 — Phát Hiện Thay Đổi Yêu Cầu + Đề Xuất Hành Động

Run after sequential-thinking extraction, before saving evidence.

**a. Q-XXX auto-close (AUTOMATIC — no confirm needed):**
For each Q-XXX in `docs/ba-clarification-register.md`:
If meeting minutes contain a clear answer for Q-XXX → mark status = `ANSWERED`
Record source: `(biên bản ngày {date}, section {section})`

**b. FR/BR change detection (ADVISORY — require user confirm):**
Keyword-match decision content against FR descriptions in BRD analysis.
If match found:
```
"Tôi thấy quyết định liên quan đến FR-{id}: {excerpt}. Tạo Change Request không?"
```
If user confirms → route to `--cr` with FR-IDs listed.
Do NOT auto-create CR.

**c. New BR candidates (ADVISORY — user reviews):**
If detect new business rule (pattern: "yêu cầu", "phải", "bắt buộc", "rule", "must", "shall"):
Flag in minutes: `⚠️ New BR candidate: {text} — confirm with --brd --force`

**d. Action items → task list:**
For each action item with FR/US reference: apply Impact Routing rules below (same as action items without Task ID row).

**e. Hypothesis pack reconciliation (AUTOMATIC):**
If hypothesis pack exists for this meeting (match by date + topic slug in `plans/reports/`):
- For each H# row: scan meeting notes for outcome → update `evidence-tier-summary` frontmatter
- ASSUMED → FACT promotions: mark Q-XXX ANSWERED with meeting ref in clarification register
- FACT → falsified: flag ⚠️ Falsified FACT — suggest `--cr` creation
- Update pack file in-place (NOT versioned)

### Save Evidence
Save extracted output to `plans/reports/pm-{date}-meeting-minutes-{slug}.md` using `templates/tpl-meeting-minutes.md`.

### Impact Routing
After extraction, present impact routing to user for confirmation before ANY document update:

```
Từ meeting notes, tôi xác định các actions sau:

DECISIONS:
- [Decision 1] → Ảnh hưởng: [Charter/Scope/None] — Cập nhật không?

ACTION ITEMS:
- [Action 1] → Owner: [name], Deadline: [date] — Thêm vào tracking không?

OPEN QUESTIONS:
- [Q1] → Thêm vào clarification register không?

RISKS:
- [Risk 1] → Thêm vào risk register không?

REQUIREMENT CHANGES:
- [Change 1] → Cần tạo Change Request (--cr). Tiến hành không?

Xác nhận từng mục (Y/N) hoặc "Tất cả Yes":
```

**RULE: Do NOT auto-update any document without explicit user confirmation.**

**KPI Lock Check (Phase 04 v1.6 — applies to this mode ONLY per RT-3):**
Before ANY write to `docs/pm-ba-master-task-list.md`:
```
Read master-task-list frontmatter.kpi_locked
IF kpi_locked == current_period:
  AskUserQuestion:
    question: "Task list locked for KPI sprint {period}. Action?"
    options:
      [Skip mutation, log warning]
      [Unlock via --kpi-unlock + retry]
      [Open --cr for scope change]
```

### Routing Rules (after user confirmation)
| Extracted Item | Route To | Mode |
|----------------|----------|------|
| Decision affecting scope/charter | Update `docs/pm-project-charter.md` (requires --cr if signed-off) | Confirm |
| Open question | Add to `docs/ba-clarification-register.md` | Confirm |
| New risk | Route to `--risk` mode → update `docs/pm-risk-register.md` | Confirm |
| Requirement change | Route to `--cr` mode — do NOT modify docs directly | Confirm |
| Action item with Task ID reference | Update `docs/pm-ba-master-task-list.md` → **check KPI lock first (Phase 04 v1.6)** → set status, owner, deadline | Confirm |
| Action item without Task ID | Add to meeting minutes doc + ask: "Tạo task mới không?" | Confirm |
| Task status update (Done/In Progress/Blocked) | Update `docs/pm-ba-master-task-list.md` directly | Auto |
| Q-XXX closed in meeting | Mark ANSWERED in `docs/ba-clarification-register.md` | Auto |
| FR change detected | Present `--cr` candidate with FR-IDs | Confirm |
| New BR identified | Flag in minutes as BR candidate | User reviews |

---

## Pre-Meeting SOP

Guidance for PM/BA to follow before running `--meeting-pre`. AI generates the checklist — execution is by the human PM/BA.

### Recommended Pre-Steps

Before running `--meeting-pre`, prepare context:

- **If BRD/URD exists:** run `--brd --quick` or `--urd --quick` first to have a summary + must-clarify questions as input for hypothesis generation
- **If no BRD/URD:** prepare an assumption list (3-5 bullet points on scope, cost, complexity) to feed into hypothesis generation
- **Always:** review open Q-XXX items in `docs/ba-clarification-register.md` before the meeting

### 48h Action Checklist

AI populates this checklist in the `--meeting-pre` output based on meeting context:

```
## 48h Action Checklist

**T-48h**
- [ ] Chạy `--brd --quick` hoặc `--urd --quick` → nhận one-page summary + must-clarify questions
- [ ] Chuẩn bị ≥3 giả thuyết scope/cost/complexity dựa trên BRD/URD output (hoặc assumption list nếu không có doc)
- [ ] Kiểm tra open Q-XXX trong docs/ba-clarification-register.md — ưu tiên P1/P2

**T-2h**
- [ ] Gửi one-page summary và agenda cho team nội bộ để review
- [ ] Xác nhận số lượng attendees và format họp (online/offline)

**T-0 (tại buổi họp)**
- [ ] Mang backlog + AC để sửa trực tiếp với khách nếu cần
- [ ] Xác nhận tool policy: KHÔNG paste PII nếu dùng public AI tool trong meeting (xem Invariant #14)
```

### Context-Adaptive Rules

AI adjusts the checklist based on meeting context:

| Context | Adjustment |
|---------|-----------|
| Không có BRD/URD | Bỏ T-48h item #1; thay bằng "soạn assumption list (scope / cost / complexity)" |
| Họp online | Thêm T-0 item: "Test screen share + confirm paste tool policy" |
| Số attendees > 5 | Thêm T-2h item: "Assign note-taker và timekeeper" |
| Cuộc họp quyết định (decision meeting) | Thêm T-48h item: "Gửi pre-read materials ít nhất 24h trước" |

**Privacy note:** Xem Invariant #14 về data handling khi dùng AI tools trong meeting. Không paste PII của khách hàng hoặc credentials vào AI tool công cộng.

---

## 4. Outputs

| Sub-mode | Output Files |
|----------|-------------|
| PRE | `plans/reports/pm-{date}-meeting-agenda-{slug}.md` |
| POST | `plans/reports/pm-{date}-meeting-minutes-{slug}.md` + routed updates (with confirmation) |

---

## 5. Follow-up Checklist

After POST minutes are saved, present:
```
Meeting minutes đã lưu. Checklist tiếp theo:

□ Gửi minutes cho tất cả attendees (copy path: plans/reports/pm-{date}-meeting-minutes-{slug}.md)
□ [X] action items đã được assign — nhắc nhở owners nếu cần
□ [X] open questions → đã thêm vào clarification register
□ [X] risks mới → đã cập nhật risk register
□ [X] requirement changes → CR đã được tạo / cần xử lý
□ Lên agenda cho cuộc họp tiếp theo (--meeting pre)
```
