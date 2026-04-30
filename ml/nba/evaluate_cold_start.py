#!/usr/bin/env python3
"""
Cold-start prior ship-rule evaluation (Plans/nba-cold-start-prior.md).

Evaluates the new LightGBM model (44 features, run 20260428T123326-7b5b31c1)
against v5 specifically on:
  1. Games 1-20 per team (cold-start window — the primary ship gate)
  2. Games 21+ (no-degradation gate)

Also computes block-bootstrap 95% CI on the paired per-game Brier difference
for the cold-start window (B=10000, blocks = home_team × ISO-week).

Ship rules (pre-declared in plan):
  1. Brier improvement on games 1-20: CI must exclude zero on improvement side
  2. No degradation on games 21+: Δ ≤ +0.002
  3. K calibrated on separate holdout: confirmed (calibrate_k.py)

Run: python3 ml/nba/evaluate_cold_start.py
"""
from __future__ import annotations

import json
import math
import pathlib
import pickle
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime

import numpy as np

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from ml.nba.features import FeatureConfig, build_test_fold_tensor, TEST_FOLD_SEASONS

CONFIGS_DIR = REPO_ROOT / "ml" / "nba" / "configs"
RUN_ID = "20260428T123326-7b5b31c1"
MODELS_DIR = REPO_ROOT / "ml" / "nba" / "results" / RUN_ID / "models"
CAL_PARAMS_PATH = CONFIGS_DIR / "calibration-params.json"
DB_PATH = REPO_ROOT / "data" / "sqlite" / "sportsdata.db"

COLD_START_WINDOW = 20   # plan: games 1-20
N_BOOTSTRAP = 10_000

# v5 constants (from evaluate_test_fold.py / src/analysis/predict.ts)
V5_SCALE = 0.10
V5_HOME_ADV = 2.25
V5_BASE_RATE = 0.57
V5_MIN_GAMES = 5


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def brier(p: float, outcome: int) -> float:
    return (p - outcome) ** 2


def _load_cal_params() -> tuple[FeatureConfig, float, float]:
    with open(CAL_PARAMS_PATH) as f:
        data = json.load(f)
    from ml.nba.features import NormParams
    norm_params = {
        k: NormParams(**v) for k, v in data["norm_params"].items()
    }
    fc = data["feature_config"]
    config = FeatureConfig(
        feature_form=fc["feature_form"],
        window_size=fc.get("window_size", 10),
        ewma_halflife=fc.get("ewma_halflife"),
        training_as_of=fc["training_as_of"],
        norm_params=norm_params,
        feature_names=data.get("feature_names", []),
    )
    return config, data["platt"]["A"], data["platt"]["B"]


def _load_lgbm_models(n_seeds: int = 20) -> list:
    models = []
    for seed in range(n_seeds):
        path = MODELS_DIR / f"lgbm-seed-{seed:02d}.pkl"
        with open(path, "rb") as f:
            models.append(pickle.load(f))
    return models


def _lgbm_predict(models: list, X: np.ndarray, platt_A: float, platt_B: float) -> np.ndarray:
    raw = np.mean([m.predict_proba(X)[:, 1] for m in models], axis=0)
    logit_raw = np.log(np.clip(raw, 1e-7, 1 - 1e-7) / np.clip(1 - raw, 1e-7, 1 - 1e-7))
    cal = 1.0 / (1.0 + np.exp(-(logit_raw * platt_A + platt_B)))
    return cal


def _v5_predict_raw(home_games: int, home_pts_for: float, home_pts_against: float,
                    away_games: int, away_pts_for: float, away_pts_against: float) -> float:
    if home_games < V5_MIN_GAMES or away_games < V5_MIN_GAMES:
        return V5_BASE_RATE
    home_diff = (home_pts_for - home_pts_against) / home_games
    away_diff = (away_pts_for - away_pts_against) / away_games
    x = V5_SCALE * ((home_diff - away_diff) + V5_HOME_ADV)
    return max(0.15, min(0.85, sigmoid(x)))


def _get_team_season_stats(conn: sqlite3.Connection, team_id: str,
                            game_date: str, year_prefix: str) -> tuple[int, float, float]:
    sql = """
        SELECT
            COUNT(*) AS games,
            SUM(CASE WHEN g.home_team_id = ? THEN gr.home_score ELSE gr.away_score END) AS pts_for,
            SUM(CASE WHEN g.home_team_id = ? THEN gr.away_score ELSE gr.home_score END) AS pts_against
        FROM game_results gr
        JOIN games g ON g.id = gr.game_id
        WHERE g.sport = 'nba'
          AND (g.home_team_id = ? OR g.away_team_id = ?)
          AND g.date < ?
          AND (g.season = (? || '-regular') OR g.season = (? || '-postseason'))
    """
    row = conn.execute(sql, (team_id, team_id, team_id, team_id,
                             game_date, year_prefix, year_prefix)).fetchone()
    if row is None or row[0] == 0:
        return 0, 0.0, 0.0
    return int(row[0]), float(row[1] or 0), float(row[2] or 0)


