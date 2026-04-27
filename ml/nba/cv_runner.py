#!/usr/bin/env python3
"""
Phase 3 step 5 — inner-CV training infrastructure.

Two-phase staged selection per addendum v13:
  Phase 1: feature-form selection across K=10 candidates using fixed default
            LightGBM hyperparams. Order-statistic selection-bias gate (K=10).
  Phase 2: hyperparameter tuning on winning feature form (18-config LightGBM
            grid + 18-config MLP grid). No additional multiplicity correction.

Forward-chaining 5-fold CV on all 2640 training games (~528 games/slice).
Scored folds: 2–5 (pooled held-out n ≈ 2112).

Outputs:
  ml/nba/configs/<run-id>.json  — full run config + threshold arithmetic
  ml/nba/results/<run-id>/     — cv-scores CSV, per-fold per-candidate table

Plan: Plans/nba-learned-model.md addendum v13.
"""

import os
import sys
import json
import uuid
import math
import sqlite3
import datetime
import itertools
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.nba.features import FeatureConfig, build_training_tensor, TEST_FOLD_SEASONS
from ml.nba.train_lightgbm import fit_lgbm, score_lgbm
from ml.nba.train_mlp import fit_mlp, score_mlp

DB_PATH = REPO_ROOT / "data" / "sqlite" / "sportsdata.db"
CONFIGS_DIR = REPO_ROOT / "ml" / "nba" / "configs"
RESULTS_DIR = REPO_ROOT / "ml" / "nba" / "results"

# ── Feature-form candidates ────────────────────────────────────────────────

FEATURE_FORM_CANDIDATES = [
    {"feature_form": "rolling",  "window_size":  5,  "ewma_halflife": None, "label": "rolling-5"},
    {"feature_form": "rolling",  "window_size": 10,  "ewma_halflife": None, "label": "rolling-10"},
    {"feature_form": "rolling",  "window_size": 15,  "ewma_halflife": None, "label": "rolling-15"},
    {"feature_form": "rolling",  "window_size": 20,  "ewma_halflife": None, "label": "rolling-20"},
    {"feature_form": "rolling",  "window_size": 30,  "ewma_halflife": None, "label": "rolling-30"},
    {"feature_form": "ewma",     "window_size": 10,  "ewma_halflife":  3,   "label": "ewma-h3"},
    {"feature_form": "ewma",     "window_size": 10,  "ewma_halflife":  7,   "label": "ewma-h7"},
    {"feature_form": "ewma",     "window_size": 10,  "ewma_halflife": 14,   "label": "ewma-h14"},
    {"feature_form": "ewma",     "window_size": 10,  "ewma_halflife": 21,   "label": "ewma-h21"},
    {"feature_form": "season_agg","window_size": 10, "ewma_halflife": None, "label": "season-agg"},
]

# Phase 1 default LightGBM hyperparams (fixed for form selection)
LGBM_DEFAULT_PARAMS = {
    "num_leaves": 63,
    "min_child_samples": 100,
    "reg_alpha": 0.1,
    "n_estimators": 2000,
    "early_stopping_rounds": 50,
}

# Phase 2 LightGBM hyperparam grid (18 configs)
LGBM_GRID = list(itertools.product(
    [31, 63, 127],    # num_leaves
    [50, 100, 200],   # min_child_samples
    [0, 1.0],         # reg_alpha (binary: no reg vs reg)
))

# Phase 2 MLP hyperparam grid (18 configs)
MLP_GRID = list(itertools.product(
    [0.01, 0.001, 0.0001],  # learning_rate
    [0.0, 0.3, 0.5],        # dropout
    [0.0, 0.01],            # weight_decay
))

N_FOLDS = 5
SCORED_FOLDS = list(range(1, N_FOLDS))  # folds 1..4 score slices 2..5 (0-indexed)
K_CANDIDATES = 10
N_SEEDS = 20


# ── Season-segment helpers ─────────────────────────────────────────────────

