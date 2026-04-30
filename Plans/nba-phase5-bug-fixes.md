# NBA Phase 5 — TOV% Fix + Regular-Season Val Fold

**Status**: COUNCIL-CLEAR (Gate 1, 2026-04-29, fix-pack applied). Append-only from this point.

---

## Problem

Two bugs from Phase 3 post-mortem corrupt signal in the 44-feature EWMA-h21 model. Neither was introduced in Phase 4; both were present throughout.

**Bug 1 — TOV% scaling.** `tov_pct_off` and `tov_pct_def` are stored as percentages (values 5–25) but fed into `logit_zscore`, which clips to [ε, 1−ε] before taking logit. Any value above ~1 clips to 1−ε, so every game produces the same logit. Std ≈ 0, z-score = 0 for every observation. Four features are silently zeroed. efg_pct is already stored as a fraction (0.45–0.60) and is unaffected. oreb_pct and dreb_pct are also fractions and unaffected.

**Bug 2 — Postseason val fold contamination.** The val fold is the last 20% of training games by date. The training window ends April 2026, so roughly 84 of the 528 val games are 2024-25 postseason. EWMA features are warm in the postseason (60–70 games of history per team), making val Brier improvement look better than it is. The test fold is regular-season only, so the val estimate is systematically optimistic. This inflated the Phase 3 and Phase 4 val signals. Note: this fix removes postseason selection bias from the val metric. EWMA saturation asymmetry within the regular season remains a known limitation but is symmetric across train/val/test folds and does not bias the head-to-head comparison.

---

## Changes

Two code changes only. Architecture, feature set, and training procedure are otherwise unchanged.

### Change 1 — `ml/nba/features.py` lines 278–280

Remove `100.0 *` from the tov_pct computation:

```python
# Before
tov_pct_off = 100.0 * tov / max(tov_denom_off, 1.0)
tov_pct_def = 100.0 * opp_tov / max(tov_denom_def, 1.0)

# After
tov_pct_off = tov / max(tov_denom_off, 1.0)
tov_pct_def = opp_tov / max(tov_denom_def, 1.0)
```

Result: tov_pct values fall in ~0.05–0.25, correctly handled by `logit_zscore`. Expected logit range: logit(0.05) ≈ −2.94 to logit(0.25) ≈ −1.10, a spread of ~1.85 logit units.

### Change 2 — `ml/nba/cv_runner.py` + `ml/nba/calibrate.py`

After the 80/20 train/val split, filter the val fold to regular-season game IDs for both (a) val Brier computation and (b) Platt calibration fitting. Postseason games stay in the training portion — not removed from training data, excluded from val metric and calibration.

`build_training_tensor` already returns `game_ids` alongside X and y; the split uses them to identify season type via a DB lookup or season field. No schema or DB changes needed.

**Platt fitting scope (fix-pack §2):** Platt calibration is fit exclusively on regular-season rows from the val fold. This aligns the fitting domain with the Brier evaluation domain. The plan does not fit on the mixed pool.

**Implementation assertion required:** Assert `len(game_ids) == len(X) == len(y)` immediately after the 80/20 split and after the regular-season filter, to confirm positional alignment is preserved before any Brier computation.

---

## What stays the same

- 44-feature EWMA-h21 architecture (ewma-h21 inner-CV winner from Phase 3)
- BPM prior (bpm_effective, K=10) — included as-is from Phase 4
- 20-seed LightGBM ensemble, same hyperparameters
- Logit-space Platt calibration, LogisticRegression(C=1e9)
- Test fold: 2025-regular (untouched until after Gate 1 is cleared)
- Touch counter: reset to 0 for Phase 5 (Phase 3+4 history preserved)

---

## Ship rules

Pre-declared. No movement after code is written.

### Gate D (halt gate)

LightGBM AUC ≥ v5 AUC (0.7283) on the test fold. If fail, stop — declare null result.

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

### Rule 3 — Unconditional mean sanity

|mean(lgbm predictions) − empirical home win rate| ≤ 0.02.

### Sequential evaluation

LightGBM only. No MLP fallback. If Gate D fails, declare null and plan Phase 6.

---

## Known limitations (pre-declared)

- Val Brier and Platt fitting are both scoped to regular-season rows from the val fold. Postseason rows appear in training but not in metric computation. This is intentional and pre-declared, not a consequence of the bug fix.
- EWMA saturation asymmetry within the regular season (early-season games have sparse history; late-season games have warm history) remains in the val fold. This is symmetric with the test fold and does not bias the comparison against v5.
- Combining both fixes means individual contributions cannot be isolated. If Gate D passes narrowly, the result is attributed to the fixes jointly.

---

## If Gate D fails

