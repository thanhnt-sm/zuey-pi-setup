# Mode: Sprint-Zero Orchestrator (`--sprint-zero`)

## 1. Trigger

Activated when:
- CLI flag `--sprint-zero` is provided
- Natural language: "sprint 0", "bắt sprint 0", "artefact đầy đủ", "khởi động sprint zero", "full project kickstart", "sprint zero artifacts"

---

## 2. Required Input

| Slot | Description | Prompt if Missing |
|------|-------------|-------------------|
| `brd_urd_path` | Path to BRD and/or URD file/folder | "Cung cấp đường dẫn BRD/URD (mandatory):" |
| `project_name` | Project name (for output file naming) | Infer from filename or ask |
| `deadline` | Sprint 0 deadline or target date | "Deadline cho sprint 0 (YYYY-MM-DD hoặc TBD):" |

Metadata header in inline input is also accepted (see `references/document-ingest-protocol.md § Inline Text Input`).

---

## 3. Orchestration Chain

Design principle: routing logic only. Each step invokes the corresponding sub-mode — no business logic is duplicated here.

### Checkpoint Format (used at every step boundary)

```
✅ Step N hoàn thành: [artefact-path]
Ước tính Step N+1: [X phút]
→ Tiếp tục [Step N+1: Name]? [Y = tiếp tục | n = dừng | skip = bỏ qua step này]
```

`skip` option: if the artefact for this step already exists in the output registry → offer skip automatically. No redo unless `--force`.

### Step 1 — BRD Full Analysis

Invoke: `--brd` (full mode, not `--quick`)
Output: `docs/ba-brd-analysis.md` + clarification register seeded

```
✅ Step 1 hoàn thành: docs/ba-brd-analysis.md
→ Tiếp tục Step 2 (Backlog)?
```

### Step 2 — Backlog Generation

Invoke: `--backlog` using user stories from Step 1
Output: prioritized backlog with story points

```
✅ Step 2 hoàn thành: plans/reports/ba-{date}-backlog-{slug}.md
→ Tiếp tục Step 3 (Test Cases)?
```

### Step 3 — Test Cases

Invoke: `--test-case` using backlog items from Step 2
Output: BA test cases per AC

```
✅ Step 3 hoàn thành: plans/reports/ba-{date}-test-cases-{slug}.md
→ Tiếp tục Step 4 (Data Classification)?
```

### Step 4 — Data Classification

Invoke: `--data-classify` using entities from Step 1 BRD analysis
Output: `docs/pm-data-classification.md`

```
✅ Step 4 hoàn thành: docs/pm-data-classification.md
→ Tiếp tục Step 5 (RACI + Communication Plan)?
```

### Step 5 — RACI + Communication Plan

Invoke: `--raci` using stakeholders identified in Step 1
Output: RACI matrix + communication plan

```
✅ Step 5 hoàn thành: plans/reports/pm-{date}-raci-{slug}.md
→ Tiếp tục Step 6 (NFR + Go-Live Prep)?
```

### Step 6 — NFR Generation (Inline — no separate mode)

Generate NFR section directly from BRD context. No sub-mode invoked.

**NFR categories to cover:**

| Category | What to extract/infer |
|----------|-----------------------|
| Performance SLA | Response time targets, throughput, concurrent users |
| Availability | Uptime %, maintenance windows, disaster recovery |
| Security compliance | Authentication, authorization, encryption, audit logging |
| Scalability | Growth projections, peak load estimates |
| Integration | External systems, API SLA, timeout constraints |

**Evidence labeling:** All NFR items labeled INFERRED (from BRD context) unless policy/contract states otherwise (FACT). Unverifiable items → ASSUMED + Q-XXX.

```
✅ Step 6 hoàn thành: embedded in sprint-0 summary report
Sprint-0 bundle hoàn thành. Tạo Summary Report...
```

### Sprint-0 Summary Report

Generated at the end of all steps. Saved to `plans/reports/pm-{date}-sprint-zero-summary-{slug}.md`.

Structure:
```markdown
# Sprint-0 Summary Report — {ProjectName}
**Date:** YYYY-MM-DD | **Deadline:** {deadline}

## Artefact Index
| Step | Artefact | Path | Status |
|------|----------|------|--------|

## Conflict List
Cross-artefact inconsistencies detected (e.g., stakeholder in RACI not in BRD scope):
| Conflict | Source A | Source B | Recommended Action |

## Top 5 Questions Before Sprint 1
Highest-priority Q-XXX items that block sprint 1 execution:
1. Q-XXX: ...
2. Q-XXX: ...
...

## Optional Next Step
→ Run `--go-live` for go-live preparation checklist (if timeline is known).
```

---

## 4. Partial Resume Protocol

State is persisted in `docs/pm-ba-document-status.md` using `sprint_zero_*` fields (see `references/state-and-continuity.md § Sprint-Zero State Fields`).

On session resume, if `sprint_zero_active: true`:
1. Read `sprint_zero_completed_steps` — determine which steps are done
2. Present resume prompt:
   ```
   Sprint-0 đang chạy. Đã hoàn thành steps: {list}.
   Step tiếp theo: Step {N} — {name}.
   Tiếp tục? [Y/n]
   ```
3. If user confirms → resume from `sprint_zero_current_step`
4. If user says no → ask: "Dừng sprint-0? State sẽ được giữ lại để tiếp tục sau."

---

## 5. Skip Logic

Before running each step, check output registry (`docs/pm-ba-output-registry.md`):
- If artefact for this step exists AND source input is unchanged → offer skip:
  ```
  Step N artefact đã tồn tại: {path} (nguồn: {input}, chưa thay đổi).
  → Skip step này? [Y = skip | n = chạy lại | --force = bắt buộc chạy lại]
  ```
- If `--force` flag on the orchestrator → skip all skip offers, rerun all steps

---

## 6. Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| User interrupt mid-chain | `sprint_zero_*` state fields enable resume from any step |
| Sub-mode interface change breaks chain | Orchestrator invokes by flag + input only — not coupled to internals |
| NFR quality low (no dedicated mode) | INFERRED labeling mandatory; user reviews before commitment |
| Session too long → user fatigue | Skip option + partial run; step time estimates shown at each checkpoint |
