# Stakeholder Output Matrix — Per-Stakeholder Format, Tone, Template, Tools

> Reference file for Claude when executing pm-ba skill outputs.
> Every artifact produced by pm-ba MUST declare a `stakeholder:` field in frontmatter.
> This matrix defines what that field means for each audience segment.

---

## 1. Matrix Overview

Every pm-ba output artifact must begin with YAML frontmatter that declares its stakeholder target:

```yaml
---
stakeholder: client | vendor | dev | tester | sponsor | auditor | internal
type: status-report | meeting-minutes | requirement | test-case | sign-off | glossary
---
```

The `stakeholder:` field drives:
- Language selection (VN formal / VN+EN technical / EN)
- Tone and register (business narrative / technical direct / executive crisp)
- Output format (prose / tables / slides outline)
- Which template to instantiate
- Which tool to invoke after generation

Claude must check this field before generating any content and apply the rules in the table below without exception. When the user does not specify a stakeholder, default to `internal` and ask for confirmation before distributing.

---

## 2. Stakeholder Profiles

| Stakeholder | Label | Language | Tone | Format | Template | Tools | Output Suffix |
|---|---|---|---|---|---|---|---|
| Client / Party A ([CLIENT] Business) | `client` | Vietnamese formal | Business-language, no technical jargon, full sentences | Narrative + tables + visual | tpl-status-client.md | `/ck:preview --slides` | `-client` |
| Vendor / Party B (FlexCPC) | `vendor` | VN + EN technical | Direct, precise, technical terms OK | Tables + Mermaid diagrams | tpl-status-vendor.md | `/ck:mermaidjs-v11` | `-vendor` |
| Dev Team | `dev` | EN/VN technical | Concise, imperative, sacrifice grammar | Markdown tables + task lists | tpl-status-dev.md | None (raw markdown) | `-dev` |
| Tester / QA | `tester` | EN/VN structured | Structured, unambiguous, explicit | Tables (AC + TC + expected) | tpl-test-case-bridge.md | None | `-tester` |
| Sponsor / Steering Committee | `sponsor` | Vietnamese executive | Crisp, KPI-focused, top-3 metrics only | Slides outline | tpl-status-sponsor.md | `/ck:preview --slides` | `-sponsor` |
| Auditor / Regulator | `auditor` | Vietnamese formal | Compliance, complete, traceable | Versioned + cross-referenced | tpl-signoff-log + tpl-traceability-matrix | `/ck:preview --html` | `-auditor` |
| BA/PM Internal | `internal` | VN/EN verbose | Complete, audit trail, all details | Full markdown, no filtering | All templates | None | `-internal` |

---

## 3. Language Switching Rules

**Default language:** Vietnamese for all client-facing and sponsor content.

**Switch to English for:**
- Dev team technical documentation (inline EN comments, field names, API specs)
- Vendor API specifications and integration notes
- International standards references (ISO dates, OWASP, IEEE, etc.)
- System/code identifiers (endpoint paths, field names, error codes)

**Bilingual formatting rules:**
- Never mix VN and EN in the same prose paragraph
- Use table rows for bilingual side-by-side content (column: VN | EN)
- Technical terms without a natural VN equivalent: use EN term with VN explanation in parentheses on first occurrence
- After first occurrence, use the term as-is per audience language rule

**Example — correct bilingual table row:**

| Tính năng | Feature | Mô tả / Description |
|-----------|---------|---------------------|
| Phê duyệt khoản vay | Loan Approval | CBTD duyệt hồ sơ sau khi xét nghiệm / Credit officer approves after assessment |

---

## 4. Output Format Details per Stakeholder

### `client` — [CLIENT] Business Stakeholders

- Open with formal salutation: `Kính gửi [Tên], [Chức vụ]`
- Use narrative prose for top-level summaries — never raw bullet lists as the primary structure
- Section order (mandatory): Summary → Achievements → Upcoming → Decisions Needed → Risks
- Progress bars: use Unicode block characters `■■■□□` (10-block scale)
- Tables: Vietnamese column headers; dates in DD/MM/YYYY format
- Avoid all technical terms: do not write "sprint", "API", "backend", "deployment", "commit"
- Approved substitute terms: "giai đoạn phát triển" (sprint), "kết nối hệ thống" (API integration), "máy chủ" (server), "phát hành" (deployment)
- Sign with PM name, email, phone — always

### `vendor` — FlexCPC Technical Team

- Lead with a progress summary block (% completion, current phase, sprint number)
- Table-first structure: minimize prose
- Open action items must be explicitly listed with a "ACTION REQUIRED" flag in section header
- Technical specs in English (field names, endpoint paths, payload structures)
- Dates in ISO 8601 format: YYYY-MM-DD
- Blockers section is mandatory — never omit even if empty (write "No blockers this period")
- Include integration status table covering all active APIs/systems

### `dev` — Development Team

