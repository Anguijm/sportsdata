# Sportsdata Session Log

Chronological record of all sprints, decisions, council verdicts, and deferred work.
Last updated: 2026-04-08 (end of Sprint 8.5)

## Live URLs

- Frontend: https://sportsdata.pages.dev
- API: https://sportsdata-api.fly.dev
- GitHub: https://github.com/Anguijm/sportsdata (private)

## Architecture

Four-layer system, council-governed:

```
GOVERNANCE    Council (role-tagged) | Evaluation Gates | Memory/Logs
ORCHESTRATION Thin State Machine   | Ratchet Loop     | Pipeline Control
ANALYSIS      Statistical Analysis | Predictions      | Visualizations
DATA          Scrapers             | Normalizers      | SQLite + JSONL
```

**Deploy topology (council-approved split):**
- Cloudflare Pages (frontend, 300+ edges, free)
- Fly.io DFW (API + SQLite, 512MB always-on machine, free tier)
- GitHub Actions (backup cron + predict cron, free)

**Data sources:**
- ESPN undocumented API — 6 leagues (NFL, NBA, MLB, NHL, MLS, EPL)
- The Odds API — betting lines (free tier, 500 req/month)
- BallDontLie — NBA historical (free tier, 5 req/min)
- ESPN core API v2 — player stats for all 6 sports

---

## Sprint-by-Sprint Log

### Sprint 1 — Foundation Scaffold (2026-04-04)

**Built:** 4-layer architecture, council personas, skills, harness.yml, schema interfaces, repository pattern, JSONL logging, evaluation gates, ratchet loop code (unused), ESPN scraper.

**Council:** Plan debated 3 rounds. Unanimous on SQLite + DuckDB + JSON logs, single council with role tags, semi-autonomous ratchet, 2-source corroboration default.

**Outcome:** 43/44 ISC criteria passed. Foundation ready.

---

### Sprint 2 — SQLite + Scheduler + CLI + Odds (2026-04-04)

**Built:** SQLite store with repository pattern, scheduler with retry logic, CLI tables (status, inspect), Odds API client with rate limiting.

**Live scrapes:** NFL 32 teams, NBA 30 teams, MLB 30 teams, NHL 32 teams, MLS 30 teams, EPL 20 teams. Full cycle: 1.3s.

**Council post-impl verdict:** WARN (7.25/10). 6 action items filed for Sprint 3.

---

### Sprint 3 — Game Outcomes + Team Mappings + BallDontLie (2026-04-04)

**Built:**
- `game_results` table with auto-resolution (28 outcomes resolved on first run)
- Transactional bulk inserts (50-100x faster)
- 90 NBA team mappings across ESPN/Odds API/BallDontLie
- BallDontLie API client (cursor pagination, rate limiting, resumable)
- Historical NBA ingest runner

**Ingested:** 3,871 NBA games across 3 seasons (2023-24, 2024-25, 2025-26).

**Council debts filed:** ingest validation, staleness alerting, conference/division NULL fix, ESPN↔OddsAPI mapping, NFL offseason health check, MLB doubleheader ID collision.

---

### Sprint 4 — Jon Bois-Inspired Viz Scaffold (2026-04-05)

**Built:**
- "Interesting Things" detector (streaks, margin outliers, mediocrity)
- 35 initial findings from 3,883 NBA games
- Data API with 5 endpoints
- Vite + Observable Plot web frontend
- Margin histogram chart
- Initial white-background aesthetic

**Council plan review:** FAIL → revised → 4-0 CLEAR. Conditions: minimum-games filter, rate stats paired with counting stats, spotlight/temporal anchor on Finding interface.

**USER OVERRIDE:** John rejected the white background. Switched to dark mode. Saved feedback to memory as critical discipline item.

---

### Sprint 5 — Player Stats for All 6 Sports (2026-04-05)

**Built:**
- ESPN player stats client (works for all 6 sports via one pattern)
- Player findings detector per sport
- Hero card structure per sport

**Ingested:** 5,049 players across 6 leagues
- NFL 1,829 · NBA 436 · NHL 794 · MLB 741 · MLS 677 · EPL 572

