# Artifact Naming Convention

## PM Docs (Evergreen)

Path pattern: `docs/pm-{slug}.md`

These files are living documents — updated in place, never timestamped. They represent the current authoritative state.

| Slug | Full Path | Purpose |
|---|---|---|
| `project-charter` | `docs/pm-project-charter.md` | Project scope, objectives, RACI |
| `risk-register` | `docs/pm-risk-register.md` | All project risks, owners, mitigations |
| `signoff-log` | `docs/pm-signoff-log.md` | Approval history for all documents |
| `change-request-log` | `docs/pm-change-request-log.md` | All CRs with status and impact |
| `traceability-matrix` | `docs/pm-traceability-matrix.md` | BRD → URD → US → AC → TC linkage |
| `uat-plan` | `docs/pm-uat-plan.md` | UAT scope, test cases, sign-off criteria |
| `ba-document-status` | `docs/pm-ba-document-status.md` | Skill state file (canonical) |
| `ba-output-registry` | `docs/pm-ba-output-registry.md` | Input→output dependency graph; staleness tracking |
| `ba-workspace-index` | `docs/pm-ba-workspace-index.md` | Human-readable index of all current project outputs |

---

## BA Docs (Evergreen)

Path pattern: `docs/ba-{slug}.md`

| Slug | Full Path | Purpose |
|---|---|---|
| `clarification-register` | `docs/ba-clarification-register.md` | All open/closed clarification questions |
| `glossary` | `docs/ba-glossary.md` | Business terminology definitions |
| `brd-analysis` | `docs/ba-brd-analysis.md` | Structured BRD findings and gaps |
| `urd-analysis` | `docs/ba-urd-analysis.md` | Structured URD with US + AC |
| `data-model` | `docs/ba-data-model.md` | ERD descriptions and entity specs |
| `api-contracts` | `docs/ba-api-contracts.md` | All API endpoint contracts |
| `screen-specs` | `docs/ba-screen-specs.md` | Screen URDs and UI interaction specs |

---

## Input Document Folders

