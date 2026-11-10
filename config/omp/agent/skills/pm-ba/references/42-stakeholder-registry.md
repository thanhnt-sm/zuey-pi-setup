# Stakeholder Registry Protocol

## Registry File Location

Project-level living doc: `docs/pm-stakeholder-registry.md`

This file is **project data**, not skill config. It lives in `docs/`, not `.claude/skills/`.
It is authored and maintained by the PM; the skill reads it, never overwrites it without explicit user action.

---

## Read Protocol

When a mode needs stakeholder data:

1. Check if `docs/pm-stakeholder-registry.md` exists
   - If missing → run Init Protocol (see below), then proceed
2. Read the file (Read tool — it is a `.md` native type)
3. Extract the relevant section:
   - Need Bên B owner for a request → read `## Bên B ([CLIENT])` table, match by Role
   - Need decision authority → read `## Decision Matrix (RACI Light)` table, match Decision Type
   - Need contact channel → read `## Communication Channels` table
4. If a field contains `[TODO]` → surface to user as a data gap (do not block execution)
   - Log: "Stakeholder {Role}: contact details not yet populated. PM cần điền sau."

**Data freshness check:** Read `Last-Updated:` header field.
If `Last-Updated` is older than 30 days → warn (do NOT block):
```
⚠️ Stakeholder registry chưa được cập nhật >30 ngày (Last-Updated: {date}).
Dữ liệu có thể lỗi thời. Cập nhật sau cuộc họp tiếp theo.
```

---

## Staleness Check

Threshold: 30 days from `Last-Updated:` field in registry file header.
Action on stale: warn only — never block mode execution.
Format: `Last-Updated: YYYY-MM-DD` (ISO date in the first 3 lines of the file).

PM updates this field manually after each significant org change (new stakeholder, role reassignment, contact change).

---

## Integration Points

Modes that MUST consult the registry when available:

| Mode | Registry Data Used |
|------|--------------------|
| `--cr` | Bên B authority scope → who must approve this CR type (Decision Matrix) |
| `--signoff` | Bên B role → correct approver name + contact |
| `--clarify` | Bên B contact → who to send clarification request to |
| `--meeting-pre` | Bên B attendees → pre-populate attendee list for meeting agenda |
| `--pm` | Bên B contacts → populate REQ Owner fields in dashboard display |
| `--raci` | All stakeholder roles → seed RACI matrix rows |
| `--status` | Bên B contact → correct distribution list per audience |

Integration pattern: read registry → extract relevant row → use in output. If `[TODO]` present → surface gap, continue.

---

## Init Protocol

Triggered when `docs/pm-stakeholder-registry.md` does NOT exist and a mode needs registry data.

Steps:
1. Notify user: "docs/pm-stakeholder-registry.md chưa tồn tại. Tạo file với template mặc định?"
2. If user confirms (or mode is `--pm` which auto-inits): write template file with structure:
   - `## Bên A (Vendor — Chúng Ta)` table: Role, Name, Email, Phone, Backup, Notes
   - `## Bên B ([CLIENT])` table: Role, Name, Department, Email, Phone, Authority Scope, Backup, Last-Contact
   - `## Decision Matrix (RACI Light)` table: Decision Type, R, A, C, I
   - `## Communication Channels` table: Channel, Purpose, Frequency, Primary Contact
3. All fields pre-populated with `[TODO]` placeholders + inline comments `<!-- PM: điền tên, email sau khi confirm với nhân sự -->`
4. Update `docs/pm-ba-output-registry.md` with new file entry
5. Log: "Stakeholder registry khởi tạo. PM cần điền thông tin liên hệ Bên B."

Do NOT block mode execution after init — proceed with `[TODO]` placeholders present.
