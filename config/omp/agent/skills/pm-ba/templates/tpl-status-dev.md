---
stakeholder: dev
type: status-report
audience: development-team
language: EN/VN technical
tool: none
---

<!--
TEMPLATE INSTRUCTIONS (remove before sending):
- Audience: Development team — compact, dense, no prose fluff
- Language: EN preferred for technical items; VN for context notes
- Status values: ✅ Done | 🔄 In Progress | ❌ Blocked | ⏸ Paused | 🔍 In Review
- Priority: P0 = blocker/critical | P1 = this sprint | P2 = next sprint | P3 = backlog
- Always include branch name for QA handoff items
-->

# Dev Status — Sprint [N] | [YYYY-MM-DD → YYYY-MM-DD]

## Sprint Summary

| Field | Value |
|-------|-------|
| Sprint Goal | [One sentence sprint goal] |
| Velocity (Actual / Planned) | [N] SP / [N] SP |
| Completion | [XX]% |
| Working Days Remaining | [N] days |
| Sprint Health | 🟢 On Track / 🟡 At Risk / 🔴 Off Track |

---

## Backlog Status

<!--
US-ID format: US-[3 digits] matching Jira/ticket system
SP = Story Points
Blocker: None OR short description + responsible party
-->

| US-ID | Story Title | SP | Assignee | Status | Priority | Blocker |
|-------|------------|-----|---------|--------|----------|---------|
| US-XXX | [Short story title] | [N] | [Name] | ✅ Done | P1 | None |
| US-XXX | | [N] | [Name] | 🔄 In Progress | P1 | None |
| US-XXX | | [N] | [Name] | ❌ Blocked | P0 | [Describe blocker — who owns resolution] |
| US-XXX | | [N] | [Name] | ⏸ Paused | P2 | [Reason paused] |
| US-XXX | | [N] | [Name] | 🔍 In Review | P1 | None |

**Sprint totals:** Done: [N] SP | In Progress: [N] SP | Blocked: [N] SP | Remaining: [N] SP

---

## Blockers — Needs Immediate Attention

<!--
Escalate P0 blockers here. If none, write: "No blockers this sprint."
-->

| # | Blocker Description | Blocked Story | Owner (Resolver) | Action Required | ETA Resolution |
|---|--------------------|--------------|-----------------|--------------------|----------------|
| — | No blockers this sprint. | — | — | — | — |

<!--
If blockers exist:
| 1 | [Blocker desc] | US-XXX | [Name / Team] | [Specific action needed] | YYYY-MM-DD |
-->

---

## Ready for QA Handoff / Sẵn Sàng Bàn Giao QA

<!--
Only list items that are code-complete and have passed developer self-testing.
Include branch name so QA can checkout + test.
-->

| US-ID | Story Title | Branch | Test Environment | Notes for QA |
|-------|------------|--------|-----------------|-------------|
| US-XXX | [Story title] | `feature/US-XXX-[short-desc]` | staging / UAT | [Any specific test notes] |

---

## Decisions Needed from PM/BA

<!--
Prevents dev team from self-deciding scope. List any ambiguity blocking implementation.
-->

| # | Question | Affected Story | Impact if Unresolved | Needed By |
|---|---------|---------------|---------------------|----------|
| 1 | [Technical/scope question] | US-XXX | [What gets blocked or mis-built] | YYYY-MM-DD |

If none: "No decisions needed this sprint."

---

## Coming Up — Next Sprint Preview

<!--
High-level preview only. Full sprint planning happens in sprint planning meeting.
-->

| US-ID | Story Title | Est. SP | Dependencies |
|-------|-----------|---------|------------|
| US-XXX | [Title] | [N] | [None / Depends on US-XXX] |

---

## Technical Notes / Ghi Chú Kỹ Thuật

<!--
Optional section. Use for: architectural decisions made this sprint, tech debt flagged,
infrastructure changes, environment issues, dependency updates.
-->

- [Note 1: e.g., "Switched from polling to WebSocket for real-time notifications — see ADR-007"]
- [Note 2: e.g., "T24 API response time degraded on staging — raised with FlexCPC (Q-012)"]

---

*Generated: YYYY-MM-DD | Sprint [N] | [Project Name]*
