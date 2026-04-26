"""
Phase 3 step 4 unit test: no test-fold rows in training tensor.

Asserts that build_training_tensor never includes a game from
'2025-regular' or '2025-postseason' seasons.

Plan: Plans/nba-learned-model.md addendum v12 §"Unit tests" #1.
"""

import os
import sys
import sqlite3
import datetime

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO_ROOT)

from ml.nba.features import FeatureConfig, build_training_tensor, TEST_FOLD_SEASONS

DB_PATH = os.path.join(REPO_ROOT, "data", "sqlite", "sportsdata.db")


def get_game_seasons(game_ids: list[str], db_path: str) -> dict[str, str]:
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT id, season FROM games WHERE id IN ({})".format(
            ",".join("?" * len(game_ids))
        ),
        game_ids,
    ).fetchall()
    conn.close()
    return {r[0]: r[1] for r in rows}


def test_no_test_fold() -> None:
    if not os.path.exists(DB_PATH):
        print(f"SKIP: DB not found at {DB_PATH}")
        return

    config = FeatureConfig(
        window_size=10,
        feature_form="rolling",
        training_as_of="2026-04-27T00:00:00Z",
    )
    _, _, game_ids = build_training_tensor(config, DB_PATH)

    seasons = get_game_seasons(game_ids, DB_PATH)
    violations = [
        gid for gid in game_ids if seasons.get(gid) in TEST_FOLD_SEASONS
    ]

    print(f"Training tensor: {len(game_ids)} games")
    print(f"Test-fold seasons: {sorted(TEST_FOLD_SEASONS)}")
    print(f"Violations (test-fold games in tensor): {len(violations)}")

    if violations:
        print("FAIL — test-fold games in training tensor:")
        for gid in violations[:10]:
            print(f"  {gid} season={seasons.get(gid)}")
        sys.exit(1)

    print("PASS — no test-fold games in training tensor")


if __name__ == "__main__":
    test_no_test_fold()
