#!/usr/bin/env python3
"""
Phase 3 step 6 — Platt calibration for the 20-seed LightGBM ensemble.

Loads the council-override run's 20-seed models
(ml/nba/results/20260427T104117-e39d20c0-override/models/),
fits Platt scaling on the val fold (last 528 games of 2640 training games),
and saves ml/nba/configs/calibration-params.json.

Regeneration note: if model pickles are missing, run:
  /usr/bin/python3 ml/nba/cv_runner.py --winner-override ewma-h21
with pinned config ml/nba/configs/20260427T104117-e39d20c0-override.json.
Models are deterministic (fixed seeds, subsample, colsample).

Fix-pack compliance (addendum v14, Gate 1):
  #1  Platt in logit space, LogisticRegression(C=1e9)
  #2  LightGBM: predict-and-average (weight-averaging inapplicable to trees)
  #3  Platt applied to 20-seed mean, not per-seed
  #5  Regeneration recipe above
  #6  Runtime assertions: val size, season breakdown, post-cal unconditional mean
  #7  Hard stop: calibrated Brier must be <= raw Brier
  #8  Epsilon-clip p_ensemble to [1e-7, 1-1e-7] before logit
  #9  ONNX deferred; native pickles + infer.py for twice-daily batch cadence
  #10 Data tensor SHA-256 logged to output JSON

MLP BatchNorm→LayerNorm forward-declared (fix-pack #4): if LightGBM fails
ship rules at step 8 and MLP is needed, train_mlp.py must be updated
BatchNorm→LayerNorm before any ONNX export. Not a step 6 blocker.

Invoke as: /usr/bin/python3 ml/nba/calibrate.py
"""

import hashlib
import json
import pathlib
import pickle
import sqlite3
import sys

import numpy as np
from sklearn.linear_model import LogisticRegression

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from ml.nba.features import FeatureConfig, build_training_tensor
from ml.nba.train_lightgbm import score_lgbm

DB_PATH = REPO_ROOT / "data" / "sqlite" / "sportsdata.db"
CONFIGS_DIR = REPO_ROOT / "ml" / "nba" / "configs"
OVERRIDE_RUN_ID = "20260427T104117-e39d20c0-override"
MODELS_DIR = REPO_ROOT / "ml" / "nba" / "results" / OVERRIDE_RUN_ID / "models"
OUTPUT_PATH = CONFIGS_DIR / "calibration-params.json"

PINNED_FEATURE_CONFIG = {
    "feature_form": "ewma",
    "window_size": 10,
    "ewma_halflife": 21,
    "training_as_of": "2026-04-27T00:00:00Z",
}
VAL_CUTOFF_IDX = 2112  # int(2640 * 0.8) — matches _build_ensemble in cv_runner.py
N_SEEDS = 20


def _load_models() -> list:
    models = []
    for seed in range(N_SEEDS):
        path = MODELS_DIR / f"lgbm-seed-{seed:02d}.pkl"
        if not path.exists():
            raise FileNotFoundError(
                f"Model pickle missing: {path}\n"
                "Regenerate by running:\n"
                "  /usr/bin/python3 ml/nba/cv_runner.py --winner-override ewma-h21"
            )
        with open(path, "rb") as f:
            models.append(pickle.load(f))
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
    print("Phase 3 step 6 — Platt calibration")
    print("=" * 60)

    # 1. Build training tensor — fits norm_params into config in-place
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

    # Data hash for deterministic replay attestation (fix-pack #10)
    data_hash = hashlib.sha256(X.tobytes()).hexdigest()
    print(f"  Data tensor SHA-256: {data_hash[:16]}...")

    # 2. Val split — same formula as _build_ensemble in cv_runner.py
    X_val = X[VAL_CUTOFF_IDX:]
    y_val = y[VAL_CUTOFF_IDX:]
    val_game_ids = game_ids[VAL_CUTOFF_IDX:]
    n_val = len(y_val)

    # Fix-pack #6: val size assertion — determines Platt vs isotonic
    assert n_val < 1500, (
        f"Val fold size {n_val} >= 1500 — plan requires isotonic regression (plan §Calibration L181). "
        "Update this script."
    )
    print(f"\nVal fold: n={n_val} (cutoff={VAL_CUTOFF_IDX}) → Platt scaling confirmed (plan L181)")

    breakdown = _val_season_breakdown(val_game_ids, str(DB_PATH))
    print(f"  Season breakdown: {breakdown}")

    # 3. Load 20-seed models
    print(f"\nLoading {N_SEEDS}-seed LightGBM ensemble from {OVERRIDE_RUN_ID}/models/...")
    models = _load_models()
    print(f"  Loaded {len(models)} models")

    # 4. Predict-and-average (fix-pack #2/#3): average first, calibrate the mean
    seed_preds = np.stack([score_lgbm(m, X_val) for m in models], axis=0)  # (20, n_val)
    p_ensemble = seed_preds.mean(axis=0)                                    # (n_val,)
    brier_raw = float(np.mean((p_ensemble - y_val) ** 2))
    raw_mean = float(p_ensemble.mean())
    empirical_rate = float(y_val.mean())

    print(f"\nRaw ensemble val Brier:           {brier_raw:.6f}")
    print(f"  Unconditional predicted mean:   {raw_mean:.4f}")
    print(f"  Empirical val home-win rate:    {empirical_rate:.4f}")

    # 5. Platt scaling in logit space (fix-pack #1)
    p_clipped = np.clip(p_ensemble, 1e-7, 1 - 1e-7)  # fix-pack #8
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

    # Fix-pack #7: hard stop if calibration hurts Brier on the fold it was fit on
    if brier_cal > brier_raw:
        raise RuntimeError(
            f"Calibrated Brier ({brier_cal:.6f}) > raw Brier ({brier_raw:.6f}). "
            "Platt fit is pathological — halt and re-council before step 7. "
            "(fix-pack #7, addendum v14)"
        )

    # Fix-pack #6: flag if post-cal unconditional mean diverges > 2pp from empirical rate
    mean_divergence = abs(cal_mean - empirical_rate)
    if mean_divergence > 0.02:
        print(
            f"\n  WARNING: post-cal mean diverges from empirical rate by "
            f"{mean_divergence:.4f} > 0.02 — flag for council review before step 7"
        )

    # 6. Serialize norm_params for infer.py (NormParams is frozen dataclass)
    norm_params_serializable = {
        feat: {
            "transform": p.transform,
            "mean": p.mean,
            "std": p.std,
            "eps": p.eps,
        }
        for feat, p in config.norm_params.items()
    }

    output = {
        "method": "platt",
        "plan_ref": "Plans/nba-learned-model.md addendum v14",
        "onnx_status": (
            "deferred — native LightGBM pickles + infer.py for twice-daily batch cadence"
            " (fix-pack #9, addendum v14)"
        ),
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
            "override_run_id": OVERRIDE_RUN_ID,
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

    CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nCalibration params saved → {OUTPUT_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