- Compact table format — sacrifice prose for density
- Every story must reference: US-ID, story points (SP), assignee, status, blocker
- Status values (use exactly): ✅ Done | 🔄 In Progress | ❌ Blocked | ⏸ Paused | 🔍 In Review
- Sprint linkage mandatory: every item links to sprint number
- Priority flags: P0 (critical/blocker), P1 (this sprint), P2 (next sprint), P3 (backlog)
- "Ready for QA handoff" section must be present with branch name
- "Decisions Needed from PM/BA" section prevents the team from self-deciding scope

### `tester` — QA Team

- One row per acceptance criterion (AC), not per user story
- Format: AC-ID | Acceptance Criterion | Test Case ID | Test Steps | Test Data | Expected Result | Pass/Fail
- Use Given/When/Then structure for every test case description
- Test data requirements must be explicit (no "sample data" — specify actual values or data schema)
- Environment requirements: staging / UAT / production — state explicitly
- Entry criteria and exit criteria must be defined for each test cycle
- Defect severity scale: Critical | High | Medium | Low — define in glossary section

### `sponsor` — Steering Committee / Executive Leadership

- Maximum 5 slides — violating this breaks the format contract
- Slide 1: KPI Dashboard (traffic-light status for 3-5 KPIs only)
- Slide 2: Milestone Status (milestone table, RAG status per milestone)
- Slide 3: Top 3 Risks (no more than 3 — summarize if more exist)
- Slide 4: Decisions Required (items needing steering committee resolution)
- Slide 5: Next Period Plan (3 bullet points maximum)
- No implementation details, no technical terms, no sprint references
- Financial data: show budget consumed vs. allocated only if pre-approved for this audience

### `auditor` — Internal Auditor / SBV Regulator

- Document must include version history table at the top
- All referenced documents must include: document ID, version, date, author, approval status
- Change log required: list all changes since previous version with timestamp and author
- Compliance checklist section: map each deliverable to the relevant regulatory requirement or contract clause
- Cross-references must be explicit (e.g., "See Section 3.2, v2.1 of [document-id]")
- Output format: HTML (via `/ck:preview --html`) for archivable, browser-viewable record
- Signatures/sign-off references must be cited even if digital

### `internal` — BA/PM Working Documents

- No filtering of any kind — all data, all risks, all concerns, raw state
- Include version history
- Include reasoning and decision rationale (not just decisions)
- Include open questions, uncertainties, assumptions
- Include links to source documents, Jira tickets, meeting recordings
- This audience label is the only one where unresolved issues are explicitly listed

---

## 5. Tools Invocation per Stakeholder

After generating the markdown artifact, Claude must invoke additional tools for visual rendering based on stakeholder:

| Stakeholder | Post-generation Tool | Invocation |
|---|---|---|
| `client` | Slide deck for presentation | `/ck:preview --slides "[content or file path]"` |
| `sponsor` | Slide deck for steering committee | `/ck:preview --slides "[content or file path]"` |
| `vendor` | Mermaid timeline / technical flow | `/ck:mermaidjs-v11 "[diagram description]"` |
| `auditor` | Archivable HTML report | `/ck:preview --html "[content or file path]"` |
| `dev` | None — raw markdown output | — |
| `tester` | None — raw markdown output | — |
| `internal` | None — raw markdown output | — |

**Invocation timing:** Always generate the full markdown artifact first, save it, then invoke the tool. Never invoke tools on partial drafts.

**Failure handling:** If a tool invocation fails, deliver the raw markdown and note: `[Tool invocation failed — deliver markdown directly]`.

---

## 6. Privacy and Sensitivity Rules

These rules are non-negotiable and apply regardless of user instruction:

| Data Category | Authorized Audience | Restricted From |
|---|---|---|
| Risk Register (full detail with likelihood × impact) | `internal` only | All external stakeholders |
| Top 3 Risks summary (sanitized) | `client`, `sponsor` | `vendor` (unless risk involves vendor) |
| Financial / budget detail | `sponsor` only (if pre-approved) | `client`, `vendor`, `dev`, `tester` |
| Source code, database schemas, API keys | `dev`, `auditor` only | `client`, `sponsor`, `vendor` (business) |
| Internal BA analysis, assumptions log | `internal` only | All other stakeholders |
| Vendor SLA details / penalty clauses | `internal`, `auditor` | `vendor` (do not share penalty clauses with vendor) |
| System architecture diagrams (detailed) | `dev`, `auditor`, `vendor` | `client`, `sponsor` (use high-level diagram only) |
| Meeting raw notes / unedited minutes | `internal` only | All other stakeholders |

**Escalation rule:** If the user requests content that violates these rules (e.g., "send the full risk register to the client"), Claude must flag the violation, explain the reason, and offer a compliant alternative (e.g., the sanitized Top 3 Risks version).

**Labeling rule:** Every output file must include the `stakeholder:` frontmatter label so downstream consumers know the intended audience. Files labeled `internal` must never be attached to external communications.
