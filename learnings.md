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

### v4-spread-injury-integration (2026-04-14)
- **KEEP**: Same `INJURY_COMPENSATION = 0.4` factor applies cleanly to both win-prob (v5 sigmoid) and margin (v4-spread) — Bradley-Terry framework allows this
- **KEEP**: Per-player impact clamp prevents a single ESPN schema-drift outlier from blowing up the prediction (NBA 40 PPG, NFL 17 games, MLB 1.5 OPS, NHL/soccer 1.5-2.0)
- **KEEP**: UI surfaces `home_out_impact` / `away_out_impact` on spread cards when injury signal shifted the margin — users can see why tonight's pick changed
- **KEEP**: Soccer cards show "Injury-adjusted: no" disclaimer because we hard-disable injury fetching for MLS/EPL (no public lineup feed)
- **IMPROVE**: ESPN injury endpoint is undocumented and 404s unpredictably — added 3-attempt retry with exponential backoff (500ms → 1s → 2s ± 25% jitter) + 10s timeout per attempt. Retries 5xx only (4xx is deterministic).
- **IMPROVE**: Codex caught a runtime ReferenceError — I referenced `reasoning.features` but the parsed object was scoped to `rj` inside try/catch. Hoisted to function scope with optional chaining.
- **CRITICAL**: User pushback on "we're not backtesting" forced me to distinguish CAN'T-test vs HAVEN'T-tested:
  - CAN'T: ATS performance (no historical odds), injury-adjusted vs naive historically (no historical injury data)
  - HAVEN'T: v4-spread margin MAE on 12,813 backfilled games (we have final scores, never measured baseline)
  - **Filed P0 debt #13** — should have done this when v4-spread shipped. Don't conflate constraints with omissions.
- **CRITICAL**: When extending an existing model, compute every backtest the existing data permits BEFORE shipping. The new feature inherits all existing measurement gaps.

