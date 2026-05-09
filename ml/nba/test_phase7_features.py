"""
Phase 7 Step 2 unit tests: hybrid feature pipeline (season-agg + EWMA-delta).

Synthetic-only; no DB. Tests cover:
  - Feature-name layout matches PHASE7_FEATURE_NAMES_ALL (89 features total)
  - `_phase7_team_features` produces expected season-agg and EWMA-delta values
  - Delta = EWMA - season_agg (not absolute EWMA)
  - Early-season NaN handling (no prior games → all NaN)
  - `_get_transform` routes Phase 7 names correctly
  - `_apply_norm` produces non-degenerate std on a synthetic mini-tensor

Plan: Plans/nba-learned-model.md addendum v18 §"Feature architecture".
"""

import math
import os
import sys

import numpy as np

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO_ROOT)

from ml.nba.features import (  # noqa: E402
    FeatureConfig,
    PHASE7_AGG_STATS,
    PHASE7_HALFLIVES,
    PHASE7_FEATURE_NAMES_ALL,
    _PHASE7_AGG_RATE_STATS,
    _fit_and_normalize,
    _get_transform,
    _phase7_team_features,
    _weighted_mean,
)


def _stub_history_entry(date: str, season: str, stat_overrides: dict[str, float]) -> dict:
    """Build a synthetic team-history entry with realistic NBA stat values."""
    base = {
        "date": date,
        "game_id": f"g_{date}",
        "season": season,
        "ortg": 112.0, "drtg": 110.0, "net_rating": 2.0,
        "efg_pct_off": 0.53, "efg_pct_def": 0.51,
        "tov_pct_off": 0.13, "tov_pct_def": 0.14,
        "oreb_pct": 0.27, "dreb_pct": 0.74,
        "three_p_rate_off": 0.40, "three_p_rate_def": 0.39,
        "ast_per_poss": 0.20, "stl_per_poss": 0.075, "blk_per_poss": 0.05,
        "pace": 99.0,
    }
    base.update(stat_overrides)
    return base


def test_phase7_feature_names_layout() -> None:
    expected_per_team = len(PHASE7_AGG_STATS) * (1 + len(PHASE7_HALFLIVES))
    expected_game_level = 9
    expected_total = 2 * expected_per_team + expected_game_level

    assert len(PHASE7_FEATURE_NAMES_ALL) == expected_total, (
        f"PHASE7_FEATURE_NAMES_ALL length={len(PHASE7_FEATURE_NAMES_ALL)} "
        f"(expected {expected_total} = 2×{expected_per_team} per-team + {expected_game_level} game-level)"
    )

    home_agg = [n for n in PHASE7_FEATURE_NAMES_ALL if n.startswith("home_") and n.endswith("_agg")]
    home_delta = [n for n in PHASE7_FEATURE_NAMES_ALL if n.startswith("home_") and "_delta_h" in n]
    assert len(home_agg) == len(PHASE7_AGG_STATS)
    assert len(home_delta) == len(PHASE7_AGG_STATS) * len(PHASE7_HALFLIVES)

    for stat in PHASE7_AGG_STATS:
        assert f"home_{stat}_agg" in PHASE7_FEATURE_NAMES_ALL
        for h in PHASE7_HALFLIVES:
            assert f"home_{stat}_delta_h{h}" in PHASE7_FEATURE_NAMES_ALL


def test_phase7_team_features_season_agg_value() -> None:
    """Season-agg is a simple mean of per-game stat values for current-season prior games."""
    team_id = "T1"
    histories = {
        team_id: {
            "home": [
                _stub_history_entry("2024-01-01", "2024-regular", {"net_rating": 2.0}),
                _stub_history_entry("2024-01-02", "2024-regular", {"net_rating": 4.0}),
                _stub_history_entry("2024-01-03", "2024-regular", {"net_rating": 0.0}),
            ],
            "away": [],
            "all": [],
        }
    }
    out = _phase7_team_features(team_id, histories, "2024-01-04", "2024-regular", "home")
    assert math.isclose(out["net_rating_agg"], 2.0, abs_tol=1e-9), out["net_rating_agg"]


def test_phase7_team_features_delta_is_ewma_minus_agg() -> None:
    team_id = "T1"
    games = [
        _stub_history_entry("2024-01-01", "2024-regular", {"net_rating": 0.0}),
        _stub_history_entry("2024-01-02", "2024-regular", {"net_rating": 0.0}),
        _stub_history_entry("2024-01-03", "2024-regular", {"net_rating": 10.0}),
    ]
    histories = {team_id: {"home": games, "away": [], "all": []}}
    out = _phase7_team_features(team_id, histories, "2024-01-04", "2024-regular", "home")

    agg = out["net_rating_agg"]
    expected_agg = (0.0 + 0.0 + 10.0) / 3
    assert math.isclose(agg, expected_agg, abs_tol=1e-9), agg

    for h in PHASE7_HALFLIVES:
        ewma = _weighted_mean(
            [g["net_rating"] for g in games],
            FeatureConfig(feature_form="ewma", ewma_halflife=h),
        )
        delta = out[f"net_rating_delta_h{h}"]
        assert math.isclose(delta, ewma - agg, abs_tol=1e-9), (h, delta, ewma, agg)
        # Recency-skewed input → shorter halflife should weight the latest 10.0 more,
        # so delta_h7 > delta_h21 (more recent-deviation signal).
        assert delta > 0, (h, delta)


