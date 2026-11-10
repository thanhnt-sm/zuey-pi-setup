# Skill Routing — Which /ck:* to Use Per Mode + Graceful Degradation

## Primary Skill Routing Table

| Mode | Primary Skills | Secondary Skills | Output Tools |
|---|---|---|---|
| `--brd` | `ck:sequential-thinking` (decompose sections), `ck:ask` (structure requirements) | `ck:mermaidjs-v11` (process flow), `ck:ai-multimodal` (images in doc) | Write (evergreen doc), `ck:preview --slides` (executive summary) |
| `--urd` | `ck:sequential-thinking` (break down user stories), `ck:ask` (structure US+AC) | `ck:mermaidjs-v11` (user journey), `ck:ai-multimodal` (wireframes) | Write (evergreen doc), `ck:preview` (stakeholder view) |
| `--meeting-post` | `ck:sequential-thinking` (parse notes), `ck:ask` (categorize items) | None | Write (report), `ck:preview --slides` (distribution copy) |
| `--meeting-pre` | `ck:ask` (structure agenda), `ck:brainstorm` (prep questions) | `ck:sequential-thinking` (risk items) | Write (agenda doc), `ck:preview` (attendee copy) |
| `--clarify` | `ck:ask` (formulate questions), `ck:sequential-thinking` (prioritize) | None | Write (clarification register) |
| `--cr` | `ck:sequential-thinking` (impact analysis), `ck:ask` (CR structure) | `ck:ck-scenario` (risk of change), `ck:mermaidjs-v11` (before/after flow) | Write (CR log), `ck:preview` (sponsor approval copy) |
| `--signoff` | `ck:ask` (checklist), `ck:sequential-thinking` (readiness check) | None | Write (signoff log), `/ck:journal` |
| `--trace` | `ck:ask` (map relationships), `ck:sequential-thinking` (gap detection) | None | Write (traceability matrix) |
| `--risk` | `ck:ck-scenario` (scenario analysis), `ck:ask` (risk structure) | `ck:sequential-thinking` (mitigation steps) | Write (risk register), `ck:preview` (sponsor view) |
| `--sprint` | `ck:ask` (estimate), `ck:plan` (structure sprint) | `ck:sequential-thinking` (dependency order), `ck:brainstorm` (edge cases) | Write (sprint plan), `ck:preview --slides` (team review) |
| `--uat` | `ck:ask` (test case structure), `ck:sequential-thinking` (coverage analysis) | `ck:mermaidjs-v11` (test flow) | Write (UAT plan), `ck:preview` (client copy) |
| `--go-live` | `ck:plan` (checklist structure), `ck:ask` (training content) | `ck:sequential-thinking` (rollback plan), `ck:brainstorm` (failure scenarios) | Write (go-live doc), `/ck:journal`, `ck:preview --slides` |
| `--status` | `ck:project-management` (status aggregation), `ck:ask` (narrative) | `ck:preview --slides` (client/sponsor), `ck:mermaidjs-v11` (timeline) | Write (status report), `ck:preview` |
| `--diff` | Subagent comparison (two-doc parallel read), `ck:sequential-thinking` (delta analysis) | `ck:mermaidjs-v11` (change flow) | Write (diff report) |
| `--state` | Read `docs/pm-ba-document-status.md` directly, `ck:ask` (summary) | `ck:preview --slides` (dashboard) | Console output + optional write |
| `--kickoff` | `ck:brainstorm` (scope exploration), `ck:ask` (charter structure), `ck:plan` (roadmap) | `ck:mermaidjs-v11` (project timeline), `ck:sequential-thinking` (risk) | Write (charter, RACI, backlog), `/ck:journal` |
| `--data-model` | `ck:ask` (entity structure), `ck:sequential-thinking` (relationship analysis) | `ck:mermaidjs-v11` (ERD diagram) | Write (data model spec), diagram file |
| `--screen` | `ck:ask` (screen spec structure), `ck:sequential-thinking` (interaction flows) | `ck:mermaidjs-v11` (navigation flow), `ck:frontend-design` (if mockup provided) | Write (screen URD) |
| `--template` | `ck:ask` (template scaffolding) | None | Write (template file in `templates/`) |
| `--report` | `ck:project-management` (data aggregation), `ck:ask` (report narrative) | `ck:preview --slides` (presentation format) | Write (report), `ck:preview` |
| `--api` | `ck:ask` (endpoint structure), `ck:sequential-thinking` (contract validation) | `ck:mermaidjs-v11` (sequence diagram) | Write (API spec) |
| `--glossary` | Subagent (term extraction from docs), `ck:ask` (definition structure) | None | Write (glossary, living file) |
| `--backlog` | `ck:ask` (prioritization framework), `ck:sequential-thinking` (dependency ordering) | `ck:plan` (sprint readiness), `ck:brainstorm` (story decomposition) | Write (backlog register), `ck:preview --slides` (team review) |
| `--defect` | `ck:sequential-thinking` (impact analysis), `ck:ask` (severity classification) | `ck:ck-scenario` (failure scenarios) | Write (defect triage report), `ck:preview` (dev/QA copy) |
| `--process-map` | `ck:mermaidjs-v11` (BPMN diagram), `ck:sequential-thinking` (gap analysis) | `ck:brainstorm` (TO-BE options), `ck:ask` (pain point structure) | Write (process map doc), diagram file |
| `--closure` | `ck:ask` (closure checklist structure), `ck:sequential-thinking` (knowledge transfer) | `ck:brainstorm` (lessons learned facilitation) | Write (closure report, lessons learned), `/ck:journal` |
| `--hypercare` | `ck:plan` (hypercare schedule), `ck:ask` (escalation protocol) | `ck:sequential-thinking` (issue triage flow), `ck:ck-scenario` (failure modes) | Write (hypercare plan), `ck:preview --slides` (ops team) |
| `--maintenance` | `ck:project-management` (SLA tracking), `ck:ask` (enhancement intake) | `ck:sequential-thinking` (operational metrics) | Write (SLA report, enhancement log), `ck:preview` (client view) |
| `--release` | `ck:plan` (release checklist), `ck:ask` (release notes per audience) | `ck:sequential-thinking` (rollback criteria), `ck:mermaidjs-v11` (release timeline) | Write (release plan, release notes), `/ck:journal` |
| `--data-migration` | `ck:sequential-thinking` (field mapping, validation rules), `ck:ask` (rollback criteria) | `ck:ck-scenario` (migration failure scenarios), `ck:mermaidjs-v11` (cutover flow) | Write (migration plan), `ck:preview` (dev copy) |
| `--test-case` | `ck:ask` (Given/When/Then structure), `ck:sequential-thinking` (AC-to-TC derivation) | `ck:mermaidjs-v11` (test flow), `ck:brainstorm` (edge cases) | Write (test case register), `ck:preview` (QA/client copy) |
| `--raci` | `ck:ask` (RACI assignment), `ck:sequential-thinking` (communication cadence) | `ck:mermaidjs-v11` (escalation path), `ck:brainstorm` (stakeholder mapping) | Write (RACI doc, comm plan), `ck:preview --slides` (kickoff use) |
| `--estimation` | `ck:ask` (t-shirt sizing), `ck:sequential-thinking` (complexity analysis) | `ck:brainstorm` (risk buffer reasoning), `ck:plan` (capacity breakdown) | Write (estimation table, capacity plan), `ck:preview` (PM/sponsor) |
| `--persona` | `ck:ask` (persona card structure), `ck:sequential-thinking` (journey mapping) | `ck:mermaidjs-v11` (user journey diagram), `ck:brainstorm` (pain points) | Write (persona cards, journey maps), `ck:preview` (stakeholder) |