### injury-source-research (2026-04-14)
- **CONFIRMED DEAD-END**: NBA.com and NFL.com don't expose public JSON injury APIs (404 / HTML-only)
- **CONFIRMED DEAD-END**: basketball-reference returns 403 to programmatic UA (would need spoofing + HTML parser, not worth it for secondary signal)
- **CONFIRMED DEAD-END**: CBS Sports injury page is HTML-rendered, scrapable but blocks
- **DECISION**: Hardened ESPN (only working free source for NBA/NFL/MLB/NHL); filed concrete trigger criterion ("≥3 ESPN failures/week for 2 consecutive weeks" → debt #19) for when to invest in alt sources
- **INSIGHT**: TheOddsAPI player props could serve as orthogonal injury signal (missing prop = market thinks player out) — would require storing prop snapshots across cycles, deferred to backlog
- **INSIGHT**: Soccer (MLS/EPL) lineup data is released ~1hr before kickoff by clubs — no good free feed exists; injury signal honestly disabled for these leagues

### session-handoff-discipline (2026-04-14, hard-won lesson)

User pushback after a botched session-end handoff. Capturing both rules so they outlive context windows.

**Rule 1: Validate main before writing any handoff doc.**

I wrote a session-close-prep that listed PRs #24 and #25 as OPEN with merge instructions. Both had been merged ~30 minutes earlier. Cause: I was operating from local branch state and never ran `git fetch origin main` + `git log origin/main..HEAD` before writing the handoff. The session log, session_state.json, DEPLOY.md, and the priority queue all had to be rewritten because they referenced a branch state that no longer existed.

**Concrete checklist for session close:**
1. `git fetch origin main` then `git checkout main && git pull` to sync local
2. For every PR I'm aware of in this session: `mcp__github__pull_request_read get` to confirm `state` and `merged` flags
3. THEN write the handoff doc against the *post-merge* state
4. The "Next Session Pickup" block should describe what the world looks like for someone walking up cold — not what was true an hour ago on my branch

**Rule 2: Check PR status before stacking commits.**

I pushed a "session handoff" commit to `claude/injury-v4-and-alt-sources` after PR #25 had already been merged. The commit was orphaned — it lived on the branch but was never going to land on main without a separate PR. Cause: I assumed the PR was still open because that's where it was when I started writing the doc.

**Concrete rule:**
- Before `git push` to any feature branch, run `mcp__github__pull_request_read get` on the PR for that branch
- If `merged: true`, do NOT push more commits to the branch — they will be orphaned
- Either: (a) cherry-pick onto main directly (only with explicit user permission), or (b) create a new branch from current main and open a fresh PR

**Bonus rule: A "session close" is itself a deliverable that must be reviewable.**

Session-close docs are not exempt from review. They drive the next session. If they reference orphaned commits, stale branches, or merged-but-listed-as-open PRs, the next session starts confused. Treat the handoff as carefully as production code.

**Rule 3: Council reviews docs-only PRs too. There is no exception.**

User reminder after I tried to ship PR #26 without council review: "You forgot to run everything past council." The locked council protocol says EVERY plan, EVERY implementation, EVERY test. Doc-only PRs are implementations of communication; they affect every future session. Math expert sits out (no calculations) but the other four reviewers must always weigh in.

Council on PR #26 surfaced THREE real issues I missed:
- Data Quality: I claimed deploy status without verifying — same class of error as the original handoff botch, just at a different layer (deploy state vs merge state). Mandate forced me to actually `curl /api/health`, find that `last_scrape_at` is stale and no predictions yet have `home_out_impact`, and document the real state instead of the assumed state.
- Prediction Accuracy: Debt #13 said "compute MAE" without specifying metrics, baselines, or pass criterion — the next session would have shipped a number with no statistical bounds. Mandate forced refinement: per-sport MAE+RMSE, bootstrap CI, two baselines, ≥4/6 sport pass criterion.
- Domain Expert: I described the v4-spread model without noting MLB pitcher ERA is intentional. A future session might "clean up" the MLB-specific code without realizing it's load-bearing.

**Concrete rule:** Before opening any PR (including docs/config/learnings), run a council pass. If 4× CLEAR, ship. Otherwise iterate. Math expert sits out for non-computational changes per their persona spec.

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

### per-sport-baseline-debt13 (2026-04-14)

Computed per-sport margin MAE / RMSE / bias / Brier / winner accuracy on 16,777 post-2023 held-out games across all 6 sports, with naive baselines (predict-zero, predict-home_advantage, constant-home-rate). Closes council debt #13. Artifact: `data/baselines/baseline-2026-04-14.{json,txt}`.

**In-sample caveat up-front**: sigmoid_scale, home_advantage, and win-gap bucket constants were calibrated against this same data. The 80/20 date split is a fingerprint, not a clean out-of-sample test. Numbers below are the parameters' best-case performance.

**Headline per-sport table** (all slices):

| sport | N | MAE | nv0MAE | lift vs zero | Winner acc | Brier | nvBr | lift vs naive |
|------|------|------|--------|--------------|------------|-------|------|---------------|
| NBA  | 5196 | 11.67 | 12.96 | **9.9%** | 63.1% | 0.2258 | 0.2477 | 8.8% |
| NFL  |  621 | 10.70 | 11.28 | 5.1% | 63.1% | 0.2320 | 0.2487 | 6.7% |
| MLB  | 6270 |  3.48 |  3.52 | **1.1%** | 56.0% | 0.2449 | 0.2485 | **1.4%** |
| NHL  | 2832 |  2.16 |  2.23 | **3.1%** | 55.6% | 0.2444 | 0.2482 | **1.5%** |
| MLS  | 1159 |  1.35 |  1.35 | **0.0%** | 63.1% | 0.2281 | 0.2417 | 5.6% |
| EPL  |  699 |  1.36 |  1.33 | **-2.3%** | 66.0% | 0.2140 | 0.2474 | 13.5% |

- **KEEP**: `data/baselines/baseline-<date>.json` as the reference point — every future tweak measured against this file
- **KEEP**: Naive baselines (predict-zero, predict-home_adv, constant-home-rate) in the report — a bare MAE/Brier number is meaningless without them
- **KEEP**: 80/20 date split per sport — fingerprint slice for future tweak A/B
- **KEEP**: Honest disclosure banner in `baseline.ts` header — in-sample numbers must be flagged as such or they will be overinterpreted
- **KEEP**: Bias column near zero across all sports (max |bias|=0.60 NBA) — MAE is variance-dominated, not shift-correctable. Don't waste a sprint tuning home_advantage; the gains would be <1 MAE point.

**Findings that drive the next per-sport tweaks:**
- **CRITICAL**: EPL margin model is **worse than predict-zero** (MAE 1.36 vs 1.33 nv0MAE). MLS ties predict-zero (1.35 = 1.35). Confirms the council's math-expert verdict: binary sigmoid applied to a ternary outcome is the wrong structural model for soccer. **Poisson/Skellam is not optional** — the current model is actively losing to a constant.
- **CRITICAL**: MLB and NHL are the worst-performing sports on the winner side — accuracy 56.0% and 55.6%, barely above naive base rates. Brier lift vs naive: 1.4% MLB, 1.5% NHL. These sports beat the "always pick home at base rate" reference by a whisker. Top targets for per-sport knob tweaks.
- **CONFIRMED**: EPL's 13.5% winner Brier lift is the largest in the dataset — the v5 sigmoid *is* picking up real team-strength signal in soccer, even while the margin model is structurally broken. Two separate problems.
- **INSIGHT**: NBA wins-vs-naive gap (8.8% Brier, 9.9% MAE) is the upper bound of what a well-tuned generic sigmoid gets on a high-variance sport. Further gains in NBA/NFL likely require structural features (rest, travel, back-to-backs), not parameter sweeps.

**Sequencing implication for next sprint:**
1. **MLS + EPL Poisson/Skellam model** (expected MAE drop: the naive-zero gap closes, draws become a real output). Math expert CLEAR, domain CLEAR. This is the clear next step.
2. Once soccer is restructured, MLB and NHL tweaks (INJURY_COMPENSATION principled sweep + possibly scale refinement). Expected lift: small, needs holdout discipline.
3. **DO NOT** touch NBA/NFL parameters — they're already at a sensible local optimum for the current feature set; further tweaks risk overfitting to the same backfill.

- **INSIGHT**: MAE naive-zero baseline is a devastating sanity check. Every margin model should be required to beat it, and EPL's failure would not have surfaced without it. Filed as a ratchet criterion for future margin models: if the new model doesn't beat predict-zero on >4/6 sports, don't ship.
- **INSIGHT**: "Compute every backtest the existing data permits BEFORE shipping" (previous session's lesson) paid off immediately — the EPL-worse-than-zero finding was undetectable from aggregate Brier or winner-accuracy numbers alone. Per-sport naive baselines are where failures live.

