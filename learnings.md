# Sports Data Platform — Learnings

Accumulated patterns, anti-patterns, and insights from scraping, analysis, and prediction work.

## Accumulated Principles

- Always log scrape results immediately, even failures — the log is the audit trail
- ESPN undocumented API endpoints may change; validate response structure before parsing
- Rate limiting is non-negotiable — free APIs will ban aggressive scrapers permanently
- Two-source corroboration is the minimum for any published prediction
- Statistical significance without practical significance is noise
- The ratchet loop only works if the improvement metric is well-defined before iteration begins
- Dev mode exists for speed; flip to gated mode before any real predictions are shared
- Schema validation at the TypeScript/Python bridge catches drift before it poisons models

## Per-Session Reflections

### espn-first-scrape (2026-04-04)
- **KEEP**: Generic `scrapedFetch<T>()` pattern — adding new endpoints is a one-liner
- **KEEP**: JSONL append logging — 6 entries auto-logged with zero manual effort
- **IMPROVE**: ESPN `/teams` endpoint doesn't return `groups` (conference/division) — need `/teams?limit=100` or the standings endpoint instead
- **INSIGHT**: ESPN API responds fast (<600ms teams, <30ms scoreboard) — rate limit of 60/min is generous for our use case
- **INSIGHT**: NFL offseason = only 1 game on scoreboard; need historical endpoints for meaningful analysis data
- **TEST CAUGHT**: `import.meta.dirname` works in Node 22+ with tsx but would fail in older runtimes
