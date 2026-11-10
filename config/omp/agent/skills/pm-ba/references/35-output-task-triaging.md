# Output Pattern: Three-Track Task Triaging

## When to Apply

After any analysis mode (`--urd`, `--brd`, `--process-map`, Step h) reveals:
- Ambiguous requirements or business rules that block implementation
- Items that are clear enough to implement but need architectural decisions first
- Items with no ambiguity that dev can start immediately

This pattern converts analysis findings into **actionable task assignments** across 3 tracks.

---

## The Three Tracks

### Track A — BA-PXX: Customer-Facing Clarification

**Who:** BA + relevant business stakeholder (CSRR, QLRRTD, Business Owner, KH)  
**What:** Workshop agenda items that resolve ambiguities before implementation commits  
**When:** Items in the ambiguities list where the answer changes the design

**Workshop preparation rules:**
- Group related questions into a single workshop session (max 2h per session)
- Create fill-in tables for workshop participants (not open-ended questions)
- Send pre-read materials 2 days before (reference relevant sections of BRD/URD)
- Capture outputs as decisions that unblock specific DEV-PXX tasks

### Track B — INT-XX: Internal Alignment (Techlead + Solution Architect)

**Who:** Techlead, Solution Architect, sometimes PM or BA  
**What:** Architectural and scope decisions that must be resolved internally BEFORE committing to customer  
**When:** Items where the business requirement is clear but the technical implementation has multiple viable approaches with significant architectural impact

**Ordering rule:** INT-XX items that feed into Track A workshops MUST complete BEFORE the workshop. Never go to customer with unresolved internal technical uncertainty.

### Track C — DEV-PXX: Dev Items (~80% Certain)

**Who:** Dev team (Backend, Frontend, as appropriate)  
**What:** Implementation tasks where the requirement is clear enough to design/build without waiting for clarification  
**When:** Confidence ≥ 80% — the item will be needed regardless of clarification outcomes; any clarification result would be a patch, not a rebuild

**Confidence scoring guide:**
- **≥90%**: Display-only, CRUD, clearly stated requirement, no ambiguous business rules → start now
- **80–89%**: Core logic clear but minor details uncertain → design + implement core, defer edge cases
- **<80%**: Major uncertainty → do NOT start, move to Track A or B first

---

## Output Artifacts

| Artifact | Location | Action |
|----------|----------|--------|
| Track A tasks | `docs/pm-ba-master-task-list.md` → new NHÓM section | Append |
| Track B tasks | `docs/pm-ba-master-task-list.md` → same NHÓM section | Append |
| Track C tasks | `docs/pm-ba-master-task-list.md` → same NHÓM section | Append |
| Workshop agendas (Track A) | `docs/pm-client-working-session.md` → new Workshop N | Append |
| Clarification questions (Track A) | `plans/reports/ba-*-clarification-questions.md` → new Group | Append |
| P0 summary update | `docs/pm-ba-master-task-list.md` → TỔNG KẾT section | Update |

---

## Execution Sequence

```
Analysis complete → Ambiguities identified
        │
        ├─────────────────────────────────────────┐
        ▼                                         ▼
[INT-XX first]                          [DEV-PXX (≥80%)] — start immediately,
resolve internal architecture           runs in parallel throughout
        │
        ▼
[BA-PXX workshops]
clarify with customer, unblock DEV tasks
```

---

## P0 Update Rule

When adding three-track tasks to the master task list, update the **P0 summary** section to include:
- All Track A items with Critical block level (tag: `BA+KH [MỚI]`)
- All Track B items (tag: `Internal [MỚI]`)
- Track C items with confidence ≥85% that should start immediately (tag: `Dev [CÓ THỂ BẮT ĐẦU]`)

---

## Anti-Patterns to Avoid

| Anti-pattern | Why wrong | Correct approach |
|---|---|---|
| Going to customer workshop before INT-XX done | BA can't answer "how would we implement it?" → wastes customer time | Always complete INT-XX before related BA-PXX |
| Including DEV tasks with confidence <80% | Builds wrong things → rework > clarification cost | Move to Track A or B until confidence rises |
| Open-ended questions in Track A workshops | Customers give vague answers → still blocked | Use fill-in tables with predefined options |
| Single mega-workshop for all Track A items | Fatigue, wrong stakeholders in same room | Group by stakeholder, max 2h per session |
| INT-XX items that never complete | Creates false confidence in dev starts | Set hard deadline: INT-XX must complete 1 sprint before related dev |
