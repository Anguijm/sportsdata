# Sportsdata Session Log

Chronological record of all sprints, decisions, council verdicts, and deferred work.
Last updated: 2026-04-13 (end of Sprint 10.6 mega-session)

---

## 🎯 Next Session Pickup

> **Staleness rule:** this block is rewritten at the start of every new session (or at session end when doing handoff). If the date below is more than ~48 hours older than today, treat the block as STALE — regenerate it from the Sprint-by-Sprint Log before acting on it. Git history is the authoritative timeline.

**Status as of 2026-04-13:**

### Current branch state
- **Branch:** `claude/injury-signal` (1 commit ahead of main)
- **PR #22:** https://github.com/Anguijm/sportsdata/pull/22 — injury-based prediction signal. NOT YET MERGED. Merge + run predict cron to activate.
- **PR #21 (v5 continuous model):** MERGED to main

### What shipped this session (22 PRs)

| PR | What |
|----|------|
| #2-3 | Scrape pipeline repair (missing /api/trigger/scrape, backfillDays, silent failure removal) |
| #4 | Global sport selector (all 6 leagues on frontend) |
| #5-6 | Spread prediction model (v4-spread + MLB pitchers + findings math fix) |
| #7 | Multi-sport predictions + stale upcoming fix |
| #8 | P0 fixes: backups, draws, resolver UNION, sport-specific baselines, season field |
| #9-10 | Backup workflow fixes (sqlite3 in Docker, contents:write permission) |
| #11 | P1 fixes: XSS, JSONL memory, ON CONFLICT, bookmaker consensus, overtime, etc. |
| #12 | P2 fixes: pagination, BDL overtime, coreSeason, validators, responsive, etc. |
| #13 | P3 fixes: ID comments, cron alerting, deploy-pages workflow_dispatch |
| #14-16 | Historical backfill script + /api/trigger/backfill + GitHub Actions workflow |
| #17 | Model improvements: recalibration, ratchet trigger, draw labels, MLB pitchers |
| #18-19 | Lookahead scraping (multi-day predictions) + predict error visibility |
| #20 | Predictions UNIQUE constraint migration for production DB |
| #21 | v5 continuous sigmoid model (unique probability per game) |
| #22 | **PENDING** — Injury signal (ESPN scraper + v5 adjustment) |

### Current data state
- **21,433 games** across 6 sports (2-3 seasons per sport)
- **12,813 backfill predictions** (v2) resolved with accuracy metrics
- **v5 live predictions** generating with unique probabilities per game
- **Injury data** will flow once PR #22 is merged and cron runs
- **Automated backups** running nightly at 3am UTC

### Backlog (prioritized)

**Ready to merge:**
1. PR #22 — Injury signal (MERGED 2026-04-13)
2. PR #24 — Codex fixes on #22 + session log + injury 502 fix (OPEN)
3. PR TBD — v4-spread injury integration + scraper hardening (this branch `claude/injury-v4-and-alt-sources`)

**P0 — shippable with existing data:**
4. **v4-spread margin MAE baseline** — run `predictMargin()` (no injuries, no historical odds needed) on all 12,813 backfilled games, compare predicted margin to actual final margin. Establishes MAE baseline that was never measured. This is the backtest v4-spread should have had at launch.

