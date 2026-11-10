---
name: ck:pm-ba
description: "Full PM+BA workflow orchestrator. Analyzes BRD/URD/contract documents, processes meeting notes, manages change requests, generates stakeholder-specific artifacts, maintains traceability. Contract-aware, auto-detect intelligence, acceptance certification. VN-first, document-aware, state-aware."
category: project-management
keywords: [pm, ba, brd, urd, requirements, stakeholder, traceability, change-request, vietnamese]
argument-hint: "[mode-flag] [path-or-context] | natural language in VN or EN"
metadata:
  author: thannt
  version: "1.8.0"
  license: MIT
---

# ck:pm-ba — PM+BA Workflow Orchestrator

## When to Use

- Analyze BRD or URD documents to extract requirements, gaps, and ambiguities
- Process post-meeting notes into action items, decisions, and open questions
- Prepare meeting agendas, pre-read packages, and stakeholder briefs
- Generate User Stories, Acceptance Criteria, and Test Cases from requirements
- Manage Change Requests (CR) lifecycle: log → impact-assess → approve → propagate
- Maintain the traceability matrix across BRD → URD → US → TC
- Track open clarification questions per stakeholder
- Produce status reports for clients, sponsors, developers, or auditors
- Compare two versions of a document and produce a structured diff
- Build and maintain the business glossary
- Create data model specs (ERD description) and screen specs (Screen URD)
- Define API contracts and integration specs
- Plan sprint scope and estimate effort from backlog
- Create UAT plans, sign-off logs, go-live checklists
- Manage risk register updates
- Kick off a new project (generate charter, RACI, initial backlog)
- Check current project state and get recommended next action
- Run [ORG]-KPI-compliant monthly sprint planning + weekly signal tracking (P-level, AP/EP, MP_PM/MP_DEV)

---

## Activation Sequence

0. **Auto-Detect Pre-pass** — When no `--flag` present, run `references/39-mode-auto-detect.md`: read state file, scan `inputs/`, check task list. If confidence ≥ 65%: show context summary + suggest mode, wait for confirm. If < 65%: show summary, fall through to step 1.
1. **NL Intent Detection (VN-first)** — Parse the user's input against Vietnamese phrase patterns in `references/00-intent-routing.md`. Vietnamese is the primary language; English patterns are secondary. Extract mode + required slots from the phrase.
2. **Explicit Flag Override** — If user passes a `--flag` (e.g., `--brd`, `--cr`, `--sprint`), this overrides NL detection. Flags are listed in the Mode Catalog below.
3. **`AskUserQuestion` when ambiguous** — If neither NL pattern nor explicit flag resolves to a single mode, or if a required slot (document path, meeting content) is missing, invoke `AskUserQuestion` with the mode menu (see schema below).

---

## Mode Catalog

