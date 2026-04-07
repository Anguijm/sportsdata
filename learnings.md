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

### sprint2-sqlite-cron-cli (2026-04-04)
- **KEEP**: better-sqlite3 works with build-essential present — native bindings are fast and synchronous
- **KEEP**: Upsert pattern (INSERT ON CONFLICT UPDATE) handles re-scrapes cleanly — no duplicate team/game records
- **KEEP**: CLI tables with box-drawing characters — scannable at a glance, zero dependencies
- **KEEP**: Scheduler with retry logic — `withRetry()` generic is reusable across all scrapers
- **IMPROVE**: `npx tsx -e` inline eval doesn't resolve ESM paths — use file-based scripts only
- **INSIGHT**: Full 3-sport scrape cycle completes in 1.3s — well within any cron interval
- **INSIGHT**: SQLite WAL mode + foreign keys pragma should be set on every connection open
- **INSIGHT**: Odds API free tier returns events with multiple bookmakers — using first bookmaker is fine for MVP but should aggregate later

### sprint3-outcomes-mapping-bdl (2026-04-05)
- **KEEP**: Auto-resolving game outcomes in the scheduler cycle — 28 results resolved automatically on first run
- **KEEP**: Team mapping table with canonical_id + provider — clean pattern, extensible to all sports
- **KEEP**: Inspect CLI with multiple subcommands (mappings, results, home-rate) — immediate data visibility
- **KEEP**: BallDontLie cursor-based pagination with rate delay — clean resumable pattern
- **IMPROVE**: BallDontLie free tier is only 5 req/min (not 60) — historical ingest will be slow (~12.5s per page)
- **INSIGHT**: NBA home win rate from 9 games = 55.6%, already near historical average (~57-60%)
- **INSIGHT**: Spread/OU results only computable when odds are attached — most current games have no odds without Odds API key active
- **INSIGHT**: Team name mapping is trivial for NBA (names match across providers) but will be harder for soccer (different naming conventions)

### viz-interesting-detector (2026-04-06)
- **KEEP**: Finding interface with spotlight, temporalAnchor, comparisonBaseline, narrativeHint — rich enough for scroll-driven narrative
- **KEEP**: Streak finder produced genuinely surprising results (DET 28-game loss streak, OKC 62-point blowout)
- **KEEP**: Three detectors (streaks, margins, mediocrity) are sufficient for compelling findings from 3,883 games
- **IMPROVE**: Surprise score calculation needs tuning — too many findings at 100% (streak P(N) formula saturates quickly)
- **IMPROVE**: Duplicate WSH 16-game streaks appearing — need cross-season deduplication
- **INSIGHT**: Council was right to mandate white background — Jon Bois aesthetic is anti-dashboard, sterile Google Sheets energy
- **INSIGHT**: Observable Plot + Vite is a clean stack — zero-config TypeScript, fast HMR, simple SVG output
- **INSIGHT**: Data API as separate process is correct — decouples heavy SQLite queries from frontend dev server

### sprint5-player-stats (2026-04-05)
- **KEEP**: ESPN core API works for ALL 6 sports with one endpoint pattern (`/sports/.../athletes/{id}/statistics`)
- **KEEP**: `Record<sport, Record<teamAbbr, stats>>` structure lets MLB/NFL/NHL slot in without refactor
- **IMPROVE**: Initial findings were templated ("boring" per user) — every counting stat MUST pair with a rate stat (PPG+TS%, HR+SLG, ERA+WHIP, yards+YPC)
- **INSIGHT**: Minimum-games filter (council mandate) prevents 2-game IL samples from beating real leaders
- **CRITICAL**: User caught "feels like we're not using the council correctly" — I was running council on plans but skipping implementation review. Saved as feedback_council_discipline.md

### sprint6-ratchet-first-run (2026-04-05)
- **KEEP**: Day-1 dry run mandate (council) caught leakage bugs BEFORE building scaffolding
- **KEEP**: `PredictionContext` type at compile time makes no-future-leakage a type error, not a convention
- **KEEP**: Bootstrap 95% CIs with 1000 resamples — makes "statistical significance" visible in the UI
- **KEEP**: Static JSON artifact per ratchet run — no live endpoint for expensive compute
- **INSIGHT**: v3 cold-streak iteration got REVERTED by the ratchet (Brier got worse) — proving the mechanism works
- **INSIGHT**: 45% Brier improvement (0.4529 → 0.2486) on held-out test set, CIs don't overlap — real, not noise
- **INSIGHT**: Schema version literal (`schemaVersion: 2`) beats implicit versioning via presence checks

