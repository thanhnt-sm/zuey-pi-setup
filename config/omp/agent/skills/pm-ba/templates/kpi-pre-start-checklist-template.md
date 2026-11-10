# Sprint Pre-Start Checklist — Template

> Phase 07 v1.5. Embedded in Mode 47 §3i Section 7. Pre-sprint readiness gate.

---

## A. KPI Readiness

- [ ] Sprint plan ep_monthly_capacity calculated; team utilization 80-100%
- [ ] Coefficients S/C/R confirmed (PD signoff for current period)
- [ ] Q_target set (default 1.0)
- [ ] Multi-month aggregate refreshed (`aggregate_cache.refreshed_at` < 24h old)
- [ ] UAT date cached from `docs/pm-uat-schedule.md`
- [ ] No pending CRs blocking sprint start (`ep_history_pending` count = 0 OR all approved)

## B. Technical Readiness

- [ ] Dev environment available for all team members
- [ ] Codebase main branch building green
- [ ] Test environment provisioned
- [ ] Database schema migrations ready (if any)
- [ ] External integration credentials valid (API keys not expiring during sprint)
- [ ] Access to required tools (Jira / GitHub / monitoring) confirmed

## C. Quality Readiness

- [ ] Acceptance Criteria documented for all sprint tasks (link in task register Notes)
- [ ] Test cases drafted for P5+ tasks
- [ ] Code review rotation assigned (Gate 2 defaults per kpi-quality-gates-template.md)
- [ ] Bug triage cadence agreed (daily standup if Q-WARN-04 active)
- [ ] Test coverage baseline known

## D. Communication Readiness

- [ ] Standup time + channel confirmed
- [ ] Weekly --kpi-track day-of-week agreed (typically Friday)
- [ ] Stakeholder communication plan (Customer PM cadence, PD report cadence)
- [ ] Escalation path documented (when to memo PD)
- [ ] Coaching schedule (if `dev_tq_history` step ≥ 1 for any DEV)

---

## Sign-off

```
PM:                    Date:
TL (if separate role): Date:
QA Lead:               Date:
```

Block sprint start if any section < 80% checked. Document blockers in `plans/reports/pm-blocker-{date}.md` and create CR if needed.
