# /ck-parallel — Parallel Phase Execution

Execute independent plan phases concurrently without file collisions using OMP `task` subagents:

1. **Verify disjoint ownership** across target `phase-NN-*.md` files before spawning.
2. **Parallel implementers:** Dispatch one `task` batch of `agent: "fullstack-developer"` (with `isolated: true` when phases run concurrently in worktrees) — one slice per independent phase, keeping shared contracts in `context`.
3. **Integration & verification:** Run the full build/test suite once after slices merge cleanly.
4. **Review gate:** Dispatch `agent: "code-reviewer"` on the combined diff before updating plan status.
