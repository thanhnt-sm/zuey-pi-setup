---
name: omp-typesafe-judge-setup
description: "Use when configuring, debugging, or validating TypeSafe judge integration in oh-my-pi (omp): activation gates, resolver behavior, device diagnostics, and restart procedure."
---

# TypeSafe Judge Setup & Diagnostics (omp)

## Two-Gate Activation

Both gates must pass or `xd://typesafe_judge` returns `"TypeSafe disabled"`:

1. **Gate 1 – Credential:** `TYPESAFE_API_KEY` must be present in the **omp host process environment at startup**. Setting it in bash after omp starts is NOT inherited. Set it in the shell profile that launches omp (`~/.bashrc`, PowerShell `$PROFILE`, or Windows User Environment Variables), then restart omp.

2. **Gate 2 – Global Allowlist:** `~/.claude/.ck.json` must list the workspace in `typesafe.projects[]`. Use `"*"` for wildcard (all workspaces):
   ```json
   { "typesafe": { "projects": ["*"], "excludeProjects": [] } }
   ```

## Resolver Precedence (typesafe-enabled-resolver.cjs)

```
kill switch (typesafe.enabled: false or typesafe === false)
  > excludeProjects[] deny list   → reason: "global-exclude"
  > projects[] wildcard "*"       → reason: "global-allowlist"
  > projects[] explicit path      → reason: "global-allowlist"
  > no key                        → reason: "no-key"
  > default                       → reason: "default-off"
```

Module is CJS — cached in Node's module cache. **Code changes to the resolver require restarting omp** to take effect. Config-only edits to `.ck.json` are read on each call; no restart needed for those.

## Diagnosing "TypeSafe disabled"

`xd://typesafe_judge` returns `"TypeSafe disabled"` for at least four distinct causes — identical output, cannot distinguish without restart + inspection:

| Cause | Resolver reason | Extension path |
|-------|-----------------|----------------|
| Missing host env key | `no-key` | Gate 1 |
| 401/403 from API | `disabledByAuthError` | Post-credential |
| Resolver load/call failure | _(exception)_ | typesafe-planner.ts:276–285 |
| `enabled: false` in config | `global-kill-switch` | Gate 2 |

**Do not assume stale CJS cache is the sole cause** before restarting. A bash session `echo $TYPESAFE_API_KEY` proves only the *shell's* env, not what the omp host process inherited at startup. **Record root cause as "unconfirmed; restart required to isolate"** until a post-restart probe + resolver inspection is complete.

## Post-Restart Diagnostic Procedure

After restarting omp:

1. **Probe device** — write a minimal payload to `xd://typesafe_judge`. Structured `{answers: {...}}` = both gates pass. `"TypeSafe disabled"` = still failing.
2. **If still disabled** — run the resolver in a fresh Node subprocess (not eval, which shares the omp process):
   ```bash
   node -e "
   const { resolveTypeSafeEnabled } = require('~/.claude/hooks/lib/typesafe-enabled-resolver.cjs');
   console.log(JSON.stringify(resolveTypeSafeEnabled(process.cwd())));
   "
   ```
   The `reason` field isolates the cause:
   - `no-key` → Gate 1 failure: `TYPESAFE_API_KEY` not in the omp host process env
   - `global-kill-switch` / `global-exclude` / `default-off` → Gate 2 / config issue
3. **Inspect extension** — check `typesafe-planner.ts:276–285` for the resolver call path actually used by the running omp build to confirm it reaches the same module.

## Wildcard + Exclude Config (one-time setup)

```json
// ~/.claude/.ck.json
{
  "typesafe": {
    "projects": ["*"],
    "excludeProjects": ["C:/path/to/sensitive/workspace"]
  }
}
```

Deny list (`excludeProjects`) always wins over wildcard.

## Fallback Chain

If TypeSafe is disabled or auth fails, `judge()` silently falls back to `cfg://retry/fallbackChains.judge = ["@tiny","@smol","@default"]`. Automatic — no extra config needed.
