---
name: full-team-orchestration
description: "[S6.1] Điều phối ALL skills thành đội chuyên gia, phân tích đa góc nhìn — Trigger: /full-team, phân tích toàn diện"
vi_triggers: "full team, toàn đội, tổng hợp, nhiều góc nhìn, panel kỹ thuật, phối hợp skill"
hide: true
---

<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# Full-Team Orchestration — Multi-Expert Technical Analysis

<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->

## Overview

Coordinates ALL 31 skills as a **team of 9 expert roles**, each analyzing the same problem from their unique perspective. Produces structured multi-view analysis with proposals for human decision.

> **This is the HIGHEST-LEVEL skill. It orchestrates other skills, not replaces them.**

## When to Use

- Complex requirements needing multiple perspectives
- Architecture decisions with many trade-offs
- User wants "toàn đội" / "nhiều góc nhìn" / comprehensive analysis
- Problems where single-skill view is insufficient
- Automatically triggered by `/full-team` workflow

## The 9 Expert Roles — Complete Skill Mapping (31 skills)

| # | Role | Perspective | Primary Skills | Support Skills |
|:-:|------|------------|----------------|----------------|
| 1 | 🎯 **Analyst** | Requirements, user needs | `brainstorming`, `confidence-check` | `using-superantigravity` |
| 2 | 🏗️ **Architect** | System design, patterns | `architecture-design`, `writing-plans` | `security-review` |
| 3 | 🔒 **Security** | Vulnerabilities, auth | `security-review` | — |
| 4 | ⚡ **Performance** | Speed, optimization | `performance-optimization` | — |
| 5 | 🧪 **QA Lead** | Testing, coverage | `test-driven-development` | `systematic-debugging` |
| 6 | 📦 **DevOps** | Deploy, CI/CD, deps | `dependency-management` | `browser-agent` |
| 7 | 🔍 **Researcher** | Best practices, evidence | `deep-research` | — |
| 8 | 📋 **Reviewer** | Code quality, standards | `requesting-code-review`, `receiving-code-review` | `verification-before-completion` |
| 9 | 🧠 **Learning** | Past mistakes, memory | `adaptive-learning` | — |

**Orchestration skills** (used by the process itself, not by experts):
`full-team-orchestration` (this), `auto-continue-loop`,
`executing-plans`, `single-flow-task-execution`, `subagent-driven-development`,
`writing-skills`, `finishing-a-development-branch`

> ✅ All 31 skills mapped: 15 to expert roles + 7 orchestration + 9 shared.

## Cross-Trigger Map

```
Analyst  → view_file brainstorming/SKILL.md → confidence-check/SKILL.md
Architect → view_file architecture-design/SKILL.md → writing-plans/SKILL.md
Security → view_file security-review/SKILL.md
Performance → view_file performance-optimization/SKILL.md
QA Lead  → view_file test-driven-development/SKILL.md
          → systematic-debugging/SKILL.md (if bug found)
DevOps   → view_file dependency-management/SKILL.md
Researcher → view_file deep-research/SKILL.md → search_web()
Reviewer → view_file requesting-code-review/SKILL.md → verification-before-completion/SKILL.md
Learning → `icm recall "<keywords>" --topic lessons` → ctx_execute_file(learned-rules/lessons.md)
```

## The Process (4 Phases)

### Phase 0: PRE-FLIGHT — Load Memory Context

```
# 1. Read recent lessons (ALWAYS — even if ICM unavailable)
ctx_execute_file(
  path: ".agent/learned-rules/lessons.md",
  language: "shell",
  code: "echo '=== RECENT LESSONS ==='; tail -30 \"$FILE_CONTENT\""
)

# 2. Recall from ICM (if ICM MCP available)
icm recall "<problem keywords>" --topic "lessons"
icm recall "<problem keywords>" --topic "decisions"
icm recall "<problem keywords>" --topic "bugs"

# 3. If ICM unavailable → skip gracefully, lessons.md is sufficient
```

> **Fallback**: If ICM MCP not connected → learned-rules/ files are the fallback. Never fail on ICM absence.

### Phase 1: INTAKE — Understand the Problem

```
1. Read the user's request carefully
2. Apply Pre-Flight lessons to frame context
3. Identify problem domain and scope
4. Select relevant expert roles (minimum 4, maximum 9)
5. Frame the problem statement for each expert

Output to user:
┌──────────────────────────────────────────────┐
│ 📋 PROBLEM STATEMENT                         │
│ [Clear restatement of what user wants]       │
│                                              │
│ 🎯 SCOPE                                     │
│ [What's in scope / what's out]               │
│                                              │
│ 👥 EXPERT PANEL (selected N/9)               │
│ [Role 1] — why they're relevant              │
│ [Role 2] — why they're relevant              │
│                                              │
│ 🧠 PAST LESSONS APPLIED                      │
│ [Relevant lessons that affect this analysis] │
│ (empty if none found)                        │
└──────────────────────────────────────────────┘
```

