---
task: Player stats layer for all six sports
slug: 20260407-040000_player-stats-all-sports
effort: deep
phase: execute
progress: 0/24
mode: interactive
started: 2026-04-07T04:30:00-05:00
updated: 2026-04-07T04:30:00-05:00
---

## Context

User wants player-level stats for all 6 leagues (NFL, NBA, MLB, NHL, MLS, EPL). ESPN core API verified to work for all 6 with consistent pattern. Sport-specific stat categories differ (NBA: PTS/REB/AST, NFL: passing/rushing, MLB: batting/pitching, NHL: goals/assists, soccer: goals/assists/keeping).

Strategy: One unified ESPN player client + sport-specific finding detectors. Single SQLite table with JSON stats column for flexibility. Add NBA Stats API as Phase 2 for advanced metrics.

## Criteria

- [ ] ISC-1: ESPN core stats API client works for all 6 sports
- [ ] ISC-2: Player schema includes id, name, team, position, sport, season
- [ ] ISC-3: SQLite player_stats table with JSON stats column
- [ ] ISC-4: Roster ingest fetches all teams' players for a sport
- [ ] ISC-5: Stats ingest fetches season stats for each player
- [ ] ISC-6: Rate limiting respects ESPN's tolerance (~60 req/min)
- [ ] ISC-7: NBA player stats ingested for current season
- [ ] ISC-8: NFL player stats ingested for current season
- [ ] ISC-9: MLB player stats ingested for current season
- [ ] ISC-10: NHL player stats ingested for current season
- [ ] ISC-11: MLS player stats ingested for current season
- [ ] ISC-12: EPL player stats ingested for current season
- [ ] ISC-13: Player findings detector for NBA (top scorers, efficiency, two-way)
- [ ] ISC-14: Player findings detector for NFL (passing leaders, rushing, defense)
- [ ] ISC-15: Player findings detector for MLB (batting, pitching)
- [ ] ISC-16: Player findings detector for NHL (goals, assists, GAA)
- [ ] ISC-17: Player findings detector for soccer (goals, assists)
- [ ] ISC-18: API endpoint /api/players returns player findings per sport
- [ ] ISC-19: Frontend has player section with sport selector
- [ ] ISC-20: Frontend renders top players per sport
- [ ] ISC-21: All new code passes tsc --noEmit
- [ ] ISC-22: Deployed to Fly.io and Cloudflare
- [ ] ISC-23: Council reviews implementation post-deploy
- [ ] ISC-24: Documentation updated (README + learnings)
