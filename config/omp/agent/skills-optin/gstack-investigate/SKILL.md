---
name: gstack-investigate
description: "[S8.10] GStack debug — Iron Law: no fix without root cause, 3-fix limit — Trigger: gstack investigate, iron law debug"
vi_triggers: "gstack debug, iron law, điều tra bug, root cause, investigate, tìm nguyên nhân gốc"
hide: true
---

<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# GStack Investigate — Iron Law Debugging

> Ported from [garrytan/gstack](https://github.com/garrytan/gstack) `/investigate` (MIT License)

## Overview

Systematic debugging với Iron Law: **không fix khi chưa tìm được root cause**. 4 phases: Investigate → Analyze → Hypothesize → Implement. Giới hạn 3 fix attempts — nếu vượt quá, cần re-analyze.

**Note:** Standalone — không thay thế SA `systematic-debugging` hoặc `root-cause-tracing`.

## When to Use
- Bug cần investigation sâu
- Khi user nói "gstack investigate", "find root cause", "iron law"
- Khi bug không rõ nguyên nhân

<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->

## ⚖️ The Iron Law

> **KHÔNG BAO GIỜ sửa code khi chưa hiểu TẠI SAO bug xảy ra.**
> 
> Nếu bạn không thể giải thích root cause trong 1 câu → bạn chưa hiểu → KHÔNG ĐƯỢC FIX.

## Process

### Phase 1: INVESTIGATE (Gather Evidence)

```
ctx_execute(language: "shell", code: """
echo '=== GIT RECENT ==='
git log --oneline -10
echo ''
echo '=== RECENT CHANGES ==='
git diff HEAD~3 --stat
""", intent: "recent changes near bug")
```

1. **Reproduce** — Chạy lại bug. Nếu không reproduce → cannot fix.
2. **Observe** — Đọc error messages, stack traces, logs.
3. **Scope** — Bug ở layer nào? (UI / API / DB / infra)
4. **Timeline** — Khi nào bắt đầu? Commit nào introduced?

### Phase 2: ANALYZE (Narrow Down)

5. **Read code path** — Trace từ entry point đến error
   ```
   → grep_search cho error messages
   → view_file cho relevant files
   → ctx_execute_file cho large log files
   ```
6. **Check assumptions** — Mỗi assumption phải verify bằng evidence
7. **Isolate** — Tạo minimal reproduction

### Phase 3: HYPOTHESIZE (Root Cause)

8. **Form 2-3 hypotheses** — List possible root causes
9. **Test each hypothesis** — Design experiment cho mỗi cái
10. **Confirm one** — State root cause trong 1 câu

**Root Cause Statement Format:**
```
ROOT CAUSE: [Mô tả root cause trong 1 câu]
EVIDENCE: [Data/log/trace chứng minh]
INTRODUCED BY: [commit/change gây ra]
```

Nếu không thể state trong 1 câu → quay lại Phase 2.

### Phase 4: IMPLEMENT (Fix — max 3 attempts)

11. **Fix attempt 1** — Sửa root cause (không phải triệu chứng)
12. **Verify** — Chạy reproduction → pass?
13. **Nếu fail** → analyze why, fix attempt 2
14. **Max 3 attempts** — Nếu 3 lần fail:
    ```
    ⚠️ 3 FIX ATTEMPTS EXHAUSTED.
    → Re-enter Phase 2: ANALYZE
    → Giả thuyết root cause có thể SAI
    → Gather more evidence before trying again
    ```

15. **When fixed** — Commit + add regression test

### Output

```
┌──────────────────────────────────────────────┐
│ 🔍 INVESTIGATION REPORT                     │
│                                              │
│ BUG: [description]                           │
│ ROOT CAUSE: [1 sentence]                     │
│ EVIDENCE: [data that proves it]              │
│ FIX: [what was changed]                      │
│ REGRESSION TEST: [test added]                │
│ FIX ATTEMPTS: [N]/3                          │
│                                              │
│ CONFIDENCE: [High/Medium/Low]                │
└──────────────────────────────────────────────┘
```

```
→ ctx_index(content: "Bug [desc]: Root cause=[cause], Fix=[fix]", source: "GStack Investigation")
```

## Integration
- **Uses MCP**: `ctx_execute` for git/log analysis, `ctx_index` for investigation notes, `ctx_search` for related past bugs
- **Standalone** — does NOT modify `systematic-debugging` or `root-cause-tracing`
- **Module**: GStack Imported (standalone, prefix `gstack-`)

<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## Edge Cases

| Scenario | Handling |
|----------|----------|
| Bug không reproduce được | Document steps tried. Check: environment diff? Race condition? Data-dependent? |
| Heisenbug (disappears when observed) | Add logging, don't add breakpoints. Check timing-dependent code. |
| 3 fix attempts exhausted | MANDATORY re-analyze. Root cause hypothesis likely wrong. |
| Bug in dependency | `ctx_search` for known issues. Consider: pin version, patch, or workaround. |
| Multiple bugs interacting | Isolate each. Fix one at a time. Verify after each fix. |
| Production-only bug | Check: env vars, data volume, concurrent users, CDN caching. |
| Bug introduced by AI | Check AI-generated code for: hallucinated APIs, wrong assumptions, subtle logic errors. |

## Anti-Patterns (REJECT)

| Anti-Pattern | Why Wrong | Correct |
|---|---|---|
| "Let me just try this fix" | Violates Iron Law | State root cause first |
| Adding console.logs everywhere | Unfocused | Target logging at hypothesis boundary |
| Fixing symptom not cause | Bug returns | Trace to root cause |
| "It works now" without understanding | Unknown state | Must explain WHY it works |

## Model Recommendation

| Phase | Best Model | Why |
|-------|:----------:|-----|
| Phase 1-2 (Investigate/Analyze) | Claude Opus | Deep code trace reasoning |
| Phase 3 (Hypothesize) | Claude Opus | Pattern recognition, root cause analysis |
| Phase 4 (Implement fix) | Gemini Pro | Fast code editing |

