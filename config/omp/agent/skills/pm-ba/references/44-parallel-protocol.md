# Parallel Execution Protocol

## Purpose

Define "parallel" = batched multi-tool-call in a **single Claude response**. NOT subagents. NOT sequential steps.
This protocol is referenced by any mode that batches independent tool calls.

---

## Decision Table

| Condition | Mode |
|-----------|------|
| Step B needs Step A's output | SEQUENTIAL |
| Step B only needs inputs available before A runs | PARALLEL |
| Steps A + B both feed into Step C | PARALLEL(A, B) → SEQUENTIAL(C) |
| ≥ 3 independent artifacts in single mode | PARALLEL by default |
| Any gating criteria met (see below) | SEQUENTIAL fallback |

---

## Dependency Matrix Notation

Every workflow section using parallel execution **must** declare a dependency matrix:

```
| Step | Inputs | Outputs | Depends On |
|------|--------|---------|------------|
| X.1  | ...    | ...     | —          |
| X.2  | ...    | ...     | —          |
| X.3  | X.1+X.2| ...     | X.1, X.2  |
```

- `Depends On = —` means the step can run in parallel
- All steps with `Depends On = —` form the parallel batch
- Steps with dependencies run sequential after the batch

---

## Execution Pattern

```
"Run Step X, Y, Z in parallel batch"
= ONE Claude response with 3 tool calls issued simultaneously.
```

System prompt rule (implicit): "make all independent tool calls in the same response."

Do NOT issue dependent calls in the same batch — issue them after batch results are received.

---

## Gating Criteria (Fall Back to Sequential When ANY of These Fire)

| Gate | Condition | Log Message |
|------|-----------|-------------|
| G1 | Combined parallel prompts > 8000 tokens | "G1: batch too large, falling back to sequential" |
| G2 | Same sub-skill called > 5× in single batch | "G2: sub-skill overload, falling back to sequential" |
| G3 | ≥ 2 parallel steps write to the same state file section | "G3: write contention, falling back to sequential" |
| G4 | User passes `--sequential` flag | "G4: sequential mode requested" |

On any gate: log reason, proceed sequentially. Do NOT silently skip.

---

## Anti-Patterns

| ❌ Do NOT | ✅ Do Instead |
|-----------|-------------|
| Use Task-tool subagents for "parallel" within a mode | Batch tool calls in single response |
| Declare parallel without a dependency matrix | Always write dependency matrix first |
| Write to same file/section from parallel steps | Collect results, single consolidated write |
| Mix sequential and parallel without comment | Label clearly: "PARALLEL(X,Y) → SEQUENTIAL(Z)" |

---

## State Write Safety

After any parallel batch:
1. **Single consolidated state-file write** after full batch completes — never per-step
2. **Single consolidated output-registry update**

This guarantees Invariant #9 (no silent overwrites) and Invariant #15 (output registry).

---

## Modes Using Protocol

| Mode | Parallel Steps | Reference Section |
|------|---------------|-------------------|
| `--meeting-pre` | Step 0.1–0.4 (scan 4 sources) | `09-mode-meeting.md § Step 0` |
| `--brd` | Step c BƯỚC 1-3 (FR/NFR/BR extractions) | `02-mode-brd-analysis.md § Step c` |
| `--cr` | Step 4b Bước 1-4 (impact sub-analyses) | `12-mode-change-request.md § Step 4b` |
| `--raci --capability-map` | Step 4c (expertise per stakeholder) | `43-mode-capability-map.md § Step 4c` |
