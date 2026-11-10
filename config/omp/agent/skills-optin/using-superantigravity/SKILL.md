---
name: using-superantigravity
description: "[S7.1] Hướng dẫn sử dụng framework: tìm skill, check trước mọi action — Trigger: bắt đầu conversation"
vi_triggers: "gợi ý skill, recommend, dùng skill nào"
hide: true
---


<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# Using SuperAntigravity

## Overview

You have superantigravity installed. Before any action, check if a skill applies.
Skills are loaded automatically in Antigravity when the task matches the description.

## Structural Integrity Check (runs at conversation start)

```
BEFORE loading any skills, verify framework health:

CHECK 1: Critical directories exist
  ✓ .agent/skills/     → contains skill folders
  ✓ .agent/workflows/  → contains workflow .md files
  ✓ .agent/rules/      → contains rule .md files

CHECK 2: Minimum skill count
  ✓ Count SKILL.md files in .agent/skills/
  ✓ If < 10 → ⚠️ WARNING: "Framework may be incomplete — only N skills found"

CHECK 3: Essential rule files exist
  ✓ .agent/rules/execution-integrity-core.md
  ✓ .agent/rules/zero-tolerance-bootloader.md
  ✓ .agent/rules/context-mode-enforcement.md
  ✓ If ANY missing → ⚠️ WARNING: "Critical rule missing: <filename>"

CHECK 4: This skill file integrity
  ✓ This file (SKILL.md) has valid YAML frontmatter (starts with ---)
  ✓ If corrupt → announce: "⚠️ Bootloader integrity issue detected"

IF all checks PASS → proceed normally
IF any check FAILS → announce issue, continue with degraded mode
```

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing,
you ABSOLUTELY MUST let Antigravity load and read it.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. This is not optional. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

## Mandatory Announcement

**Before every response, you MUST say: "Checking applicable skills..."**

This announcement is not optional. It is not skipped for "simple" responses. It is not skipped
for clarifying questions. It is not skipped when you believe no skill applies. You say it first,
then you check, then you respond.

The announcement serves as a checkpoint: if you are about to respond without having said it,
STOP. You have skipped the skill check. Go back and do it.

The skill check is complete when you have announced which skill was loaded, or announced
explicitly that no skill applied. "Checking applicable skills... no skill matched this request"
is a valid and complete check. Silence is not.

## The Rule

**Check for relevant skills BEFORE any response or action.** Even a 1% chance a skill
might apply means you let Antigravity load it. If a loaded skill turns out to be wrong
for the situation, you don't need to use it.


<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->
## Skill Matching

> **Full matching rules:** See `agent-routing.md` — it handles keyword → skill mapping automatically.
> This skill focuses on the **discipline** of checking, not the matching rules.

## Skill Priority

1. **Process skills first** (brainstorming, systematic-debugging) — HOW to approach the task
2. **Implementation skills second** (architecture-design, deep-research) — guide execution

"Let's build X" → brainstorming first, then implementation skills.
"Fix this bug" → systematic-debugging first, then domain-specific skills.

## Skill Types

**Rigid** (test-driven-development, systematic-debugging): Follow exactly.
**Flexible** (patterns): Adapt principles to context.

The skill itself tells you which.

## Error Path

If skill loading fails (Antigravity cannot load the skill file, the file is missing, or the
skill returns an error):

1. Announce the failure explicitly: "Skill loading failed for [skill-name]. Proceeding with
   built-in reasoning."
2. Continue with your best built-in reasoning for the task.
3. Do NOT silently skip the skill load and proceed as if nothing happened.
4. Do NOT pretend the skill loaded when it did not.

Silently skipping a failed skill load is indistinguishable from never checking at all.
The user must know what happened.


<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## Observable Completion

A skill check is complete when ALL of the following are true:

- You have said "Checking applicable skills..."
- You have identified which skill(s) apply (or stated that none apply)
- You have announced the result: "Loading [skill-name]" or "No skill matched this request"
- If loading failed, you have announced the failure per the error path above

A skill check that ends in silence is not complete.

## Red Flags

These thoughts mean STOP — you're rationalizing:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |

## Conversation Modes

Antigravity has two primary **Conversation Modes**. You MUST ensure the user has the correct mode selected for the phase of work:

1. **Planning Mode**: Use for research, complex tasks, architecture, and collaborative design work.
2. **Fast Mode**: Use for direct execution, simple tasks, and repetitive implementation steps after the plan is approved.

**Rule:** If you are in a process skill (Brainstorming, Planning, Research, Debugging), you SHOULD be in **Planning Mode**. If you are in an execution skill (Implementation, TDD, Executing Plans), you SHOULD be in **Fast Mode**.

If the current mode doesn't match the work phase, prompt the user: *"I am starting a [Planning/Execution] phase. Please switch to [Planning/Fast] mode in the conversation settings for optimal performance."*

## User Instructions

Instructions say WHAT, not HOW. "Add X" or "Fix Y" doesn't mean skip workflows.

## Specialist Skills

| Skill | When to use |
|-------|-------------|
| `deep-research` | Task needs external information before proceeding |
| `performance-optimization` | Code needs profiling and optimization |
| `security-review` | Code touches auth, input handling, or sensitive data |
| `architecture-design` | Designing systems, APIs, or significant features |
| `confidence-check` | About to implement — verifies readiness |
| `browser-agent` | Interacting with web browser, testing UI flows, verifying web app behavior |
| `dependency-management` | Adding, updating, auditing, or evaluating project dependencies |

## Integration

- **Rules**: `execution-integrity-core` (evidence gate), `auto-continue-loop` (post-task protocol)
- **Loaded by**: `agent-routing` rule (implicit keyword detection), workflow `STANDARD_PREAMBLE` (explicit)
- **Combines with**: See `agent-routing.md` Step 1c for multi-skill combo patterns
- **Memory**: Check `learned-rules/lessons.md` for relevant past lessons
