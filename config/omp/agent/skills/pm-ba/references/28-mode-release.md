# Mode: --release — Release Planning + Release Notes

## Purpose

Generate a complete release package: release plan (scope, deployment window, go/no-go checklist, rollback criteria) and dual-audience release notes (technical for dev/ops, formal VN for client). Maintains a versioned release register.

## Trigger Phrases

- Flag: `--release`
- VN: "kế hoạch release", "release notes", "ghi chú phát hành", "chuẩn bị phát hành", "kế hoạch phát hành"
- EN: "release plan", "release notes", "deployment plan", "version release"

---

## 1. Required Input

| Slot | Description | Example |
|------|-------------|---------|
| `version` | Release version label | `v1.2.0` |
| `release_date` | Target go-live date | `2026-06-30` |
| `deployment_window` | Time window for deployment | `22:00–02:00 +07` |
| `scope_source` | How to identify scope | "sprint 3+4 backlog" or user-provided US list |

If any slot is missing, call `AskUserQuestion`:
```
Để tạo Release Plan cho phiên bản này, cần thông tin:
1. Phiên bản (version label, e.g. v1.2.0)?
2. Ngày go-live dự kiến?
3. Cửa sổ triển khai (deployment window — giờ, ngày trong tuần)?
4. Phạm vi release: sprint nào / US nào được đưa vào bản này?
```

---

## 2. Workflow Steps

### Step 2a — Read State
Read `docs/pm-ba-document-status.md` → identify current sprint scope, approved documents, open risks.
Read `docs/pm-traceability-matrix.md` → pull US items with status "Ready for Release" or as specified.
Read `docs/pm-version-register.md` if exists → determine previous version for changelog delta.

### Step 2b — Derive Release Scope via /ck:sequential-thinking
Invoke `/ck:sequential-thinking` with US list and sprint outputs to determine:
- Features INCLUDED in this release (complete US with all AC passing)
- Features EXCLUDED / deferred (why: incomplete, dependency, risk)
- Config changes and environment variable changes (from user-provided technical docs)
- Dependency version changes (libraries, APIs, third-party services)

### Step 2c — Generate Release Plan via /ck:ask
Invoke `/ck:ask` with scope output:
```
Version: [VERSION] | Go-Live: [DATE] | Window: [WINDOW]

Features included: [LIST]
Features excluded: [LIST]

Tạo Release Plan bao gồm:
1. Go/No-Go checklist (dev sign-off, QA sign-off, UAT sign-off, env ready, rollback tested)
2. Deployment steps (numbered, each with owner and estimated duration)
3. Rollback criteria (conditions that trigger rollback) và rollback steps
4. Post-deployment verification checklist (smoke tests, monitoring thresholds)
5. Communication timeline (ai thông báo gì, khi nào)

Output: VN primary, table + checklist format
```

### Step 2d — Generate Technical Release Notes
Produce technical release notes for dev/ops audience:
- What changed: feature list with US-ID references
- Breaking changes (API, schema, config)
- Dependency updates
- Database migration scripts required (yes/no, reference migration doc)
- Environment variables added/changed
- Rollback procedure summary

### Step 2e — Generate Client Release Notes (VN Formal)
Produce formal VN release notes for client (Party A):
- Tóm tắt tính năng mới (non-technical, business benefit language)
- Vấn đề đã khắc phục
- Vấn đề đã biết / Known issues (nếu có)
- Thông tin liên hệ hỗ trợ
- Ngày hiệu lực

### Step 2f — Save Artifacts
- `plans/reports/pm-{date}-release-plan-{version}.md` using `templates/tpl-release-plan.md`
- `plans/reports/pm-{date}-release-notes-{version}.md` using `templates/tpl-release-notes.md`

### Step 2g — Update Version Register
Append to `docs/pm-version-register.md`:
```
| [VERSION] | [DATE] | [FEATURE_COUNT] US | [path/to/release-plan] | [path/to/release-notes] |
```
Create file if not exists (columns: Version | Date | Scope Summary | Plan | Notes).

### Step 2h — Update State File
Update `docs/pm-ba-document-status.md`:
```
Last Mode Run: release
Last Run Date: [TODAY]
Version Register: docs/pm-version-register.md | Updated
```

### Step 2i — Journal Entry
Invoke `/ck:journal`:
```
Release plan created for [VERSION] — go-live [DATE].
Included: [N] features. Excluded/deferred: [N].
Technical + client release notes produced.
Go/no-go checklist: [N] items.
```

---

## 3. Output Artifacts

| File | Description |
|------|-------------|
| `plans/reports/pm-{date}-release-plan-{version}.md` | Full release plan with go/no-go checklist |
| `plans/reports/pm-{date}-release-notes-{version}.md` | Dual release notes (technical + client VN) |
| `docs/pm-version-register.md` | Version register (appended) |

Templates: `templates/tpl-release-plan.md`, `templates/tpl-release-notes.md`

---

## 4. Stakeholder

- Release plan: dev/ops team, PM
- Technical release notes: dev/ops
- Client release notes: Party A (VN formal)

## 5. Sub-Skills

| Skill | When |
|-------|------|
| `/ck:sequential-thinking` | Step 2b: scope derivation, inclusion/exclusion reasoning |
| `/ck:ask` | Step 2c: release plan + checklist generation |
| `/ck:plan` | Optional: if release has sub-tasks needing decomposition |

## 6. State Update

```
Last Mode Run: release
Version Register updated: docs/pm-version-register.md
Release artifacts: plans/reports/pm-{date}-release-plan-{version}.md
```

## 7. End-of-Mode Hook

Journal: YES — invoke `/ck:journal` at Step 2i with release summary.