### sprint7-live-predictions (2026-04-06)
- **KEEP**: `reasoning_json` + `reasoning_text` split — re-renderable without re-running model
- **KEEP**: `team_state_as_of` distinct from `made_at` — proves leakage can't happen, even on retries
- **KEEP**: Bearer-auth fail-closed `/api/trigger/predict` endpoint — cron-callable, safe
- **KEEP**: Twice-daily cron (5am + 22:00 UTC) covers both morning scrapes AND West Coast game confirmations
- **IMPROVE**: Predict-runner was originally using cumulative state across 3 seasons — caught in post-impl review (bug), fixed to current-season only
- **INSIGHT**: "Model pick:" framing separates the model's voice from ours (Designer mandate)
- **INSIGHT**: Track record from game 1 with sample-size disclaimer beats hiding until N — hiding looks dishonest

### sprint7-cold-start-bug (2026-04-06)
- **KEEP**: Bundling `tsx` in devDependencies so Docker image has it — direct path `node node_modules/.bin/tsx` instead of `npx tsx`
- **KEEP**: `min_machines_running = 1` + `auto_stop_machines = 'off'` eliminates cold starts on free tier
- **IMPROVE**: Default `auto_stop = 'suspend'` + un-bundled tsx = 30+ second cold starts. Fix: always-on + bundled.
- **INSIGHT**: 256MB is tight for 21MB DB + in-memory state. 512MB is safe. "Virtual machine exited abruptly" = OOM.

### sprint8-council-debts (2026-04-06)
- **KEEP**: `safeFetch` discriminated union `{ok:true,data}|{ok:false,reason}` — callers can't forget to check
- **KEEP**: Hand-rolled validators (no zod) — ~40 lines per shape, zero dependencies, exact control over error messages
- **KEEP**: Schema validation BEFORE DB write — fail-closed on upstream drift
- **KEEP**: `prediction_source` column ('live'/'backfill') — UX mandate: never merge cohorts in display
- **KEEP**: First 4-0 unanimous post-impl council pass when plan-first discipline is followed
- **INSIGHT**: Team accent colors structured as `Record<sport, Record<abbr, colors>>` from day one lets future sports slot in clean

### sprint8-5-resolver-fix (2026-04-07)
- **KEEP**: Cross-namespace match by (sport, home, away, ±1 day) — handles UTC timezone shift for NBA West Coast games
- **KEEP**: Composite index on `games(sport, date, home_team_id, away_team_id)` — prevents O(n*m) scan
- **IMPROVE**: Two ID namespaces (BDL + ESPN) for the same physical games is a data model defect — canonical_game_id migration filed as Sprint 9 P0
- **INSIGHT**: Same physical game had rows under BOTH `nba:bdl-XXX` and `nba:401XXX` — resolver joining on game_id never matched
- **TEST CAUGHT**: Manual test with NY@ATL 4/6 (both BDL + ESPN rows exist) confirmed resolver works across namespaces

### sprint8-5-backfill-predictions (2026-04-07)
- **KEEP**: Backfill the ratchet test set as `prediction_source='backfill'` — gets n=2,500 statistically meaningful track record instantly
- **KEEP**: Invariant `team_state_as_of < game_date` enforced in code + thrown on violation (Quant mandate)
- **KEEP**: `made_at = game_date - 1day` (not now()) — preserves temporal analysis ability (Skeptic mandate)
- **KEEP**: TWO cohort cards in UI, NEVER merged — backfill is calibration baseline, not live record
- **INSIGHT**: Backwards-compat approach — top-level TrackRecord fields = live cohort only, so old UI code can't accidentally show backfill as live performance

### sprint9-mobile-fixes-IN-PROGRESS (2026-04-08)
- **KEEP**: User feedback "feels stuck" caught a hung BrowserAgent — pivot to manual code review
- **IMPROVE**: Need `overflow-x: hidden` on body + html, `100%` not `100vw` (Android scrollbar trap per Engineer)
- **IMPROVE**: Native `<details>` element beats bespoke JS toggles — scroll position preserved, one primitive everywhere (Architect mandate)
- **INSIGHT**: 3 sections have overflow bugs (streak grid, ratchet iterations, ratchet summary). 3 sections have cognitive overload (90 streak rows, 46 findings, 6 stacked sports).
- **BLOCKED**: Context cleared mid-build. Next session picks up from SESSION_LOG.md Sprint 9 plan.
