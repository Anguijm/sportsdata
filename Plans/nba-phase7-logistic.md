# NBA Phase 7 — Logistic Regression on 46-Feature Set

**Status**: COUNCIL-CLEAR (Gate 1, 2026-04-29, avg 8.8/10). Append-only from this point.

---

## Context

Phases 3–6 placed LightGBM at AUC 0.7221–0.7241, consistently 0.004–0.006 below v5's 0.7283. Phase 6 added `season_net_rating` (v5's core signal expressed as a feature) and gained only +0.0016 AUC. The council Phase 6 Gate 2 diagnosis:

> "LightGBM can't effectively use those features when competing with 44 noisy EWMA inputs at n=2640 with min_child_samples=200."
> "LightGBM has to discover those coefficients from data — and consistently falls short."

The problem is architectural: LightGBM is a high-variance model at n=2640. It allocates capacity to 44 EWMA features that are correlated with each other and with `season_net_rating`, and cannot reliably isolate the dominant linear signal.

---

## Hypothesis

Logistic regression will out-perform LightGBM at this sample size because:

1. **v5 is a linear model.** v5 = `sigmoid(0.10 × (home_diff − away_diff + 2.25))`. The theoretically optimal predictor given only season-average differentials is a sigmoid of a linear combination. Logistic regression finds exactly this linear combination.

2. **L2 regularization handles the feature redundancy.** With 46 features at n=2640, Ridge regression shrinks noisy EWMA coefficients toward zero and concentrates weight on the most informative ones (`home_season_net_rating`, `away_season_net_rating`, BPM effective). LightGBM cannot do this gracefully at small n.

3. **No ensemble overhead.** LR is deterministic; no 20-seed averaging needed. Reduced variance compared to any single LightGBM tree.

**Directional expectation:** AUC 0.729–0.736. If LR also fails Gate D (< 0.7283), the conclusion is that the 46-feature set lacks sufficient signal for a learned model at n=2640 — Phase 8 direction: drop EWMA entirely, use season-aggregate only (4–6 features).

---

## What changes

One new training script. Zero feature engineering changes.

### Change 1 — `ml/nba/train_logistic.py` (new)

Trains a single `sklearn.linear_model.LogisticRegression` with:

- `penalty='l2'` (Ridge)
- `solver='lbfgs'`
- `max_iter=1000`
- `C=best_C` selected by inner 5-fold CV (see below)
- `class_weight=None` (balanced via train split)

The model is fit on the same normalized 46-feature training tensor produced by `build_training_tensor()` in `features.py`. No new feature engineering.

**Inner CV for C selection:**

C candidates: `[0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0]` — nine values spanning five decades.

5-fold temporal inner CV on the training fold:
- Folds defined by `game_date` sort order (not random), same time-machine discipline as existing inner CV
- Selection criterion: `max mean AUC` (same as Phase 3 inner CV selection rule)
- Report both mean AUC and σ across folds

**Outputs (mirroring calibrate.py output format):**
- Val fold AUC (Gate D metric)
- Val fold Brier (secondary)
- Selected C value
- Coefficient magnitudes (top 10 by |coef|) — interpretability check
- Cold-start Brier Δ (games 1–20, both teams)

### What stays the same

- `ml/nba/features.py` — 46-feature tensor, unchanged
- Train/val/test split: identical to Phases 3–6 (80/20, regular-season val only)
- BPM prior blend (`bpm_effective`, K=10) — retained as-is
- Training data cutoff: 2026-04-29T00:00:00Z (same as Phase 6)
- Test fold: 2025-regular (untouched; test-fold-touch-counter = 1)
- Platt calibration: **not applied** — L2-regularized LR outputs calibrated probabilities natively. (If council raises concern: add optional Platt step with C=1e9 on val fold, and evaluate before/after Brier to confirm calibration quality.)

---

## Ship rules

Pre-declared. No movement after code is written.

### Gate D (halt gate)

LR val-fold AUC ≥ v5 AUC (0.7283). If fail → declare null result, plan Phase 8.

**Directional expectation:** AUC improvement ≥ 0.005 over Phase 6 LightGBM (≥ 0.7287). If AUC in 0.728–0.729 (barely passes Gate D), council should assess whether the margin is within sampling noise before opening the test fold.

### Rule 1 — Brier improvement

Val-fold Brier ≤ v5 val-fold Brier (0.2093). If regression (Brier > 0.212), halt and investigate before test fold.

### Rule 2 — Cold-start preservation

Cold-start Brier Δ (LR vs v5 on games 1–20 for both teams) ≤ +0.002. Phase 4 established that BPM prior keeps cold-start Brier Δ = +0.0019; Phase 7 must not regress.

### Rule 3 — Feature coherence check (implementation gate only)

Top-5 coefficients by |coef| must include `home_season_net_rating` and/or `away_season_net_rating`. If season_net_rating features are not among the top-5, this is a signal of a normalization bug or data issue — do not open the test fold; investigate first.

---

## If Gate D fails

Declare null result. Ship bar does not move.

Phase 8 direction: drop EWMA features entirely, use only:
- `home_season_net_rating`, `away_season_net_rating` (phase 6)
- `home_bpm_effective`, `away_bpm_effective` (phase 4)
- Possibly: `home_opp_adj_nrtg`, `away_opp_adj_nrtg` (already computed)

Total: 4–6 features. This matches v5's architecture but in a learned model, testing whether v5 is essentially at the ceiling for season-aggregate features.

---

## Test fold protocol

- Touch counter at Phase 7 start: 1 (Phase 6 consumed one touch)
- Counter limit: 2 total (one touch remaining)
- Test fold opened **only** if Gate D passes AND Rule 1 passes AND council Gate 1 (implementation) CLEAR
- After test fold evaluation: council Gate 2 (results) required before any ship claim

---

## Artifacts plan

| File | Purpose |
|---|---|
| `ml/nba/train_logistic.py` | New training script |
| `ml/nba/results/<run-id>/` | Run artifacts (val AUC, Brier, C selection, coefficients) |
| This file (addenda) | Council reviews, run results |

---

## Addendum — Council Gate 1 (2026-04-29)

**DQ — 9/10 — CLEAR:** No new data sources. 46-feature tensor from `features.py` validated in Phases 3–6. Note: training data cutoff must be set to 2026-04-29T00:00:00Z explicitly at implementation time (Phase 7 branch starts from main, not the cold-start branch).

**Stats — 8/10 — CLEAR:** p/n=1.7%, L2 regularization appropriate. 5-fold temporal inner CV for C selection is sound. Action item: if best_C lands at grid boundary (0.001 or 10.0), expand grid before proceeding. Report σ_AUC across inner folds in artifacts; if σ > 0.010, flag for council.

**Pred — 9/10 — CLEAR:** LR directly learns v5's functional form. Rule 3 (feature coherence: top-5 must include season_net_rating) endorsed as a valuable implementation gate. Recommend reporting ECE or reliability diagram alongside Brier in artifacts.

**Domain — 9/10 — CLEAR:** Logistic regression on season-aggregate quality features is the sport-defensible analogue of v5's formula. No concerns.

**Math — 9/10 — CLEAR:** L2-LR is strictly convex; lbfgs appropriate at this scale. Probability calibration decision (no Platt) is mathematically correct. Confirm at implementation review that the normalized tensor (z-scored) is passed to LogisticRegression, not raw features.

**Council verdict: 5/5 CLEAR — avg 8.8/10. Gate 1 CLEAR. Code may proceed.**
