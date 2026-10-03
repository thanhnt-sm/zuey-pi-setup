## Web fetching

- Use `web_fetch` first for any URL. It impersonates a desktop browser TLS fingerprint and returns extracted readable content, which is what gets past bot-defended pages.
- Fall back to `fetch_content` when `web_fetch` fails or returns thin or empty content, or when a page needs JavaScript rendering. Content fetched with `fetch_content` is stored for later `get_search_content` lookups.
- Use `batch_web_fetch` when one run needs several URLs; keep its `verbose` flag off.