### Phase 2: PARALLEL ANALYSIS — Each Expert Analyzes

```
FOR EACH selected expert role:

1. Load the PRIMARY skill(s) via view_file .agent/skills/<name>/SKILL.md
2. Load SUPPORT skill(s) only if the analysis requires them
3. Analyze from that expert's unique perspective
4. Produce:
   - KEY FINDINGS (top 3-5 observations with evidence)
   - RISKS (what could go wrong from this view)
   - RECOMMENDATIONS (specific actionable suggestions)
   - CONFIDENCE LEVEL (high/medium/low + percentage + reasoning)

Format per expert:
┌──────────────────────────────────────────────┐
│ [emoji] [ROLE] — [Domain] Analysis           │
│                                              │
│ FINDINGS:                                    │
│ 1. [observation with evidence]               │
│ 2. [observation with evidence]               │
│                                              │
│ RISKS:                                       │
│ ⚠️ [risk + impact + likelihood]              │
│                                              │
│ RECOMMENDATIONS:                             │
│ → [specific actionable suggestion]           │
│                                              │
│ CONFIDENCE: [H/M/L] (X%) — [reasoning]      │
└──────────────────────────────────────────────┘
```

**Self-Audit Gate** (run BEFORE Phase 3 synthesis):
```
FOR EACH expert analysis produced above:
  □ Was PRIMARY skill loaded via view_file? (not from memory)
  □ Does output contain all 4 sections: FINDINGS, RISKS, RECOMMENDATIONS, CONFIDENCE?
  □ Is CONFIDENCE % supported by evidence (not arbitrary)?
  □ Were SUPPORT skills consulted if analysis required them?
  IF ANY unchecked → re-do that expert's analysis
  Only proceed to Phase 3 when ALL experts pass this gate.
```

**Sub-Agent Acceleration** (if antigravity-sub-agent MCP available):
```
# Spawn 3-4 experts in parallel via sub-agents:
t1 = submit_agent({
  taskName: "Security Expert Analysis",
  task: "Read .agent/skills/security-review/SKILL.md then analyze <problem>.
         Report: FINDINGS (3-5), RISKS (with impact), RECOMMENDATIONS, CONFIDENCE %.",
  model: "gemini-flash", timeout: 120
})
t2 = submit_agent({
  taskName: "Performance Expert Analysis",
  task: "Read .agent/skills/performance-optimization/SKILL.md then analyze <problem>.
         Report: FINDINGS (3-5), RISKS (with impact), RECOMMENDATIONS, CONFIDENCE %.",
  model: "gemini-flash", timeout: 120
})
# Main agent does Architect + Analyst + Learning analysis directly
# Then: get_agent_results([t1, t2]) to collect parallel work
# TIMEOUT: If sub-agent doesn't respond in 120s → main agent does that analysis
```

**🧠 Learning Expert** (ALWAYS runs — no sub-agent needed):
```
# Check ICM for past lessons and corrections
icm recall "<problem domain keywords>" --topic "lessons"
icm recall "<problem domain keywords>" --topic "decisions"
icm recall "<problem domain keywords>" --topic "bugs"

# Report:
┌──────────────────────────────────────────────┐
│ 🧠 LEARNING — Past Lessons & Patterns        │
│                                              │
│ RELEVANT LESSONS:                            │
│ 1. [past lesson + when learned]              │
│                                              │
│ PAST DECISIONS:                              │
│ 📌 [previous decision + context]             │
│                                              │
│ RECOMMENDATIONS:                             │
│ → [avoid X based on lesson Y]               │
│                                              │
│ CONFIDENCE: [based on evidence quality]      │
└──────────────────────────────────────────────┘
```

### Phase 3: CROSS-EXPERT INTERACTION — Find Conflicts & Synergies

```
1. CONFLICT DETECTION:
   Compare all expert recommendations
   Where they AGREE → mark as HIGH CONFIDENCE (🟢)
   Where they PARTIALLY AGREE → mark as QUALIFIED (🟡)
   Where they DISAGREE → mark as DECISION POINT (🔴)

2. TRADE-OFF MATRIX:
   | Decision Point | Expert A | Expert B | Impact | Reversible? |
   |----------------|----------|----------|--------|:-----------:|
   | [point]        | [view]   | [view]   | [H/M/L]| [Yes/No]   |

3. SYNTHESIS:
   Merge non-conflicting recommendations into consensus
   Frame conflicts as explicit choices for human

4. ONLINE RESEARCH (for decision points):
   For each major trade-off:
   → search_web("best practice <decision> <tech stack> 2025 2026")
   → Bring evidence to support/challenge expert views

5. MEMORY CHECK:
   → `icm recall "<decision>" --topic "decisions"`
   → If similar decision was made before → factor into recommendation
   → If ICM unavailable → skip (not blocking)
```

