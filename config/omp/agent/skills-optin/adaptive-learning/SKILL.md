---
name: adaptive-learning
description: "[S5.3] Ghi bài học từ sai lầm, preferences thành rules — Trigger: sai rồi, ghi nhớ, /learn"
vi_triggers: "sai rồi, nhớ đi, ghi nhớ, đúc kết, bài học, lỗi lặp lại, preference"
hide: true
---

<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# Adaptive Learning — Skill Instructions

## Overview

This skill enables AI to **learn from interactions** and persist lessons as workspace rules. When a user corrects the AI, the system detects the correction, distills a concise lesson, confirms with the user, and writes it to `.agent/learned-rules/`.

## Triggers

### Vietnamese
- sai rồi, không phải, đừng làm vậy, sửa lại
- luôn dùng X, nhớ rằng, lần sau hãy
- ghi nhớ, đúc kết, tích luỹ

### English
- wrong, incorrect, don't do that, fix this
- always use X, remember that, next time
- memorize, learn this, take note

### Command
- `/learn [lesson content]`

<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->
## Workflow

### Step 1: Detect Correction Signal

When you detect a user correction in conversation:

```
USER: "Sai rồi, phải dùng set -euo pipefail chứ không phải chỉ set -e"
         ↓
AI detects: correction signal + specific fix
```

### Step 2: Classify Lesson Type

| Type | File | Keywords |
|------|------|----------|
| `error` | `lessons.md` | sai, lỗi, wrong, bug, fix |
| `pattern` | `project-patterns.md` | pattern, cấu trúc, convention, architecture |
| `preference` | `user-preferences.md` | luôn dùng, prefer, style, always use |

### Step 3: Distill Lesson

Format the lesson in **exactly** this structure:

```markdown
### [YYYY-MM-DD] [Category] Brief descriptive title
- **Lesson:** One clear sentence describing what to do/not do
- **Source:** Brief context of how this was discovered
- **Scope:** global | module:[name] (for filtered loading)
- **Confidence:** ★ (new) | ★★ (reinforced 1x) | ★★★ (reinforced 2x+)
```

Rules for distillation:
- **Max 50 words** per lesson
- **Be specific** — "use set -euo pipefail" not "use proper error handling"
- **Actionable** — AI can directly apply this in future
- **No secrets/PII** — never store passwords, API keys, personal data

### Step 4: Confirm with User

```
AI: "📝 Tôi đúc kết bài học sau:

### [2026-03-19] [Error Handling] Use set -euo pipefail in all bash scripts
- **Lesson:** Always add `set -euo pipefail` at top of bash scripts, not just `set -e`
- **Source:** User correction during cross-platform audit

→ Ghi nhớ vào lessons.md? (Y/n)"
```

If user confirms → Step 5. If user declines → skip.

### Step 5: Write to File

Append the lesson to the appropriate file in `.agent/learned-rules/`.

**IMPORTANT: Check lesson count before writing.**
If file has ≥50 lessons → remove the OLDEST lesson (first entry) before appending new one.

### Step 5b: Update IDE-Native Files

After writing to `learned-rules/`, ALSO update these files:

| File | Where to write | Markers |
|------|---------------|---------|
| `GEMINI.md` | Between `<!-- LESSONS_START -->` and `<!-- LESSONS_END -->` | Replace content between markers |
| `CLAUDE.md` | Between `<!-- LESSONS_START -->` and `<!-- LESSONS_END -->` | Replace content between markers |

Format for IDE files — compact one-liner per lesson:
```markdown
- **[YYYY-MM-DD]** [Category] Lesson text
```

Keep only the **10 most recent** lessons in IDE files (they have tighter token budgets).

### Step 5c: Store in ICM (Permanent Memory)

If ICM MCP is available, ALSO store lesson in ICM for semantic search:

```
icm store --topic "lessons" --importance "medium" --content "Lesson: [lesson text]. Source: [context]"
# Use --importance "critical" for recurring mistakes
```

This gives: vector search, temporal decay, knowledge graph — far beyond flat files.
If ICM unavailable → skip (learned-rules/ files are the fallback).

### Step 6: Acknowledge

```
AI: "✅ Đã ghi nhớ vào lessons.md + GEMINI.md + CLAUDE.md (X/50 lessons)"
```

<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## Manual Entry via /learn

When user types `/learn [content]`:

```
/learn Always validate PowerShell script syntax before committing
```

AI should:
1. Classify the lesson type
2. Format it properly with today's date
3. Append directly (no confirmation needed for manual entry)
4. Acknowledge with count

## Reading Lessons

Before starting tasks related to:
- **Scripting** → read `lessons.md` for error handling gotchas
- **Code architecture** → read `project-patterns.md`
- **User interaction** → read `user-preferences.md`

```bash
# Quick check: how many lessons exist
wc -l .agent/learned-rules/lessons.md
```

