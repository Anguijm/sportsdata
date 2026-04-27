#!/usr/bin/env python3
"""
Phase 3 step 8b — Train 20-seed MLP ensemble (winner hyperparams) for test-fold evaluation.

Trains on training data (indices 0:VAL_CUTOFF_IDX = 0:2112) using the
inner-CV winner hyperparams (lr=0.001, dropout=0.5, weight_decay=0.0).
Uses val fold (2112:2640) for early stopping only — not for selection.

Saves 20 PyTorch model files to:
  ml/nba/results/mlp-winner/models/mlp-seed-NN.pt

Council mitigations (plan review, addendum v16):
  - VAL_CUTOFF hard-coded as constant (not recomputed from 0.8×N)
  - MLP run-id logged for audit traceability
  - BatchNorm in eval() mode for predict-and-average — correct for this purpose
    (LayerNorm fix deferred to serving/ONNX export per addendum v13 §fix-pack)

Invoke as: /usr/bin/python3 ml/nba/train_mlp_winner.py
"""

import datetime
import json
import pathlib
import sys

import numpy as np
import torch

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from ml.nba.features import FeatureConfig, build_training_tensor
from ml.nba.train_mlp import fit_mlp, score_mlp

DB_PATH = REPO_ROOT / "data" / "sqlite" / "sportsdata.db"
RESULTS_DIR = REPO_ROOT / "ml" / "nba" / "results" / "mlp-winner"
MODELS_DIR = RESULTS_DIR / "models"
RUN_META_PATH = RESULTS_DIR / "mlp-winner-run.json"

# Pinned from inner-CV winner (Plans/nba-learned-model.md addendum v13)
MLP_WINNER_HPARAMS = {"learning_rate": 0.001, "dropout": 0.5, "weight_decay": 0.0}
# Pinned from calibrate.py / cv_runner.py — int(2640 * 0.8)
VAL_CUTOFF_IDX = 2112
N_SEEDS = 20

PINNED_FEATURE_CONFIG = {
    "feature_form": "ewma",
    "window_size": 10,
    "ewma_halflife": 21,
    "training_as_of": "2026-04-27T00:00:00Z",
}


def main() -> None:
    print("=" * 60)
    print("Phase 3 step 8b — MLP winner training (20 seeds)")
    print("=" * 60)
    print(f"Hyperparams: {MLP_WINNER_HPARAMS}")

    MODELS_DIR.mkdir(parents=True, exist_ok=True)

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

    # Hard-coded cutoff — must match calibrate.py VAL_CUTOFF_IDX
    assert VAL_CUTOFF_IDX == int(n_total * 0.8), (
        f"VAL_CUTOFF_IDX={VAL_CUTOFF_IDX} does not match int({n_total}*0.8)={int(n_total*0.8)}. "
        "Data size may have changed — re-council before proceeding."
    )

    X_train, y_train = X[:VAL_CUTOFF_IDX], y[:VAL_CUTOFF_IDX]
    X_val, y_val = X[VAL_CUTOFF_IDX:], y[VAL_CUTOFF_IDX:]
    print(f"  Training: {len(y_train)} games | Val (early-stop): {len(y_val)} games")

    seed_briers = []
    for seed in range(N_SEEDS):
        params = dict(MLP_WINNER_HPARAMS, seed=seed)
        model = fit_mlp(X_train, y_train, X_val, y_val, params=params)
        with torch.no_grad():
            preds = score_mlp(model, X_val)
        seed_brier = float(np.mean((preds - y_val) ** 2))
        seed_briers.append(seed_brier)

        path = MODELS_DIR / f"mlp-seed-{seed:02d}.pt"
        torch.save(model, path)
        print(f"  seed {seed:2d}: val Brier={seed_brier:.6f}  saved {path.name}")

    seed_std = float(np.std(seed_briers))
    mean_brier = float(np.mean(seed_briers))
    print(f"\n  Ensemble: mean val Brier={mean_brier:.6f}, seed-std={seed_std:.6f}")

    run_meta = {
        "run_id": "mlp-winner",
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "plan_ref": "Plans/nba-learned-model.md addendum v16",
        "hparams": MLP_WINNER_HPARAMS,
        "val_cutoff_idx": VAL_CUTOFF_IDX,
        "n_train": len(y_train),
        "n_val": len(y_val),
        "n_seeds": N_SEEDS,
        "mean_val_brier": round(mean_brier, 6),
        "seed_std": round(seed_std, 6),
        "feature_config": PINNED_FEATURE_CONFIG,
    }
    with open(RUN_META_PATH, "w") as f:
        json.dump(run_meta, f, indent=2)
    print(f"\n  Run metadata saved → {RUN_META_PATH.relative_to(REPO_ROOT)}")
    print("\nMLP winner training complete. Next: run calibrate_mlp.py")


if __name__ == "__main__":
    main()
