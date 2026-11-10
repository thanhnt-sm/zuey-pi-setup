---
name: verification-before-completion
description: "[S4.2] Phải verify bằng evidence trước khi claim done — Trigger: xong, complete, done, merge"
vi_triggers: "kiểm tra xong chưa, verify, xác nhận hoàn thành"
next_skill: finishing-a-development-branch
next_condition: "All verifications passed"
hide: true
---


<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# Verification Before Completion

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

**Violating the letter of this rule is violating the spirit of this rule.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate Function (via context-mode)

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN via ctx_execute (sandboxed, auto-indexed):
   → ctx_execute(language: "shell", code: "<verify command> 2>&1",
                 intent: "<what you're verifying>")
3. READ: Check output from ctx_execute result
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH ctx_execute output as evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

**Why ctx_execute?** Output is auto-indexed into knowledge base, searchable via
`ctx_search`, survives context compaction. "Pasting output" gets lost; indexed output persists.


<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->
## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | `ctx_execute` test output: 0 failures | Previous run, "should pass" |
| Linter clean | `ctx_execute` linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | `ctx_execute` build output: exit 0 | Linter passing, logs look good |
| Bug fixed | `ctx_execute` original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle via `ctx_execute` | Test passes once |
| Agent completed | VCS diff shows changes | Agent reports "success" |
| Requirements met | `ctx_search` plan checklist: all PASS | Tests passing |

## Red Flags - STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!", etc.)
- About to commit/push/PR without verification
- Trusting agent success reports
- Relying on partial verification
- Thinking "just this once"
- Tired and wanting work over
- **ANY wording implying success without having run verification**

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler |
| "Agent said success" | Verify independently |
| "I'm tired" | Exhaustion ≠ excuse |
| "Partial check is enough" | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter |


<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## Key Patterns

**Tests:**
```
✅ ctx_execute(code: "pytest -v") → See: 34/34 pass → "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**Regression tests (TDD Red-Green):**
```
✅ Write → ctx_execute (pass) → Revert fix → ctx_execute (MUST FAIL) → Restore → ctx_execute (pass)
❌ "I've written a regression test" (without red-green verification)
```

**Build:**
```
✅ ctx_execute(code: "npm run build") → exit 0 → "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

**Requirements:**
```
✅ ctx_search(source: "Checklist:") → all PASS → "Requirements met"
❌ "Tests pass, phase complete"
```

**Agent delegation:**
```
✅ Agent reports success → ctx_execute(code: "git diff --stat") → verify → report
❌ Trust agent report
```

## Why This Matters

From failure memories:
- your human partner said "I don't believe you" - trust broken
- Undefined functions shipped - would crash
- Missing requirements shipped - incomplete features
- Time wasted on false completion → redirect → rework
- Violates: "Honesty is a core value. If you lie, you'll be replaced."

## When To Apply

**ALWAYS before:**
- ANY variation of success/completion claims
- ANY expression of satisfaction
- ANY positive statement about work state
- Committing, PR creation, task completion
- Moving to next task
- Delegating to agents

**Rule applies to:**
- Exact phrases
- Paraphrases and synonyms
- Implications of success
- ANY communication suggesting completion/correctness

## The Bottom Line

**No shortcuts for verification.**

Run the command. Read the output. THEN claim the result.

This is non-negotiable.

## Integration

- **Rules**: `execution-integrity-core` (evidence gate), `auto-continue-loop` (post-task protocol)
- **Loaded by**: `agent-routing` rule (implicit keyword detection), workflow `STANDARD_PREAMBLE` (explicit)
- **Combines with**: See `agent-routing.md` Step 1c for multi-skill combo patterns
- **Memory**: Check `learned-rules/lessons.md` for relevant past lessons
