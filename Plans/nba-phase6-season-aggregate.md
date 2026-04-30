# NBA Phase 6 — Season-Aggregate Net Rating Features

**Status**: COUNCIL-CLEAR (Gate 1, 2026-04-29, fix-pack applied). Append-only from this point.

---

## Problem

Three consecutive Phase 3/4/5 experiments placed the LightGBM model at AUC 0.722–0.724 vs v5's AUC 0.7283. The gap has been stable across different feature additions and bug fixes. The root cause is clear:

v5 encodes team quality as **season-to-date point differential per game** — a single number that integrates opponent strength, home/away mix, and form over the whole season. It is computed once, straightforwardly, and is highly stable.

The EWMA rolling features in the current model encode *recent-form box-score efficiency ratios* — eFG%, ORtg, DRtg, etc., exponentially discounted. These are good at capturing recency, but they measure fundamentally different things than cumulative quality. A team can have a great eFG% last month but still be a weak team overall.

LightGBM can learn a function of the EWMA features that approximates point differential, but only imperfectly — it has to integrate across many noisy box-score features to infer something the raw point differential encodes directly. The result is a consistently weaker team-quality signal at the AUC level.

---

## Solution

Add `season_net_rating` — the season-to-date mean Net Rating (ORtg − DRtg, per 100 possessions, averaged over all regular+postseason games in the current season before game_date) — as an explicit feature for both home and away teams.

This gives the model direct access to v5's core signal. Season-average Net Rating and raw point differential per game are highly correlated (~0.99). Net Rating is slightly superior because it normalizes for pace variation across teams and eras.

---

## Changes

One code change only. Architecture, hyperparameters, and training procedure are unchanged.

### Change 1 — `ml/nba/features.py`

**Step A — Add computation in `_rolling_feature_vector`:**

After the existing `bpm_effective` computation (around line 460), add:

```python
# Season-to-date mean Net Rating (ORtg − DRtg, per 100 possessions).
# Uses all season games (home + away) before target_date in the current season.
# This is the ML analogue of v5's (pts_for − pts_against) / games — giving the
# model direct access to the season-aggregate quality signal that v5 is built on.
# NaN for games where the team has no completed season games yet (early-season);
# the normalization pipeline imputes NaN → 0.0 (= training mean).
# Phase 6 addition — Plans/nba-phase6-season-aggregate.md.
all_season_games = [
    g for g in histories.get(team_id, {}).get("all", [])
    if g["season"] == target_season and g["date"] < target_date
]
if all_season_games:
    result["season_net_rating"] = (
        sum(g["net_rating"] for g in all_season_games) / len(all_season_games)
    )
else:
    result["season_net_rating"] = float("nan")
```

**Step B — Add to `ORDERED_STATS`:**

```python
ORDERED_STATS = [
    "ortg", "drtg", "net_rating", "opp_adj_nrtg", "opp_adj_def",
    "efg_pct_off", "efg_pct_def",
    "tov_pct_off", "tov_pct_def",
    "oreb_pct", "dreb_pct",
    "three_p_rate_off", "three_p_rate_def",
    "ast_per_poss", "stl_per_poss", "blk_per_poss",
    "bpm_effective",       # cold-start prior blend (Plans/nba-cold-start-prior.md)
    "season_net_rating",   # season-to-date mean Net Rating (Phase 6)
]
```

This automatically generates `home_season_net_rating` and `away_season_net_rating` via `_feature_names_for` and routes them through `zscore` normalization (the default — not in `_RATE_FEATURES`, `_COUNT_FEATURES`, or `_BINARY_FEATURES`).

**Total feature count: 46** (was 44 in Phases 3–5).

### Normalization

`season_net_rating` values range roughly −15 to +15 per 100 possessions (extreme cases); most teams fall in [−8, +8]. The distribution is approximately symmetric around 0 (league-wide zero-sum). `zscore` normalization is correct — same as `net_rating`, `ortg`, `drtg`.

No changes to `_RATE_FEATURES`, `_COUNT_FEATURES`, or `_BINARY_FEATURES`.

---

## What stays the same

- ewma-h21 architecture (council-selected inner-CV winner)
- BPM prior blend (`bpm_effective`, K=10) — retained as-is
- LightGBM hyperparameters: num_leaves=31, min_child_samples=200, reg_alpha=1.0
- 20-seed ensemble, same fixed seeds
- Training data cutoff: 2026-04-29T00:00:00Z
- Val split: 80/20, regular-season val fold only (Phase 5 fix retained)
- Platt calibration: logit-space, LogisticRegression(C=1e9), fit on regular-season val
- Test fold: 2025-regular (untouched)
- Touch counter: 0 going into Phase 6 evaluation

---

## Why season_net_rating, not raw point differential

