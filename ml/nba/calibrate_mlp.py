#!/usr/bin/env python3
"""
Phase 3 step 8b — Platt calibration for the 20-seed MLP ensemble.

Loads models from ml/nba/results/mlp-winner/models/,
fits Platt scaling on the val fold (last 528 games of 2640 training games),
and saves ml/nba/configs/mlp-calibration-params.json.

Follows the same calibration protocol as calibrate.py (addendum v14):
  - Platt in logit space, LogisticRegression(C=1e9)
  - Predict-and-average (each model forward-pass, then average outputs)
  - Platt applied to 20-seed mean, not per-seed
  - Hard stop if calibrated Brier > raw Brier

Invoke as: /usr/bin/python3 ml/nba/calibrate_mlp.py
"""

import hashlib
import json
import pathlib
import sqlite3
import sys

import numpy as np
from sklearn.linear_model import LogisticRegression
import torch

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from ml.nba.features import FeatureConfig, build_training_tensor
from ml.nba.train_mlp import score_mlp

DB_PATH = REPO_ROOT / "data" / "sqlite" / "sportsdata.db"
MODELS_DIR = REPO_ROOT / "ml" / "nba" / "results" / "mlp-winner" / "models"
OUTPUT_PATH = REPO_ROOT / "ml" / "nba" / "configs" / "mlp-calibration-params.json"
RUN_META_PATH = REPO_ROOT / "ml" / "nba" / "results" / "mlp-winner" / "mlp-winner-run.json"

VAL_CUTOFF_IDX = 2112
N_SEEDS = 20

PINNED_FEATURE_CONFIG = {
    "feature_form": "ewma",
    "window_size": 10,
    "ewma_halflife": 21,
    "training_as_of": "2026-04-27T00:00:00Z",
}


def _load_mlp_models() -> list:
    models = []
    for seed in range(N_SEEDS):
        path = MODELS_DIR / f"mlp-seed-{seed:02d}.pt"
        if not path.exists():
            raise FileNotFoundError(
                f"MLP model file missing: {path}\n"
                "Regenerate: /usr/bin/python3 ml/nba/train_mlp_winner.py"
            )
        model = torch.load(path, map_location="cpu", weights_only=False)
        model.eval()
        models.append(model)
    return models


def _val_season_breakdown(val_game_ids: list[str], db_path: str) -> dict[str, int]:
    placeholders = ",".join("?" * len(val_game_ids))
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        f"SELECT game_id, season FROM nba_game_box_stats"
        f" WHERE game_id IN ({placeholders}) GROUP BY game_id",
        val_game_ids,
    ).fetchall()
    conn.close()
    breakdown: dict[str, int] = {}
    for _, season in rows:
        breakdown[season] = breakdown.get(season, 0) + 1
    return breakdown


