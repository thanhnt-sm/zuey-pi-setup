# /ck-council — Multi-Perspective Architecture Decision Council

Run an independent multi-lens architectural review and write a durable ADR decision record using OMP `task` subagents:

1. **Clarify scope & options** up front (`ask` if options/constraints are open; omit if already specified).
2. **Dispatch parallel lenses** in ONE `task` batch (`tasks[]`):
   - `agent: "council-expert"` (Lenses: Architecture/Systems, Security/Boundaries, Performance/Maintainability, UX/Operator simplicity)
   - `agent: "researcher"` (if live codebase/vendor/API verification is required)
3. **Adjudicate & write ADR:** Spawn `agent: "council-adjudicator"` with all lens findings to break ties strictly on verified evidence and save `docs/decisions/ADR-<YYMMDD>-<slug>.md`.
