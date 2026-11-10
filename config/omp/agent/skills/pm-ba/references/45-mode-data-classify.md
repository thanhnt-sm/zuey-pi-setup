# Mode: Data Classification (`--data-classify`)

## 1. Trigger

Activated when:
- CLI flag `--data-classify` is provided
- Natural language: "phân loại dữ liệu", "data classification", "loại dữ liệu nào cần bảo mật", "classify data entities", "data sensitivity"

---

## 2. Input Options

| Option | Description |
|--------|-------------|
| **Option A — Document path** | BRD/URD/contract file → AI extracts entities first, then classifies |
| **Option B — Inline entity list** | User provides list of entities/fields → AI classifies directly |

If no input provided → invoke `AskUserQuestion`:
- "Cung cấp đường dẫn tài liệu (BRD/URD/contract)"
- "Nhập danh sách entities/fields trực tiếp"

---

## 3. Workflow Steps

### Step 1 — Entity Extraction (Option A only)

If input is a document path:
1. Ingest per `references/document-ingest-protocol.md`
2. Extract all data entities: fields, objects, personas, system names, external integrations
3. Save entity list to context before proceeding to classification

If input is an inline entity list (Option B): skip to Step 2.

### Step 2 — Domain Detection

Identify domain from document context using keyword heuristics:

| Domain | Signal Keywords |
|--------|----------------|
| banking | tín dụng, khoản vay, lãi suất, tài khoản, giao dịch, ngân hàng, credit, loan, account, transaction |
| healthcare | bệnh nhân, chẩn đoán, đơn thuốc, patient, diagnosis, prescription, medical record |
| logistics | vận chuyển, lô hàng, tuyến đường, shipment, route, manifest, warehouse |
| generic | applies when no domain keywords detected |

Domain affects tier assignment reasoning (e.g., account numbers are confidential in banking; GPS coordinates may be internal in logistics).

### Step 3 — Tier Assignment

For each entity, assign a tier from `references/output-schemas.md § Data Classification 4-Tier`:

| Tier | Label | Reasoning Pattern |
|------|-------|-------------------|
| 1 | public | Published rates, product names, public-facing content |
| 2 | internal | Staff IDs, internal codes, non-published process rules |
| 3 | confidential | Customer PII, financial records, regulated data |
| 4 | secret | Credentials, encryption keys, core scoring algorithms |

**Banking domain examples (representative, not exhaustive):**

| Entity | Tier | Reasoning |
|--------|------|-----------|
| Interest rates (published) | public | Available on bank website |
| Staff employee ID | internal | Staff-only; minor harm if leaked |
| Customer name / DOB | confidential | PII — regulated under data protection laws |
| Account number | confidential | Financial identifier; significant harm if leaked |
| Transaction amount | confidential | Financial record; need-to-know |
| Credit scoring model logic | secret | Core competitive algorithm; catastrophic if leaked |
| Database credentials | secret | Direct system access; catastrophic if leaked |

### Step 4 — Evidence Labeling

Every tier assignment carries an evidence label:

| Label | When | Requirement |
|-------|------|-------------|
| FACT | Policy document explicitly states the classification | Cite doc + section |
| INFERRED | AI reasons from domain knowledge + entity type | State reasoning chain |
| ASSUMED | No policy context; AI cannot determine with confidence | Auto-create Q-XXX |

If confidence < 70% for a tier assignment → label ASSUMED + generate Q-XXX in clarification register.

### Step 5 — Processing Environment Recommendations

Reuse handling rules from `references/output-schemas.md § Data Classification 4-Tier`. Add project-specific notes where domain context provides additional constraints.

### Step 6 — Output Generation

Produce classification report:

```markdown
## Data Classification Report — {Project/Module}
**Date:** YYYY-MM-DD | **Domain:** {detected domain} | **Source:** {document or "inline entity list"}

### Classification Table
| Entity | Tier | Label | Handling Rules | Environment | Evidence |
|--------|------|-------|----------------|-------------|----------|
| ...    | confidential | INFERRED | Encrypted at rest + in transit; access logging | Private cloud | Domain knowledge: banking PII |

### Gap List — ASSUMED Items
Entities where tier is ASSUMED → require policy clarification before use in production:
| Entity | Q-XXX | Question |
|--------|-------|---------|

### Integration Note
→ Use this output in `--sprint-zero` Phase 4 (Data Classification step).
→ Review ASSUMED items with security/compliance team before finalizing.
```

### Step 7 — Write State + Output Registry

- Save report to `docs/pm-data-classification.md` (living doc, not timestamped — updated in place)
- Update `docs/pm-ba-document-status.md` (cross-cutting write-back)
- Update `docs/pm-ba-output-registry.md`

---

## 4. Outputs

| Artifact | Location | Description |
|----------|----------|-------------|
| Data classification report | `docs/pm-data-classification.md` | Living doc — entity table + gaps + recommendations |
| Q-XXX items for ASSUMED | `docs/ba-clarification-register.md` | Clarification items for unverified classifications |
| State update | `docs/pm-ba-document-status.md` | Mode run recorded |

---

## 5. Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| AI mis-classifies sensitive data | Default INFERRED label; user must confirm before production use |
| Over-classification (everything "secret") | Calibrate with domain examples; use published-vs-regulated spectrum |
| Insufficient context → shallow output | If confidence <70% → ASSUMED + Q-XXX; do not guess |
