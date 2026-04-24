# NBA Neural-Net Pilot — Staged Plan

**Branch**: `claude/nba-model-explanation-m8rX8` (plan only; implementation branches per phase)
**Scope**: NBA only. NFL / MLB / NHL / MLS / EPL stay on v5 + v4-spread. Explicit non-goal: no cross-sport replacement in this plan.
**Status**: pre-council DRAFT, awaiting 5-expert review (Data Quality, Statistical Validity, Prediction Accuracy, Domain, Mathematics).

## BLUF

Pilot a learned NBA model in three independently-shippable phases, each with its own pre-declared ship rules and council review. Each phase either beats the incumbent or is abandoned — no phase ships on "will pay off later" reasoning. The end-state candidate is a small PyTorch model fed rolling-window box-score features with Z-score normalization, trained with BCE + post-hoc calibration, but we only build it if the cheaper phases prove the signal exists.

## Problem

Current NBA stack (`src/analysis/predict.ts`) has two known limitations surfaced by prior council work:

1. **Season-aggregate point differential is the only team-quality feature.** No rolling window, no time decay. A team's blowout win in game 3 counts the same as a close loss yesterday. Recency weighting is logged as debt #25 (Dixon-Coles ξ) and remains unshipped.
2. **No box-score granularity.** STL / AST / BLK / pace / TOV / eFG% / rebound differential are not in `TeamState` and not in the `game_results` table. Feature poverty limits the model's structural ceiling regardless of how the sigmoid is calibrated.

A third limitation — the hardcoded 3-game streak flag — is *interpretable and cheap*, so we only delete it if a learned replacement demonstrably beats it, not on aesthetic grounds.

## Why NBA for the pilot

