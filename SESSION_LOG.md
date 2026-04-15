# Sportsdata Session Log

Chronological record of all sprints, decisions, council verdicts, and deferred work.
Last updated: 2026-04-14 (end of Sprint 10.8 — baseline-with-CIs + soccer Poisson null + DC-invariance finding)

---

## 🎯 Next Session Pickup

> **Staleness rule:** this block is rewritten at the start of every new session (or at session end when doing handoff). If the date below is more than ~48 hours older than today, treat the block as STALE — regenerate it from the Sprint-by-Sprint Log before acting on it. Git history is the authoritative timeline.

**Status as of 2026-04-14 (late-day, post-#29 merge):** Sprint 10.8 shipped. All work merged to main (PRs #26, #27, #28, #29). No open PRs. Next session starts clean.

**Key finding from Sprint 10.8:** the soccer-Poisson v1 A/B (PR #29) hit its pre-declared null result — Poisson cannot be distinguished from predict-zero at 95% CI on either MLS or EPL, so per pre-declared ship rule 3, the model did NOT ship as a replacement for v4-spread. Also, a post-#29 math review established that Dixon-Coles τ correction (the obvious "next step") **cannot move margin MAE** (E[H−A]_DC = E[H−A]_independent, exactly — see Sprint 10.8 notes below), so the naively-next debt was split and deprioritized.

### What shipped since Sprint 10

29 PRs (see Sprint-by-Sprint Log for detail):

| PRs | Theme |
|-----|-------|
| #1-3 | Scrape pipeline repair (missing /api/trigger/scrape, backfillDays, silent failure removal) |
| #4 | Global sport selector (all 6 leagues on frontend) |
| #5-6 | Spread prediction model (v4-spread + MLB pitchers + findings math fix) |
| #7 | Multi-sport predictions + stale upcoming fix |
| #8-13 | Full codebase review (33/35 issues: P0/P1/P2/P3) |
| #14-16 | Historical backfill script + /api/trigger/backfill + GitHub Actions workflow |
| #17 | Model recalibration from 12,813 backfill predictions |
| #18-20 | Multi-day predictions + constraint migration |
| #21 | v5 continuous sigmoid model (replaces v2's 4 discrete buckets) |
| #22 | Injury signal — ESPN scraper + v5 adjustment |
| #23 | Session log: documented PRs #1-21 since Sprint 10.5 |
| #24 | Injury 502 fix + Codex fixes on #22 |
| #25 | v4-spread injury integration + ESPN scraper hardening + backtesting honesty |
| #26 | Session handoff: post-merge doc refresh + handoff-discipline lesson |
| #27 | Per-sport baseline analysis scaffold (debt #13 scaffold) |
| #28 | Per-sport baseline with bootstrap 95% CIs — closes debt #13 |
| #29 | Soccer Poisson v1 — A/B infra + null result on pre-declared ship gate |

### Live model state (post-#25 merge)

- **v5** (winner prediction): continuous sigmoid + injury adjustment for NBA/NFL/MLB/NHL
- **v4-spread** (margin/ATS): continuous margin model + injury adjustment for NBA/NFL/MLB/NHL, **PLUS MLB pitcher ERA factor (`±0.3 runs per 1.0 ERA gap`)** — this MLB-specific term is intentional, not a special case to "clean up"
- **MLS/EPL**: both models run but injury signal disabled (no public lineup feed); UI shows "Injury-adjusted: no" disclaimer
- **ESPN injury scraper**: 3-attempt retry with exponential backoff (500ms→1s→2s ± 25% jitter), 10s timeout per attempt
- **Critical fail-closed semantic**: injury endpoint failures do NOT fail the cycle (filtered from critical failure sweep) — model degrades gracefully without injury data

### Current data state

- **21,516 games** across 6 sports (2-3 seasons per sport)
- **12,813 backfill predictions** (v2) resolved with accuracy metrics
- **v5 live predictions** generating with unique probabilities per game (injury-adjusted for NBA/NFL/MLB/NHL since PR #22 merged)
- **v4-spread live predictions** running for games with odds (injury-adjusted since PR #25 merged; first cron with the new code at next 22:00 UTC run)
- **Injury data** flowing since PR #22; ESPN scraper hardened (3-attempt retry + 10s timeout) since PR #25
- **Automated backups** running nightly at 3am UTC

### Priority queue for next session

**P0 — first task next session, surfaced by reliability diagrams (debt #11 closed late Sprint 10.8):**
1. **NBA v4-spread home-advantage re-calibration (debt #27).** Reliability artifact `data/reliability/reliability-2026-04-15.txt` shows NBA margin is BIASED_HIGH with signedResid=−0.605 points uniform across ALL 20 populated bins (weightedMAE=0.957). This is the signature of a single-number calibration drift, not a structural model bug. One-line fix + baseline re-run to confirm the shift cleared the bias. Smallest shippable code change for a real accuracy improvement.

**HIGH — follow-ons from the reliability findings:**
2. **MLS/EPL v5 sigmoid scale sharpening (debt #28).** Reliability shows v5 is SHY on both soccer leagues (signedResid +0.04). Tune the sigmoid scale downward from baseline data.
3. **Shadow-prediction logging for MLS/EPL (extend debt #14).** Store naive / any-new-model predictions alongside the live v4-spread pick on every cron. Essential before any v2 soccer attempt.
4. **Pre-2024 soccer match scrape (debt #26).** FBref or Understat (Understat includes xG). Unblocks ξ-weighted MLE fitting of α/β and a clean train/test split. Medium infra lift; the gating dependency for any serious soccer v2.

**Then, when soccer data lands (v2 soccer campaign):**
4. Dixon-Coles ξ time-decay + MLE (debt #25) — the *actually* margin-moving half of the DC 1997 paper. Depends on #26.
5. Dixon-Coles τ low-score correction (debt #24) — strictly a draw-Brier / scoreline-probability improvement. Math-proven zero impact on E[margin] and therefore on our primary ship gate; low priority until we care about 1X2-market calibration.

**Backlog (lower priority):**
- Position-weighted injury impact (QB 3x, star 1.5x, bench 0.5x) — biggest quality win on existing signal. Council debt #16.
- Run ratchet per sport via Actions workflow to regenerate artifacts with v5 + honest baselines.
- NHL goalie matchups — ESPN scoreboard doesn't include goalie data; need boxscore or external source.
- MLS/EPL draw-probability model (depends on the soccer v2 campaign above).
- Player stats scraper in cron (currently stale Sprint 5 ingest)
- Held-out v5 scale validation (fitted in-sample on backfill)
- Historical odds ingest (Kaggle / paid) to unlock real v4-spread ATS backtest
- Full lineup integration from official league APIs
- Second injury data provider (trigger: ≥3 ESPN failures/week for 2 weeks)

**Verification (captured at Sprint 10.7 end — 2026-04-14 17:33 UTC; Sprint 10.8 was modeling-only and did not change runtime state):**

| Check | Result | Status |
|-------|--------|--------|
| `/api/health` reachable | ✓ status:ok, 21,516 games, 21,364 results | PASS |
| `last_scrape_at` fresh | 2026-04-14T16:35:03 (~1h before check) | STALE — cron next at 22:00 UTC |
| v5 prediction has `home_out_impact` field | NO — current predictions pre-date the merge | PENDING — confirm after next cron |
| v4-spread prediction has `home_out_impact` field | NO — current predictions pre-date the merge | PENDING — confirm after next cron |
| Cloudflare Pages deploy ran on merge | NOT VERIFIED (no `gh` access from this session) | TODO next session |
| Fly API deploy ran on merge | NOT VERIFIED — but `/api/health` returns 200 | LIKELY OK, verify |

**Sprint 10.8 note:** PRs #26 (docs), #27-28 (baseline), #29 (soccer Poisson A/B) were all analysis / docs / pure-logic additions. None of them changed live-runtime code paths (predict-runner, spread-runner, scrapers, scheduler). The verification-table status above therefore carries forward unchanged; re-verify opportunistically next session but no new Sprint 10.8-introduced gaps.

**What this means for next session:**
1. Wait for or trigger the next predict cron, then re-check both upcoming prediction endpoints for `home_out_impact` in `reasoning_json.features`
2. If field still absent → check `gh run list --workflow=deploy-fly.yml` to confirm the merge deployed
3. If field present but always 0 → confirm the injury scrape is populating `player_injuries` (`SELECT COUNT(*) FROM player_injuries GROUP BY sport`)

### Key architecture (unchanged from Sprint 10.6)

- v5 is the active winner-prediction model (continuous sigmoid, replaces v2's 4 buckets)
- v4-spread is the active spread model (margin prediction vs bookmaker line)
- Predictions table has UNIQUE(game_id, model_version, prediction_source) — 3-column constraint
- Track record: v5 live + v2 backfill (backfill predates v5, shown as calibration baseline)
- Injury signal: 7-day recency filter on `first_seen_at` (persists across scrape cycles)
- v4-spread inherits same `INJURY_COMPENSATION = 0.4` factor as v5 (council debt #18 to fit separately)
- Deploy is automated: push to main → deploy-fly.yml + deploy-pages.yml
- Cron: 05:00 + 22:00 UTC — scrape all sports + odds + injuries → predict all sports → resolve outcomes

### Council governance reminder

5-expert council (Data Quality, Statistical Validity, Prediction Accuracy, Domain Expert, Mathematics Expert). **Every sprint MUST run:**
1. Plan review → iterate until CLEAR (or WARN with mitigations)
2. Implementation review → iterate if FAIL
3. Test/results review

User should never be the first reviewer. Mathematics expert only votes when calculation/model is involved. See `.harness/council/*.md`.

### Backtesting honesty (from Sprint 10.7 user pushback)

Three constraints that were conflated before:

| What | Status | Why |
|------|--------|-----|
| v4-spread vs historical bookmaker spreads | Cannot test | No historical odds data |
| Injury-adjusted vs naive on historical games | Cannot test | Injury data only exists from 2026-04-13 forward |
| v4-spread margin MAE on 12,813 backfill games | Can test, haven't | Filed P0 debt #13 |
| Forward A/B via shadow predictions | Can set up, haven't | Filed HIGH debt #14 |

**Key lesson:** v4-spread was shipped without baseline margin MAE. Don't ship a model without computing every backtest the existing data permits.

### Critical lessons that must not be relearned

- **Cloudflare Pages secrets.** The Pages GH Actions deploy silently failed for 4 days in Sprint 10.5 because `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` were never set. Always verify the live site reflects the commit. See `DEPLOY.md`.
- **v2 was a discrete classifier.** Only emitted 60% or 75%. Surfaced in Sprint 10 calibration plot. Replaced by v5 continuous sigmoid in PR #21.
- **Silent scrape failures.** Pre-Sprint 10.6, predict-cron hit a nonexistent `/api/trigger/scrape` behind `|| echo "non-fatal"`. Never mask cron failures.
- **Council discipline.** User has repeatedly mandated: plans → implementations → tests all reviewed by council. User should never be first reviewer.

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

### Sprint 10.7 session-handoff council review (PR #26)

After PR #26 was opened (the docs-only handoff), user reminded that even doc-only PRs run through council. Review:

- **Data Quality (6/10 WARN):** I claimed deploy/cron status without verifying. Fix: ran live curls during the review, documented actual state in the verification table — `last_scrape_at` stale (next cron 22:00 UTC), no `home_out_impact` field in current predictions yet (DB has pre-merge predictions; will populate after next cron).
- **Statistical Validity (8/10 CLEAR):** Mandate to audit "23 open debts" — performed, none silently resolved by merged code, debt #22 relabeled (v3 → v4-spread streak adjustments — same code, different model).
- **Prediction Accuracy (7/10 WARN):** Debt #13 was vague. Fix: spec'd as per-sport MAE+RMSE with bootstrap CI, two baselines (v0-margin = always home advantage, v3-margin = no injuries), pass criterion (improvement on ≥4/6 sports).
- **Domain Expert (7/10 WARN):** Fix: noted MLB pitcher ERA factor in v4-spread is intentional (not to "clean up"); added per-sport breakdown requirement to debt #13.
- **Mathematics:** sat out (no calculations).

Verdict after second round: 4× CLEAR. **SHIP.**

---

### Sprint 10.8 — Baseline with CIs + Soccer Poisson v1 Null + DC-Invariance Finding (2026-04-14)

Four PRs in one arc (#26 docs handoff, #27-28 closing debt #13, #29 soccer Poisson v1). All merged same day.

**Built across the four PRs:**
- **PR #26 (docs handoff, post-merge):** refreshed SESSION_LOG / session_state / DEPLOY / learnings to reflect post-#25 state; filed handoff-discipline lesson (validate main before writing handoff; council reviews docs-only PRs).
- **PR #27 (scaffold):** pure-logic `src/analysis/baseline.ts`, CLI at `src/cli/baseline.ts`, `npm run baseline` script, first artifact without CIs.
- **PR #28 (with CIs, ships as debt #13 closure):** added 1000-sample bootstrap CIs with paired model-minus-baseline diffs; rewrote headline claims after self-review caught Stats FAIL on point-estimates-without-uncertainty. Council CLEAR 5/5 after the fix. Artifact at `data/baselines/baseline-2026-04-14.{json,txt}`.
- **PR #29 (soccer Poisson v1):** `src/analysis/poisson.ts` + extended `baseline.ts` with Poisson A/B and draw-Brier. Council CLEAR on plan after 6 math/stats/domain corrections pre-implementation. Ran pre-declared A/B: per ship rule 3, **did NOT ship** as v4-spread replacement.

**Headline findings:**

*From baseline (PR #28):*

| sport | N | MAE − predict-zero (95% CI) | verdict |
|---|---|---|---|
| NBA | 5196 | −1.28 [−1.45, −1.12] | ✓ beats |
| NFL | 621 | −0.58 [−1.01, −0.15] | ✓ beats |
| MLB | 6270 | −0.04 [−0.07, −0.01] | ✓ beats (trivial effect) |
| NHL | 2832 | −0.07 [−0.10, −0.05] | ✓ beats (small effect) |
| MLS | 1159 | 0.00 [−0.05, +0.04] | ~ tie |
| EPL | 699 | +0.03 [−0.04, +0.09] | ~ tie |

*From soccer Poisson v1 (PR #29), 95% bootstrap paired-diff CIs:*

| League | Poisson MAE − predict-zero | Poisson MAE − v4-spread | Draw Brier − naive |
|---|---|---|---|
| MLS (N=1159) | −0.007 [−0.049, +0.032] ~ tie | −0.003 [−0.011, +0.005] ~ tie | −0.0023 [−0.0051, +0.0006] ~ tie |
| EPL (N=699) | +0.007 [−0.053, +0.067] ~ tie | **−0.019 [−0.036, −0.002] ✓ beats** | +0.0003 [−0.0033, +0.0044] ~ tie |

Primary ship gate (Poisson vs predict-zero) fails on both → per pre-declared rule 3, don't ship. Poisson improves on v4-spread for EPL but not enough to clear the predict-zero bar.

**Math-expert finding post-#29 (Sprint 10.8 council):**

When asked "Dixon-Coles next?" the math expert verified a result that invalidates the obvious interpretation of that next step. The DC τ correction modifies only 4 scoreline cells: (0,0), (0,1), (1,0), (1,1). For expected margin `E[H−A]`:

- (0,0) and (1,1) contribute `(i−j) = 0` regardless of τ → no effect on margin
- (0,1) contribution change: `−1 × λh·ρ × λa·e^(−λh−λa)`
- (1,0) contribution change: `+1 × λa·ρ × λh·e^(−λh−λa)`
- These cancel exactly: `−λh·λa·ρ·e^(−λh−λa) + λh·λa·ρ·e^(−λh−λa) = 0`

The DC normalizer `Z = ΣΣ τ(i,j)·P(i,j)` also works out to exactly 1 (the same symmetric cancellation). Therefore:

**E[margin]_DC = E[margin]_independent exactly; no renormalization needed; margin MAE under DC is guaranteed identical to margin MAE under independent Poisson.**

Implication: the naively-obvious "add Dixon-Coles τ and re-run PR #29" next step would, by math, produce bit-identical margin-MAE numbers — zero movement on our primary ship gate. DC τ's real value is scoreline-probability / draw-Brier calibration, not margin.

**What this reframed:**
- Debt #18 (flat "Dixon-Coles correction") was ambiguous between two 1997-paper ideas. Split into #24 (τ — low priority, draw-only) and #25 (ξ time-decay MLE — actually margin-moving).
- Correct next step for soccer-v2 campaign is NOT τ correction. It's pre-2024 data scrape (new debt #26) plus MLE fit with ξ time-decay (debt #25), then *optionally* τ on top for scoreline calibration.
- Parallel zero-risk infra: reliability diagrams (generalize debt #11). This is what the Sprint 10.8 council elevated to P0.

**Council deliberation post-#29 (Math, Stats, Prediction Accuracy, Data Quality, Domain) — 5/5 converged on:**
- DC τ as next PR: ship gate won't move (math-proven) → reject.
- Reliability diagrams next (generalizing debt #11 across 16,777-game baseline): zero regression risk, sharpens measurement for every future model → P0.
- Data lever > model lever for soccer: N=1159/699 is the bottleneck. Pre-2024 scrape unlocks 10+ seasons of EPL (3800+ games) and MLS, halving the minimum detectable effect.
- When soccer v2 is attempted: MLE + ξ time-decay (Dixon-Coles 1997 *other* contribution), on expanded corpus, with reliability instrumentation already in place. Optionally τ on top.

**Verdict: SHIP the four PRs, update debt list with the split, proceed to reliability-diagram infra next session.**

---

## Backlog (Post-Sprint 10.8)

See the **Next Session Pickup** block above for the prioritized next-task queue. This section is the canonical list of council debts.

### Council Debts (Open)

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
| 9 | Seed-stability test for v2 winning margin | Sprint 6 Skeptic | Low |
| 10 | Train/test shaded regions on ratchet chart | Sprint 6 Designer | Low |
| 11 | ~~Reliability diagrams across ALL sports from baseline corpus~~ | — | **CLOSED** by Sprint 10.8 implementation — `src/analysis/reliability.ts` + `npm run reliability` + `data/reliability/reliability-2026-04-15.{json,txt}`. Surfaced three actionable findings → spawned debts #27, #28, #29. |
| 12 | v5 sigmoid scale cross-validation on held-out data | Sprint 10.6i Math Expert | HIGH |
| 13 | ~~v4-spread margin MAE baseline on 12,813 backfill games~~ | — | **CLOSED** by PR #28 (bootstrap CIs, 16,777 games) |
| 14 | **Shadow-prediction logging**: for every live v4-spread pick, store the naive (no-injury) prediction alongside the adjusted one. Enables forward A/B after N≥30 resolved picks. | Sprint 10.7 Statistical Validity | **HIGH — before live track record stabilizes** |
| 15 | v5↔v4-spread injury consistency check (same sign on all games, post-merge) | Sprint 10.7 Mathematics | Medium |
| 16 | Position-weighted injury impact (QB 3x, star 1.5x, bench 0.5x) | Sprint 10.7 Domain Expert | Medium (biggest quality win) |
| 17 | Minimum-impact threshold (skip adjustment below 2 units) | Sprint 10.7 Prediction Accuracy | Low (refinement) |
| 18 | Fit INJURY_COMPENSATION separately for margin vs winprob | Sprint 10.7 Statistical Validity | After N≥200 resolved per model |
| 19 | Second injury data provider (criteria: ≥3 ESPN failures/week for 2 weeks) | Sprint 10.7 Data Quality | Watch metric |
| 20 | Historical odds ingest (Kaggle / paid feed) to enable ATS backtest | Sprint 10.7 Prediction Accuracy | HIGH — unlocks real v4-spread validation |
| 21 | ERA coefficient recalibration at N>200 (gated on live MLB sample) | Sprint 10.6c Domain Expert | Medium — gated |
| 22 | **v4-spread streak adjustments** (homeColdStreak −50% homeAdv, awayHotStreak −30% homeAdv) not empirically calibrated. (Originally filed against v3; v3 is rejected dead code, but the same streak logic moved into `predictMargin()` and is live in v4-spread.) | Sprint 10.6c Statistical Validity (relabeled Sprint 10.7) | Medium |
| 23 | Clamp [0.15, 0.85] Brier bias for NHL/soccer (Math expert noted in Sprint 10.6i) | Sprint 10.6i Math Expert | Low |
| 24 | **Dixon-Coles τ low-score correction** (split from old debt #18 — "Dixon-Coles"). Only affects draw-probability and specific scoreline probabilities. **Math-proven zero impact on E[margin] and therefore on margin MAE** — by symmetric cancellation across the 4 corrected cells (0,0)/(0,1)/(1,0)/(1,1). Value is scoreline / 1X2 market calibration only. Cannot improve PR #29's primary ship gate. | Sprint 10.8 Math + Prediction Accuracy | **LOW** — defer until 1X2 calibration is a ship-gate metric |
| 25 | **Dixon-Coles ξ time-decay + MLE fit** (split from old debt #18). The *actually* margin-moving half of Dixon-Coles 1997: weight recent matches more, fit α/β/μ_home by MLE over all history. Reduces estimator variance AND captures recent-form drift. Blocked on debt #26 (needs pre-2024 corpus). | Sprint 10.8 Math + Domain + Stats | **HIGH** (blocked on #26) |
| 26 | **Pre-2024 soccer match scrape** (new infra). FBref or Understat (Understat bundles xG, a sharper team-strength signal than actual goals). Unblocks proper train/test split AND larger N for MLE fitting. EPL ~3800 pre-2024 games (vs 699 currently), MLS ~1000+. Medium infra lift. | Sprint 10.8 Data Quality | **HIGH** — gating dependency for any serious soccer v2 |
| 27 | **NBA v4-spread home-advantage re-calibration.** Reliability artifact 2026-04-15 shows NBA margin is BIASED_HIGH with signedResid=−0.605 points uniform across all 20 populated bins (wMAE=0.957). Fix is a single-number shift to `SPORT_HOME_ADVANTAGE.nba` or the v4-spread home-diff formula. Smallest code change for a real model-accuracy improvement. | Sprint 10.8 Prediction Accuracy (surfaced by reliability diagrams) | **P1** — one-number fix, clear signal |
| 28 | **MLS/EPL v5 sigmoid scale re-calibration.** Reliability artifact 2026-04-15 shows v5 winner-prob is SHY on both soccer leagues (ECE ~0.05, signedResid +0.04). The sigmoid under-claims; 65-70% bins actually hit 70-80%+ accuracy. Tune `SIGMOID_SCALE.mls/epl` downward (sharper sigmoid) against baseline data. | Sprint 10.8 Prediction Accuracy (surfaced by reliability diagrams) | **P2** — affects soccer track record quality |
| 29 | **Ternary reliability for soccer Poisson** (P(home) / P(draw) / P(away) — deferred, separate design). Pointwise binning doesn't apply; needs Murphy decomposition or per-class reliability curves. Only worth building if 1X2 calibration becomes a priority. | Sprint 10.8 Math (deferred) | Low — gated on 1X2 market work |

**Audit performed Sprint 10.8 (council mandate):** All debts re-checked against current `main` after PR #29 merged. Debt #13 closed (PR #28). Debt #11 promoted to P0 and generalized (NBA-live → all-sport reliability diagrams from baseline). Old debt #18 "Dixon-Coles" (filed as single item in the PR #29 description) split into #24 (τ, math-proven zero margin impact) and #25 (ξ time-decay MLE, blocked on #26). Debts from earlier sprints have their original numbering preserved (#14-#23); new Sprint 10.8 debts are #24-#26.

### Council Debts Closed (in the last session)

| Item | Closed By |
|------|-----------|
| Calibration plot | Sprint 10 |
| Vegas baseline instrumentation | PR #12 (P2 fix) |
| Sport-specific v0 baseline (was using 1.0) | PR #8 (P0-4) |
| Draw handling for MLS/EPL | PR #8 (P0-2) |
| Resolver cross-namespace UNION | PR #8 (P0-3) |
| Season utility centralization | PR #8 (P0-5) |
| Automated SQLite backup | PR #8 (P0-1) |
| ESPN per-call retry jitter | PR #25 (ESPN injury scraper hardening) |
| Predictions for non-NBA sports | PRs #4, #7, #14 (all 6 leagues) |
| v2 discrete output bug (only 60/75% probabilities) | PR #21 (v5 sigmoid) |
| Debt #13 — per-sport margin MAE baseline with bootstrap CIs | PR #28 |
| Debt #11 — reliability diagrams across ALL sports from baseline corpus | Sprint 10.8 (reliability.ts + CLI; artifact 2026-04-15) |

### Deferred (no timeline)

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
- **MLE logistic regression** for sigmoid scale fitting (proper v6)

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

For an up-to-date list, use `git log --oneline main`. Major milestones:

```
PR #26 (this PR, OPEN) Session handoff doc refresh + handoff-discipline lesson
PR #25 v4-spread injury integration + scraper hardening + backtesting honesty
PR #24 Injury 502 fix + Codex fixes on #22 + session log refresh
PR #23 Session log: documented PRs #1-21 since Sprint 10.5
#22    Injury signal — ESPN scraper + v5 adjustment
#21    v5 continuous sigmoid model (replaces v2's 4 discrete buckets)
#14-16 Historical backfill + /api/trigger/backfill + Actions workflow
#8-13  Full codebase review (33/35 P0-P3 fixes)
#5-6   v4-spread margin model + MLB pitchers + findings math fix
#4     Global sport selector (all 6 leagues)
#2-3   Scrape pipeline repair
Sprint 10  Calibration plot (DISCRETE verdict)
Sprint 9   Mobile layout fixes
Sprint 8.5 Backfill + resolver cross-namespace fix
Sprint 8   ESPN hardening + Vegas baseline + hero polish
Sprint 7   Live predictions (cron + bearer auth)
Sprint 6   Ratchet loop first run (v2: 0.2486 Brier)
Sprint 5   Player stats for all 6 sports
Sprint 4   Interesting-things detector + web scaffold
Sprint 3   Game outcomes + team mappings + BDL
Sprint 2   SQLite + scheduler + CLI + Odds API
Sprint 1   Foundation scaffold
```

---

## Next Session Pickup Points

See the **🎯 Next Session Pickup** block at the top of this file — it is the authoritative handoff for the next session and is refreshed at session end.
