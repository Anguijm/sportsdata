"""
Phase 7 Step 1 unit test: TOV% std-after-normalization regression guard.

Asserts that tov_pct_off and tov_pct_def have non-degenerate std after
logit_zscore normalization in `_fit_and_normalize`. Guards against the
saturation regression where values stored on the [0, 100] scale (instead
of [0, 1]) saturate the logit transform, producing std ≈ 1e-8 and
effectively zeroing the feature.

Plan: Plans/nba-learned-model.md addendum v18 §"TOV% fix (mandatory pre-gate)"
      and §"Logit edge-case handling".

Synthetic input only; no DB dependency. Runs in milliseconds.
"""

import os
import sys

import numpy as np

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO_ROOT)

from ml.nba.features import FeatureConfig, _fit_and_normalize, _per_game_derived


def _synthetic_box_row(tov: int, opp_tov: int, *, fga: int = 88, fta: int = 22,
                       fgm: int = 42, fg3m: int = 12, opp_fga: int = 88,
                       opp_fta: int = 22, opp_fgm: int = 42, opp_fg3m: int = 12) -> dict:
    """Stub box-row dict with the keys `_per_game_derived` reads."""
    return {
        "fga": fga, "fgm": fgm, "fg3a": 30, "fg3m": fg3m,
        "fta": fta, "ftm": 18, "tov": tov,
        "oreb": 10, "dreb": 35, "ast": 25, "stl": 7, "blk": 5,
        "pts": fgm * 2 + fg3m + 18, "possessions": 100, "opp_possessions": 100,
        "opp_fga": opp_fga, "opp_fgm": opp_fgm, "opp_fg3a": 30, "opp_fg3m": opp_fg3m,
        "opp_fta": opp_fta, "opp_ftm": 18, "opp_tov": opp_tov,
        "opp_oreb": 10, "opp_dreb": 35,
        "opp_pts": opp_fgm * 2 + opp_fg3m + 18,
    }


def test_tov_pct_logit_std_nondegenerate() -> None:
    rng = np.random.default_rng(42)
    n = 200
    tov_off = rng.integers(8, 22, size=n)
    tov_def = rng.integers(8, 22, size=n)

    derived = [
        _per_game_derived(_synthetic_box_row(int(t_off), int(t_def)))
        for t_off, t_def in zip(tov_off, tov_def)
    ]
    X_raw = np.array([[r["tov_pct_off"], r["tov_pct_def"]] for r in derived])
    feature_names = ["tov_pct_off", "tov_pct_def"]

    assert X_raw.min() > 0.05 and X_raw.max() < 0.30, (
        f"synthetic tov_pct out of expected [0.05, 0.30] band: "
        f"min={X_raw.min():.4f} max={X_raw.max():.4f} "
        f"(if min > 1, the input is on the [0,100] scale — formula regression)"
    )

    config = FeatureConfig(feature_form="season_agg", training_as_of="2024-01-01")
    _, fitted = _fit_and_normalize(X_raw, feature_names, config)

    for name in feature_names:
        params = fitted.norm_params[name]
        assert params.transform == "logit_zscore", (
            f"{name}: transform={params.transform!r} (expected logit_zscore)"
        )
        assert params.std > 0.1, (
            f"{name}: std={params.std:.6e} after logit_zscore — saturation regression "
            f"(bug produced std ≈ 1e-8). Expected > 0.1 for realistic tov_pct distribution."
        )
        assert params.eps == 1e-6, (
            f"{name}: eps={params.eps:.6e} (expected 1e-6 for season_agg per addendum v18)"
        )


if __name__ == "__main__":
    test_tov_pct_logit_std_nondegenerate()
    print("PASS: ml/nba/test_tov_pct_logit_std.py")
