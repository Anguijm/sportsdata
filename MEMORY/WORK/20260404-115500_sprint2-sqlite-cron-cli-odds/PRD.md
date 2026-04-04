---
task: Sprint 2 SQLite cron CLI output and odds capture
slug: 20260404-115500_sprint2-sqlite-cron-cli-odds
effort: advanced
phase: complete
progress: 27/28
mode: interactive
started: 2026-04-04T11:55:00-05:00
updated: 2026-04-04T11:55:00-05:00
---

## Context

Sprint 2 execution, council-validated plan. Four items prioritized by the council debate:
1. **P0: SQLite store + ESPN persistence** — Implement Repository interface, persist teams/games
2. **P1: Cron scheduler with failure monitoring** — Daily scrape cadence, retry logic
3. **P2: CLI audit output** — Formatted terminal tables after scrape runs
4. **P3: Odds API raw capture** — Free tier (500 req/month), accumulate odds data immediately

Council consensus: Sprint 2 is about reliable data collection, not scoring. DuckDB, corroboration, ratchet scoring deferred to Sprint 3. After implementation, council reviews the code.

### Risks
- SQLite native bindings may fail (like better-sqlite3 did in Sprint 1) — use sql.js or better-sqlite3 with build-essential
- Odds API free tier key needed — will use environment variable
- Cron scheduling within Node.js vs system cron — keep simple

## Criteria

### P0: SQLite Store
- [x] ISC-1: SQLite database file created in data/sqlite/ directory
- [x] ISC-2: Teams table stores all fields from Team interface
- [x] ISC-3: Games table stores all fields from Game interface
- [x] ISC-4: Upsert logic prevents duplicate teams on re-scrape
- [x] ISC-5: Upsert logic prevents duplicate games on re-scrape
- [x] ISC-6: Repository interface fully implemented for teams and games
- [x] ISC-7: ESPN scrape results persist to SQLite after fetch

### P1: Cron Scheduler
- [x] ISC-8: Scheduler config defines per-sport scrape intervals
- [x] ISC-9: Scheduler executes ESPN scrapes on configured cadence
- [x] ISC-10: Failed scrapes logged with error details to scrape-log.jsonl
- [x] ISC-11: Retry logic attempts failed scrapes up to 3 times
- [x] ISC-12: Scheduler reports status summary after each cycle

### P2: CLI Audit Output
- [x] ISC-13: CLI displays teams in formatted terminal table
- [x] ISC-14: CLI displays games with scores in formatted terminal table
- [x] ISC-15: CLI displays scrape log summary with gate results
- [x] ISC-16: CLI supports sport filter argument
- [x] ISC-17: CLI shows data freshness (time since last scrape)

### P3: Odds API Raw Capture
- [x] ISC-18: Odds API client fetches current odds for a sport
- [x] ISC-19: API key read from environment variable
- [x] ISC-20: Rate limiting respects 500 req/month budget
- [x] ISC-21: Raw odds response saved to JSON file per fetch
- [ ] ISC-22: Odds attached to matching Game records when available
- [x] ISC-23: Odds scrape logged to scrape-log.jsonl

### Cross-Cutting
- [x] ISC-24: All new code passes tsc --noEmit
- [x] ISC-25: session_state.json updated with Sprint 2 state
- [x] ISC-26: learnings.md updated with Sprint 2 reflections

### Anti-Criteria
- [x] ISC-A-1: Anti: No DuckDB code in this sprint
- [x] ISC-A-2: Anti: No ratchet scoring execution in this sprint

## Decisions

- 2026-04-04 11:55: Advanced effort — 4 implementation items with real API integration
- 2026-04-04 11:55: Council review after implementation — will run full council debate on finished code