### Phase 4: STRUCTURED REPORT — Present to Human

```
┌══════════════════════════════════════════════════════════┐
│  📊 FULL-TEAM ANALYSIS REPORT                           │
├══════════════════════════════════════════════════════════┤
│                                                          │
│  1. PROBLEM STATEMENT                                    │
│  [What we analyzed + scope]                              │
│                                                          │
│  2. EXPERT PANEL SUMMARY                                 │
│  | Expert | Confidence | Key Recommendation |            │
│  [🟢 agree / 🟡 qualified / 🔴 disagree markers]         │
│                                                          │
│  3. PAST LESSONS APPLIED                                 │
│  🧠 [Relevant lessons from ICM/learned-rules]           │
│  (omit if none found — don't show empty section)         │
│                                                          │
│  4. CONSENSUS POINTS (all experts agree)                 │
│  ✅ [point 1 — N/N experts + confidence %]               │
│  ✅ [point 2 — N/N experts + confidence %]               │
│                                                          │
│  5. DECISION POINTS (experts disagree — needs human)     │
│  🔶 Decision 1: [description]                            │
│     Option A: [expert view + trade-off + reversible?]    │
│     Option B: [expert view + trade-off + reversible?]    │
│     Research: [web evidence if found]                    │
│     Memory: [past lesson if relevant]                    │
│     👉 Recommendation: [which option + why]              │
│                                                          │
│  6. RISK MATRIX                                          │
│  | Risk | Impact | Likelihood | Owner | Mitigation |     │
│                                                          │
│  7. PROPOSED SOLUTIONS (prioritized)                     │
│  🥇 Solution A: [description + pros/cons + effort]       │
│  🥈 Solution B: [description + pros/cons + effort]       │
│  🥉 Solution C: [description + pros/cons + effort]       │
│                                                          │
│  8. RECOMMENDED NEXT STEPS                               │
│  → [specific workflow: /plan, /implement, /test]         │
│  → [specific action items with owners]                   │
│                                                          │
└══════════════════════════════════════════════════════════┘
```

## Decision Matrix Template

| Criteria | Solution A | Solution B | Solution C |
|----------|:---------:|:---------:|:---------:|
| Complexity | ⭐⭐ | ⭐⭐⭐ | ⭐ |
| Security | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| Performance | ⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| Time to Ship | 2 days | 5 days | 1 day |
| Maintenance | Low | Medium | Low |
| Past Lessons | Supports | No data | Contradicts |
| Reversibility | Easy | Hard | Easy |
| **Score** | **14** | **13** | **12** |

## Post-Analysis: Store Insights in Memory

After human makes decision:
```
# Store the decision (if ICM available)
icm store --topic "decisions" --importance "high" --content "Decision: <chosen solution>. Reasoning: <why>. Problem: <context>. Alternatives rejected: <list>"
# If ICM unavailable → skip (decision is in git history anyway)
```

## Error Handling & Graceful Degradation

| Component | If unavailable | Fallback |
|-----------|:---:|---|
| ICM MCP | Skip memory recall/store | Use `learned-rules/*.md` only |
| Sub-agent MCP | Skip parallel experts | Main agent runs all sequentially |
| `search_web` | Skip online research | Use skill knowledge only |
| Specific skill file | Warn, skip expert | Reduce panel size |

> **Rule: Never fail the entire analysis because one component is unavailable. Degrade gracefully.**

## Integration

- **Workflow**: `/full-team` (outer orchestration — auto-chains to `/plan` → `/implement`)
- **Uses**: All 31 skills (15 primary + 10 orchestration + 6 shared)
- **MCP**: context-mode (execution), ICM (memory), sub-agent (parallel)
- **Rules**: `auto-continue-loop` (mandatory post-task protocol), `autonomous-execution` (no premature reporting)
- **Produces**: Multi-view analysis document for human decision
- **Next**: Based on human decision → **auto-chain** `/plan` → `/implement` → `/test` → `/review`
- **Panel companions**: `/business-panel` (business view), `/spec-panel` (spec quality)
- **Auto-Loop**: After implementation auto-chains, `/implement` runs its own convergence loop with `auto-continue-loop` rule
