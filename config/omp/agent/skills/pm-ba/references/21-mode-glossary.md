# Mode: Domain Glossary

> Reference file for Claude when executing the glossary mode of the pm-ba skill.
> Activated by `--glossary` flag or natural language triggers listed below.

---

## 1. Trigger

**Flag trigger:** `--glossary`

**Natural language triggers (any of the following):**
- "từ điển nghiệp vụ"
- "glossary"
- "domain terms"
- "thuật ngữ dự án"
- "định nghĩa từ ngữ"
- "danh sách thuật ngữ"
- "update glossary"
- "add term to glossary"

**This mode is NOT auto-triggered.** It runs only when explicitly invoked. The glossary is not updated as a side effect of other modes.

---

## 2. Purpose

Maintain `docs/pm-ba-glossary.md` as a living, single-source-of-truth glossary for the [PROJECT] project. This file resolves ambiguity between four groups who use the same words with different meanings:

- **Client ([CLIENT])** — business/regulatory definitions rooted in SBV circulars
- **Vendor (FlexCPC)** — technical definitions tied to system implementation
- **Dev Team** — implementation-level definitions (field names, data types, process states)
- **BA/PM** — process definitions bridging business intent and technical delivery

A shared glossary prevents costly misunderstandings in requirements documents, test cases, and sign-off meetings. When a term is defined here, it is the authoritative definition for all project artifacts.

---

## 3. Workflow Steps

### Step 3a — Scan Existing Glossary

Before any extraction, read `docs/pm-ba-glossary.md` (if it exists). Load all existing terms into a working set to enable de-duplication. If the file does not exist, initialize it from `templates/tpl-glossary.md`.

### Step 3b — Accept Source Documents

The user may provide one or more source documents in any of these ways:
- File path: `--glossary --from docs/requirements/US-001.md`
- Multiple paths: `--glossary --from docs/requirements/ --from docs/meetings/`
- Inline pasted content: User pastes text directly in the prompt
- No source: `--glossary` alone → opens interactive mode to add terms manually

If a directory path is provided, process all `.md`, `.txt`, `.docx`, and `.pdf` files within it.

### Step 3c — Term Extraction (Subagent Prompt)

For each source document, use the following extraction prompt internally:

```
Từ [NỘI DUNG TÀI LIỆU], hãy trích xuất:

1. Thuật ngữ nghiệp vụ chuyên ngành (ngân hàng, quy định pháp luật, quy trình kinh doanh)
2. Từ viết tắt và ký hiệu viết tắt
3. Tên hệ thống (T24, [PROJECT], Core Banking, CIF, v.v.)
4. Thuật ngữ tiếng Việt cần được định nghĩa chính thức

Với mỗi thuật ngữ được trích xuất, cung cấp:
- VN Term: tên tiếng Việt đầy đủ
- EN Equivalent: tương đương tiếng Anh (nếu có)
- Abbreviation: viết tắt (nếu có)
- Definition: định nghĩa bằng tiếng Việt, 1-2 câu, không dùng chính từ đó để định nghĩa
- Usage Example: 1 câu ví dụ sử dụng trong ngữ cảnh dự án
- Source Document: tên/đường dẫn tài liệu nguồn
- Category: banking | process | technical | regulatory | abbreviation | system

Không trích xuất: tên riêng (người, địa danh), số phiên bản, ngày tháng, URL.
```

### Step 3d — De-duplication

After extraction, compare each new term against the existing glossary:

| Condition | Action |
|---|---|
| Exact match (same VN Term, same definition) | Skip — no update needed |
| Same VN Term, different definition | Flag as conflicting — route to Step 3e |
| Same concept, different spelling/form | Flag for human review — suggest canonical form |
| New term not in glossary | Add to queue for insertion |

De-duplication is case-insensitive for the VN Term field.

### Step 3e — Conflict Resolution

When a term has conflicting definitions (new extraction vs. existing glossary):

1. Do NOT auto-merge or auto-overwrite
2. Add the conflict to the `Conflicting Terms (Cần Review)` section of the glossary with status `⏳ Pending`
3. Present both definitions to the user with a clear comparison
4. Ask the user: "Định nghĩa nào là chính xác cho dự án [PROJECT]? (A) [existing] hoặc (B) [new]?"
5. On user confirmation: update the canonical definition, remove from conflicting section
6. If user cannot decide: keep `⏳ Pending` and move on — never block the workflow on glossary disputes

### Step 3f — Alphabetical Sorting

New terms are inserted alphabetically by their VN Term field within the correct letter section (## A, ## B, etc.). If the letter section does not exist, create it. Vietnamese alphabetical order follows standard Vietnamese dictionary order (A Ă Â B C D Đ E Ê G H I K L M N O Ô Ơ P Q R S T U Ư V X Y).

### Step 3g — Update Glossary File

Write all additions and conflict flags to `docs/pm-ba-glossary.md`. Update the "Cập nhật lần cuối" date at the top of the file to today's date (YYYY-MM-DD format). Report a summary:

```
Glossary update complete:
- Terms added: [N]
- Terms skipped (duplicate): [N]
- Conflicts flagged: [N] (see "Conflicting Terms" section)
- Source documents processed: [list]
```

---

## 4. Glossary Schema

The output file `docs/pm-ba-glossary.md` uses this structure:

### Main Terms Table (per letter section)

| Column | Description |
|---|---|
| Thuật Ngữ VN | Full Vietnamese term — canonical spelling |
| EN Equivalent | English translation or equivalent (empty if none) |
| Viết Tắt | Standard abbreviation used in project documents |
| Định Nghĩa | 1-2 sentence definition in Vietnamese |
| Ví Dụ Sử Dụng | One example sentence from a project context |
| Nguồn | Source document where term was first defined |
| Phân Loại | Category: banking / process / technical / regulatory / abbreviation / system |

### Abbreviations Table

Separate table for all abbreviations and acronyms with: Viết Tắt | Đầy Đủ (VN) | EN Full Form | Định Nghĩa Ngắn

### System Terms Table

Separate table for named systems and tools: Tên Hệ Thống | Mô Tả | Nhà Cung Cấp | Interface

### Conflicting Terms Table

Holds terms awaiting human resolution: Term | Definition A | Source A | Definition B | Source B | Resolution

---

## 5. Invocation Policy

| Rule | Detail |
|---|---|
| Manual only | Never auto-trigger from other pm-ba modes |
| Idempotent | Running `--glossary` twice on same document produces same result |
| Non-blocking | Glossary conflicts never block other pm-ba operations |
| Additive only | This mode only adds or flags — never deletes existing terms without explicit user instruction |
| Phase-agnostic | Can be run at any project phase: inception, design, UAT, or post-launch |
| Scope | Always targets `docs/pm-ba-glossary.md` in the current project root |

**Usage examples:**

```bash
# Scan a single requirements doc and extract terms
pm-ba --glossary --from docs/requirements/phase-01-requirements.md

# Scan an entire directory
pm-ba --glossary --from docs/meetings/

# Interactive: add a term manually
pm-ba --glossary
# Claude will ask: "Bạn muốn thêm thuật ngữ nào?"

# Review conflicts only
pm-ba --glossary --conflicts-only
```