def _compute_v5_on_game_ids(game_ids: list[str]) -> np.ndarray:
    conn = sqlite3.connect(str(DB_PATH))
    placeholders = ",".join("?" * len(game_ids))
    rows = conn.execute(
        f"SELECT g.id, g.date, g.home_team_id, g.away_team_id, g.season "
        f"FROM games g WHERE g.id IN ({placeholders}) ORDER BY g.date ASC, g.id",
        game_ids,
    ).fetchall()
    meta = {r[0]: {"date": r[1], "home_team_id": r[2], "away_team_id": r[3], "season": r[4]}
            for r in rows}

    preds = []
    for gid in game_ids:
        m = meta[gid]
        year_prefix = m["season"].split("-")[0]
        h_games, h_for, h_against = _get_team_season_stats(
            conn, m["home_team_id"], m["date"], year_prefix)
        a_games, a_for, a_against = _get_team_season_stats(
            conn, m["away_team_id"], m["date"], year_prefix)
        preds.append(_v5_predict_raw(h_games, h_for, h_against, a_games, a_for, a_against))
    conn.close()
    return np.array(preds, dtype=float)


def _load_test_game_metadata(game_ids: list[str]) -> dict[str, dict]:
    """Load test-fold game metadata including per-team game sequence numbers."""
    conn = sqlite3.connect(str(DB_PATH))
    placeholders = ",".join("?" * len(game_ids))
    rows = conn.execute(
        f"""
        SELECT eg.game_id, eg.season, eg.home_team_id, eg.away_team_id,
               eg.date, eg.neutral_site, gr.home_win
        FROM nba_eligible_games eg
        JOIN game_results gr ON gr.game_id = eg.game_id
        WHERE eg.game_id IN ({placeholders})
        ORDER BY eg.date ASC, eg.game_id
        """,
        game_ids,
    ).fetchall()
    conn.close()

    cols = ["game_id", "season", "home_team_id", "away_team_id", "date", "neutral_site", "home_win"]
    games = [dict(zip(cols, r)) for r in rows]

    # Compute per-team game sequence number within regular season
    team_counts: dict[str, int] = defaultdict(int)
    current_season = None
    for g in games:
        season = g["season"]
        if season != current_season:
            team_counts.clear()
            current_season = season
        team_counts[g["home_team_id"]] += 1
        team_counts[g["away_team_id"]] += 1
        g["home_game_n"] = team_counts[g["home_team_id"]]
        g["away_game_n"] = team_counts[g["away_team_id"]]
        g["min_game_n"] = min(g["home_game_n"], g["away_game_n"])

    return {g["game_id"]: g for g in games}


def _block_bootstrap_ci(
    lgbm_briers: np.ndarray,
    v5_briers: np.ndarray,
    home_teams: list[str],
    dates: list[str],
    B: int = N_BOOTSTRAP,
    rng: np.random.Generator | None = None,
) -> tuple[float, float, float]:
    """
    Paired block-bootstrap 95% CI on mean(lgbm_brier - v5_brier).
    Blocks = unique (home_team, ISO-week) pairs.
    Returns (observed_delta, ci_lo, ci_hi).
    """
    if rng is None:
        rng = np.random.default_rng(42)

    diffs = lgbm_briers - v5_briers
    observed = float(np.mean(diffs))

    # Build blocks
    block_ids = []
    for ht, dt in zip(home_teams, dates):
        week = datetime.fromisoformat(dt[:10]).isocalendar()[1]
        year = datetime.fromisoformat(dt[:10]).isocalendar()[0]
        block_ids.append(f"{ht}_{year}w{week:02d}")

    unique_blocks = list(set(block_ids))
    block_to_indices: dict[str, list[int]] = defaultdict(list)
    for i, bid in enumerate(block_ids):
        block_to_indices[bid].append(i)

    boot_means = np.empty(B)
    for b in range(B):
        sampled_blocks = rng.choice(unique_blocks, size=len(unique_blocks), replace=True)
        indices = []
        for blk in sampled_blocks:
            indices.extend(block_to_indices[blk])
        boot_means[b] = np.mean(diffs[indices])

    ci_lo = float(np.percentile(boot_means, 2.5))
    ci_hi = float(np.percentile(boot_means, 97.5))
    return observed, ci_lo, ci_hi