> **Note:** Input modes (#1-#58, document analysis + core PM/BA workflows) must integrate with IO-Mapping per `references/io-mapping-integration-snippet.md` — see the 6-step checklist for handler-input-mode.cjs interaction and output locking.

| # | Flag | NL Trigger Examples (VN) | NL Trigger Examples (EN) | Required Input | Reference |
|---|------|--------------------------|--------------------------|----------------|-----------|
| 1 | `--brd` (+ `--quick` modifier) | "phân tích BRD", "đọc tài liệu BRD", "tóm tắt nhanh BRD" | "analyze BRD", "quick BRD summary" | BRD file/folder path | `references/02-mode-brd-analysis.md` |
| 2 | `--urd` (+ `--quick` modifier) | "phân tích URD", "đọc yêu cầu người dùng", "tóm tắt nhanh URD" | "analyze URD", "quick URD summary" | URD file/folder path | `references/03-mode-urd-analysis.md` |
| 3 | `--meeting-post` | "vừa họp xong", "sau buổi họp", "ghi chú họp" | "meeting notes", "post-meeting" | Meeting notes text or file | `references/00-intent-routing.md` |
| 4 | `--meeting-pre` | "chuẩn bị họp", "trước buổi họp", "agenda", "soạn giả thuyết họp", "hypothesis pack" | "prepare meeting", "pre-meeting", "hypothesis-driven prep", "pre-meeting hypotheses" | Meeting topic + attendees | `references/09-mode-meeting.md` |
| 5 | `--clarify` | "câu hỏi cần làm rõ", "open question", "cần clarify" | "open questions", "clarification needed" | Document or meeting context | `references/00-intent-routing.md` |
| 6 | `--cr` | "change request", "thay đổi yêu cầu", "CR mới" | "change request", "scope change" | Description of change + affected doc | `references/00-intent-routing.md` |
| 7 | `--signoff` | "ký duyệt", "approval", "phê duyệt tài liệu" | "sign off", "get approval" | Document name + approver | `references/00-intent-routing.md` |
| 8 | `--trace` | "traceability", "ma trận truy vết", "liên kết yêu cầu" | "traceability matrix", "link requirements" | Scope: BRD/URD/US/TC | `references/00-intent-routing.md` |
| 9 | `--risk` | "cập nhật risk", "risk register", "rủi ro dự án" | "risk register", "update risks" | Risk description or existing register path | `references/00-intent-routing.md` |
| 10 | `--sprint` | "sprint planning", "kế hoạch sprint", "lên sprint" | "sprint planning", "plan sprint" | Backlog items or sprint goal | `references/00-intent-routing.md` |
| 11 | `--uat` | "UAT plan", "kế hoạch UAT", "kiểm thử chấp nhận" | "UAT plan", "acceptance testing plan" | Feature scope + UAT date | `references/00-intent-routing.md` |
| 12 | `--go-live` | "go-live", "training plan", "kế hoạch ra mắt" | "go-live checklist", "launch plan" | Go-live date + modules | `references/00-intent-routing.md` |
| 13 | `--status` | "báo cáo tiến độ", "tình hình dự án", "status report" | "status report", "project status" | Stakeholder audience | `references/00-intent-routing.md` |
| 14 | `--diff` | "so sánh URD v1 v2", "diff tài liệu", "thay đổi gì" | "compare documents", "what changed" | Two document paths | `references/00-intent-routing.md` |
| 15 | `--state` | "tình hình hiện tại", "có gì rồi", "what do we have" | "current state", "show project state" | None | `references/state-and-continuity.md` |
| 16 | `--kickoff` | "khởi tạo dự án", "bắt đầu dự án mới", "kickoff" | "kickoff", "start new project" | Project name + scope brief | `references/00-intent-routing.md` |
| 17 | `--data-model` | "data model", "ERD", "sơ đồ cơ sở dữ liệu" | "data model", "ERD spec" | Entity descriptions or existing DB schema | `references/00-intent-routing.md` |
| 18 | `--screen` | "spec màn hình", "screen URD", "đặc tả giao diện" | "screen spec", "screen URD" | Screen name + functional requirements | `references/00-intent-routing.md` |
| 19 | `--template` | "biên bản", "template", "mẫu tài liệu" | "document template", "generate template" | Template type | `references/artifact-naming.md` |
| 20 | `--report` | "báo cáo", "tổng hợp", "reporting" | "generate report", "summary report" | Report type + audience | `references/00-intent-routing.md` |
| 21 | `--api` | "API contract", "integration spec", "đặc tả API" | "API spec", "integration contract" | Endpoint list or service description | `references/00-intent-routing.md` |
| 22 | `--glossary` | "từ điển nghiệp vụ", "glossary", "thuật ngữ" | "business glossary", "terminology" | Terms from BRD/URD or manual list | `references/00-intent-routing.md` |
| 23 | `--backlog` | "groom backlog", "ưu tiên backlog", "sizing story", "refinement" | "backlog grooming", "story prioritization", "refinement" | Backlog items + priority criteria | `references/22-mode-backlog.md` |
| 24 | `--defect` | "triage bug", "phân tích lỗi", "đánh giá bug", "severity defect" | "defect triage", "bug analysis", "defect severity" | Defect list or description | `references/23-mode-defect.md` |
| 25 | `--process-map` | "vẽ quy trình", "AS-IS TO-BE", "BPMN", "sơ đồ nghiệp vụ" | "process mapping", "AS-IS TO-BE", "BPMN flow" | Process description or existing flow | `references/24-mode-process-map.md` |
| 26 | `--closure` | "đóng dự án", "kết thúc dự án", "handover", "bàn giao" | "project closure", "close out", "lessons learned" | Project summary + handover details | `references/25-mode-closure.md` |
| 27 | `--hypercare` | "hypercare", "hỗ trợ sau ra mắt", "sau go-live", "stabilization" | "hypercare", "post-launch support", "stabilization period" | Go-live date + support scope | `references/26-mode-hypercare.md` |
| 28 | `--maintenance` | "bảo trì", "vận hành", "SLA monitoring", "yêu cầu cải tiến" | "maintenance", "SLA monitoring", "operations", "enhancement intake" | Month/period + SLA targets | `references/27-mode-maintenance.md` |
| 29 | `--release` | "release plan", "release notes", "kế hoạch release", "phiên bản mới" | "release plan", "release notes", "version release" | Release scope + date | `references/28-mode-release.md` |
| 30 | `--data-migration` | "chuyển đổi dữ liệu", "migration plan", "data cutover", "di chuyển dữ liệu" | "data migration", "data cutover", "migration planning" | Source system + target schema | `references/29-mode-data-migration.md` |
| 31 | `--test-case` | "test case BA", "kịch bản kiểm thử nghiệp vụ", "SIT scenario" | "BA test cases", "SIT scenarios", "business test case" | Feature list or AC list | `references/30-mode-test-case.md` |
| 32 | `--raci` | "RACI", "ma trận trách nhiệm", "communication plan", "ai làm gì" | "RACI matrix", "responsibility assignment", "communication plan" | Stakeholder list + roles | `references/31-mode-raci.md` |
| 32a | `--raci --capability-map` | "bản đồ năng lực", "ai biết gì", "capability map", "lịch rảnh team" | "capability map", "skills matrix", "expertise map", "team capacity map" | None | `references/43-mode-capability-map.md` |
| 33 | `--estimation` | "ước tính", "estimate", "story point", "t-shirt size", "capacity" | "estimation", "story sizing", "capacity planning" | User story list or feature scope | `references/32-mode-estimation.md` |
| 34 | `--persona` | "persona", "người dùng đại diện", "user journey", "hành trình người dùng" | "user persona", "user journey mapping" | User groups description | `references/33-mode-persona.md` |
| 35 | `--daily` | "họp daily", "standup hôm nay", "cập nhật task team", "báo cáo ngày", "daily meeting xong" | "daily standup", "team task update", "standup notes" | Standup notes (inline, file path, or interactive) | `references/36-mode-daily-standup.md` |
| 36 | `--contract` | "phân tích hợp đồng", "đọc hợp đồng", "hop dong", "điều khoản hợp đồng" | "analyze contract", "contract analysis", "contract clauses" | Contract file/folder path (`inputs/contract/`) | `references/38-mode-contract.md` |
| 37 | `--acceptance` | "kết quả UAT", "nghiệm thu", "chứng nhận nghiệm thu", "tổng hợp UAT" | "acceptance certification", "UAT results", "sign-off report" | UAT results file or inline | `references/40-mode-acceptance.md` |
| 38 | `--pm` | "tôi cần làm gì hôm nay", "pm dashboard", "tình hình PM", "cockpit", "xem tổng quan PM", "sáng nay làm gì" | "pm dashboard", "what should I do today", "PM cockpit", "morning brief", "project overview PM" | None (reads state files) | `references/41-mode-pm-cockpit.md` |
| 39 | `--data-classify` | "phân loại dữ liệu", "data classification", "loại dữ liệu nào cần bảo mật" | "data classification", "classify data entities", "data sensitivity" | Document path or inline entity list | `references/45-mode-data-classify.md` |
| 40 | `--sprint-zero` | "sprint 0", "bắt sprint 0", "artefact đầy đủ", "khởi động sprint zero" | "sprint zero", "sprint 0 artifacts", "full project kickstart" | BRD/URD path + ProjectName + Deadline | `references/46-mode-sprint-zero.md` |
| 41 | `--kpi-plan` (+ `--confirm <file>`, `--period`, `--project-slug`) | "plan tháng KPI", "tasklist KPI tháng", "kế hoạch KPI sprint", "lock proposal" | "KPI sprint plan", "KPI monthly plan", "confirm proposal" | period + team_roster + coefficients (auto-prompt) | `references/47-mode-kpi-plan.md` |
| 42 | `--kpi-track` (+ `--month-end`, `--week N`, `--period`, `--no-cap`, `--continue`) | "KPI tuần này", "AP/EP bao nhiêu", "signal KPI", "cuối tháng KPI", "báo cáo KPI tuần" | "KPI weekly track", "KPI signal", "month-end KPI" | None (reads state) | `references/48-mode-kpi-track.md` |
| 43 | `--kpi-pm-summary` (+ `--month YYYY-MM`, `--pm <name>`) | "tổng hợp KPI PM", "MP_PM nhiều dự án", "dashboard PM cross-project" | "PM summary KPI", "cross-project MP_PM" | None (reads multiple states) | `references/49-mode-kpi-pm-summary.md` |
| 44 | `--kpi-coeff-change` | "đổi hệ số S", "PD duyệt đổi C", "thay coefficient KPI" | "change coefficient", "coefficient signoff" | S/C/R new value + reason | `references/50-mode-kpi-coeff-change.md` |
| 45 | `--kpi-pending-approve <memo>` (alias: `--kpi-coeff-approve`, deprecated v1.5.1+, sunset v1.7) | "PD đã duyệt hệ số", "apply coefficient change" | "approve coefficient", "apply signed memo" | Signed memo path | `references/51-mode-kpi-coeff-approve.md` |
| 46 | `--kpi-decompose <parent>` (+ `--strategy`, `--target-mds`, `--confirm`) | "tách task", "chia nhỏ task", "decompose task lớn" | "decompose task", "split large task" | Parent task ID or URD path | `references/52-mode-kpi-decompose.md` |
| 47 | `--kpi-assign` (+ `--strategy`, `--confirm`, `--force-stretch`) | "phân công tự động", "assign tasks", "ai làm task nào" | "auto-assign tasks", "assignment optimizer" | None (reads locked tasks) | `references/53-mode-kpi-assign.md` |
| 48 | `--kpi-team-update <name> --op {add\|remove\|level-change\|vacation}` | "DEV nghỉ", "thêm member team", "đổi level DEV", "vacation member" | "team member change", "DEV vacation" | name + op-specific args | `references/54-mode-kpi-team-update.md` |
| 49 | `--kpi-add-task --p --assignee --description` | "thêm task khẩn", "bổ sung task mid-sprint" | "add urgent task", "mid-sprint task add" | P-level + assignee + description | `references/55-mode-kpi-add-task.md` |
| 50 | `--kpi-replan --reason` (+ `--new-ep`, `--force-no-pd`) | "replan tháng", "tính lại kế hoạch" | "replan sprint", "recompute milestones" | reason (≥30 chars) | `references/56-mode-kpi-replan.md` |
| 51 | `--kpi-resync` (+ `--dry-run`) | "đồng bộ KPI source", "resync drift" | "resync KPI sources", "drift remediation" | None | `references/57-mode-kpi-resync.md` |
| 52 | `--kpi-pause --reason` / `--kpi-resume` | "tạm dừng KPI", "pause project", "tiếp tục KPI" | "pause KPI", "resume KPI tracking" | reason for pause (≥30 chars) | `references/58-mode-kpi-pause-resume.md` |
| 53 | `--kpi-hire-suggest` (+ `--months N`) | "có cần tuyển không", "team gap analysis", "đề xuất hire" | "hire suggestion", "team gap analysis" | None (reads N-month history) | `references/59-mode-kpi-hire-suggest.md` |
| 60 | `--full` (+ `--skip-locked`, `--resume`, `--dry-run`, `--inputs-dir`) | "chạy full", "phân tích toàn bộ", "pm-ba full" | "run full", "full pipeline" | None (auto-scan input_root) | `references/io-mapping-protocol.md` §6 |
| 62 | `--accept` (+ `--map <id>`, `--all`, `--dry-run`, `--auto-confirm`) | "chốt output", "đã sửa output", "lock my edits" | "accept human edits", "confirm changes" | None (scans docs/ diffs) | `references/io-mapping-protocol.md` §7 |
| 63 | `--unlock` (+ `--map <id>`, `--reason`, `--cascade`, `--no-cascade`, `--dry-run`) | "mở khóa MAP-XXX", "unlock output" | "unlock map", "release lock" | map_id | `references/io-mapping-protocol.md` §11 |
| 65 | `--io-status` (+ `--map <id>`, `--format`, `--detect-stale`) | "trạng thái mapping", "xem io-mapping" | "io mapping status", "show locks" | None | `references/61-mode-io-status.md` |

---

## Detailed Mode Documentation

### #62 — `--accept` mode

**Trigger:** `ck:pm-ba --accept` or NL "nhận lại human edits", "consistency check"

**CLI:**
```
ck:pm-ba --accept [--map MAP-NNN] [--all] [--dry-run] [--auto-confirm]
```

**Flow:**
1. Scan LOCKED mappings (single via --map or all via --all)
2. For each output, recompute hash; if differs from stored → STALE_OUTPUT
3. Generate consistency-check report stub in `plans/reports/consistency-check-YYMMDD-MAP-NNN.md`
4. Emit `actions: [{ type: 'consistency_check_requested', ... }]` + `user_prompts[]` → exit 2
5. Claude spawns subagent (researcher / code-reviewer) per template in `io-mapping-protocol.md §7.1`
6. Subagent fills `## Subagent Findings` + `## Verdict` in report
7. Claude re-runs `handler-accept.cjs --map <id> --auto-confirm`
8. On `- [x] PASS`: append v(N+1) PENDING_REVIEW, audit ACCEPT_PASS + SUPERSEDE
9. On `- [x] FAIL`: keep LOCKED, audit ACCEPT_FAIL, surface recommendation to user

**Reference:** `references/io-mapping-protocol.md §7`
**Handler:** `scripts/handler-accept.cjs`

### #63 — `--unlock` mode

**Trigger:** `ck:pm-ba --unlock MAP-NNN` or NL "unlock MAP-NNN", "mở khóa mapping"

**CLI:**
```
ck:pm-ba --unlock --map MAP-NNN [--reason TEXT] [--cascade|--no-cascade] [--dry-run]
```

**State transition (canonical, v1.8.0):**
- Target mapping: `current_version.status: LOCKED → DRAFT` (NOT STALE_INPUT — v1.7.0 spec corrected)
- Downstream mappings (cascade): `LOCKED → STALE_INPUT`
- Sets `bypass_io_lock: true` (per-invocation scope; cleared by session-start hook)

**Flow:**
1. Validate MAP-NNN exists and is LOCKED
2. BFS through downstream dependencies (depth limit 10) for cascade
3. Snapshot before mutation
4. Atomic write to io-mapping.json: target → DRAFT, cascade → STALE_INPUT
5. Atomic write to config: bypass_io_lock = true
6. Audit UNLOCK event + STALE_INPUT_DETECTED for each cascade entry

**Reference:** `references/io-mapping-protocol.md §3.1`, §11 (bypass mechanism)
**Handler:** `scripts/handler-unlock.cjs`

### #65 — `--io-status` mode

**Trigger:** `ck:pm-ba --io-status` or NL "trạng thái io-mapping", "xem mapping nào lock"

**Type:** READ-ONLY inspection. No side effects.

**CLI:**
```
ck:pm-ba --io-status [--map MAP-NNN] [--format table|json] [--detect-stale]
```

**Output:** Table (default) or JSON listing all mappings with status, version, locked_at, age, outputs count.

**Full reference:** `references/61-mode-io-status.md`
**Handler:** `scripts/handler-io-status.cjs`

---

## Cross-Cutting Protocol

Every mode MUST execute these 3 steps in order:

**(a) Read State** — Before any processing, read `docs/pm-ba-document-status.md`. Extract: last mode run, completed items, active blockers, document statuses. If the current mode was already completed on the same input without changes → log skip message → exit (unless `--force` passed).

**(b) Document Ingest** — For every document or file provided as input, follow the full protocol in `references/document-ingest-protocol.md`. Save raw extracts to disk before synthesis. Choose the correct tool per file extension.

**(c) Write State Back** — At the end of every mode run (success or partial), update `docs/pm-ba-document-status.md` with: mode run, timestamp, outputs produced, new document statuses, any blockers detected.

**(d) Update Output Registry** — After step (c), for any new artifact files produced: update `docs/pm-ba-output-registry.md` per `references/37-output-registry.md` § Write Protocol. If registry does not exist AND current mode is `--state` or `--kickoff`: initialize it. Otherwise skip init silently and log warning.

**(e) Update IO-Mapping** — After step (d), for any output files produced:
1. Compute SHA-256 of input + output via `scripts/normalize-hash.cjs`
2. Locate or create MAP entry in `docs/.pm-ba/io-mapping.json`
3. Append new version with status `PENDING_REVIEW`
4. Invoke `AskUserQuestion`: "Chốt mapping không?" → on YES, status → `LOCKED`
5. On lock: write to `docs/.pm-ba/audit.log` + create snapshot
6. Regenerate `docs/pm-ba-io-mapping.md` via `scripts/io-mapping-render-md.cjs`

If hook `pre-write-io-mapping-check.cjs` blocks a write because mapping is LOCKED:
- Surface block message to user
- Suggest: `--unlock <map_id>` to release, or `--accept` to update lock
- Never bypass without explicit user authorization

---

## 20 Invariants

1. **Intent before flag** — Parse NL VN-first; flags are override-only. Never skip NL detection when no flag is present.
2. **State first** — Read `docs/pm-ba-document-status.md` before every mode. Never redo completed work without `--force`.
3. **Evidence-on-disk** — Every document read → save raw extract to `plans/reports/raw-extract-{date}-{slug}.md` before synthesis. Subagent summaries MUST be saved to disk before use.
4. **Per-extension ingest** — `.md`/`.txt` → Read tool; `.pdf`/`.docx`/`.pptx`/`.xlsx` → `mcp__markitdown__convert_to_markdown`; images → `ck:ai-multimodal`; files >500KB → chunked subagent per `references/document-ingest-protocol.md` Tier 3.
5. **VN-first output** — Default output language is Vietnamese. Switch to English only when a stakeholder template explicitly requires it or the user requests EN output.
6. **Stakeholder declared** — Every output artifact frontmatter must include a `stakeholder:` field specifying the intended audience (client, dev, sponsor, auditor, internal).
7. **Traceability mandatory** — Every new User Story, Acceptance Criterion, or Test Case adds a row to `docs/pm-traceability-matrix.md`. No artifact is complete without this step.
8. **CR lifecycle enforced** — Any change to a signed-off document requires a CR row in `docs/pm-change-request-log.md` before the change propagates. Status `propagated` is blocked without status `approved` being set first.
9. **Never overwrite silently** — On artifact collision (existing file with different content) → produce a diff → invoke `AskUserQuestion` with options: overwrite | merge | save-new-version. Never silently overwrite.
10. **Graceful degradation** — Missing `/ck:*` skill → use fallback defined in `references/skill-routing-fallback.md`. Never silently fail; always log what fallback was used.
11. **Idempotency** — Unchanged input (same mtime + content hash) → no-op. Log: "No changes detected. Skipping (use --force to reprocess)."
12. **`--dry-run` modifier** — When `--dry-run` is appended to any mode flag, produce console-only output. Zero file writes. All outputs printed to stdout only.
13. **End-of-mode hooks** — Invoke `/ck:journal` only after: `--kickoff`, `--signoff`, `--cr` (approved), `--sprint` (finalized), `--uat` (completed), `--go-live`, `--release`, `--closure`, `--sprint-zero` (completed). After milestone modes, advise user to run `/ck:project-organization`.
14. **Privacy compliance** — Any file path matching `.env`, `credentials.*`, or containing API keys → trigger the CLAUDE.md PRIVACY_PROMPT protocol: parse hook JSON → invoke `AskUserQuestion` for approval → proceed only with explicit user approval.
15. **Output registry mandatory** — After every mode run producing a new artifact file, update `docs/pm-ba-output-registry.md`: add output row linked to source input Doc IDs. Mark stale any prior outputs derived from a source input that has since been updated. Initialize registry on first run if absent.
16. **Contract-first traceability** — When `docs/ba-contract-requirements-map.md` exists, every `--trace` run must include the CC-XXX pass and populate the CC-IDs column. BR-XXX orphans (no CC upstream) are flagged with `CC unlinked` gap code but are NOT blocked — contract may be added later.
17. **Hypothesis-tiered evidence** — Every hypothesis in a hypothesis pack must carry an evidence-tier label: FACT (stated in signed doc, source required), INFERRED (derived from FACT + domain logic, derivation required), or ASSUMED (no evidence, Q-XXX auto-created). Re-prompt if H1-H6 rules are violated. Never label INFERRED as FACT.
18. **Capability map read-only by consumers** — `docs/pm-capability-map.md` is written ONLY by `--raci --capability-map`. All other modes (`--sprint`, `--cr`, `--estimation`, `--meeting-pre`, `--pm`, `--clarify`) read it read-only. Never write or modify the capability map from a consuming mode.
19. **KPI state protection (v1.6 — enforcement)**
    KPI state files (`docs/pm-ba-kpi-state-*.md`) protected by Layer-1 fence + body_hash + Layer-2 pre-Write hook (`pre-write-kpi-state-check.cjs`) enforcing content invariants:
      - Ledger append-only (no mutation of prior rows)
      - `ep_cumulative_anchor` immutable
      - `body_hash` valid against current body
      - Audit-log non-deletion via state-file writes
      - `schema_version` monotonic
    Trust anchor: monthly PD signoff of audit-log tail hash in `docs/pd-signoff/kpi-monthly-{YYYY-MM}.md`. Unlock via Mode 60 `--kpi-unlock --tail-anchor` ONLY. See `kpi-state-protection.md`.
20. **IO-Mapping lock protection (v1.8 — enforcement)**
    Output files in `docs/` with LOCKED mappings in `docs/.pm-ba/io-mapping.json` are protected by two-tier enforcement:
      
    **Tier 1 (Hook):** `.claude/hooks/pre-write-io-mapping-check.cjs` blocks Write/Edit/MultiEdit/NotebookEdit/Bash redirect targeting LOCKED outputs
    - Bash matcher coverage (v1.8.0): `>`, `>>`, `Out-File`, `Set-Content`, `Tee-Object`, `Add-Content`, `tee` redirects
    
    **Tier 2 (AI rule):** This skill refuses to suggest edits to LOCKED files without explicit `--unlock` first
    - Append-only versioning: new lock = new version, never overwrites prior
    - Cascade invalidation: unlock parent → downstream mappings marked `STALE_INPUT`
    - Fail-closed: hook internal error → block (exit 1)
    
    **Bypass:** Set `bypass_io_lock: true` in `.claude/pm-ba.config.json` (per-invocation only — cleared on session start). All bypassed writes emit `BYPASS_USED` audit events.
    
    Trust anchor: human approval via `AskUserQuestion` when status transitions to `LOCKED`. Unlock requires explicit map_id reference. See `io-mapping-protocol.md`.

21. **Atomic persistence (v1.8 — enforcement)**
    All scripts mutating `io-mapping.json`, `audit.log`, snapshots, or `.claude/pm-ba.config.json` MUST use `atomic-fs.atomicWrite` or `atomic-fs.atomicReadModifyWrite`. Direct `fs.writeFileSync` to these paths is forbidden.
    
    **Rationale:** Google Drive sync + power loss → zero-byte LOCKED file = catastrophic data loss without recovery. `atomic-fs.atomicWrite` does tmp-write → fsync → rename, with EBUSY retry tolerance for Drive sync races.
    
    **Enforcement:** Code review + grep audit. Scripts created in Phase 1 (`atomic-fs.cjs`, `audit-log.cjs`, `snapshot-rotator.cjs`) provide the implementation.

22. **Mutual exclusion for io-mapping writes (v1.8 — enforcement)**
    All writes to `io-mapping.json` MUST acquire the file lock via `atomic-fs.acquireLock` (or use `atomicReadModifyWrite` which acquires automatically).
    
    **Rationale:** Concurrent invocations (e.g., Wave A handler-input-mode for brd + contract simultaneously) without lock → race condition → silent mapping loss.
    
    **Default timeout:** 5 seconds. On `LockTimeoutError`, retry once or surface to user as a `LockConflict` error.
    
    **Enforcement:** Phase 1 `atomic-fs.acquireLock` provides the implementation. Handlers in Phase 3 use it via `atomicReadModifyWrite`.

---

## `AskUserQuestion` Schema

**Fires when:** (a) mode is unresolvable from NL + no flag provided; (b) a required input slot is empty (e.g., no document path for `--brd`); (c) artifact overwrite collision detected.

**Example — no-args invocation:**

```json
{
  "questions": [{
    "question": "Bạn muốn làm gì với tài liệu dự án? (What would you like to do?)",
    "header": "pm-ba — Chọn chế độ làm việc",
    "options": [
      { "label": "Phân tích tài liệu (BRD / URD / Diff)", "description": "--brd, --urd, --diff, --clarify, --glossary" },
      { "label": "Giao tiếp & Họp", "description": "--meeting-post, --meeting-pre, --clarify, --signoff, --cr" },
      { "label": "Sprint & Backlog & Daily", "description": "--backlog, --sprint, --estimation, --defect, --daily" },
      { "label": "Kiểm thử & Triển khai", "description": "--test-case, --uat, --go-live, --release, --data-migration" },
      { "label": "Vận hành & Đóng dự án", "description": "--hypercare, --maintenance, --closure" },
      { "label": "Phân tích & Thiết kế", "description": "--process-map, --screen, --data-model, --api, --persona, --raci" },
      { "label": "Chế độ khác / Nhập lệnh…", "description": "--status, --risk, --trace, --state, --kickoff, --report" }
    ],
    "multiSelect": false
  }]
}
```

**Example — overwrite collision:**

```json
{
  "questions": [{
    "question": "File 'docs/pm-risk-register.md' đã tồn tại và có nội dung khác. Bạn muốn xử lý thế nào?",
    "header": "Xung đột artifact",
    "options": [
      { "label": "Ghi đè (Overwrite)", "description": "Thay thế hoàn toàn bằng nội dung mới" },
      { "label": "Hợp nhất (Merge)", "description": "Gộp nội dung cũ và mới" },
      { "label": "Lưu phiên bản mới (Save new version)", "description": "Tạo file với suffix -v2" }
    ],
    "multiSelect": false
  }]
}
```

---

## Reference Loading

References are loaded **on-demand per mode** — not all upfront. Load only what the active mode requires.

| Reference File | Loaded By Modes |
|---|---|
| `references/00-intent-routing.md` | Always (activation) |
| `references/document-ingest-protocol.md` | Any mode that reads a file |
| `references/skill-routing-fallback.md` | Any mode invoking a sub-skill |
| `references/state-and-continuity.md` | All modes (state read/write) |
| `references/artifact-naming.md` | Any mode producing output files |
| `references/error-handling.md` | On error or partial failure |
| `references/35-output-task-triaging.md` | `--urd` (Step h), `--brd`, `--process-map` — when analysis produces ambiguities requiring task assignments |
| `references/36-mode-daily-standup.md` | `--daily` |
| `references/37-output-registry.md` | All modes that produce output files; `--update` (cascade query when input changes) |
| `references/38-mode-contract.md` | `--contract` |
| `references/39-mode-auto-detect.md` | Auto-detect pre-pass (no flag present) |
| `references/40-mode-acceptance.md` | `--acceptance` |
| `references/41-mode-pm-cockpit.md` | `--pm` |
| `references/42-stakeholder-registry.md` | `--pm`, `--cr`, `--signoff`, `--clarify`, `--meeting-pre` |
| `references/43-mode-capability-map.md` | `--raci --capability-map` |
| `docs/pm-capability-map.md` (read-only) | `--sprint`, `--cr`, `--estimation`, `--meeting-pre`, `--pm`, `--clarify` |
| `references/44-parallel-protocol.md` | `--meeting-pre`, `--brd`, `--cr`, `--estimation`, `--raci --capability-map` |
| `references/45-mode-data-classify.md` | `--data-classify`, `--sprint-zero` |
| `references/46-mode-sprint-zero.md` | `--sprint-zero` |
| `references/output-schemas.md` | All modes producing output files |
| `references/io-mapping-protocol.md` | All modes producing output files; `--full`, `--accept`, `--io-status`, `--unlock` |

---

## Workflow Position

**Precedes:** All PM/BA deliverable chains (BRD analysis → URD → US → TC → UAT → go-live)
**Follows:** User provides context (document paths, meeting notes, or natural language description)
**Integrates with:** `/ck:plan` (planning), `/ck:sequential-thinking` (decomposition), `/ck:mermaidjs-v11` (diagrams), `/ck:preview` (stakeholder reports), `/ck:journal` (post-milestone logging)

---

## Output Directories

| Output Type | Path Pattern |
|---|---|
| Evergreen PM docs | `docs/pm-{slug}.md` |
| Evergreen BA docs | `docs/ba-{slug}.md` |
| Timestamped reports | `plans/reports/pm-{YYMMDD}-{slug}.md` or `ba-{YYMMDD}-{slug}.md` |
| Raw extract evidence | `plans/reports/raw-extract-{YYMMDD}-{slug}.md` |
| Diagrams | `plans/{plan-dir}/visuals/{slug}.md` or `.html` |
| Diff reports | `plans/reports/diff-{YYMMDD}-{a}-vs-{b}.md` |
| Clarification register | `plans/reports/pm-ba-clarification-register.md` (living file) |
| Output registry | `docs/pm-ba-output-registry.md` (living file — tracks input→output dependencies, staleness) |
| Workspace index | `docs/pm-ba-workspace-index.md` (human-readable summary of all outputs, auto-regenerated) |
| Capability map (living doc) | `docs/pm-capability-map.md` |
| Templates | `templates/tpl-{slug}.md` |
| Contract requirements map | `docs/ba-contract-requirements-map.md` (living doc — CC-XXX → BR-XXX mapping) |
| IO-Mapping store (machine) | `docs/.pm-ba/io-mapping.json` (canonical JSON) |
| IO-Mapping view (human) | `docs/pm-ba-io-mapping.md` (auto-generated from JSON) |
| IO-Mapping audit log | `docs/.pm-ba/audit.log` (append-only events) |
| IO-Mapping snapshots | `docs/.pm-ba/snapshots/{timestamp}.json` (rolling, max 5) |
| Consistency reports (Flow B) | `plans/reports/consistency-check-{date}-{map_id}.md` |
| Human export (read-only for pm-ba) | `.docs_human/` (sibling of `docs/`) |

---

## Changelog

### v1.8.0 (2026-05-19)

**Bug patches (HIGH):**
- Fixed `/dev/stdin` ENOENT on Windows (interactive migration)
- Fixed `endsWith` false-positive in lock hook (now exact path equality)
- Hook now covers Bash redirect bypass (`>`, `Out-File`, `Set-Content`, `tee`)
- All io-mapping writes now atomic + fsync (Google Drive corruption safe)
- Snapshot rotation enforced (default max=5, configurable)
- Cross-drive path stored as absolute (no more `..\..\C:\` paths)
- File lock prevents concurrent writer corruption

**New utilities (Phase 1):**
- `scripts/atomic-fs.cjs` — atomic write + file locking
- `scripts/snapshot-rotator.cjs` — snapshot create + rotation
- `scripts/audit-log.cjs` — structured per-MAP audit
- `scripts/path-utils.cjs` — Windows + Google Drive path safety

**New mode handlers (Phase 3):**
- `--accept` (handler-accept.cjs) — consistency check + re-lock
- `--unlock` (handler-unlock.cjs) — LOCKED → DRAFT + cascade
- input modes via handler-input-mode.cjs (NEW/IDEMPOTENT/STALE_INPUT/DRAFT detection)
- `--full` (handler-full.cjs) — wave-execution plan + resume
- `--io-status` (handler-io-status.cjs) — read-only status report

**Spec updates:**
- `references/io-mapping-protocol.md` §3.1 state machine resolved (8-row canonical transition table)
- §6 full-mode wave plan + state file + resume protocol
- §7 --accept subagent prompt template (copy-paste ready)
- §9 audit log 6-field format + complete event enum
- §11 (NEW) bypass mechanism — per-invocation scope
- `references/61-mode-io-status.md` (NEW) — --io-status reference
- `references/io-mapping-integration-snippet.md` (NEW) — reusable 6-step checklist for input modes
