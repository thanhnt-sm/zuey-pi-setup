---
file: docs/pm-ba-output-registry.md
type: tracking
stakeholder: internal
---

# Output Registry — [Project Name]

**Version:** 1.0 | **Khởi tạo:** [DATE] | **Cập nhật bởi:** pm-ba skill (auto)

> Tracks which output files were derived from which input documents.
> Query this file to find stale outputs when an input changes.
> Auto-maintained by pm-ba skill — do NOT edit manually.

---

## Output Registry

| Output ID | Output File | Type | Source Inputs (Doc IDs) | Mode Used | Created Date | Status |
|-----------|-------------|------|------------------------|-----------|--------------|--------|
| OUT-001 | | | | | | |

**Status:** `current` \| `stale` \| `partial` \| `superseded`
**Type:** `report` \| `evergreen` \| `diagram` \| `template` \| `tracking`

---

## Input Registry

| Doc ID | Doc Name | Path | Type | Last Modified | Outputs Derived |
|--------|----------|------|------|---------------|-----------------|
| DOC-001 | | | | | |

**Type:** `brd` \| `urd` \| `template` \| `meeting-notes` \| `process-map` \| `screen-spec` \| `api-spec` \| `report`

---

## Stale Outputs

*Last checked: [DATE]*

| Output ID | Output File | Stale Because | Recommended Mode | Priority |
|-----------|-------------|---------------|-----------------|----------|

---

## Run Log (append-only)

| Date | Action | Details |
|------|--------|---------|
| [DATE] | Registry initialized | {N} outputs backfilled from plans/reports/ and docs/ |
