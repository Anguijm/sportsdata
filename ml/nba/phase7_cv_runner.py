#!/usr/bin/env python3
"""
Phase 7 Step 3 — inner-CV training harness.

Selects the winning EWMA halflife from PHASE7_HALFLIVES = [7, 14, 21] via
forward-chaining K=5 CV on the 2021-regular + 2022-regular training fold.
Writes a JSON results artifact for council results-review.

Run:
    python ml/nba/phase7_cv_runner.py [training_as_of]

Prerequisites: data/sqlite/sportsdata.db populated; LightGBM installed
(see requirements-ml.txt).

Plan: Plans/nba-learned-model.md addendum v18 §"Implementation sequence"
      step 3 (Council results review gate before val fold touch).
"""

import json
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.nba.features import (  # noqa: E402
    FeatureConfig,
    PHASE7_AGG_STATS,
    PHASE7_HALFLIVES,
    PHASE7_FEATURE_NAMES_ALL,
    build_phase7_training_tensor,
)


PHASE7_TRAINING_SEASONS: tuple[str, ...] = ("2021-regular", "2022-regular")
N_FOLDS: int = 5

# LightGBM hyperparameters carried forward from Phase 3 addendum v13 defaults
# (cv_runner.py:LGBM_DEFAULT_PARAMS). Step 3 fixes these for the halflife
# selection sweep; any subsequent hyperparameter tuning is a separate step.
LGBM_PHASE7_PARAMS: dict = {
    "num_leaves": 63,
    "min_child_samples": 100,
    "reg_alpha": 0.1,
    "n_estimators": 2000,
    "early_stopping_rounds": 50,
}

DB_PATH = REPO_ROOT / "data" / "sqlite" / "sportsdata.db"
RESULTS_DIR = REPO_ROOT / "ml" / "nba" / "results"


# ── Pure helpers (no DB / no LightGBM) ────────────────────────────────────


