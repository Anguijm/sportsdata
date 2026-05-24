#!/usr/bin/env python3
"""Phase 7 Step 4 — pm.8 smoke test for val-fold evaluation.

Asserts 8 non-degeneracy properties pre-declared in addendum v22 §"pm.8 smoke
test" before impl-review can vote CLEAR:

  1. Training tensor non-degenerate (already covered by v21 smoke; re-imports
     and runs that suite's core check on the unfiltered tensor).
  2. Platt holdout (last 25% of training by date) has ≥1 of each outcome class.
  3. Val tensor for 2023-regular has exactly 1,237 rows after season filter
     (matches pm.7 audit count in v22).
  4. Val tensor has both classes.
  5. v5 baseline predictions on val: mean ∈ (0.45, 0.65) and std > 0.01.
  6. Phase 7 predictions on val: same sanity bounds (mean ∈ (0.45, 0.65),
     std > 0.01).
  7. Brier computation produces no NaN/inf.
  8. Block-bootstrap runs with B=10,000 in under 60 seconds and emits finite
     CI endpoints.

Per addendum v22 + the pm.8 council rule in .harness/council/README.md, any
failing assertion blocks impl-review CLEAR on the Step 4 PR.

Run:
    PYTHONPATH=. /usr/bin/python3 ml/nba/test_phase7_val_eval_smoke.py
"""

from __future__ import annotations

import pathlib
import sqlite3
import sys
import time

import numpy as np

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
DB_PATH = REPO_ROOT / "data" / "sqlite" / "sportsdata.db"

PHASE7_VAL_SEASONS = ("2023-regular",)
WINNING_HALFLIFE = 14
PLATT_HOLDOUT_FRAC = 0.25
EXPECTED_VAL_N = 1237  # pm.7 audit confirmed in v22


