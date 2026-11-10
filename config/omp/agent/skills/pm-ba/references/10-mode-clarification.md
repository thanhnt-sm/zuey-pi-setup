# Mode: Clarification Questions Register

## 1. Trigger

Activated when:
- CLI flag `--clarify` is provided (view/manage register)
- CLI flag `--clarify Q-XXX [answer]` (resolve a specific question)
- Natural language: "câu hỏi cần làm rõ", "open questions", "clarification", "hỏi khách hàng", "questions for client"
- **Auto-triggered internally by**: modes 02 (BRD), 03 (URD), 07 (Data Model), 08 (API Contract) when ambiguities are detected

## 2. Living Register

The clarification register is a **single, never-timestamped file** that is always updated in-place:

```
plans/reports/pm-ba-clarification-register.md
```

**Important rules:**
- Never create a new file for each session — always update the same file
- De-duplicate before adding: check if similar question already exists
- Sort by: Priority (P1 first) → Status (Open before Awaiting before Answered) → Source mode
- When file does not exist yet: create it with the header template below

## 3. Question Schema

Each question entry uses this schema:

| Field | Description |
|-------|-------------|
| **Q-ID** | Q-XXX (sequential, never reuse IDs even if deleted) |
| **Source** | Which mode/document generated it (e.g. "BRD Analysis - Section 3.2") |
| **Category** | Business Rule / Data / Process / Technical / Legal / UI |
| **Question (VN)** | The question in Vietnamese |
| **Impact** | If unanswered: what deliverable is blocked or incorrect |
| **Priority** | P1 (blocks implementation) / P2 (important but not blocking) / P3 (nice to know) |
| **Directed To** | Client (bên A) / nhà cung cấp (bên B) / Internal (Dev/BA team) |
| **Status** | Open / Awaiting (sent, waiting for reply) / Answered / Wont-Fix |
| **Answer** | The answer received (fill when answered) |
| **Answered By** | Name + date of person who answered |
| **Hypothesis-Status** | FACT / INFERRED / ASSUMED / null (set when Q was auto-created from hypothesis pack) |
| **Validated-In** | meeting-{date} / cr-{id} / signoff-{date} / null (filled when hypothesis confirmed) |

## 4. Workflow

### When triggered internally (from modes 02, 03, 07, 08):

1. Receive list of ambiguity items from the calling mode
2. Read existing `plans/reports/pm-ba-clarification-register.md`
3. For each new item:
   a. Check for duplicates (semantic similarity, not just exact match)
   b. If duplicate found: note the source reference in the existing entry instead of adding new
   c. If new: assign next Q-ID, fill all fields, add to register
4. Sort register: P1 Open → P1 Awaiting → P2 Open → P2 Awaiting → P3 Open → Answered
5. Save updated register to disk
6. Return list of new Q-IDs to calling mode

### When triggered directly (`--clarify`):

1. Read register
2. Display summary:
   ```
   Clarification Register Summary:
   - P1 Open: {N} | P1 Awaiting: {N}
   - P2 Open: {N} | P2 Awaiting: {N}
   - P3 Open: {N}
   - Answered: {N} | Wont-Fix: {N}
   Total: {N} questions
   ```
3. Show full register table grouped by Priority + Status
4. Offer actions:
   - "Tạo email gửi Client (bên A)"
   - "Tạo email gửi nhà cung cấp (bên B)"
   - "Mark questions as Awaiting (đã gửi)"
   - "Resolve a question: --clarify Q-XXX [answer]"

### When resolving (`--clarify Q-XXX [answer]`):

1. Find Q-XXX in register
2. Mark as Answered, fill Answer and Answered By fields
3. Check impact: does this answer affect any existing FR/US/AC?
   - If FR-XXX is impacted: note in FR table in BRD analysis report
   - If US-XXX is impacted: note in US table in URD analysis report
   - If Data Model is impacted: trigger update in `docs/ba-data-model.md`
4. Update `docs/pm-ba-document-status.md`: increment resolved count
5. Check if any other Open questions are now unblocked by this answer

## 5. Stakeholder Email Templates

### Vietnamese Formal Template (for Client / Bên A):

```
Subject: [Tên dự án] - Danh Sách Câu Hỏi Cần Làm Rõ — [Module] — [YYYY-MM-DD]

Kính gửi [Tên/Chức danh],

Trong quá trình phân tích tài liệu [tên tài liệu], nhóm phân tích có một số điểm cần 
được làm rõ để đảm bảo tài liệu đặc tả phản ánh đúng yêu cầu nghiệp vụ.

Kính nhờ Quý [Công ty/Phòng ban] xem xét và phản hồi các câu hỏi dưới đây 
trước ngày [deadline].

---
DANH SÁCH CÂU HỎI CẦN LÀM RÕ:

[Paste Q-XXX bảng from register for Client-directed questions]

---
Hướng dẫn trả lời:
- Vui lòng trả lời trực tiếp vào email này hoặc điền vào file đính kèm
- Ghi rõ họ tên và ngày trả lời cho từng câu hỏi
- Trường hợp cần thảo luận thêm, vui lòng liên hệ [BA name] qua [contact]

Xin chân thành cảm ơn sự hợp tác của Quý [Công ty/Phòng ban].

Trân trọng,
[BA Name]
[Title] | [Project Name]
[Email] | [Phone]
```

### Technical Template (for External Provider / Bên B):

```
Subject: [Project Name] - API/Integration Clarification Questions — [Module] — [YYYY-MM-DD]

Hi [Name/Team],

During integration specification analysis for [project name], we have identified 
the following open items that require clarification from your side.

Please review and respond by [deadline].

---
OPEN ITEMS:

[Paste Q-XXX table for provider-directed questions — EN version]

---
Please indicate for each item:
- Your answer or the correct specification
- If the specification needs to be updated, please provide the updated version
- If additional discussion is needed, please suggest a meeting time

Thank you for your support.

Best regards,
[BA Name]
[Title] | [Project Name]
[Email]
```

## 6. Register File Template

When creating the register for the first time:

```markdown
# Clarification Questions Register — {Project Name}
**Cập nhật lần cuối:** YYYY-MM-DD
**Tổng số câu hỏi:** 0 (0 Open, 0 Awaiting, 0 Answered)

## Summary
| Priority | Open | Awaiting | Answered | Wont-Fix |
|----------|------|----------|----------|----------|
| P1 | 0 | 0 | 0 | 0 |
| P2 | 0 | 0 | 0 | 0 |
| P3 | 0 | 0 | 0 | 0 |

## Questions

| Q-ID | Source | Category | Question (VN) | Impact | Priority | Directed To | Status | Answer | Answered By | Hypothesis-Status | Validated-In |
|------|--------|----------|--------------|--------|----------|-------------|--------|--------|-------------|-------------------|--------------|

## Change Log
| Date | Action | Q-IDs Affected |
|------|--------|----------------|
| YYYY-MM-DD | Initial creation | — |
```

## 7. Resolution Impact Check

When Q-XXX is resolved, check these downstream artifacts:

| Answer affects | Action |
|---------------|--------|
| Business Rule clarified | Update BR table in BRD analysis + any FR that references this BR |
| Data field defined | Update entity attributes in `docs/ba-data-model.md` |
| Screen behavior clarified | Update `docs/ba-screen-spec.md` for affected SC-XXX |
| API field/contract clarified | Update `docs/ba-api-contract.md` for affected API-XXX |
| Process step clarified | Update process flow diagram in relevant analysis report |
| Scope change | Flag for PM mode — may require change request |
