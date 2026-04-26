"""
Phase 3 step 4 unit test: as_of filter completeness — behavioral.

Asserts that a later training_as_of timestamp produces a game_ids list
that is a strict superset of an earlier training_as_of timestamp's game_ids
(in the same order for overlapping IDs).

Plan: Plans/nba-learned-model.md addendum v12 §"Unit tests" #3a.
"""

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO_ROOT)

from ml.nba.features import FeatureConfig, build_training_tensor

DB_PATH = os.path.join(REPO_ROOT, "data", "sqlite", "sportsdata.db")


def test_superset_property() -> None:
    if not os.path.exists(DB_PATH):
        print(f"SKIP: DB not found at {DB_PATH}")
        return

    # Use a somewhat narrow T so the superset relationship is non-trivial
    T_early = "2025-01-01T00:00:00Z"
    T_late  = "2026-04-27T00:00:00Z"

    config_early = FeatureConfig(
        window_size=10,
        feature_form="rolling",
        training_as_of=T_early,
    )
    _, _, ids_early = build_training_tensor(config_early, DB_PATH)

    config_late = FeatureConfig(
        window_size=10,
        feature_form="rolling",
        training_as_of=T_late,
    )
    _, _, ids_late = build_training_tensor(config_late, DB_PATH)

    print(f"T_early ({T_early}): {len(ids_early)} games")
    print(f"T_late  ({T_late}): {len(ids_late)} games")

    set_early = set(ids_early)
    set_late = set(ids_late)

    # ids_early must be a strict subset of ids_late
    missing_from_late = set_early - set_late
    if missing_from_late:
        print(f"FAIL — {len(missing_from_late)} games in early set missing from late set:")
        for gid in list(missing_from_late)[:10]:
            print(f"  {gid}")
        sys.exit(1)

    if not set_late > set_early:
        print("FAIL — late set is not a strict superset (same size — no new games added?)")
        sys.exit(1)

    # Ordering: the game_ids from ids_early should appear in the same relative order
    # in ids_late (since both are sorted by date)
    late_order = {gid: i for i, gid in enumerate(ids_late)}
    early_positions = [late_order[gid] for gid in ids_early]
    if early_positions != sorted(early_positions):
        print("FAIL — early games do not appear in the same relative order in late tensor")
        sys.exit(1)

    new_games = len(ids_late) - len(ids_early)
    print(f"New games added from T_early to T_late: {new_games}")
    print("PASS — late tensor is a strict ordered superset of early tensor")


if __name__ == "__main__":
    test_superset_property()
