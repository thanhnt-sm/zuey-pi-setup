# Mode 57 — `--kpi-resync`

> Source drift remediation. PM-approved file-by-file copy + sha256 update (Phase 10 v1.5).
> Never auto-overwrite. Always require explicit approval.

---

## 1. Trigger

**Flag:** `--kpi-resync [--dry-run]`

**VN triggers:** "đồng bộ KPI source", "resync KPI drift", "cập nhật KPI từ source"
**EN triggers:** "resync KPI sources", "drift remediation"

---

## 2. Workflow Steps

### 2a. Load Standards + Read SOURCE.md
Drift report listed; per-file sha256 mismatch.
> **Scope:** Iterate ONLY `## Tracked Files` section of SOURCE.md. Files listed under `## Intentionally Local` are PM-owned and do NOT participate in drift remediation — skip them silently.

### 2b. Per-File Diff + Approve
For each drift entry:
```
File: {file}
Source sha: {src_sha}
Local sha: {local_sha}

Diff preview (first 20 lines):
{diff_excerpt}

AskUserQuestion: "Replace local with source for {file}?"
Options: [Approve replace] [Skip] [Show full diff] [Abort all]
```

### 2c. Approved → Copy + Update sha
```
copy source_file → local
update SOURCE.md sha256 entry
log to docs/pm-ba-document-status.md
```

### 2d. Skipped → Note + Continue
Log skip event; SOURCE.md sha remains as old (drift persists, user accepts).

### 2e. Dry-Run Mode
`--dry-run` prints actions without executing. No file changes.

---

## 3. Outputs

| Output | Purpose |
|--------|---------|
| Copied source files | Resync'd content |
| Updated SOURCE.md | New sha256 anchors |
| Log entry in document-status | Audit |

---

## 4. Anti-Pattern Guards

| Guard | Condition | Action |
|-------|-----------|--------|
| Source file missing | Source path doesn't exist | Skip with error; cannot resync |
| Local newer than source mtime | Local edited after source | Warn extra hard; default to skip |
| Bulk approve all | PM uses [Approve all] | Block; force per-file approval (audit trail) |

---

## 5. End-of-Mode Hooks
- `/ck:journal`: YES (drift remediation is milestone)
- Suggest next: `--kpi-track` to verify computations use refreshed reference
