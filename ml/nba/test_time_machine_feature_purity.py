"""
Phase 3 step 4 unit test: time-machine feature purity.

For a deterministically selected game G (from the earliest eligible season),
computes the feature vector twice:
  1. Using the full DB (with all data up to training_as_of)
  2. Using a DB read filtered to date < G.date (simulating "only data available at game time")

The two vectors must be bit-identical, proving no future data leaks into G's features.

This is the primary guard against feature-formula divergence per addendum v12.

Plan: Plans/nba-learned-model.md addendum v12 §"Unit tests" #5.
"""

import os
import sys
import sqlite3
import copy

import numpy as np

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO_ROOT)

from ml.nba.features import (
    FeatureConfig,
    build_training_tensor,
    _load_box_stats,
    _impute_sentinel_tov,
    _pair_game_rows,
    _build_team_histories_with_wins,
    _enrich_opp_drtg,
    _game_feature_vector,
    _normalize_live,
    TEST_FOLD_SEASONS,
)

DB_PATH = os.path.join(REPO_ROOT, "data", "sqlite", "sportsdata.db")


def _load_box_stats_before_date(conn: sqlite3.Connection, cutoff_date: str) -> list[dict]:
    """Load box stats for games with date strictly before cutoff_date."""
    rows = conn.execute(
        """
        SELECT bs.game_id, bs.team_id, bs.season,
               g.date, g.home_team_id, g.away_team_id,
               bs.fga, bs.fgm, bs.fg3a, bs.fg3m,
               bs.fta, bs.ftm, bs.tov,
               bs.oreb, bs.dreb, bs.ast, bs.stl, bs.blk,
               bs.pts, bs.possessions, bs.updated_at
        FROM nba_game_box_stats bs
        JOIN games g ON g.id = bs.game_id
        WHERE g.date < ?
        ORDER BY g.date ASC
        """,
        (cutoff_date,),
    ).fetchall()
    cols = [
        "game_id", "team_id", "season", "date", "home_team_id", "away_team_id",
        "fga", "fgm", "fg3a", "fg3m", "fta", "ftm", "tov",
        "oreb", "dreb", "ast", "stl", "blk",
        "pts", "possessions", "updated_at",
    ]
    return [dict(zip(cols, r)) for r in rows]


def test_time_machine_purity() -> None:
    if not os.path.exists(DB_PATH):
        print(f"SKIP: DB not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)

    # Select a deterministic test game: the 50th game in the earliest season
    # (early enough to have meaningful prior history but not the very first game)
    target_row = conn.execute(
        """
        SELECT eg.game_id, eg.season, eg.home_team_id, eg.away_team_id,
               eg.date, eg.neutral_site
        FROM nba_eligible_games eg
        WHERE eg.season = '2023-regular'
        ORDER BY eg.date ASC, eg.game_id
        LIMIT 1 OFFSET 49
        """
    ).fetchone()

    if not target_row:
        print("SKIP: not enough games in 2023-regular season")
        conn.close()
        return

    game = {
        "game_id": target_row[0],
        "season": target_row[1],
        "home_team_id": target_row[2],
        "away_team_id": target_row[3],
        "date": target_row[4],
        "neutral_site": target_row[5],
    }
    game_results_all = {
        r[0]: r[1] for r in conn.execute(
            "SELECT game_id, home_win FROM game_results WHERE sport = 'nba'"
        ).fetchall()
    }
    conn.close()

    print(f"Target game: {game['game_id']} date={game['date']} "
          f"{game['home_team_id']} vs {game['away_team_id']}")

    config = FeatureConfig(
        window_size=10,
        feature_form="rolling",
        training_as_of="2026-04-27T00:00:00Z",
    )

    # Fit normalization params using full training tensor (needed for _normalize_live)
    _, _, _ = build_training_tensor(config, DB_PATH)
    if not config.is_fitted():
        print("FAIL: config not fitted after build_training_tensor")
        sys.exit(1)

    # --- Vector 1: full DB ---
    conn = sqlite3.connect(DB_PATH)
    box_rows_full = _load_box_stats(conn, config.training_as_of)
    conn.close()
    box_rows_full, _, _ = _impute_sentinel_tov(box_rows_full)
    paired_full = _pair_game_rows(box_rows_full)
    all_ids_full = {r["game_id"] for r in box_rows_full}
    hist_full = _build_team_histories_with_wins(
        box_rows_full, paired_full, all_ids_full, game_results_all
    )
    _enrich_opp_drtg(hist_full)
    vec_full_raw = _game_feature_vector(game, hist_full, config)
    vec_full_norm = _normalize_live(vec_full_raw, config.feature_names, config)

    # --- Vector 2: DB filtered to date < game.date ---
    conn = sqlite3.connect(DB_PATH)
    box_rows_pruned = _load_box_stats_before_date(conn, game["date"])
    conn.close()
    box_rows_pruned, _, _ = _impute_sentinel_tov(box_rows_pruned)
    paired_pruned = _pair_game_rows(box_rows_pruned)
    all_ids_pruned = {r["game_id"] for r in box_rows_pruned}
    hist_pruned = _build_team_histories_with_wins(
        box_rows_pruned, paired_pruned, all_ids_pruned, game_results_all
    )
    _enrich_opp_drtg(hist_pruned)
    vec_pruned_raw = _game_feature_vector(game, hist_pruned, config)
    vec_pruned_norm = _normalize_live(vec_pruned_raw, config.feature_names, config)

    # Compare
    nan_both = np.isnan(vec_full_norm) & np.isnan(vec_pruned_norm)
    val_same = vec_full_norm == vec_pruned_norm
    identical = np.all(nan_both | val_same)

    if not identical:
        diff_idx = np.where(~(nan_both | val_same))[0]
        print(f"FAIL — {len(diff_idx)} feature(s) differ:")
        for idx in diff_idx[:20]:
            fname = config.feature_names[idx] if idx < len(config.feature_names) else f"[{idx}]"
            print(f"  [{idx}] {fname}: full={vec_full_norm[idx]:.6f} pruned={vec_pruned_norm[idx]:.6f}")
        sys.exit(1)

    print(f"Feature vector length: {len(vec_full_norm)}")
    print(f"NaN features: {int(np.sum(np.isnan(vec_full_norm)))} (expected for games with no prior history)")
    print("PASS — feature vectors are bit-identical with full vs date-filtered DB")


if __name__ == "__main__":
    test_time_machine_purity()
