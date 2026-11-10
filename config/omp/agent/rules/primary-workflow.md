> **OMP Adaptation Note:** Ported read-only from global `~/.claude/rules/`. Map Claude `Agent(...)` -> OMP `task`, `advisorModel` -> `modelRoles.advisor`, and `ai-gate-audit` -> `typesafe-planner` extension.

# Primary Workflow

The core chain is `/ck:plan → /ck:cook → /ck:test → /ck:code-review → /ck:ship → /ck:journal`; see `skill-workflow-routing.md` for which one to start from a given request.

- **Plan**: `planner` (inherits the main session's model) researches and writes phases under `./plans`; parallel research fans out to `researcher` (Sonnet, medium effort).
- **Implement**: each phase is delegated to `Agent(fullstack-developer)` (Sonnet) with its file-ownership list and acceptance criteria. A Fable or Opus main integrates the results rather than editing code itself; a Sonnet main may implement the phase directly — see `orchestration-protocol.md` → Roles.
- **Simplify & test**: `code-simplifier` then `tester` verify the code that will actually be reviewed and merged. On a failure, fix per the tester's recommendation and re-run; escalate to `debugger` (Opus) for an RCA after two failed rounds rather than looping.
- **Review**: `code-reviewer` (Opus) reviews the tested code before merge.
- **Integrate**: follow the plan's API contracts and backwards-compatibility notes; delegate to `docs-manager` when public behavior changed.
- **Debug**: a bug report goes to `debugger` for a root cause and fix proposal; `fullstack-developer` applies the fix, `tester` confirms it.

## Visual Aids

See `development-rules.md` → "Visual Aids" for `/ck:preview` flags and when each applies.