## Integration with Other Skills

| Skill | Integration |
|-------|-------------|
| `systematic-debugging` | After fixing bug, suggest distilling lesson |
| `receiving-code-review` | After review feedback, suggest lesson |
| `verification-before-completion` | Check lessons before claiming done |
| `brainstorming` | Read preferences before proposing solutions |

## File Management

- **Max 50 lessons per file** (prevents bloat)
- **FIFO rotation** — oldest lesson removed when limit reached
- **Git-tracked** — lessons persist across sessions and users
- **Token budget: 0 alwaysApply impact** — loaded on-demand only

## Learning Reinforcement & Invalidation (from CodyMaster cm-continuity)

### Reinforcement

When encountering a lesson that **already exists** (same error, same pattern):

```
1. FIND existing lesson with same topic
2. INCREMENT confidence: ★ → ★★ → ★★★
3. UPDATE date to today
4. DO NOT create duplicate
```

> Lessons with ★★★ are HIGH CONFIDENCE — apply without hesitation.

### Invalidation

When a lesson is **proven wrong** (codebase changed, pattern outdated):

```
1. DO NOT delete the lesson
2. Mark as: **[INVALIDATED]** with reason
3. Move to bottom of file
4. Never apply invalidated lessons
```

### Correction

When a lesson needs **updating** (partially right, new context):

```
1. Mark old lesson as: **[CORRECTED]** → see updated version
2. Write new lesson with corrected content
3. New lesson starts at ★ (needs fresh verification)
```

## Memory Integrity Check (Phase 0.5) — from CodyMaster cm-debugging

**BEFORE blaming code during debugging, check if memory caused the bug:**

```
Phase 0.5: Memory Integrity Check
  1. SUSPECT — What module is the bug in? Load relevant lessons for that scope.
  2. INVESTIGATE — Did AI follow a lesson when writing buggy code?
     → Does buggy code match a learning's prevention pattern?
     → Does buggy code follow a decision that may be outdated?
  3. VERIFY — Is the suspect lesson still correct?
     → Compare with CURRENT codebase (not when recorded)
     → Has dependency/pattern/architecture changed since?
  4. HEAL (only if lesson is wrong) — Invalidate the lesson, record correction
```

> **Key insight from CodyMaster:** Sometimes AI bugs are caused by AI's own
> outdated memories, not bad code. Check memory BEFORE checking code.

## Scope-Filtered Loading (Token Optimization)

When loading learnings for a task, filter by relevance:

| Filter | When |
|---|---|
| `scope: global` | Always load |
| `scope: module:X` | Only when working on module X |
| `confidence: ★★★` | Apply without hesitation |
| `confidence: ★` | Verify before applying |
| `[INVALIDATED]` | NEVER load (skip entirely) |
| `[CORRECTED]` | Load but verify first |

## Step 7: Record Decision (inspired by CodyMaster cm-continuity)

When the AI makes a **significant architectural or design decision**, record it:

```markdown
### [YYYY-MM-DD] [Category] Brief decision title
- **Decision:** What was decided
- **Reasoning:** Why this option was chosen
- **Alternatives:** What other options were considered
- **Impact:** What the consequences are
```

**Save to:** `.agent/learned-rules/decisions.md`

**When to record a decision:**
- Choosing technology/framework/tool
- Deciding on architecture pattern
- Choosing between 2+ approaches
- Rejecting a proposed change with reasons

**Max 30 decisions** — FIFO rotation when full.
**Also store in ICM** (if available): `icm store --topic "decisions" --importance "high" --content "Decision: [text]"`

## Auto-Learn Triggers

The AI should **automatically suggest** distilling a lesson in these situations:

| After... | Auto-prompt |
|---|---|
| Fixing a bug | "📝 Bạn muốn ghi nhớ bài học từ bug này không?" |
| Receiving code review feedback | "📝 Có feedback nào đáng ghi nhớ không?" |
| Encountering a recurring error | "📝 Lỗi này đã gặp trước — nên tạo rule mới?" |
| User corrects AI behavior | Auto-distill (existing Step 1) |
| Completing a major task | "📝 Có insights nào từ task này không?" |

**Rules:**
- Only prompt **once per trigger** (don't nag)
- User declines → don't ask again for same topic
- If user says "tự ghi" or "auto" → distill without confirmation

## /learn status — Learning Statistics

When user types `/learn status`:

```
📊 Learning Stats:
├── Lessons:    X/50 (lessons.md)
├── Patterns:   X/50 (project-patterns.md)
├── Preferences: X/50 (user-preferences.md)
├── Decisions:  X/30 (decisions.md)
├── ICM stored: X entries
└── Last lesson: [date] — [brief text]

Top 3 Recent:
1. [date] [lesson]
2. [date] [lesson]
3. [date] [lesson]
```

