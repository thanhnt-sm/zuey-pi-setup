---
name: gstack-code-review
description: "[S8.8] GStack unified review — pre-landing PR review, CEO/Eng/Design perspectives, SQL safety, LLM trust — Trigger: gstack review, pre-landing, CEO review, eng review"
vi_triggers: "gstack review, pre-landing review, review trước merge, kiểm tra code, review PR, CEO review, eng review, design review"
hide: true
---

<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# GStack Code Review — Pre-Landing PR Review

> Ported from [garrytan/gstack](https://github.com/garrytan/gstack) `/review` (MIT License)

## Overview

Pre-landing PR review chuyên sâu. Kiểm tra SQL safety, LLM trust boundary violations, conditional side effects. Đặc biệt mạnh ở phát hiện security issues trong AI-powered apps.

**Note:** Đây là skill **standalone** — không thay thế SA `requesting-code-review`.
Dùng khi cần gstack-style review methodology, đặc biệt cho AI/LLM projects.

## When to Use
- Trước merge/PR cho AI-powered applications
- Khi cần kiểm tra LLM trust boundaries
- Khi user nói "gstack review" hoặc "pre-landing review"

<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->
## Process

### Step 1: Gather Diff
```
ctx_execute(language: "shell", code: """
BASE=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || echo HEAD~5)
git diff "$BASE"..HEAD --stat
echo '---'
git diff "$BASE"..HEAD --name-only
""", intent: "PR diff summary")
```

### Step 2: Review Checklist

**Security Layer:**
- [ ] SQL injection vectors — parameterized queries only
- [ ] XSS vectors — sanitized output
- [ ] Auth/authz — proper middleware on protected routes
- [ ] Secrets in code — no hardcoded keys/passwords
- [ ] Input validation — all user input validated at boundary

**LLM Trust Boundary Layer:**
- [ ] User input → LLM prompt — injection guard in place?
- [ ] LLM output → code execution — output never eval'd directly?
- [ ] LLM output → database — sanitized before insert?
- [ ] System prompts — not exposed to users?
- [ ] Rate limiting — on LLM API calls?

**Logic Layer:**
- [ ] Conditional side effects — no hidden state mutations
- [ ] Error handling — all error paths have user-facing response
- [ ] Race conditions — concurrent access handled?
- [ ] Data integrity — transactions where needed?

**Quality Layer:**
- [ ] Tests added/updated for new code
- [ ] No commented-out code
- [ ] No TODO/FIXME without tracking issue
- [ ] Documentation updated
- [ ] No dead code introduced

### Step 3: Present Findings

```
┌──────────────────────────────────────────────┐
│ 🔍 PRE-LANDING REVIEW                       │
│                                              │
│ Security:     [✅ PASS / ⚠️  WARN / 🔴 FAIL] │
│ LLM Trust:    [✅ PASS / ⚠️  WARN / 🔴 FAIL] │
│ Logic:        [✅ PASS / ⚠️  WARN / 🔴 FAIL] │
│ Quality:      [✅ PASS / ⚠️  WARN / 🔴 FAIL] │
│                                              │
│ FINDINGS: [N] total                          │
│ 🔴 Blockers: [N] — must fix before merge     │
│ ⚠️  Warnings: [N] — should fix               │
│ 💡 Suggestions: [N] — nice to have           │
│                                              │
│ VERDICT: [SHIP IT ✅ / FIX FIRST ⚠️ / BLOCK 🔴]│
└──────────────────────────────────────────────┘
```

### Step 4: Fix Blockers (if any)
Nếu có blockers → fix ngay, commit atomic, re-review.

<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## Edge Cases

| Scenario | Handling |
|----------|----------|
| LLM output used in eval() | 🔴 **CRITICAL** — never eval LLM output. Sandbox or parse. |
| User input → system prompt | 🔴 **CRITICAL** — prompt injection. Sanitize + guardrails. |
| No tests in diff | ⚠️ Flag: "New code without tests" |
| Only test changes | ✅ Quick review — focus on test quality, not app logic |
| Very large diff (>500 lines) | Split review by file. Focus Security → LLM → Logic → Quality |
| Diff includes migrations | Extra scrutiny: reversibility, data preservation, indexes |
| First PR in new repo | Also check: .gitignore, LICENSE, README, CI config |

## Cross-Reference (gstack original)

From original gstack `/review`:
- **TODOS.md cross-ref**: `grep_search` for TODOs referenced in TODOS.md file
- **Greptile integration**: Not ported — dùng `ctx_search` thay thế

## Model Recommendation

| Review Layer | Best Model | Why |
|---|:---:|---|
| Security + LLM Trust | Claude Opus | Deep security reasoning |
| Logic + Race Conditions | Claude Opus/Sonnet | Pattern matching |
| Quality + Style | Gemini Pro | Fast, good at style |
| Quick pre-merge check | Gemini Flash | Fastest |

## Integration
- **Uses MCP**: `ctx_execute` for diff analysis, `ctx_index` for review results
- **AI Model**: Best with Claude Opus for security/LLM reviews, Gemini Pro for quality checks
- **Standalone** — does NOT modify `requesting-code-review` skill
- **Module**: GStack Imported (standalone, prefix `gstack-`)

