---
name: gstack-ship
description: "[S8.11] GStack ship — sync branch, test, review diff, bump version, PR — Trigger: gstack ship, create PR"
vi_triggers: "gstack ship, tạo PR, ship code, push to main, merge and push, deploy"
hide: true
---

<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# GStack Ship — Complete Ship Workflow

> Ported from [garrytan/gstack](https://github.com/garrytan/gstack) `/ship` (MIT License)

## Overview

Ship workflow: detect + merge base branch, run tests, review diff, bump VERSION, update CHANGELOG, commit, push, create PR.

**Note:** Standalone — không thay thế SA `finishing-a-development-branch` hoặc `/git` workflow.

<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->
## Process

### Step 1: Pre-flight Checks
```
ctx_execute(language: "shell", code: """
echo '=== BRANCH ==='
git branch --show-current
echo ''
echo '=== UNCOMMITTED ==='
git status --short
echo ''
echo '=== AHEAD/BEHIND ==='
git rev-list --count HEAD...origin/$(git branch --show-current) 2>/dev/null || echo 'no upstream'
""", intent: "pre-ship status check")
```

### Step 2: Sync with Base
```
→ run_command: git fetch origin
→ run_command: git merge origin/main --no-edit (hoặc origin/master)
```
Nếu conflicts → fix, commit, continue.

### Step 3: Run Tests
```
ctx_execute(language: "shell", code: """
npm test 2>&1 || yarn test 2>&1 || pytest 2>&1 || go test ./... 2>&1 || echo 'NO_TEST_COMMAND'
""", intent: "pre-ship test results")
```
Nếu tests fail → **STOP**. Fix tests first.

### Step 4: Review Diff
```
ctx_execute(language: "shell", code: """
git diff origin/main..HEAD --stat
echo '---'
git diff origin/main..HEAD --name-only
""", intent: "ship diff review")
```

Quick review: any accidental files? Debug code? Console.logs?

### Step 5: Bump VERSION (optional)
Nếu VERSION file exists:
```
→ view_file VERSION
→ Bump version (patch/minor/major based on changes)
→ write_to_file VERSION
```

### Step 6: Update CHANGELOG
```
→ Thêm entry vào CHANGELOG.md (nếu exists)
→ Format: ## [version] — YYYY-MM-DD
```

### Step 7: Final Commit + Push
```
→ run_command: git add -A && git commit -m "chore: ship v[version]"
→ run_command: git push origin HEAD
```

### Step 8: Create PR (optional)
Nếu user muốn PR:
```
→ run_command: gh pr create --title "[title]" --body "[body]" --base main
```

## Integration
- **Uses MCP**: `ctx_execute` for test/diff analysis
- **Standalone** — does NOT modify `finishing-a-development-branch` or `/git`
- **Module**: GStack Imported (standalone, prefix `gstack-`)

<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## Edge Cases

| Scenario | Handling |
|----------|----------|
| No main branch (uses master) | Auto-detect: `git branch -r \| grep -E 'main\|master'` |
| Merge conflicts | Fix conflicts, run tests again, then continue ship |
| Tests fail | **HARD STOP.** Fix tests before shipping. Never skip. |
| No VERSION file | Skip version bump step |
| No CHANGELOG.md | Skip changelog step |
| `gh` CLI not installed | Skip PR creation, provide manual instructions |
| Uncommitted changes | Warn user: "You have uncommitted changes. Commit or stash first?" |
| Force push needed | ⚠️ Requires `gstack-safety-guardrails` approval if active |

## Pre-Ship Safety Checks

```
ctx_execute(language: "shell", code: """
echo '=== DEBUG CODE CHECK ==='
grep -rn 'console.log\|debugger\|TODO.*REMOVE\|HACK\|XXX' --include='*.ts' --include='*.js' --include='*.py' src/ 2>/dev/null | head -10 || echo 'CLEAN'
echo ''
echo '=== LARGE FILES CHECK ==='
git diff origin/main..HEAD --stat | tail -3
""", intent: "pre-ship safety audit")
```

## Model Recommendation

| Step | Best Model | Why |
|------|:----------:|-----|
| Pre-flight + Sync | Gemini Flash | Fast git operations |
| Test + Diff Review | Gemini Pro | Good at spotting debug code |
| VERSION + CHANGELOG | Gemini Pro | Semantic versioning logic |
| PR Description | Claude Sonnet | Better at writing clear PR descriptions |