- Largest resolved-outcome corpus of any single sport in the DB (~4,100 NBA games across 3 seasons per README).
- Game-level box score is standardized and available from ESPN's per-game endpoint (same host we already scrape).
- v5 NBA calibration is recent (PR #34, April 2026) and HONEST on reliability diagrams — a strong, stable baseline to beat.
- NBA's 82-game schedule gives us the most within-season data per team, which is where rolling-window features have the best chance to add signal.

## Staged approach

Three phases. Each phase is an independent PR with its own council plan review, implementation review, and results review. A failed ship gate at phase N does NOT block phase N+1 unless the failure invalidates a shared assumption.

| Phase | Name | Language | Ship gate concept |
|---|---|---|---|
| 1 | Rolling-window differential | TypeScript | Beats v5 Brier on held-out 2025-26 slice |
| 2 | Box-score data plumbing | TypeScript | Data quality gates only; no model change |
| 3 | PyTorch learned model | Python (subprocess) | Beats best-of(v5, phase-1) by pre-declared margin |

## Phase 1 — Rolling-window differential (TypeScript, cheapest)

**Hypothesis**: A last-10-games rolling point differential carries more predictive signal than full-season differential for NBA.

**Change**: In `src/analysis/predict-runner.ts` team-state snapshot, compute `rolling10_diff_per_game` alongside existing `diff_per_game`. Add a v6 model that uses rolling-10 as the primary feature and season-aggregate as fallback (for teams with <10 games played). Sigmoid scale re-tuned via grid search per the MLS/EPL precedent (`Plans/mls-epl-sigmoid-scale.md`).

**Explicitly not changed in Phase 1**:
- Feature set beyond the rolling swap (still no box-score stats)
- Streak flag (stays in v6 — we do NOT delete it yet)
- Home advantage constant (2.25, per debt #27)
- Injury adjustment (40% compensation factor, unchanged)
- Shadow-logging infrastructure (reused from PR #38)

**Why this phase first**: If a one-line swap to rolling-window doesn't improve anything, the premise of the entire plan ("recency matters for NBA") is weakened and Phase 3 becomes speculative. Cheap falsification before expensive build.

**Window-length decision**: Grid-search `N ∈ {5, 7, 10, 15, 20}` on the pre-2024 training fold ONLY, pick the N with best Brier on that fold, then freeze N and evaluate on the 2025-26 test fold. No ex-post window-length tuning.

### Phase 1 ship rules (pre-declared)

v6 replaces v5 for NBA live predictions iff **all four** hold:

1. **Brier beat**: v6 NBA Brier < v5 NBA Brier on the 2025-26 held-out slice, with 95% bootstrap CI on paired diff entirely below zero.
2. **Calibration preserved**: v6 NBA reliability verdict = HONEST (|signedResid| ≤ 0.02, ECE ≤ v5 NBA ECE + 0.005).
3. **No margin regression**: v4-spread-rolling (parallel Phase 1 variant for the margin model) weightedMAE ≤ v4-spread weightedMAE + 0.05, verdict stays HONEST.
4. **Cold-start safety**: On games where either team has <10 games played (early-season rows), v6 falls back to v5's season-diff path and the fallback path is tested on the 2024-25 early-season slice with no Brier regression vs v5.

If rules 1-3 hold but rule 4 fails, ship v6 with a stricter cold-start gate (e.g., fallback to v5 until 15 games) rather than abandon.
If rule 1 fails, document the null result in `learnings.md` and SKIP to Phase 2 (data plumbing is independently useful for reporting / Phase 3 regardless).

## Phase 2 — Box-score data plumbing (TypeScript, no model change)

**Hypothesis**: None — this is infrastructure. Ships or fails on data-quality gates only.

**Scope**:
1. Extend `src/scrapers/espn.ts` to pull per-game box score for completed NBA games (team-level aggregates: FG%, 3P%, FT%, OREB, DREB, AST, STL, BLK, TOV, PF, pace, possessions, time-of-possession proxy if available).
2. Schema migration in `src/storage/sqlite.ts`: new `nba_game_box_stats` table keyed on `(game_id, team_id)`. Do NOT widen the existing `game_results` table — new table keeps the change additive and reversible.
3. Backfill historical NBA games. Rate-limit respectfully (existing ESPN scraper has 10s timeout + 3-attempt retry per PR #25); cap backfill at 2 requests/second.
4. Add a `box_stats_coverage` view that reports `(season, games_with_full_box, games_missing_box)` — this is the Phase 2 ship gate.

**Explicitly not changed in Phase 2**:
- No prediction model changes. The model still reads `TeamState` as it does today.
- No features derived from box-score data get fed into v5 or v6 in this phase.
- No other sport's scraper touched.

### Phase 2 ship rules (pre-declared)

Phase 2 merges iff **all three** hold:

1. **Coverage**: ≥ 98% of post-2022 NBA games in the DB have a complete box-score row after backfill. (Pre-2022 is unblocked but out-of-scope for the pilot.)
2. **Schema integrity**: No changes to `game_results` schema. No non-NBA rows in `nba_game_box_stats`. Migration script is idempotent and has a tested down-migration.
3. **No regression elsewhere**: Full existing test suite green. Baseline + reliability runs on the current 21,694-game corpus produce bit-identical outputs vs. pre-Phase-2 (proves the data addition did not leak into model inputs).

Phase 2 failure modes and responses:
- **Coverage < 98%**: investigate gaps. If systematic (e.g., a season's worth of games missing from ESPN), document the hole in `learnings.md` and lower Phase 3's training window to the covered span. Don't synthesize missing rows.
- **Rate-limit issues during backfill**: pause backfill, re-plan with math expert on sampling, do not bypass rate limits.

## Phase 3 — PyTorch learned model (Python subprocess, architecturally significant)

**Only begins if Phase 2 ships cleanly AND (Phase 1 shipped OR Phase 1 failed for a reason that does not invalidate Phase 3).** If Phase 1 showed rolling windows don't help NBA at all, the case for a richer model is weaker — re-council before starting Phase 3.

### Model family (not final — council reviews separately per phase 3 plan)

Starting hypothesis for council discussion:
- **Not a Transformer.** 4,100 games × ~40 features is not sequence-model scale; attention is the wrong inductive bias here.
- **Starting architecture**: 2-layer MLP (hidden dims ~32, ~16), ReLU, dropout ~0.2, BCE loss on home-win outcome.
- **Output head**: sigmoid → probability, then post-hoc Platt scaling on a held-out calibration fold to enforce the HONEST reliability verdict (BCE alone does not guarantee calibration; this is explicit, not accidental).
- **Alternative to consider at council time**: gradient-boosted trees (e.g., LightGBM). Smaller, faster, more interpretable, often wins on tabular problems in this data regime. The plan should not assume a neural net is correct just because we said "neural net" in conversation.

### Features (subject to Phase 2 coverage)

Per-team rolling-N (N fixed by Phase 1 outcome):
- Points for / against per possession (pace-adjusted, not raw PPG)
- eFG% offense / defense, 3P-rate offense / defense, FT-rate, TOV%, OREB%, DREB%
- AST/FG ratio, STL per possession, BLK per possession
- Rest days, back-to-back flag, travel distance (if we have it)
- Home/away split of rolling window (separate rolling windows for home games and away games)

**Normalization**: Z-score per feature on the training fold only; normalization parameters frozen and applied to test + live. No leakage via global normalization.

### Architecture decision: Python subprocess vs ONNX

- **Preferred**: Train in Python, export to ONNX, run inference in TS via `onnxruntime-node`. Single-language deployment, no subprocess latency.
- **Fallback if ONNX export breaks**: Python subprocess called by the TS predict-runner, with a local HTTP shim. Adds ~50-200ms latency per prediction, acceptable for our twice-daily batch cadence.
- **Decision deferred to Phase 3 plan review**. Do not pre-commit.

### Time-machine rule (no look-ahead)

Phase 3 inherits the existing type-enforced discipline: training examples use features computed from games strictly before the target game's date. `PredictionContext.asOfDate` (`predict.ts:35-40`) and the backtest team-state snapshot (`backtest.ts:87-103`) are the existing guards; the Python side reimplements this by consuming a pre-computed `(game_id, asOfDate, feature_vector, outcome)` parquet exported from TS. TS owns the temporal correctness; Python consumes a frozen artifact.

### Training protocol

- **Splits**: pre-2024 train, 2024-25 validation (for Platt scaling + early stopping), 2025-26 test (held out, touched ONCE for the ship gate).
- **No hyperparameter tuning on the test fold.** Hyperparameter grid frozen before test-fold evaluation.
- **Seed control**: fix seeds, report mean ± std across 5 seeds on validation; use median-seed model for final test-fold evaluation.
- **Deterministic replay**: commit training script, training data hash, and final model weights. A second run on the same commit must reproduce the test-fold Brier to within 1e-4.

### Phase 3 ship rules (pre-declared)

The learned model replaces v6 (or v5, if Phase 1 did not ship) for NBA live predictions iff **all six** hold:

1. **Brier beat over incumbent**: learned-model Brier on the 2025-26 test fold beats the incumbent by at least 0.010, with 95% bootstrap paired-diff CI entirely below zero. (0.010 threshold: Phase 1 v5→v3 ratchet was 0.204; we're asking for a much smaller but statistically clean gain. Threshold set based on Phase 1 actual improvement — if Phase 1 shipped, set this to max(0.010, Phase-1-Brier-beat / 2) to force a meaningful improvement over Phase 1's cheaper win.)
2. **Calibration**: reliability verdict = HONEST on the test fold, ECE ≤ incumbent ECE + 0.005.
3. **Margin model parity**: learned margin head (if built) weightedMAE ≤ incumbent weightedMAE, verdict HONEST. If margin head is not built in Phase 3, incumbent margin model stays in place and this rule is N/A.
4. **Calibration honesty on low-sample bins**: no reliability bin with n ≥ 50 has |bin_resid| > 0.08. (Catches the "great overall ECE, but wildly miscalibrated at extremes" failure mode that BCE can produce.)
5. **Shadow parity for ≥ 2 weeks before live swap**: learned model runs in shadow mode (v7-shadow in the existing PR #38 shadow-logging infrastructure) for at least 14 NBA game-days, and its forward Brier over that live shadow window is within 0.02 of its held-out test-fold Brier. Catches train/serve skew.
6. **Interpretability debt filed**: before live swap, a `scripts/explain-prediction.ts` utility exists that reports per-feature contribution (SHAP values for trees; gradient × input for MLP). If this is not built, we are not ready to answer "why did the model pick team X" in a reliability-review context.

Phase 3 failure modes and responses:
- **Rule 1 fails**: do not ship. Document null result, do not rerun on new splits looking for a win (would p-hack the test fold). The test fold is burned.
- **Rule 1 passes, rules 2-6 fail**: do not ship. Add the gap to a follow-up debt, re-council on next steps.
- **Shadow-vs-test divergence (rule 5)**: indicates train/serve skew (typically a feature-computation mismatch between Python training and TS inference). Fix the pipeline, re-shadow — do not adjust the rule.

## Shared guards across all phases

- **Other sports untouched.** Any change that alters NFL / MLB / NHL / MLS / EPL reliability or baseline output is a bug, not a feature. Enforced by the "bit-identical output for non-NBA sports" gate in every phase.
- **Shadow-first before live swap.** Every phase that introduces a new live prediction runs via the PR #38 shadow-logging infrastructure (`v6-shadow`, `v7-shadow`) before becoming the primary model.
- **In-sample disclosure.** Every phase documents what was calibrated on what fold. The NBA home-advantage recalibration precedent (`Plans/nba-home-adv-recalibration.md:72-76`) is the template — honest about in-sample caveats, forward validation belongs with shadow logging.
- **Council review at three gates per phase**: plan review → CLEAR, implementation review → no FAIL, results review → ship rules verified. Skipping a gate is a CRITICAL FAILURE per `feedback_council_discipline.md`.
- **Test fold is write-once.** 2025-26 NBA games are touched ONCE per phase for the ship gate. Re-running on the test fold to "see if it works now after a tweak" is p-hacking and is banned.

## Rollback strategy

Every phase must support instant rollback:

- **Phase 1**: v6 model version coexists with v5 in `model_version` column. Flip `NBA_LIVE_MODEL` config back to `'v5'` to roll back. Historical predictions under both versions stay in the DB for post-mortem.
- **Phase 2**: `nba_game_box_stats` is additive; dropping the table restores prior state. Scraper changes are behind a feature flag `SCRAPE_BOX_STATS=true`.
- **Phase 3**: model artifact versioned by commit SHA; inference layer reads `NBA_LIVE_MODEL` env var. Python subprocess (if used) runs in a sidecar; disabling the sidecar falls back to the TS model.

## Explicit non-scope

- **No cross-sport rollout in this plan.** Even if Phase 3 wins big on NBA, applying it to NFL / MLB / NHL / MLS / EPL is a separate plan, separate council, separate ship rules. Sport-specific data characteristics (82-game NBA seasons vs. 162-game MLB vs. 38-game EPL) make "it worked on NBA" a weak transfer argument.
- **No betting / odds / EV changes.** This plan is about win-probability and margin prediction only. ATS edge detection stays on v4-spread throughout.
- **No UI changes.** Reporting layer reads whatever model_version is live; no dashboard rebuild required.
- **No ternary (W/D/L) output for NBA.** NBA has no draws; the Phase 3 output head is binary.
- **No live retraining / online learning.** All models in this plan are trained once per release. Scheduled retraining is a separate debt if the pilot succeeds.
- **Streak flag removal is NOT a goal of this plan.** If Phase 3's learned model demonstrably absorbs the streak signal (measurable via ablation), we can delete the flag in a follow-up PR. Deleting it pre-emptively would confound the ship-gate A/B.

## Known risks

1. **Overfitting on 4,100 games with ~40 features.** Mitigated by: small model capacity, dropout, early stopping on validation fold, mandatory 5-seed variance reporting. If validation variance is high (std > 0.005 Brier across seeds), treat the point estimate as untrustworthy.
2. **Box-score data gaps / inconsistencies across seasons.** ESPN's box-score format has historically changed. Phase 2 coverage gate catches this, but fixing gaps may require manual reconciliation. Budget accordingly.
3. **BCE ≠ calibration.** Addressed by post-hoc Platt scaling and rule 4 (per-bin resid ceiling). If Platt scaling itself overfits the validation fold, fall back to isotonic regression.
4. **TS/Python interop maintenance cost.** Two languages = two dependency trees, two CI pipelines. Phase 3 plan review must compare this cost to the marginal Brier gain.
5. **Interpretability regression.** v5's output is a simple formula; the learned model is less inspectable. Rule 6 (SHAP / gradient × input utility) is the mitigation. Council must agree the utility is sufficient before ship.
6. **Train/serve skew.** Feature computation in Python (training) vs. TS (live inference) can drift. Rule 5 (2-week shadow window within 0.02 Brier of test fold) catches this empirically.

## Files this plan will touch (per phase)

**Phase 1**:
- `src/analysis/predict.ts` — new `v6` model function alongside existing `v5`
- `src/analysis/predict-runner.ts` — rolling-10 field on `TeamState`, new reasoning JSON
- `src/analysis/backtest.ts` — window-length grid search helper
- `Plans/nba-neural-net.md` — this file (addendum after Phase 1 results)

**Phase 2**:
- `src/scrapers/espn.ts` — box-score endpoint client, rate-limited
- `src/storage/sqlite.ts` — schema migration for `nba_game_box_stats`
- `scripts/backfill-nba-box-stats.ts` — one-shot backfill
- `src/analysis/data-health.ts` — coverage report

**Phase 3**:
- New: `ml/nba/train.py`, `ml/nba/features.py`, `ml/nba/infer.py`, `ml/nba/calibrate.py`
- New: `ml/nba/artifacts/` (gitignored; model weights + normalization params committed via release artifact)
- `src/analysis/predict.ts` — `v7` inference shim that calls Python or ONNX
- `src/analysis/predict-runner.ts` — v7 wiring, shadow-logging variant
- `scripts/explain-prediction.ts` — per-prediction feature contribution
- `Plans/nba-neural-net.md` — results addendum after Phase 3

## Council verdict on this plan

**Status**: pre-council draft. Needs sign-off from all 5 experts (Mathematics vote required — this is explicitly a model-work plan) before Phase 1 implementation begins.

Expected areas of council pushback (anticipated, to accelerate review):
- **Stats**: 4,100 games for a 40-feature MLP is borderline. Likely pushback: "show me the effective sample size after rolling-window reduces independence." Response: include `rolling-window vs IID` sample-size disclosure in Phase 3 plan.
- **Math**: "BCE + Platt scaling vs. direct calibration loss (e.g., focal loss, Brier-as-loss)." Likely ask: rationale for choice.
- **Prediction Accuracy**: "2-week shadow window is short for NBA — half the league plays ~6 games in that span." Response: consider extending to 4 weeks if game-count is the binding constraint.
- **Data Quality**: "What happens when ESPN retroactively corrects a box score?" Response: Phase 2 must handle updates, not just inserts (UPSERT on `(game_id, team_id)`).
- **Domain**: "Pace and possessions matter more than per-game totals in modern NBA." Addressed in Phase 3 feature list; council can push for additional sport-specific features at plan review.

Deviating from this plan during implementation requires a fresh council pass. No silent scope drift across phase boundaries.

