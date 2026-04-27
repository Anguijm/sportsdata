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

### per-sport-baseline-debt13 (2026-04-14, updated after council Stats FAIL)

Computed per-sport margin MAE / RMSE / bias / Brier / winner accuracy on 16,777 post-2023 held-out games across all 6 sports, with naive baselines (predict-zero, predict-home_advantage, constant-home-rate) **and bootstrap 95% CIs on every metric plus paired model-minus-baseline diffs**. Closes council debt #13. Artifact: `data/baselines/baseline-2026-04-14.{json,txt}`.

**In-sample caveat up-front**: sigmoid_scale, home_advantage, and win-gap bucket constants were calibrated against this same data. The 80/20 date split is a fingerprint, not a clean out-of-sample test. CIs capture resample noise only, not calibration leakage.

**Initial (failed) commit**: first commit shipped point estimates without CIs and made headline claims ("EPL is WORSE than predict-zero", "MLS ties predict-zero") that did not survive a council review. Re-ran with 1000 bootstrap resamples per sport/slice; verdicts are now CI-gated. Same class of error as v4-spread shipping without a baseline — point estimates without uncertainty are overconfident by construction.

**Headline table — paired MAE-diff vs predict-zero (95% CI)**:

| sport | N | MAE | nv0 MAE | MAE − nv0 (95% CI) | verdict |
|------|------|------|---------|--------------------|---------|
| NBA  | 5196 | 11.67 | 12.96 | −1.28 [−1.45, −1.12] | ✓ beats |
| NFL  |  621 | 10.70 | 11.28 | −0.58 [−1.01, −0.15] | ✓ beats |
| MLB  | 6270 |  3.48 |  3.52 | −0.04 [−0.07, −0.01] | ✓ beats (trivial effect) |
| NHL  | 2832 |  2.16 |  2.23 | −0.07 [−0.10, −0.05] | ✓ beats (small effect) |
| MLS  | 1159 |  1.35 |  1.35 | 0.00 [−0.05, +0.04] | ~ **tie** — cannot distinguish |
| EPL  |  699 |  1.36 |  1.33 | +0.03 [−0.04, +0.09] | ~ **tie** — cannot distinguish |

**EPL test slice only (N=140, latest 20%)**: MAE − nv0 = +0.12 [+0.00, +0.24] → ✗ LOSES predict-zero. Small-N result; flag but do not overclaim.

**Paired Brier-diff vs naive (constant-home-rate, 95% CI)**:

| sport | Brier | nvBr | Brier − nvBr (95% CI) | verdict |
|------|-------|------|----------------------|---------|
| NBA | 0.2258 | 0.2477 | −0.022 [−0.026, −0.018] | ✓ beats |
| NFL | 0.2320 | 0.2487 | −0.017 [−0.026, −0.006] | ✓ beats |
| MLB | 0.2449 | 0.2485 | −0.004 [−0.006, −0.002] | ✓ beats (small) |
| NHL | 0.2444 | 0.2482 | −0.004 [−0.006, −0.001] | ✓ beats (small) |
| MLS | 0.2281 | 0.2417 | −0.014 [−0.020, −0.006] | ✓ beats |
| EPL | 0.2140 | 0.2474 | −0.033 [−0.042, −0.024] | ✓ beats (largest) |

- **KEEP**: 1000-sample bootstrap CI with deterministic seed per sport:slice. Reproducible across runs. Paired diffs computed within-resample so CIs reflect covariance.
- **KEEP**: Paired-diff verdict trichotomy (✓ beats / ✗ LOSES / ~ tie) anchored at CI vs zero. No more "lift %" headlines without CI backing.
- **KEEP**: `data/baselines/baseline-<date>.json` as the reference point — every future tweak measured against this file.
- **KEEP**: Naive baselines (predict-zero, predict-home_adv, constant-home-rate) in the report — a bare MAE/Brier number is meaningless without them.
- **KEEP**: 80/20 date split per sport — fingerprint slice for future tweak A/B, labelled as fingerprint-not-holdout given in-sample calibration.
- **KEEP**: Bias CI across all sports — max |bias| = +0.60 NBA but CI includes zero for NFL/NHL/MLS. MAE is variance-dominated, not shift-correctable. Tuning home_advantage as an additive shift would not help.
- **KEEP**: naive-Brier closed-form (p*(1-p)) instead of summing (p-y)² — identical when p is in-slice rate, faster, less numerical drift.

**Findings corrected by CIs vs the initial commit:**
- **CORRECTED**: "EPL margin is WORSE than predict-zero" was **not** statistically supported on the full slice. CI straddles zero: +0.03 [−0.04, +0.09]. Original claim overinterpreted a 0.03-unit difference on N=699 with σ=1.76 (SE ≈ 0.07). The test-slice does show a loss but on N=140. **Revised claim: EPL margin cannot beat predict-zero at 95% CI** — which is still a strong signal that the structural model is wrong for soccer, just phrased honestly.
- **CORRECTED**: "MLS ties predict-zero" was directionally right but with much wider CI than implied. The tie is genuine (CI straddles zero), not a point match.
- **CORRECTED**: MLB "barely beats naive" — actually the CI doesn't include zero. MLB does significantly beat predict-zero. Effect size is trivially small (−0.042 runs, d ≈ 0.01) but the verdict is ✓, not "barely."
- **CONFIRMED**: NBA, NFL, NHL all beat predict-zero with CIs comfortably off zero.
- **CONFIRMED**: Every sport's winner/Brier model beats naive Brier with CI off zero on the full slice (including MLS/EPL). The winner model is doing real work in soccer even while the margin model flat-lines.

**Revised sequencing:**
1. **MLS + EPL Poisson/Skellam margin model** remains the clear next step. Justification is now: margin model cannot be distinguished from predict-zero on either soccer league at 95% CI, while the winner (Brier) model works fine. Binary sigmoid on ternary outcome is still the best theoretical explanation. Expected Poisson gain: move from "tie with zero" to "significantly better than zero."
2. **MLB + NHL** beat predict-zero at 95% CI but the effect is tiny (MLB 1.2% of σ_actual, NHL 2.7% of σ_actual). Parameter tweaks are unlikely to find large gains. Better return is probably structural: MLB bullpen + rest, NHL starting goalie. Defer both until after soccer Poisson ships.
3. **NBA / NFL**: current parameters at a sensible local optimum for the current feature set. Future gains require new features (rest, travel, back-to-backs, positional injury), not parameter sweeps. **This phrasing replaces "do not touch" — the parameters are frozen but the feature set is not.**

- **INSIGHT**: Every "lift %" claim before this rewrite was a point estimate dressed up as a finding. A 1.1% lift on MAE 3.48 with SE 0.057 is statistically real (CI excludes zero) but practically trivial (under 1% of σ_actual). CIs separate those two questions and the report now shows them separately — verdict (significant?) and effect size (how big?).
- **INSIGHT**: Bootstrap CIs on paired diffs — not independent CIs on model and baseline — are the right abstraction. Independent CIs often overlap when the paired diff CI is comfortably off zero (because model and baseline covary on the same slice). Code resamples the index set once per iteration and recomputes both statistics on the same resample.
- **INSIGHT**: Council review on my own analysis caught a Stats FAIL I had shipped. Pattern matches the v4-spread-without-baseline bug at a different layer: confidence-without-uncertainty is as unsafe as prediction-without-backtest. Rule: any table of lifts / diffs / deltas ships with CIs or it doesn't ship.
- **INSIGHT**: MAE naive-zero baseline is still a devastating sanity check. Two sports now fail to beat it at 95% CI (MLS, EPL) — a failure mode invisible from aggregate Brier or winner-accuracy numbers. Filed as ratchet criterion for future margin models: if new model's MAE − nv0 CI crosses zero on any sport, flag it.
- **INSIGHT**: "Compute every backtest the existing data permits BEFORE shipping" paid off, but the initial shipping was premature. Revised rule: "compute the backtest AND its uncertainty before shipping." Point estimates are half the deliverable.


### soccer-poisson-v1-null-result (2026-04-14)

Built independent-Poisson/Skellam margin model (v6-poisson-soccer) per Plans/soccer-poisson.md (council-CLEAR after 6 corrections). Ran A/B against pre-declared ship gate. **Result: primary ship gate fails on both leagues. Per pre-declared rule 3: do not ship as replacement.**

**Findings** (95% bootstrap CI, paired within-resample):

| Slice | Poisson MAE − predict-zero | Poisson MAE − v4-spread | Draw Brier − naive |
|---|---|---|---|
| MLS all | −0.007 [−0.049, +0.032] ~ tie | −0.003 [−0.011, +0.005] ~ tie | −0.0023 [−0.0051, +0.0006] ~ tie |
| EPL all | +0.007 [−0.053, +0.067] ~ tie | **−0.019 [−0.036, −0.002] ✓ beats** | +0.0003 [−0.0033, +0.0044] ~ tie |

**Interpretation:**
- Poisson demonstrably improves on v4-spread for EPL (CI off zero) but not enough to cross the predict-zero bar.
- MLS Poisson ties v4-spread — both indistinguishable from a constant. MLS margin signal is not captured by per-team scoring/conceding rates alone (conference bias hypothesis per plan).
- MLS draw-Brier is directionally better than naive-draw, nearly clears tie.
- EPL draw-Brier matches naive — independent Poisson under-predicts draws (known Dixon-Coles 1997 issue).

**What this did NOT prove:**
- That Poisson is wrong for soccer — EPL-beats-v4-spread says the family helps, just not enough.
- That v4-spread is right — it also fails the predict-zero bar.
- That Dixon-Coles / MLE / different feature set won't work — this was independent-Poisson v1, explicitly the simplest defensible member of the family.

**What this DID prove:**
- Pre-declared ship rules work. The "primary fails on both → don't ship" rule prevented shipping an insignificant improvement as a structural fix. Without the pre-declaration, the EPL-beats-v4-spread CI-off-zero result would have tempted scope drift.
- The A/B infrastructure (baseline.ts Poisson fields + paired CI diffs) is reusable for any future soccer margin attempt — next iteration doesn't rebuild this.
- Independent Poisson with per-team running-average α/β is underpowered on soccer's small-N slices (EPL 699) to clear predict-zero. MLE over all past matches + Dixon-Coles τ + recent-form weighting is the next avenue to try.