def _compute_team_game_positions(game_ids: list[str], db_path: str) -> dict[str, int]:
    """Map each game_id to its per-team game position within the season.

    Returns {game_id: min(home_pos, away_pos)} — the game-level position
    is the minimum of both teams' positions (ensures early-season coverage).
    """
    conn = sqlite3.connect(db_path)
    placeholders = ",".join("?" * len(game_ids))
    rows = conn.execute(
        f"""
        SELECT g.id, g.home_team_id, g.away_team_id, g.date,
               eg.season
        FROM games g
        JOIN nba_eligible_games eg ON eg.game_id = g.id
        WHERE g.id IN ({placeholders})
        ORDER BY eg.season, g.date, g.id
        """,
        game_ids,
    ).fetchall()
    conn.close()

    # Count game position per (team, season)
    team_season_pos: dict[tuple[str, str], int] = {}
    game_pos: dict[str, int] = {}
    for gid, home_tid, away_tid, _date, season in rows:
        h_key = (home_tid, season)
        a_key = (away_tid, season)
        team_season_pos[h_key] = team_season_pos.get(h_key, 0) + 1
        team_season_pos[a_key] = team_season_pos.get(a_key, 0) + 1
        pos = min(team_season_pos[h_key], team_season_pos[a_key])
        game_pos[gid] = pos
    return game_pos


def _segment_mask(game_ids: list[str], game_pos: dict[str, int], segment: str) -> np.ndarray:
    """Boolean mask for a season segment across game_ids."""
    positions = np.array([game_pos.get(gid, 41) for gid in game_ids])
    if segment == "early":
        return positions <= 25
    if segment == "middle":
        return (positions > 25) & (positions <= 55)
    if segment == "late":
        return positions > 55
    raise ValueError(f"Unknown segment: {segment}")


# ── Forward-chaining CV ────────────────────────────────────────────────────

def _make_folds(n: int, n_folds: int = N_FOLDS) -> list[tuple[np.ndarray, np.ndarray]]:
    """Return list of (train_idx, test_idx) for forward-chaining folds.

    Fold k (0-indexed) trains on indices 0..slice_start(k+1)-1 and scores
    on slice k+1. Fold 0 is training-only (no held-out slice scored).
    Returns scored folds only (folds 1..n_folds-1).
    """
    slice_size = n // n_folds
    slices = [np.arange(i * slice_size, (i + 1) * slice_size if i < n_folds - 1 else n)
              for i in range(n_folds)]
    folds = []
    for k in range(1, n_folds):  # scored folds: 1..n_folds-1
        train_idx = np.concatenate(slices[:k])
        test_idx = slices[k]
        folds.append((train_idx, test_idx))
    return folds


def _pooled_brier(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean((y_pred - y_true) ** 2))


def _per_game_brier(y_true: np.ndarray, y_pred: np.ndarray) -> np.ndarray:
    return (y_pred - y_true) ** 2


# ── Phase 1: feature-form selection ───────────────────────────────────────