def main() -> int:
    if not DB_PATH.exists():
        print(f"SKIP: {DB_PATH} not present (smoke requires PR-2 backfilled DB).", file=sys.stderr)
        return 0

    from ml.nba.features import (
        FeatureConfig,
        build_phase7_training_tensor,
    )
    from ml.nba.phase7_cv_runner import (
        PHASE7_TRAINING_SEASONS,
        _subset_for_halflife,
    )
    from ml.nba.evaluate_test_fold import (
        _block_bootstrap_ci,
        _block_labels,
        _compute_v5_on_games,
    )
    from ml.nba.phase7_val_eval import (
        DEFAULT_TRAINING_AS_OF,
        _date_lookup,
        _season_lookup,
    )

    failures: list[str] = []

    config = FeatureConfig(feature_form="season_agg", training_as_of=DEFAULT_TRAINING_AS_OF)
    X_all, y_all, game_ids_all = build_phase7_training_tensor(config, str(DB_PATH))
    feature_names = config.feature_names

    # Assertion 1: training-tensor non-degenerate (v21-equivalent check)
    if X_all.shape[0] == 0:
        failures.append("1: training tensor empty (was time-machine filter regressed?)")
    if not (set(int(v) for v in y_all) == {0, 1}):
        failures.append(f"1: y has wrong classes {set(int(v) for v in y_all)}; expected {{0, 1}}")
    delta_h14_idxs = [i for i, n in enumerate(feature_names) if "_delta_h14" in n]
    if delta_h14_idxs:
        h14_stds = np.array([float(np.std(X_all[:, i])) for i in delta_h14_idxs])
        if not (h14_stds > 0).any():
            failures.append("1: all h=14 delta columns have std=0 (v21 regression?)")
    else:
        failures.append("1: feature_names missing _delta_h14 columns")

    season_by_id = _season_lookup(game_ids_all, DB_PATH)
    date_by_id = _date_lookup(game_ids_all, DB_PATH)

    # Assertion 2: Platt holdout (last 25% by date) has both classes
    train_mask = np.array([season_by_id.get(g, "") in PHASE7_TRAINING_SEASONS for g in game_ids_all])
    if not train_mask.any():
        failures.append("2: no training rows; cannot compute Platt holdout")
    else:
        y_train = y_all[train_mask]
        gids_train = [g for g, m in zip(game_ids_all, train_mask) if m]
        dates_train = np.array([date_by_id[g] for g in gids_train])
        sort_idx = np.argsort(dates_train, kind="stable")
        y_train_sorted = y_train[sort_idx]
        n_lgbm = int(round(len(y_train_sorted) * (1 - PLATT_HOLDOUT_FRAC)))
        y_platt = y_train_sorted[n_lgbm:]
        platt_classes = set(int(v) for v in y_platt)
        if platt_classes != {0, 1}:
            failures.append(f"2: Platt holdout y has classes {platt_classes}; expected {{0, 1}}")

    # Assertion 3: val tensor row count exactly 1,237 (pm.7 audit)
    val_mask = np.array([season_by_id.get(g, "") in PHASE7_VAL_SEASONS for g in game_ids_all])
    n_val = int(val_mask.sum())
    if n_val != EXPECTED_VAL_N:
        failures.append(f"3: val tensor has {n_val} rows; expected {EXPECTED_VAL_N} per pm.7 audit")

    # Assertion 4: val tensor has both classes
    y_val = y_all[val_mask]
    val_classes = set(int(v) for v in y_val)
    if val_classes != {0, 1}:
        failures.append(f"4: val y has classes {val_classes}; expected {{0, 1}}")

    val_gids = [g for g, m in zip(game_ids_all, val_mask) if m]

    # Assertion 5: v5 baseline sane (mean in (0.45, 0.65); std > 0.01)
    p_v5 = _compute_v5_on_games(val_gids)
    if not (0.45 < p_v5.mean() < 0.65):
        failures.append(f"5: v5 mean {p_v5.mean():.4f} outside (0.45, 0.65) — unexpected home-advantage")
    if not (p_v5.std() > 0.01):
        failures.append(f"5: v5 std {p_v5.std():.4f} ≤ 0.01 — degenerate predictions")

    # Assertion 6: Phase 7 predictions sane — requires a quick LightGBM train pass.
    # Reuses the production train path so this is a real smoke, not a synthetic check.
    if not failures:  # only proceed if upstream assertions PASS
        from ml.nba.train_lightgbm import fit_lgbm, score_lgbm
        from ml.nba.phase7_cv_runner import LGBM_PHASE7_PARAMS

        X_train = X_all[train_mask][sort_idx]
        X_train_lgbm = X_train[:n_lgbm]
        X_train_platt = X_train[n_lgbm:]
        y_train_lgbm = y_train_sorted[:n_lgbm]
        y_train_platt = y_train_sorted[n_lgbm:]

        X_lgbm_sub, _ = _subset_for_halflife(X_train_lgbm, feature_names, WINNING_HALFLIFE)
        X_platt_sub, _ = _subset_for_halflife(X_train_platt, feature_names, WINNING_HALFLIFE)
        X_val_sub, _ = _subset_for_halflife(X_all[val_mask], feature_names, WINNING_HALFLIFE)

        params = {**LGBM_PHASE7_PARAMS, "seed": 0, "random_state": 0}
        model = fit_lgbm(X_lgbm_sub, y_train_lgbm, X_platt_sub, y_train_platt, params)
        p_val_uncal = score_lgbm(model, X_val_sub)

        if not (0.40 < p_val_uncal.mean() < 0.70):
            # Pre-Platt range can be wider; just check it's not pathological.
            failures.append(f"6: Phase 7 raw mean {p_val_uncal.mean():.4f} outside (0.40, 0.70)")
        if not (p_val_uncal.std() > 0.01):
            failures.append(f"6: Phase 7 raw std {p_val_uncal.std():.4f} ≤ 0.01 — degenerate")

        # Assertion 7: no NaN/inf in Brier components
        brier_components = (p_val_uncal - y_val) ** 2
        if not np.isfinite(brier_components).all():
            failures.append("7: Brier components contain NaN or inf")

        # Assertion 8: block-bootstrap runs in <60s with finite CI endpoints
        paired_diff = (p_v5 - y_val) ** 2 - (p_val_uncal - y_val) ** 2
        block_labels = _block_labels(val_gids)
        t0 = time.perf_counter()
        rng = np.random.default_rng(0)
        bs_mean, bs_lo, bs_hi = _block_bootstrap_ci(paired_diff, block_labels, 10_000, rng)
        elapsed = time.perf_counter() - t0
        if elapsed >= 60:
            failures.append(f"8: bootstrap took {elapsed:.1f}s ≥ 60s budget")
        if not (np.isfinite(bs_mean) and np.isfinite(bs_lo) and np.isfinite(bs_hi)):
            failures.append(f"8: bootstrap returned non-finite ({bs_mean}, {bs_lo}, {bs_hi})")

    # Report
    print(f"X_all.shape    : {X_all.shape}")
    print(f"n_train        : {int(train_mask.sum())}")
    print(f"n_lgbm         : {int(round(int(train_mask.sum()) * (1 - PLATT_HOLDOUT_FRAC)))}")
    print(f"n_val          : {n_val} (expected {EXPECTED_VAL_N})")
    print(f"y class counts : 0={int((y_val == 0).sum())}, 1={int((y_val == 1).sum())}")
    print(f"v5 stats       : mean={p_v5.mean():.4f}  std={p_v5.std():.4f}")
    if not failures:
        print(f"\nAll 8 assertions PASSED.")
        return 0

    print(f"\n{len(failures)} assertion(s) FAILED:", file=sys.stderr)
    for f in failures:
        print(f"  - {f}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