v5 uses `(pts_for − pts_against) / games` from the `game_results` table (the main app DB).
Phase 6 uses `mean(net_rating)` from the `nba_game_box_stats` table (the ML DB).

`net_rating = (pts / possessions − opp_pts / opp_possessions) × 100`

For typical NBA possessions (97–102 per team per game), the two metrics differ by <0.5 per game. Their season averages are correlated at >0.99. Using `net_rating` from `nba_game_box_stats` keeps Phase 6 self-contained (no join to the app tables) and is marginally better analytically (normalizes for pace). No data consistency risk.

---

## Pipeline

1. Run `cv_runner.py --winner-override ewma-h21` → new 20-seed model set
2. Run `calibrate.py` → new `calibration-params.json`
3. Run `evaluate_test_fold.py` → test-fold AUC, Brier (touch counter #1)

No MLP fallback. If Gate D fails, declare null result and plan Phase 7.

---

## Ship rules

Pre-declared. No movement after code is written.

### Gate D (halt gate)

LightGBM AUC ≥ v5 AUC (0.7283) on the test fold. If fail, stop — declare null result.

**Directional expectation (Stats fix-pack):** If `season_net_rating` is the missing signal, AUC should improve by ≥ 0.007 vs Phase 5 (0.7221) to clear the 0.7283 floor. If Phase 6 AUC improves but lands in 0.723–0.728 (passes Gate D narrowly), council should review whether the two new features alone explain the gap or whether the BPM prior is also contributing. If AUC improvement < 0.003, the features are not providing the expected signal — declare null and reconsider architecture in Phase 7.

### Rule 1 — Overall Brier improvement

Two conditions, both required:
1. Brier improvement Δ ≥ 0.001 (lgbm Brier ≤ v5 Brier − 0.001, i.e. ≤ 0.208259)
2. Block-bootstrap 95% CI on Δ (lgbm − v5) excludes zero on the improvement side

B = 10,000, blocks = home_team × ISO-week.

If condition 1 holds but CI includes zero: WARN — council review required before shipping.
If Δ < 0.001: null result regardless of CI.

### Rule 2 — No cold-start regression

Cold-start Brier Δ (games 1–20, both teams) ≤ +0.002.
Phase 4 passed at +0.0019; this rule prevents regression on that window.
Note: early-season games have `season_net_rating` = NaN (no season data yet) → model falls back to EWMA + BPM prior features in that regime. This is pre-declared behavior.

### Rule 3 — Unconditional mean sanity

|mean(lgbm predictions) − empirical home win rate| ≤ 0.02.

### Sequential evaluation

LightGBM only. If Gate D fails, declare null and plan Phase 7.

---

## Known limitations (pre-declared)

- **Early-season NaN behavior**: For the first game of the season (and the 2–3 games where sample is very small), `season_net_rating` = NaN → imputed to 0.0 in normalized space (= league mean). This differs from v5's explicit 0.57 fallback before game 5. If the model underperforms v5 specifically on games 1–4, the NaN imputation rather than the season-aggregate feature is the suspect.
- **Season-type inclusion**: `all_season_games` filters on `g["season"] == target_season`. Since the season label is e.g. `"2025-regular"` (not `"2025-postseason"`), this filter includes only regular-season games for the current season — postseason games have a different label and are automatically excluded. This is correct behavior: the feature reflects regular-season form only, consistent with the test fold (also regular-season only). Postseason games remain in training but do not contribute to `season_net_rating`. (Note: plan originally stated "includes regular and postseason" — corrected in DQ fix-pack.)
- **Val fold is regular-season only for Platt/Brier**: retained from Phase 5. Postseason games are in training but excluded from the val metric. This was validated in Phase 5 Gate 1 and is retained unchanged.
- **Combining with EWMA features**: season_net_rating is correlated with the existing rolling net_rating and ortg/drtg features (Pearson ~0.7–0.9). LightGBM handles correlated features gracefully (random feature subsampling at each split), so no multicollinearity concern, but the marginal information added by `season_net_rating` over the existing EWMA features is its longer memory horizon, not a completely independent signal.

---

## If Gate D fails

- Declare null result. Ship bar does not move.
- Phase 7 direction: consider dropping EWMA entirely and using only season-aggregate features (matching v5's architecture) plus the BPM prior. This would test whether EWMA features add anything when the dominant season-aggregate signal is already present.
- Alternative Phase 7: add additional season-aggregate features (opponent-adjusted net rating, SOS) alongside season_net_rating.

---

## Addendum — Council Gate 1 (2026-04-29)

**DQ — 8/10 — CLEAR:** Data provenance is clean. `season_net_rating` computed from `histories[team_id]["all"]` — same source as `bpm_effective`. The `date < target_date` filter is the established leakage guard. NaN → 0.0 imputation documented as known limitation. Corrected plan's "season-type inclusion" documentation: `g["season"] == target_season` filters to `2025-regular` only, not `2025-postseason`. Code is correct; only the plan text was wrong. Fixed in known limitations section.

**Stats — 7/10 — WARN (resolved):** Ship rules identical to Phase 5 — appropriate. WARN: plan lacked directional AUC expectation. Fixed by adding paragraph under Gate D: expected improvement ≥ 0.007 AUC to clear the floor; if < 0.003, features are not providing the expected signal.

**Pred — 8/10 — CLEAR:** Approach is well-motivated. LightGBM will handle the correlation between season_net_rating and existing EWMA features gracefully (column subsampling). Two features added to 44 is low risk at min_child_samples=200. NaN imputation behavior correctly documented.

**Domain — 8/10 — CLEAR:** Season-average Net Rating is the standard NBA team quality metric. The ORtg−DRtg formulation is pace-adjusted and marginally superior to raw point diff. BPM prior retained. No domain concerns.

**Math — 8/10 — CLEAR:** Zscore normalization is correct for Net Rating (approximately symmetric around 0, no clipping needed). NaN → 0.0 in normalized space = valid mean imputation. Ship rules mathematically sound.

**Resolver: Stats WARN → directional expectation added → CLEAR. DQ note → documentation corrected → CLEAR. No R2 required. Proceed to implementation.**

Weighted score (post-fix-pack): DQ 8, Stats 8, Pred 8, Domain 8, Math 8 → avg 8.0/10.

---

## Addendum — Council Gate 2 (2026-04-29) — Test-fold results (null result)

**Test fold:** 2025-regular. Run ID: `20260428T204443-640e0cac`. LightGBM 20-seed ensemble, 46 features. Touch counter: 1/1.

**Results:**

| Metric | Phase 6 LightGBM | v5 Baseline | Delta |
|---|---|---|---|
| AUC | 0.7237 | 0.7283 | −0.0046 |
| Brier (test) | 0.211391 | 0.209259 | +0.002132 |
| Val Brier (cal, reg-season) | 0.196712 | — | — |
| AUC vs Phase 5 | +0.0016 | — | — |
| Platt A | 1.257693 | — | — |

**Gate D: FAIL** (AUC 0.7237 < 0.7283). Null result declared. No ship-rule evaluation.

**Directional expectation check:** Plan required ≥ 0.007 AUC improvement to clear Gate D. Actual: +0.0016. The features are not providing the predicted signal at this model capacity. As documented in the plan: "if < 0.003, features are not providing the expected signal — declare null and reconsider architecture in Phase 7."

**AUC progression across phases:**

| Phase | AUC | Features |
|---|---|---|
| Phase 3 | 0.6954 | 42 EWMA (no bugs fixed) |
| Phase 4 | 0.7241 | 44 EWMA + BPM prior |
| Phase 5 | 0.7221 | 44 EWMA + BPM (bugs fixed) |
| Phase 6 | 0.7237 | 46 EWMA + BPM + season_net_rating |

**DQ — 8/10 — CLEAR:** Test fold untouched. Counter correct. 46 features confirmed at evaluation. Run ID consistent.

**Stats — 7/10 — CLEAR:** Gap 0.0046 is unambiguous Gate D FAIL. AUC improvement vs Phase 5 (+0.0016) is well below the 0.003 threshold specified in the directional expectation. Four consecutive Gate D FAILs cluster at 0.722–0.724 — not sampling noise.

**Pred — 7/10 — CLEAR:** Adding v5's core signal as explicit features moved AUC by only +0.0016. LightGBM can't effectively use those features when competing with 44 noisy EWMA inputs at n=2640 with min_child_samples=200. Phase 7 should test a fundamentally different architecture.

**Domain — 7/10 — CLEAR:** The consistency of the gap across four phases with different features is structurally meaningful. v5 applies a fixed coefficient (0.10) to a hand-crafted quality score with explicit home advantage (2.25). LightGBM has to discover those coefficients from data — and consistently falls short. The signal exists; the model can't learn to use it efficiently.

**Math — 8/10 — CLEAR:** AUC comparisons and Brier values are correct. Directional expectation correctly specified and falsified.

**Council verdict: 5/5 CLEAR — avg 7.4/10. Gate 2 CLEAR. Phase 6 null result accepted. v5 remains incumbent.**

**Phase 7 direction (from plan §If Gate D fails):** Drop EWMA features entirely and use only season-aggregate features (season_net_rating, possibly opponent-adjusted) + BPM prior in a simpler model. Alternatively, try regularized logistic regression on the 46-feature set — a linear model can learn (home_season_net_rating − away_season_net_rating) with much better sample efficiency than LightGBM at n=2640.