---

## Graceful Degradation Table

| Missing Skill | Fallback Action | Quality Impact |
|---|---|---|
| `ck:brainstorm` | Use `AskUserQuestion` to elicit user ideas + `ck:sequential-thinking` for decomposition directly | Minimal — slightly less exploratory |
| `ck:sequential-thinking` | Use `ck:ask` with explicit decompose prompt: "Break this into ordered steps" | Minimal — same logic, less structured |
| `ck:ck-scenario` | Use `ck:ask` with risk-analysis prompt: "List scenarios where this fails + impact" | Low — covers main risks, fewer edge cases |
| `ck:mermaidjs-v11` | Use `ck:ask` to produce described flow in text + plain Mermaid syntax (v10 fallback) | Medium — diagram may need manual fix |
| `ck:preview` | Skip visual output; produce markdown report only; log "preview unavailable" | Low — content complete, no rendered view |
| `ck:project-management` | Build status table manually in markdown using state file data | Low — functional, less automated |
| `ck:plan` | Write plan inline as numbered markdown steps within the active mode output | Medium — plan is less structured |
| `ck:ai-multimodal` | Log "image analysis unavailable"; proceed with text-only content from same document | Medium — image content skipped; note in output |
| `ck:frontend-design` | Skip mockup analysis; document screen spec from text description only | Medium — no visual interpretation |
| `ck:journal` | Write a manual session summary to `plans/reports/pm-{YYMMDD}-session-log.md` | Low — log preserved, less automated |

---

## Detection Protocol

Before invoking any sub-skill:

1. Check if the skill name appears in the available-skills list injected in `system-reminder` context.
2. If absent → log the fallback decision: `Fallback: [skill-name] unavailable, using [alternative]`. Include this in the mode's output under a `## Skill Availability` section.
3. Proceed immediately with fallback — do not halt or ask user unless the fallback also fails.
4. If both primary and fallback are unavailable → use `ck:ask` with an explicit prompt as the universal last-resort fallback.

---

## Skill Invocation Syntax

When invoking sub-skills within a pm-ba workflow, use the standard CK invocation pattern:

```
/ck:sequential-thinking [topic or question to decompose]
/ck:ask [structured question or content to format]
/ck:mermaidjs-v11 [diagram description]
/ck:preview --slides [content to render]
/ck:plan [feature or phase to plan]
/ck:journal [session summary text]
```

- Sub-skills receive only the relevant context for their task (see orchestration-protocol.md — Context Isolation Principle)
- Never pass full session history to a sub-skill
- Collect sub-skill output before proceeding to next step; save to disk if >200 lines
