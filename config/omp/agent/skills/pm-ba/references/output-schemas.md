# Output Schemas — Standard Artifact Formats

All modes producing output files MUST use these schemas. Schema = content structure; naming conventions are in `references/artifact-naming.md`.

---

## § One-Page Summary Format

Max 300 words. Required fields:

| Field | Content |
|-------|---------|
| **Project / Module** | Short name |
| **Document Analyzed** | Source doc name + version |
| **Date** | YYYY-MM-DD |
| **Scope** | 1-2 sentence description of what is covered |
| **Key Findings** | 3-5 bullet points (FACT/INFERRED/ASSUMED labeled) |
| **Top Risks** | 2-3 highest-impact risks |
| **Recommended Next Step** | Single action with owner |

Example row: `• [INFERRED] Module thanh toán thiếu 3 NFR về performance — cần làm rõ SLA`

---

## § Function Table Schema

| Name | Description | Acceptance Criteria | Priority | Estimate |
|------|-------------|---------------------|----------|----------|
| `FR-XXX: Short label` | What the function does | 1-line summary or link AC-XXX | Must/Should/Could | S/M/L/XL |

**Constraints:** Every row must have FR-XXX ID. Priority uses MoSCoW. Estimate uses T-shirt sizing (S≤3d, M≤1w, L≤2w, XL>2w).

---

## § Backlog Row Schema

| User Story | Acceptance Criteria | Priority | Estimate | Dependency |
|------------|---------------------|----------|----------|------------|
| US-XXX: As a [role], I want [action] | AC-XXX (min 2 per story) | P1/P2/P3 | story points or S/M/L | US-XXX or none |

**Constraints:** Min 2 AC per US (1 happy path + 1 edge/negative). Dependency = blocking US-XXX or "none".

---

## § Risk-Mitigation Table

| Risk | Impact | Probability | Mitigation | Owner |
|------|--------|-------------|------------|-------|
| Description of risk event (FACT/INFERRED/ASSUMED) | H/M/L | H/M/L | Action to reduce likelihood or impact | Role or name |

**Constraints:** FACT/INFERRED/ASSUMED label required on each risk row. Owner must be a named role or person.

---

## § Clarification Question Format

| Category | Question | Priority | Assigned To |
|----------|----------|----------|-------------|
| functional / data / security / timeline / decision | Q-XXX: Specific question text | must-clarify / should-clarify / could-clarify | Stakeholder role or name |

**Constraints:** Q-XXX IDs sourced from clarification register. Category must be one of the 5 listed values.

---

## § Missing Info Report

| Section | Gap | Collection Method | Responsible |
|---------|-----|-------------------|-------------|
| Doc section or module name | What information is absent | interview / document-request / workshop | Role or name |

**Constraints:** Each gap row must link to a Q-XXX in `docs/ba-clarification-register.md`.

---

## § Data Classification 4-Tier

| Tier | Label | Description | Handling Rules | Processing Environment |
|------|-------|-------------|----------------|------------------------|
| 1 | **public** | Freely accessible; no harm if exposed | No special controls; may be published | Any environment |
| 2 | **internal** | Staff-only access; minor harm if leaked | Role-based access; not for external sharing | Private network or intranet |
| 3 | **confidential** | Regulated data; significant harm if leaked (PII, financial records) | Encrypted at rest + in transit; access logging; need-to-know | Private cloud or on-prem; audit trail required |
| 4 | **secret** | Critical secrets; catastrophic if leaked (credentials, crypto keys, core algorithms) | Air-gapped or HSM-protected; dual-approval; full audit trail | Air-gapped system or HSM only |

**AI auto-mapping note:** AI assigns tiers based on domain context (banking, healthcare, logistics). Classifications are labeled INFERRED unless a policy document explicitly states the tier (FACT). Unverifiable assignments are labeled ASSUMED and auto-generate Q-XXX clarification items.
