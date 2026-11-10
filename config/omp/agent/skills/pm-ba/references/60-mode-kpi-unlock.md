---
mode: 60
trigger: "--kpi-unlock"
title: "KPI Unlock Mode — Explicit State Unlock with Audit Chain"
schema_version: "1.6"
created: 2026-05-19
---

# Mode 60 — `--kpi-unlock`

Explicit unlock mode for KPI state files. Replaces the deprecated `--force` flag.
Mode number 60 (NOT 54 — RT-2 correction; 54 was a placeholder in earlier drafts).

---

## CLI

```
pm-ba --kpi-unlock \
  --reason "Reason string of at least 30 characters" \
  --tail-anchor sha256:{hex} \
  [--duration-minutes 15]
```

Also:
```
pm-ba --kpi-lock --confirm     # Explicit relock after editing
```

---

## Parameters

| Parameter | Required | Constraint | Description |
|-----------|----------|-----------|-------------|
| `--reason` | Yes | ≥ 30 chars (advisory; not auth) | Human-readable justification for unlock |
| `--tail-anchor` | Yes | Must match chain tail or last PD-signed tail | Authorization signal — binds unlock to PD evidence |
| `--duration-minutes` | No | Default: 15; Max: 60 | Unlock window duration |

---

## Authorization Flow

`--tail-anchor` is the **only authentication check**. Steps:

1. Read `docs/pm-ba-kpi-audit-log.md` → compute actual chain tail hash.
2. Read newest `docs/pd-signoff/kpi-monthly-*.md` (sorted by date desc) → read `audit_log_tail_hash`.
3. Accept `--tail-anchor` if it equals **either**:
   - The current chain tail (real-time match), OR
   - The most-recent PD-signed tail (last signed month).
4. If neither matches → **reject**:
   ```
   ⛔ Unlock rejected: --tail-anchor sha256:XXXX does not match
      current chain tail (sha256:YYYY) or last PD-signed tail (sha256:ZZZZ).
   Escalate to PD for updated signoff, or verify audit log integrity.
   ```

---

## On Accept

```
1. Validate --reason length >= 30 chars (warn if shorter, but do not block — advisory only)
2. Set state.unlocked_until = ISO8601(now + duration_minutes)
3. Append audit row:
   | {timestamp} | {state_file} | --kpi-unlock | {session_id} | unlock_granted | {body_hash} | {prev_row_hash} |
4. Print to user:
   ⚠ KPI state unlocked until {unlocked_until}. Make changes carefully.
     Auto-relock will quarantine on drift. Use --kpi-lock --confirm when done.
```

---

## Auto-Relock (after unlocked_until expiry)

Triggered on next loader read after `unlocked_until`:

1. Compute diff between `<state-file>.prev` snapshot (taken at unlock time) and current body.
2. Evaluate diff:
   - Diff touches `ep_cumulative_anchor` or prior ledger rows → **quarantine** (see below).
   - Diff exceeds 1 KB total → **quarantine**.
   - Diff is clean (append-only, no immutable field changes) → auto-relock succeeds.
3. Auto-relock does NOT silently bless arbitrary drift.

### Quarantine state

If auto-relock detects violation:
```yaml
quarantined: true
quarantine_reason: "Auto-relock diff exceeded threshold / touched immutable field"
quarantine_at: "2026-05-19T10:15:00Z"
```

All loader operations blocked on quarantined state. Resolution requires:
```
pm-ba --kpi-lock --confirm   # human reviews diff, confirms clean, releases quarantine
```

---

## Explicit Relock: `--kpi-lock --confirm`

```
1. Display diff vs .prev snapshot to user
2. User must confirm (AskUserQuestion): [Confirm relock] [Restore from .prev]
3. On confirm:
   a. Recompute body_hash from current fenced body
   b. Update frontmatter body_hash
   c. Clear quarantined flag (if set)
   d. Write via kpi-atomic-write.py (atomic)
   e. Append audit row: action=explicit_relock
4. On restore:
   a. Copy .prev → state file (via atomic write)
   b. Append audit row: action=restored_from_prev
```

---

## Audit Row Format

All Mode 60 operations append to `docs/pm-ba-kpi-audit-log.md`:

```
| {timestamp} | {state_file_basename} | --kpi-unlock | {session_id} | {action} | {body_hash} | {prev_row_hash} |
```

Actions: `unlock_granted`, `unlock_rejected`, `explicit_relock`, `restored_from_prev`,
`quarantine_set`, `quarantine_cleared`.

---

## Security Notes

- `--reason` is advisory (≥30 chars encouraged) — not authentication.
- Authentication is `--tail-anchor` validation against PD-signed chain.
- No kill-switch flag. Rollback via `git revert` of hook config commit (leaves audit trail, requires repo-write privilege).
- Max 3 unlocks per rolling 7-day window enforced by loader (warn + require PD signoff if exceeded).
