"""
Phase 7 Step 3 unit tests: inner-CV harness pure-helpers.

No DB, no LightGBM. Validates the deterministic pieces:
  - forward-chaining fold construction (sizes, ordering, no overlap)
  - halflife column subset (only this-halflife deltas + all aggs + game-level)
  - winner selection (lowest mean Brier; tie-break to shortest halflife)
  - pooled Brier formula

Plan: Plans/nba-learned-model.md addendum v18 §"Implementation sequence" step 3.
"""

import math
import os
import sys

import numpy as np

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO_ROOT)

from ml.nba.features import PHASE7_FEATURE_NAMES_ALL, PHASE7_HALFLIVES  # noqa: E402
from ml.nba.phase7_cv_runner import (  # noqa: E402
    N_FOLDS,
    _column_mask_for_halflife,
    _make_forward_chaining_folds,
    _pooled_brier,
    _select_winner,
    _subset_for_halflife,
)


def test_make_forward_chaining_folds_shapes() -> None:
    n = 100
    folds = _make_forward_chaining_folds(n, n_folds=5)
    # 5 slices total, 4 scored folds (folds 1..4)
    assert len(folds) == 4
    slice_size = n // 5  # = 20
    # Fold 1: train on slice 0 (size 20), test on slice 1 (size 20)
    train_idx, test_idx = folds[0]
    assert len(train_idx) == slice_size
    assert len(test_idx) == slice_size
    assert train_idx.max() < test_idx.min(), "train must precede test (forward-chaining)"
    # Fold 4: train on slices 0..3 (size 80), test on slice 4 (size 20)
    train_idx, test_idx = folds[3]
    assert len(train_idx) == 4 * slice_size
    assert len(test_idx) == slice_size
    assert train_idx.max() < test_idx.min()


def test_make_forward_chaining_folds_no_overlap_and_growing_train() -> None:
    folds = _make_forward_chaining_folds(100, n_folds=5)
    prev_train_size = 0
    for train_idx, test_idx in folds:
        assert len(np.intersect1d(train_idx, test_idx)) == 0, "train/test overlap"
        assert len(train_idx) > prev_train_size, "train set must grow each fold"
        prev_train_size = len(train_idx)


def test_make_forward_chaining_folds_uneven_n_absorbed_by_last_slice() -> None:
    # n=103, n_folds=5 → slice_size=20, last slice gets the leftover 3
    folds = _make_forward_chaining_folds(103, n_folds=5)
    last_train, last_test = folds[-1]
    assert len(last_test) == 23  # 20 + 3 leftover


def test_make_forward_chaining_folds_n_too_small_raises() -> None:
    try:
        _make_forward_chaining_folds(3, n_folds=5)
        raise AssertionError("expected ValueError for n=3 < n_folds=5")
    except ValueError:
        pass


def test_column_mask_for_halflife_selects_correct_columns() -> None:
    feature_names = PHASE7_FEATURE_NAMES_ALL
    for h in PHASE7_HALFLIVES:
        mask = _column_mask_for_halflife(feature_names, h)
        kept = [n for n, m in zip(feature_names, mask) if m]
        # kept must include all _agg features and game-level features
        agg_count = sum(1 for n in feature_names if n.endswith("_agg"))
        game_level_count = sum(
            1 for n in feature_names if "_agg" not in n and "_delta_h" not in n
        )
        kept_agg = sum(1 for n in kept if n.endswith("_agg"))
        kept_game = sum(
            1 for n in kept if "_agg" not in n and "_delta_h" not in n
        )
        assert kept_agg == agg_count, f"halflife={h}: kept {kept_agg}/{agg_count} aggs"
        assert kept_game == game_level_count
        # kept must include only this halflife's deltas, no others
        for other_h in PHASE7_HALFLIVES:
            if other_h == h:
                continue
            other_count = sum(1 for n in kept if f"_delta_h{other_h}" in n)
            assert other_count == 0, f"halflife={h} leaked _delta_h{other_h} columns"
        this_count = sum(1 for n in kept if f"_delta_h{h}" in n)
        expected_this = sum(1 for n in feature_names if f"_delta_h{h}" in n)
        assert this_count == expected_this


def test_subset_for_halflife_returns_aligned_arrays() -> None:
    feature_names = PHASE7_FEATURE_NAMES_ALL
    n_rows = 20
    rng = np.random.default_rng(0)
    X = rng.normal(size=(n_rows, len(feature_names)))
    for h in PHASE7_HALFLIVES:
        X_sub, sub_names = _subset_for_halflife(X, feature_names, h)
        assert X_sub.shape[0] == n_rows
        assert X_sub.shape[1] == len(sub_names)
        # Per-team: 10 aggs + 10 h-deltas = 20; × 2 teams = 40; + 9 game-level = 49
        assert X_sub.shape[1] == 49, X_sub.shape


def test_select_winner_lowest_mean_brier() -> None:
    halflife_results = {
        7:  {"mean_brier": 0.235},
        14: {"mean_brier": 0.230},
        21: {"mean_brier": 0.232},
    }
    assert _select_winner(halflife_results) == 14


def test_select_winner_tie_break_shortest_halflife() -> None:
    # Tie at 0.230 between h=7 and h=21 → recency-prefer (shortest halflife wins)
    halflife_results = {
        7:  {"mean_brier": 0.230},
        14: {"mean_brier": 0.235},
        21: {"mean_brier": 0.230},
    }
    assert _select_winner(halflife_results) == 7


def test_pooled_brier_matches_formula() -> None:
    y_true = np.array([1.0, 0.0, 1.0, 0.0])
    y_pred = np.array([0.9, 0.1, 0.6, 0.4])
    expected = float(np.mean((y_pred - y_true) ** 2))
    assert math.isclose(_pooled_brier(y_true, y_pred), expected, abs_tol=1e-12)


if __name__ == "__main__":
    test_make_forward_chaining_folds_shapes()
    test_make_forward_chaining_folds_no_overlap_and_growing_train()
    test_make_forward_chaining_folds_uneven_n_absorbed_by_last_slice()
    test_make_forward_chaining_folds_n_too_small_raises()
    test_column_mask_for_halflife_selects_correct_columns()
    test_subset_for_halflife_returns_aligned_arrays()
    test_select_winner_lowest_mean_brier()
    test_select_winner_tie_break_shortest_halflife()
    test_pooled_brier_matches_formula()
    print("PASS: ml/nba/test_phase7_cv_runner.py (9 tests)")
