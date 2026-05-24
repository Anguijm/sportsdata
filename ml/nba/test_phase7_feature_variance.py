"""Smoke test for Phase 7 addendum v21 fix.

Asserts that build_phase7_training_tensor produces a non-degenerate
tensor when training_as_of points past the 2021/2022 backfill window.
Specifically:

- X has rows (n_games > 0)
- y has both classes present (so binary classifier can train)
- For each halflife candidate (7, 14, 21), the delta feature columns
  have non-zero columnwise variance — i.e., the features actually
  carry signal that lets the model distinguish halflives.

Before v21 (Bugs A + B in features.py): all delta columns had std=0
because the `updated_at <= training_as_of` filter excluded every
backfilled row, leaving the feature builder with no prior-history.
With v21's `g.date <= training_as_of` semantic, the prior history
populates correctly and EWMA values differ from season-aggregate
values per the addendum v18 design.

Run:
    PYTHONPATH=. python3 ml/nba/test_phase7_feature_variance.py

Non-zero exit on any assertion failure.

Plan: addendum v21 §"Code change scope" — gates impl-review CLEAR
on PR replacing the time-machine filter and refreshing TEST_FOLD_SEASONS.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

# Defer imports until after PYTHONPATH is verified
from ml.nba.features import (
    PHASE7_HALFLIVES,
    FeatureConfig,
    build_phase7_training_tensor,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = REPO_ROOT / "data" / "sqlite" / "sportsdata.db"
DEFAULT_TRAINING_AS_OF = "2024-01-01"


def main(db_path: Path = DEFAULT_DB, training_as_of: str = DEFAULT_TRAINING_AS_OF) -> int:
    failures: list[str] = []

    if not db_path.exists():
        print(f"SKIP: {db_path} not present. Smoke test requires the PR-2 backfill.", file=sys.stderr)
        return 0

    config = FeatureConfig(feature_form="season_agg")
    config.training_as_of = training_as_of
    X, y, game_ids = build_phase7_training_tensor(config, db_path=str(db_path))

    if X.shape[0] == 0:
        failures.append(f"X is empty (shape={X.shape}); time-machine filter likely still excludes the backfill.")

    if y.shape[0] != X.shape[0]:
        failures.append(f"X and y disagree on n_rows: {X.shape[0]} vs {y.shape[0]}.")

    classes = sorted(set(int(v) for v in y))
    if classes != [0, 1]:
        failures.append(f"y must have both classes present; observed: {classes}.")

    feature_names = config.feature_names or []
    if len(feature_names) != X.shape[1]:
        failures.append(f"feature_names length {len(feature_names)} != X.shape[1] {X.shape[1]}.")

    # Per-halflife group: at least one delta column has std > 0.
    for halflife in PHASE7_HALFLIVES:
        suffix = f"_delta_h{halflife}"
        col_idxs = [i for i, n in enumerate(feature_names) if suffix in n]
        if not col_idxs:
            failures.append(f"halflife {halflife}: no delta columns found in feature_names.")
            continue
        stds = np.array([float(np.std(X[:, i])) for i in col_idxs])
        if not (stds > 0).any():
            failures.append(
                f"halflife {halflife}: all {len(col_idxs)} delta columns have std=0 "
                f"(Bug A — time-machine filter excluding backfilled rows)."
            )

    # agg columns must also have non-zero variance — they're the base signal.
    agg_idxs = [i for i, n in enumerate(feature_names) if "_agg" in n]
    if agg_idxs:
        agg_stds = np.array([float(np.std(X[:, i])) for i in agg_idxs])
        if not (agg_stds > 0).any():
            failures.append("All agg columns have std=0 (entire backfilled fold likely excluded).")

    # CROSS-HALFLIFE CHECK — values per row must differ across halflives for
    # the same stat, otherwise the inner-CV winner selection is meaningless.
    # Picks the home net_rating delta as the canary stat.
    canary_stat = "home_net_rating"
    h_cols = {h: None for h in PHASE7_HALFLIVES}
    for i, n in enumerate(feature_names):
        for h in PHASE7_HALFLIVES:
            if n == f"{canary_stat}_delta_h{h}":
                h_cols[h] = i
                break

    if any(v is None for v in h_cols.values()):
        failures.append(f"Could not locate all 3 halflives' canary columns ({canary_stat}_delta_h*).")
    else:
        h7_vals = X[:, h_cols[7]]
        h14_vals = X[:, h_cols[14]]
        h21_vals = X[:, h_cols[21]]
        if np.allclose(h7_vals, h14_vals):
            failures.append(f"{canary_stat}: h=7 and h=14 columns are identical (Bug A — both EWMAs collapsed to season-agg).")
        if np.allclose(h7_vals, h21_vals):
            failures.append(f"{canary_stat}: h=7 and h=21 columns are identical (Bug A — both EWMAs collapsed to season-agg).")
        if np.allclose(h14_vals, h21_vals):
            failures.append(f"{canary_stat}: h=14 and h=21 columns are identical (Bug A — both EWMAs collapsed to season-agg).")

    # Report
    print(f"X.shape        : {X.shape}")
    print(f"y class counts : 0={int((y == 0).sum())}, 1={int((y == 1).sum())}")
    print(f"agg cols       : {sum(1 for n in feature_names if '_agg' in n)}")
    for halflife in PHASE7_HALFLIVES:
        suffix = f"_delta_h{halflife}"
        col_idxs = [i for i, n in enumerate(feature_names) if suffix in n]
        if col_idxs:
            stds = np.array([float(np.std(X[:, i])) for i in col_idxs])
            nz = int((stds > 0).sum())
            print(f"h={halflife:>2} deltas    : {len(col_idxs)} cols, {nz} with std>0, max_std={stds.max():.4f}")

    if failures:
        print(f"\n{len(failures)} assertion(s) failed:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1

    print("\nAll assertions passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
