# Mode: Training Plan & Go-Live Checklist

## 1. Trigger

- Flag: `--go-live`
- Natural language: "go-live checklist", "training plan", "kế hoạch go-live", "chuẩn bị triển khai"

---

## 2. Required Context (Auto-read)

- `docs/pm-stakeholder-map.md` → identify user roles for training audiences
- `docs/pm-uat-plan.md` → confirm UAT passed (warn if not)
- `docs/pm-traceability-matrix.md` → scope of features going live
- `docs/pm-ba-document-status.md` → verify all required sign-offs are in place

**Pre-check:**
```
IF UAT sign-off not in pm-signoff-log.md:
  Warn: "UAT chưa được sign off. Thông thường go-live yêu cầu UAT passed.
         Tiếp tục lên kế hoạch go-live không?"
```

---

## 3. Training Plan Sections

### 3.1 Audience Analysis
For each role identified from stakeholder map:

| Audience | Role | What They Need to Learn | Training Format | Duration |
|----------|------|------------------------|----------------|---------|
| [Role 1] | | | In-person / Video / Self-paced | |

### 3.2 Training Modules per Audience
Group features from traceability matrix by audience relevance.

Invoke `/ck:ask`:
```
Dựa trên features sau sẽ go-live: [FEATURE_LIST]
Và các user roles: [ROLE_LIST]

Xây dựng training plan:
1. Mapping: role → features cần biết
2. Training modules cho mỗi role (tên module, nội dung chính, duration)
3. Delivery format phù hợp cho từng audience
   (in-person cho admin/power users; video cho end users; self-paced guide cho casual users)
4. Sequence: thứ tự training nào trước (prerequisites)
5. Completion criteria: làm sao biết training thành công?

Output: VN language, structured table format
```

### 3.3 Training Schedule
| Ngày | Module | Audience | Trainer | Địa điểm/Link | Duration |
|------|--------|----------|---------|--------------|---------|

---

## 4. Go-Live Checklist

### Phase 1: Pre-Go-Live (D-5 to D-1)

**D-5:**
- [ ] Production environment provisioned and accessible
- [ ] Network/firewall rules verified
- [ ] SSL certificates installed and valid
- [ ] Monitoring and alerting configured
- [ ] Backup schedule confirmed

**D-3:**
- [ ] Data migration dry run completed successfully
- [ ] Integration tests on production environment passed
- [ ] Rollback procedure tested and documented
- [ ] Rollback time target measured: < [X] minutes
- [ ] All Critical/High defects resolved or formally deferred

**D-1:**
- [ ] Final sign-off checklist review with PM + BA + Dev Lead
- [ ] Training completed for all audiences
- [ ] Support team briefed (helpdesk, L1, L2)
- [ ] Communication drafted for stakeholders (go-live announcement)
- [ ] Emergency contact list distributed
- [ ] Go/No-Go meeting scheduled for D-day morning

### Phase 2: Day-of Go-Live (D-day)

**Go/No-Go Meeting (07:00-08:00):**
- [ ] All Pre-Go-Live checklist items confirmed Green
- [ ] No P1/Critical open defects
- [ ] Team availability confirmed for hypercare
- [ ] Rollback decision authority identified

**Deployment Steps (08:00 onwards):**
- [ ] Maintenance window communicated to users
- [ ] Database migration executed
- [ ] Application deployment executed
- [ ] Smoke tests run (critical paths only — <30 min)
- [ ] Integration endpoints verified
- [ ] Performance baseline measured

**Stakeholder Notification (after smoke tests pass):**
- [ ] Go-live announcement sent to all stakeholders
- [ ] Helpdesk ticket routing updated
- [ ] System monitoring dashboard shared with PM

### Phase 3: Post-Go-Live (D+1 to D+5)

**D+1:**
- [ ] Morning review: defect count, performance metrics, user feedback
- [ ] Issue triage: categorize any defects (Critical/High → immediate fix, others → backlog)
- [ ] Support ticket volume review

**D+3:**
- [ ] Performance trend analysis (compare to baseline)
- [ ] User adoption metrics (if measurable)
- [ ] Top 3 issues identified and owned

**D+5:**
- [ ] Hypercare period ends (or extend if Critical issues remain)
- [ ] Lessons learned session scheduled
- [ ] Post-implementation review document started

---

## 5. Rollback Decision Criteria

Trigger rollback when ANY of the following occur:
| Criterion | Threshold | Action |
|-----------|-----------|--------|
| Critical defect in core business flow | Any 1 occurrence | Immediate rollback |
| System unavailability | > 30 minutes | Rollback + incident report |
| Data corruption detected | Any confirmed case | Immediate rollback + DBA alert |
| Integration failure (CBS/core system) | > 15 minutes unresolved | Rollback |
| P1 smoke test failure | Any failure | Stop deployment, assess |
| User error rate | > 20% above baseline | Rollback if unfixable in 2h |

**Rollback Authority:** [PM name] + [Tech Lead name] — both must agree OR either can trigger unilaterally for Critical criteria.

**Rollback Execution Time Target:** < [X] minutes

---

## 6. Outputs

| File | Description |
|------|-------------|
| `docs/pm-go-live-plan.md` | Full go-live plan with checklist |
| `plans/reports/pm-{date}-training-plan.md` | Training plan document |

### Step 6a — Create Documents
Create `docs/pm-go-live-plan.md` with all sections above.
Create `plans/reports/pm-{date}-training-plan.md` with training modules table.

### Step 6b — Journal Entry
Invoke `/ck:journal`:
```
Go-live plan created for [PROJECT_NAME].
Go-live target date: [DATE].
Training: [COUNT] modules for [COUNT] audience groups.
Rollback plan documented. Authority: [NAMES].
```
