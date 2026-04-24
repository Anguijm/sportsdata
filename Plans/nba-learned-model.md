# NBA Learned-Model Pilot — Staged Plan

**Branch**: `claude/nba-model-explanation-m8rX8` (plan only; implementation branches per phase)
**Scope**: NBA only. NFL / MLB / NHL / MLS / EPL stay on v5 + v4-spread. Explicit non-goal: no cross-sport replacement in this plan.
**Status**: **COUNCIL-CLEAR** (round 4, 2026-04-24). Round 1: 5× WARN. Round 2: 3× CLEAR + 2× WARN. Round 3: 3× CLEAR + 2× WARN. Round 4: **5× CLEAR** (DQ 9, Stats 9.5, Pred 8.5, Domain 9, Math 9 — avg 8.9). Append-only from this point per project rules; post-implementation results append as addendum. Phase 1 implementation branch cuts from `origin/main`, NOT from `claude/nba-model-explanation-m8rX8` (the plan-only branch) — Phase 1 is a separate PR with its own council implementation review.

**Naming note**: This plan was originally titled "NBA Neural-Net Pilot." Renamed to "Learned-Model" per council feedback — the plan must not prejudice the Phase 3 model-family decision (MLP vs gradient-boosted trees) by its title.

## BLUF

Pilot a learned NBA model in three independently-shippable phases, each with its own pre-declared ship rules and council review. Each phase either beats the incumbent or is abandoned — no phase ships on "will pay off later" reasoning. The Phase 3 end-state is a small learned model (MLP *and* LightGBM run in parallel, winner ships subject to identical gates) fed rolling-window box-score features with per-feature-type normalization, trained with a pre-declared loss + post-hoc calibration. We only build Phase 3 if the cheaper phases prove the signal exists AND Phase 2 data plumbing lands clean.

## Problem

Current NBA stack (`src/analysis/predict.ts`) has two known limitations surfaced by prior council work:

1. **Season-aggregate point differential is the only team-quality feature.** No rolling window, no time decay. A team's blowout win in game 3 counts the same as a close loss yesterday. Recency weighting is logged as debt #25 (Dixon-Coles ξ) and remains unshipped.
2. **No box-score granularity.** STL / AST / BLK / pace / TOV / eFG% / rebound differential are not in `TeamState` and not in the `game_results` table. Feature poverty limits the model's structural ceiling regardless of how the sigmoid is calibrated.

A third limitation — the hardcoded 3-game streak flag — is *interpretable and cheap*, so we only delete it if a learned replacement demonstrably beats it, not on aesthetic grounds. Phase 3 pre-declares the streak-ablation test (see §Phase 3).

## Why NBA for the pilot

