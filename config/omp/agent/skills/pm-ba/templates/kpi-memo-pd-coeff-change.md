---
type: kpi-memo-pd-coeff-change
project_slug: ""
period: "YYYY-MM"
pm_name: ""
generated_at: "YYYY-MM-DDTHH:MM"
status: pending_pd_signoff       # pending_pd_signoff | approved | rejected | expired
schema_version: "1.5"
---

# Memo PD — Đề Xuất Đổi Hệ Số KPI

**To:** Project Director  
**From:** {pm_name}  
**Project:** {project} ({project_slug})  
**Period:** {period}  
**Date:** {generated_at}

---

## 1. Bối Cảnh

{Tóm tắt project context: scope, sprint progress, lý do trigger đổi hệ số}

## 2. Hệ Số Hiện Tại

| Hệ số | Giá trị hiện tại | Nguồn |
|-------|-----------------|-------|
| S (Project Size) | {S_current} | --kpi-plan lock |
| C (Complexity) | {C_current} | --kpi-plan lock |
| R (Customer Relationship) | {R_current} | --kpi-plan lock |

## 3. Đề Xuất Mới

| Hệ số | Giá trị đề xuất | Lý do |
|-------|------------------|-------|
| S | {S_new} | {S_reason} |
| C | {C_new} | {C_reason} |
| R | {R_new} | {R_reason} |

Validation:
- [ ] S, C, R nằm trong khoảng cho phép (quick-reference §5)
- [ ] Reason ≥ 30 ký tự

## 4. Phân Tích Tác Động

| Metric | Trước | Sau | Delta |
|--------|-------|-----|-------|
| MP_PM tháng này (projection) | {mp_before} | {mp_after} | {delta} |
| Σ MP_PM cross-project | {sum_before} | {sum_after} | {delta_sum} |
| pm_monthly_target gap | {gap_before} | {gap_after} | {delta_gap} |

## 5. Justification chi tiết

{Free text — PM mô tả why this change is needed, bao gồm:}
- Trigger event (CR scope, customer feedback, tech complexity discovery, ...)
- Evidence link (CR-ID, meeting note, email)
- Alternatives considered và lý do reject
- Risk if NOT approved

---

## 6. PD Signoff

**(PD: fill below + commit to Git)**

```
Approved by:    
Date:           
Signature:      <Git commit SHA when this memo is committed; will be verified by --kpi-pending-approve>
Conditions:     <optional — extra constraints PD attaches>
```

Approval status: `pending_pd_signoff`

---

## 7. Next Steps (PM)

Sau khi PD ký:
```
/pm-ba --kpi-pending-approve plans/reports/kpi-memo-pd-coeff-{date}-{slug}.md
```

Memo này archive vào `plans/reports/` permanent — audit trail.

---

## 8. Audit

- Memo created: {generated_at}
- Expires: {generated_at + 30 days}
- Linked pending entry: `ep_history_pending.cr_id = COEFF-{date}-{hash}`
- State file: `docs/pm-ba-kpi-state-{slug}-{period}.md`
