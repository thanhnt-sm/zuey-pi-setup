---
doc_type: reference
title: "KPI State Protection — Fence, Hash, Atomic Write, Audit Chain"
schema_version: "1.6"
created: 2026-05-19
---

# KPI State Protection

Binding spec for state-file integrity enforcement in pm-ba v1.6.
Supersedes Invariant 19 prose in `kpi-standards-loader.md` Write Protection section.

---

## 1. Fence Block Syntax

KPI state files (`docs/pm-ba-kpi-state-*.md`) MUST wrap two sections in fence markers:

```markdown
<!-- KPI-PROTECTED-START -->
## Task Register
| ID | Task | P | TP | AP | ... |
| T-01 | ... |

## Weekly Snapshots
| Week | AP_period | EP_delta | ... |
<!-- KPI-PROTECTED-END -->
```

Rules:
- Markers on their own lines; no trailing spaces.
- ALL content between the two markers (inclusive of section headers) is the **protected body**.
- Nothing outside the markers is covered by `body_hash`.
- On first load of a pre-v1.6 file, auto-bootstrap inserts markers around existing sections (see §6 Migration).

---

## 2. body_hash Computation

### Normalization (canonical form before hashing)

Apply in order:

1. Extract content strictly between `<!-- KPI-PROTECTED-START -->` and `<!-- KPI-PROTECTED-END -->` (exclusive of the marker lines themselves).
2. Convert line endings: CRLF → LF.
3. Strip trailing whitespace from each line (right-trim spaces/tabs).
4. Apply NFC unicode normalization.
5. Ensure content ends with exactly one LF (strip trailing blank lines, append one LF).

### Hash

```
body_hash = "sha256:" + sha256_hex(normalized_body_bytes_utf8)
```

### Storage

Stored in frontmatter as:

```yaml
body_hash: sha256:a1b2c3...
```

### Trust Anchor

The in-frontmatter `body_hash` is a **convenience check** (loader fast-path). It is NOT the authoritative trust anchor. The authoritative anchor is the **audit-log chain** + monthly PD signoff (see §5). An attacker who can edit the state file can also update `body_hash` — hence the external chain.

---

## 3. Content Invariants (enforced by pre-write hook)

The pre-write hook (`pre-write-kpi-state-check.cjs`) enforces these invariants on every
Write/Edit/MultiEdit/NotebookEdit to `docs/pm-ba-kpi-state-*.md`:

| # | Invariant | Violation action |
|---|-----------|-----------------|
| I1 | **Ledger append-only** — rows for periods < current_period are byte-identical to `.prev` snapshot | Reject + exit 1 |
| I2 | **`ep_cumulative_anchor` immutable** — field absent in both, or byte-identical | Reject + exit 1 |
| I3 | **`body_hash` valid** — `frontmatter.body_hash` equals `sha256(normalize(new_fenced_body))` | Reject + exit 1 |
| I4 | **No audit-log mutation** — writes to state file cannot touch `docs/pm-ba-kpi-audit-log.md` path | Reject + exit 1 |
| I5 | **`schema_version` monotonic** — new value ≥ prior value | Reject + exit 1 |

Mode-whitelist enforcement is at **loader level only** (advisory WARN, not block). Hook does not attempt mode detection.

---

## 4. Atomic Write Contract

All KPI mode scripts MUST write state files via `kpi-atomic-write.py`. Direct Write/Edit tool calls to state files are rejected by the hook.

Atomic write sequence:

```
1. Acquire lock  →  write <target>.lock  {session_id, started_at, pid}
2. Snapshot      →  move <target> → <target>.prev  (preserves prior version for hook diff)
3. Recompute hash →  normalize fenced body → compute sha256 → update frontmatter body_hash
4. Stage write   →  write full new content to <target>.tmp
5. Commit        →  os.replace(<target>.tmp, <target>)  [atomic on NTFS/ext4]
6. Release lock  →  delete <target>.lock
7. Audit append  →  append one chain row to pm-ba-kpi-audit-log.md
```

Failure modes:
- Any step 1–6 fails → delete `<target>.tmp`; preserve `<target>.prev`; exit non-zero.
- Step 7 (audit append) fails → **reject the entire write** (fail-closed); restore from `.prev`.

