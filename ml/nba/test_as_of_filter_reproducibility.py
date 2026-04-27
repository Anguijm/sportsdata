"""
Phase 3 step 4 unit test: as_of filter reproducibility.

Calls build_training_tensor twice with the same config; asserts the returned
(X, y, game_ids) are bit-identical.

Plan: Plans/nba-learned-model.md addendum v12 §"Unit tests" #2.
"""

import os
import sys

import numpy as np

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO_ROOT)

from ml.nba.features import FeatureConfig, build_training_tensor

DB_PATH = os.path.join(REPO_ROOT, "data", "sqlite", "sportsdata.db")


def test_reproducibility() -> None:
    if not os.path.exists(DB_PATH):
        print(f"SKIP: DB not found at {DB_PATH}")
        return

    config1 = FeatureConfig(
        window_size=10,
        feature_form="rolling",
        training_as_of="2026-04-01T00:00:00Z",
    )
    X1, y1, ids1 = build_training_tensor(config1, DB_PATH)

    config2 = FeatureConfig(
        window_size=10,
        feature_form="rolling",
        training_as_of="2026-04-01T00:00:00Z",
    )
    X2, y2, ids2 = build_training_tensor(config2, DB_PATH)

    print(f"Run 1: X shape={X1.shape}, y shape={y1.shape}, n_games={len(ids1)}")
    print(f"Run 2: X shape={X2.shape}, y shape={y2.shape}, n_games={len(ids2)}")

    errors = []

    if ids1 != ids2:
        errors.append(f"game_ids differ: {len(ids1)} vs {len(ids2)}")
    else:
        print("game_ids: identical")

    if not np.array_equal(y1, y2):
        diff = np.sum(y1 != y2)
        errors.append(f"y differs: {diff} positions differ")
    else:
        print("y: bit-identical")

    if not np.array_equal(X1, X2):
        # Allow for NaN == NaN comparison
        nan_both = np.isnan(X1) & np.isnan(X2)
        val_same = X1 == X2
        identical = np.all(nan_both | val_same)
        if not identical:
            diff = np.sum(~(nan_both | val_same))
            errors.append(f"X differs: {diff} elements differ")
        else:
            print("X: bit-identical (including NaN positions)")
    else:
        print("X: bit-identical")

    if errors:
        print("FAIL:")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)

    print("PASS — build_training_tensor is reproducible with same config")


if __name__ == "__main__":
    test_reproducibility()
