# Mode: Traceability Matrix

## 1. Trigger

Activated when:
- CLI flag `--trace` is provided
- Natural language: "traceability", "ma trận truy vết", "truy vết yêu cầu", "requirements traceability", "coverage matrix"
- **Auto-triggered internally** after modes 02 (BRD), 03 (URD), 17 (Test case generation) complete

## 2. Traceability Chain

The full requirements chain is:

```
CC-XXX (Contract Clause)  ← optional; present when ba-contract-requirements-map.md exists
  └── BR-XXX (Business Rule)
        └── FR-XXX (Functional Requirement)
              └── US-XXX (User Story)
                    └── AC-XXX (Acceptance Criteria)
                          └── TC-XXX (Test Case)
                                └── UAT-XXX (UAT Scenario)
```

Each level must be linked to the level above it. Items without upstream links are **Orphans**.
CC-XXX is optional — if no contract map exists, chain starts at BR-XXX. BR-XXX orphans (no CC upstream) are flagged but not blocked.

## 3. Matrix Schema

The traceability matrix table:

| CC-IDs | BR-ID | BR Description | FR-IDs | US-IDs | AC-IDs | TC-IDs | UAT-IDs | Status | Gaps |
|--------|-------|----------------|--------|--------|--------|--------|---------|--------|------|
| CC-001 | BR-001 | [Rule desc] | FR-001, FR-002 | US-001 | AC-001, AC-002 | TC-001 | UAT-001 | Active | None |
| — | BR-002 | [Rule desc] | FR-003 | US-002 | AC-003 | — | — | Active | TC missing |

**CC-IDs column:** show `—` when `docs/ba-contract-requirements-map.md` does not exist.

**Status values:** Active / Deferred / Out-of-Scope / Deprecated

**Gaps column examples:**
- "TC missing" — no test case linked to this chain
- "US missing" — FR has no user story
- "AC incomplete" — fewer than 2 AC per US
- "UAT pending" — awaiting UAT planning
- "Orphan FR" — FR with no BR link

## 4. Orphan Detection Rules

Items are flagged as Orphans when:

| Level | Orphan Condition |
|-------|-----------------|
| FR-XXX | No BR-XXX upstream link |
| US-XXX | No FR-XXX upstream link |
| AC-XXX | No US-XXX parent |
| TC-XXX | No AC-XXX being tested |
| UAT-XXX | No US-XXX being validated |

Orphan action: "Orphan — Review Required"
- Assign to BA for review
- Either link to existing parent or flag for deletion

## 5. Build Workflow

### Step a — Discover Source Files

Read `docs/pm-ba-document-status.md` to find paths to all BA output files:
- `brd_analysis_path` → source for FR-XXX, NFR-XXX, BR-XXX
- `urd_analysis_path` → source for US-XXX, AC-XXX
- Test case bridge reports → source for TC-XXX (if available)
- UAT plan (if available) → source for UAT-XXX
- If `docs/ba-contract-requirements-map.md` exists → load CC-XXX → BR-XXX lookup; add CC-IDs column to matrix

### Step b — Parse FRs and BRs

From BRD analysis report:
1. Extract all BR-XXX entries from Business Rules table
2. Extract all FR-XXX entries from Functional Requirements table
3. Parse existing BR → FR links (FRs that reference BRs in their description)
4. Build initial BR-FR mapping

### Step c — Parse User Stories and ACs

From URD analysis report:
1. Extract all US-XXX entries from User Stories table
2. Extract all AC-XXX entries from Acceptance Criteria table
3. Parse US → FR links (USs that reference FR-XXX in "Linked FR" column)
4. Parse AC → US links (ACs that reference US-XXX as parent)

### Step d — Parse Test Cases (if available)

From test case bridge files (templates/tpl-test-case-bridge.md instances):
1. Extract TC-XXX entries
2. Parse TC → AC links
3. If not available: mark TC-IDs column as "— (pending QA)"

### Step e — Parse UAT Scenarios (if available)

From UAT plan file:
1. Extract UAT-XXX entries
2. Parse UAT → US links
3. If not available: mark UAT-IDs column as "— (pending UAT)"

### Step f — Build Matrix and Detect Orphans

1. Join all levels into the matrix table
2. For each row: check if all links are populated
3. Flag orphans: items at any level with no upstream/downstream link
4. Calculate coverage stats per level

### Step g — Produce Output

Save to `docs/pm-traceability-matrix.md` (always overwrite — this is the single source of truth).

## 6. Incremental Update

When called after new BA outputs are added:
1. Read existing `docs/pm-traceability-matrix.md`
2. Load only new/changed items from latest BA reports
3. Merge: add new rows, update existing rows, never delete (use "Deprecated" status)
4. Re-run orphan detection on full matrix
5. Recalculate coverage stats
6. Update "Last Updated" timestamp

## 7. Output

**File:** `docs/pm-traceability-matrix.md`

Structure:
```markdown
# Traceability Matrix — {Project Name}
**Version:** v{N} | **Updated:** YYYY-MM-DD

## Coverage Summary
| Level | Total | Linked | Orphaned | Coverage % |
|-------|-------|--------|----------|------------|
| BR | N | N | N | XX% |
| FR | N | N | N | XX% |
| US | N | N | N | XX% |
| AC | N | N | N | XX% |
| TC | N | N | N | XX% |
| UAT | N | N | N | XX% |

## Traceability Matrix
{Full matrix table}

## Orphan List
| ID | Level | Description | Action Required | Assigned To |
|----|-------|-------------|-----------------|-------------|

## Coverage Notes
- Items with Status = Deferred are excluded from coverage calculation
- TC and UAT coverage are 0% until QA planning begins
```

## 8. Deliverables Checklist

- [ ] CC-IDs column populated (optional — if `docs/ba-contract-requirements-map.md` exists; show `—` otherwise)
- [ ] All BR-XXX parsed from BRD analysis
- [ ] All FR-XXX parsed and linked to BR-XXX
- [ ] All US-XXX parsed and linked to FR-XXX
- [ ] All AC-XXX parsed and linked to US-XXX
- [ ] TC-XXX linked or marked as pending
- [ ] UAT-XXX linked or marked as pending
- [ ] Orphan detection complete (BR orphans flagged if no CC upstream, not blocked)
- [ ] Coverage stats calculated
- [ ] `docs/pm-traceability-matrix.md` saved/updated
- [ ] `docs/pm-ba-document-status.md` updated with trace run timestamp