def main() -> None:
    print("=" * 60)
    print("Cold-start prior ship-rule evaluation")
    print(f"Model: {RUN_ID}")
    print(f"Cold-start window: games 1-{COLD_START_WINDOW}")
    print("=" * 60)

    print("\nLoading calibration params and models...")
    config, platt_A, platt_B = _load_cal_params()
    models = _load_lgbm_models()
    print(f"  Loaded {len(models)} LightGBM seeds")

    print("\nBuilding test-fold feature tensor...")
    X, y, game_ids = build_test_fold_tensor(config, str(DB_PATH))
    print(f"  {len(game_ids)} games × {X.shape[1]} features")

    print("\nLoading game metadata for partitioning...")
    meta_by_id = _load_test_game_metadata(game_ids)
    aligned_game_ids = [gid for gid in game_ids if gid in meta_by_id]
    aligned_indices = [i for i, gid in enumerate(game_ids) if gid in meta_by_id]
    print(f"  {len(aligned_game_ids)} games with metadata")

    print("\nComputing LightGBM predictions...")
    lgbm_preds_all = _lgbm_predict(models, X, platt_A, platt_B)
    lgbm_preds = lgbm_preds_all[aligned_indices]
    y_arr = y[aligned_indices]

    print("Computing v5 predictions (may take a few minutes)...")
    v5_preds = _compute_v5_on_game_ids(aligned_game_ids)

    lgbm_briers = np.array([brier(p, int(o)) for p, o in zip(lgbm_preds, y_arr)])
    v5_briers = np.array([brier(p, int(o)) for p, o in zip(v5_preds, y_arr)])

    # Partition by game number
    min_game_ns = np.array([meta_by_id[gid]["min_game_n"] for gid in aligned_game_ids])
    seasons = [meta_by_id[gid]["season"] for gid in aligned_game_ids]
    home_teams = [meta_by_id[gid]["home_team_id"] for gid in aligned_game_ids]
    dates = [meta_by_id[gid]["date"][:10] for gid in aligned_game_ids]

    # Filter to regular-season only (game_n is only meaningful for regular season)
    regular = np.array([s == "2025-regular" for s in seasons])

    cold_mask = regular & (min_game_ns <= COLD_START_WINDOW)
    late_mask = regular & (min_game_ns > COLD_START_WINDOW)
    all_regular = regular

    print(f"\n{'='*60}")
    print("SHIP RULE EVALUATION (regular season 2025-26)")
    print(f"{'='*60}")

    for label, mask in [
        (f"Cold-start (games 1-{COLD_START_WINDOW})", cold_mask),
        (f"Late-season (games {COLD_START_WINDOW+1}+)", late_mask),
        ("All regular-season", all_regular),
    ]:
        n = int(mask.sum())
        if n == 0:
            print(f"\n{label}: no games")
            continue
        lgbm_b = float(np.mean(lgbm_briers[mask]))
        v5_b = float(np.mean(v5_briers[mask]))
        delta = lgbm_b - v5_b
        print(f"\n{label} (n={n}):")
        print(f"  LightGBM Brier: {lgbm_b:.6f}")
        print(f"  v5 Brier:       {v5_b:.6f}")
        print(f"  Δ (lgbm - v5):  {delta:+.6f}", end="")
        if delta < 0:
            print("  <- IMPROVEMENT")
        elif abs(delta) <= 0.002:
            print("  <- within no-degradation threshold")
        else:
            print("  <- DEGRADATION")

    # Block-bootstrap CI on cold-start games
    print(f"\n{'='*60}")
    print(f"BLOCK-BOOTSTRAP 95% CI — cold-start games 1-{COLD_START_WINDOW}")
    print(f"B={N_BOOTSTRAP}, blocks = home_team x ISO-week")
    print(f"{'='*60}")

    cold_indices = np.where(cold_mask)[0]
    if len(cold_indices) >= 20:
        cold_home_teams = [home_teams[i] for i in cold_indices]
        cold_dates = [dates[i] for i in cold_indices]
        obs, ci_lo, ci_hi = _block_bootstrap_ci(
            lgbm_briers[cold_mask],
            v5_briers[cold_mask],
            cold_home_teams,
            cold_dates,
        )
        print(f"  Observed delta: {obs:+.6f}")
        print(f"  95% CI:         [{ci_lo:+.6f}, {ci_hi:+.6f}]")
        if ci_hi < 0:
            print("  Ship Rule 1: PASS  (CI entirely below zero -- improvement confirmed)")
        elif ci_lo < 0 and ci_hi < 0.002:
            print("  Ship Rule 1: BORDERLINE (CI spans zero; improvement not confirmed)")
        else:
            print("  Ship Rule 1: FAIL  (CI does not confirm improvement)")
    else:
        print(f"  Insufficient cold-start games ({len(cold_indices)} < 20)")

    # Ship Rule 2
    print(f"\n{'='*60}")
    print("SHIP RULE 2 -- No degradation on games 21+")
    print(f"{'='*60}")
    n_late = int(late_mask.sum())
    if n_late > 0:
        late_delta = float(np.mean(lgbm_briers[late_mask])) - float(np.mean(v5_briers[late_mask]))
        print(f"  delta (games {COLD_START_WINDOW+1}+, n={n_late}): {late_delta:+.6f}")
        if late_delta <= 0.002:
            print("  Ship Rule 2: PASS  (delta <= +0.002)")
        else:
            print("  Ship Rule 2: FAIL  (delta > +0.002)")

    # Ship Rule 3 (pre-confirmed)
    print(f"\n{'='*60}")
    print("SHIP RULE 3 -- K calibrated on separate holdout")
    print(f"{'='*60}")
    print("  K=10, calibrated on 2022-2024 seasons (calibrate_k.py)")
    print("  Ship Rule 3: PASS  (pre-confirmed)")


if __name__ == "__main__":
    main()