def _phase1_form_selection(
    training_as_of: str,
    run_id: str,
) -> dict:
    """Evaluate all 10 feature-form candidates with default LightGBM params.

    Returns:
        {
          "candidate_scores": [...],  # per-candidate pooled Brier
          "winner": {...},            # winning candidate spec
          "winner_brier": float,
          "median_brier": float,
          "threshold": float,
          "sigma_inner": float,
          "n_pooled": int,
          "gate_passed": bool,
          "segment_ranks": {...},
          "segment_stable": bool,
        }
    """
    print("=" * 60)
    print("Phase 1: Feature-form selection (K=10 candidates)")
    print("=" * 60)

    candidate_scores = []  # (label, pooled_brier, per_game_brier_all)
    segment_briers: dict[str, list[tuple[str, float]]] = {
        "early": [], "middle": [], "late": []
    }

    for cand in FEATURE_FORM_CANDIDATES:
        label = cand["label"]
        print(f"\n  Candidate: {label}")
        config = FeatureConfig(
            feature_form=cand["feature_form"],
            window_size=cand["window_size"],
            ewma_halflife=cand["ewma_halflife"],
            training_as_of=training_as_of,
        )
        X, y, game_ids = build_training_tensor(config, str(DB_PATH))
        folds = _make_folds(len(y))
        all_pg_brier = []
        for train_idx, test_idx in folds:
            model = fit_lgbm(
                X[train_idx], y[train_idx],
                X[test_idx], y[test_idx],
                params=LGBM_DEFAULT_PARAMS,
            )
            preds = score_lgbm(model, X[test_idx])
            all_pg_brier.extend(_per_game_brier(y[test_idx], preds).tolist())
        pooled = float(np.mean(all_pg_brier))
        print(f"    pooled Brier = {pooled:.6f}  (n={len(all_pg_brier)})")
        candidate_scores.append({
            "label": label,
            "candidate": cand,
            "pooled_brier": pooled,
            "pg_brier": all_pg_brier,
        })

        # Segment Briers (using last-fold X/y since all folds share the same tensor order)
        # Recompute segment scores on pooled held-out predictions
        game_pos = _compute_team_game_positions(game_ids, str(DB_PATH))
        held_out_game_ids = []
        for _, test_idx in folds:
            held_out_game_ids.extend([game_ids[i] for i in test_idx])
        held_out_y = np.array([])
        held_out_preds = np.array([])
        for train_idx, test_idx in folds:
            model = fit_lgbm(
                X[train_idx], y[train_idx],
                X[test_idx], y[test_idx],
                params=LGBM_DEFAULT_PARAMS,
            )
            preds = score_lgbm(model, X[test_idx])
            held_out_y = np.concatenate([held_out_y, y[test_idx]])
            held_out_preds = np.concatenate([held_out_preds, preds])

        held_out_gids = []
        for _, test_idx in folds:
            held_out_gids.extend([game_ids[i] for i in test_idx])
        for seg in ("early", "middle", "late"):
            mask = _segment_mask(held_out_gids, game_pos, seg)
            if mask.sum() > 0:
                seg_brier = _pooled_brier(held_out_y[mask], held_out_preds[mask])
            else:
                seg_brier = float("nan")
            segment_briers[seg].append((label, seg_brier))

    # Sort by pooled Brier ascending (lower = better)
    candidate_scores.sort(key=lambda x: x["pooled_brier"])
    winner = candidate_scores[0]
    all_briers = [c["pooled_brier"] for c in candidate_scores]
    median_brier = float(np.median(all_briers))
    winner_brier = winner["pooled_brier"]

    # Selection-bias threshold (K=10, order-statistic correction)
    all_pg = np.array(winner["pg_brier"])
    n_pooled = len(all_pg)
    rng = np.random.default_rng(42)
    boot_means = [np.mean(rng.choice(all_pg, size=n_pooled, replace=True)) for _ in range(2000)]
    sigma_inner = float(np.std(boot_means) * math.sqrt(n_pooled))  # recover per-game std
    threshold = sigma_inner * math.sqrt(2 * math.log(K_CANDIDATES)) / math.sqrt(n_pooled)
    gap = median_brier - winner_brier
    gate_passed = gap >= threshold

    print(f"\n  Winner: {winner['label']} (Brier={winner_brier:.6f})")
    print(f"  Median: {median_brier:.6f}, gap={gap:.6f}, threshold={threshold:.6f}")
    print(f"  Selection-bias gate: {'PASS' if gate_passed else 'FAIL'}")

    # Season-segment stability: winner must be top-3 in each segment
    segment_ranks = {}
    segment_stable = True
    for seg in ("early", "middle", "late"):
        ranked = sorted(segment_briers[seg], key=lambda x: x[1])
        top3 = [r[0] for r in ranked[:3]]
        rank = next((i + 1 for i, (lbl, _) in enumerate(ranked) if lbl == winner["label"]), 10)
        segment_ranks[seg] = {"rank": rank, "top3": top3}
        if rank > 3:
            segment_stable = False
        print(f"  Segment {seg}: winner rank={rank}/10, top3={top3}")

    if not segment_stable:
        print("  WARNING: winner not top-3 in all segments — stability filter triggered")

    return {
        "candidate_scores": [
            {"label": c["label"], "pooled_brier": c["pooled_brier"]} for c in candidate_scores
        ],
        "winner": winner["candidate"],
        "winner_label": winner["label"],
        "winner_brier": winner_brier,
        "median_brier": median_brier,
        "gap": gap,
        "threshold": threshold,
        "sigma_inner": sigma_inner,
        "n_pooled": n_pooled,
        "gate_passed": gate_passed,
        "segment_ranks": segment_ranks,
        "segment_stable": segment_stable,
    }


