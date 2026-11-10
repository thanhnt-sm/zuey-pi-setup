# Mode: --contract — Contract Analysis

## Trigger

Flag: `--contract`
NL (VN): "phân tích hợp đồng", "đọc hợp đồng", "hop dong", "điều khoản hợp đồng",
          "hợp đồng dự án", "deliverables hợp đồng"
NL (EN): "analyze contract", "contract analysis", "contract clauses", "contract deliverables"
Path: `inputs/contract/` contains files

---

## Required Slots

- `contract_path`: path to contract file (PDF/DOCX) or folder `inputs/contract/`
- `project_slug`: from `docs/pm-ba-document-status.md` (auto-read)

---

## Workflow (9 Steps)

### Step 1 — Read State
- Read `docs/pm-ba-document-status.md`
- Check if contract already analyzed (idempotency) — skip if unchanged (same mtime + hash)
- Extract `project_slug` from state file

### Step 2 — Ingest Contract
- Follow `references/document-ingest-protocol.md` per file extension
- Save raw extract: `plans/reports/raw-extract-{date}-contract-{slug}.md`
- If `inputs/contract/` folder: scan all files, process each per extension routing

### Step 3 — Sequential-Thinking Extraction (5 Passes)
Invoke `/ck:sequential-thinking` with 5 sequential passes:

```
Pass 1: Deliverables — what must be delivered, when, to whom
  Format: { deliverable | milestone | due date | responsible party }

Pass 2: Milestones + Payment Terms — milestone ID, date, payment condition, amount
  Format: { milestone | date | payment condition | amount % | status }

Pass 3: Acceptance Criteria Clauses — specific measurable criteria for sign-off
  Format: { clause ref | criteria text | measurable? Y/N | acceptance threshold }

Pass 4: Penalties + SLA — conditions, consequences, timeframes
  Format: { clause ref | condition | consequence | resolution timeframe }

Pass 5: Scope Boundaries — explicit in-scope and out-of-scope statements
  Format: { in-scope items | out-of-scope items | ambiguous items }
```

### Step 4 — Assign CC-XXX IDs
- Format: `CC-001`, `CC-002`, ... (sequential, not per-sentence — assign per clause/deliverable group)
- If `docs/ba-contract-requirements-map.md` already exists: read last CC-ID → continue numbering (merge, not overwrite)
- Group related sub-clauses under one CC-ID when they form a single logical requirement

### Step 5 — Map CC-XXX → BR-XXX
- If `docs/ba-brd-analysis.md` or `plans/reports/*brd-analysis*` exists:
  - For each CC-XXX: keyword-match against BR descriptions
  - Matched: `CC-001 → [BR-012, BR-015]` — record in mapping table
  - Unlinked: CC-XXX with no BR match → `status: UNLINKED`
- If no BRD analysis exists: mark all CC-XXX as `UNLINKED` (acceptable — BRD may come later)

### Step 6 — Write/Merge docs/ba-contract-requirements-map.md
- Living document — always merge, never overwrite
- Merge key: CC-ID (unique)
- New CC-IDs: append to existing file
- Existing CC-IDs: update description if changed; add history note `(updated YYMMDD)`
- Use template: `templates/tpl-contract-analysis.md`

### Step 7 — Seed Traceability Matrix
- If `docs/pm-traceability-matrix.md` exists: add CC-IDs column for matched BR rows
- If matrix does not exist: record in state file that `CC-XXX seeded — add to matrix when --trace runs`
- Never block on missing matrix — contract analysis stands alone

### Step 8 — Update State File
Record in `docs/pm-ba-document-status.md`:
- `contract_analyzed: YYMMDD`
- `cc_count: N`
- `cc_unlinked_count: N`
- `contract_map_path: docs/ba-contract-requirements-map.md`

### Step 9 — Surface to User
Show summary:
```
Hợp đồng đã phân tích:
  CC count: N clauses identified
  UNLINKED: N (chưa có BR mapping)
  Top 3 acceptance criteria: [list]

Gợi ý tiếp theo:
  → --brd (nếu chưa phân tích BRD) để link CC → BR
  → --trace (nếu BRD đã phân tích) để sync vào traceability matrix
```

---

## Kickoff Integration

When `--kickoff` detects `inputs/contract/` has files:
```
"Tôi thấy N file hợp đồng trong inputs/contract/. Phân tích ngay không?"
```
Wait for confirmation before running. Do NOT auto-run.

---

## Output Files

| File | Type | Notes |
|------|------|-------|
| `plans/reports/raw-extract-{date}-contract-{slug}.md` | Evidence | Raw converted contract text |
| `docs/ba-contract-requirements-map.md` | Living doc | CC-XXX → BR-XXX mapping |
| `docs/pm-ba-document-status.md` | State update | cc_count, cc_unlinked_count |

---

## CC-XXX Format Rules

- ID format: `CC-001`, `CC-002`, ... (three digits, zero-padded)
- Scope: one CC per logical contract clause/deliverable group (not per sentence)
- Living: new contracts or amendments add new CC-IDs (never renumber existing)
- Conflicts: if two contracts define the same clause differently → flag as `CC-CONFLICT`
- Traceability chain position: `CC-XXX → BR-XXX → FR-XXX → US-XXX → AC-XXX → TC-XXX → UAT-XXX`

---

## Template Reference

Output uses: `templates/tpl-contract-analysis.md`