def main() -> None:
    print("=" * 60)
    print("Phase 3 step 8b — MLP Platt calibration")
    print("=" * 60)

    config = FeatureConfig(
        feature_form=PINNED_FEATURE_CONFIG["feature_form"],
        window_size=PINNED_FEATURE_CONFIG["window_size"],
        ewma_halflife=PINNED_FEATURE_CONFIG["ewma_halflife"],
        training_as_of=PINNED_FEATURE_CONFIG["training_as_of"],
    )
    print(f"\nBuilding training tensor (ewma-h21, as-of {PINNED_FEATURE_CONFIG['training_as_of']})...")
    X, y, game_ids = build_training_tensor(config, str(DB_PATH))
    n_total = len(y)
    print(f"  Total training games: {n_total}")

    data_hash = hashlib.sha256(X.tobytes()).hexdigest()
    print(f"  Data tensor SHA-256: {data_hash[:16]}...")

    X_val = X[VAL_CUTOFF_IDX:]
    y_val = y[VAL_CUTOFF_IDX:]
    val_game_ids = game_ids[VAL_CUTOFF_IDX:]
    n_val = len(y_val)

    assert n_val < 1500, (
        f"Val fold size {n_val} >= 1500 — plan requires isotonic regression. Update this script."
    )
    print(f"\nVal fold: n={n_val} (cutoff={VAL_CUTOFF_IDX}) → Platt scaling confirmed")

    breakdown = _val_season_breakdown(val_game_ids, str(DB_PATH))
    print(f"  Season breakdown: {breakdown}")

    print(f"\nLoading {N_SEEDS}-seed MLP ensemble from {MODELS_DIR}...")
    models = _load_mlp_models()
    print(f"  Loaded {len(models)} models")

    # Predict-and-average: each model in eval() mode with its own BatchNorm stats
    seed_preds = np.stack([score_mlp(m, X_val) for m in models], axis=0)  # (20, n_val)
    p_ensemble = seed_preds.mean(axis=0)
    brier_raw = float(np.mean((p_ensemble - y_val) ** 2))
    raw_mean = float(p_ensemble.mean())
    empirical_rate = float(y_val.mean())

    print(f"\nRaw MLP ensemble val Brier:       {brier_raw:.6f}")
    print(f"  Unconditional predicted mean:   {raw_mean:.4f}")
    print(f"  Empirical val home-win rate:    {empirical_rate:.4f}")

    # Platt in logit space (same as calibrate.py fix-pack #1)
    p_clipped = np.clip(p_ensemble, 1e-7, 1 - 1e-7)
    logit_p = np.log(p_clipped / (1 - p_clipped))

    platt = LogisticRegression(C=1e9, solver="lbfgs", max_iter=1000)
    platt.fit(logit_p.reshape(-1, 1), y_val)
    A = float(platt.coef_[0, 0])
    B = float(platt.intercept_[0])

    p_cal_logit = A * logit_p + B
    p_cal = 1.0 / (1.0 + np.exp(-p_cal_logit))
    brier_cal = float(np.mean((p_cal - y_val) ** 2))
    cal_mean = float(p_cal.mean())

    print(f"\nPlatt params: A={A:.6f}, B={B:.6f}")
    print(f"Calibrated val Brier:             {brier_cal:.6f}")
    print(f"  Delta vs raw:                   {brier_cal - brier_raw:+.6f}")
    print(f"  Post-cal unconditional mean:    {cal_mean:.4f}")

    if brier_cal > brier_raw:
        raise RuntimeError(
            f"Calibrated Brier ({brier_cal:.6f}) > raw Brier ({brier_raw:.6f}). "
            "Platt fit is pathological — halt and re-council."
        )

    mean_divergence = abs(cal_mean - empirical_rate)
    if mean_divergence > 0.02:
        print(
            f"\n  WARNING: post-cal mean diverges from empirical rate by "
            f"{mean_divergence:.4f} > 0.02 — flag for council review"
        )

    norm_params_serializable = {
        feat: {
            "transform": p.transform,
            "mean": p.mean,
            "std": p.std,
            "eps": p.eps,
        }
        for feat, p in config.norm_params.items()
    }

    # Load run-id from train_mlp_winner.py metadata
    run_id = "mlp-winner"
    if RUN_META_PATH.exists():
        with open(RUN_META_PATH) as f:
            run_meta = json.load(f)
        run_id = run_meta.get("run_id", "mlp-winner")

    output = {
        "method": "platt",
        "model_type": "mlp",
        "plan_ref": "Plans/nba-learned-model.md addendum v16",
        "feature_config": PINNED_FEATURE_CONFIG,
        "feature_names": config.feature_names,
        "norm_params": norm_params_serializable,
        "platt": {
            "A": A,
            "B": B,
            "formulation": "p_cal = sigmoid(A * logit(p_ensemble) + B)",
            "sklearn_C": 1e9,
        },
        "ensemble": {
            "n_seeds": N_SEEDS,
            "run_id": run_id,
            "models_dir": str(MODELS_DIR),
            "val_cutoff_idx": VAL_CUTOFF_IDX,
        },
        "val_diagnostics": {
            "n_val": n_val,
            "brier_raw": brier_raw,
            "brier_calibrated": brier_cal,
            "brier_delta": brier_cal - brier_raw,
            "unconditional_mean_raw": raw_mean,
            "unconditional_mean_calibrated": cal_mean,
            "empirical_home_win_rate": empirical_rate,
            "mean_divergence_post_cal": mean_divergence,
            "season_breakdown": breakdown,
        },
        "data_hash_sha256": data_hash,
    }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nMLP calibration params saved → {OUTPUT_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
