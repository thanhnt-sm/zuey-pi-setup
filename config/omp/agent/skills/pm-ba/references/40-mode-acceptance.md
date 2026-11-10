# Mode: --acceptance — Acceptance Certification

## Trigger

Flag: `--acceptance`
NL (VN): "kết quả UAT", "nghiệm thu", "báo cáo chấp nhận", "acceptance certification",
          "chứng nhận nghiệm thu", "tổng hợp UAT"
NL (EN): "acceptance certification", "UAT results", "sign-off report", "acceptance report"

---

## Required Slots

- `uat_results_path`: UAT results file or inline text (required)
- `certification_date`: defaults to today if not provided

---

## Prerequisites

- `docs/pm-traceability-matrix.md` — **mandatory** (must have TC-XXX → AC-XXX links)
- `docs/ba-contract-requirements-map.md` — optional; adds CC-XXX level if present

---

## Workflow (9 Steps)

### Step 1 — Read State + Load Traceability Matrix
- Read `docs/pm-ba-document-status.md`
- Load `docs/pm-traceability-matrix.md` (full chain source)
- Check if `docs/ba-contract-requirements-map.md` exists → set `has_contract` flag
- If traceability matrix missing → BLOCKED: "Cần --trace trước khi chạy --acceptance"

### Step 2 — Load Contract Map (if exists)
- If `has_contract = true`: read `docs/ba-contract-requirements-map.md`
- Build lookup table: `CC-XXX → [BR-XXX, ...]`
- Note: if not present, report covers BR-XXX → UAT-XXX chain only

### Step 3 — Parse UAT Results
From `uat_results_path` (ingest per `references/document-ingest-protocol.md`):
For each UAT test entry, extract:
- `UAT-ID` (format: UAT-001, UAT-002...)
- Description
- Status: `Passed` / `Failed` / `Blocked` / `Deferred`
- Notes / evidence link

### Step 4 — Reverse-Trace Each Result
For each UAT-XXX, trace upward through traceability matrix:
```
UAT-XXX → TC-XXX (via traceability matrix)
TC-XXX  → AC-XXX
AC-XXX  → US-XXX
US-XXX  → FR-XXX
FR-XXX  → BR-XXX
IF has_contract: BR-XXX → CC-XXX (via contract map)
```
Flag broken chains: if any link is missing → mark chain as `INCOMPLETE`

### Step 5 — Calculate Satisfaction Metrics

Per level:
| Level | Metric |
|-------|--------|
| UAT coverage | % of TC-XXX covered by at least 1 UAT result |
| BR coverage | % of BR-XXX where ALL linked UAT results = Passed |
| FR coverage | % of FR-XXX where ALL linked UAT results = Passed |
| CC coverage (if has_contract) | % of CC-XXX where ALL linked UAT results = Passed |

### Step 6 — Classify Unsatisfied Items

| Class | Condition |
|-------|-----------|
| `BLOCKER` | UAT Failed AND linked BR is P1/Must AND no waiver in `docs/pm-signoff-log.md` (type: waiver) |
| `CRITICAL` | CC-XXX with 0% satisfaction (zero UATs passed for that clause), OR BR-XXX with 0% UAT pass rate (all linked UATs Failed/Blocked) regardless of CC presence |
| `MAJOR` | UAT Failed AND linked BR is P2/Should AND no waiver |
| `MINOR` | UAT Failed but P3/Could, OR status = Deferred with waiver entry in `docs/pm-signoff-log.md` |

### Step 7 — Generate Certification Decision

| Decision | Condition |
|----------|-----------|
| `FULL PASS` | No BLOCKERs, no CRITICAL, no MAJOR, <5% MINOR by count |
| `CONDITIONAL` | No BLOCKERs, has CRITICAL or MAJOR or ≥5% MINOR (list conditions) |
| `REFUSED` | Any BLOCKER present |

### Step 8 — Write Acceptance Certification Report
Output: `plans/reports/acceptance-certification-{date}.md`
Stakeholder: `client`
Template: `templates/tpl-acceptance-certification.md`

Content includes:
- Coverage metrics table (all levels)
- Contract clause satisfaction table (if has_contract)
- Blocker items list
- Minor/deferred items list
- Certification decision with justification
- Conditions list (if CONDITIONAL)
- Sign-off signature block

### Step 9 — Update Traceability Matrix + State
- Add "Acceptance Result" column to `docs/pm-traceability-matrix.md`
- Update `docs/pm-ba-document-status.md`:
  - `acceptance_run: YYMMDD`
  - `certification_decision: FULL PASS / CONDITIONAL / REFUSED`
  - `acceptance_report_path: plans/reports/acceptance-certification-{date}.md`

---

## Output Files

| File | Type | Notes |
|------|------|-------|
| `plans/reports/acceptance-certification-{date}.md` | Timestamped report | stakeholder: client |
| `docs/pm-traceability-matrix.md` | Updated | Acceptance Result column added |
| `docs/pm-ba-document-status.md` | State update | certification_decision recorded |

---

## Note: No CC-XXX Level

If `docs/ba-contract-requirements-map.md` does not exist:
- Acceptance report covers BR-XXX → UAT-XXX chain only
- Report states at top: `"Contract clause mapping not available. Coverage reported at BR level."`
- This is valid — not all projects have formal contracts

---

## Traceability Chain Position

`CC-XXX → BR-XXX → FR-XXX → US-XXX → AC-XXX → TC-XXX → UAT-XXX`
(See `references/14-mode-traceability.md §2` for full chain definition.)
