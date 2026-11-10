---
stakeholder: internal
type: traceability-matrix
---
# Traceability Matrix — [Project Name]

> **Purpose:** Single source of truth for requirements coverage.
> Maps Business Rules → Functional Requirements → User Stories → Acceptance Criteria → Test Cases → UAT Scenarios.
> Auto-generated and maintained by `pm-ba --trace`. Do not edit the matrix table manually.

---

## Document Info

| Field | Value |
|-------|-------|
| **Project** | [Project name] |
| **Version** | v1.0 |
| **Last Updated** | YYYY-MM-DD HH:MM |
| **Updated By** | Claude (pm-ba skill) |
| **Source: BRD Analysis** | `plans/reports/ba-[date]-brd-analysis-[slug].md` |
| **Source: URD Analysis** | `plans/reports/ba-[date]-urd-user-stories-[slug].md` |
| **Source: Test Cases** | `plans/reports/ba-[date]-test-case-bridge-[slug].md` (or "Pending") |
| **Source: UAT Plan** | `docs/uat-plan.md` (or "Pending") |

---

## Coverage Summary

| Level | Total Items | Linked (has upstream) | Orphaned | Coverage % |
|-------|-------------|----------------------|----------|------------|
| CC (Contract Clauses) | 0 | 0 | 0 | N/A if no contract |
| BR (Business Rules) | 0 | 0 | 0 | 0% |
| FR (Functional Req.) | 0 | 0 | 0 | 0% |
| US (User Stories) | 0 | 0 | 0 | 0% |
| AC (Acceptance Criteria) | 0 | 0 | 0 | 0% |
| TC (Test Cases) | 0 | 0 | 0 | 0% |
| UAT (UAT Scenarios) | 0 | 0 | 0 | 0% |

**Overall requirements coverage:** 0%
*(Coverage = % of FR-XXX that have at least 1 US + 2 AC + 1 TC linked)*

---

## Traceability Matrix

> CC-IDs column: show `—` when `docs/ba-contract-requirements-map.md` does not exist.

| CC-IDs | BR-ID | BR Description | FR-IDs | US-IDs | AC-IDs | TC-IDs | UAT-IDs | Status | Gaps |
|--------|-------|----------------|--------|--------|--------|--------|---------|--------|------|
| CC-001 | BR-001 | [Business Rule description] | FR-001, FR-002 | US-001 | AC-001, AC-002 | TC-001 | UAT-001 | Active | None |
| — | BR-002 | [Business Rule description] | FR-003 | US-002 | AC-003, AC-004 | — | — | Active | TC missing |
| — | BR-003 | [Business Rule description] | FR-004 | — | — | — | — | Active | US missing, AC missing, TC missing |

**Gap codes:**
- `US missing` — FR has no User Story linked
- `AC incomplete` — fewer than 2 AC per US (or no AC)
- `TC missing` — no Test Case linked to AC
- `UAT pending` — awaiting UAT planning
- `Orphan FR` — FR with no BR upstream
- `CC unlinked` — BR has no Contract Clause upstream (flag only; not a blocker)
- `None` — fully linked at all levels

---

## Functional Requirements Coverage (FR Detail View)

| FR-ID | FR Description | Module | Priority | BR-Upstream | US-IDs | AC Count | TC Count | UAT Count | Status |
|-------|----------------|--------|----------|------------|--------|---------|---------|----------|--------|
| FR-001 | [FR description] | [Module] | Must | BR-001 | US-001 | 2 | 1 | 1 | Covered |
| FR-002 | [FR description] | [Module] | Should | BR-001 | US-002 | 1 | 0 | 0 | AC incomplete, TC missing |
| FR-003 | [FR description] | [Module] | Must | — | — | 0 | 0 | 0 | Orphan FR |

---

## User Story Coverage (US Detail View)

| US-ID | US Title | Actor | FR-Upstream | AC Count | TC Count | UAT Count | Sprint | Status |
|-------|----------|-------|------------|---------|---------|----------|--------|--------|
| US-001 | [US title] | [Role] | FR-001 | 2 | 2 | 1 | Sprint 1 | Covered |
| US-002 | [US title] | [Role] | FR-002 | 1 | 0 | 0 | TBD | TC missing |

---

## Orphan List

> Items that have no upstream link and require BA review.

| ID | Level | Description | Reason Flagged | Action Required | Assigned To | Due Date |
|----|-------|-------------|----------------|-----------------|-------------|---------|
| FR-XXX | FR | [FR desc] | No BR upstream | Link to BR or justify no BR | BA | YYYY-MM-DD |
| US-XXX | US | [US title] | No FR upstream | Link to FR or delete | BA | YYYY-MM-DD |
| AC-XXX | AC | [AC desc] | No US parent | Link to US or delete | BA | YYYY-MM-DD |

---

## Out-of-Scope Items (Deferred)

| ID | Level | Description | Decision | Deferred To |
|----|-------|-------------|---------|------------|
| FR-XXX | FR | [FR desc] | Deferred — Phase 2 | v2.0 |

---

## Coverage Trend

| Run Date | Total FR | Covered FR | Coverage % | New Orphans | Resolved Orphans |
|----------|----------|-----------|------------|------------|-----------------|
| YYYY-MM-DD | 0 | 0 | 0% | 0 | 0 |

---

## Change History

| Date | Changed By | Change | Impact |
|------|-----------|--------|--------|
| YYYY-MM-DD | Claude (pm-ba) | Initial matrix creation | — |
| YYYY-MM-DD | Claude (pm-ba) | Added TC-XXX after QA planning | Coverage +X% |
