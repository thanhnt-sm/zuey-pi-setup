# /ck-red-team — Adversarial 4-Lens Review

Stress-test a plan, subsystem, or diff from 4 hostile independent perspectives before execution:

1. **Dispatch 4 parallel hostile reviewers** in ONE `task` batch (`tasks[]`):
   - Security / Boundary Leak Lens (`agent: "security-reviewer"`)
   - Failure Modes / Edge-Case Lens (`agent: "code-reviewer"`)
   - Performance / Token & Cross-OS Cost Lens (`agent: "code-reviewer"`)
   - Architecture / Simplicity Lens (`agent: "reviewer"`)
2. **Adjudicate & remediate:** Deduplicate findings across all 4 lenses, rank by severity (`Critical` -> `High` -> `Medium` -> `Low`), and patch plan/code directly until zero unresolved blockers remain.
