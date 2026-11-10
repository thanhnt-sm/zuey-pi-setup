---
stakeholder: tester
type: test-case-bridge
---
# Test Case Bridge: [US-XXX] → TC

> **Purpose:** Handoff document from BA to QA team.
> BA fills: User Story reference, AC list, test scenario outlines, data requirements.
> QA fills: detailed test steps, test data values, actual results.

## User Story Reference

- **Story:** US-XXX — [Title]
- **Actor:** [Role]
- **Story text:** As a [role], I want [action], so that [benefit].
- **Priority:** P1 / P2 / P3
- **Module:** [Module name]
- **Linked FRs:** FR-XXX, FR-YYY
- **Acceptance Criteria in scope:** AC-XXX, AC-YYY, AC-ZZZ

---

## Test Scenarios

| TC-ID | Scenario Name (VN) | Type | Given (Setup) | When (Action) | Then (Expected Result) | Priority | AC-Ref | Status |
|-------|-------------------|------|--------------|--------------|----------------------|----------|--------|--------|
| TC-XXX | Happy path — [mô tả ngắn] | Positive | | | | P1 | AC-XXX | Draft |
| TC-YYY | Invalid input — [mô tả ngắn] | Negative | | | | P1 | AC-YYY | Draft |
| TC-ZZZ | Boundary value — [mô tả ngắn] | Edge | | | | P2 | AC-XXX | Draft |
| TC-WWW | Unauthorized access | Security | | | | P1 | AC-ZZZ | Draft |

> **Type options:** Positive / Negative / Edge / Security / Performance / Integration
> **Status options:** Draft / Ready / Executed-Pass / Executed-Fail / Blocked / Skipped

---

## Acceptance Criteria Coverage Check

| AC-ID | AC Description | TC-IDs Covering | Coverage |
|-------|---------------|-----------------|----------|
| AC-XXX | | TC-XXX, TC-ZZZ | Covered |
| AC-YYY | | TC-YYY | Covered |
| AC-ZZZ | | — | NOT COVERED — add TC |

---

## Test Data Requirements

### Input Data Needed
- [Describe data entities and values needed to execute tests]
- [Example: "Cần 1 hợp đồng trạng thái ACTIVE với dư nợ > 0"]
- [Example: "Cần user account với role CBTD và role KSTT để test permission"]

### System State Requirements
- [Pre-conditions that must be true in the test environment]
- [Example: "T24 sandbox phải có contract C0001 tồn tại"]

### Test Data Setup Script
```sql
-- TODO: QA team fill in setup SQL/API calls
-- Example:
-- INSERT INTO hop_dong (id, so_hd, trang_thai) VALUES (...)
```

---

## Environment Requirements

| Environment | Required | Notes |
|-------------|----------|-------|
| SIT | Yes | Primary test environment |
| UAT | Yes | Client acceptance testing |
| Production | No | Not tested in PROD |
| T24 Sandbox | [Yes/No] | Required if integration |
| Mock Service | [Yes/No] | If external API not available |

---

## Integration Points to Test

| System | API/Interface | Test Approach |
|--------|--------------|---------------|
| [T24 / CIC / etc.] | API-XXX | [Real call / Mock / Stub] |

---

## Regression Risk

- **Risk level:** [High / Medium / Low]
- **Why:** [What existing functionality could be broken by this US]
- **Suggested regression TCs:** [TC-IDs from other US to re-run]

---

## Open Issues for Tester

| # | Issue | Impact on Testing | Owner | Status |
|---|-------|------------------|-------|--------|
| 1 | [Question or blocker] | [What cannot be tested until resolved] | BA / Dev | Open |

---

## QA Sign-off

| Field | Value |
|-------|-------|
| Prepared by (BA) | [Name] — YYYY-MM-DD |
| Reviewed by (QA Lead) | |
| Test execution completed | |
| Pass/Fail summary | |
| Defects logged | |