- Largest resolved-outcome corpus of any single sport in the DB (~4,100 NBA games across 3 seasons per README).
- Game-level box score is standardized and available from ESPN's per-game endpoint (same host we already scrape).
- v5 NBA calibration is recent (PR #34, April 2026) and HONEST on reliability diagrams — a strong, stable baseline to beat.
- NBA's 82-game schedule gives us the most within-season data per team, which is where rolling-window features have the best chance to add signal.

## Effective sample size disclosure (round-1 Math + Stats feedback)

4,100 games is the IID fiction. With rolling-N features, games within a team's window are correlated (game 11 and game 12 for team T share 9 of 10 rolling inputs). Naive league-wide shrinkage ≈ `N / window_length` is too pessimistic because team pairs are partially independent across the league; honest effective N sits between **800 and 2,000** for Phase 3's 40-feature setting.

All Phase 3 bootstrap CIs use a **block bootstrap clustered by `(home_team, week)`** (revised from `(team, week)` per round-2 Stats feedback: the `(team, week)` scheme double-counted each game across two blocks since both home and away teams are indexed; `(home_team, week)` eliminates game-level duplication while preserving within-team temporal correlation structure). Naive per-game-IID bootstrap is reported as a sensitivity check, not a ship gate. If the two intervals diverge by more than 2× on any metric, the block-bootstrap interval is authoritative. Block count in a 2025-26 test fold: ~650–700 non-empty `(home_team, week)` cells (30 teams × ~24 weeks × ~half the games as home), which is well above the ≥50-block stability floor for 95% CIs at B=10,000.

## Multiple-comparisons discipline (round-1 Stats feedback)

Across phases we stack conjunctive rules: Phase 1 (4 rules), Phase 2 (3 rules), Phase 3 (6 rules). Conjunctive AND-gates **control ship-FPR** (good) but **inflate ship-FNR** (we will reject some genuinely better models). We accept this tradeoff because the incumbent (v5) is already calibrated and HONEST; the cost of a false-ship (production regression) exceeds the cost of a false-reject (missed improvement). This is documented here rather than buried per-phase to make the discipline explicit. Per-bin residual rules (Phase 3 rule 4) are re-specified below to avoid per-bin multiple-comparisons inflation.

## Staged approach

Three phases. Each phase is an independent PR with its own council plan review, implementation review, and results review. A failed ship gate at phase N does NOT block phase N+1 unless the failure invalidates a shared assumption.

| Phase | Name | Language | Ship gate concept |
|---|---|---|---|
| 1 | Rolling-window differential | TypeScript | Beats v5 Brier on held-out 2025-26 slice (block-bootstrapped paired diff) |
| 2 | Box-score data plumbing | TypeScript | Data quality gates (field-level MUST-HAVE coverage + retroactive-correction handling) |
| 3 | Learned model (MLP *and* LightGBM in parallel) | Python (subprocess or ONNX) | Winner-of-family beats best-of(v5, phase-1) by pre-declared margin |

## Phase 1 — Rolling-window differential (TypeScript, cheapest)

**Hypothesis**: A last-N-games rolling point differential carries more predictive signal than full-season differential for NBA.

**Pre-flight diagnostic (run before implementation)**: On the 2024-25 validation fold (no test-fold contact), compute three numbers that must be committed to the plan before Phase 1 coding begins:

1. **v5 NBA Brier on 2024-25 validation fold** — the incumbent anchor. Enables readers to interpret the 0.010 absolute threshold in relative terms (~5% lift if v5 Brier ≈ 0.20; ~4% if ≈ 0.23). Not yet computed in this plan; pre-flight delivers it.
2. **Pearson correlation of `rolling_N_diff` and `season_diff` each against forward per-game margin**, for `N ∈ {5, 7, 10, 15, 20}`. If best rolling-N correlation does not exceed season-diff correlation by at least 0.02 (absolute Pearson), Phase 1 is unlikely to pass rule 1 and we should re-council before writing v6 code. Cheap falsifier of the *premise*, upstream of the ship gate.
3. **Expected paired-diff block-bootstrap SE** via a v5-vs-{v5+empirical-noise} simulation (see §Phase 3 rule 1 power check for the noise-model spec). If SE > 0.0033, even Phase 1's 0.010 gate is underpowered on current test-fold size and we re-council.

All three numbers are committed to `Plans/nba-neural-net.md` as a pre-flight addendum before Phase 1 implementation begins. Pre-flight script: `scripts/phase1-preflight-correlation.ts` (expanded from round-2 scope to include baseline Brier and SE).

**Change**: In `src/analysis/predict-runner.ts` team-state snapshot, compute `rolling_N_diff_per_game` (N chosen by grid search, see below) alongside existing `diff_per_game`. Add a v6 model that uses rolling-N as the primary feature and season-aggregate as fallback. Sigmoid scale re-tuned via grid search per the MLS/EPL precedent (`Plans/mls-epl-sigmoid-scale.md`).

**Explicitly not changed in Phase 1**:
- Feature set beyond the rolling swap (still no box-score stats)
- Streak flag (stays in v6 — we do NOT delete it yet)
- Home advantage constant (2.25, per debt #27)
- Injury adjustment (40% compensation factor, unchanged)
- Shadow-logging infrastructure (reused from PR #38)

**Why this phase first**: If a one-line swap to rolling-window doesn't improve anything, the premise of the entire plan ("recency matters for NBA") is weakened and Phase 3 becomes speculative. Cheap falsification before expensive build.

**Window-length decision**: Grid-search `N ∈ {5, 7, 10, 15, 20}` on the pre-2024 training fold ONLY, pick the N with best Brier on that fold, then freeze N and evaluate on the 2025-26 test fold. No ex-post window-length tuning. EWMA half-life is NOT in the Phase 1 grid (rolling-N is simpler and more inspectable); EWMA is added to the Phase 3 grid (see §Phase 3).

**Season-boundary rule**: Rolling-N does NOT include previous-season games. First N games of each season use the season-aggregate fallback path (same path used by cold-start teams). This keeps the rule simple and avoids cross-regime leakage from trade-deadline/roster-turnover noise.

### Phase 1 ship rules (pre-declared)

v6 replaces v5 for NBA live predictions iff **all four** hold:

1. **Brier beat (block-bootstrap paired)**: v6 NBA Brier < v5 NBA Brier on the 2025-26 held-out slice, with a 95% **block-bootstrapped** CI on paired per-game Brier diff entirely below zero. Bootstrap spec: **B = 10,000 resamples, blocks = `(home_team, week)`** (see §Effective sample size for block-definition rationale). Sensitivity check: per-game-IID bootstrap reported; block CI is authoritative.
2. **Calibration preserved**: v6 NBA reliability verdict = HONEST (|signedResid| ≤ 0.02, ECE ≤ v5 NBA ECE). The prior "+0.005 ECE slack" was dropped — "preserved" means not-worse.
3. **No margin regression**: v4-spread-rolling (parallel Phase 1 variant for the margin model) weightedMAE ≤ v4-spread weightedMAE + 0.05, verdict stays HONEST.
4. **Cold-start safety**: On games where either team has <15 games played (raised from 10 per Domain expert feedback — rolling-10 at game 10 is numerically identical to season-to-date), v6 falls back to v5's season-diff path. The fallback path is tested on the 2024-25 early-season slice with no Brier regression vs v5.

If rules 1-3 hold but rule 4 fails, ship v6 with a stricter cold-start gate (e.g., fallback to v5 until 20 games) rather than abandon.
If rule 1 fails, document the null result in `learnings.md` and SKIP to Phase 2 (data plumbing is independently useful for reporting / Phase 3 regardless).

## Phase 2 — Box-score data plumbing (TypeScript, no model change)

**Hypothesis**: None — this is infrastructure. Ships or fails on data-quality gates only.

### Field-level schema (MUST-HAVE vs NICE-TO-HAVE)

Round-1 Data Quality feedback: "≥98% coverage" is unfalsifiable without a pre-declared field list. Phase 2's coverage gate is computed **only over MUST-HAVE fields**:

**MUST-HAVE (row is incomplete if any is missing):**
- `game_id`, `team_id`, `season`, `updated_at` (keys + audit)
- `fga`, `fgm` (implies FG%)
- `fg3a`, `fg3m` (implies 3P-rate, 3P%)
- `fta`, `ftm` (implies FT%, FT-rate)
- `oreb`, `dreb`, `reb` (rebound rates)
- `ast`, `stl`, `blk`, `tov`, `pf`
- `pts`, `minutes_played`
- `possessions` — **derived column**, computed at scrape time via the basketball-reference Oliver formula: `FGA + 0.44·FTA − OREB + TOV`. Both teams' possession estimates are averaged (standard convention) and stored per-team. This is pinned here so training and inference cannot diverge on the possession estimator.

**NICE-TO-HAVE (nullable; reported but not gated):**
- `time_of_possession`, `points_off_turnovers`, `fast_break_points`, `points_in_paint`, `largest_lead`, `technical_fouls`, `flagrant_fouls`

**Derived downstream features (computed from MUST-HAVE at feature-export time, not stored in the table):**
- `eFG%` = `(fgm + 0.5·fg3m) / fga`
- `TOV%` = `tov / (fga + 0.44·fta + tov)`
- `OREB%`, `DREB%` = team OREB / (team OREB + opp DREB), etc.
- `ORtg`, `DRtg` = 100 · pts / possessions (offensive and defensive)

### Scope

1. Extend `src/scrapers/espn.ts` to pull per-game box score for completed NBA games. Parse and validate against a **Zod schema** (new `src/scrapers/espn-box-schema.ts`); any unrecognized or unexpectedly-missing field fires a scrape-time warning and is logged to `scrape_warnings` table. Schema-drift detection is continuous, not a one-time check.
2. Schema migration in `src/storage/sqlite.ts`: new `nba_game_box_stats` table keyed on `(game_id, team_id)` with **UPSERT semantics**, plus both `first_scraped_at` (set once at insert) and `updated_at` (bumped on any MUST-HAVE change) columns. The two columns serve different purposes: `first_scraped_at` is the immutable scrape-time stamp (used to partition training artifacts by "when did we first see this row"); `updated_at` is the mutation-time stamp (used by downstream feature caches per item 3). Migration is idempotent, has a tested down-migration. Do NOT widen `game_results`. Also creates `nba_box_stats_audit` and `scrape_warnings` tables (see items 3 and 1).
3. **ESPN retroactive-correction handling** (elevated from round-1 "anticipated pushback" into Phase 2 ship rules): a scheduled job re-fetches box scores for all NBA games within the last 7 days on every cron tick. **Change-detection guard**: before UPSERT, compare old row to new row; only bump `updated_at` and write an audit row if at least one MUST-HAVE field actually changed. Otherwise no-op. Prevents the audit table from growing without information content. All genuine mutations logged to `nba_box_stats_audit` (old value, new value, timestamp, game_id). Downstream feature caches keyed on `updated_at` so Phase 3 training artifacts stay reproducible.
4. Backfill historical NBA games. Rate-limit respectfully: existing ESPN scraper has 10s timeout + 3-attempt retry per PR #25; cap backfill at 2 requests/second.
5. Add a `box_stats_coverage` view reporting `(season, team_id, games_with_full_must_have, games_missing_must_have, nice_to_have_coverage_pct)` — provides both aggregate and per-season + per-team coverage numbers for the ship gate.
6. **Cross-source audit (new)**: one-shot `scripts/audit-espn-box-stats.ts` samples 50-100 NBA games across seasons, compares ESPN-scraped values against a manually-curated list of basketball-reference URLs (hard-coded in the script, no bbref scraper). **Per-field-type tolerance split** (round-2 DQ feedback): raw count fields (`fgm`, `fga`, `fg3m`, `fg3a`, `ftm`, `fta`, `oreb`, `dreb`, `reb`, `ast`, `stl`, `blk`, `tov`, `pf`, `pts`) must match **exactly** — both sources read the same official box score, so any non-zero delta indicates a field-mapping bug. Derived rate fields (`eFG%`, `TOV%`, `OREB%`, `ORtg`, `DRtg`, `possessions`) allow 1% tolerance (rounding + possession-estimator differences). Run once post-backfill; results committed as `docs/espn-bbref-audit.md`.

**Explicitly not changed in Phase 2**:
- No prediction model changes. The model still reads `TeamState` as it does today.
- No features derived from box-score data get fed into v5 or v6 in this phase.
- No other sport's scraper touched.

### Phase 2 ship rules (pre-declared)

Phase 2 merges iff **all five** hold:

1. **Coverage (aggregate)**: ≥ 98% of post-2022 NBA games have a complete MUST-HAVE row after backfill.
2. **Coverage (per-season)**: ≥ 95% per-season MUST-HAVE coverage for each of the 3 seasons. Catches single-season holes that aggregate hides.
3. **Coverage (per-(team, season) cell)**: ≥ 94% MUST-HAVE coverage for each of 90 `(team, season)` cells (30 teams × 3 seasons). Tightened from round-2-draft 90% per-team-aggregate per round-2 DQ feedback — a team could pass 90% aggregate while having a single season at 60%. 94% per-cell = ~5 missing games per team per season, consistent with realistic ESPN hole rates (≤ 2-3% outside pathological scraper bugs); 90% aggregate was too permissive.
4. **Schema integrity**: No changes to `game_results`. No non-NBA rows in `nba_game_box_stats`. Migration idempotent + down-migration tested. UPSERT + `updated_at` + `first_scraped_at` + audit log verified by integration test (mutate a row, verify audit row written with change-detection guard active; no-op case verified to NOT write audit row).
5. **No regression elsewhere**: Full existing test suite green. Baseline + reliability runs on the current 21,694-game corpus produce bit-identical outputs vs. pre-Phase-2 (proves the data addition did not leak into model inputs). Cross-source audit: **raw counts exact match (0 discrepancies allowed)**, derived rates ≤ 2% of sampled rate-fields out of 1% tolerance.

Phase 2 failure modes and responses:
- **Coverage < 98% aggregate OR per-season/per-team floor missed**: investigate gaps. If systematic (e.g., a season's games missing from ESPN), document the hole in `learnings.md` and lower Phase 3's training window to the covered span. Don't synthesize missing rows.
- **Rate-limit issues during backfill**: pause backfill, re-plan with math expert on sampling, do not bypass rate limits.
- **Schema-drift warnings**: investigate; ESPN may have renamed a field. Fix scraper, re-run backfill for affected window.
- **Cross-source audit fails**: fix field-mapping bug in scraper before Phase 2 merges. This catches the common "we scraped the wrong JSON path" error that coverage gates miss.

## Phase 3 — Learned model (Python subprocess or ONNX, architecturally significant)

**Only begins if Phase 2 ships cleanly AND (Phase 1 shipped OR Phase 1 failed for a reason that does not invalidate Phase 3).** If Phase 1 showed rolling windows don't help NBA at all, the case for a richer model is weaker — re-council before starting Phase 3.

### Model families — commit to running both, ship the winner

Round-1 Prediction + Math feedback: in the tabular-~40-features-~4K-examples regime, gradient-boosted trees empirically dominate small MLPs (Shwartz-Ziv & Armon 2022; Grinsztajn et al. 2022). The plan originally defaulted to MLP; that default is inverted.

**Phase 3 runs MLP and LightGBM sequentially, not both on the test fold** (revised per round-2 Stats feedback: running two families through six gates with "either clears, winner ships" doubles the family-level ship-FPR — two shots at the test fold). Protocol:

1. **LightGBM evaluated first** against the six ship rules on the test fold (one touch of the fold).
2. **MLP evaluated on the test fold ONLY IF LightGBM fails one or more of the six rules.** If LightGBM clears all six, it ships; MLP is never evaluated on the test fold.
3. Both families are trained in parallel on train+val folds (hyperparameter search, calibration, early stopping, 20-seed ensemble), and both produce validation-fold Brier numbers. The validation-fold paired diff between families is reported for transparency, but the test fold is touched at most once per family per phase.
4. **Ship-preference rule**: if LightGBM fails and MLP passes, MLP ships. If both fail, neither ships; null result documented in `learnings.md`.

Why LightGBM first: Shwartz-Ziv & Armon 2022 and Grinsztajn et al. 2022 show tree models dominate small MLPs in the tabular-~40-features-~4K-examples regime; LightGBM is also simpler to interpret (native SHAP) and to deploy (single artifact, no ONNX). Running it first and only falling through to MLP on failure respects the ship-FPR budget.

**MLP starting architecture** (revised down per Math feedback; normalization swap per round-3 Math feedback):
- 2-layer MLP, hidden dims **16 → 8** (revised from 32 → 16; prior capacity was ~1,857 params at 2.2:1 examples:params, below safe-territory thresholds).
- Revised param count: 40·16 + 16 + 16·8 + 8 + 8·1 + 1 = **801 params**, ratio ~5:1 (effective-N-adjusted still borderline — accept as tradeoff).
- ReLU, dropout 0.2, **LayerNorm between layers** (swapped from BatchNorm per round-3 Math feedback). Rationale: the plan's serving spec (§Training protocol) uses weight-averaged ONNX export of 20-seed ensemble. Weight-averaging MLPs with BatchNorm is unsafe — BN's `running_mean`/`running_var` are not learned parameters (they're EMAs of per-batch activation statistics), and averaging them across seeds produces normalization stats that don't correspond to the averaged weights' forward pass (standard SWA gotcha per Izmailov et al. 2018 §3.2; the fix canonically requires a post-averaging BN-recomputation pass). LayerNorm normalizes per-example rather than per-batch, has no running statistics, and is well-behaved under weight averaging. For tabular MLPs at this scale the empirical performance gap between BN and LN is typically within noise, so the swap is defensible and eliminates the pipeline risk architecturally rather than via a post-hoc fix.

**LightGBM starting config**: 200 trees, max_depth=5, learning_rate=0.05, early stopping on validation fold (patience=20), L2 reg=0.1. Standard tabular defaults; grid-search {num_leaves, min_child_samples, reg_alpha} on training fold via nested CV.

### Loss function — pre-declared decision rule

- **MLP**: Brier loss (MSE on sigmoid output) **primary**, with BCE fallback. The rationale (corrected from round-2 draft which stated this backwards): Brier loss is a strictly proper scoring rule that **aligns training objective with the ship-gate eval metric** — the model is being optimized for exactly what it's being evaluated on. This is the principal reason to prefer Brier over BCE here, *not* gradient conditioning. In fact, Brier's gradient w.r.t. logit is `2(p−y)·p(1−p)`, which **vanishes as p→0 or p→1** — Brier has worse-conditioned gradients at the sigmoid boundary than BCE's `(p−y)`. That vanishing-gradient risk is exactly what the BCE fallback exists to handle.

  **Fallback trigger (tightened)**: fall back to BCE if, across the first 3 seeds trained, **three consecutive seeds show val-loss-at-best-epoch within 1% of val-loss-at-final-epoch** (captures "Brier training didn't converge" cleanly — if best and final val-loss are within 1%, the model stopped making progress, which is the vanishing-gradient signature). Single noisy epochs are explicitly NOT sufficient to trigger fallback; the tripwire requires cross-seed reproducibility of the non-convergence signal.
- **LightGBM**: binary logloss (the library default; equivalent to BCE, no free choice). Tree models don't share MLPs' gradient-boundary concern because they don't train via gradient descent through a sigmoid.

Focal loss is NOT considered (class imbalance isn't the problem — NBA home-win rate is ~58%).

### Calibration — pre-declared decision rule

On the 2024-25 validation fold (~1,200 NBA games, post-filter):
- **If validation calibration-fold size ≥ 1,500 games** (unlikely with just 2024-25, but check): **isotonic regression**.
- **Else**: **Platt scaling** (2-parameter logistic).

Niculescu-Mizil & Caruana (2005) show Platt wins when n ≲ 1,000 on the calibration fold and isotonic wins when n ≥ ~1,000–5,000. The 1,500 threshold sits inside that crossover, and Platt's lower variance is preferred for the boundary regime. This is pre-declared so post-hoc method selection based on "it calibrated better on val" is impossible.

### Normalization — per-feature bucketing

Round-1 Math feedback: Z-score on bounded [0,1] features (rates) is theoretically inappropriate. Feature bucketing:

- **Rate features** (eFG%, 3P-rate, FT-rate, OREB%, DREB%, TOV%, FG%, 3P%, FT%): **logit transform → Z-score** on training fold.
- **Count features** (rest days, games played, back-to-back count in last 7): **log1p → Z-score** on training fold.
- **Unbounded features** (point diff, ORtg, DRtg, Net Rating, travel distance): **Z-score** directly on training fold.

**Epsilon-clipping for logit (round-2 Math feedback + round-3 EWMA correction)**: for rate features in a rolling window, values can legitimately equal 0 or 1 (e.g., a team goes 0-for-3 from three in a game → rolling 3P% can hit 0 in small windows). `logit(0) = −∞` and `logit(1) = +∞` break Z-score computation.

Pre-declared epsilon by feature form (each rate clipped to `[ε, 1−ε]` before logit):

- **Rolling-N features**: `ε = 1/(2·N)` — the standard half-pseudocount rule. For N ∈ {5, 7, 10, 15, 20}: ε ∈ {0.100, 0.071, 0.050, 0.033, 0.025}.
- **EWMA features**: `ε = 1/(2·N_eff(h))` where `N_eff(h) = (2 − α) / α` is Kish's effective sample size with `α = 1 − 2^(−1/h)` (round-3 Math feedback: a prior draft used `ε = 1/(2·max_N)` uniformly, which is wrong for EWMA — the "N" that matters for pseudocount is the effective sample size, not the half-life). For h ∈ {5, 10, 15, 20}: `N_eff` ≈ {14.4, 28.9, 43.3, 57.7} → ε ∈ {0.0347, 0.0173, 0.0115, 0.0087}.

Using the wrong ε for EWMA would systematically bias the inner-CV feature-form selection toward rolling-N (over-aggressive clipping on EWMA shrinks extreme rates toward 0.5, reducing discriminative signal). Per-feature-form ε is committed into `ml/nba/features.py` as a typed config keyed by `(feature_form, window_size)`.

Rationale on the common case: `1/(2·N_eff)` is the standard "add half a pseudocount" rule; keeps logit finite while not materially distorting non-boundary values (logit(0.975) − logit(0.95) ≈ 0.7 in z-space — visible but bounded).

Z-score / logit / log1p parameters frozen from training fold, applied to val + test + live. This bucketing is committed into `ml/nba/features.py` as a typed config, not inferred at runtime.

### Features (Phase 3 feature list, revised per Domain feedback)

**Team-quality features (the core):**
- **Net Rating** (ORtg − DRtg), rolling-N. This is the single strongest team-quality feature in modern NBA work.
- **Opponent-adjusted Net Rating**: `rolling_ORtg_team − rolling_DRtg_opp_avg` and the symmetric version. Simple SoS correction — not full SRS, but catches the "dominant against tomato cans" failure mode of raw rolling Net Rating. Full SRS deferred to post-pilot work.
- `rolling_ORtg`, `rolling_DRtg` (per-100-possession; NOT per-game PPG).
- `rolling_eFG%_off`, `rolling_eFG%_def`.
- `rolling_TOV%_off`, `rolling_TOV%_def`.
- `rolling_OREB%`, `rolling_DREB%`.
- `rolling_3P_rate_off`, `rolling_3P_rate_def`. **Rolling 3P% is explicitly NOT used as a skill signal** — it's a luck feature with high variance on N-game windows; 3P-rate is the skill-persistent version. Documented here to prevent well-meaning additions later.
- `rolling_AST_per_possession`, `rolling_STL_per_possession`, `rolling_BLK_per_possession`.

**Schedule / situational features:**
- `rest_days` (both teams).
- **B2B split**: separate flags for `b2b_home`, `b2b_road_second_night` (the classic NBA "fade spot"). Single B2B flag is replaced.
- `rest_days_in_last_7` (captures 3-in-4, 4-in-5 density).
- `travel_distance_km` (if available from schedule data).
- `circadian_penalty_flag`: visitor traveling **≥ 3 time zones eastward** for the current game (round-2 Domain feedback: replaces prior clock-time formulation ("≤1pm-local-time") with the time-zone-delta formulation from Roy & Forest and related sleep-research literature, which is the actual mechanism — circadian phase shift, not clock time per se). Catches the canonical 11am-ET tip for a west-coast visitor while excluding false positives like east-coast-to-east-coast early games.
- `is_denver_home` (altitude flag; ~1pp effect above generic home advantage; low cost).
- `is_home` (primary home/away feature; see §Home advantage below).

**Lineup / continuity features:**
- `games_played_together_top5` (top-5-minutes lineup's shared-game count this season) — proxy for lineup continuity. **Requires player-level minutes data, which is NOT in Phase 2 MUST-HAVE as currently specified.** Round-2 Domain feedback flagged this as a material gap: lineup continuity is arguably the single most underrated team-quality feature in the 2025-26 CBA/apron era (Celtics/Nuggets/Thunder stability vs. Clippers/Suns churn). If Phase 2 does not add player-level minutes to MUST-HAVE in a follow-up revision, Phase 3 ships without continuity features and the Phase 3 results addendum must explicitly flag: "shipped without continuity features leaves documented modern-NBA signal on the table." Decision on whether to expand Phase 2 MUST-HAVE deferred to Phase 2 plan-review.

**Home / away separation**: separate rolling windows for home games and away games maintained per team.

### Inherited constants — resolved, not inherited silently

Round-1 Domain feedback: inheriting v5's frozen constants into a learned model double-counts. Pre-declared resolutions:

- **Home advantage**: `is_home` is a feature. The model learns home advantage *jointly*. The 2.25-point post-hoc shift from v4-spread is NOT applied at Phase 3 inference. Winner-model must learn an effective home-advantage comparable to (within 0.5pt of) v4-spread's 2.25 on validation; if not, flag in implementation review.
- **Injury compensation**: injury signal is a **feature** (`home_out_impact`, `away_out_impact` exposed per the existing ESPN-scraper output), NOT a post-hoc 40% multiplicative adjustment. Post-hoc adjustment was calibrated against the v5 formula and is not applicable to a learned model. The 40% constant is retired for Phase 3 predictions (still used for v5 and v4-spread).
- **Streak flag**: feature-in, ablation-tested. Phase 3 implementation trains two variants per family (with streak flag, without). **Pre-declared streak-ablation test**: if streak-off Brier is within **0.002** of streak-on Brier on the *validation* fold, the streak-off variant is what evaluates on the test fold (the flag is retired). Otherwise streak-on variant evaluates. Decision is made on val fold, not test fold — test-fold-hygiene preserved.

### Training protocol

- **Splits**: pre-2024 train, 2024-25 validation (for calibration + early stopping), 2025-26 test (held out, touched at most once per family per phase per §Model families sequential discipline).
- **Hyperparameter grid size declared**: MLP grid = 3×3×2 = 18 configs (learning_rate × dropout × weight_decay); LightGBM grid = 3×3×2 = 18 configs (num_leaves × min_child_samples × reg_alpha). **Nested time-ordered 5-fold CV *within training fold* for hyperparameter selection AND for EWMA-vs-rolling-N feature-form selection** (round-3 Stats feedback: folds must be time-ordered forward-chaining, NOT random — random folds would allow a 2023 game to be scored by a model trained on 2024 games, leaking feature-form selection across time). Forward-chaining 5-fold splits the pre-2024 training window into 5 contiguous time slices; fold `k` trains on slices 1..k and scores slice k+1 (standard time-series CV). **CV aggregation rule (round-4 Stats pin)**: the inner-CV score is **per-game-pooled Brier across all 5 held-out slices** (equivalent to fold-size-weighted mean), NOT unweighted mean of per-fold Brier. With fold sizes varying ~4× (fold 1 ≈ 580 held-out games vs fold 4 ≈ 2,320), per-fold-mean would weight fold 1 ~4× more per game than fold 4 and distort selection. Feature-form grid: 5 rolling-N values × 4 EWMA half-lives = 9 candidates, scored via per-game-pooled Brier across inner folds, single winner moves to test fold. Validation fold (2024-25) reserved for calibration + early stopping only. Final hyperparameters frozen before test-fold touch.
- **No hyperparameter tuning on the test fold.**
- **Val-fold coupling (acknowledged risk, round-2 Stats feedback)**: calibration (Platt/isotonic fit) and early stopping both use the 2024-25 validation fold. These two val-fold uses are conditionally coupled: calibration is fit on a model whose stopping point was val-fold-selected. This is mild leakage; acknowledged here rather than fixed via further splitting because (a) calibration methods (Platt with 2 params, isotonic with monotone constraint) are very low variance and don't materially overfit 1,200 games, and (b) splitting the ~1,200-game val fold further reduces it below the calibration-stability floor. Accepted tradeoff.
- **Seed control**: fix seeds, **run 20 seeds** (raised from 5 per Math feedback — SE of sample std at n=5 is ~35% of the std itself, making the 0.005 threshold uninterpretable). Report mean ± std across 20 seeds on validation.
- **Seed-instability gate**: upper-bound of 95% bootstrap CI on seed-std (bootstrap over 20 seeds) must be ≤ 0.008 Brier. If it exceeds, treat point estimate as untrustworthy and re-council before test-fold evaluation.
- **Final test-fold evaluation**: **seed-ensemble** (mean of 20-seed predictions) rather than median-seed-model. Ensemble is more standard and uses all the compute we already paid for.
- **Serving artifact (round-2 Prediction feedback)**: production serves the **averaged-weights ONNX** export of the 20-seed ensemble — for identical architecture from identical init with only seed-varying SGD noise, weight averaging approximates ensemble-prediction-averaging with ~1-2 bp Brier cost and no multi-forward-pass latency. Pre-declared: if weight-averaged Brier on val fold is > 0.005 worse than mean-of-predictions Brier, switch to predict-and-average (20 ONNX forward passes per prediction; acceptable at our twice-daily batch cadence). This decision is made on the val fold before test-fold touch.
- **Results reporting (round-2 Math N4 feedback)**: results addendum must report BOTH the 20-seed mean single-seed val-Brier AND the ensemble val-Brier so the ensemble's gain over single-seed is visible and the seed-std gate is contextualized.
- **Deterministic replay**: commit training script, training data hash, and final model weights. A second run on the same commit must reproduce the test-fold Brier to within 1e-4.

### Time-machine rule (no look-ahead, tightened)

Phase 3 inherits type-enforced temporal discipline: training examples use features computed from games strictly before the target game's date. `PredictionContext.asOfDate` and the backtest team-state snapshot are the TS-side guards; the Python side consumes a pre-computed parquet.

**Additions from round-1 Math feedback (newly pre-declared):**
- **All league-wide normalization constants** (league-average pace, league-average ORtg, league-average Net Rating) are computed **using only data with `date < asOfDate`**. No global-statistic leak.
- **Unit test required**: `test_time_machine_feature_purity.py` computes the feature vector for a 2021 game twice — once with the full DB, once with the DB filtered to `date < asOfDate`. Vectors must be bit-identical. This is a Phase 3 implementation-review requirement, not optional.
- Parquet schema versioned: `features/schema_v1.json` committed alongside model weights; CI check ensures parquet conforms.

### Rule-regime disclosure (new, per Domain feedback)

The training window (pre-2024) straddles at least two NBA rule-regime boundaries:
- **2023–24 rule changes** (transition take-foul rule, continuation-call emphasis) affected pace and FT rates mid-window.
- **2023 CBA second-apron restrictions** altered roster construction starting 2023–24; pre-apron and post-apron seasons are different regimes for lineup-continuity features.

Phase 3 plan's results addendum must disclose the training-window span and a sensitivity check: does restricting training to post-2023 data (single-regime) change the test-fold Brier by more than the ship-gate threshold? If yes, consider single-regime training with smaller N. **The sensitivity check must also recompute normalization params (logit+Z, log1p+Z, Z) on post-2023-only data** (round-2 Math N5 feedback — normalization fit on full pre-2024 training fold includes pre-regime data; if regime change shifts league-average pace by 1-2 possessions/game, the Z-score centering is wrong for test-fold games). Report both single-regime-model-with-full-norm and single-regime-model-with-single-regime-norm variants.

### EWMA half-life as a Phase 3 grid axis (Domain feedback, deferred from Phase 1)

Phase 3 grid-searches an **EWMA feature variant** alongside rolling-N: half-lives `h ∈ {5, 10, 15, 20}` games. Hard rolling windows have a discontinuity at N+1 that EWMA smooths; NBA's dense schedule makes that discontinuity visible. Best-of(rolling-N, EWMA-h) on training fold is the feature form that moves to test.

### Phase 3 ship rules (pre-declared, round-2 tightened)

The learned model (best family between MLP and LightGBM) replaces v6 (or v5, if Phase 1 did not ship) for NBA live predictions iff **all six** hold:

1. **Brier beat over incumbent**: learned-model Brier on the 2025-26 test fold beats the incumbent by at least **0.010 absolute** with 95% **block-bootstrap paired** CI entirely below zero. Bootstrap spec: **B = 10,000**, blocks = `(home_team, week)` per §Effective sample size. The prior self-referential `max(0.010, Phase-1/2)` clause is dropped — 0.010 absolute is the floor; if Phase 1 already delivered most of that gap, Phase 3 still has to beat incumbent-best (v6) by 0.010, which naturally keeps the bar meaningful.

   **Point-estimate reporting (round-2 Prediction feedback)**: a point estimate below 0.015 clears the gate if the CI condition holds, but must be flagged in the results addendum as "under-performing modern-NBA-literature expectations" (0.015–0.025 Brier lift is the public-work band for SoS-adjusted Net Rating + schedule granularity), and prompts a feature-engineering post-mortem before live swap. This is disclosure, not a gate move.

   **v5 validation-fold Brier anchor**: to be computed by the Phase 1 pre-flight diagnostic and committed to this plan pre-CLEAR (see §Phase 1 pre-flight). Enables readers to interpret 0.010 absolute in relative terms.

   **Power check (pre-declared, noise model pinned)**: before test-fold touch, compute expected paired-diff block-bootstrap SE on the training fold from a v5-vs-{v5+empirical-noise} simulation. **Noise model**: residuals from v5 on the 2024-25 validation fold, added back as **logit-space Gaussian noise** with σ matched to the empirical std of the v5 logit-residuals on that fold. SE computation uses the **same block scheme (`(home_team, week)`, B=10,000)** as the final ship-gate CI — self-consistent. If expected SE > 0.0033 (→ 0.010 is < 3σ), flag for council — the test-fold size may be insufficient and we abandon rather than run an underpowered gate. Pre-flight SE estimate is committed to this plan pre-CLEAR alongside the v5 Brier anchor.
2. **Calibration**: reliability verdict = HONEST on the test fold, ECE ≤ incumbent ECE.
3. **Margin model parity**: learned margin head (if built) weightedMAE ≤ incumbent weightedMAE, verdict HONEST. If margin head not built in Phase 3, incumbent margin model stays in place and this rule is N/A.
4. **Calibration honesty at extremes (revised)**: replaces the prior `n≥50 bin-resid ≤ 0.08` rule (which excluded the extreme bins it was meant to police and had ~99% false-alarm rate across 10 bins per Stats analysis). **New rule**: `max |bin_resid|` over all bins with `n ≥ 20` must be `≤ max(0.05, v5_max_bin_resid + 0.02)`. This is a *relative* gate (tied to the incumbent), catches extreme-bin failures at lower n, and doesn't inflate false-alarm rate by spreading tests across many thresholds.
5. **Shadow parity for ≥ 28 game-days OR ≥ 500 predictions, whichever hits first**: learned model runs in shadow mode via the PR #38 infrastructure until EITHER 28 NBA game-days elapse OR 500 live shadow predictions accumulate, whichever comes first. Forward Brier over that window must satisfy a **paired-CI formulation** (revised from round-2 draft's 0.02 tolerance, per round-2 Prediction feedback — at N=500 the Brier SE is ~0.019, so the 0.02 gap tolerance had ~30% false-fail rate from pure sampling noise on a well-calibrated model): the 95% block-bootstrap paired CI on (shadow-Brier − test-Brier) **must include zero**.

   **Power characterization (round-3 + round-4 Stats disclosure, corrected)**: shadow window and test fold are *disjoint samples* (different games entirely), not paired observation-by-observation, so the shadow-vs-test Brier diff has no per-prediction correlation to exploit — ρ ≈ 0. At N=500 with σ(per-game Brier) ≈ 0.09–0.10, σ_diff = σ·√2 ≈ 0.027 and 95% CI half-width ≈ 0.053 Brier. This formulation **reliably catches material train/serve skew (>0.06 Brier)** — gross feature-mapping errors — but has **low power against moderate skew (0.01–0.05 Brier)**. This is a more permissive gate than round-3 draft claimed (which erroneously assumed a paired correlation structure). The reason this is still acceptable: the **time-machine unit test** in §Time-machine rule is the primary guard against feature-formula divergence and runs at implementation review *before* shadow opens; shadow-parity is a secondary catch for gross pipeline faults (e.g., Python training vs TS inference reading different DB columns), which produce large deltas well above the 0.06 threshold. Moderate skews (0.01–0.05) that slip through shadow-parity surface in longer-term live monitoring and in the next reliability review cycle. Accepted tradeoff per §Multiple-comparisons discipline (ship-FPR over ship-FNR).

   **Load-management partition diagnostic (round-2 Domain feedback, pre-declared)**: when the shadow window closes, Phase 3 results addendum partitions shadow predictions by `star_rested` (any All-Star-level player DNP-rest or DNP-coach's-decision that morning) vs. `full_strength`, and reports Brier on each partition. If shadow-vs-test divergence fires (paired CI excludes zero), this partition is the first diagnostic and often identifies load-management as the culprit (the injury-signal feature catches confirmed DNPs but not day-of strategic rest). Partition is a diagnostic, not a gate — but pre-declaring it prevents ad-hoc post-mortem explanations.
6. **Interpretability utility**: `scripts/explain-prediction.ts` exists before live swap, reports per-feature contribution (SHAP for LightGBM winner; integrated gradients × input for MLP winner). If this is not built, we are not ready to answer "why did the model pick team X" in a reliability-review context.

Phase 3 failure modes and responses:
- **Rule 1 fails**: do not ship. Document null result, do not rerun on new splits looking for a win (would p-hack the test fold). The test fold is burned.
- **Rule 1 power check fails** (expected SE > 0.0033): abandon the phase; we lack the data for a clean gate. Re-council on whether to wait for more test data or proceed with wider CI tolerances.
- **Rule 1 passes, rules 2-6 fail**: do not ship. Add the gap to a follow-up debt, re-council on next steps.
- **Shadow-vs-test divergence (rule 5)**: indicates train/serve skew (typically a feature-computation mismatch between Python training and TS inference). Fix the pipeline, re-shadow — do not adjust the rule.

## Shared guards across all phases

- **Other sports untouched.** Any change that alters NFL / MLB / NHL / MLS / EPL reliability or baseline output is a bug, not a feature. Enforced by the "bit-identical output for non-NBA sports" gate in every phase.
- **Shadow-first before live swap.** Every phase that introduces a new live prediction runs via the PR #38 shadow-logging infrastructure before becoming the primary model.
- **In-sample disclosure.** Every phase documents what was calibrated on what fold. The NBA home-advantage recalibration precedent (`Plans/nba-home-adv-recalibration.md:72-76`) is the template — honest about in-sample caveats, forward validation belongs with shadow logging.
- **Council review at three gates per phase**: plan review → CLEAR (or WARN with mitigations pre-declared), implementation review → no FAIL, results review → ship rules verified. Skipping a gate is a CRITICAL FAILURE per `feedback_council_discipline.md`.
- **Test fold is write-once per phase.** 2025-26 NBA games are touched ONCE per phase (per family for Phase 3) for the ship gate. Re-running on the test fold to "see if it works now after a tweak" is p-hacking and is banned. If Phase 3 runs after Phase 1 shipped, it is a second look at the 2025-26 fold against a now-shipped baseline (v6), which is allowed because v6 is fixed before Phase 3 touches the fold.
- **Conjunctive-rules tradeoff accepted**: ship-FNR is inflated. We prefer false-rejects to false-ships because incumbent is calibrated. Documented in §Multiple-comparisons discipline.

## Rollback strategy

Every phase must support instant rollback:

- **Phase 1**: v6 model version coexists with v5 in `model_version` column. Flip `NBA_LIVE_MODEL` config back to `'v5'` to roll back. Historical predictions under both versions stay in the DB for post-mortem.
- **Phase 2**: `nba_game_box_stats` is additive; dropping the table restores prior state. Scraper changes behind `SCRAPE_BOX_STATS=true` feature flag. The retroactive-correction re-fetch job behind `BOX_STATS_RECHECK_WINDOW_DAYS=7` (set to 0 to disable).
- **Phase 3**: model artifact versioned by commit SHA; inference layer reads `NBA_LIVE_MODEL` env var. Python subprocess (if used) runs in a sidecar; disabling the sidecar falls back to the TS model.

## Explicit non-scope

- **No cross-sport rollout in this plan.** Even if Phase 3 wins big on NBA, applying it to NFL / MLB / NHL / MLS / EPL is a separate plan, separate council, separate ship rules. Sport-specific data characteristics make "it worked on NBA" a weak transfer argument.
- **No betting / odds / EV changes.** This plan is about win-probability and margin prediction only. ATS edge detection stays on v4-spread throughout.
- **No UI changes.** Reporting layer reads whatever model_version is live; no dashboard rebuild required.
- **No ternary (W/D/L) output for NBA.** NBA has no draws; the Phase 3 output head is binary.
- **No live retraining / online learning.** All models in this plan are trained once per release. Scheduled retraining is a separate debt if the pilot succeeds.
- **Full SRS / strength-of-schedule beyond naive opponent-adjusted Net Rating is out of scope.** Simple SoS-adjusted Net Rating is in Phase 3; full SRS / Massey / iterative SoS is post-pilot.
- **Streak flag removal only via pre-declared ablation.** See §Phase 3 inherited constants.
- **Load-management variance.** NBA "rest DNPs" (load management) are a known un-modeled variance source. Not addressed in this plan; flagged as future work if Phase 3 ships and the shadow-window Brier divergence correlates with star-rest events.
- **Rolling 3P% as a skill signal.** Explicitly banned. 3P-rate is the skill-persistent feature; rolling 3P% is luck.

## Known risks

1. **Overfitting on ~4,100 games with ~40 features (effective N ~800-2,000).** Mitigated by: small model capacity (16/8 MLP, 5-level LightGBM trees), dropout/regularization, early stopping on validation fold, 20-seed variance reporting with bootstrap-CI gate, block-bootstrap evaluation. If validation variance is high (upper 95% bootstrap-CI on seed-std > 0.008), treat the point estimate as untrustworthy.
2. **Box-score data gaps / inconsistencies across seasons.** ESPN's box-score format has historically changed. Phase 2 coverage gate + Zod schema-drift detection + cross-source audit catch this. Fixing gaps may require manual reconciliation; budget accordingly.
3. **Calibration loss ≠ calibration at the extremes.** Addressed by post-hoc Platt/isotonic scaling (pre-declared by val-fold size) and rule 4 (relative per-bin-resid ceiling). If calibration itself overfits the validation fold, the shadow-parity rule 5 catches the serving-time divergence.
4. **TS/Python interop maintenance cost.** Two languages = two dependency trees, two CI pipelines. Phase 3 plan review must compare this cost to the marginal Brier gain. Preferred architecture (ONNX) single-language at serving time; Python only at training time.
5. **Interpretability regression.** v5's output is a simple formula; the learned model is less inspectable. Rule 6 (SHAP / integrated gradients utility) is the mitigation. Council must agree the utility is sufficient before ship.
6. **Train/serve skew.** Feature computation in Python (training) vs. TS (live inference) can drift. Rule 5 (28-game-day-or-500-pred shadow window, paired-CI formulation) catches this empirically. The time-machine unit test (§Time-machine rule) catches the most common subtype.
7. **Rule-regime averaging** (pre-apron vs post-apron seasons, pre-2023 vs post-2023 rule changes). Disclosed in Phase 3 results addendum; sensitivity check is part of the plan (see §Rule-regime disclosure).
8. **Load-management / strategic star-rest** is not in the feature set as a dedicated signal. Pre-declared shadow-window partition diagnostic (§Phase 3 rule 5) surfaces it if divergence fires. Post-ship debt if the partition reveals material Brier gap.
9. **Mid-window roster trades (round-2 Domain feedback)**: NBA trade deadline (typically Feb 6) can alter a team's Net Rating in 5-10 games, within the rolling-N window. Rolling features for teams with material trades are noisy for the post-deadline stretch. Not in feature set. Phase 3 results review must flag any team that traded a top-3-minutes player mid-window and check whether shadow-window residuals correlate with post-trade games. If material, consider a reset-flag in follow-up work.

## Files this plan will touch (per phase)

**Phase 1**:
- `src/analysis/predict.ts` — new `v6` model function alongside existing `v5`
- `src/analysis/predict-runner.ts` — rolling-N field on `TeamState`, cold-start-at-15-games fallback, new reasoning JSON
- `src/analysis/backtest.ts` — window-length grid search helper, block-bootstrap paired-CI helper
- `scripts/phase1-preflight-correlation.ts` — pre-flight diagnostic (new)
- `Plans/nba-learned-model.md` — this file (addendum after Phase 1 results). Rename from `nba-neural-net.md` happens in the Phase 1 commit.

**Phase 2**:
- `src/scrapers/espn.ts` — box-score endpoint client, rate-limited
- `src/scrapers/espn-box-schema.ts` — Zod schema for schema-drift detection (new)
- `src/storage/sqlite.ts` — schema migration for `nba_game_box_stats` + `nba_box_stats_audit` + `scrape_warnings`
- `scripts/backfill-nba-box-stats.ts` — one-shot backfill (new)
- `scripts/recheck-recent-box-stats.ts` — 7-day re-fetch cron job (new)
- `scripts/audit-espn-box-stats.ts` — one-shot basketball-reference cross-source audit (new)
- `src/analysis/data-health.ts` — per-season + per-team coverage report
- `docs/espn-bbref-audit.md` — cross-source audit results (new, committed post-backfill)
- `Plans/nba-learned-model.md` — addendum after Phase 2

**Phase 3**:
- New: `ml/nba/train.py`, `ml/nba/features.py`, `ml/nba/calibrate.py`, `ml/nba/infer.py` (or `.onnx` artifact)
- New: `ml/nba/lgbm_train.py`, `ml/nba/mlp_train.py` (per-family training entry points)
- New: `ml/nba/tests/test_time_machine_feature_purity.py` (time-machine unit test — required for implementation review)
- New: `ml/nba/features/schema_v1.json` (parquet schema contract, versioned with model weights)
- New: `ml/nba/artifacts/` (gitignored; model weights + normalization params committed via release artifact)
- `src/analysis/predict.ts` — `v7` inference shim that calls Python or ONNX
- `src/analysis/predict-runner.ts` — v7 wiring, shadow-logging variant
- `scripts/explain-prediction.ts` — per-prediction feature contribution (SHAP for LGBM, IG for MLP)
- `Plans/nba-learned-model.md` — addendum after Phase 3 (includes rule-regime sensitivity disclosure)

## Council verdict on this plan

**Status**: round-3 revision. Round-1 returned 5× WARN. Round-2 returned 3× CLEAR (DQ, Pred, Domain) + 2× WARN (Stats 8/10, Math 7/10), all residual items pre-declarable. Round-3 addresses every round-2 residual item:

**Round-3 fixes (exhaustive):**
- [Math N2] **Logit ε-clip** pinned: `ε = 1/(2·max_N)` pseudocount rule (§Normalization).
- [Math] **Brier-loss rationale rewritten** to cite proper-scoring-rule alignment with eval metric (was mis-stated as gradient-conditioning; Brier actually has vanishing gradients at the sigmoid boundary, which is why the BCE fallback exists).
- [Math N1] **Brier→BCE fallback trigger tightened** to "3 consecutive seeds show val-loss-at-best-epoch within 1% of val-loss-at-final-epoch."
- [Math N3 / Stats C / Pred N1] **Power-check noise model pinned**: empirical v5 logit-residuals on 2024-25 val fold, logit-space Gaussian matched-σ, same `(home_team, week)` block-bootstrap scheme as final CI. Pre-flight SE committed to plan pre-CLEAR.
- [Math N4] **Seed-ensemble reporting**: results addendum reports both 20-seed mean single-seed val-Brier AND ensemble val-Brier.
- [Math N5] **Regime sensitivity check expanded**: also recomputes normalization params on post-2023-only data.
- [Stats A] **Two-family FPR inflation fixed**: sequential discipline — LightGBM evaluated first; MLP evaluated only if LightGBM fails ≥1 of 6 rules. Prevents doubling the ship-FPR.
- [Stats B] **Val-fold coupling** (calibration + early-stopping same fold) acknowledged as accepted risk with rationale (calibration methods are low-variance; splitting 1,200 games further hurts more than it helps).
- [Stats D] **Block definition pinned** to `(home_team, week)` — eliminates game-level duplication that `(team, week)` had.
- [Stats E] **Feature-form selection uses nested inner-CV**, not full-training-fold fit (9 candidates: 5 rolling-N × 4 EWMA-h).
- [Pred N2] **v5 val-fold Brier anchor**: to be committed by Phase 1 pre-flight diagnostic pre-CLEAR.
- [Pred] **Point-estimate reporting**: sub-0.015 Brier beat clears the gate but must flag "under-performing modern-NBA-literature expectations" (0.015-0.025 band) and prompt feature-engineering post-mortem.
- [Pred N3] **Serving-artifact spec**: weight-averaged ONNX export of 20-seed ensemble; fallback to predict-and-average if weight-averaging degrades val Brier >0.005.
- [Pred N4] **Rule 5 shadow tolerance**: replaced 0.02 absolute tolerance with **paired 95% block-bootstrap CI on (shadow-Brier − test-Brier) must include zero** — sampling-noise-aware.
- [DQ NEW-1] **Cross-source audit tolerance split**: raw counts exact match; derived rates 1% tolerance.
- [DQ] **Per-team coverage floor tightened** to 94% per-(team, season) cell (from 90% per-team-aggregate).
- [DQ NEW-2] **`first_scraped_at` column** added to `nba_game_box_stats` alongside `updated_at` for correct audit/cache semantics.
- [DQ NEW-4] **Audit-row change-detection**: only write audit row if at least one MUST-HAVE field actually changed.
- [Domain] **Player-minutes / lineup continuity** flagged explicitly: not in Phase 2 MUST-HAVE as currently specified; decision deferred to Phase 2 plan review; results addendum must flag if shipped without continuity features.
- [Domain] **Load-management partition diagnostic** pre-declared (shadow partition by star-rested vs full-strength).
- [Domain A] **Circadian flag reformulated** to time-zone-delta (≥3 east) vs prior clock-time.
- [Domain C] **Mid-window roster trades** added to risk #9 with trade-deadline diagnostic.

**Round-4 fixes (applied after round 3):**
- [Math, material] **BatchNorm → LayerNorm** in MLP architecture. Eliminates the SWA weight-averaging gotcha (BN running statistics don't average sensibly across independent seeds) architecturally. Alternative of post-average BN recomputation rejected as more fragile than architectural fix.
- [Math, material] **Per-h EWMA ε formula**: ε = 1/(2·N_eff(h)) with Kish's formula `N_eff(h) = (2−α)/α`, `α = 1 − 2^(−1/h)`. Prior `ε = 1/(2·max_N)` for EWMA was over-aggressive and would have biased inner-CV feature-form selection against EWMA.
- [Stats NEW-1] **Time-ordered (forward-chaining) 5-fold inner CV**. Explicitly disallows random folds, which would have leaked feature-form selection across time.
- [Stats NEW-2] **Rule 5 power-characterization disclosure**: paired-CI at N=500 reliably catches material skew (>0.025) but has low power against mild skew (<0.010). Disclosed in the rule itself; accepted tradeoff consistent with §Multiple-comparisons.

**Expected round-4 council focus areas:**
- **Math**: does the LayerNorm swap change the recommended hidden-dim ratio or dropout? Does the per-h EWMA ε need additional boundary handling at the extreme half-lives (h=5 → ε=0.035 is larger than many rolling-N ε values — any second-order effects)?
- **Stats**: with time-ordered CV + 5 slices, each inner fold's training set varies from ~580 games (fold 1) to ~2,320 games (fold 4); does this produce heterogeneous per-fold variance that's worth block-bootstrapping inside each inner fold as well?
- **Prediction Accuracy**: does the rule-5 power disclosure change the ship-decision framing for mild skew? (No — the time-machine unit test is the intended guard, not shadow-parity.)
- **Data Quality / Domain**: round-3 CLEAR; no changes in round 4 that touch their review surfaces.

Deviating from this plan during implementation requires a fresh council pass. No silent scope drift across phase boundaries.

---

## Pre-flight addendum — 2026-04-24 (append-only; Phase 1 pre-flight results)

Per §Phase 1 pre-flight, three numbers were to be committed pre-implementation. Ran `scripts/phase1-preflight-correlation.ts` against the live NBA corpus (21,694 games, of which 1,321 fall in the 2024-10-01 .. 2025-10-01 validation fold).

### Results

| Quantity | Value | Pre-declared threshold | Disposition |
|---|---|---|---|
| v5 NBA Brier on 2024-25 val fold | **0.2161** (N=1321, low-confidence=78) | — (anchor only) | Committed as incumbent anchor |
| Pearson r, season-diff gap vs per-game margin | **0.4157** (N=1305) | — | Baseline |
| Pearson r, rolling-N diff vs margin, N=5 | 0.3494 (N=1243) | — | |
| Pearson r, rolling-N diff vs margin, N=7 | 0.3735 (N=1212) | — | |
| Pearson r, rolling-N diff vs margin, N=10 | 0.3939 (N=1166) | — | |
| Pearson r, rolling-N diff vs margin, N=15 | 0.4097 (N=1086) | — | |
| Pearson r, rolling-N diff vs margin, N=20 | **0.4288** (N=1010) — best | — | |
| Δ(best rolling − season) | **+0.0131** | Δ ≥ 0.02 absolute | **FAIL (premise not met)** |
| Empirical logit-residual σ (noise scale) | 4.3525 | — | |
| Paired-diff bootstrap mean (v5 vs v5+noise) | 0.1681 | — | |
| Paired-diff bootstrap SE | **0.01163** | SE ≤ 0.0033 (→ 0.010 is 3σ) | **FAIL (underpowered)** |
| Block count `(home_team, ISO-week)` | 721 | ≥ 50 stability floor | PASS |
| Bootstrap resamples B | 10,000 | — | PASS |

### Disposition per pre-declared rules

- **Premise check FAILED.** Best rolling-N exceeds season-diff by only +0.0131 absolute Pearson, below the pre-declared 0.02 threshold. Per §Phase 1 pre-flight step 2: "If best rolling-N correlation does not exceed season-diff correlation by at least 0.02 (absolute Pearson), Phase 1 is unlikely to pass rule 1 and we should re-council before writing v6 code." The rolling-window premise is weakly supported on 2024-25 NBA data — the signal exists (longer N's beat season-diff by small margins, and rolling-N improves monotonically with N from N=5 to N=20) but doesn't clear the cheap-falsifier bar. Notably, **N=20 won the grid, not a shorter window** — "more data helps" dominates "recency helps" in this corpus.

- **Power check FAILED.** Paired-diff SE ≈ 0.0116, ~3.5× the 0.0033 threshold. Per §Phase 1 pre-flight step 3: "If SE > 0.0033, even Phase 1's 0.010 gate is underpowered on current test-fold size and we re-council." The 0.010 Brier-beat floor would be < 1σ under the current noise-model simulation — statistically undetectable.

- **Methodology flag for re-council:** the power-check noise model, as specified in the plan (§Phase 3 rule 1 power check), adds logit-space Gaussian noise with σ matched to empirical `logit(y_clip) − logit(p_v5)` residuals. On this data that σ = 4.35, corresponding to very large per-game logit perturbations. This produces a v5-vs-(v5+noise) comparison that is NOT analogous to a v5-vs-v6 comparison (where v6 is a marginal refinement of v5). The pre-declared 0.0033 threshold implicitly assumed a near-v5 competitor; the as-written noise model produces a far-from-v5 competitor, inflating SE mechanically. The spec was council-CLEAR at round 3 but its empirical consequence was not foreseen by any reviewer. Re-council should decide: **(a)** keep the noise model as-written and accept Phase 1 cannot run (premise + power both FAILED honestly), **(b)** revise the noise model to a marginal-improvement proxy (e.g., σ = std of `logit(p_platt) − logit(p_v5_raw)` from a Platt fit — how far a calibrated v5 is from raw v5 — a realistic marginal-improvement scale), or **(c)** proceed to Phase 2 regardless, since Phase 2 is independently useful per §Phase 1 rule-1-failure response.

### Pre-declared response path

Per §Phase 1 failure modes: "If rule 1 fails, document the null result in `learnings.md` and SKIP to Phase 2 (data plumbing is independently useful for reporting / Phase 3 regardless)." The premise failure here is pre-rule-1 (caught at pre-flight, before any v6 code was written — as intended). The explicit plan response is to skip to Phase 2; the power-check failure compounds this by suggesting Phase 3's gate would also be underpowered even if Phase 2 landed.

**Next gate: re-council plan review** on the methodology question (noise-model revision) AND on the forward path (abandon Phase 1 entirely, proceed to Phase 2, or revise-and-re-run). No v6 code written; test fold untouched; Phase 1 implementation branch (`claude/nba-learned-model-phase-1`) holds this addendum and the pre-flight script only.

Pre-flight script: `scripts/phase1-preflight-correlation.ts`. Deterministic in its data reads; the bootstrap resampling uses `Math.random()` without a seed (re-runs produce slightly different SE at the ~0.0001 level, well inside the 0.0116 estimate). DB-read-only; no writes.

---

## Pre-flight addendum v2 — 2026-04-24 (methodology revision)

**Status**: methodology re-council CLEAR (3/3 experts: Math, Stats, Prediction Accuracy — unanimous). Applied before re-running pre-flight.

### Problem

Addendum v1's power-check implemented the plan's §Phase 3 rule 1 noise-model spec literally: logit-space Gaussian noise with σ matched to `logit(y_clip) − logit(p_v5)` empirical std. On 2024-25 NBA data σ = 4.35, which simulates a competitor whose logit is perturbed by ~±4 per game — a totally-different model, not a marginal-improvement competitor. Resulting SE=0.0116 is ~3.5× the 0.0033 threshold, but the threshold was derived under an implicit near-v5-competitor assumption. Spec-empirics mismatch, not a threshold issue.

### Revised methodology (pinned pre-rerun, per Stats requirement)

**Proposal A — empirical v5-vs-(v5-with-rolling-20-feature-swap) paired-diff SE.** Replaces the noise simulation with the plug-in estimator for the exact quantity the ship gate bootstraps:

1. Compute v5 predictions on 2024-25 val fold (already done).
2. Compute a **v6-simulated** prediction: v5's sigmoid pipeline, unchanged, but with team-quality feature swapped from season-to-date point differential to **rolling-20-game point differential** (the grid-winner from premise correlations). Same scale (0.10), same home advantage (2.25), same injury handling, same clamp to [0.15, 0.85], same cold-start fallback (<5 games → baseRate). Season-reset at NBA season boundary consistent with `buildTeamStateUpTo` convention.
3. For each val-fold game: compute per-game Brier diff (`brier_v6_sim − brier_v5`). Pair by game_id.
4. Block-bootstrap SE with blocks = `(home_team, ISO-week)`, B = 10,000.
5. Report **SE of paired diff** (power-check number; feeds forward into §Phase 3 rule 1 inheritance).
6. Report **mean of paired diff** but **explicitly wall it off as informational-only — NOT a ship signal.** The val-fold mean paired diff is not a rule-1 gate number; the rule-1 gate lives on the test fold and is untouched. This wall prevents val-fold-ship-temptation if the mean paired diff happens to look attractive.

Ship-rule threshold unchanged: **SE ≤ 0.0033 for the 0.010 Brier beat floor to be 3σ at N=test-fold-size**. Threshold was correct; estimator was wrong.

### Council rationale (summary of the 3 votes)

- **Math**: Proposal A is the plug-in estimator for the exact SE the ship gate bootstraps. No noise-model assumption; feature-driven ρ(v5, v6) captured correctly. B (Platt-proxy) measures a monotone rescale — not a feature-swap — so it understates SE for the actual competitor class. C (widen threshold) is ex-post ship-rule movement, banned by plan discipline.
- **Stats**: A is the only estimator that targets the quantity of interest. B passes trivially because v5 is HONEST (Platt ≈ identity → σ ≈ 0). C acknowledges underpower without fixing it. Revision is methodologically legitimate because test fold is untouched and the threshold is unchanged; spec is being pinned pre-rerun.
- **Prediction Accuracy**: A is correct with the explicit val-fold-ship-temptation mitigation (mean paired diff is informational, not a ship signal). Fixes the noise-model spec that Phase 3 would otherwise inherit 6+ months from now. B measures calibration-gap not feature-gap; C is gate movement.

### Script change

`scripts/phase1-preflight-correlation.ts` updated to implement the revised methodology. New predict function `predictV6Simulated(game, ctx, rollingDiffHome, rollingDiffAway)` mirrors v5's sigmoid but reads rolling-20 differentials instead of season-to-date. Games where either team has fewer than 20 rolling history entries fall back to v5's season-diff path (consistent with Phase 1 rule 4 cold-start spec; affects ~311 of 1321 val-fold games, mostly early-season). Cold-start-fallback games are excluded from paired-diff SE computation to avoid inflating the SE with identical-prediction zero-diff blocks (v6-simulated == v5 in those cases by construction).

---

## Pre-flight addendum v3 — 2026-04-24 (re-run with revised methodology)

### Results

| Quantity | Value | Pre-declared threshold | Disposition |
|---|---|---|---|
| v5 NBA Brier on 2024-25 val fold | 0.2161 (unchanged from v1) | — (anchor) | ✓ anchor |
| Premise Δ(best rolling − season) | +0.0131 (unchanged from v1) | ≥ 0.02 | **FAIL (unchanged)** |
| Paired-diff block-bootstrap SE | **0.00278** | ≤ 0.0033 | **PASS** |
| Paired games (N after cold-start exclusion) | 1,010 | — | |
| Cold-start excluded (v6_sim == v5 by construction) | 311 | — | |
| Block count `(home_team, ISO-week)` | 550 | ≥ 50 stability floor | PASS |
| Bootstrap resamples B | 10,000 | — | PASS |

### Informational-only (walled off per council; NOT a ship signal)

- Paired-diff mean (v6_sim − v5) on val fold: **+0.00040 Brier** (positive = v6_sim slightly *worse* than v5).

This number is walled off from any ship decision per the methodology pin. It is reported here solely for transparency — and independently corroborates the premise failure at the Brier level: a rolling-20-feature-swap v6-simulated is on average ~0.0004 Brier *worse* than v5 on the val fold, not better. The correlation check (+0.0131 Pearson delta vs the 0.02 threshold) already told us the rolling-window premise was weakly supported; the informational Brier check confirms that the weak correlation edge doesn't convert to an outcome edge.

### Disposition

- **Premise**: FAIL (unchanged from addendum v1, confirmed by informational Brier check).
- **Power**: **PASS** with revised methodology. Phase 3's rule-1 power-check spec can inherit the corrected methodology (Proposal A: empirical v5-vs-competitor paired-diff SE, no noise-model). The 0.010 Brier floor is 3.6σ-detectable at N=1010 paired val-fold games, so the same floor is viable on the test fold (which has similar N).
- **Forward path**: per §Phase 1 failure modes, **skip Phase 1, proceed to Phase 2**. Phase 1 null result is documented in `learnings.md` (next commit). The methodology repair survives — §Phase 3 rule 1 power-check is now empirically grounded rather than noise-model-dependent, which Phase 3 inherits when it runs its own pre-flight.

### What's live as of 2026-04-24 end-of-session

- No v6 code written. v6 was only computed as a val-fold power-check simulation; no predictions written to DB, no `v6` export in `src/analysis/predict.ts`, no live-prediction wiring.
- Test fold (2025-26) untouched by Phase 1 diagnostics.
- Phase 1 implementation branch `claude/nba-learned-model-phase-1` holds: plan rename + pre-flight script + addenda v1/v2/v3. Branch will be closed at Phase 2 branch cut; pre-flight script + addenda survive as repo history.
- Phase 2 starts on a new branch `claude/nba-learned-model-phase-2` from `origin/main` post-merge of this branch (or as a peer branch if this one is not merged).

---

## Phase 2 addendum v4 — 2026-04-24 (convention alignment: zod → hand-rolled)

**Status**: tactical pattern decision (not a re-council). Documented because it reverses a word-level specification in §Phase 2 item 1.

### What the plan said

§Phase 2 item 1: "Parse and validate against a **Zod schema** (new `src/scrapers/espn-box-schema.ts`); any unrecognized or unexpectedly-missing field fires a scrape-time warning..."

### What was found

`src/scrapers/validators.ts` header comment documents an **existing council decision against zod**: "Council mandate (Sprint 8): Hand-rolled type guards (no zod dependency — Engineer)". The Sprint 8 council mandate predates this plan and wasn't surfaced during the 4-round plan review — none of the 5 experts checked the existing scraper validator convention against the plan's "Zod schema" language.

### Decision

Phase 2's `src/scrapers/espn-box-schema.ts` uses the **existing hand-rolled `ValidationResult<T>` pattern** from `src/scrapers/validators.ts`, not zod. Rationale:

- **Follows existing council decision.** Reversing it would require a re-council specifically on "should we add zod," which is a dep-change question the Phase 2 plan scope doesn't justify revisiting.
- **Matches the codebase.** `src/scrapers/validators.ts` already defines `ValidationResult<T>`, `EspnScoreboardResponse`, `validateScoreboard()`, etc. Phase 2's box-stats validator is the same class of thing — schema-drift detection on an ESPN response — and should share the pattern.
- **No new dep.** Adding zod requires package.json change + Dockerfile rebuild verification (Fly deployment) + test that the 512MB machine still boots. All out of scope for a Phase-2 scaffolding commit.
- **Same plan-intent mechanisms are preserved.** The plan wanted "continuous drift detection with logged warnings." The hand-rolled pattern achieves this identically: `ScrapeWarning` types (`unknown_field` | `missing_field` | `schema_error`) are returned by the validator and persisted to the `scrape_warnings` table. Plan §Phase 2 item 1's intent is met; only the implementation vehicle differs.

### What this changes in the plan

In the plan body, mentally substitute every "Zod schema" reference with "hand-rolled validator in `src/scrapers/validators.ts` pattern." Ship-rule text doesn't change. Implementation-review gate for Phase 2 will verify: (a) the validator returns `ScrapeWarning[]` on drift, (b) `scrape_warnings` table is written by the caller, (c) fail-closed on MUST-HAVE drift and fail-open on NICE-TO-HAVE drift.

Skeleton file committed in this branch (`src/scrapers/espn-box-schema.ts`) includes:
- Typed output interfaces (`NbaBoxStatsRow`, `NbaBoxStatsGame`).
- `ScrapeWarning` type aligned with the `scrape_warnings` DB table.
- `MUST_HAVE_RAW_FIELDS` and `NICE_TO_HAVE_FIELDS` pinned constants.
- `possessionsSingleTeam()` and `possessionsAveraged()` pinned formulas (basketball-reference Oliver).
- `validateNbaBoxScore()` stub with implementation sketch in JSDoc (to be filled in when Phase 2 author has sample ESPN responses to trace from).

---

## Scope clarification addendum v5 — 2026-04-24 (rolling-window on rich features is still open)

### What Phase 1 actually ruled out vs what remains open

Phase 1's pre-flight premise check tested **one specific hypothesis**: "rolling-N point differential beats season-aggregate point differential as a drop-in team-quality feature in the v5 sigmoid." That hypothesis failed: best rolling-N (N=20) Pearson vs forward margin = 0.4288, season-diff = 0.4157, Δ = +0.0131 < pre-declared 0.02 threshold. v6-simulated (v5 with rolling-20 feature-swap) also showed a *positive* val-fold mean paired Brier diff of +0.00040 (v6_sim slightly worse than v5), confirming the correlation finding at the outcome level.

**What this result does NOT rule out:**

1. **Rolling-window on richer box-score features.** The Phase 3 feature list (§Features) uses rolling-window of Net Rating, ORtg, DRtg, eFG%, TOV%, OREB%, DREB%, 3P-rate, AST/STL/BLK per possession — NOT just point-differential. Box-score features are inherently more recency-sensitive than point-diff because (a) they respond to tactical shifts (rotation changes, coaching adjustments, scheme evolution) that don't show in aggregate margin, (b) their effective sample size per game is larger (more datapoints per game than one margin number), making rolling-N noise cheaper than it is on noisy aggregate margin, (c) some features (e.g., 3P-rate after a trade-deadline wing addition) can shift materially mid-season in ways season-aggregate smears away.
2. **EWMA time-decay on rich features.** Phase 3's grid already includes 4 EWMA half-lives {5, 10, 15, 20}. Exponential decay with a short half-life may show a larger vs-season edge than hard rolling-N even when the hard-rolling-N comparison is narrow.
3. **Rolling-window of opponent-adjusted metrics.** SoS-adjusted Net Rating (plan §Features) is a second-order quantity; its rolling-window behavior is an empirically open question distinct from rolling-window of raw point-diff.

### Phase 3 grid still tests rolling-window, on richer inputs

Per §Training protocol, Phase 3 does a nested time-ordered 5-fold inner-CV over **9 feature-form candidates**: 5 rolling-N × 4 EWMA-h. Each candidate is evaluated on the full Phase 3 feature vector (Net Rating, eFG%, TOV%, rest, B2B split, circadian, etc.) — not on the Phase 1 coarse-point-diff feature. Per-game-pooled Brier across time-ordered held-out slices ranks the candidates; single winner moves to the test fold.

This means **the rolling-window question is re-opened and re-tested in Phase 3**, with the richer inputs that make the "recency matters" premise more plausible. Phase 1's result is informative but not load-bearing for Phase 3's grid outcome.

### Documentation correction

- `learnings.md` entry "Phase 1 premise null result" originally wrote: *"Rolling-window premise is weakly supported at best on NBA"* and *"'More data beats recency' for NBA team quality."* Both statements are overreach. The accurate claim is: *"Rolling-window of season-aggregate POINT DIFFERENTIAL is weakly supported over season-aggregate point differential on NBA — Δ=+0.0131 Pearson, N=20 window winning, falling short of pre-declared 0.02 threshold. Rolling-window of richer box-score features is untested in Phase 1 and remains a Phase 3 grid candidate."* Correction filed in next learnings commit.
- `SESSION_LOG.md` "Remote Resume" statement "Phase 1 is DONE" correctly refers to v6 (rolling-point-diff drop-in) being abandoned, but the surrounding language "Don't 'try again' on v6 rolling-window — the premise is empirically weak on NBA" is overly broad; only v6-as-rolling-point-diff is abandoned. Rolling-window on Phase 3 features is NOT abandoned. Correction filed in next session log commit.
- `project_sportsdata_foundation.md` (memory) historical finding "More data beats recency for 82-game NBA seasons" is overreach for the same reason. Correction: "More data beats recency **for NBA point-differential specifically** — rolling-window behavior on richer box-score features is untested on NBA and remains a Phase 3 grid candidate."

### Implications for forward work

- **Phase 2 remains unchanged.** Box-score plumbing is independently valuable for Phase 3 regardless; the rolling-window question reopening doesn't alter Phase 2 scope.
- **Phase 3 feature-form search is not a formality.** If Phase 2 lands box-score data cleanly, the 9-candidate rolling/EWMA grid could plausibly pick a non-trivial winner (e.g., EWMA-h=10 on Net Rating) that outperforms season-aggregate on those features. The Phase 3 plan-review gate will re-evaluate the "recency matters" hypothesis at that time, with empirics.
- **If Phase 3 rolling-window also fails to beat season-aggregate on rich features**, THEN the broader "recency doesn't help NBA team quality" claim would be supported — but that's a Phase 3 conclusion, not a Phase 1 one.

### What does NOT change in the plan body

- Phase 1 ship gate threshold (0.02 Pearson Δ) — stays pre-declared, was correctly applied.
- Phase 3 ship rules — unchanged; the 0.010 Brier floor and 3σ power threshold remain.
- Phase 3 feature list, feature-form grid, and inner-CV protocol — unchanged; they already test rolling-window on rich features.
- The Phase 1 abandonment decision — correct and stays. v6 (rolling-point-diff as v5 drop-in) is a null result and that path is closed.

This addendum is a **scope clarification**, not a methodology or ship-rule change. No re-council required — the plan body's Phase 3 feature-form grid already encoded this distinction; the documentation overreach was downstream of the plan, not in it.

---

## Addendum v6 — 2026-04-24 (council correction of v5 overreach)

**Status**: 4-expert council review of addendum v5 returned 2× CLEAR (Pred, Domain) + 2× WARN (Stats, Math). This addendum corrects three specific overclaims in v5 and surfaces one Phase-3-plan-review item that v5 elided.

Per append-only discipline, v5 is NOT back-edited; v6 amends it here. Subsequent readers should treat v6 as the authoritative reading.

### Correction 1 — Phase 3 grid is feature-form selection, NOT a clean hypothesis test of recency-vs-aggregate

**What v5 said:** "Phase 3's 9-candidate grid (5 rolling-N × 4 EWMA-h) re-tests the rolling-window hypothesis on those richer inputs."

**Why Stats flagged it:** the grid picks a winner among 9 recency-weighted candidates. **Season-aggregate is not one of the 9 candidates.** As currently specified in §Training protocol, Phase 3 cannot pick season-aggregate over rolling/EWMA — it's not on the ballot. So the addendum-v5 conditional "only if Phase 3 picks season-aggregate over all 9 candidates does the broader 'recency doesn't help NBA' claim gain support" is unfalsifiable: the antecedent can never be true.

**Corrected framing:**
- Phase 3's inner-CV grid is **feature-form selection** among recency-weighted candidates. It picks the *best* rolling/EWMA form; it does not compare that form against a season-aggregate baseline.
- The test-fold ship gate (§Phase 3 rule 1) compares the full Phase 3 learned model (with its selected feature form) against the incumbent — v6 if Phase 1 shipped, or v5 if Phase 1 did not ship. **v5's feature is season-aggregate point differential.** So the test-fold comparison IS implicitly "Phase 3 (rich features, rolling/EWMA form) vs. v5 (point-diff, season-aggregate)" — but this is an *architectural* comparison, not a clean recency-vs-aggregate feature-form comparison.
- To cleanly test "rolling-window on rich features beats season-aggregate on rich features," the Phase 3 plan review (when it happens) should consider **adding season-aggregate as a 10th feature-form candidate** to the inner-CV grid. This is a Phase 3 plan-review item, not a decision made here.

### Correction 2 — "Larger effective sample size per game" conflates sub-events with estimator-n

**What v5 said:** "Box-score features have larger effective sample size per game (more datapoints per game than one margin number), making rolling-N noise cheaper than it is on noisy aggregate margin."

**Why Math + Domain flagged it:** point-diff is itself a high-n per-game quantity — it's the sum of ~200 possession outcomes. Treating it as "one number" vs. eFG%'s "85 FGA" understates point-diff's effective n. Worse, eFG%/TOV%/pace are correlated derivatives of the same possession-level data, not independent measurements — treating them as independent "more datapoints" inflates ESS.

**Corrected framing:** the real distinction is the **ratio of within-season trend variance (a) to per-game sampling variance (b)**. For rolling-N to beat season-aggregate on a feature, (a) must be large relative to (b). Point-diff has large per-game sampling variance (σ ≈ 12 pts in NBA) and plausibly small within-season trend variance for the bulk of the league. Box-score rate features have smaller per-game sampling variance (eFG% σ ≈ 5 percentage points on ~85 FGA) but the within-season trend variance is an empirically open question — it *may* be proportionally larger (due to lineup/tactical shifts that don't register in margin) or it may be similar. The addendum-v5 assertion that box-score features have "inherently larger" ESS or are "inherently more recency-sensitive" is not supported by first principles; it's a plausible prior, not a fact.

### Correction 3 — "Inherently" overclaims; "untested empirical question" is the honest register

**What v5 said:** "Box-score features are **inherently** more recency-sensitive than coarse point-diff..."

**Why Math + Domain flagged it:** "inherently" claims a property; the evidence supports a hypothesis at most. A drop-in fix: change "inherently" to "may be" throughout. The `learnings.md` CORRECTION bullet already uses the honest register ("remains an untested empirical question"); the plan addendum should match.

### Correction 4 — Multiple-testing inflation in the 9-candidate grid

**What v5 elided:** the 9-candidate inner-CV is a **selection procedure**, not a hypothesis test. Picking best-of-9 biases the selected candidate's inner-fold margin upward by ~O(σ·√(2 ln 9)) ≈ 2.1σ under independence. The plan's test-fold gate (single declared winner on held-out test fold) is the right ultimate guard, but the addendum should flag this inflation so Phase 3's plan review can bake in the mitigation.

**Corrected framing:** Phase 3 plan review should either (a) pre-declare a Bonferroni-style adjustment on the winner's test-fold CI threshold (e.g., tighten from 95% one-sided to 99.4% one-sided per 9-way selection), or (b) explicitly pre-declare that the held-out test fold is the final arbiter and the inner-CV margin is expected to be optimism-biased. This is a **Phase 3 plan-review item**, not a Phase 1 or v5 correction.

### What this addendum does NOT change

- Phase 1 null result, disposition, or ship-gate application — unchanged.
- Phase 2 scope, MUST-HAVE schema, coverage floors, audit protocol — unchanged.
- Phase 3 ship rules (the six pre-declared gates) — unchanged in value; rule 1's inner-CV multiple-testing mitigation is flagged here as an item for the Phase 3 plan-review gate but not re-written into the plan body yet.
- Plan body addenda v1–v4 — unchanged (append-only discipline).

### Plan-review items for future Phase 3 plan review

Capture for the reviewer when Phase 3 plan review convenes (post-Phase 2 merge):

1. **Add season-aggregate as a 10th feature-form candidate** to the Phase 3 inner-CV grid, OR explicitly state that the test-fold comparison against v5 (which uses season-aggregate) is the *only* recency-vs-aggregate comparison the plan provides.
2. **Pre-declare multiple-testing mitigation** for the 9-way (or 10-way) feature-form selection: Bonferroni-adjusted CI threshold, or a documented acceptance of the optimism bias in the winner's inner-fold estimate.
3. **Opponent-adjustment sanity** (flagged by Domain in v5 council): rolling-window on rate stats is vulnerable to schedule-strength confounds; SoS-adjusted rate features should be the primary benchmark, not raw rolling rate.
4. **Season-segment stability** (flagged by Domain): the rolling-vs-aggregate relationship may be strongest in the last ~15 games of the season (tanking, rotation experiments) and weakest in the middle third. Check whether the grid winner is stable across season-segments, not just pooled.

### Council process note

The v5 addendum claimed "No re-council required." Council happened anyway (4-expert panel) at user request, and correctly caught two material overclaims. **Lesson**: even "scope clarifications" that don't change ship rules can embed factual claims worth council-reviewing. For future addenda that introduce *any* empirical or factual assertion (not just ship-rule changes), default to running the council loop.
