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

### sprint10-6-scrape-pipeline-repair (2026-04-09)
- **KEEP**: `runCycle()` returning `{ results, failures }` — the scrape log sweep at end of cycle catches fail-closed ESPN errors that scrapedFetch returns as `[]`
- **KEEP**: `/api/trigger/scrape` with `backfillDays=3` default — system self-heals after missed cron runs
- **KEEP**: `sport=all` on scrape trigger covers all 6 leagues in one cron call
- **KEEP**: `deploy-fly.yml` auto-deploy mirrors `deploy-pages.yml` pattern — push to main ships both
- **IMPROVE**: `/api/trigger/scrape` didn't exist for months — `|| echo "non-fatal"` + `continue-on-error` hid the 404. Never mask cron failures.
- **IMPROVE**: `last_scrape_at` on `/api/health` makes staleness visible without reading logs — should have existed from day one
- **INSIGHT**: Three stacked bugs (missing route + dead backup cron + no backfill) = silent data staleness for days. Any ONE of these would have been caught immediately if failures weren't swallowed.
- **CRITICAL**: Codex review caught that `/api/trigger/scrape` returned 200 even when ESPN fail-closed — same silent failure mode at a different layer. Fixed with 502 on `failures.length > 0`.

### sprint10-6-sport-selector (2026-04-12)
- **KEEP**: Global `currentSport` + `localStorage` persistence + generation counter for race conditions — clean pattern for framework-less sport switching
- **KEEP**: `SPORT_TERMINOLOGY` lookup (points/runs/goals, games/matches, team counts, minGamesFilter) — avoids dozens of inline conditionals
- **KEEP**: Empty-state guards on every section — sports with no data degrade gracefully
- **IMPROVE**: Players section was silently falling back to wrong sport when global sport had no data (Codex caught this)
- **IMPROVE**: Season range formatting crashed on empty data (`undefined-aN`) — guard for `seasonCount === 0`
- **INSIGHT**: Council review on UI-only changes is lightweight (Data Quality + Domain Expert only) but still caught MLS team count error (29→30, San Diego FC)

### sprint10-6-spread-model (2026-04-12) Council Review
- **Verdict**: WARN → all findings addressed
- **KEEP**: `predictMargin()` as a continuous output from the same features (team diff + HCA) — clean separation from v2's probability buckets
- **KEEP**: Separate model_version='v4-spread' in existing predictions table — no schema migration needed
- **KEEP**: `writeOddsToGames()` bridging odds_raw → games.odds_json — fixes a pipeline gap that existed since odds scraper was added
- **IMPROVE**: Edge formula was inverted (`predictedMargin - signedSpread` should be `+ signedSpread`) — Codex caught this. Cover logic must match resolution logic exactly.
- **IMPROVE**: ERA coefficient was too aggressive (0.5 → 0.3 per council convergence). Starters average ~5 IP; bullpen/defense dilute the signal.
- **IMPROVE**: `!odds.spread?.line` falsely excluded pick'em (line=0) games. Use `== null` for missing checks.
- **IMPROVE**: String date comparison missed cross-midnight games. Use `julianday()` for ISO timestamp matching.
- **INSIGHT**: Prediction Accuracy expert rightly demanded renaming "What's safe to bet?" → "Where the model disagrees with the line" — framing without backtesting is irresponsible
- **INSIGHT**: Track record must be gated at N≥30 — displaying 3/5 (60%) accuracy is statistically meaningless
- **INSIGHT**: Probable pitchers are in ESPN's scoreboard response but were never parsed — one normalizer change unlocks MLB-specific modeling

### codebase-review-p0-p3 (2026-04-12)
- **KEEP**: Full 5-expert council review with 35 issues identified (P0-P3) — systematic quality sweep
- **KEEP**: Mathematics expert as 5th council member — catches both computational AND theoretical errors
- **KEEP**: Draw handling: is_draw column + excluded from accuracy metrics + correct team state updates
- **KEEP**: Cross-namespace resolver UNION: direct match + BDL→ESPN match prevents stuck predictions
- **KEEP**: Automated SQLite backup via GitHub releases with 7-day rotation
- **IMPROVE**: v0 baseline was 1.0 (100% certainty) — inflated all improvement claims. Sport-specific rates now.
- **IMPROVE**: ON CONFLICT column mismatch (2 vs 3 columns) required table recreation migration
- **IMPROVE**: XSS via innerHTML — `esc()` utility needed on all API-sourced strings
- **IMPROVE**: JSONL log read entirely into memory per rate check — replaced with in-memory counter
- **IMPROVE**: Single bookmaker odds → median consensus across all bookmakers
- **INSIGHT**: Codex review catches real bugs (edge math inversion, pick'em exclusion, date comparison) — worth waiting for before merge
- **INSIGHT**: Council plan review BEFORE implementation catches flawed approaches early (roster quality was killed before a line of code was written)

### v5-continuous-model (2026-04-13)
- **KEEP**: Sigmoid function is theoretically correct (Bradley-Terry model) — math expert confirmed
- **KEEP**: Per-sport scale derived from `scale = π / (√3 × σ_effective)` — grounded in theory, not hand-tuned
- **KEEP**: Clamp [0.15, 0.85] prevents degenerate predictions
- **IMPROVE**: v2's 4 discrete buckets (0.40, 0.38, 0.43, 0.60) produced identical 60% confidence for most NBA games — sigmoid gives unique probabilities
- **IMPROVE**: MLB scale 0.40 was too aggressive (77% for 2.5-run gap) → council caught, lowered to 0.30
- **INSIGHT**: Brier score formulation (picked-winner prob vs wasCorrect) is mathematically equivalent to standard form — math expert verified
- **INSIGHT**: Calibration bins in [0.5, 1.0] can't detect asymmetric miscalibration — known diagnostic limitation

### historical-backfill (2026-04-13)
- **KEEP**: ESPN scoreboard ?dates= parameter works for all sports going back years
- **KEEP**: 21,433 games scraped, 12,813 backfill predictions generated across all 6 sports
- **KEEP**: Global rate limit counter across sports prevents inter-sport burst gaps
- **KEEP**: Split skip counters (noSnapshot vs draws) for data quality monitoring
- **INSIGHT**: Historical odds are NOT available from ESPN or Odds API — spread model backfill has zero data
- **INSIGHT**: Backfill revealed massive v2 overconfidence: 75% bucket actually won 50-62%. Led to recalibration.

### injury-signal (2026-04-13)
- **KEEP**: ESPN has undocumented /injuries endpoint for NBA, NFL, MLB, NHL — comprehensive data
- **KEEP**: Injury signal is genuinely ORTHOGONAL to team differential (council confirmed)
- **IMPROVE**: Season roster quality was collinear with teamDiff — council killed the approach before code was written (4.2/10 FAIL). Only AVAILABILITY changes are orthogonal.
- **IMPROVE**: NFL touchdowns rejected as impact metric (Domain Expert: "OL and defenders have zero TDs"). Using gamesStarted instead.
- **IMPROVE**: MLB RBIs rejected (sabermetric antipattern). Using OPS instead.
- **IMPROVE**: Recency filter (7 days) required to avoid double-counting chronic injuries already in teamDiff
- **IMPROVE**: Name matching is fragile — added fuzzy last-name fallback + console.warn on misses
- **CRITICAL**: Council feedback "do not ship without recency filter" — without it, the model double-counts every chronic absence
