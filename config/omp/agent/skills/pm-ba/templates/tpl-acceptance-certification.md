---
stakeholder: client
type: acceptance-certification
project: {project_slug}
uat_period: {start} - {end}
certification_date: {date}
---
# Acceptance Certification — {project}

> **Issued by:** Project Manager / BA Lead
> **UAT Period:** {start} — {end}
> **Certification Date:** {date}

---

## Summary

| Field | Value |
|-------|-------|
| Certification Date | {date} |
| UAT Period | {start} — {end} |
| Overall Result | **FULL PASS / CONDITIONAL / REFUSED** |
| Total UAT Cases | |
| Passed | |
| Failed | |
| Deferred | |

---

## Coverage Metrics

| Level | Total | Covered | Passed | Coverage % |
|-------|-------|---------|--------|------------|
| Contract Clauses (CC) | | | | N/A if no contract |
| Business Rules (BR) | | | | |
| Functional Requirements (FR) | | | | |
| Test Cases (TC) | | | | |
| UAT Scenarios | | | | |

---

## Contract Clause Satisfaction

> *(Section omitted if ba-contract-requirements-map.md not available)*

| CC-ID | Clause | All UAT Passed? | Key Evidence (UAT-IDs) | Satisfied |
|-------|--------|----------------|----------------------|-----------|
| CC-001 | | Y / N | UAT-XXX | ✓ / ✗ |

---

## Blocker Items

> Items that prevent FULL PASS certification.

| ID | Level | Description | Severity | Recommended Action |
|----|-------|-------------|----------|-------------------|
| UAT-XXX | UAT | | P1 | |

---

## Minor / Deferred Items

| ID | Level | Description | Waiver? | Resolution Plan |
|----|-------|-------------|---------|-----------------|
| UAT-XXX | UAT | | Y/N | |

---

## Certification Decision

### **{FULL PASS / CONDITIONAL / REFUSED}**

{Justification — 2-3 sentences summarizing the basis for the decision.}

**Conditions (if CONDITIONAL):**
1.
2.

**Refusal Grounds (if REFUSED):**
1.

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Project Sponsor | | | |
| Business Owner | | | |
| Project Manager | | | |
| QA Lead | | | |
| Client Representative | | | |

---

## Notes

- Contract clause mapping: {available / not available}
- Traceability matrix source: `docs/pm-traceability-matrix.md`
- Full UAT results: {uat_results_path}
