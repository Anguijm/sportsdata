#!/usr/bin/env python3
"""
LightGBM trainer for Phase 3 step 5.

Provides fit_lgbm() and score_lgbm() used by cv_runner.py.
Also provides a CLI entry point to build a 20-seed ensemble from a
saved run config.

Plan: Plans/nba-learned-model.md addendum v13.
"""

import os
import sys
import json
import pickle
from pathlib import Path

import numpy as np
import lightgbm as lgb

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))

LGBM_FIXED = {
    "objective": "binary",
    "metric": "binary_logloss",
    "verbose": -1,
    "n_jobs": -1,
    # Randomization for seed diversity in 20-seed ensemble
    "subsample": 0.8,
    "subsample_freq": 1,
    "colsample_bytree": 0.8,
}


def fit_lgbm(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    params: dict,
) -> lgb.LGBMClassifier:
    """Fit a LightGBM binary classifier with early stopping on val set."""
    n_estimators = params.get("n_estimators", 2000)
    early_stopping_rounds = params.get("early_stopping_rounds", 50)
    seed = params.get("seed", 0)
    random_state = params.get("random_state", seed)

    model_params = {
        **LGBM_FIXED,
        "num_leaves": params.get("num_leaves", 63),
        "min_child_samples": params.get("min_child_samples", 100),
        "reg_alpha": params.get("reg_alpha", 0.1),
        "n_estimators": n_estimators,
        "random_state": random_state,
    }

    model = lgb.LGBMClassifier(**model_params)
    callbacks = [lgb.early_stopping(early_stopping_rounds, verbose=False)]
    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        callbacks=callbacks,
    )
    return model


def score_lgbm(model: lgb.LGBMClassifier, X: np.ndarray) -> np.ndarray:
    """Return predicted probabilities (home win) for each row in X."""
    return model.predict_proba(X)[:, 1]


def ensemble_predict(models: list[lgb.LGBMClassifier], X: np.ndarray) -> np.ndarray:
    """Return mean probability across all seed models."""
    preds = np.stack([score_lgbm(m, X) for m in models], axis=0)
    return preds.mean(axis=0)


def load_ensemble(models_dir: str) -> list[lgb.LGBMClassifier]:
    """Load all seed model files from a models directory."""
    models_dir = Path(models_dir)
    model_files = sorted(models_dir.glob("lgbm-seed-*.pkl"))
    models = []
    for mf in model_files:
        with open(mf, "rb") as f:
            models.append(pickle.load(f))
    return models


if __name__ == "__main__":
    # CLI: python train_lightgbm.py <run-config-path>
    if len(sys.argv) < 2:
        print("Usage: train_lightgbm.py <run-config.json>")
        sys.exit(1)

    config_path = Path(sys.argv[1])
    with open(config_path) as f:
        run_config = json.load(f)

    print(f"Run config: {config_path}")
    print(f"Winner: {run_config['effective_winner']['label']}")
    print(f"Best LightGBM hparams: {run_config['phase2_lgbm']['best_hparams']}")
    print(f"Models dir: {run_config['ensemble']['models_dir']}")
    models = load_ensemble(run_config["ensemble"]["models_dir"])
    print(f"Loaded {len(models)} seed models")