The AUC gap at end of Phase 4 was 0.0042 (0.7241 vs 0.7283). The TOV% fix recovers 4 features of real signal; the val fold fix removes optimistic bias. If the gap persists:

- Declare null result. Ship bar does not move.
- Consider removing BPM prior for Phase 6 (it was null in Phase 4).
- Phase 6 target: hybrid feature design — season-aggregate base + EWMA adjustment, which directly addresses v5's structural advantage.

---

## Scope

Bug fix release. No new data collection or schema changes. DB is read-only.
Compute: retrain (~10 min), recalibrate (~2 min), evaluate (~5 min).

---

## Addendum — Council Gate 1 (2026-04-29)

**DQ — 7/10 — WARN (resolved):** Two issues flagged. (1) Runtime assertion for game_ids positional alignment — added to implementation spec. (2) Platt fitting domain asymmetry — resolved by scoping Platt fit to regular-season val rows only.

**Stats — 6/10 — WARN (resolved):** Three issues flagged. (1) Val fold distribution shift pre-declared as known limitation. (2) CI-only ship bar too weak — absolute Brier floor of Δ ≥ 0.001 added to Rule 1. (3) Directional expectation for TOV% fix: feature importance for tov_pct_off/def features expected to increase post-fix (verifiable after training).

**Pred — 7/10 — CLEAR:** Plan technically grounded. Bug confirmed in code. Combining both fixes is acceptable for a bug-fix release. LightGBM-only evaluation appropriate.

**Domain — 8/10 — CLEAR:** TOV% fix correct. Oliver TOV% formula is domain-standard. No other pct features share the bug. No domain blockers.

**Math — 7/10 — WARN (resolved):** Two issues. (1) Val fold fix claim softened — only removes postseason selection bias, not EWMA saturation asymmetry. (2) Platt domain mismatch resolved by fitting on regular-season val rows only.

**Resolver: WARN → fix-pack applied → CLEAR. No R2 required. Proceed to implementation.**

Weighted score (post-fix-pack): DQ 8, Stats 7, Pred 7, Domain 8, Math 8 → avg 7.6/10.

---

## Addendum — Council Gate 2 (2026-04-29) — Test-fold results (null result)

**Test fold:** 2025-regular. Run ID: `20260428T200859-c93c6bad`. LightGBM 20-seed ensemble. Touch counter: 1/1 (LightGBM only, per pre-declared plan).

**Results:**

| Metric | Phase 5 LightGBM | v5 Baseline | Delta |
|---|---|---|---|
| AUC | 0.7221 | 0.7283 | −0.0062 |
| Brier (test) | 0.211973 | 0.209259 | +0.002714 |
| Val Brier (cal, reg-season) | 0.196248 | — | — |
| Platt A | 1.266233 | — | — |
| Platt B | 0.065834 | — | — |

**Gate D: FAIL** (AUC 0.7221 < 0.7283). Null result declared per pre-declared plan. No ship-rule evaluation.

**DQ — 8/10 — CLEAR:** Test fold untouched and correct. Counter reset and single touch verified. Both bug fixes confirmed in code. Run ID and calibration-params.json consistent.

**Stats — 8/10 — CLEAR:** Gate D point-estimate comparison is unambiguous. Three consecutive Gate D FAILs at consistent gaps (Phase 3: 0.0329 gap, Phase 4: 0.0042, Phase 5: 0.0062) confirm this is not sampling noise. Val Brier improvement (0.203 mixed-fold → 0.196 reg-season-only) reflects removal of postseason optimistic bias from the val metric, not test-fold improvement. Null result is clean.

**Pred — 7/10 — CLEAR:** Bug fixes were real and correctly implemented. Fixing real bugs did not close the AUC gap — confirming the structural diagnosis. Discriminative power (AUC) is not limited by calibration; EWMA features do not encode the information v5 uses. Phase 6 (add season-aggregate net rating) directly addresses this.

**Domain — 7/10 — CLEAR:** Slight AUC drop from Phase 4 (0.7241) to Phase 5 (0.7221) despite fixing real bugs is consistent with the TOV% fix re-introducing feature variance that may add noise before signal at n=2640. Not a methodology error. Structural gap to v5 is season-aggregate point differential. No domain blockers.

**Math — 8/10 — CLEAR:** Platt A=1.266 (less than Phase 4 A=1.308) is consistent with removing postseason val games that had warm EWMA features. Brier gap and AUC comparison arithmetic correct.

**Council verdict: 5/5 CLEAR — avg 7.6/10. Gate 2 CLEAR. Phase 5 null result accepted. v5 remains incumbent.**

**Next:** Phase 6 — add `home_season_net_rating` and `away_season_net_rating` (season-to-date cumulative point diff / games played) as explicit features alongside the 44 EWMA features. Plan in `Plans/nba-phase6-season-aggregate.md`.