def _make_forward_chaining_folds(
    n: int, n_folds: int = N_FOLDS
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Forward-chaining folds. Fold k trains on slices 0..k-1, scores slice k.
    Returns scored folds 1..n_folds-1 (fold 0 has no held-out slice to score).

    Mirrors `cv_runner.py::_make_folds` (Phase 3 convention) so Step 3 results
    are directly comparable to Phase 3's inner-CV.
    """
    if n < n_folds:
        raise ValueError(f"n={n} too small for n_folds={n_folds}")
    slice_size = n // n_folds
    slices = [
        np.arange(i * slice_size, (i + 1) * slice_size if i < n_folds - 1 else n)
        for i in range(n_folds)
    ]
    folds: list[tuple[np.ndarray, np.ndarray]] = []
    for k in range(1, n_folds):
        train_idx = np.concatenate(slices[:k])
        test_idx = slices[k]
        folds.append((train_idx, test_idx))
    return folds


def _delta_suffixes_for_halflife(halflife: int) -> str:
    return f"_delta_h{halflife}"


def _column_mask_for_halflife(feature_names: list[str], halflife: int) -> np.ndarray:
    """Boolean mask over feature_names selecting the columns used by a single
    halflife candidate: all `_agg` features, all game-level features, and only
    the `_delta_h{halflife}` columns (other halflives' deltas are dropped)."""
    keep_suffix = _delta_suffixes_for_halflife(halflife)
    drop_suffixes = [
        _delta_suffixes_for_halflife(h)
        for h in PHASE7_HALFLIVES
        if h != halflife
    ]
    mask = np.zeros(len(feature_names), dtype=bool)
    for i, name in enumerate(feature_names):
        if any(d in name for d in drop_suffixes):
            mask[i] = False
        else:
            mask[i] = True
    return mask


def _subset_for_halflife(
    X: np.ndarray, feature_names: list[str], halflife: int
) -> tuple[np.ndarray, list[str]]:
    """Return (X_sub, names_sub) keeping only the columns this halflife uses."""
    mask = _column_mask_for_halflife(feature_names, halflife)
    sub_names = [n for n, m in zip(feature_names, mask) if m]
    return X[:, mask], sub_names


def _pooled_brier(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean((y_pred - y_true) ** 2))


def _select_winner(halflife_results: dict[int, dict]) -> int:
    """Lowest mean Brier wins. Tie-break: shortest halflife (most recency-sensitive)."""
    sorted_h = sorted(
        halflife_results.items(),
        key=lambda kv: (kv[1]["mean_brier"], kv[0]),
    )
    return sorted_h[0][0]


# ── DB-backed helpers (require sportsdata.db) ─────────────────────────────


def _filter_to_training_seasons(
    game_ids: list[str], db_path: Path
) -> np.ndarray:
    """Boolean mask: True for games whose season is in PHASE7_TRAINING_SEASONS."""
    conn = sqlite3.connect(db_path)
    placeholders = ",".join("?" * len(game_ids))
    rows = conn.execute(
        f"""
        SELECT game_id, season FROM nba_eligible_games
        WHERE game_id IN ({placeholders})
        """,
        game_ids,
    ).fetchall()
    conn.close()
    season_by_id = {gid: season for gid, season in rows}
    return np.array(
        [season_by_id.get(gid, "") in PHASE7_TRAINING_SEASONS for gid in game_ids]
    )


# ── Main inner-CV loop ────────────────────────────────────────────────────


def run_phase7_inner_cv(
    training_as_of: str,
    db_path: Path = DB_PATH,
    results_dir: Path = RESULTS_DIR,
) -> dict:
    """Train LightGBM on each halflife candidate via forward-chaining K=5 CV;
    pick winner by lowest mean held-out Brier across scored folds."""
    # Lazy import — keeps the module importable in environments without LightGBM
    # for unit-test purposes.
    from ml.nba.train_lightgbm import fit_lgbm, score_lgbm  # noqa: WPS433

    config = FeatureConfig(
        feature_form="season_agg",
        training_as_of=training_as_of,
    )
    X, y, game_ids = build_phase7_training_tensor(config, str(db_path))

    season_mask = _filter_to_training_seasons(game_ids, db_path)
    X = X[season_mask]
    y = y[season_mask]
    game_ids = [gid for gid, m in zip(game_ids, season_mask) if m]
    n = len(y)

    if n == 0:
        raise RuntimeError(
            f"No games matched PHASE7_TRAINING_SEASONS={PHASE7_TRAINING_SEASONS}"
        )

    folds = _make_forward_chaining_folds(n, N_FOLDS)

    halflife_results: dict[int, dict] = {}
    for halflife in PHASE7_HALFLIVES:
        X_sub, sub_names = _subset_for_halflife(X, config.feature_names, halflife)
        fold_briers: list[float] = []
        for k, (train_idx, test_idx) in enumerate(folds, start=1):
            params = {**LGBM_PHASE7_PARAMS, "seed": 0, "random_state": 0}
            model = fit_lgbm(
                X_sub[train_idx], y[train_idx],
                X_sub[test_idx],  y[test_idx],
                params,
            )
            y_pred = score_lgbm(model, X_sub[test_idx])
            fold_briers.append(_pooled_brier(y[test_idx], y_pred))
        halflife_results[halflife] = {
            "n_features": int(X_sub.shape[1]),
            "fold_briers": fold_briers,
            "mean_brier": float(np.mean(fold_briers)),
            "std_brier": float(np.std(fold_briers, ddof=0)),
        }

    winner = _select_winner(halflife_results)

    artifact = {
        "run_id": f"phase7-cv-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
        "phase": "phase7",
        "step": 3,
        "training_as_of": training_as_of,
        "training_seasons": list(PHASE7_TRAINING_SEASONS),
        "n_games": n,
        "n_folds": N_FOLDS,
        "scored_folds": list(range(1, N_FOLDS)),
        "halflives": PHASE7_HALFLIVES,
        "lgbm_params": LGBM_PHASE7_PARAMS,
        "halflife_results": {
            str(h): r for h, r in halflife_results.items()
        },
        "winner": {
            "halflife": winner,
            "mean_brier": halflife_results[winner]["mean_brier"],
        },
        "plan": "Plans/nba-learned-model.md addendum v18 §Implementation sequence step 3",
    }

    results_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = results_dir / f"{artifact['run_id']}.json"
    with open(artifact_path, "w") as f:
        json.dump(artifact, f, indent=2)

    return artifact


def _print_summary(artifact: dict) -> None:
    print(f"=== Phase 7 inner-CV — {artifact['run_id']} ===")
    print(f"training_as_of   : {artifact['training_as_of']}")
    print(f"training_seasons : {artifact['training_seasons']}")
    print(f"n_games          : {artifact['n_games']}")
    print(f"folds            : {artifact['n_folds']} ({len(artifact['scored_folds'])} scored)")
    print()
    print(f"{'halflife':>10} {'n_features':>12} {'mean Brier':>14} {'std Brier':>12}")
    for h_str, r in artifact["halflife_results"].items():
        print(f"{h_str:>10} {r['n_features']:>12} {r['mean_brier']:>14.6f} {r['std_brier']:>12.6f}")
    print()
    print(
        f"WINNER: halflife={artifact['winner']['halflife']} "
        f"(mean Brier={artifact['winner']['mean_brier']:.6f})"
    )


if __name__ == "__main__":
    training_as_of = sys.argv[1] if len(sys.argv) > 1 else "2024-01-01"
    artifact = run_phase7_inner_cv(training_as_of=training_as_of)
    _print_summary(artifact)
    print(f"\nArtifact written: {RESULTS_DIR}/{artifact['run_id']}.json")