Path: `{config.input_root}/{config.input_subfolders[type]}/`
Resolution: Read `.claude/pm-ba.config.json`. Example: `G:\...\100_Local\04_Scope_local\brd\`

> **Paths resolved via `.claude/pm-ba.config.json`. Never hardcode relative paths.**

Source files from stakeholders — never modified, never deleted. PM-BA skill scans these to detect unprocessed documents.

| Subfolder Key | Config Field | Purpose | Auto-detect Mode |
|-----------|---------|---------|-----------------|
| `brd` | `config.input_subfolders.brd` | BRD source files (PPTX/PDF/DOCX) | `--brd` |
| `urd` | `config.input_subfolders.urd` | URD source files (DOCX/XLSX) | `--urd` |
| `contract` | `config.input_subfolders.contract` | Contract source files (PDF/DOCX) | `--contract` |
| `meeting` | `config.input_subfolders.meeting` | Meeting minutes source files (DOCX/PDF) | `--meeting-post` |
| `process-flow` | `config.input_subfolders.process-flow` | Process flow diagrams (VSDX/DrawIO) | `--process-map` |
| `screen-spec` | `config.input_subfolders.screen-spec` | Screen specification files (PPTX/DOCX/VSDX) | `--screen` |

**Rules:** See `references/document-ingest-protocol.md §Input Folder Scanning Protocol` for routing logic, mtime tracking, and backward compatibility details.

---

## Timestamped Reports

Path pattern: `plans/reports/{type}-{YYMMDD}-{slug}.md`

`{YYMMDD}` = 6-digit date, e.g., `260517` for 2026-05-17.

| Type Prefix | Usage | Example |
|---|---|---|
| `pm` | PM-generated reports (status, sprint, go-live) | `pm-260517-sprint-4-plan.md` |
| `ba` | BA-generated reports (meeting post, clarify) | `ba-260517-meeting-post-uat-review.md` |
| `raw-extract` | Raw converted document content (evidence) | `raw-extract-260517-brd-v2.md` |
| `diff` | Document comparison output | `diff-260517-urd-v1-vs-urd-v2.md` |
| `status` | Project status snapshots | `status-260517-weekly-director.md` |
| `daily` | Daily standup summaries | `pm-260517-daily-standup.md` |
| `backup` | Pre-overwrite backups | `backup-260517-pm-risk-register.md` |
| `partial` | Incomplete mode runs (checkpoint) | `partial-brd-260517.md` |

---

## Per-Stakeholder Suffix

Append audience suffix when the same artifact has multiple audience versions:

| Suffix | Audience |
|---|---|
| `-client` | External client / customer |
| `-vendor` | Third-party vendor or integrator |
| `-dev` | Development team |
| `-sponsor` | Project sponsor or executive |
| `-auditor` | Internal or external auditor |
| `-internal` | Internal PM/BA team only |

Example: `status-260517-weekly-client.md` vs `status-260517-weekly-dev.md`

Every output artifact's frontmatter must include:
```yaml
stakeholder: client  # or dev, sponsor, auditor, vendor, internal
```

---

## Diagram Files

| Format | Path Pattern | Usage |
|---|---|---|
| Mermaid (markdown) | `plans/{plan-dir}/visuals/{slug}.md` | Inline Mermaid code blocks |
| HTML preview | `plans/{plan-dir}/visuals/{slug}.html` | `ck:preview --html` output |

If no active plan directory: use `plans/visuals/{slug}.md`.

Example: `plans/260517-0839-[PROJECT]/visuals/brd-process-flow.md`

---

## Diff Reports

Pattern: `plans/reports/diff-{YYMMDD}-{doc-a-slug}-vs-{doc-b-slug}.md`

Example: `plans/reports/diff-260517-urd-v1-vs-urd-v2.md`

Structure inside diff report:
- Summary table: added sections, removed sections, changed sections
- Per-section diff with `+` / `-` markers
- Impact assessment: which US/AC/TC are affected

---

## Raw Extract Files

Pattern: `plans/reports/raw-extract-{YYMMDD}-{source-slug}.md`

Naming the source slug: take the original filename, strip extension, transliterate Vietnamese to ASCII, replace spaces with hyphens, lowercase.

Examples:
- `BRD_QuanLySauVay_v2.docx` → `raw-extract-260517-brd-quan-ly-sau-vay-v2.md`
- `URD_ThanhToan_v1.pdf` → `raw-extract-260517-urd-thanh-toan-v1.md`

For chunked large files, append `-chunk-{N}`:
- `raw-extract-260517-brd-quan-ly-sau-vay-v2-chunk-1.md`
- `raw-extract-260517-brd-quan-ly-sau-vay-v2-chunk-2.md`
- `raw-extract-260517-brd-quan-ly-sau-vay-v2-master-summary.md`

---

## Clarification Register

Single living file: `docs/ba-clarification-register.md`

- Never timestamped — always updated in place
- One row per open question, with columns: ID | Question | Source Doc | Asked By | Asked To | Date Raised | Date Resolved | Answer | Status
- Status values: `open` | `answered` | `wont-fix` | `merged-into-cr`

---

## Templates

Path pattern: `templates/tpl-{slug}.md`

Templates are read-only for the skill — humans may edit them. The skill reads templates to generate populated artifacts.

Examples: `templates/tpl-meeting-minutes.md`, `templates/tpl-brd-analysis.md`, `templates/tpl-document-status.md`

---

## Naming Rules Summary

1. Use kebab-case — no spaces, no underscores
2. Vietnamese words in filenames → transliterate to ASCII (e.g., `Hợp-Đồng` → `hop-dong`)
3. `{YYMMDD}` = 6-digit date, no separators (e.g., `260517`)
4. `{slug}` = 2–5 meaningful kebab-case words describing the content
5. Evergreen docs in `docs/` — no date prefix
6. All reports and evidence in `plans/reports/` — always date-prefixed
7. Never use version numbers in evergreen doc filenames — use the doc registry status instead
8. Audience suffix is optional for internal-only docs; mandatory when multiple audience variants exist
