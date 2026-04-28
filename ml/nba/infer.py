#!/usr/bin/env python3
"""
Phase 3 step 6 — serving-time inference for the calibrated NBA model.

Loads the 20-seed LightGBM ensemble + Platt params from
ml/nba/configs/calibration-params.json and returns P(home wins).

Pipeline (fix-pack #2/#3, addendum v14):
  1. Build live feature vector via build_live_tensor()
  2. Run 20 LightGBM forward passes
  3. Mean across seeds  (predict-and-average; weight-averaging inapplicable to trees)
  4. Apply Platt to the mean  (calibrate the mean, not per-seed)

Serving architecture (fix-pack #9): native LightGBM pickles + this Python script.
ONNX deferred — no latency benefit for twice-daily batch cadence.

Usage (CLI):
  /usr/bin/python3 ml/nba/infer.py <home_team_id> <away_team_id> <date> <season> [neutral_site]

  date: YYYY-MM-DD
  season: e.g. "2025-regular", "2025-postseason"
  neutral_site: 0 or 1 (default 0)

Usage (library):
  from ml.nba.infer import Predictor
  p = Predictor()
  prob = p.predict(home_team_id="1610612747", away_team_id="1610612744",
                   date="2025-10-22", season="2025-regular")
"""

import json
import pathlib
import pickle
import sys

import numpy as np

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from ml.nba.features import FeatureConfig, NormParams, build_live_tensor
from ml.nba.train_lightgbm import score_lgbm

DB_PATH = REPO_ROOT / "data" / "sqlite" / "sportsdata.db"
DEFAULT_CAL_PARAMS = REPO_ROOT / "ml" / "nba" / "configs" / "calibration-params.json"


class Predictor:
    """Stateful predictor: loads models + calibration once, reuses across calls."""

    def __init__(
        self,
        cal_params_path: pathlib.Path = DEFAULT_CAL_PARAMS,
        db_path: pathlib.Path = DB_PATH,
    ) -> None:
        with open(cal_params_path) as f:
            self._cal = json.load(f)
        self._config = _build_fitted_config(self._cal)
        self._models = _load_models(self._cal)
        self._db_path = str(db_path)

    def predict(
        self,
        home_team_id: str,
        away_team_id: str,
        date: str,
        season: str,
        neutral_site: int = 0,
    ) -> float:
        """Return calibrated P(home wins) in [0, 1]."""
        game_row = {
            "home_team_id": home_team_id,
            "away_team_id": away_team_id,
            "date": date,
            "season": season,
            "neutral_site": neutral_site,
        }
        x = build_live_tensor(self._config, game_row, self._db_path)
        X = x.reshape(1, -1)

        # Predict-and-average (fix-pack #2)
        seed_preds = np.array([score_lgbm(m, X)[0] for m in self._models])
        p_ensemble = float(seed_preds.mean())

        # Apply Platt to the ensemble mean (fix-pack #3)
        return _apply_platt(p_ensemble, self._cal["platt"])


def _build_fitted_config(cal: dict) -> FeatureConfig:
    """Reconstruct a fitted FeatureConfig from serialized calibration params."""
    fc = cal["feature_config"]
    config = FeatureConfig(
        feature_form=fc["feature_form"],
        window_size=fc["window_size"],
        ewma_halflife=fc["ewma_halflife"],
        training_as_of=fc["training_as_of"],
    )
    config.feature_names = cal["feature_names"]
    config.norm_params = {
        feat: NormParams(
            transform=p["transform"],
            mean=p["mean"],
            std=p["std"],
            eps=p["eps"],
        )
        for feat, p in cal["norm_params"].items()
    }
    return config


def _load_models(cal: dict) -> list:
    models_dir = pathlib.Path(cal["ensemble"]["models_dir"])
    models = []
    for seed in range(cal["ensemble"]["n_seeds"]):
        path = models_dir / f"lgbm-seed-{seed:02d}.pkl"
        if not path.exists():
            raise FileNotFoundError(
                f"Missing model pickle: {path}\n"
                "Regenerate: /usr/bin/python3 ml/nba/cv_runner.py --winner-override ewma-h21"
            )
        with open(path, "rb") as f:
            models.append(pickle.load(f))
    return models


def _apply_platt(p_ensemble: float, platt: dict) -> float:
    A = platt["A"]
    B = platt["B"]
    p_clipped = max(1e-7, min(1 - 1e-7, p_ensemble))
    logit_p = float(np.log(p_clipped / (1 - p_clipped)))
    return float(1.0 / (1.0 + np.exp(-(A * logit_p + B))))


if __name__ == "__main__":
    if len(sys.argv) < 5:
        print(
            "Usage: /usr/bin/python3 ml/nba/infer.py "
            "<home_team_id> <away_team_id> <date> <season> [neutral_site]"
        )
        sys.exit(1)

    home_team_id = sys.argv[1]
    away_team_id = sys.argv[2]
    date = sys.argv[3]
    season = sys.argv[4]
    neutral_site = int(sys.argv[5]) if len(sys.argv) > 5 else 0

    predictor = Predictor()
    prob = predictor.predict(home_team_id, away_team_id, date, season, neutral_site)
    print(f"P(home wins) = {prob:.4f}  ({prob * 100:.1f}%)")