**Council post-impl verdict:** FAIL. Six fixes mandated:
1. Minimum-games config (NBA 20 GP, NFL 6 G, MLB 50 IP / 100 AB, NHL 15 starts)
2. Rate stats paired with every counting stat
3. Hero card with qualifier visible
4. Collapsible categories
5. MLS/EPL hard separation
6. Qualifier label visible everywhere

**After fixes, council re-review:** 3 CLEAR / 1 WARN → SHIP.

**CRITICAL LEARNING:** User flagged "feels like we're not using the council correctly." Saved `feedback_council_discipline.md` — council must review plans AND implementations AND tests, iterating until happy.

---

### Sprint 6 — First Ratchet Loop Run (2026-04-05)

**THE ORIGINAL PROJECT GOAL ACHIEVED.**

**Built:**
- `predict.ts` — 4 iterations with `PredictionContext` type enforcing no-future-leakage
- `backtest.ts` — point-in-time harness with bootstrap 95% CIs
- `ratchet.ts` CLI writing static JSON artifact
- Frontend ratchet section with SVG chart

**Day-1 dry run (council mandate):** Verified Brier computation before building scaffolding.

**Results on 2,495-game test set:**
| v | Description | Brier | Accuracy | Δ |
|---|-------------|-------|----------|---|
| v0 | Pick home | 0.4529 | 54.7% | — |
| v1 | + Win gap ≥10 | 0.3233 | 61.2% | −0.1296 |
| **v2** | **+ Point diff 3+** | **0.2489** | **61.3%** | **−0.0745 ★** |
| v3 | + Cold streak | 0.2510 | 61.7% | +0.0022 (rejected) |

**45% Brier improvement. Bootstrap CIs don't overlap → statistically significant.**
v3 correctly reverted by ratchet → mechanism validated.

Also shipped: pace-adjusted margin analysis (margin_pct = margin / avg_total_points).

**Council post-impl verdict:** 3 CLEAR / 1 WARN → SHIP.
Skeptic debts filed: Vegas closing line baseline, chart train/test shading, seed-stability test.

---

### Sprint 7 — Live Predictions (2026-04-06)

**THE LEAP FROM ANALYSIS TO PRODUCT.**

**Built:**
- `predictions` table with all council-mandated fields (reasoning_json, team_state_as_of, low_confidence, etc.)
- `predict-runner.ts` — applies v2 to upcoming games (CURRENT-SEASON team state only — caught a bug that was using 3-season cumulative state)
- `resolve-predictions.ts` — marks predictions correct/incorrect after game final + 2h delay
- `/api/trigger/predict` bearer-auth endpoint
- GitHub Actions cron (twice daily: 05:00 + 22:00 UTC)
- Frontend "Live Predictions" section with track card + tonight's picks + recent

**Editorial (per Designer):** "Model pick:" framing, tonight first not track record, "thin data" pill for low-confidence.

**Statistical honesty (per Researcher):** Live Brier on dashboard, excluded-segment label for low-confidence, reliability bins deferred until n>100.

**Council plan review:** 2 CLEAR / 2 WARN → revised → 4-0 CLEAR.
**Council post-impl review:** 3 CLEAR / 1 WARN → SHIP. Engineer WARN (ESPN hardening + unset Fly secret) — secret fixed same session, ESPN hardening filed for Sprint 8.

**Live:** 50 upcoming NBA games predicted with full reasoning.

**COLD START BUG DISCOVERED:** User reported page slow/broken. Investigation revealed:
1. `tsx` was NOT in devDependencies — every cold start downloaded it (~30s)
2. `auto_stop_machines = 'suspend'` caused frequent cold starts
3. 256MB memory was tight for 21MB DB + state loads ("VM exited abruptly" crashes)

**Fix:**
- Added `tsx` to devDependencies
- CMD uses `node node_modules/.bin/tsx` (no npx)
- Bumped VM: 256MB → 512MB
- `min_machines_running = 1`, `auto_stop_machines = 'off'`

