# /ck-scout-fanout — Wide Parallel Codebase Scouting

Fan out read-only file discovery across 4+ independent directories or query dimensions:

1. **Partition scope cleanly** into non-overlapping directory trees or questions (avoid overlap across scouts).
2. **Dispatch parallel scouts** in ONE `task` batch (`agent: "Explore"` or `"scout"`, `effort: "lo"`/`"med"`) specifying exact target paths and required `file:line` outputs.
3. **Merge & verify:** Deduplicate file paths, synthesize findings into `plans/reports/` (if requested), and re-verify critical lines directly before editing.
