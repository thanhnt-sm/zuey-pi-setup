---
name: executing-plans
description: "[S2.3] Thực thi plan từ session trước, có review gate — Trigger: execute plan, tiếp tục plan"
vi_triggers: "triển khai kế hoạch, thực thi plan, execute"
next_skill: requesting-code-review
next_condition: "All tasks completed"
hide: true
---


<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# Executing Plans

## Overview

Load plan, review critically, execute tasks in batches, report for review between batches.

**Core principle:** Batch execution with checkpoints for architect review.

**Announce at start:** "I'm using the executing-plans skill to implement this plan. **REQUIRED:** Ensure Antigravity is set to **Fast Mode** for efficient execution."

## Step 0: Prerequisites

**STOP if:**
- (a) You are on main or master branch without explicit user instruction
- (b) There are uncommitted changes not related to this plan

Resolve both conditions before proceeding. Never start implementation on main/master branch without explicit user instruction.

## Checkpoint Configuration

```
DEFAULT_CHECKPOINT_FREQUENCY = 3   # Report every 3 tasks
# Override in plan frontmatter:
# ---
# checkpoint_every: 5
# ---

# Agent reads plan YAML frontmatter to get custom checkpoint_every value
# If not specified → use DEFAULT (3)
```


<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->
## The Process

> **Note:** This skill's gates mirror `/implement` workflow. See [implement.md](file:///Volumes/Data/101.AI/Partition/SuperAntigravity-Workspace/.agent/workflows/implement.md) for the canonical gate definitions. Keep them in sync.

### Step 1: Load and Review Plan
1. Read plan file using `view_file`
2. **INDEX the plan into context-mode knowledge base:**
   ```
   → ctx_index(path: "<plan-file-path>", source: "Plan: <feature-name>")
   ```
3. **VERIFY Guardian Block exists** at the top of the plan. If missing → STOP, add it.
4. **Read the Guardian Block aloud** (quote it in your response). This re-injects enforcement context.
5. Review critically — identify questions or concerns
6. If concerns: Raise them with your human partner before starting
7. If no concerns: Create progress tracker and proceed
8. **INDEX initial checklist** into KB:
   ```
   → ctx_index(content: "## Checklist — <feature>\n| # | Task | Status |\n...",
              source: "Checklist: <feature>")
   ```

> The Guardian Block is the automatic enforcement mechanism. Every time you `view_file` the plan (which is MANDATORY every 3 tasks), you automatically re-read the enforcement rules. This is NOT voluntary — the rules are physically embedded in the document you are required to read.

### Step 2: Execute Batch

**Batch size criteria:**
- Default batch: `checkpoint_every` tasks (default: 3, see Checkpoint Configuration)
- Shrink to 1 task if: first task in a new phase, or previous batch had failures
- Expand to 5 tasks if: all tasks are mechanical (file copies, config changes) with no logic

#### Rollback Protocol (Before Each Batch)
```
BEFORE starting batch N:
1. Create safety checkpoint:
   git stash push -m "checkpoint-batch-N-before" 2>/dev/null || true
   git stash pop  # Keep working state, checkpoint stored in reflog
   # OR for more safety:
   git tag "checkpoint-batch-N" HEAD 2>/dev/null || true

2. Record checkpoint:
   ctx_index(content: "Checkpoint: batch-N created at $(git rev-parse --short HEAD)",
             source: "Checkpoints: <feature>")

IF batch FAILS (unrecoverable error after 3 fix attempts):
  → ROLLBACK:
    git checkout checkpoint-batch-N -- .  # Restore files
    OR: git stash pop                     # Restore from stash
  → Announce: "⚠️ Batch N failed. Rolled back to checkpoint."
  → Report failure details to user
```

**MANDATORY: Context Re-Injection Before Each Task**
```
BEFORE starting task [N]:
1. ctx_search(queries: ["task N description"], source: "Plan: <feature>")
2. Quote the FULL task description from search result
3. ONLY THEN start implementing
```

For each task:
1. Re-read task description from KB search (NOT from memory)
2. Mark as in_progress
3. Follow each step exactly (plan has bite-sized steps)
4. Run verifications via ctx_execute:
   ```
   → ctx_execute(language: "shell", code: "<verify command> 2>&1",
                 intent: "task N verification")
   ```
5. Pass the Checkpoint Gate before marking complete:

```
CHECKPOINT GATE — Task [N]:
□ Read task description from KB search? (not memory)
□ Implemented ALL items listed? (not just first one)
□ Ran verification via ctx_execute?
□ Output shows ZERO failures?
□ Tests written and passing for this task?
ALL boxes checked → persist checkpoint:
  → ctx_index(content: "Task N: PASS — <evidence summary>",
             source: "Checklist: <feature>")
Then run checkpoint gate:
  → ctx_execute(code: "bash .agent/scripts/checkpoint.sh N <plan-file> 2>&1")
ANY unchecked → NOT complete.
```
6. Mark as completed

### Step 3: Report

When batch complete, collect evidence via ctx_batch_execute:

```
→ ctx_batch_execute(
    commands: [
      { label: "Tests", command: "<test command> 2>&1" },
      { label: "Changed", command: "git diff --stat" }
    ],
    queries: ["test failures", "files changed"]
  )
```

Then use this template:

```
## Batch Report — Progress: [completed]/[total]
| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | [name] | ✅ Done | [ctx_search evidence] |
| 2 | [name] | ✅ Done | [ctx_search evidence] |
| 3 | [name] | 🔄 WIP | — |

Files changed: [from ctx_batch_execute result]
Tests: [passed X / failed Y / skipped Z]
Ready for feedback.
```

**If Tests: failed > 0:**
Do NOT mark tasks completed. Report the failure with exact test output.
Load systematic-debugging skill. Do not proceed to next batch until failures are resolved.

### Step 4: Continue
Based on feedback:
- Apply changes if needed
- Execute next batch
- Repeat until complete

### Step 5: Complete Development

After all tasks complete and verified:
- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- Before loading: verify (a) all tasks are marked completed, (b) all tests pass, (c) no BLOCKERS.md is active.
- **REQUIRED SUB-SKILL:** Load finishing-a-development-branch
- Follow that skill to verify tests, present options, execute choice

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker mid-batch (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

**If the session ends without human response, or if 2 or more messages have passed without acknowledgment of the STOP:**
1. Document the blocking question in a `BLOCKERS.md` file
2. Mark the plan task as 'blocked'
3. Skip to the next non-dependent task if one exists
4. If no tasks are unblocked, leave a clear status note and stop


<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Complete Step 0 prerequisites before anything else
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Between batches: just report and wait
- Stop when blocked, don't guess

## Integration

**Required workflow skills:**
- **writing-plans** - Creates the plan this skill executes
- **finishing-a-development-branch** - Complete development after all tasks

## Completion State

The session is complete when:
- All plan tasks are marked completed
- Final batch report shows zero test failures
- finishing-a-development-branch skill has been loaded and executed

Announce: "Plan execution complete. All [N] tasks finished. Branch ready for review."
