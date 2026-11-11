## Web fetching

- Use `web_fetch` first for any URL. It impersonates a desktop browser TLS fingerprint and returns extracted readable content, which is what gets past bot-defended pages.
- Fall back to `fetch_content` when `web_fetch` fails or returns thin or empty content, or when a page needs JavaScript rendering. Content fetched with `fetch_content` is stored for later `get_search_content` lookups.
- Use `batch_web_fetch` when one run needs several URLs; keep its `verbose` flag off.

## OMP Native File & Analytics Tools

- ALWAYS use `omp_office`, `omp_pmo`, `omp_email`, and `omp_maint` native tools for file conversions (Word, Excel, PDF, DrawIO, VSDX), schedules (CPM, EVM, MS Project, Excel diff), email parsing, and disk maintenance.
- NEVER write one-off Python or PowerShell scripts to process files when an existing native tool or suite CLI in `~/.omp/agent/skills/` already provides that capability.
