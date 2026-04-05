---
task: Execute Sprint 3 odds outcomes mapping historical ingest
slug: 20260405-100000_sprint3-odds-outcomes-mapping-historical
effort: advanced
phase: complete
progress: 27/28
mode: interactive
started: 2026-04-05T10:00:00-05:00
updated: 2026-04-05T10:00:00-05:00
---

## Context

Sprint 3 execution. Council-validated plan (3-round debate, unanimous). Four items in priority order:
1. **P1: Odds API Activation** — Wire into scheduler, stop losing data
2. **P2: Game Outcomes Table** — Results tracking for Brier scores
3. **P3: Team Name Mapping (NBA-only)** — Canonical IDs + inspect CLI
4. **P4: BallDontLie Historical NBA Ingest** — 10+ seasons game results

Council consensus: collection infrastructure, NBA-first scope, first predictions ~June.

### Risks
- Odds API key may not be set — need graceful handling
- BallDontLie rate limits could slow historical ingest — need backoff + resumability
- Team mapping must land before BallDontLie ingest (P3 blocks P4)
- BallDontLie NBA coverage may have undocumented gaps

## Criteria

### P1: Odds API Activation
- [x] ISC-1: Odds API client wired into scheduler cycle
- [x] ISC-2: Scheduler skips odds gracefully when API key is absent
- [x] ISC-3: Remaining monthly budget logged after each odds fetch
- [x] ISC-4: Odds scrape results logged to scrape-log.jsonl
- [x] ISC-5: Raw odds stored in odds_raw SQLite table per fetch

### P2: Game Outcomes Table
- [x] ISC-6: game_results table exists in SQLite with winner and margin fields
- [x] ISC-7: Results auto-resolved when game status is final
- [x] ISC-8: Spread result computed (cover/push/miss) when odds available
- [x] ISC-9: Over/under result computed when odds available
- [x] ISC-10: Existing final games backfilled with results on first run
- [x] ISC-11: Results queryable by sport and date range

### P3: Team Name Mapping (NBA-Only)
- [x] ISC-12: team_mappings table exists with canonical_id and provider columns
- [x] ISC-13: NBA teams seeded with ESPN ID mappings (30 teams)
- [x] ISC-14: NBA teams seeded with Odds API name mappings
- [x] ISC-15: NBA teams seeded with BallDontLie ID mappings
- [x] ISC-16: Lookup function resolves any provider ID to canonical ID
- [x] ISC-17: CLI inspect command shows mapping table with match status

### P4: BallDontLie Historical NBA Ingest
- [x] ISC-18: BallDontLie API client fetches NBA game results
- [x] ISC-19: Client handles pagination for multi-season queries
- [x] ISC-20: Rate limiting with backoff built into client
- [x] ISC-21: Historical games persisted to SQLite games table
- [x] ISC-22: Historical game results auto-resolved to game_results table
- [x] ISC-23: Ingest is resumable (tracks last completed season)
- [ ] ISC-24: At least 3 seasons of NBA data ingested successfully

### Cross-Cutting
- [x] ISC-25: All new code passes tsc --noEmit
- [x] ISC-26: learnings.md updated with Sprint 3 reflections
- [x] ISC-27: session_state.json updated

### Anti-Criteria
- [x] ISC-A-1: Anti: No BallDontLie player stats or non-NBA sports this sprint

## Decisions

- 2026-04-05 10:00: Advanced effort — 4 items with new API integration and historical ingest
- 2026-04-05 10:00: P3 blocks P4 — team mapping before BallDontLie ingest