def test_phase7_team_features_no_prior_yields_nan() -> None:
    histories = {"T1": {"home": [], "away": [], "all": []}}
    out = _phase7_team_features("T1", histories, "2024-01-01", "2024-regular", "home")
    for stat in PHASE7_AGG_STATS:
        assert math.isnan(out[f"{stat}_agg"]), stat
        for h in PHASE7_HALFLIVES:
            assert math.isnan(out[f"{stat}_delta_h{h}"]), (stat, h)


def test_phase7_team_features_filters_to_current_season() -> None:
    """Prior-season games must NOT contribute to the agg or delta."""
    team_id = "T1"
    games = [
        _stub_history_entry("2023-12-01", "2023-regular", {"net_rating": 100.0}),
        _stub_history_entry("2024-01-01", "2024-regular", {"net_rating": 5.0}),
        _stub_history_entry("2024-01-02", "2024-regular", {"net_rating": 5.0}),
    ]
    histories = {team_id: {"home": games, "away": [], "all": []}}
    out = _phase7_team_features(team_id, histories, "2024-01-03", "2024-regular", "home")
    assert math.isclose(out["net_rating_agg"], 5.0, abs_tol=1e-9), (
        f"Prior-season game leaked into season_agg: got {out['net_rating_agg']}, expected 5.0"
    )


def test_get_transform_phase7_routing() -> None:
    assert _get_transform("home_tov_pct_off_agg") == "logit_zscore"
    assert _get_transform("away_efg_pct_def_agg") == "logit_zscore"
    assert _get_transform("home_oreb_pct_agg") == "logit_zscore"
    assert _get_transform("home_net_rating_agg") == "zscore"
    assert _get_transform("home_pace_agg") == "zscore"
    for h in PHASE7_HALFLIVES:
        assert _get_transform(f"home_tov_pct_off_delta_h{h}") == "zscore"
        assert _get_transform(f"away_net_rating_delta_h{h}") == "zscore"
    assert _get_transform("home_advantage") == "passthrough"
    assert _get_transform("neutral_site") == "passthrough"
    assert _get_transform("is_denver_home") == "passthrough"
    assert _get_transform("b2b_home") == "passthrough"
    assert _get_transform("days_rest_home") == "log1p_zscore"
    assert _get_transform("games_played_away") == "log1p_zscore"


def test_phase7_eps_for_uses_1e6_on_rate_aggs() -> None:
    config = FeatureConfig(feature_form="rolling")
    for stat in _PHASE7_AGG_RATE_STATS:
        assert config.eps_for(f"home_{stat}_agg") == 1e-6, stat
    assert config.eps_for("home_net_rating_agg") == 0.0
    assert config.eps_for("home_pace_agg") == 0.0
    for h in PHASE7_HALFLIVES:
        assert config.eps_for(f"home_tov_pct_off_delta_h{h}") == 0.0


def test_phase7_normalize_nondegenerate_std_on_synthetic_tensor() -> None:
    rng = np.random.default_rng(7)
    n = 200
    feature_names = [
        "home_tov_pct_off_agg",      # rate, logit_zscore
        "home_net_rating_agg",       # zscore
        "home_pace_agg",             # zscore
        "home_tov_pct_off_delta_h7", # zscore (delta)
        "home_advantage",            # passthrough
        "days_rest_home",            # log1p_zscore
    ]
    X_raw = np.column_stack([
        rng.uniform(0.10, 0.18, size=n),         # tov_pct_agg
        rng.normal(0.0, 5.0, size=n),            # net_rating
        rng.normal(99.0, 3.0, size=n),           # pace
        rng.normal(0.0, 0.01, size=n),           # tov_delta
        np.full(n, 2.25),                         # home_advantage (constant)
        rng.integers(1, 5, size=n).astype(float),# days_rest
    ])

    config = FeatureConfig(feature_form="season_agg", training_as_of="2024-01-01")
    _, fitted = _fit_and_normalize(X_raw, feature_names, config)

    assert fitted.norm_params["home_tov_pct_off_agg"].transform == "logit_zscore"
    assert fitted.norm_params["home_tov_pct_off_agg"].std > 0.1
    assert fitted.norm_params["home_net_rating_agg"].transform == "zscore"
    assert fitted.norm_params["home_net_rating_agg"].std > 0.1
    assert fitted.norm_params["home_pace_agg"].transform == "zscore"
    assert fitted.norm_params["home_tov_pct_off_delta_h7"].transform == "zscore"
    assert fitted.norm_params["home_advantage"].transform == "passthrough"
    assert fitted.norm_params["days_rest_home"].transform == "log1p_zscore"


if __name__ == "__main__":
    test_phase7_feature_names_layout()
    test_phase7_team_features_season_agg_value()
    test_phase7_team_features_delta_is_ewma_minus_agg()
    test_phase7_team_features_no_prior_yields_nan()
    test_phase7_team_features_filters_to_current_season()
    test_get_transform_phase7_routing()
    test_phase7_eps_for_uses_1e6_on_rate_aggs()
    test_phase7_normalize_nondegenerate_std_on_synthetic_tensor()
    print("PASS: ml/nba/test_phase7_features.py (8 tests)")
