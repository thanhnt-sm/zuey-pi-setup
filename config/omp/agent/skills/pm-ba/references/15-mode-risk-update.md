# Mode: Risk Register Update

## 1. Trigger

- Flag: `--risk`
- Natural language: "cập nhật risk", "risk register", "thêm rủi ro mới", "risk mới từ họp"

---

## 2. Risk Schema

| Field | Description | Allowed Values |
|-------|-------------|----------------|
| Risk-ID | Sequential ID | R-001, R-002, ... |
| Category | Risk category | Technical / Business / Integration / Compliance / Resource |
| Description | What could go wrong | Free text (concise, specific) |
| Likelihood | Probability of occurrence | H (>70%) / M (30-70%) / L (<30%) |
| Impact | Severity if it occurs | H (Critical) / M (Significant delay) / L (Minor) |
| Risk Score | Composite score | H×H=Critical / H×M or M×H=High / M×M=Medium / others=Low |
| Trigger | Early warning indicator | "When X happens..." |
| Mitigation | Prevention strategy | Action to reduce likelihood |
| Contingency | Response if risk materializes | Action to reduce impact |
| Owner | Who monitors and responds | Name + role |
| Status | Current state | Open / Mitigated / Closed / Materialized |
| Last Updated | Date of last change | YYYY-MM-DD |

### Risk Score Matrix
```
         Impact
           H      M      L
L i  H  Critical  High   Medium
k e  M  High      Medium Low
e l  L  Medium    Low    Low
l i
i h
h o
o o
o d
d
```

---

## 3. Workflow Steps

### Step 3a — Read Current Context
- Read `docs/pm-risk-register.md` (if exists) to understand current risk landscape
- Read any new context provided by user (meeting notes, document changes, blocker reports)
- Read `docs/pm-ba-document-status.md` for Active Blockers

### Step 3b — Risk Analysis via /ck:ck-scenario
Invoke `/ck:ck-scenario` with:
```
Context/Change: [CONTEXT_PROVIDED]
Existing risks: [SUMMARY OF CURRENT REGISTER]

Phân tích risk:

1. Identify new risks phát sinh từ context này
   Format: { category | description | likelihood | impact | trigger }

2. Đánh giá likelihood và impact cho từng risk mới
   Giải thích rationale

3. Đề xuất mitigation plan cho mỗi risk
   Format: { prevention action | contingency action | recommended owner }

4. Existing risks nào cần update status/likelihood/impact?
   Format: { R-ID | field to change | new value | reason }

5. Risks nào có thể đóng (Closed/Mitigated) dựa trên context mới?

Output: VN language, structured, risk register format sẵn sàng để merge
```

Save scenario output to `plans/reports/pm-{date}-risk-update.md`.

### Step 3c — Merge into Risk Register

**De-duplication rule:** Before adding a new risk, check existing risks for description similarity (>70% same meaning → update existing, do not add duplicate).

Merge process:
1. Assign R-IDs to new risks (continue sequential from last existing ID)
2. Add new risk rows to `docs/pm-risk-register.md`
3. Update existing rows where status/likelihood/impact changed
4. Move closed risks to Closed Risks table

### Step 3d — Generate Risk Delta Report
Create `plans/reports/pm-{date}-risk-update.md` with:
```markdown
# Risk Update Report — [DATE]

## New Risks Added
| R-ID | Category | Description | Score |
| ... |

## Risks Updated
| R-ID | Field Changed | Old Value | New Value |
| ... |

## Risks Closed
| R-ID | Description | Resolution |
| ... |

## Risk Summary
- Total Open Risks: [N]
- Critical: [N] | High: [N] | Medium: [N] | Low: [N]
```

### Step 3e — Risk Heatmap (when ≥5 open risks)
Invoke `/ck:mermaidjs-v11` to generate risk heatmap quadrant:
```
Create risk heatmap quadrant using Mermaid v11 quadrant chart:
- X axis: Likelihood (Low → High)
- Y axis: Impact (Low → High)
- Plot each open risk with R-ID label
- Color: Critical=red, High=orange, Medium=yellow, Low=green
```

### Step 3f — Update State File
Update `docs/pm-ba-document-status.md`:
```
Last Mode Run: risk-update
Last Run Date: [TODAY]
Active Blockers: [update if any risk has materialized]
```

---

## 4. Outputs

| File | Description |
|------|-------------|
| `docs/pm-risk-register.md` | Updated with new + modified risks |
| `plans/reports/pm-{date}-risk-update.md` | Risk delta report |
| Risk heatmap (Mermaid) | Embedded in delta report (when ≥5 risks) |