**HIGH — unblocks forward A/B:**
5. **Shadow-prediction logging** — for every live v4-spread pick, store naive (no-injury) prediction alongside adjusted. After N≥30 resolved live picks, compute injury-adjusted vs naive MAE delta. This is the only way to A/B-test injury signal (can't do historically because no injury data before 2026-04-13).

**Ready to build:**
6. Run ratchet for each sport (Actions → Run Ratchet) to regenerate artifacts with v5 + honest baselines
7. NHL goalie matchups — ESPN scoreboard doesn't include goalie data. Need to explore ESPN boxscore or external source.
8. MLS/EPL draw model — spread model doesn't account for draws (~25% of soccer outcomes). Needs three-outcome model.
9. Position-weighted injury impact (QB 3x, star 1.5x, bench 0.5x) — biggest quality win on existing injury signal.

**Needs research:**
10. Full lineup integration — per-game starting lineups from official league APIs (NBA, NFL).
11. Held-out validation — v5 scale and injury compensation factor are fitted on backfill (in-sample). Need cross-validation.
12. Player stats scraper in cron — currently one-time Sprint 5 ingest, not refreshed. Add to predict-cron schedule.
13. **Historical odds ingest** — Kaggle has historical NBA/NFL spread data; paid feeds for all sports. Unlocks real v4-spread ATS backtest (not just margin MAE).

**Council governance:**
- 5-expert council (Data Quality, Statistical Validity, Prediction Accuracy, Domain Expert, Mathematics Expert)
- Mathematics expert covers both computational correctness AND theoretical soundness
- All plans reviewed before implementation, all implementations reviewed before shipping
- User mandated: "don't forget to run council on everything"

### Key architecture facts
- v5 is the active winner-prediction model (continuous sigmoid, replaces v2's 4 buckets)
- v4-spread is the active spread model (margin prediction vs bookmaker line)
- Predictions table has UNIQUE(game_id, model_version, prediction_source) — 3-column constraint
- Track record: v5 live + v2 backfill (backfill predates v5, shown as calibration baseline)
- Injury signal: 7-day recency filter to avoid double-counting with team differential
- All deploy is automated: push to main → deploy-fly.yml + deploy-pages.yml
- Daily cron: scrape all sports + odds + injuries → predict all sports → resolve outcomes

**What's live right now:**
- https://sportsdata.pages.dev — Section 07 "Does the model mean what it says?" shows ECE 0.0892, verdict DISCRETE, the v2 model's 2-value finding
- https://sportsdata-api.fly.dev/api/predictions/calibration?sport=nba returns 200
- Sprint 9 mobile layout fixes (streak top/bottom 5, sport tab selector, etc.) also live

**Critical lesson from this session (DO NOT forget):** The Cloudflare Pages GitHub Actions workflow had been silently failing for 4 days — CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID secrets were never set. Every deploy since Sprint 6 failed. Always verify the live site actually reflects your commit, not just that git push succeeded. See `DEPLOY.md` for the full runbook.

**Key finding that should not be relearned:** The v2 NBA prediction model is a DISCRETE classifier — it only emits probability 60% or 75%, nothing in between. Surfaced by Sprint 10 calibration plot, now headline content. **Full numbers + forward paths:** see PAI memory `project_v2_model_discrete_finding.md` (canonical) and the Sprint 10 entry below in this log. Don't re-derive the table.

**Open council debts carrying forward** (see backlog below):
- Ratchet media query consolidation (Sprint 9 Engineer nit)
- Player name line-wrap in ranked list (Sprint 9 Designer nit)
- `eceHighConfOnly` refactor to shared helper (Sprint 10 Engineer nit)
- `canonical_game_id` schema migration (still open from Sprint 8.5, P0)
- Stale Cloudflare direct-git deploy source (dashboard cleanup, not blocking)

---

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

### Sprint 9 — Mobile Layout Fixes (SHIPPED 2026-04-08, commit `03a711e`)

**User feedback:** "No need for 45 cards about streaks or a row for every team. Think about how a user might want it to work. No swiping left or right unless it's to drill down."

**Plan council review (previous session):** 3 WARN / 1 CLEAR from Architect, Designer, Engineer, Researcher. Conditions baked into build.

**Built:**
1. Global overflow guards: `html, body { overflow-x: hidden; max-width: 100% }`, `.narrative > * { min-width: 0 }`
2. Streak grid: top 5 + bottom 5 by point differential per season (sort key changed from winPct to diffPg per Researcher), middle teams in nested `<details>`, older seasons collapsed with outer `<details>`
3. Findings: top 10 visible, remaining in `<details>` with show-more count
4. Ratchet mobile: summary stacks vertically, iterations table → stacked cards with inline labels, arrows hidden
5. Players: sport tab selector with count badges, localStorage persistence, default NBA, one sport visible at a time
6. Word-break on hero h1, section h2, finding headline/detail; 380px breakpoint for narrowest devices

**Verification:**
- vite build green, tsc --noEmit clean
- Playwright at 320/375/414/1280: zero horizontal scroll, zero JS errors, zero page errors
- Sport tab click test: persists "nfl" to localStorage after click (confirmed programmatically)
- Streak section renders exactly top 5 + "show 20 middle teams" toggle + bottom 5 + collapsed 2024-25 + collapsed 2023-24

**Council impl review:** 3× CLEAR (Architect, Designer, Engineer).
- Architect: disclosure primitive consolidated (all `<details>`), overflow cascade sound. Flagged dead `forEach` noop → fixed before commit.
- Designer: tab badges present, localStorage verified, NBA default correct. Nits deferred: player name truncation, ratchet delta decimal alignment.
- Engineer: all four mandates honored (`100%`/`minmax(0,1fr)`/`word-break`/no sticky), localStorage try/catch both ways. Nit: two `@media (max-width: 720px)` ratchet blocks could consolidate.

---

### Sprint 10 — Calibration Plot (SHIPPED 2026-04-09, commit `b8fd746`)

**Trigger:** n=2500 backfilled predictions from Sprint 8.5 unlocked meaningful calibration analysis. First in user's priority queue.

**Plan council review:** 3× WARN with 12 integrated fixes.
- Researcher: bin edges `[low, high)` with terminal closed both ends, include low_conf rows in primary ECE, ghost n<5 bins, axis domain [0.5, 1.0] not [0, 1], live threshold n≥20
- Engineer: parameterized SQL with JS-side binning, explicit Wilson formula, ECE excludes empty bins from both numerator and denominator, never-throws contract with null ECE for empty cohorts
- Designer: headline "Does the model mean what it says?", ECE paired with verdict word (HONEST/OVERCONFIDENT/SHY/DISCRETE), square 1:1 aspect ratio, sparse-cohort footnote, `--accent-dim` dashed diagonal

**Resolved conflict:** Researcher wanted `low_confidence` rows INCLUDED (calibration is the right venue); Engineer wanted EXCLUDED (matches track-record convention). Resolution: include in primary ECE, expose `eceHighConfOnly` as secondary stat so both interpretations are visible.

**Built:**
- `src/analysis/resolve-predictions.ts`: `getCalibration()` + `wilsonCI()` + `computeCohort()` + `emptyCohort()`. Wilson 95% CI, ECE, signed residual, verdict word derivation, populated-bin count.
- `src/viz/data-api.ts`: new `/api/predictions/calibration?sport=nba` route.
- `web/main.ts`: `renderCalibration()` with square SVG chart, diagonal reference line, Wilson CI bars, cohort split, discrete-output footnote.
- `web/style.css`: `calibration-hero`, `calibration-verdict.verdict-*`, `calibration-chart`, `calibration-footnote`.
- `web/index.html`: new Section 07 between Ratchet and Players.

**🔥 Headline finding (surfaced by the plot itself):** the v2 NBA model is a **discrete 2-output classifier** — it only emits probability 60% or 75%, never anything in between. The 60% bin (n=1,495) actually hits 63.5% (slightly shy). The **75% bin (n=1,005) actually hits 58.1% — a 17-point overstatement**. ECE = 0.0892, signed residual +0.0466, verdict **DISCRETE** (suppressed the curve-based OVERCONFIDENT verdict because ≤2 bins populated is not a calibration curve).

**Verification:**
- vite build green, tsc --noEmit clean
- Local API smoke test: 200, correct JSON, verdict DISCRETE, populatedBins 2 of 10
- Playwright at 375/1280: zero horizontal scroll, zero JS errors
- Full-section screenshot shows headline, lead copy, ECE hero, verdict badge, chart, footnote in correct order

**Council impl review:** Engineer 1× CLEAR. Researcher + Designer 2× WARN with overlapping insight: the chart needed to surface the discrete-output finding explicitly (not just derive a misleading OVERCONFIDENT verdict). Fixed by:
- New `populatedBins` field on cohort
- New `DISCRETE` verdict word when populatedBins ≤ 2
- Footnote: "v2 model emits 2 discrete confidence values — 8 of 10 bins empty by design"
- "X of N bins populated" in cohort sub-label

Post-fix all 3 verdicts → CLEAR.

**Deferred from council nits:**
- Refactor `eceHighConfOnly` second pass into a shared `computeECE(rows, binCount)` helper (Engineer, low priority)
- Consider logging `populatedBins` in an API response assertion for future sprint tests (Researcher, nice-to-have)

---

### Sprint 10.5 — Deploy Infrastructure Repair (2026-04-09)

**Discovered during Sprint 10 verification:** every Cloudflare Pages GitHub Actions deploy had been failing silently since Sprint 6 (2026-04-07). Root cause: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets were never set in the repo's GitHub Actions secrets.

**Evidence:**
```
gh run list --workflow=deploy-pages.yml
→ 10 consecutive failures spanning Sprint 5 through Sprint 10
```

**Error from last failed run:**
> In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable for wrangler to work.

**Mystery:** if every deploy failed, how was `sportsdata.pages.dev` serving any content? Hypothesis: a direct git integration in the Cloudflare Pages project (set up before the Actions workflow was added) was serving stale builds. Not confirmed — would require Cloudflare dashboard access.

**Fix applied this session:**
1. User set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in GitHub secrets
2. `gh run rerun 24155529847` on the Sprint 10 commit → ✓ 37s successful deploy (first green Pages deploy in 4 days)
3. `~/.fly/bin/fly deploy` for the Fly API (new `/api/predictions/calibration` endpoint) → ✓ smoke check passed, machine 287e392a913538 reached started state
4. Live verification: https://sportsdata-api.fly.dev/api/predictions/calibration?sport=nba returns 200 with the DISCRETE verdict; https://sportsdata.pages.dev serves the new "Best and worst 5" (Sprint 9) and "Does the model mean" (Sprint 10) content.

**Lesson captured as PAI memory `feedback_verify_live_deploy.md`:** always verify the live site reflects the commit, don't trust git push success alone. Check `gh run list` after pushes, and curl the live URL for the expected content.

**New runbook: `DEPLOY.md` in repo root** — documents fly deploy path, gh run rerun for Pages, verification curl commands, secret list.

**Deferred:** investigate + disable the stale Cloudflare direct-git deploy source in the dashboard (not blocking since the Actions workflow is now authoritative). Filed in backlog.

---

### Sprint 10.7 — v4-spread Injury Integration + Scraper Hardening (2026-04-14)

**Trigger:** Post-PR #22 review surfaced a gap: v5 winner model reflected injuries, but v4-spread predicted margins as if injured players were available. ATS picks were stale in exactly the cases that matter most (key player out). Separately, a cron run hit 502 because the failure sweep was counting injury-endpoint errors as critical.

**Built (commits `99ce896`, `ac5ed2a`):**

**Injury signal extension:**
- `predictMargin()` now accepts optional `InjuryImpact` param; applies `INJURY_COMPENSATION = 0.4` shift same as v5
- `computeInjuryImpact()` exported from predict-runner so spread-runner can reuse the recency-filtered calculation
- `spread-runner.ts` computes impact for both teams, passes to `predictMargin`, surfaces `home_out_impact`/`away_out_impact` in reasoning_json
- Per-player impact clamp: `maxIndividual` per sport (NBA 40 PPG, NFL 17 games, MLB 1.5 OPS, NHL/soccer 1.5-2.0 pts/g) protects against ESPN schema drift
- `console.warn` fires when clamp triggers so drift is visible

**Scraper hardening:**
- `fetchWithRetry()` in injuries.ts: 3 attempts with exponential backoff (500ms → 1s → 2s ± 25%), 10s timeout, retries 5xx only (4xx deterministic)
- Scheduler failure sweep excludes `dataType: 'injuries'` — supplementary feeds must not fail the cycle (earlier fix in PR #24)

**Frontend:**
- Spread cards now show `Injuries: LAL −8.3 points of missing player impact` when signal shifted the margin
- Disclaimer explicitly states injury-adjusted status per league: "Injury-adjusted (ESPN feed)" for NBA/NFL, "for skaters" for NHL, "for position players" for MLB, "**no** (no public lineup feed for this league)" for MLS/EPL

**Council review (2 rounds):**
- **Round 1:** 4× WARN. Must-fixes: per-player clamp (Math), UI surfacing (Prediction Accuracy), soccer disclaimer (Domain), jitter cleanup (Data Quality).
- **Round 2:** 4× CLEAR + 1 WARN (Statistical Validity on backtesting). Verdict: **SHIP with debts filed.**

**Backtesting — honest status (clarified after user pushback):**

Three overlapping constraints were conflated in the first council writeup:

| What | Status | Why |
|------|--------|-----|
| v4-spread vs historical bookmaker spreads | **Cannot test** | No historical odds data. ESPN doesn't publish; Odds API free tier returns current lines only. |
| Injury-adjusted vs naive on historical games | **Cannot test** | Injury data only exists from 2026-04-13 forward. ESPN's `/injuries` endpoint is point-in-time, no history. |
| v4-spread margin accuracy (actual game margins) | **Can test but haven't** | 12,813 resolved games with final scores; no injury data needed. Filed as P0 debt (item 13). |
| Forward A/B injury-adjusted vs naive | **Can set up, haven't** | Requires shadow-prediction logging from cron forward. Filed as HIGH debt (item 14). |

**Key takeaway:** v4-spread was shipped without baseline MAE against the 12,813-game corpus — a miss from Sprint 10.6c. Injury extension inherits that miss. The answer isn't "we can't backtest spreads" (true but incomplete); it's "we can backtest margin accuracy today and should."

**Investigated but dropped:**
- NBA.com / NFL.com public JSON feeds — don't exist (NBA.com 404 on injury endpoints, NFL.com HTML only)
- Basketball-Reference / CBS Sports — blocked by 403 or HTML-only (requires UA spoofing + parser; not worth it for a secondary signal)
- **Result:** Hardened what we have (ESPN with retries); filed concrete criteria for when to invest in alt sources

---

## Backlog (Post-Sprint 10)

### Sprint 11 Candidates (user's next pick)

**NHL ratchet + cross-sport comparison** — the #1 priority after Sprint 10. The ratchet CLI already takes `sport` as an arg, so the machinery is sport-generic, but the v2 iterations (home/away differential, point diff streaks) are tuned for NBA. Three scoping options on the table (user has not picked):

1. **Same recipe, new sport** — run existing v2 iteration sequence against NHL unchanged. Fast (~1-2 hours). Story: "the recipe generalizes" or "it doesn't."
2. **NHL-specific iterations** — design hockey-native features (goalie quality, back-to-back fatigue, low-scoring regime). Half day+. Better story.
3. **Start (1), decide based on results** — pragmatic middle ground.

**Cross-sport comparison chart** is the same regardless — once both sports have ratchet artifacts, a new section shows best-Brier-vs-baseline improvement side-by-side.

### Council Debts Filed

| # | Item | Source | Priority |
|---|------|--------|----------|
| 1 | canonical_game_id schema migration | Sprint 8.5 Skeptic | P0 |
| 2 | MLB doubleheader handling | Sprint 8.5 Pragmatist | Before generalizing beyond NBA |
| 3 | Test fixture covering both ID shapes | Sprint 8.5 Tester | With canonical migration |
| 4 | Vegas frontend rendering | Sprint 8 deferred | Quick win |
| 5 | Ratchet media query consolidation | Sprint 9 Engineer | Low (cosmetic) |
| 6 | Player name line-wrap in ranked list | Sprint 9 Designer | Low (cosmetic) |
| 7 | eceHighConfOnly → shared computeECE helper | Sprint 10 Engineer | Low (refactor) |
| 8 | Disable stale Cloudflare direct-git deploy source | Sprint 10.5 ops | Dashboard only |
| 9 | ESPN per-call retry jitter | Sprint 8 Engineer | Low |
| 10 | Seed-stability test for v2 winning margin | Sprint 6 Skeptic | Low |
| 11 | Train/test shaded regions on ratchet chart | Sprint 6 Designer | Low |
| 12 | Reliability bins on calibration (once n>100 live) | Sprint 7 Researcher | After live cohort grows |
| 13 | **v4-spread margin MAE baseline on 12,813 backfill games** (no injuries needed — actual final scores available) | Sprint 10.7 Statistical Validity | **P0 — shippable today** |
| 14 | **Shadow-prediction logging**: for every live v4-spread pick, store the naive (no-injury) prediction alongside the adjusted one. Enables forward A/B after N≥30 resolved picks. | Sprint 10.7 Statistical Validity | **HIGH — before live track record stabilizes** |
| 15 | v5↔v4-spread injury consistency check (same sign on all games, post-merge) | Sprint 10.7 Mathematics | Medium |
| 16 | Position-weighted injury impact (QB 3x, star 1.5x, bench 0.5x) | Sprint 10.7 Domain Expert | Medium (biggest quality win) |
| 17 | Minimum-impact threshold (skip adjustment below 2 units) | Sprint 10.7 Prediction Accuracy | Low (refinement) |
| 18 | Fit INJURY_COMPENSATION separately for margin vs winprob | Sprint 10.7 Statistical Validity | After N≥200 resolved per model |
| 19 | Second injury data provider (criteria: ≥3 ESPN failures/week for 2 weeks) | Sprint 10.7 Data Quality | Watch metric |
| 20 | Historical odds ingest (Kaggle / paid feed) to enable ATS backtest | Sprint 10.7 Prediction Accuracy | High — unlocks real v4-spread validation |

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