# ── Phase 2: hyperparameter tuning ────────────────────────────────────────

def _phase2_hyperparam_tuning(
    winning_form: dict,
    training_as_of: str,
    architecture: str,
) -> dict:
    """Tune 18-config hyperparameter grid on the winning feature form.

    architecture: "lgbm" or "mlp"

    Returns best hyperparams + per-candidate val-fold Brier table.
    """
    print(f"\n{'='*60}")
    print(f"Phase 2: Hyperparam tuning ({architecture.upper()}, form={winning_form['label']})")
    print("=" * 60)

    config = FeatureConfig(
        feature_form=winning_form["feature_form"],
        window_size=winning_form["window_size"],
        ewma_halflife=winning_form["ewma_halflife"],
        training_as_of=training_as_of,
    )
    X, y, game_ids = build_training_tensor(config, str(DB_PATH))
    folds = _make_folds(len(y))

    grid = LGBM_GRID if architecture == "lgbm" else MLP_GRID
    results = []

    for config_idx, hparams in enumerate(grid):
        if architecture == "lgbm":
            num_leaves, min_child_samples, reg_alpha = hparams
            params = {
                "num_leaves": num_leaves,
                "min_child_samples": min_child_samples,
                "reg_alpha": reg_alpha,
                "n_estimators": 2000,
                "early_stopping_rounds": 50,
            }
            fit_fn, score_fn = fit_lgbm, score_lgbm
            hparam_dict = {
                "num_leaves": num_leaves,
                "min_child_samples": min_child_samples,
                "reg_alpha": reg_alpha,
            }
        else:
            lr, dropout, weight_decay = hparams
            params = {"learning_rate": lr, "dropout": dropout, "weight_decay": weight_decay}
            fit_fn, score_fn = fit_mlp, score_mlp
            hparam_dict = {"learning_rate": lr, "dropout": dropout, "weight_decay": weight_decay}

        fold_briers = []
        for train_idx, test_idx in folds:
            model = fit_fn(
                X[train_idx], y[train_idx],
                X[test_idx], y[test_idx],
                params=params,
            )
            preds = score_fn(model, X[test_idx])
            fold_briers.append(_pooled_brier(y[test_idx], preds))

        pooled = float(np.mean(fold_briers))
        print(f"  [{config_idx+1:2d}/18] {hparam_dict}  Brier={pooled:.6f}")
        results.append({"hparams": hparam_dict, "pooled_brier": pooled, "fold_briers": fold_briers})

    results.sort(key=lambda x: x["pooled_brier"])
    best = results[0]
    print(f"\n  Best: {best['hparams']}  Brier={best['pooled_brier']:.6f}")
    return {"best": best, "all_results": results}


# ── 20-seed ensemble ───────────────────────────────────────────────────────

def _build_ensemble(
    winning_form: dict,
    best_lgbm_params: dict,
    training_as_of: str,
    run_id: str,
) -> dict:
    """Train 20-seed LightGBM ensemble on full training pool."""
    print(f"\n{'='*60}")
    print(f"Building 20-seed LightGBM ensemble")
    print("=" * 60)

    config = FeatureConfig(
        feature_form=winning_form["feature_form"],
        window_size=winning_form["window_size"],
        ewma_halflife=winning_form["ewma_halflife"],
        training_as_of=training_as_of,
    )
    X, y, game_ids = build_training_tensor(config, str(DB_PATH))

    # Use last 20% as early stopping set for final ensemble
    cutoff = int(len(y) * 0.8)
    X_train, y_train = X[:cutoff], y[:cutoff]
    X_val, y_val = X[cutoff:], y[cutoff:]

    models_dir = RESULTS_DIR / run_id / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    import pickle
    seed_briers = []
    for seed in range(N_SEEDS):
        params = dict(best_lgbm_params, seed=seed, random_state=seed)
        model = fit_lgbm(X_train, y_train, X_val, y_val, params=params)
        preds = score_lgbm(model, X_val)
        seed_brier = _pooled_brier(y_val, preds)
        seed_briers.append(seed_brier)
        model_path = models_dir / f"lgbm-seed-{seed:02d}.pkl"
        with open(model_path, "wb") as f:
            pickle.dump(model, f)
        print(f"  seed {seed:2d}: val Brier={seed_brier:.6f}  saved {model_path.name}")

    seed_std = float(np.std(seed_briers))
    mean_brier = float(np.mean(seed_briers))
    print(f"\n  Ensemble: mean val Brier={mean_brier:.6f}, seed-std={seed_std:.6f}")
    print(f"  Seed instability gate (≤0.008): {'PASS' if seed_std <= 0.008 else 'FAIL'}")

    return {
        "n_seeds": N_SEEDS,
        "mean_val_brier": mean_brier,
        "seed_std": seed_std,
        "seed_instability_gate_passed": seed_std <= 0.008,
        "models_dir": str(models_dir),
        "val_cutoff_idx": cutoff,
        "val_n_games": len(y) - cutoff,
    }


