# Sprint Quality Gates — Template

> Phase 07 v1.5. Embedded in Mode 47 §3i Section 5.1.
> 4 gates per sprint cycle: DEV self-test → Peer review → Tester → Pre-UAT.

---

## Gate 1 — DEV Self-Test (per task)

- **When:** Before changing task status to "Ready for Review"
- **Owner:** DEV (task assignee)
- **Pass criteria:**
  - [ ] Build green locally
  - [ ] Smoke test main happy path manually
  - [ ] All ACs visibly executed
  - [ ] No commented-out code / debug print left
- **Fail action:** Cannot promote to Code Review
- **Reference:** Q-WARN-05 (DEV-side smoke test) if Bug Fix % > 12%

---

## Gate 2 — Peer Code Review

- **When:** After Gate 1 pass
- **Owner:** PM assigns; **default = highest-level Senior trong team không phải assignee** (decision Q7.1)
- **Pass criteria:**
  - [ ] Code style + naming consistent
  - [ ] Logic correct against ACs
  - [ ] No obvious security issues
  - [ ] Test coverage adequate
- **Time-box:** 4 working hours from request → approve / reject
- **Fail action:** Return to DEV with comments

PM may override default assignee in Mode 47 confirm step. Document override rationale in task Notes.

---

## Gate 3 — Tester Validation

- **When:** Gate 2 approved + deployed to test env
- **Owner:** QA/Tester
- **Pass criteria:**
  - [ ] All test cases per traceability matrix executed
  - [ ] Bug count < threshold per P-level (P1-P2: 0 bugs / P3+: ≤ 2 minor)
  - [ ] Regression suite pass
- **Time-box:** Per test plan
- **Fail action:** Reopen task; bug_fix_days accumulate

---

## Gate 4 — Pre-UAT Sanity (T-7d before UAT)

- **When:** 7 days before `uat_date_cache.uat_date`
- **Owner:** PM + TL + Customer PM
- **Pass criteria:**
  - [ ] All features in UAT scope: status = Done
  - [ ] Bug Fix % < 12% (else Pattern B / UAT-FREEZE-01)
  - [ ] UAT scenarios documented + reviewed
  - [ ] Environment ready (data + access)
- **Fail action:** Escalate to PD; consider UAT slip

---

## Gate Status Tracking

Append to sprint plan §5.1; update task register column `gate_status: 1|2|3|4|done`.

```
| Task | Gate 1 | Gate 2 | Gate 3 | Gate 4 | Final |
|------|--------|--------|--------|--------|-------|
| T-01 | ✅ 06-05 | ✅ 06-06 An | ✅ 06-08 QA | — | Done |
```