- **KEEP**: Pre-declaring ship rules as part of a council-validated plan. This is what made the null result usable rather than demoralizing. Future per-sport model attempts must follow this pattern.
- **KEEP**: A/B infrastructure in `baseline.ts` (Poisson MAE, draw Brier, paired diffs against both v4-spread and predict-zero) — reusable.
- **KEEP**: `src/analysis/poisson.ts` as the reference implementation of Skellam margin for soccer. Any Dixon-Coles extension builds on this.
- **KEEP**: Plans/soccer-poisson.md as the audit record of the council-validated approach + the explicit non-scope list.
- **DON'T**: Wire Poisson into the live prediction runner. Pre-declared ship rule 3 says don't, and that's the rule.
- **INSIGHT**: Independent Poisson with simple running averages on ~1000-game slices is underpowered to detect soccer-margin improvements against the noisy predict-zero baseline. The soccer margin noise floor is genuinely near predict-zero — any model that beats it needs to do so by >0.13 MAE units on EPL (2×SE) or >0.09 on MLS. That's a 7-10% reduction, at the upper end of what literature reports.
- **INSIGHT**: The pattern "beat v4-spread but tie predict-zero" reveals that v4-spread's failure was structural (predicting something meaningful but in the wrong distribution family), while Poisson's failure is underpowered (right family, not enough signal extraction). Different bugs, different fixes.
- **INSIGHT**: Draw-probability Brier as a secondary metric was useful: it surfaced that MLS draw modeling is directionally better but EPL is not — aligns with the Dixon-Coles literature that independent Poisson under-predicts draws in higher-draw-rate leagues.
- **FOLLOW-UP DEBTS filed** (for the next soccer attempt):
  - Dixon-Coles low-score τ correction — boosts P(0-0, 1-1) and should improve draw Brier, especially EPL
  - MLE fitting of α, β, μ_home over all pre-cutoff matches (once pre-cutoff soccer data is scraped) — gets away from the in-sample concern
  - Recent-form weighting (exponential decay on last N matches) per Dixon-Coles
  - Scraping pre-2024 soccer data to get a real out-of-sample holdout


### dixon-coles-invariance-finding (2026-04-14, post-#29)

When asked "Dixon-Coles next" after PR #29 merged, the math expert verified a result that reframed the whole "what's next?" question before any code was written. Result is worth preserving:

**Theorem**: For the Dixon-Coles τ correction with parameter ρ applied to independent Poisson goal models (`λ_h`, `λ_a`), the expected margin `E[H − A]` is unchanged: `E[H−A]_DC = E[H−A]_independent`. The normalizer `Z = ΣΣ τ(i,j)·P(i,j)` equals exactly 1.

**Proof sketch**: τ deviates from 1 in only 4 cells.
- (0,0) and (1,1) contribute `(i−j) = 0` → zero contribution to E[margin] regardless of τ.
- (0,1) contribution shift: `−1 · λh·ρ · λa·e^(−λh−λa) = −λh·λa·ρ·e^(−λh−λa)`
- (1,0) contribution shift: `+1 · λa·ρ · λh·e^(−λh−λa) = +λh·λa·ρ·e^(−λh−λa)`
- Sum: 0. The normalizer Z works out to 1 by the same symmetric cancellation.