# ── Main entry point ───────────────────────────────────────────────────────

def run_cv(training_as_of: str | None = None, winner_override: str | None = None) -> str:
    """Full step 5 CV run. Returns run_id."""
    if training_as_of is None:
        training_as_of = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    run_id = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%S") + "-" + str(uuid.uuid4())[:8]
    print(f"\nRun ID: {run_id}")
    print(f"Training as-of: {training_as_of}")
    print(f"DB: {DB_PATH}")

    CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / run_id).mkdir(parents=True, exist_ok=True)

    # Phase 1: feature-form selection
    p1 = _phase1_form_selection(training_as_of, run_id)

    # Determine effective winner per plan addendum v13 / Risk #7 pre-declared fallback.
    #
    # If winner passes both gates (bias gate + segment stability): ship winner.
    # If winner fails bias gate OR segment stability: fall back to season-aggregate
    #   (per plan addendum v13 §"Selection-bias mitigation": "season-aggregate baseline
    #    candidate ships to test-fold INSTEAD"). If council overrides this fallback
    #    (e.g., because winner is segment-stable and season-agg is materially worse),
    #    the override is documented in the run config and the addendum.
    if p1["gate_passed"] and p1["segment_stable"]:
        effective_winner = p1["winner"]
        effective_winner_label = p1["winner_label"]
        selection_note = "winner passed both gates"
    else:
        # Per plan Risk #7: fall back to season-aggregate
        season_agg_cand = next(c for c in FEATURE_FORM_CANDIDATES if c["feature_form"] == "season_agg")
        effective_winner = season_agg_cand
        effective_winner_label = "season-agg"
        selection_note = (
            f"plan Risk #7 fallback: season-agg "
            f"(gate_passed={p1['gate_passed']}, segment_stable={p1['segment_stable']}); "
            f"council override may apply — see run config"
        )
        print(f"\n  Bias gate FAILED (gap={p1['gap']:.6f} < threshold={p1['threshold']:.6f})")
        print(f"  Falling back to season-agg per plan Risk #7")
        print(f"  NOTE: council can override if segment stability warrants it")

    print(f"\nEffective winner (before council override check): {effective_winner_label}")
    print(f"  ({selection_note})")

    # Apply council override if specified
    if winner_override is not None:
        override_cand = next(
            (c for c in FEATURE_FORM_CANDIDATES if c["label"] == winner_override), None
        )
        if override_cand is None:
            raise ValueError(f"Unknown winner override: {winner_override}")
        effective_winner = override_cand
        effective_winner_label = winner_override
        selection_note = (
            f"council override: {winner_override} "
            f"(Gate 2 decision 2026-04-27; Plans/nba-learned-model.md addendum v13 §Gate 2)"
        )
        print(f"\n  Council override applied: {winner_override}")
        print(f"  Justification: ewma wins both CV runs; segment-stable; Risk #7 designed for null case")

    # Phase 2: LightGBM hyperparam tuning
    p2_lgbm = _phase2_hyperparam_tuning(
        {"label": effective_winner_label, **effective_winner},
        training_as_of,
        "lgbm",
    )

    # Phase 2: MLP hyperparam tuning
    p2_mlp = _phase2_hyperparam_tuning(
        {"label": effective_winner_label, **effective_winner},
        training_as_of,
        "mlp",
    )

    # 20-seed LightGBM ensemble
    best_lgbm_hparams = p2_lgbm["best"]["hparams"]
    full_lgbm_params = {
        "num_leaves": best_lgbm_hparams["num_leaves"],
        "min_child_samples": best_lgbm_hparams["min_child_samples"],
        "reg_alpha": best_lgbm_hparams["reg_alpha"],
        "n_estimators": 2000,
        "early_stopping_rounds": 50,
    }
    ensemble = _build_ensemble(
        {"label": effective_winner_label, **effective_winner},
        full_lgbm_params,
        training_as_of,
        run_id,
    )

    # Persist CV scores CSV
    import csv
    csv_path = RESULTS_DIR / run_id / "cv-scores.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["label", "pooled_brier"])
        writer.writeheader()
        writer.writerows(p1["candidate_scores"])
    print(f"\nCV scores saved: {csv_path}")

    # Persist run config
    run_config = {
        "run_id": run_id,
        "training_as_of": training_as_of,
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "plan_ref": "Plans/nba-learned-model.md addendum v13",
        "phase1": {
            "n_candidates": K_CANDIDATES,
            "n_pooled_planned": 8120,
            "n_pooled_realized": p1["n_pooled"],
            "threshold_planned": 0.00226,
            "threshold_realized": p1["threshold"],
            "sigma_inner": p1["sigma_inner"],
            "estimator_path": "bootstrap(B=2000)",
            "gate_passed": p1["gate_passed"],
            "segment_stable": p1["segment_stable"],
            "winner_label": p1["winner_label"],
            "winner_brier": p1["winner_brier"],
            "median_brier": p1["median_brier"],
            "gap": p1["gap"],
            "segment_ranks": p1["segment_ranks"],
            "candidate_scores": p1["candidate_scores"],
        },
        "effective_winner": {
            "label": effective_winner_label,
            "selection_note": selection_note,
            **effective_winner,
        },
        "phase2_lgbm": {
            "best_hparams": p2_lgbm["best"]["hparams"],
            "best_brier": p2_lgbm["best"]["pooled_brier"],
            "all_results": [
                {"hparams": r["hparams"], "pooled_brier": r["pooled_brier"]}
                for r in p2_lgbm["all_results"]
            ],
        },
        "phase2_mlp": {
            "best_hparams": p2_mlp["best"]["hparams"],
            "best_brier": p2_mlp["best"]["pooled_brier"],
            "all_results": [
                {"hparams": r["hparams"], "pooled_brier": r["pooled_brier"]}
                for r in p2_mlp["all_results"]
            ],
        },
        "ensemble": ensemble,
    }

    config_path = CONFIGS_DIR / f"{run_id}.json"
    with open(config_path, "w") as f:
        json.dump(run_config, f, indent=2)
    print(f"Run config saved: {config_path}")

    print(f"\n{'='*60}")
    print(f"Step 5 CV complete. Run ID: {run_id}")
    print(f"  Winner: {effective_winner_label}")
    print(f"  Best LightGBM hparams: {p2_lgbm['best']['hparams']}")
    print(f"  Best MLP hparams:      {p2_mlp['best']['hparams']}")
    print(f"  Ensemble val Brier:    {ensemble['mean_val_brier']:.6f}")
    print(f"  Seed-std gate:         {'PASS' if ensemble['seed_instability_gate_passed'] else 'FAIL'}")
    print("=" * 60)

    return run_id


if __name__ == "__main__":
    # Usage:
    #   cv_runner.py [training_as_of] [--winner-override <label>]
    #   cv_runner.py 2026-04-27T00:00:00Z --winner-override ewma-h21
    as_of = "2026-04-27T00:00:00Z"
    winner_override = None
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--winner-override" and i + 1 < len(args):
            winner_override = args[i + 1]
            i += 2
        else:
            as_of = args[i]
            i += 1
    run_cv(training_as_of=as_of, winner_override=winner_override)
