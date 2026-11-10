# Output Registry — Dependency Tracking

## Purpose

`docs/pm-ba-output-registry.md` tracks the **input→output dependency graph** for the pm-ba skill.
When an input document is updated, query this registry to find all stale downstream outputs.

---

## Registry File Location

**Canonical path:** `docs/pm-ba-output-registry.md`

Create from `templates/tpl-output-registry.md` if it doesn't exist.
If template missing, create using the schema below.

---

## Schema

### Section 1: Output Registry Table

```markdown
## Output Registry

| Output ID | Output File | Type | Source Inputs | Mode Used | Created Date | Last Updated | Status |
|-----------|-------------|------|--------------|-----------|--------------|--------------|--------|
| OUT-001 | plans/reports/ba-260516-1302-requirements-analysis.md | report | DOC-001,DOC-002 | --brd | 2026-05-16 | 2026-05-16 | current |
| OUT-002 | docs/ba-brd-analysis.md | evergreen | DOC-001 | --brd | 2026-05-16 | 2026-05-16 | current |
| OUT-003 | plans/reports/ba-260516-1759-brd-urd-gap-analysis.md | report | DOC-001,DOC-003 | --urd | 2026-05-16 | 2026-05-16 | stale |
```

**Status values:**
- `current` — output is up-to-date with all source inputs
- `stale` — one or more source inputs have been updated since this output was generated
- `partial` — output was generated from incomplete source data (e.g., only BRD, URD pending)
- `superseded` — a newer output replaced this one (keep for audit trail)

**Type values:** `report` | `evergreen` | `diagram` | `template` | `tracking`

### Section 2: Input Registry Table

```markdown
## Input Registry

| Doc ID | Doc Name | Path | Type | Version | Last Modified | Outputs Derived |
|--------|----------|------|------|---------|---------------|-----------------|
| DOC-001 | BRD Technical [PROJECT] v1.3 | BRD/[CLIENT]_[PROJECT]-Technical-1.3.md | brd | v1.3 | 2026-05-16 | OUT-001,OUT-002,OUT-003 |
| DOC-002 | URD V01 chính | URD/[CLIENT]_[PROJECT]_URD_V01_20251008.md | urd | V01 | 2026-05-16 | OUT-003,OUT-004 |
```

### Section 3: Stale Summary (auto-generated)

```markdown
## Stale Outputs

Last checked: {date}

| Output ID | Output File | Stale Because | Recommended Mode | Priority |
|-----------|-------------|---------------|-----------------|----------|
| OUT-003 | ba-260516-1759-brd-urd-gap-analysis.md | DOC-002 updated on 2026-05-20 | --diff then --urd | High |
```

---

## Write Protocol

After every mode run that produces output, update `docs/pm-ba-output-registry.md`:

### Adding a New Output
1. Assign next OUT-{NNN} ID
2. Add row to **Output Registry Table**: output file, type, source input Doc IDs, mode, today's date
3. For each source input: append the new OUT-ID to its `Outputs Derived` column in **Input Registry**
4. If input not yet in Input Registry: add a new row for it first

### Marking Outputs Stale
When a new version of an input arrives (Type A or B in `--update` mode):
1. Find the input's Doc ID in Input Registry
2. Get all `Outputs Derived` IDs
3. Update each output's `Status` from `current` → `stale`
4. Regenerate Section 3 (Stale Summary)

### Run History
Append to state file Run History per `references/state-and-continuity.md` format. No separate registry-specific entry needed.

---

## Read Protocol (Cascade Query)

When `--update` receives a new document version (Type A or B):

1. Look up document in Input Registry by path or name
2. **If not found** → add new row first (assign next DOC-NNN), then continue
3. Get `Outputs Derived` IDs; for each: compare output's `Created Date` vs input's `Last Modified`
4. If input newer → mark output `stale`, add to cascade plan
5. Surface to user as table: `Output File | Mode to update | Priority` — ask "Lập kế hoạch cập nhật không? [Y/N]"
6. If user confirms → queue update modes per Cascade Priority Rules below

---

## Cascade Priority Rules

**Default: High** — regenerate with the same mode that produced the output (e.g., `--brd`, `--urd`, `--api`, `--screen`, `--process-map`). Use `--diff` first when output was derived from two input versions.

**Exceptions:**
- `project-charter`, `risk-register` → **Medium** — review manually; may need `--cr` if scope-impacting
- `test-cases` → **Medium** — re-run `--test-case`
- `meeting-minutes` → **Low** — historical artifacts, never regenerate

---

## Initialization Protocol

When `--state` or `--kickoff` is run and no `docs/pm-ba-output-registry.md` exists:

1. Create file using schema above
2. Scan `plans/reports/` for existing output files: `find plans/reports/ -name "*.md"`
3. Scan `docs/` for evergreen artifacts matching `pm-*.md` and `ba-*.md`
4. For each found file: add to Output Registry with `Status = current` (best-effort, no source tracking yet)
5. Cross-reference `references/state-and-continuity.md` § Document Registry for existing Doc IDs to backfill source input linkages
6. Present summary: "Output registry initialized with {N} outputs. {M} could not be linked to source inputs — review manually."

---

## Workspace Index Integration

`docs/pm-ba-output-registry.md` feeds into `docs/pm-ba-workspace-index.md`:
- Workspace index shows a human-readable view of current project output state
- Output registry is the machine-queryable version (used for cascade logic)
- Both files must be kept in sync: when output registry is updated, regenerate workspace index header

---

## Template Snapshot

`templates/tpl-output-registry.md` contains the empty table schema.
After `--kickoff`, create `docs/pm-ba-output-registry.md` from template.