Cold start went from 30+ seconds to ~1 second.

---

### Sprint 8 — Three Council Debts Cleared (2026-04-06)

**FIRST UNANIMOUS POST-IMPL COUNCIL PASS.**

**Built:**

**Item 1 — ESPN Hardening (Engineer's Sprint 7 WARN):**
- `src/scrapers/validators.ts` — pure module, hand-rolled type guards (no zod)
- `safeFetch` returns discriminated union `{ok:true,data} | {ok:false,reason}` — no throws
- 3-attempt retry with exponential backoff [2s, 4s, 8s]
- Schema validation BEFORE DB write — fail-closed
- Optional Discord/Slack webhook via `ESPN_ALERT_WEBHOOK` env (opt-in)

**Item 2 — Vegas Baseline (Skeptic's WARN, instrumentation only):**
- `src/analysis/vegas-baseline.ts` — matches `odds_raw` to `game_results` via team_mappings, American odds → implied prob → vig removal
- Bootstrap 95% CIs on accuracy + Brier
- Ratchet artifact schema bumped to `schemaVersion: 2`
- Live: n=3, 66.7% [0%, 100%] — labeled PRELIMINARY (Researcher mandate: no "v2 beats Vegas" headline)

**Item 3 — Hero Card Polish (Designer's WARN, open 2 sprints):**
- `web/team-colors.ts` — `Record<sport, Record<teamAbbr, {primary, secondary}>>`
- NBA fully populated (30 official team colors)
- Large team abbr background (220px = 78% of card height)
- "#1 of N qualified" badge with tooltip

**Council plan review:** 2 CLEAR / 2 WARN → revised → 4-0 CLEAR.
**Council post-impl review:** 4-0 CLEAR (first unanimous!).

---

### Sprint 8.5 — Resolver Fix + Prediction Backfill (2026-04-07)

**Two fixes in one sprint. Both triggered by user observation: "track record is 0-0, something must be wrong."**

#### Fix A: Prediction Resolver Cross-Namespace Match

**Root cause:** Two game ID namespaces in `games` table:
- 3,871 BDL games (`nba:bdl-XXXXX`) — historical from BallDontLie ingest
- 17 ESPN games (`nba:401XXX`) — recent ESPN scrapes
- Same physical game can exist as TWO rows

Predictions pointed at BDL IDs but game_results were under ESPN IDs. Resolver joining on `game_id` never matched.

**Fix:** Resolver joins by `(sport, home_team_id, away_team_id, ±1 day)` natural key instead of game_id. ±1 day window handles UTC timezone shift for West Coast games. Added composite index. Verified with test prediction (NY@ATL 4/6 matched correctly across namespaces).

**Council review:** 2 CLEAR / 2 WARN. Conditions baked in: canonical_game_id migration filed as Sprint 9 P0, MLB doubleheader risk acknowledged, tests required.

#### Fix B: Backfill Predictions from Ratchet Test Set

**Problem:** Live track record was 0-0 because all live predictions were for future games not yet played. Sprint 6 validated v2 on 2,495 held-out games but never persisted individual predictions — just the aggregate.

**Built:**
- Schema migration: new `prediction_source` column (`'live'` / `'backfill'`)
- Composite key `(game_id, model_version, prediction_source)`
- Index on `(prediction_source, model_version)`
- `backfill-predictions.ts` CLI — walks held-out games, persists v2 predictions with point-in-time state
- Invariant: `team_state_as_of < game_date` enforced (throws on violation)
- `getTrackRecord()` returns SEPARATE live + backfill cohorts (UX mandate: never merged)
- Frontend renders TWO distinct cards (backwards-compat top-level = live only)

**Backfill results:**
- 2,500 predictions inserted
- 1,534 correct (61.4% accuracy)
- 0.2486 Brier (matches Sprint 6 ratchet exactly)

**Live track record now shows:**
```
┌─ LIVE ─────────────┐  ┌─ BACKTEST ──────────┐
│ 0–0                │  │ 1534–966            │
│ —                  │  │ 61.4%               │
│ —                  │  │ 0.249 Brier         │
│ accumulating       │  │ held-out · 2,500    │
└────────────────────┘  └─────────────────────┘
```

**Council review:** 2 CLEAR / 2 WARN. Conditions met: Skeptic's `made_at = game_date - 1day`, Architect's composite key, Quant's invariant, UX's split display.

---

### Sprint 9 (STARTED, INCOMPLETE) — Mobile Layout Fixes

**User feedback:** "No need for 45 cards about streaks or a row for every team. Think about how a user might want it to work. No swiping left or right unless it's to drill down. Make sure what's rendered fits the width correctly."

**Audit completed (manual code review, BrowserAgent failed):**
- Section 03 (streak grid): 30 teams × 3 seasons = 90 rows, each with 82-game segmented bar → overflow + overload
- Section 04 (findings): 46 cards in one list → overload
- Section 06 (ratchet iterations table): `grid-template-columns` with ~340px+ fixed → overflow on 375px phones
- Section 06 (ratchet summary): 5-col grid → overflow
- Section 07 (players): 6 sports stacked vertically → endless scroll
- No body-level `overflow-x: hidden` guard

**Plan drafted:**
1. Global overflow guards (`overflow-x: hidden` on body + html, `min-width: 0` on narrative children, use `100%` not `100vw`)
2. Streak grid: top 5 + bottom 5 by point differential per season, `<details>` for older seasons, "show middle N teams" nested toggle
3. Findings: top 10 visible, `<details>` for "show 36 more"
4. Ratchet: stack summary vertically on mobile, iterations table → stacked cards
5. Players: sport tab selector, one sport at a time, localStorage persistence, count badges
6. Use native `<details>` elements throughout for consistency (Architect mandate)

**Council plan review:** 3 WARN / 1 CLEAR. Conditions:
- Architect: Consolidate disclosure primitive (use `<details>` everywhere)
- Designer: localStorage persistence, count badges on tabs, default sport = in-season
- Engineer: `100%` not `100vw`, nested grid `minmax(0, 1fr)`, `word-break: break-word`, iOS Safari sticky quirks
- Researcher: Rewrite headline ("Best and worst 5 by point diff"), confirm findings are ranked by surpriseScore (they are), CSS compression > truncation for streak bars

**STATUS: Plan approved but implementation incomplete.**
Only `web/style.css` overflow guards were partially written and reverted. Streak grid renderer drafted (see commit history / unsaved buffer) but not applied.

**CONTEXT CLEARED HERE. Next session picks up Sprint 9 build from the plan above.**

---

## Backlog (Post-Sprint 8.5)

### Sprint 9 In Progress: Mobile Layout Fixes
See plan above. Drafted streak grid renderer uses top 5 + bottom 5 by diffPg, with `<details>` for older seasons and middle teams.

### Sprint 9/10 Debts Filed

| # | Item | Source | Priority |
|---|------|--------|----------|
| 1 | canonical_game_id schema migration | Sprint 8.5 Skeptic | P0 |
| 2 | MLB doubleheader handling | Sprint 8.5 Pragmatist | Before generalizing beyond NBA |
| 3 | Test fixture covering both ID shapes | Sprint 8.5 Tester | With canonical migration |
| 4 | Vegas frontend rendering | Sprint 8 deferred | Quick win |
| 5 | Calibration plot (now unlocked by backfill n=2500) | Researcher Sprint 7 | HIGH — user's next pick |
| 6 | NHL ratchet (cross-sport story) | Recommendation | HIGH — user's next pick |
| 7 | ESPN per-call retry jitter | Sprint 8 Engineer | Low |
| 8 | Seed-stability test for v2 winning margin | Sprint 6 Skeptic | Low |
| 9 | Train/test shaded regions on ratchet chart | Sprint 6 Designer | Low |
| 10 | Reliability bins on calibration (once n>100 live) | Sprint 7 Researcher | After calibration plot |

### Deferred (Sprint 10+)

- **Predictions for non-NBA sports** — need validated per-sport models
- **Player-based predictions** — "Does SGA score >30 tonight?"
- **Kaggle historical NBA import** — 1946-present for deeper findings
- **Headshots on hero cards** — licensing/hosting complexity
- **Schema migrations** (`last_updated_at`, `stat_category` enum)
- **JSON1 indexes** on player_stats
- **Sport-function consolidation** in player-findings.ts
- **Mid-season trade handling**
- **Soccer loan player handling**
- **Park factors** (MLB)
- **Strength of schedule**
- **Scrollama narrative** (deferred from Sprint 4)
- **Single-team drill-down page** (Sprint 4 Viz 5)
- **Per-sport Brier breakdown**
- **Rolling 30-day Brier**

---

## User's Priority Queue (from last conversation)

> "Let's hit your recommendations in order."

1. **Mobile layout fixes** (in progress — Sprint 9)
2. **Calibration plot** — unlocked by backfill (n=2,500 resolved)
3. **NHL ratchet + cross-sport comparison** — big story value
4. **Vegas frontend rendering** — 30-minute close-the-loop

---

## Council Discipline (LOCKED PROTOCOL)

User mandate, saved to memory as `feedback_council_discipline.md`:

> "All plans are audited by the council until the council is happy. Then all implementations are run past the council until the council is happy then all tests are run past the council until the council is happy."

**Every sprint MUST have:**
1. Plan review → iterate until CLEAR (or WARN with mitigations)
2. Implementation review → iterate if FAIL
3. Test/results review

User should never be the first reviewer. Skipping = CRITICAL FAILURE.

**User overrides memory (`feedback_dark_mode.md`):** Council voted white background for viz; user overrode to dark. Always dark mode for sportsdata web.

---

## Key Files Reference

### Backend
- `src/schema/` — All TypeScript interfaces (source of truth)
- `src/scrapers/espn.ts` — Hardened ESPN client with safeFetch + validators
- `src/scrapers/espn-players.ts` — Unified player stats client
- `src/scrapers/balldontlie.ts` — NBA historical
- `src/scrapers/odds-api.ts` — Betting lines
- `src/storage/sqlite.ts` — All tables + repository + helpers
- `src/analysis/interesting.ts` — Team-level findings (streaks, margins, mediocrity)
- `src/analysis/player-findings.ts` — Player-level findings per sport
- `src/analysis/qualifiers.ts` — Config-driven minimum-games thresholds
- `src/analysis/predict.ts` — Ratchet iterations (v0-v3)
- `src/analysis/backtest.ts` — Point-in-time harness with bootstrap CIs
- `src/analysis/predict-runner.ts` — Live prediction runner
- `src/analysis/resolve-predictions.ts` — Cross-namespace resolver + track record
- `src/analysis/vegas-baseline.ts` — Vegas comparison (preliminary)
- `src/orchestration/scheduler.ts` — Cron-like with retry
- `src/orchestration/ratchet.ts` — Original ratchet state machine
- `src/cli/predict.ts` — Predict CLI (cron-callable)
- `src/cli/backfill-predictions.ts` — Backfill from test set
- `src/cli/ratchet.ts` — Run ratchet CLI
- `src/cli/findings.ts` — Print findings to terminal
- `src/cli/inspect.ts` — Data inspection (mappings, results, home-rate)
- `src/cli/status.ts` — DB overview
- `src/viz/data-api.ts` — HTTP JSON API (all endpoints)

### Frontend
- `web/index.html` — Single scroll page (7 sections)
- `web/main.ts` — All rendering logic
- `web/style.css` — Dark theme, JetBrains Mono, Inter
- `web/team-colors.ts` — Team accent color lookup
- `web/env.d.ts` — Vite env types

### Deploy
- `Dockerfile` — Node 22, tsx bundled, better-sqlite3 native
- `fly.toml` — DFW region, shared-cpu-1x, 512mb, always-on
- `.github/workflows/deploy-pages.yml` — Cloudflare Pages deploy
- `.github/workflows/scrape-cron.yml` — Backup scrape cron
- `.github/workflows/predict-cron.yml` — Predict cron (5am + 22:00 UTC)

### Governance
- `harness.yml` — Council config
- `.harness/council/*.md` — 4 expert personas + resolver
- `skills/*.md` — Bootstrap, scrape, analyze, review workflows
- `learnings.md` — Per-session KEEP/IMPROVE/DISCARD/INSIGHT

### Memory (cross-session)
- `~/.claude/projects/-home-johnanguiano-projects-sportsdata/memory/MEMORY.md`
- `project_sportsdata_foundation.md` — Architecture + current state
- `feedback_dark_mode.md` — User override on white background
- `feedback_council_discipline.md` — CRITICAL council protocol

---

## Environment Variables (Fly secrets + local .env)

- `THE_ODDS_API_KEY` — Odds API (500 req/mo free)
- `BALLDONTLIE_API_KEY` — NBA historical (5 req/min free)
- `PREDICT_TRIGGER_TOKEN` — Bearer for /api/trigger/predict
- `ESPN_ALERT_WEBHOOK` — Optional Discord/Slack for scrape failures
- `SQLITE_PATH` — `/app/data/sqlite/sportsdata.db` on Fly
- `LOGS_DIR` — `/app/data/logs` on Fly
- `PORT` — 3001
- `HOST` — 0.0.0.0

---

## npm Scripts

```bash
npm run type-check    # tsc --noEmit
npm run scrape [sport]  # ESPN scrape (one sport)
npm run scrape:all    # All 6 leagues
npm run cycle         # Full scheduler run
npm run status        # DB overview
npm run inspect [cmd] [sport]  # mappings | results | home-rate
npm run odds          # Fetch current odds
npm run historical    # Load historical NBA from BDL
npm run seed:nba      # Seed NBA team mappings
npm run players [sport]  # Ingest player stats
npm run findings [sport]  # Print interesting findings
npm run ratchet [sport]  # Run ratchet backtest
npm run predict [sport]  # Predict upcoming games + resolve
npm run backfill:predict [sport]  # Backfill from test set
npm run api           # Start data API (local)
npm run dev           # Vite dev server
npm run viz           # Both API + Vite together
```

---

## Git Commit History Highlights

```
ff0f43a Sprint 8.5: Backfill prediction history from ratchet test set
093bc0b Fix prediction resolver: cross-namespace match by team+date
7ab82ec Sprint 8: Council debts cleared — ESPN hardening, Vegas baseline, hero polish
985bf01 Fix slow cold starts: bundle tsx, bump memory, always-on machine
c5ab5a1 Sprint 7: Live predictions — apply ratchet to upcoming games
76d0572 Sprint 6: Ratchet loop first run + pace-adjusted margins
4a93ef5 Player stats for all 6 sports + council-mandated qualifier filter
ed9a8f4 Context-aware findings: per-season streaks, point differential, clutch
5c869f9 Dark mode redesign — actually interesting visualization
9bab877 Production deploy fixes
6c0978c Add deployment infrastructure: Cloudflare Pages + Fly.io + GitHub Actions
aea4258 Viz: interesting things detector, data API, web scaffold
483ac66 Add README, update design.md
e31d4e7 Sprint 3: game outcomes, team mappings, BallDontLie
0abd772 Add Premier League and MLS support
278c70d Sprint 2: SQLite persistence, scheduler, CLI tables, Odds API client
aa3b309 Initial scaffold
```

---

## Next Session Pickup Points

1. **Sprint 9 mobile fixes** — plan approved (3 WARN / 1 CLEAR), build not started.
   - Drafted streak grid renderer with top-5/bottom-5 + `<details>` in working memory, not committed.
   - Global overflow guards need `overflow-x: hidden` on body/html.
   - Use native `<details>` for all progressive disclosure.

2. **Calibration plot** (after mobile fixes) — unlocked by backfill n=2,500.

3. **NHL ratchet** (after calibration) — extends v2 to NHL with same code path.

4. **Vegas frontend rendering** (30-min task) — artifact has data.

5. **Context is about to be cleared** — rely on this document plus the memory system to resume.
