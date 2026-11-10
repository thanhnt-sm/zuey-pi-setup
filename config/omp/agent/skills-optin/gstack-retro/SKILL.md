---
name: gstack-retro
description: "[S8.7] Weekly engineering retrospective — commit analysis, team stats, shipping streaks — Trigger: retro, weekly retro"
vi_triggers: "retro, tuần qua, đã ship gì, weekly retro, sprint review, retrospective"
hide: true
---

<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# GStack Retro — Weekly Engineering Retrospective

> Ported from [garrytan/gstack](https://github.com/garrytan/gstack) `/retro` (MIT License)

## Overview

Weekly engineering retrospective. Analyzes commit history, work patterns, code quality metrics với persistent history và trend tracking. Team-aware: breaks down per-person contributions.

## When to Use
- Cuối tuần hoặc cuối sprint
- Khi user nói "weekly retro", "what did we ship", "engineering retrospective"

<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->
## Process

### Step 1: Gather Data
```
ctx_execute(language: "shell", code: """
echo '=== COMMITS LAST 7 DAYS ==='
git log --since='7 days ago' --oneline --all | head -50
echo ''
echo '=== LOC CHANGES ==='
git diff --stat HEAD~$(git log --since='7 days ago' --oneline | wc -l | tr -d ' ') HEAD 2>/dev/null || git diff --stat @{7.days.ago} HEAD 2>/dev/null || echo 'Cannot compute diff range'
echo ''
echo '=== AUTHORS ==='
git log --since='7 days ago' --format='%aN' | sort | uniq -c | sort -rn
echo ''
echo '=== FILES MOST CHANGED ==='
git log --since='7 days ago' --name-only --format='' | sort | uniq -c | sort -rn | head -15
""", intent: "weekly commit analysis")
```

### Step 2: Analyze Patterns

**a) Shipping Velocity**
- Commits per day (trend vs last week)
- Lines added/removed/net
- Features shipped vs bugs fixed ratio

**b) Per-Person Breakdown** (if team)
- Commits per person
- Areas of focus (files/dirs touched)
- Praise: "đóng góp nổi bật"
- Growth areas: "có thể cải thiện"

**c) Code Quality Signals**
```
ctx_execute(language: "shell", code: """
echo '=== TEST CHANGES ==='
git log --since='7 days ago' --name-only --format='' | grep -i 'test\|spec' | wc -l | tr -d ' '
echo ' test files changed'
echo ''
echo '=== DOCUMENTATION CHANGES ==='
git log --since='7 days ago' --name-only --format='' | grep -iE '\.md$|docs/' | wc -l | tr -d ' '
echo ' doc files changed'
""", intent: "test and documentation coverage")
```

**d) Hotspots** — Files changed most often (potential refactor candidates)

**e) Shipping Streaks**
```
ctx_execute(language: "shell", code: """
echo '=== SHIPPING STREAK ==='
# Count consecutive days with at least 1 commit
for i in $(seq 0 13); do
  D=$(date -v-${i}d +%Y-%m-%d 2>/dev/null || date -d "$i days ago" +%Y-%m-%d 2>/dev/null)
  COUNT=$(git log --since="$D 00:00" --until="$D 23:59" --oneline | wc -l | tr -d ' ')
  [ "$COUNT" -gt 0 ] && echo "$D: $COUNT commits" || { echo "$D: 0 — streak broken"; break; }
done
""", intent: "shipping streak calculation")
```

**f) Trend vs Previous Retro**
```
ctx_search(queries: ["GStack Retro History"], source: "GStack Retro History")
```
So sánh với retro trước:
- Commits/LOC tăng hay giảm?
- Test ratio cải thiện?
- Hotspots giảm?

### Step 3: Generate Retrospective Report

Save to `_output/docs/retro-YYYY-MM-DD.md`:

```markdown
# Engineering Retrospective — Week of [date]

## 📊 Stats At a Glance
| Metric | This Week | Last Week | Trend |
|--------|:---------:|:---------:|:-----:|
| Commits | [N] | [N] | [↑/↓/→] |
| Lines Added | [N] | [N] | |
| Lines Removed | [N] | [N] | |
| Net LOC | [N] | [N] | |
| Test Files Changed | [N] | [N] | |
| Doc Files Updated | [N] | [N] | |

## 🔥 Shipping Streak: [N] days
[visual: 🟩🟩🟩🟩🟩🟩🟩⬜⬜⬜⬜⬜⬜⬜ — 7/14 days]

## 🚀 What We Shipped
- [Feature/fix 1 — commit refs]
- [Feature/fix 2 — commit refs]

## 👥 Team Breakdown
### [Person 1]
- [N] commits, [areas of focus]
- 💪 Strength: [specific praise]
- 📈 Growth: [constructive suggestion]

## 🔥 Hotspots (refactor candidates)
| File | Changes | Risk |
|------|:-------:|:----:|
| [file] | [N] | [H/M/L] |

## 📈 Trend (vs last retro)
| Metric | Change | Assessment |
|--------|:------:|:----------:|
| Velocity | [↑/↓] | [Good/Concerning] |
| Test Coverage | [↑/↓] | [Good/Concerning] |
| Code Churn | [↑/↓] | [Low=Good] |

## 🎯 Next Week Focus
- [Suggestion based on patterns]
```

Index for future retros (persistent history):
```
→ ctx_index(content: "Retro [date]: [N] commits, [net LOC] LOC, streak=[N] days, tests=[N]", source: "GStack Retro History")
```

Store in ICM (if available):
```
→ icm store --topic "retro" --importance "medium" --content "Retro [date]: [summary]"
```

<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## Edge Cases

| Scenario | Handling |
|----------|----------|
| Solo developer (no team) | Skip team breakdown, focus on personal streaks |
| No commits this week | Report "zero ship week" — flag as concern |
| Monorepo with many dirs | Group by top-level directory |
| First retro (no history) | Skip trend comparison, note "baseline established" |
| Merge commits inflating count | Use `--no-merges` flag |

## Integration
- **Uses MCP**: `ctx_execute` for git analysis, `ctx_index` for persistent history, `ctx_search` for trend data, `icm` for long-term memory
- **AI Model**: Best with Gemini (fast git parsing) or Claude Opus (deep pattern analysis)
- **Module**: GStack Imported (standalone, prefix `gstack-`)
