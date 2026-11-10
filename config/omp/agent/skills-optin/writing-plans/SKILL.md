---
name: writing-plans
description: "[S2.2] Tạo implementation plan chi tiết, có checkpoint — Trigger: plan, kế hoạch, multi-step task"
vi_triggers: "lập kế hoạch, viết plan, kế hoạch triển khai"
next_skill: executing-plans
next_condition: "Plan approved by user"
hide: true
---


<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Context:** This should be run in a dedicated worktree (created by brainstorming skill).

**Save plans to:** `docs/plans/YYYY-MM-DD-<feature-name>.md`

## Bite-Sized Task Granularity

**Each step produces exactly one artifact: a written test, a passing test run output, a code file, a commit. If a step produces two artifacts, split it.**

**MICRO-TASK RULE**: No task should take more than 5-10 minutes to implement. If it does, it is too big. Split it further.

Every task in the plan MUST include:
1. A clear description of WHAT to do
2. The EXACT files to create/modify
3. The EXACT verification command to run
4. The EXPECTED output of that command
5. A checkpoint checklist:
```
□ File created/modified?
□ Verification command run?
□ Output matches expected?
□ Tests pass?
```

Examples:
- "Write the failing test" - step (artifact: test file)
- "Run it to make sure it fails" - step (artifact: test run output)
- "Implement the minimal code to make the test pass" - step (artifact: code file)
- "Run the tests and make sure they pass" - step (artifact: passing test run output)
- "Commit" - step (artifact: commit)


<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->
## Path Convention

For files that don't exist yet, use paths based on the project's existing naming convention. If no convention exists, document the path convention you're using at the top of the plan.

## Plan Document Header

**Every plan MUST start with this header (including the Guardian Block):**

```markdown
# [Feature Name] Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

> **GUARDIAN BLOCK — READ THIS EVERY TIME YOU OPEN THIS FILE:**
> - You MUST implement ALL tasks below. Do NOT skip any.
> - Before marking a task done: run the verification command and paste output.
> - Re-read this file every 3 tasks to reload context.
> - If tests fail: fix first, re-run, loop until 0 failures.
> - Maintain a progress table: `[done]/[total]` with evidence.
> - Before claiming "all done": count tasks here vs completed. If mismatch → NOT done.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

**Total Tasks:** [N] — Track your progress: [0]/[N] complete

## Context-Mode Integration
- **Source Label**: `Plan: <feature-name>`
- **Verify Commands**: `<test cmd>`, `<lint cmd>`, `<build cmd>`
- **Checkpoint Criteria**: Each task PASS = test green + output verified
- **Batch Report Trigger**: Every 3 tasks

---
```

The Guardian Block is NOT optional. It MUST be present in every plan. When the AI re-reads the plan (as required by execution-integrity rules), it automatically re-reads the Guardian Block, re-injecting enforcement context.

Every plan MUST include a **Flow Overview** section after the header:
```markdown
## Flow Overview
[Step 1] → [Step 2] → [Step 3] → ... → [Final Step]
```
This can be a numbered list or a mermaid diagram. It gives both AI and human a map of the full scope.

## Plan Quality Gate

Before presenting the plan to the user, self-check:
```
□ Every task has exact file paths?
□ Every task has a verification command + expected output?
□ Every task has a checkpoint checklist?
□ Flow Overview covers ALL tasks end-to-end?
□ Total task count is stated in the header?
□ No task takes more than 5-10 minutes?
□ Context-Mode Block present with source label + verify commands?
ALL checked → present plan. ANY unchecked → revise plan first.
```

## Task Structure

Each task MUST be a **self-contained context unit** — containing everything AI needs for THAT task only. When AI reads a task, it gets exactly the right context, not more, not less.

````markdown
### Task N: [Component Name]

> **CONTEXT FOR THIS TASK:**
> - Depends on: [Task N-1 output, or "none"]
> - Expected input state: [what must exist before starting]
> - Expected output: [exact artifact this task produces]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

**Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

**Step 2: Run test → must FAIL**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

**Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

**Step 4: Run test → must PASS**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```

**✅ CHECKPOINT — Task N:**
- [ ] Test written and initially FAILS?
- [ ] Implementation written?
- [ ] Test PASSES? (paste output)
- [ ] Committed?
````

The CONTEXT block at the top of each task prevents AI from losing track of dependencies. The CHECKPOINT at the bottom prevents moving on without verification. Together they form a **self-contained context injection unit**: AI only needs to read THIS task block to know exactly what to do and how to verify.


<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## Plan Validation

Before handing the plan to execution: read it from the perspective of an engineer who has never seen this codebase. Does every task have enough context to start without asking questions? If not, add it.

Checklist:
- Every file path is exact and follows the documented convention
- Every command includes expected output
- Every task's purpose is clear from its name and description alone
- No task assumes knowledge of a prior conversation or undocumented context

## Remember
- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- Reference relevant skills with @ syntax
- DRY, YAGNI, TDD, frequent commits

## Execution Handoff

After saving the plan, **auto-index into context-mode KB:**
```
→ ctx_index(path: "docs/plans/<plan-file>.md", source: "Plan: <feature-name>")
```

Then offer execution choice:

**"Plan complete and saved to `docs/plans/<filename>.md`. Indexed into context-mode KB. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration. **REQUIRED:** Switch Antigravity to **Fast Mode** for this implementation phase.

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?"**

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Load executing-plans
- Stay in this session
- Fresh subagent per task + code review

**If Parallel Session chosen:**
- Guide them to open new session in worktree
- **REQUIRED SUB-SKILL:** New session loads executing-plans

## Integration
- **Rules:** execution-integrity-core (M7 preamble compliance), convergence-enforcer (plan converge)
- **Kết hợp:** confidence-check (verify assumptions), test-driven-development (TDD specs in plan)
- **Memory:** Check `learned-rules/lessons.md` for past plan failures