---

## 5. Lock File Mechanism

**Path:** `docs/pm-ba-kpi-state-{slug}-{period}.md.lock`

**Format (JSON, single line):**
```json
{"session_id": "abc123", "started_at": "2026-05-19T10:00:00Z", "pid": 12345}
```

**TTL:** 5 minutes (300 seconds) based on file `mtime`.

**Lifecycle:**
- Created by `kpi-atomic-write.py` step 1 before opening `.tmp`.
- Deleted by `kpi-atomic-write.py` step 6 after successful `os.replace()`.
- **Stale lock** (mtime > 5 min, e.g. crashed session): next writer clears stale lock + appends WARN row to audit log.
- **Active lock with different session_id**: hook rejects with: `State locked by session {id} since {time}; retry in 5min.`

---

## 6. Audit Log Chain

Each row in `docs/pm-ba-kpi-audit-log.md` carries a `prev_row_hash` linking to the prior row:

```
Tail hash = sha256(newest_row_normalized)
Row N: prev_row_hash = sha256(row N-1 normalized)
```

**Genesis anchor:** `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
(sha256 of empty string — the seed before any row exists).

**Monthly PD signoff:** PD adds `audit_log_tail_hash: sha256:{hex}` to
`docs/pd-signoff/kpi-monthly-{YYYY-MM}.md` at month-end. This cryptographically anchors
the chain up to that point. Per-row tampering before the signed month is detectable by
chain validation against the PD-signed tail hash.

**Chain validation:** `kpi-state-integrity.py --validate-chain` walks backward, verifying
each row's `prev_row_hash` against the actual prior row hash, then cross-checks tail
against the most-recent PD-signed monthly doc.

---

> **v1.6.0 limitation (H7 — post-impl review):** Auto-relock quarantine on immutable-field drift is SPEC-ONLY in v1.6.0; the runtime diff-against-snapshot is NOT yet implemented. The `.prev` snapshot is rotated on every legitimate write, so diff-against-unlock-time is not possible without a separate `.prev.unlock` snapshot. v1.6.0 enforces body_hash mismatch BLOCK at loader level (no quarantine flag set automatically); operator must run explicit `--kpi-lock --confirm` to relock and accept current body. Full auto-relock + quarantine pipeline ships in v1.6.1 with `.prev.unlock` snapshot captured at unlock time.

## 7. --kpi-unlock Authorization (tail-anchor binding)

Unlock requires the most-recent PD-signed `audit_log_tail_hash`:

```
--kpi-unlock --reason "..." --tail-anchor sha256:{hex-from-last-pd-signed-monthly}
```

Hook validates `--tail-anchor` against actual chain tail. Mismatch → unlock rejected:
> "Audit chain diverged from last PD signoff — cannot grant unlock; escalate to PD."

This binds unlock authorization to PD's signed evidence trail (not a character-count check).

On successful unlock:
- `state.unlocked_until = now + duration_minutes` (default 15)
- One audit row appended (with chain link)
- Warning printed to user

On auto-relock (after `unlocked_until` expiry):
- Compute diff between pre-unlock `.prev` snapshot and current body.
- If diff touches immutable fields OR exceeds 1 KB → set `quarantined: true` + audit row.
- Auto-relock does NOT bless arbitrary drift; it sets quarantine pending explicit `--kpi-lock --confirm`.

Explicit relock: `--kpi-lock --confirm` → recompute `body_hash` → new chain row → clear quarantine.

---

## 8. Migration v1.5 → v1.6

On first load of a state file with `schema_version < 1.6`:

1. Parse existing `## Task Register` and `## Weekly Snapshots` sections.
2. Insert `<!-- KPI-PROTECTED-START -->` before first section, `<!-- KPI-PROTECTED-END -->` after last.
3. Compute and set `body_hash` in frontmatter.
4. Bump `schema_version` to `1.6`.
5. Append migration audit row (flagged `migration_bootstrap: true`; no PD anchor required for this row).
6. Write via atomic-write helper.

No PD `--tail-anchor` required for the bootstrap migration row itself — flagged explicitly so chain validators know the genesis of the chain for this file.
