## Scenario Report: OMP_UPSTREAM_SYNC_PLAN.md

Dimensions analyzed: Input Extremes, State Transitions, Environment, Error Cascades, Data Integrity, Integration
Dimensions skipped: User Types, Timing, Scale, Authorization, Compliance, Business Logic (Not applicable to a local sync orchestration script)

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|-----------|----------|----------|-------------------|
| 1 | Error Cascades | `git fetch` or `git merge` fails due to network or merge conflicts, but the bash script continues to execute. | Critical | Script MUST fail fast (`set -e`) and not overwrite local files with an incomplete state. |
| 2 | Data Integrity | `config/settings.json` in upstream is malformed (invalid JSON) or structurally changed. | High | The Node.js script `omp-sync-plugins.mjs` MUST catch `JSON.parse` errors and abort before writing a corrupted `package.json`. |
| 3 | State Transitions | User interrupts the sync script (Ctrl+C) mid-execution (e.g., during file copy). | Medium | The script should ideally use atomic operations or temp directories before swapping, or warn on next run. |
| 4 | Environment | Node.js script is called on Windows without explicitly invoking `node` (if script lacks execution bits or env path mapping). | Medium | Bash script MUST invoke `node scripts/omp-sync-plugins.mjs` explicitly rather than relying on shebangs. |
| 5 | Integration | Upstream `pi` introduces a new core plugin that natively conflicts with `omp` but isn't in the hardcoded blocklist. | High | Script needs a strict inclusion list OR an explicit check for known OMP overrides, failing if an unknown core extension is added upstream. |

### Summary
- Critical: 1
- High: 2
- Medium: 2
- Low: 0
- Total: 5 scenarios across 5 dimensions

---

## Research: Pi Extensions & Component Reusability in OMP

Based on the architectural research between Mario Zechner's `pi` and Can Bölük's `omp` (Oh-My-Pi):

1. **Shared Hook Semantics (`HookAPI`)**: OMP is a direct fork of Pi and shares baseline hook semantics. Pi's lifecycle hooks (e.g., `tool_call`, `tool_result`, `session_start`) can be reused almost entirely natively. You can migrate Pi's hooks by placing them in OMP's `~/.omp/agent/extensions/` or `.omp/extensions/` directory.
2. **TypeScript Extensions (`ExtensionAPI`)**: Pi's TS extensions that register tools or modify UI can be ported. OMP wraps these in an `ExtensionRunner`. Minor refactoring may be required to match OMP's ArkType (`omptype`) schema validation if the original Pi extensions used standard Zod or plain JSON schemas.
3. **Markdown Agents (Subagents)**: If `pi` used specific `.md` prompt instructions for subagents, these are 100% compatible. They just need to be placed in `.omp/agents/*.md` with OMP's expected YAML frontmatter.
4. **Incompatible Components - Inference Providers**: Pi's AI provider wrappers are **not** directly reusable. OMP handles models via its own `@oh-my-pi/pi-ai` centralized model registry and a flat `ProviderConfig` contract. Any Pi extension that manually wraps AI completions needs to be rewritten to OMP's `ProviderConfig`.

---

I have prepared an updated robust execution plan that patches the discovered vulnerabilities in the sync process and safely integrates the reusable Pi components.