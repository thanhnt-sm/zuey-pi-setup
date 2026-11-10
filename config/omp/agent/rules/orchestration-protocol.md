> **OMP Adaptation Note:** Ported read-only from global `~/.claude/rules/`. Map Claude `Agent(...)` -> OMP `task`, `advisorModel` -> `modelRoles.advisor`, and `ai-gate-audit` -> `typesafe-planner` extension.

# Orchestration Protocol

This kit runs a multi-model cascade: Fable orchestrates and plans, the configured advisor model advises (read-only), Sonnet executes, Haiku scouts and handles light ops.

## Roles

- **The main session (`orchestrator` agent) is model-conditional.** On Fable or Opus, it is **lead**: it plans, delegates via `Agent(...)` by role (code → Sonnet, review/RCA → Opus, lookup/ops → Haiku), owns refusals and recovery from subagent failure, and asks the user when scope is genuinely ambiguous. The lead may still edit small things itself — plan/memory files, merge conflicts, review nits, or a change it can finish in under ~3k output tokens — everything else routes to a Sonnet executor. On Sonnet, the main session implements directly; no delegation guard applies. `main-thread-guard` (PreToolUse) enforces the lead/nudge behavior by session model plus `agent_type`, not by a blanket ban; strict no-edit (`deny`) is opt-in per run via `--delegate` (`/ck:cook --delegate`, `/ck:team --delegate`) or `CK_ROUTING_ENFORCE=deny`.
- **Subagents** act within their tool scope: Sonnet executors get Edit/Write; advisor subagents are read-only; Haiku agents handle research/docs/git/ops.

## Native vs. structured advisor

The native per-turn advisor must rank at or above the main model. The kit ships `advisorModel: fable`: Fable is accepted as advisor by every main model, and Sonnet/Opus subagents inherit it and apply the same pairing check against their own model. The one rejected pairing is an Opus (or Sonnet) advisor on a Fable main, where the native advisor is silently not attached — so a user who sets `/advisor opus` should not run a Fable main (the SessionStart pairing warning flags this). On some plans the Fable advisor attaches only after the usage-credit consent is accepted once via `/model fable`; until then it is silently inert.

Separately, Fable calls the `ck:advisor` subagent (the configured advisor model: `advisorModel`, as a per-call `model` override with the qualifier that follows; fixed verdict/findings contract) — `model` is passed only when `advisorModel` is `opus` or `fable`, otherwise the agent default applies (shared §10) — at five points: after drafting a plan and before asking the user to approve it; before dispatching a phase marked cross-cutting or high-risk; when an executor returns `DONE_WITH_CONCERNS`, or `BLOCKED` twice; at the completion/decision gate (shared §10: the completion gate runs before each phase is marked done, the decision gate once per architectural decision before code is written; at least one audit or fallback call each, up to 4 per gate in the worst case, which with `advisorModel=fable` may bill usage credits on some plans); and pre-merge, where the advisor is `ck:code-reviewer` with the diff path. Executors may also consult their own native advisor mid-task for a judgment call — a lighter path than escalating back to Fable.

The `advisor-model-inject` hook backs that rule when the lead forgets: on an `advisor`/`ck:advisor` spawn that omits `model`, it injects `advisorModel` (when `opus` or `fable`) per call, resolved local → project → global exactly as above, and prints one line naming the source file. A project or local settings file can therefore select a costlier advisor model than the global one; the line highlights that case (`advisorModel fable from project settings.json; global opus`). An explicit `model` from the caller is never changed, and a model-attributable failure pauses injection of that model for the session. Advisors spawned by Workflow scripts (for example `workflows/red-team.js`), or by any path that does not go through the main session's `Agent` tool, fire no PreToolUse and are not injected; the lead must pass `model` itself there.