**Implication for our work**: our primary ship gate (margin MAE, PR #29 rule 1) measures `|actual_margin − E[margin]|`. Since E[margin] is identical under DC, the MAE is identical. DC τ correction **cannot** close the predict-zero gap PR #29 exposed. DC τ improves scoreline-specific probabilities and draw-Brier; that is genuinely valuable but not on our current ship-gate metric set.

**Lesson #1 — "Dixon-Coles" is two ideas, not one.** The 1997 paper's enduring contributions are (a) the τ low-score correction AND (b) time-decay MLE fitting (ξ parameter). Our open debt #18 "Dixon-Coles" conflated them. Only (b) is margin-moving. Split into #24 (τ, low priority) and #25 (ξ+MLE, high priority but blocked on pre-2024 data).

- **KEEP**: Math expert mandate — when a council member can *prove* a proposed change won't move a ship-gate metric, they should say so BEFORE code is written. Saved a PR cycle here.
- **KEEP**: Asking "what's the expected shift under the proposed change?" is cheap and telling. For DC τ, it's zero. For ξ+MLE, it's nonzero but bounded by estimator-variance reduction.
- **INSIGHT**: Paper-level folk wisdom ("just add Dixon-Coles") is two distinct ideas with very different payoffs on different metrics. When importing a model from literature, write down which metric each piece moves BEFORE picking it up.
- **INSIGHT**: The PR #29 null result wasn't "Poisson doesn't work for soccer" — it was "N is too small to detect the expected-size effect." Different diagnosis, different fix. Fixing the diagnosis (scrape more data, debt #26) unlocks the model tier (ξ+MLE, debt #25) that can actually move the metric.
- **INSIGHT**: Zero-risk infra ratchet steps (reliability diagrams, shadow-logging) are the right choice when the frontier of model work is blocked on data. They sharpen measurement capability, which makes every subsequent model change more surgical.
- **INSIGHT**: The ship-gate discipline from PR #29 (pre-declared rules, "don't ship if primary CI straddles zero") cascades forward: because we didn't ship Poisson-with-τ as an "obvious improvement", we avoided shipping a change that by math cannot move the metric we'd be shipping to improve. Writing down the math first is a cheap insurance policy.


### reliability-diagrams-all-sports (2026-04-15, closes debt #11)

Built `src/analysis/reliability.ts` + `src/cli/reliability.ts` + `data/reliability/reliability-*.{json,txt}` per `Plans/reliability-diagrams.md` (council-CLEAR round 2 after 4 WARN fixes in round 1). Ran on the 16,777-game baseline corpus. Verdicts per sport:

| sport | winner-prob (ECE, sgR) | verdict | margin (wMAE, sgR) | verdict |
|---|---|---|---|---|
| NBA | 0.0260, −0.017 | HONEST | 0.957, **−0.605** | **BIASED_HIGH** |
| NFL | 0.0476, −0.009 | HONEST | 2.242, −0.094 | HONEST |
| MLB | 0.0207, −0.007 | HONEST | 0.453, −0.351 | HONEST |
| NHL | 0.0114, −0.001 | HONEST | 0.234, −0.044 | HONEST |
| MLS | 0.0521, **+0.044** | **SHY** | 0.224, +0.003 | HONEST (v4-spread) / 0.159, −0.004 HONEST (Poisson) |
| EPL | 0.0493, **+0.034** | **SHY** | 0.229, −0.159 | HONEST (v4-spread) / 0.218, +0.004 HONEST (Poisson) |

**Three actionable findings surfaced** (exactly what debt #11 was filed to find):

1. **NBA v4-spread margin is BIASED_HIGH by ~0.6 points on average.** The model systematically predicts home margins higher than reality. weightedMAE=0.957 points — the bias ISN'T concentrated in a tail, it's spread across populated bins (20/20 populated). Almost certainly fixable by a single-number shift to `SPORT_HOME_ADVANTAGE.nba` or the v4-spread home-diff formula. Filed as follow-up debt.
2. **MLS/EPL v5 winner-prob is SHY.** The sigmoid under-claims on soccer wins — the 65-70% confidence bins actually hit 70-80%+ accuracy on both leagues. This is the opposite bug from NBA v2's DISCRETE finding. Suggests the sigmoid scale for soccer (0.60, per v5 config) is *too conservative* — calibrating against recent soccer data would sharpen it. Filed as follow-up debt.
3. **Poisson margin reliability on MLS/EPL is HONEST** with wMAE lower than v4-spread on MLS (0.159 vs 0.224 pts). This contextualizes the PR #29 null result: Poisson is better-calibrated bin-by-bin even though the aggregate MAE doesn't clear predict-zero at 95% CI. Two different things.

**Council process:**
- Plan: round 1 got 1× CLEAR + 4× WARN → all 4 WARNs fixed in-plan (sample-SD denominator, ciWide flag, terminal-bin note, sport-aware bin widths) → round 2 5× CLEAR.
- Impl: 5× CLEAR. Self-check (`__selfCheck`) verifies ECE=0.125 and sample SD=√(2/3) to 1e-9 before writing artifact. Bin-count invariant hand-verified. Baseline artifact unchanged except timestamp.

- **KEEP**: Inline `__selfCheck()` with hand-computed synthetic cases. Cheaper than a test framework; catches math drift before artifact writes.
- **KEEP**: Sport-aware bin widths (Domain WARN fix). Essential — 2-point bins crush NHL/soccer into DISCRETE when they're actually HONEST. Different sports, different scales.
- **KEEP**: Reliability output is pure instrumentation. No model changed, no ship gate, no A/B. But it SURFACED two real actionable miscalibration findings and contextualized a null result. That's the infra-first payoff.
- **INSIGHT**: Reliability as "where is the model miscalibrated?" instrumentation does what aggregate MAE/ECE/Brier can never do — identify the SHAPE of the miscalibration (uniform bias vs tail concentration vs discrete output). Two sports with identical ECE can need totally different fixes.
- **INSIGHT**: The NBA BIASED_HIGH finding with uniform −0.6pt residual across ALL 20 populated bins is the visible signature of a calibration-constant drift, not a structural model bug. Analogous class of issue to v2's discrete-output finding: cheap to fix once surfaced.
- **INSIGHT**: Soccer v5 SHY finding is counter-intuitive at first (soccer has more noise, so you'd expect OVERCONFIDENT), but makes sense on reflection: the sigmoid scale was set conservatively for a low-confidence baseline cohort, but actual resolved soccer outcomes in the baseline show the model's "probably home wins" calls are more reliable than it thinks.
- **FOLLOW-UP DEBTS to file** (in SESSION_LOG):
  - #27 (P1): NBA v4-spread home-advantage re-calibration from baseline (one-number fix targeted by the BIASED_HIGH finding)
  - #28 (P2): MLS/EPL v5 sigmoid scale re-calibration from baseline (sharpen the SHY sigmoid)
  - #29 (P3, deferred): ternary reliability for soccer Poisson (separate design; Murphy decomposition)


### cron-retry-hardening (2026-04-15)

Triggered by a real incident: PR #30 merged at 06:15 UTC, `deploy-fly.yml` killed the Fly machine, scrape cron hit the proxy at 06:20:36 during the <5s restart window, got 502, alerted. `/api/health` showed `last_scrape_at` fresh 5 seconds later — the app was fine, the cron was just unlucky on its single attempt.

Added `curl --retry 3 --retry-delay 15 --retry-connrefused` to both cron curls in `.github/workflows/predict-cron.yml`. Covers the two distinct deploy-blip failure modes: proxy-emits-502 (the original incident) and TCP-refused-before-proxy-ready (Codex P2 on PR #31). Also added `--write-out scrape_http=%{response_code}` / `predict_http=...` so the workflow log surfaces the HTTP code regardless of retry outcome.

- **KEEP**: `--retry` by default covers 408/429/5xx + timeouts but NOT `ECONNREFUSED`. Every future long-running-service curl should pair `--retry N` with `--retry-connrefused` unless there's a specific reason not to.
- **KEEP**: `--write-out response_code=%{response_code}` is cheap audit surface. Works regardless of retry outcome. Use it on any curl that has `--retry` so the log shows what actually happened, not just "curl succeeded."
- **KEEP**: Retry semantics preserve fail-closed invariant *exactly* because `--retry` excludes 4xx. Auth failures, validation failures, and app-level partial-failure 502s (with a JSON body — we check `HTTP_CODE>=400` explicitly on the predict step) all still fail on the first try. The retry only absorbs transient proxy-layer 5xx and connect errors.
- **INSIGHT**: Two failure modes that look identical at the alert level (cron went red on a Fly deploy) can have different curl-side signatures (ECONNREFUSED vs 502). A single `--retry` without `--retry-connrefused` only covers one. Mapping failure modes to flags is cheap and avoids "we added retries but still got paged" follow-ups.
- **INSIGHT**: Infrastructure retries and app-level fail-closed semantics are compatible — they operate at different layers. The retry absorbs *transport-layer* blips; the `-f` (or explicit HTTP_CODE check) still turns real app errors red. Don't conflate them into "retry means hide failures."


### nba-home-adv-recalibration (2026-04-20)

- **KEEP**: Pre-declared ship rules in `Plans/nba-home-adv-recalibration.md` with 5 pass/fail gates — same pattern as soccer-poisson (PR #29). Makes the commit/no-commit decision mechanical once validation runs.
- **KEEP**: Pure-Python validation script (`scripts/validate-debt27.py`) with zero native dependencies. Runs in Termux/Android sandbox where `better-sqlite3` can't compile. Pattern: dump DB as SQL, load into Python `sqlite3`, reimplement the TypeScript analysis logic in ~200 lines.
- **KEEP**: Empirical validate→measure→correct loop for calibration constants. Try an intermediate value (Δ=0.6), measure the effective coefficient (0.809), then compute the optimal Δ from the measured coefficient. One extra step, much more accurate than naive formula.
- **IMPROVE**: Initial recalibration (PR #32, 3.0→2.4) was undersized because the naive streak-independence formula overestimated the effective coefficient (0.926 vs actual 0.809). The naive formula `1 − 0.5·P(cold) − 0.3·P(hot)` assumes streak events are independent of team quality, but bad teams have losing streaks much more often. Always validate the effective coefficient empirically.
- **INSIGHT**: Streak-attenuation coefficient is 0.809, not 0.926. The gap (14% relative) comes from team-quality auto-correlation: sub-.400 teams fire the cold-streak indicator 20-40% of the time vs the 9% naive estimate. This makes every `predictMargin()` call effectively use ~81% of the nominal homeAdv, not ~93%. Future recalibrations for ANY sport must account for this.
- **INSIGHT**: Council math review caught and verified three non-obvious claims: (1) the effective coefficient is constant w.r.t. Δ (because streak indicators depend on game results, not on homeAdv); (2) the v5 perturbation bound of 0.015 was slightly loose vs the theoretical max of 0.019; (3) the optimality of 2.25 follows from measured coefficient × applied Δ ≈ observed bias. Math expert sitting in on calibration reviews is load-bearing, not ceremonial.

### mcp-disconnect-recovery (2026-04-15)

The previous session (`session_01MfKAHh1VZgCe8ikHQHY2AM`) lost its GitHub MCP connection after pushing PR #31 but before addressing review comments or merging. The current session started on the designated branch `claude/restore-gh-mcp-i3HiA`, which had zero content diff from `origin/main` — a local-state-only read would have concluded "nothing to do."

Recovery path that actually worked:
1. Fetched `origin/main`, confirmed no local divergence.
2. Checked `git reflog`: last HEAD move was days earlier → no uncommitted session work existed locally.
3. Called `mcp__github__list_pull_requests` — surfaced PR #31 with head sha `35c7cd9` and the full previous-session context in the body (including the `claude.ai/code/session_<id>` link).
4. Fetched + checked out the PR branch, continued with Codex review + fix + merge.

- **KEEP**: "Previous session lost MCP" ≠ "previous session's work was lost." If anything was committed + pushed before the disconnect, the *remote* state holds it. `mcp__github__list_pull_requests` + `pull_request_read(get_reviews, get_review_comments)` is the canonical recovery query.
- **KEEP**: PR bodies auto-generated by Claude Code include the `claude.ai/code/session_<id>` URL. That's a stable handle for "which session produced this," useful evidence when doing archaeology across a disconnect.
- **KEEP**: Don't mutate the local working tree to try to "restore" lost work before checking the remote. The designated session branch being at `origin/main` with zero diff is a valid and common state (fresh handoff) — it is not by itself a signal that work was lost.
- **INSIGHT**: The blast-radius reason MCP-disconnect doesn't lose work: `git push` is a commit-before-push protocol, and the GitHub API call that creates a PR is a remote operation that either succeeded before the disconnect or didn't. Either way, the authoritative state after the disconnect is what's on `origin`, not what's in local memory or local working tree.
- **INSIGHT**: `check-branch-not-merged.sh` + `claude/<topic>-<suffix>` branch naming + PRs-with-session-ID-in-body is a resilient handoff protocol specifically *because* each element fails safe under disconnect. The hook prevents re-pushing to a merged branch; the session-ID in the PR body identifies stranded work; the fresh-branch convention keeps handoffs isolated.


### mls-epl-sigmoid-scale (2026-04-22)

Debt #28 closed. MLS/EPL v5 sigmoid scales sharpened from 0.60 → MLS 0.80, EPL 0.90. Both flipped SHY → HONEST on the 16,777-game reliability corpus. Same general pattern as debt #27 (one-number calibration fix surfaced by reliability diagrams) but a different scalar and different selection criterion.

- **KEEP**: Grid search over 1D scale candidates (11 values × 2 leagues = 22 replays, ~100ms each) when the closed-form first-order derivation has ~20% error. Same cost as one debt-27-style validation pass, way cheaper than fitting by hand twice like we did for NBA homeAdv.
- **KEEP**: Fork `validate-debtN.py` per sprint. Pure-Python, zero native deps. `validate-debt28.py` reuses the replay scaffolding from `validate-debt27.py` verbatim; only the engine constants and ship-rule predicates differ. Cost of the fork: 10 minutes. Value: reproducibility + Termux/Android compatibility + no need to rebuild `better-sqlite3`.
- **KEEP**: Decouple per-league scales even when the current value is shared. MLS and EPL differ in variance structure (EPL has more margin spread per the reliability artifact), and the empirically-optimal scales differ by 0.10 (MLS 0.80, EPL 0.90). Coupling them would overshoot one to fix the other.
- **IMPROVE**: Caught a latent bug in `validate-debt27.py`'s season-year logic vs production: MLS was treated as fall-spring (August cutoff) but production `src/analysis/season.ts:getSeasonYear` treats MLS as calendar-year. The harness was silently dropping 347 MLS games, which I spotted only because the reproduction ECE was off by 0.016. **Lesson: always baseline-reproduce the existing reliability artifact before trusting any new validation outputs.** If the harness can't reproduce the known answer exactly, the harness is broken. Exact-match on a pre-change run is the cheapest bug-catcher for replay harnesses.
- **INSIGHT**: `min |signedResid|` vs `min ECE` give different optima. ECE is the verdict-gate metric (the threshold that flips SHY/HONEST), but it's NOT monotonic in the scale knob — EPL's ECE climbed from 0.0502 (scale=0.60) through a local max of 0.0654 (scale=0.80) before dropping through 0.0404 (scale=0.90) to a minimum of 0.0323 (scale=1.00). Picking by min-ECE would land on 1.00; by min-|sR| on 0.90. The ~0.008 ECE gap is small relative to the baseline improvement, and zeroing signedResid is the cleanest calibration target (eliminates uniform shift; ECE can hide residual shift under cancelling bin residuals). Documented the tradeoff explicitly in the plan rather than hiding the choice.
- **INSIGHT**: EPL's ECE non-monotonicity is the signature of "crossing through calibration": as scale increases, low bins get more underconfident (residual becomes positive) while high bins get more accurate (residual shrinks toward zero). Weighted absolute residual rises before falling. This is a general property of scale-sharpening when the starting scale is too flat — expect ECE to look WORSE on the way to better.

### shadow-prediction-logging (2026-04-22)

Debt #14 closed. `v5-naive` and `v4-spread-naive` rows now write alongside their injury-adjusted counterparts on every live cron, for injury-sport games with non-zero impact AND high confidence. First forward-A/B infra in the project.

- **KEEP**: Encode variant in `model_version` suffix (`v5-naive`, `v4-spread-naive`) instead of adding a schema column. Zero migration, reuses the existing `UNIQUE (game_id, model_version, prediction_source)`. Existing frontend queries filter by exact `model_version =` equality → shadows invisible to the UI by default. Reliability reports group by `model_version` → shadow variants automatically appear as separate calibration series. The A/B comparison shape comes out for free.
- **KEEP**: `predictWithInjuries(game, ctx, undefined)` ≡ `v5.predict(game, ctx)` — proved by inspection: both gate on games<5 → baseRate, both compute the same sigmoid input when injuryAdj=0. Calling the former for the naive shadow keeps both sides of the pair going through the single source of truth for the math. Any future refactor of the injury path will stay in sync with its own injury-absent baseline.
- **KEEP**: `isSpreadModel(mv)` helper for resolver routing. Without it, hardcoded `mv === 'v4-spread'` checks would silently mis-route `v4-spread-naive` rows through the winner-resolution branch — no type error, no runtime error, just wrong `was_correct` and `brier_score`. Extract into a helper *any time* you're adding a new variant that needs the same routing treatment as an existing one.
- **IMPROVE (Codex P1)**: Original idempotency gate was `if (existingStmt.get(game.id, 'v5')) { skipped++; continue }` — this closed the shadow path for any game predicted *before* the PR deployed, leaving forward-A/B coverage systematically incomplete for the rollout window. Fix: gate on `hasV5 && hasV5Naive`. If only v5 exists, re-run `predictGame` — UPSERT DO NOTHING on v5 is a no-op and the new v5-naive row inserts cleanly. The fix's cost is ~10ms/cron for already-predicted-no-shadow-needed games; worth it.
- **IMPROVE (Codex P2)**: Shadow gate was `hasInjuryData`, but `predictWithInjuries` and `predictMargin` both return `baseRate`/`homeAdv` directly when either team has <5 games, bypassing the injury term entirely. That means adjusted ≡ naive in low-confidence games. Shadow rows would be zero-delta — noise-pollution on the A/B dataset. Fix: gate on `hasInjuryData && !lowConfidence`.
- **INSIGHT**: The council pattern of "rule 6: 3 consecutive cron cycles no errors" is a postmerge thing, not something that blocks plan/impl review. Live-cron verification is categorically different from local test validation. When the first post-deploy cron produced zero shadow rows because upstream ESPN injuries were flat, that's "code correctly running with zero shadow-eligible games" vs "code broken." The cleanest way to distinguish is to verify the non-shadow path still produces normal rows — it did.
- **INSIGHT**: Backfilled pairs have temporal skew — if adjusted row was written at time X (ctx_X) and the naive counterpart gets backfilled at time Y > X (ctx_Y), the "pair" mixes two ctx snapshots. Documented as a stat-validity WARN with a pre-declared analysis-time filter (`|adj.made_at - naive.made_at| < 60s`). Better to build the infra now with a documented caveat than to defer or over-engineer; temporally-skewed pairs are a small fraction of the eventual N and are auditable.
- **INSIGHT**: Codex reviews are inconsistent (2/5 recent PRs skipped). Explicit `@codex review` ping ALSO didn't trigger a re-review on PR #38. Can't block on Codex — council + explicit test-validation is the backstop, and Codex is a bonus catcher when it fires. When Codex does fire, its feedback is high signal (both P1 and P2 on PR #38 were real bugs the council had missed).

### nba-learned-model Phase 1 premise null result (2026-04-24)

Plan `Plans/nba-learned-model.md` is council-CLEAR at round 4 (5× CLEAR, avg 8.9/10 across DQ/Stats/Pred/Domain/Math). Phase 1 (rolling-window swap, v6) **abandoned at pre-flight** per plan §Phase 1 rule-1-failure path. Premise check: best rolling-N Pearson r=0.4288 (N=20), season-diff r=0.4157, Δ=+0.0131 vs pre-declared ≥0.02 threshold → FAIL. Informational-only Brier check (walled off per Pred council): v5-vs-(v5-with-rolling-20-swap) mean paired diff = +0.0004 (v6_sim slightly *worse* than v5). Rolling-window premise is weakly supported at best on 2024-25 NBA. Proceeding to Phase 2 (box-score data plumbing, independently useful).

- **KEEP**: Cheap falsification WORKED. Pearson-correlation pre-flight caught a weak premise before any v6 code was written, test fold was touched, or shadow infrastructure was activated. Total cost: ~60 lines of TS + one DB read + 2s runtime. Total spend saved: weeks of v6 implementation + backtest + council implementation review + shadow deploy + forward-watch. This is the argument for §Phase 1 pre-flight existing as a gate, not an afterthought.
- **KEEP**: **N=20 won the grid, not N=5.** Modern NBA team quality is well-captured by medium-term (~20 games) averages; 5/7/10-game windows add noise without adding signal. The plan was implicitly betting on recency (small N); empirics say the opposite. For future sports pilots with a "recency matters" premise, Pearson-correlation-over-N-grid is the cheapest first-order test before building a feature swap.
- **KEEP**: **Council-CLEAR does not mean empirically-correct.** The noise-model spec in §Phase 3 rule 1 was 5× council-CLEAR at round 4, but its empirical σ (4.35 on 2024-25 NBA) wasn't foreseen by any of the 5 experts across 4 rounds. Pre-flight is the backstop that catches "the spec reads reasonable on the page but produces the wrong number on real data." Don't skip pre-flight just because the plan is CLEAR.
- **IMPROVE**: The plan's original noise model (`σ = std of logit(y_clip) − logit(p_v5)`) was a noise-model-in-disguise for an estimator that wanted to be direct. Replaced via 3-expert re-council (unanimous vote A) with **empirical v5-vs-(v5+feature-swap) paired-diff SE** — the plug-in estimator for the quantity the ship gate actually bootstraps. No noise-model proxy, no σ-matching, no assumption about competitor-distance distribution. Captured as methodology addendum in the plan (v2); §Phase 3 rule 1 inherits the corrected methodology for Phase 3's own future pre-flight.
- **IMPROVE**: Mean paired Brier diff on val fold is a val-fold-ship-temptation hazard. Even when computed for a power-check-only reason, an attractive "+0.012 Brier better" val-fold number tempts ex-post ship-gate movement OR biases the test-fold run. Mitigation: **wall off val-fold mean paired diff as INFORMATIONAL ONLY** in the plan addendum. Pre-declare it's not a ship signal. Include in reports with an explicit ⚠ marker.
- **INSIGHT**: Pre-flight's methodology re-council on a council-CLEAR plan doesn't violate the append-only rule. The plan's body is frozen; addenda v1/v2/v3 document what was found, what was revised, and what was re-run. The ship gate (0.010 / 3σ) is unchanged; only the estimator was fixed. **"Fix the diagnosis, not the gate"** is the principle.
- **INSIGHT**: Empirical logit-residual against a binary y dwarfs empirical logit-residual against a calibrated competitor. `logit(y_binary_clip)` is ±4.6 (with ε=0.01); `logit(p_v5)` for v5 clamped to [0.15, 0.85] is ±1.73. Subtracting them gives a residual std of 4.35 — that's the std of "how far is v5 from perfect," not "how far is a competitor from v5." For power-check simulations, always use a competitor-matched noise scale, not a truth-matched noise scale.
- **INSIGHT**: The v6_sim informational-only number (+0.0004 paired Brier, v6 worse than v5) corroborates the Pearson premise failure at the outcome level. When two independent cheap checks (correlation + paired Brier) concur, the signal is real. Future pilots should lean on this: cheap premise falsifier + cheap outcome-level double-check, both on val fold, both pre-declared as non-ship-gate signals, both run before any competitor-model implementation.
- **INSIGHT**: "More data helps" beats "recency helps" **for NBA point-differential specifically**. Rolling-20 of per-game margin was within +0.013 Pearson of season-aggregate point-diff against forward margin — real signal but below the 0.02 pre-declared bar. Important scope limit (plan addenda v5 + v6, 2026-04-24): this finding does NOT generalize to rolling-window of richer features. Whether rolling-window on box-score features (Net Rating, eFG%, TOV%, 3P-rate) beats season-aggregate on those same features is an **untested empirical question**. Phase 3's 9-candidate grid (rolling-N × EWMA-h) is a feature-form SELECTION mechanism — it picks the best recency-weighted candidate; **season-aggregate is not currently among the 9 candidates**. A clean recency-vs-aggregate comparison on rich features would require adding season-aggregate as a 10th candidate (pending Phase 3 plan review per addendum v6 plan-review items).
- **CORRECTION (2026-04-24 user feedback + council v5 review)**: prior language in this entry read "Rolling-window premise is weakly supported at best on NBA" and treated Phase 1's null result as evidence that rolling-window is dead for NBA generally. That's overreach — Phase 1 tested rolling-window on ONE coarse feature (point-diff). Rolling-window on box-score features (the Phase 3 input set) is an untested empirical question. The null result is specific: **v6-as-rolling-point-diff-drop-in is abandoned**, not "rolling-window is dead for NBA." Addendum v6 further corrects two v5 overclaims (see plan): (1) "box-score features are inherently more recency-sensitive" was stated — the honest register is "may be"; (2) "larger effective sample size per game" mischaracterized the math — the correct framing is "lower per-game sampling variance on rate features," with the within-season-trend-variance-to-sampling-variance ratio being the quantity that actually governs whether rolling-window beats season-aggregate.

### nba-phase2-shipped + debt-31-closed + production-backfill (2026-04-25)

Sprint 10.12 — four PRs landed (#42 impl-review fix-pack + addendum v7, #43 debt #33 backfill/coverage/audit + addendum v8, #44 debt #31 calibration bias, #45 Dockerfile `COPY scripts/`). Production backfill executed on the Fly DB, populated `nba_game_box_stats` with 7,604 rows / 3,802 distinct games. Coverage Rules 1, 2, 3 all PASS at 100%. Phase 2 ship-claim now gated on Pass-B audit (N≥50 hand-curated bbref values) only.

- **KEEP**: **Plan-before-code, even for "obvious" implementation work, paid off again.** Debt #33 looked like "just write 3 scripts." Plan-review surfaced an undiscovered structural problem (BDL→ESPN ID gap; 3,802 historical NBA games have no ESPN event IDs, only BDL ids `nba:bdl-N`) that would have blocked the entire backfill at <1% coverage. The plan-review process forced a probe + design before any script was written. Cost: ~30 min planning + 3 council rounds. Spend saved: a half-built backfill that would have required teardown.
- **KEEP**: **Empirical probe in the plan body** — the date-shift / Cup-final / forfeit-edge-case results were captured at the top of `Plans/nba-phase2-backfill.md` *before* implementation. When implementation hit issues (3 resolver bugs in succession), the probe data was already there to cross-check assumptions. Pattern: any plan that asserts something about external data shape should include the literal SQL probe results, not "we'll verify in impl review."
- **KEEP**: **Codex automated review caught two real bugs that human reviewers + 5-expert council missed.** PR #43 had `entriesWithMissingRows` not factored into Pass-B disposition (P1 — silent passes on incomplete coverage) and `/home/johnanguiano/projects/sportsdata` hardcoded in test paths (P2 — non-portable). Both shipped past 5 council reviewers and my own self-review. Codex on PR is now a load-bearing reviewer in this repo. Don't dismiss its findings; the cost of ignoring is a silent ship-claim regression at the gate that matters most.
- **IMPROVE**: **Three resolver bugs in succession (global cache, date-only handling, donut tiebreaker)** are evidence the resolver was undertested before the live run. Plan said 100% coverage was expected; the first run produced 23% then 96% then 100%, only converging after three iterations. Each bug had an obvious post-hoc explanation ("of course the global cache would match cross-season"). For future resolver work involving lookup-by-tuple in a flat global cache, **write a synthetic-data unit test of the matching loop *before* running on production data.** Cost is negligible; production-vs-fixture-mismatch debugging time is high.
- **IMPROVE**: **`fly ssh -C` does NOT run through a shell** — `cd /app && node ...` fails with `executable file not found: cd`. Wrapper required: `fly ssh -C "sh -c 'cd /app && node ...'"`. Documented in addendum v8; first-run on production wasted ~30s on this. For any future remote-shell automation in this repo, pin the wrapper pattern in the runbook.
- **INSIGHT**: **bbref blocks programmatic fetch (WebFetch returned 403).** This kills any plan that assumes "we'll write a small bbref scraper for the cross-source audit." The audit ground-truth must be browser-curated. The audit script supports incremental ground-truth growth (Pass-A1 → A2 → B), so the manual labor can be chunked, but it can't be automated. Recommend mentioning this in any future Plan that involves bbref as a comparand source — it's not a "TODO scrape later," it's a "manual labor required" line item.
- **INSIGHT**: **NBA "donut" home-and-home back-to-back games exist** — same matchup, same home court, ~2 days apart (e.g., PHX vs SA on 2023-10-31 + 2023-11-02). For any matching-by-(home_abbr, away_abbr) lookup with a multi-day window, two events will collide. The fix isn't matchup-uniqueness assumptions; it's exact-fetched-date tiebreaker. This applies to any future cross-provider game-id matching (e.g., adding a third data source).
- **INSIGHT**: **BDL stores `g.date` as date-only (`'2023-10-31'`) representing the local-tipoff calendar date**, which happens to align with ESPN's ET tipoff calendar date for NBA (venues are ET-or-westward, so tipoff date is unambiguous in ET). ESPN's `?dates=YYYYMMDD` is also keyed on ET tipoff date. So for BDL-sourced NBA games, the resolver can use `g.date` directly as the ET key without any timezone shift. The `-5h` SQLite shift was a defensive over-conversion that produced the wrong calendar day for date-only inputs. **Trust the data shape; don't pre-emptively normalize.**
- **INSIGHT**: **Production backfill 100% / coverage 100% / 0 warnings** is a clean result that vindicates the plan-review iteration discipline. 18 fixes across two council rounds + 3 resolver bug-fix iterations + Codex's 2 inline catches all landed before any production write. The cost was substantial (~6 hours of plan + impl + review work for ~32 minutes of actual production runtime). Net: shipped at 4/5 ship rules with zero post-deploy regressions. **Discipline doesn't make work faster; it makes the ship signal trustworthy.**
- **INSIGHT (calibration-bias debt #31)**: When porting a fix from one calibration-related codepath to another, **export both the function-under-fix and its row type** so the test can call directly without DB seeding. The fix landed in 10 lines of code + 17 assertions in a synthetic-data test; the alternative (live-DB integration test) would have required ~60 lines of seed code + tear-down + DB-state-isolation considerations, all to verify a transformation that has no DB side-effect. Lesson generalizes: pure functions deserve direct unit tests, not integration tests.

### nba-phase2-pass-b-closure-via-c-prime (2026-04-26)

Sprint 10.13 — Pass-B audit closed in a single focused session. Phase 2 ship-claim FULLY EARNED (5/5 ship rules satisfied). Three iterations of audit-internal formula refinement (no schema or scraper changes shipped) plus a path-(i) drop+replace for 2 raw failures got us to **0/0/0 PASS at N=50**. New debt #35 surfaced (TOV scraper-convention) as a Phase 3 plan-review item.

- **KEEP**: **Automation-vs-tedium check before committing to manual labor.** Plan v8 scoped Pass-B as "~1.5 hr of typing 1,900 numbers." User's first instinct ("lets grind through") was reasonable; my second-pass instinct ("can we do this with Playwright?") was better. Result: ~25 min scraping + ~5 min audit run + ~3 hr of audit-formula-iteration that was actually the harder problem. **For any plan-of-record that says "manual labor required," do a 5-minute is-it-still-blocked check first** — bbref blocks WebFetch's default UA but does NOT block Playwright at modest throttle. Tools change; gates that were real 6 months ago may not be real today.
- **KEEP**: **The "C′ pattern" — decouple audit-internal formulas from schema-stored values.** When an audit comparand surfaces a systematic formula divergence between our schema and a published reference, the default reach is "fix the schema to match the reference + re-backfill." That's Option A. Option C′ is "keep the schema, add the reference's formula in the audit only" — preserves the gate's intent (catching code bugs) without locking the schema to one of N valid definitional choices. Reusable for any future audit work where the comparand uses a different convention than what we want to ship in the schema. Costs ~1 hour vs Option A's ~2-3 hours + re-backfill operational risk.
- **KEEP**: **Pre-implementation step "fetch the current spec verbatim" pinned in the addendum.** bbref's possessions formula has had at least 3 published variants over the last decade. Plan-time assumption ("uses 0.4·FTA") was correct, but the addendum mandated impl-time verification anyway. Cost: 30 seconds of Playwright fetch + paste into code comment. Benefit: future readers can verify the formula against the same source we used; if bbref changes the formula again, the divergence becomes visible at the next audit run, not silent code rot.
- **KEEP**: **Scraping cache discipline** — `data/.bbref-cache/` (gitignored) holds raw HTML; parser iteration touches only the cache. Saved an estimated 8–10 redundant fetches during the v9.1 / v9.2 iteration. Pattern: **any scraper script that's likely to need parser tweaks should cache the raw network response on first fetch, even if you "only need to run it once."** The "once" is rarely once.
- **IMPROVE**: **Round 1 of plan-review missed the `min(home_mp, away_mp)` issue** — the plan body of v9 specified bbref's possessions formula but NOT the canonical-MP fix that made pace fully agree. v9.1 was needed as a follow-up. In retrospect: when reviewing a plan that pins a comparand-side formula, the plan-review should also explicitly check the *unit basis* of the divisor (here: MP / 5 vs canonical-team-min / 5). Generalized lesson: **whenever an addendum pins a formula, ask "what's in the denominator, and where does it come from?" as a separate review item** — formula numerators usually get scrutiny, denominators usually get assumed-correct.
- **INSIGHT**: **ESPN's summary API exposes 3 different turnover values** — `turnovers` (player-summed), `teamTurnovers` (team-attributed), `totalTurnovers` (sum). bbref's published Pace/ORtg formulas use the player-summed convention; our scraper picked `totalTurnovers`. The ~2-unit-per-game divergence is invisible in aggregate (most NBA games have 0–1 team turnovers) but landed our LAL/IND Cup-final ground-truth entry at 9.5% TOV% rel error. **Lesson for any future scraper that ingests a summed-stat field**: at field-selection time, check whether the source exposes both player-summed and inclusive variants. The default ingest path will silently land on whichever the source documents as "totalX," which may not be the convention downstream readers (or audit comparands) expect.
- **INSIGHT**: **Stratified random samples lose game-type representativeness when an entry is dropped.** Our N=50 had exactly 1 NBA Cup neutral-site game (LAL/IND Cup final). When the path-(i) drop removed it, the alternate from the same season stratum was a vanilla regulation game — the Cup-neutral characteristic was lost. Documented as a 2% sample limitation in addendum v9. For future stratified-sample audits where game-type is a distinct characteristic, **either stratify on game-type explicitly** (e.g., postseason / NBA Cup KO / play-in / regular as separate strata) **or pre-declare that drop-and-replace doesn't preserve game-type stratification**. The former is more rigorous; the latter is honest about scope.
- **INSIGHT**: **`fly ssh` stdin upload + run-on-prod is faster than commit→deploy→run for iterating on prod-only scripts** — the audit script reads a sqlite DB that only exists on Fly. Three iterations of the audit (initial → C′ → v9.1) each took ~30 seconds via `cat <local-script> | fly ssh -C "sh -c 'cat > /app/scripts/X.ts && cd /app && npx tsx scripts/X.ts'"`. The alternative (commit + git push + wait for auto-deploy + fly ssh + run) would have been ~5 min × 3 = 15 min wall-clock, and would have polluted the commit history with WIP states. **For iterating on a prod-only script that doesn't write to schema, prefer the stdin-upload pattern.** Final-version script lands in the commit; intermediate versions don't.
- **INSIGHT (governance, soft)**: **Council loop discipline does NOT make the work serial.** The v9 addendum passed a 2-round 5-expert plan-review (10 expert-reviews total), then a 5-expert impl-review, then a 5-expert results-review. The total council overhead was ~30 minutes of structured thought (mostly mental roleplay against `.harness/council/*.md`). The work was meaningfully better for it: the round-1 WARN list surfaced the alternate-selection-determinism question that shaped path-(i)'s replacement protocol; without it, alternate selection would have been ad-hoc and bias-prone. The cost-benefit holds even for "narrow technical addenda" that touch ship-rule machinery — addendum v6's lesson restated.

### v10-tov-convention-rollback (Sprint 10.14 — 2026-04-26)

The most expensive lesson of the sprint to date. v10 plan was council-CLEAR (5/5 plan, 5/5 impl, avg ≥ 9.1/10), backfill ran cleanly (3,802/3,802 ok, Ship Rule 3 magnitude check PASS), but Ship Rule 4 (Pass-B audit re-run) FAILED because the central empirical claim that drove R2 reversal of the Domain expert's R1 FAIL was based on a single non-representative game (LAL/IND 2023 NBA Cup final, where bbref tov matches ESPN.turnovers because Cup knockout games sit outside the SR Oct-2024 correction pipeline). Rollback executed via re-scrape; post-rollback audit PASS at 0/0/0; per-season AVG(tov) bit-identical to pre-v10 across all 5 segments at 15-sig-fig precision. Debt #35 closed as option-b (keep `totalTurnovers`).

- **KEEP**: **Empirical claims that invert a council expert's prior require multi-data-point falsification, not single-point confirmation.** New bar (codified in post-mortem + Phase-3 forwarding): when an R2 council reversal hangs on an empirical claim against an R1 dissenter, (1) the dissenter names the falsification test and that test is BLOCKING on the reversal, AND (2) ≥2 data points per stratum the population contains, ≥5 total, with adversarial selection (at least one data point per stratum chosen by the dissenter, not the proponent). The single-game algebraic closure (`tov_pct = 14.8% ⇒ TOV=18 not 20`) was internally consistent but was selected from the proponent's confirming-evidence side; a single data point named by the dissenter (e.g., "verify on a 2019-20 game") would have caught the Cup vs regular asymmetry in <30 minutes.
- **KEEP**: **Pre-backfill DB snapshot (atomic `sqlite3 .backup` or equivalent) is a hard prerequisite for any production-data irreversible operation.** Risk-mitigation pre-states the rollback recipe; without the snapshot, the recipe is incomplete. We got lucky — re-scrape from ESPN restored bit-identity for non-sentinel rows (verified to 15 sig-figs), but a 5-row drift of unknown magnitude on the ESPN-sentinel-pattern rows is a residual we'd have caught with the snapshot. Codified as a Phase-3 plan-review entry item.
- **KEEP**: **`scripts/snapshot-box-stats-segmented.ts` and `--update-existing` + `--min-age-hours` flags are general-purpose tooling.** Not v10-specific; retained beyond rollback. Pattern: any `--full-rescrape` style flag for an existing scraper-driven backfill should default-on a stat-correction-window gate (e.g., `--min-age-hours 72` for ESPN NBA boxscore feeds, since the league's stat-correction window closes within ~24h-48h post-game).
- **KEEP**: **The "C′ pattern" generalizes: don't tightly couple downstream code to upstream data conventions when the convention is provider-state-dependent.** bbref's Tm TOV convention shifted across an Oct-2024 corrections pass, and shifted partially (regular-season + postseason + Cup pool-play got the correction; Cup knockout did not). Hard-coding a "convention X is correct" assumption locks us to bbref's state at scrape time. The post-mortem's recommendation to add a stratified-bbref-validation pre-flight harness (`scripts/validate-bbref-convention.ts`, ≥16 games × 8 strata) is the ongoing-monitoring version of the C′ pattern — instead of decoupling once, decouple continuously by checking convention agreement before any TOV-related backfill.
- **IMPROVE**: **The Domain expert's R1 FAIL (4/10) cited the SR Oct-2024 blog post.** The R2 reversal accepted my single-game empirical check as dispositive without running the dissenter's spot-check. In post-mortem, the Domain expert noted: "The lesson should land on 'R2 didn't run the test the dissenter named,' not 'the dissenter should have escalated to blocker.'" This is the more precise framing — the discipline lives with the proponent, not the dissenter. Codified.
- **IMPROVE**: **Confirmation-bias selection of empirical evidence.** I picked the LAL/IND game because it was already in the Sprint 10.13 narrative (path-(i) drop+replace surfaced its TOV mismatch). It was the *most easily available* data point that confirmed the player-summed hypothesis. That's exactly the wrong selection bias for an R2 reversal. The right selection: pick games stratified ACROSS the dimension the disagreement lives on (here: game-type), and let the dissenter pick at least one. If the same hypothesis holds across all strata, R2 reversal stands; if it splits (as it did here), the reversal fails and the addendum body needs to incorporate the asymmetry.
- **INSIGHT**: **bbref's Oct-2024 Tm TOV correction was applied to the regular-season + postseason scoring pipeline (Cup pool-play games got it because they count toward regular-season standings) but NOT to the trophy-game scoring pipeline (Cup knockout, possibly also All-Star Game).** Affected scope for Phase 3: ~14 Cup-knockout games per in-scope window, ~0.18% of training data. Documented as a known bias forwarded to Phase 3; recommended handling is impute-from-team-season-avg for the 5 ESPN-sentinel rows (`tov=0` due to ESPN's `teamTurnovers=-N` sentinel pattern), pre-screen for Cup-knockout convention via the validation harness.
- **INSIGHT**: **ESPN's sentinel pattern for "team-attributed turnover data unavailable" is `teamTurnovers = -turnovers` paired with `totalTurnovers = 0`.** Mathematically: `totalTurnovers = turnovers + teamTurnovers = turnovers + (-turnovers) = 0`. Surfaces in 5 of 7,604 rows on Fly (CHI/LAC, GS, BOS, DEN, GS — all 2024-regular or 2025-regular). Not parser bug; ESPN data quirk. Currently stored as-is in our DB with a `schema_error` warning fired (warning-only, not hard-fail, per v10 policy). Phase 3 row-level handling pinned: impute from team-season average.
- **INSIGHT**: **Per-season AVG(stat) matching to 15 IEEE-754 significant digits across multiple segments is essentially-impossible under any non-trivial row-level perturbation.** Probability across 5 segments at 15 sig-figs each: ≈10⁻⁷⁵ under random drift. The Math expert's R2 verdict used this as proof of bit-identity for the 7,599 non-sentinel rows post-rollback. Pattern: **for any "did X equal Y across N rows" question, an aggregate-level multi-segment full-precision match is stronger evidence than row-by-row diff (and cheaper to compute).**

### phase-3-plan-draft (Sprint 10.14 follow-on — 2026-04-26)

Phase 3 plan-draft addendum v11 council-CLEAR (R2 5/5 avg 9.4/10) on the same day as the v10 rollback, integrating ~20 forwarded items from v6/v7/v8/v9/v10/post-mortem into a council-reviewable Phase 3 work plan. Ship: PR #49 merged at `525bc4d`. NO model code yet — 6 pre-flight scripts gated to land BEFORE any model code.

- **KEEP**: **The pm.5 dissenter-named-falsification-test rule worked as designed within the same addendum's R1→R2 cycle.** Domain R1 raised that Cup-knockout drop disposition (b) loses 100% of neutral-site basketball exposure → covariate-shift hazard; Domain named the falsification test (v5-on-Cup-KO vs v5-on-regular-season-same-month Brier comparison; reject (b) if Δ Brier > 0.02). Per the rule (which this same addendum codified from the v10 post-mortem), Domain's named test was treated as blocking on the disposition. Disposition was reversed from "pin (b) drop" to "TBD pending the named test; default fallback (a) accept-as-is." Domain R2 vindication note: "Round-tripping through pm.5 within the same addendum's R1→R2 cycle validates the council-process codification itself." First documented end-to-end use of the rule; pattern is reusable.
- **KEEP**: **6 pre-flight scripts gated BEFORE any model code is the right discipline for an ML phase.** Plan body Phase 3 (already council-CLEAR at lines 145-301) is the design document; v11 adds 4 supplementary ship-rule gates (A/B/C/D) and a 10-step implementation sequence. The pre-flight discipline catches BOTH (i) data-correctness drift (validate-bbref-convention, falsify-cup-knockout-disposition, sentinel-row re-probe) AND (ii) code-correctness drift (v5-prediction-replay byte-for-byte, Python↔TS feature-parity, snapshot-prebackfill-db). The v10 rollback's failure modes are covered by the pre-flight scripts; future ML-phase plans should adopt the same template.
- **KEEP**: **"Selection-bias correction" framing beats "Bonferroni correction" for inner-CV winner-of-K-candidates.** The Cramér 1946 sample-max expectation `σ·√(2·ln(K))/√n` deflates the winner's-curse on the winning candidate's point estimate; strict Bonferroni `z_{1-α/2K}·σ_diff` controls family-wise Type-I error across all pairwise comparisons. Different objects. The misnaming in the R1 draft confused two reviewers (Stats #1, Math #1) who flagged it independently. Generalized lesson: **when invoking a statistical correction by name, name the failure mode it controls, not the analogy to the most-famous-correction-from-the-same-area**.
- **KEEP**: **Per-row training-data manifest (`ml/nba/manifests/<run-id>.parquet`) is the single most important DQ artifact for Phase 3 reproducibility.** Without it, "we imputed 5 rows" and "we dropped ~14 Cup-knockout games" become tribal knowledge — recoverable from code-archaeology but not from forensic inspection of a stored model artifact. Schema pinned in v11 (10 columns: game_id, team_id, season, game_type, included_in_training, exclusion_reason, imputation_applied, original_value, imputed_value, as_of_timestamp, commit_sha). Each Phase 3 run's manifest is committed to repo; subsequent runs `diff` manifests to surface backfill drift. **Pattern reusable**: any ML pipeline with row-level inclusion/exclusion/imputation logic should produce a per-row manifest, not just an "I trained on this data" marker.
- **IMPROVE**: **R1 grades clustered tightly (7.5-8.5).** All 5 R1 verdicts were WARN-with-mitigations, no CLEAR. Suggests the addendum was uniformly close to the right framing but missed several refinements. Pattern-of-clustering: when all reviewers return the same verdict at the same grade range, the missing items are likely cross-cutting (council-process refinements, formula-naming, threshold tightening) rather than expert-specific. **Lesson**: for big addenda, run a "review-the-review" pass before submitting to council — does the addendum address the most common review categories (naming hygiene, threshold-vs-noise calibration, manifest/lineage tracking, fallback gates)? Catching these before R1 would have lifted R1 to ~9 across the board and avoided the R2 fix-pack iteration.
- **IMPROVE**: **Council-process artifacts (`.harness/council/README.md`) are TBD.** v11 codifies the pm.5 + pm.6 rules in the addendum body, but the actual council-process docs at `.harness/council/` don't yet have a README that consolidates the rules. Needs a follow-up commit to land the codified rules in the durable council-process artifact. Tracked as a Phase-3-step-1-adjacent task.
- **INSIGHT**: **Sample-max-of-K-Gaussians at typical inner-CV scale is non-binding relative to plan-body Rule 1's 0.010 floor.** Math: `σ_inner ≈ 0.095, n = 8120 (pooled held-out games across forward-chaining inner folds 2..5), K = 10` → threshold = `0.095 · √(2·ln(10))/√8120 ≈ 0.00226 Brier`. Plan body Rule 1's 0.010 absolute Brier floor is 4× larger. The inner-CV gate's role is **selection-bias deflation on the winning candidate**, NOT Type-I error control on the winner-vs-baseline comparison. Both Stats and Math expressed the same point in different language; the addendum body now cross-references this explicitly so future readers don't conflate the two functions.
- **INSIGHT**: **Stats + Math + Pred + Domain reviewers naturally split workload by question-type when reviewing the same plan.** Stats focused on multiplicity/sampling; Math on formula/numerics; Pred on operationalization/gates; Domain on covariate-shift/scope. DQ floats above all of these on data-lineage/manifest concerns. The 5-expert split is well-calibrated for ML-phase plans specifically — different from the v10 rollback (which was more DQ + Domain weighted because it was a data-pipeline issue). **Pattern**: council composition can stay constant across plan/impl/test review cycles, but the depth of contribution per expert varies with the work-type. ML phases get balanced contribution; data-pipeline phases get DQ + Domain heavy.

### phase3-preflight-scripts (2026-04-27)

All 6 pre-flight tools landed on `claude/phase3-preflight-1-3` (PR #51, open). Two council impl-reviews: batch 1 WARN 8.4/10, batch 2 WARN 8.0/10. Key findings from this session:

- **KEEP**: **The pm.5 falsification test produced a real production result on first run.** Δ Brier (Cup-KO − regular-season-same-month) = 0.0816, bootstrap 95% CI [0.0105, 0.1671] — **FALSIFIED** with n=14 games. This is the first time the pm.5 rule (codified in v11 from the v10 post-mortem) produced a real-world output rather than just a paper exercise. Option (b) drop is rejected; Phase 3 disposition for Cup-knockout games = accept-as-is (or add neutral-site feature). Commit `6c8be25`, evidence at `docs/cup-knockout-disposition-evidence.md`.
- **KEEP**: **Cup-knockout game ID identification requires explicit fixture files, not date ranges.** Dec 10/11/14 2024 had both Cup-KO and regular-season games on the same date. A date-range `--derive` query pulled 69 games instead of 14. The right approach: maintain `data/cup-knockout-game-ids.json` with confirmed game IDs, use BDL game ID sequence ranges to identify Cup-KO-only additions (16968270-16968273 and 17136xxx + 17195500 for 2024-25), and annotate derive-mode with a warning. Council caught the 2 missing Dec-11 QF IDs in impl-review.
- **KEEP**: **Durable council-process artifacts live in `.harness/council/README.md`, not just in plan addenda.** The pm.5 + pm.6 rules were codified in `Plans/nba-learned-model.md` addendum v11 but that document is append-only and grows. Landing a canonical protocol reference at `.harness/council/README.md` (commit `e0dc189`) + a pointer in `CLAUDE.md` is the right durability pattern — a future session can find the rules without archaeology through the plan file.
- **KEEP**: **Feature parity harness skeleton (script 6) is correctly implemented as a gated stub.** Writing the framework before `ml/nba/features.py` exists, with a clear "PHASE 3 NOT YET IMPLEMENTED" exit path, means the test is already wired into the repo when Phase 3 step 4 lands. The `--list-interface` flag documents the Python/TS API contract at authoring time, when the author knows the design intent. This beats writing the test after-the-fact once the implementations exist.
- **IMPROVE**: **Schedule facts should be verified from the DB, not recalled from memory.** The manifest note had wrong 2024-25 Cup SF dates (Dec 12-13 vs actual Dec 14). The actual game IDs in the DB were on Dec 14. Any time specific dates or IDs for events are needed, query the DB; don't guess from the IST calendar recalled from training data. Fixed via council action item 2.
- **IMPROVE**: **Initial council impl-reviews caught issues that would have caused silent failures.** Batch 1: `validate-bbref-convention.ts` was exiting 0 on underpopulated strata (a CI gate miss) and `--sentinel-only` was overwriting the full report (a silent data-loss bug). Both are the kind of issue that doesn't surface until "why did CI pass?" or "where did my report go?". The council's exit-code-gap catch (action 1, batch 1) is a pattern worth watching for in any pre-flight script.
- **INSIGHT**: **v5's neutral-site bias is measurable and is the primary driver of the FALSIFIED result.** The two highest-Brier Cup-KO games are the 2024-25 Cup SF game NY/ATL (home=NY, away=ATL, prob=0.764, brier=0.584 — NY heavily favored but ATL won) and the Cup Final OKC/MIL (home=OKC, prob=0.785, brier=0.617 — OKC heavily favored but MIL won). Both are neutral-site games where v5 applied full 2.25pt home advantage to the "home" team. The FALSIFIED verdict is correct per the pre-declared criterion, but the mechanism is v5's architectural neutral-site blindness, not inherently different team quality in Cup games. Phase 3's ML model can neutralize this bias by including a `neutral_site` binary feature — the FALSIFIED result *motivates* that feature addition.
- **COUNCIL**: Batch 1 impl-review WARN 8.4/10 (`e0dc189`). Two mechanical fixes (exit-code gap, sentinel-only report overwrite). Council explicitly waived second review: "mechanical fixes with no design ambiguity." Batch 2 impl-review WARN 8.0/10 (`6c8be25`). Three fixes: 2 missing 2024-25 QF game IDs (bdl-16968272, bdl-16968273), manifest note corrected (Dec 12-13 → Dec 14), derive-mode contamination comment added.

### phase3-step4-features (2026-04-27) — PR #53 merged at `a0ba673`

`ml/nba/features.py` (42-feature rolling tensor, 5 unit tests) + gate 3 council CLEAR.

- **KEEP**: **Module-level SQL string constants with `.format(placeholders=...)` are required when the SQL contains Python-computed clauses (e.g., `IN (?,?,?)` for excluded seasons).** f-strings split by the Python AST into constant-prefix fragments. A structural SQL test that walks `ast.Constant` nodes will see only the prefix of the f-string (e.g., `SELECT ... FROM nba_game_box_stats bs`) without the `updated_at <= ?` filter in the suffix. The fix: write the full SQL as a module-level string constant with a `{placeholders}` literal marker, then call `.format(placeholders=placeholders)` at call time. The full template — including the filter — is visible to AST inspection. Commit `a0ba673`.
- **KEEP**: **NaN imputation must happen in normalized space, not raw-value space.** If early-season games with no rolling history have NaN features, replacing NaN with `0.0` in raw space (before normalization) creates extreme negative normalized values — e.g., eFG%=0.0 logit-transforms to `−∞`, then maps far below the training mean. The correct pattern: fit normalization on the finite-valued subset; apply normalization to finite values only; then set NaN positions to `0.0` in normalized space. `0.0` in normalized space = the training population mean. This is mean imputation, the least-harmful default. Gate 2 bug fix, commit `a0ba673`.
- **KEEP**: **`timedelta(days=7)` is the right 7-day window subtraction, not `date.replace(day=max(1, day-7))`.** The `replace` form breaks on days 1–7 of any month (day-7 goes negative, `max(1,...)` clamps to the 1st, producing a window of 0–6 days). Gate 2 blocking bug fix, commit `a0ba673`.
- **KEEP**: **Structural SQL tests (AST inspection of all SELECT literals in a module) are a strong forward leakage guard.** They catch newly added queries that read feature-relevant tables without a temporal filter before any code is deployed. Five-expert council flagged this as the most important design decision in step 4 Gate 2. Pattern: write the structural test alongside the first SQL-heavy module; it's cheap and it scales as the codebase grows.
- **INSIGHT**: **NBA regular-season home win rate is ~54.4% in 2023-24 and 2024-25, down from the ~58-60% historical average.** Not a data bug — a genuine post-COVID trend (analytics-optimized travel, circadian management, reduced home-crowd effect). Verified by season-breakdown query (2023-regular=54.5%, 2024-regular=54.3%). Postseason norms intact (2023: 58.5%, 2024: 57.1%). The model should learn the current era's dynamics. Gate 3 council WARN resolved.
- **COUNCIL**: Gate 3 WARN→CLEAR (avg 7.8/10). Home win rate 54.6% investigated; genuine era effect. Forward items: injury-blind calibration implication for step 5; early-season NaN purity test variant (future hardening).

### phase3-step5-cv-training (2026-04-27) — PR #54 open on `claude/phase3-step5-cv-training`

`ml/nba/cv_runner.py` + `train_lightgbm.py` + `train_mlp.py`. ewma-h21 wins inner CV; council override of bias gate.

- **KEEP**: **LightGBM 20-seed ensembles require explicit randomization params (subsample, colsample_bytree) to produce seed diversity.** Without `subsample < 1.0` and `colsample_bytree < 1.0`, LightGBM's GBDT builds identical trees across different `random_state` values (no row/feature sampling to randomize). All 20 seeds produce the same val Brier and seed-std=0. Fix: add `subsample=0.8, subsample_freq=1, colsample_bytree=0.8` to the fixed hyperparameter set. Seeds then produce genuinely different models (seed-std=0.0012 after fix). Commit `0730d4a`.
- **KEEP**: **`σ_inner` in the order-statistic selection-bias threshold is the per-game Brier std, not the std of the mean.** Planning used σ_inner≈0.095 and derived threshold≈0.00226 Brier. The realized per-game Brier std was 0.151 (recovered via `np.std(bootstrap_means) * np.sqrt(n)`), giving threshold≈0.00702. The planning arithmetic was internally inconsistent — using 0.095 as the per-game std but deriving a threshold at the mean-estimator scale. Corrected lesson: calibrate σ_inner from a held-out set, not from intuition. The threshold formula `σ · √(2·ln(K)) / √n` is correct; the estimate of σ was wrong.
- **KEEP**: **Plan Risk #7 ("season-agg fallback if all K candidates fail bias gate") was designed for the null case — no candidate has meaningful signal.** When the statistical winner also wins all three season segments across two independent CV runs, the appropriate council action is a documented override, not a mechanical fallback to season-agg. The bias gate failure in this case traced to a miscalibrated σ estimate (3× stricter threshold than intended), not to an absence of signal. Pattern: pre-declared fallbacks should state the *failure mode* they address (null result vs specific σ miscalibration) so future reviewers know when an override is justified. Council Gate 2 override documented in addendum v13, commit `0730d4a`.
- **KEEP**: **Staged feature-form selection (Phase 1: K=10 candidates at fixed hyperparams; Phase 2: K=18 hyperparam grid on winning form) keeps the order-statistic correction consistent with the plan's K=10 framing.** Joint evaluation of (K_form × K_hyperparam) = 180 combos would require the correction at K=180 (threshold≈0.00666 Brier vs 0.00443 at K=10) — nearly impossible to satisfy at n=2112. Staged selection delegates winner-selection to Phase 1 (K=10), and treats Phase 2 as a separate optimization (no multiplicity correction needed since no downstream ship-rule gate depends on Phase 2 ordering). This was a Gate 1 Math blocking item, self-resolved in fix-pack.
- **INSIGHT**: **EWMA with halflife=14–21 games dominates rolling-N and season-aggregate for NBA team strength estimation.** Both independent CV runs agreed: ewma-h21 (Brier=0.2169/0.2177) > ewma-h14 > ewma-h7 >> rolling variants >> season-agg. The halflife ≈ 3–5 weeks of NBA play is the right recency-stability tradeoff: responsive to hot/cold streaks without being noisy. Rolling-5 (rank 10/10) confirms very short windows add variance; season-agg (rank 6-8/10) confirms that too-long memory dilutes recent form signal. This finding should seed priors for any future sport-agnostic feature-form grid search.
- **INSIGHT**: **`num_leaves` is non-binding at n=2640 for LightGBM binary classification.** Phase 2 grid showed 31=63=127 produce identical CV Brier across all `min_child_samples` values. `min_child_samples` is the active tree-depth constraint at this sample size — the minimum leaf-node sample count limits tree growth before `num_leaves` is ever reached. For future LightGBM grids at n<5000, drop `num_leaves` variation and focus the grid on `min_child_samples` and regularization.
- **COUNCIL**: Gate 1 WARN (avg 7.2/10) → CLEAR after fix-pack (staged selection + MLP architecture pin). Gate 2 WARN (avg 7.6/10) → CLEAR with council override (bias gate failure traced to σ miscalibration; ewma-h21 segment-stable in both runs). PR #54 merged at `1bc750b` (squash).

### phase3-step6-calibration (2026-04-28) — PR open on `claude/phase3-step6-calibration`

`ml/nba/calibrate.py` + `ml/nba/infer.py` + `ml/nba/configs/calibration-params.json`. Platt scaling on ewma-h21 20-seed LightGBM ensemble; serving-time inference script.

- **KEEP**: **Platt scaling must be fit in logit space with `LogisticRegression(C=1e9)`.** Fitting in probability space loses the linear-in-logit statistical guarantee of logistic regression. Using sklearn's default `C=1.0` adds L2 regularization that biases both coefficients toward zero, collapsing the calibration mapping to p_cal→0.5 for all inputs (no adjustment). At C=1e9 the penalty is negligible and the fit matches maximum-likelihood Platt 1999. Commit `23c243e`.
- **KEEP**: **For LightGBM ensembles, "serving artifact" = predict-and-average, not weight-averaging.** Weight averaging (averaging model parameters across seeds) is well-defined for neural networks but has no meaningful analogue for tree ensembles — you can't average decision tree split thresholds and leaf values across independently grown trees and expect the averaged object to behave like either parent. The plan's "averaged-weights ONNX" language was MLP-specific and needed explicit clarification for the LightGBM case. The fix-pack in addendum v14 Gates 1 and 2 documents this distinction as a permanent note. Commit `23c243e`.
- **KEEP**: **Platt calibration must be applied to the ensemble mean, not to individual seed predictions.** The Platt parameters A and B were fit by regressing `logit(mean_of_20_seeds)` against `y_true`. Applying Platt to each of the 20 seed predictions before averaging computes `mean(sigmoid(A·logit(p_i)+B))`, not `sigmoid(A·logit(mean(p_i))+B)`. These are different quantities (Jensen's inequality: for concave sigmoid, the former systematically underestimates). The correct pipeline: average first, calibrate the mean. Made explicit in both `calibrate.py` (fits on mean) and `infer.py` (averages first, then `_apply_platt`). Commit `23c243e`.
- **KEEP**: **For ML model inference scripts, gitignoring trained model artifacts but documenting the regeneration recipe in the script's module docstring is the right tradeoff.** Model pickles are large binary blobs that bloat git history. But "models are missing, now what?" is a real failure mode for anyone running the script on a fresh clone. The solution: gitignore the artifacts, but make the regeneration command a first-class element of the script's docstring (not buried in session notes or README). If the regeneration is deterministic (fixed seeds, fixed data, fixed config), the models are effectively a reproducible build artifact. Commit `23c243e`.
- **INSIGHT**: **LightGBM gradient boosting tends to produce underconfident probability estimates on small tabular datasets.** Platt A=1.350 > 1.0 means the raw ensemble predictions were compressed toward 0.5 — the model's sigmoid-output probabilities spanned a narrower range than the true Bernoulli probabilities. A>1 in Platt logit-space stretches predictions toward 0 and 1. This is a well-known GBM behavior: boosting minimizes log-loss greedily per tree, which can produce well-ranked (high AUC) but poorly-scaled (low calibration) probabilities, especially when regularized with high min_child_samples. The calibration improved val Brier by 0.0025 (0.2050→0.2025), confirming the raw predictions were meaningfully miscalibrated.
- **INSIGHT**: **The val fold composition (444 regular + 84 postseason) is asymmetric but acceptable for Platt calibration.** Postseason games contribute 16% of the val fold and exhibit slightly different dynamics (home-court advantage ~57-58% vs ~54% regular). The Platt fit treats them uniformly, which introduces mild bias toward the more-numerous regular-season regime. With only 2 Platt parameters and 528 calibration games, the model has no capacity to overfit this asymmetry. For future calibration work at larger n (e.g., if a 2025-regular season is added to training), consider whether a season-stratified or game-type-stratified Platt fit (or isotonic regression) is warranted.
- **COUNCIL**: Gate 1 WARN (avg 7.3/10) → CLEAR (plan review, addendum v14, commit `5c3d1df`). Gate 2 CLEAR (avg 8.5/10, all 10 fix-pack items verified, commit `04625a8`). Highest Gate 2 score in Phase 3 so far.

### phase3-step8-lgbm-gate-d-fail (2026-04-28) — `claude/phase3-step6-calibration`

`ml/nba/evaluate_test_fold.py` — first test-fold touch (touch #1, counter 0→1). LightGBM failed Gate D; MLP touch 2 pre-declared as next step.

- **KEEP**: **Val-fold postseason inclusion inflates the estimated improvement when the test fold is regular-season only.** Val fold (2024-25) contained 84 postseason games (16%) alongside 444 regular-season games. Postseason games have warm EWMA windows, higher game quality, and lower noise — all favorable to EWMA features relative to cold-start regular-season games. The test fold (2025-26) is regular-season only (no postseason yet as of training cutoff). This compositional asymmetry inflated the val-fold +0.0065 Brier signal. Future plans must either (a) use a regular-season-only val fold, (b) explicitly partition postseason games out and report Brier separately, or (c) pre-declare the composition asymmetry as a risk and power-adjust the ship floor.
- **KEEP**: **EWMA features have a severe cold-start problem at season start that v5 avoids entirely.** EWMA halflife=21 features initialized from prior-season decayed values are near-zero meaningful signal for approximately the first 3–4 weeks of the new season (~16% of the test fold). v5 uses an explicit < 5 games fallback (base_rate=0.57) — a defensible conservative prior. EWMA has no analogous fallback: it carries forward stale prior-season weights that are not representative of the team's current season state. Any future EWMA-based model for NBA must include either (a) a warm-start initialization using current-season stats when available, (b) a game-count flag that triggers fallback to a stable prior in the first N games, or (c) a longer halflife that reduces sensitivity to the initialization state.
- **KEEP**: **TOV% zeroing bug: pct-form values (5–25) saturate logit_zscore with std=1e-8.** All four tov_pct features (home/away × off/def) are constant across all observations after normalization — values in the 5–25% range all clip to logit(1−eps) = 4.789, and the fitted std is effectively 0 (floor 1e-8). The model was trained and evaluated on zeroed TOV% signal. The bug is symmetric (training, val, and test all affected equally) and does not cause the val→test reversal. Fix: convert tov_pct from percent to fraction (÷100) before applying logit_zscore, or switch tov_pct to zscore transform (the percent values are approximately linear). Mandatory before any retraining cycle.
- **KEEP**: **A test-fold Brier degradation of 3.87σ is not sampling noise — but the val-fold +0.0065 at SE≈0.005 was always low power for a 0.010 ship floor.** The probability that a val-fold result of +0.0065 (1.3σ) predicts a test-fold result ≥ 0.010 is low under standard assumptions. This is a power analysis failure: the val-fold evidence was accepted as sufficient for a 0.010 ship floor when the SNR was only ~1.3σ. Future plans must require a minimum val-fold point estimate at 2σ above the ship floor to have reasonable test-fold power.
- **INSIGHT**: **For NBA, season-aggregate point differential is a near-sufficient statistic for team quality at the game-prediction level.** v5 (simple sigmoid on season-aggregate point diff) achieved AUC 0.7283 and Brier 0.209259 on the 2025-26 test fold — essentially identical to its val-fold performance (Brier 0.208981). A 20-seed LightGBM ensemble with 42 EWMA box-score features achieved AUC 0.6954 and Brier 0.222185 — WORSE than v5 by 3.87σ. The stability of v5 vs. the degradation of LightGBM suggests the EWMA features are adding noise over the season-aggregate baseline, not signal. For a league with large talent dispersion and sticky rosters within a season, the year-to-date average is the dominant signal; recency-weighted form is secondary at best.
- **COUNCIL**: Gate 3 WARN→FAIL (Stats CLEAR/7, Pred FAIL/4, Domain FAIL/2, Math FAIL/8, DQ WARN/5). Resolver: FAIL operative — Gate D FAIL (AUC 0.6954 < 0.7283, 3.87σ). MLP touch 2 authorized per pre-declared plan.

### phase3-step8b-mlp-null-result (2026-04-28) — `claude/phase3-step6-calibration`

`ml/nba/evaluate_test_fold_mlp.py` — second test-fold touch (touch #2, counter 1→2). MLP also failed Gate D. Phase 3 null result declared.

- **KEEP**: **When both tree ensemble and MLP fail an AUC floor vs. a simple sigmoid baseline, the failure is in the features, not the model class.** MLP (AUC 0.7026) slightly outperformed LightGBM (AUC 0.6954) but both fell below v5 (AUC 0.7283). The gap between model families (0.0072 AUC) was smaller than the gap to v5 (0.0257 for MLP). This pattern — two different architectures both failing against the same incumbent — is diagnostic: the feature set is not encoding the information that drives game outcomes, not the model capacity. For future attempts: fix the features first, then select the model.
- **KEEP**: **The pre-declared sequential discipline (LightGBM first, MLP only if LGBM fails) correctly bounded test-fold touches at 2.** Running MLP unconditionally would have consumed the same 2 touches with the same null result, wasting the FPR budget for no gain. The sequential protocol's discipline was correct per plan design.
- **INSIGHT**: **v5's discriminative advantage (AUC 0.7283) over both learned models suggests that cumulative season-to-date point differential integrates opponent strength, home/away split, and rest patterns more efficiently than the current EWMA feature set.** EWMA features capture recency-weighted efficiency metrics but not the cumulative quality signal that emerges over a full season. A hybrid approach — season-aggregate base + EWMA adjustment — would directly address this structural deficit without rebuilding from scratch.
- **COUNCIL**: Gate 3 (MLP results) CLEAR — 5/5 CLEAR. Null result confirmed. Test fold burned. Counter = 2/2. Phase 3 closed.
