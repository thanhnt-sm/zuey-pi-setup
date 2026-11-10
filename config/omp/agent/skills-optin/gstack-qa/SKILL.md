---
name: gstack-qa
description: "[S8.9] GStack QA — test web app, tìm bug, fix iteratively, browser_subagent — Trigger: gstack QA, test and fix"
vi_triggers: "gstack QA, kiểm thử, test web app, tìm bug, test & fix, QA toàn diện"
hide: true
---

<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# GStack QA — Systematic Web App Testing + Fix Loop

> Ported from [garrytan/gstack](https://github.com/garrytan/gstack) `/qa` (MIT License)

## Overview

Systematically test web apps, tìm bugs, fix iteratively, cung cấp before/after health scores. Dùng `browser_subagent` (Antigravity IDE native) thay vì Playwright binary gốc.

**Note:** Standalone — không thay thế SA `browser-agent` skill.

## When to Use
- Sau implementation, cần QA web app
- Khi user nói "gstack QA", "test and fix"

<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->
## Testing Tiers

| Tier | When | Coverage |
|------|------|----------|
| Quick | Smoke test | Happy path only |
| Standard | Pre-merge | Happy path + top edge cases |
| Exhaustive | Release | All paths, mobile, a11y, performance |

### Step 1: Ensure App Running
```
ctx_execute(language: "shell", code: """
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null || echo 'NOT_RUNNING'
""", intent: "check if app is running")
```
Nếu NOT_RUNNING → hỏi user: "App đang chạy ở URL nào?"

### Step 2: Initial Health Score
```
browser_subagent(
  Task: "Navigate to [URL]. Take screenshots of main pages. Report:
    1. Pages that load successfully
    2. Console errors
    3. Visual issues
    4. Broken links or buttons",
  RecordingName: "qa_initial_health"
)
```

Score: `[pages working]/[total pages] × 100 = Health Score Before`

### Step 3: Systematic Testing

**Quick Tier:**
1. Navigate all main routes — do they load?
2. Submit all forms — do they work?
3. Check all links — do they navigate?
4. Look for console errors

**Standard Tier (add):**
5. Test with empty inputs — error messages shown?
6. Test with invalid inputs — validation works?
7. Test auth flow — login/logout/protected routes
8. Test responsiveness — mobile viewport
9. Test with slow network (observe loading states)

**Exhaustive Tier (add):**
10. Keyboard navigation (Tab through all elements)
11. Screen reader compatibility check
12. Print stylesheet
13. Bookmark/Share URLs work
14. Browser back button behavior
15. Multiple tabs open simultaneously

### Step 4: Fix Loop

For each bug found:
1. Document: `## Bug [N]: [description]`
2. Screenshot before: `browser_subagent` capture
3. Fix code: `replace_file_content`
4. Atomic commit: `run_command: git add -A && git commit -m "fix(qa): [description]"`
5. Verify fix: `browser_subagent` screenshot after
6. Log: `ctx_index(content: "Bug [N]: FIXED — [desc]", source: "GStack QA")`

### Step 5: Final Health Score
```
browser_subagent(
  Task: "Navigate to [URL] again. Take screenshots of same pages as initial.
    Report health score: pages working, console errors, visual issues.",
  RecordingName: "qa_final_health"
)
```

### Step 6: Report
```
QA REPORT
═════════
Tier: [Quick/Standard/Exhaustive]
Health Before: [X]%
Health After:  [Y]%
Bugs Found:   [N]
Bugs Fixed:   [M]
Bugs Deferred: [N-M] (with reasons)
Commits:      [list of fix commits]
```

## Integration
- **Uses MCP**: `browser_subagent` for testing, `ctx_execute` for health checks, `ctx_index` for bug tracking
- **Standalone** — does NOT modify `browser-agent` or `test-driven-development` skills
- **Module**: GStack Imported (standalone, prefix `gstack-`)

<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## Edge Cases

| Scenario | Handling |
|----------|----------|
| App not running | Hỏi user URL. Nếu dev server chưa start → `run_command: npm run dev` |
| SPA with client-side routing | browser_subagent phải navigate bằng click, không bằng URL trực tiếp |
| Auth-protected pages | Login trước khi test protected routes |
| Mobile-only bugs | browser_subagent set viewport: `Task: "Resize browser to 375x812 (iPhone). Navigate..."` |
| Flaky tests (pass sometimes) | Retry 3 lần trước khi report as bug |
| App uses SSR | Test cả server-rendered HTML và client-hydrated state |
| No console access | Screenshot-based testing only — report visual issues |

## Browser Subagent Tips

```
# Screenshot specific element
browser_subagent(Task: "Navigate to [URL]. Click on [element]. Take screenshot of the result.", RecordingName: "qa_[feature]")

# Test form submission
browser_subagent(Task: "Fill form: name='Test', email='test@test.com'. Submit. Report success/failure.", RecordingName: "qa_form_test")

# Test mobile responsive
browser_subagent(Task: "Resize to 375x812. Navigate to [URL]. Report layout issues.", RecordingName: "qa_mobile")
```

## Model Recommendation

| QA Tier | Best Model | Why |
|---------|:----------:|-----|
| Quick (smoke) | Gemini Flash | Fast iteration |
| Standard | Gemini Pro | browser_subagent native + balanced |
| Exhaustive | Claude Opus | Deep a11y + edge case reasoning |