The `ai-gate-audit` hooks make every TypeSafe judge / gate round and every advisor or review spawn visible: one `[AI gate HH:MM:SS g-xxxxxxxx]` line per call in the main session, and an append-only record under `~/.omp/agent/logs/ai-gates/` (14 days, redacted requests only). When a call comes back non-pass, the hook also adds one `AI-gate g-xxxxxxxx: ...` line to the model's context naming the decision and the next action. Treat it as information, not as a verdict: the hook never blocks, a gate round `passed` is atomic evidence only (completion still needs an advisor synthesis), and nothing here changes who decides. A line ending in `AUDIT NOT SAVED (<code>)` means the log could not be written; the gate result itself is still valid.

## Subagent Status Protocol

Subagents end their response with one line: `**Status:** DONE | DONE_WITH_CONCERNS | BLOCKED`.

| Status | Controller action |
|---|---|
| DONE | proceed to the next step |
| DONE_WITH_CONCERNS | address it if it's a correctness/scope issue, otherwise proceed and note it |
| BLOCKED | add context, simplify the task, escalate to `ck:advisor`, or ask the user — don't retry the same approach unchanged |

Escalate rather than retry the same failing approach a third time.

## Context Isolation

Give subagents only what they need: task, file paths, acceptance criteria, and the relevant plan phase — not the full session history. `subagent-init` already injects the work-context, reports, and plans paths; add a path explicitly only when it differs from that default.

## Delegation Patterns

- `cook`, `ck-plan`, `fix`, `ship` run inline in Fable (they need `AskUserQuestion`, `TaskList`, or Workflow, none of which subagents have); each step spawns via `Agent(...)`.
- `cook --parallel` / `ck-plan --parallel` use the `parallel-phases` workflow; pass `isolation: "worktree"` on the Agent call for phases that run concurrently, never in agent frontmatter.
- `test`, `code-review`, `scout`, `research`, `docs-seeker`, `journal`, `git`, `retro`, `watzup` now fork (`context: fork` in the skill's own frontmatter) instead of running inline: `/ck:test` → `agent: tester`, `/ck:code-review` → `agent: code-reviewer`, `/ck:git` → `agent: git-manager` (all three `background: false` — the caller waits on the result). `/ck:scout` → `agent: Explore` (`haiku`), `/ck:research` and `/ck:docs-seeker` → `agent: researcher` (`sonnet`/`medium`) — these three are also `background: false` because `cook`/`ck-plan` wait on them in the same turn. `/ck:journal` → `agent: journal-writer` (`haiku`/`low`); `/ck:retro` and `/ck:watzup` → `agent: researcher` (`sonnet`/`medium`) — these three are `background: true` since the caller doesn't need the result in the same turn. A forked skill has no conversation history and can't call `AskUserQuestion`/`Workflow`: its instructions are self-contained and take input through `$ARGUMENTS`; anything needing a user decision (which git operation, which review target, an unresolved sprint start date) is resolved by the caller before invoking, never inside the fork. `cook`, `ck-plan`, `fix`, `ship`, `brainstorm`, `bootstrap` stay inline in Fable — they still need `AskUserQuestion`, `TaskList`, or `Workflow` themselves. Fable stays the orchestrator either way: it issues the `Agent(...)`/forked-skill call and reads back the DONE / DONE_WITH_CONCERNS / BLOCKED summary.

Agent Teams (`/ck:team`) is a peer pattern to the ones above, for genuinely independent parallel sessions with their own context windows — see `skills/team/SKILL.md`. The workflows above (`parallel-phases`, `red-team`, `scout-fanout`) suit most large fan-out inside a single session; reach for `/ck:team` when separate sessions are actually needed.

## Plugin Addressing

Under a plugin install, most addressing needs the exact `<plugin>:<name>` form: an `Agent(...)` call, a workflow's agent-type field, and a skill's own `agent:` frontmatter key (used by every forked skill above) are all namespaced this way — e.g. `ck:planner`, `ck-web:ui-ux-designer`. The one exception is the top-level `agent` setting in `settings.json`, which resolves a bare name on its own. This kit's source stays unprefixed for the legacy (non-plugin) install; building the plugin rewrites every one of the namespaced shapes automatically.
