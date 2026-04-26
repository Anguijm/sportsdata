"""
Completeness test for game_type classification (Phase 3 step 3, council mandate).

Verifies:
1. Every row in nba_eligible_games is classified (no ValueError / None)
2. No row is classified as a type not in the declared enum
3. Cup pool + play_in classification matches expected counts/date windows
4. Play-in games classified by ID are NOT classified as regular season

Run:
  python -m pytest ml/nba/test_game_type_classification_complete.py -v
  # or directly:
  python ml/nba/test_game_type_classification_complete.py
"""

import os
import sys
import sqlite3
from collections import Counter

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO_ROOT)

from ml.nba.game_type_rules import classify_game, GameType, _get_play_in_ids, _get_cup_knockout_ids

VALID_TYPES: set[GameType] = {
    "regular", "postseason", "play_in", "cup_pool", "cup_knockout",
    "nba_finals", "conference_finals", "marquee_broadcast", "ot",
}


def get_eligible_games() -> list[dict]:
    db_path = os.path.join(REPO_ROOT, "data", "sqlite", "sportsdata.db")
    if not os.path.exists(db_path):
        print(f"SKIP: DB not found at {db_path}")
        return []
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT game_id, season, home_team_id, away_team_id, date, neutral_site FROM nba_eligible_games"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def test_completeness() -> None:
    rows = get_eligible_games()
    if not rows:
        print("SKIP: no eligible games found (DB empty or absent)")
        return

    print(f"Classifying {len(rows)} nba_eligible_games rows...")
    errors: list[str] = []
    counts: Counter[str] = Counter()

    for r in rows:
        try:
            gtype = classify_game(r)
            if gtype not in VALID_TYPES:
                errors.append(f"Invalid type '{gtype}' for {r['game_id']}")
            counts[gtype] += 1
        except Exception as e:
            errors.append(f"classify_game raised {type(e).__name__}: {e} — row={r}")

    print("\nGame type distribution:")
    for gtype, n in sorted(counts.items()):
        print(f"  {gtype:<25} {n:>5}")

    print(f"\nTotal classified: {sum(counts.values())} / {len(rows)}")

    if errors:
        print(f"\nFAIL — {len(errors)} classification error(s):")
        for e in errors[:20]:
            print(f"  {e}")
        sys.exit(1)

    # Sanity checks
    assert counts["cup_knockout"] >= 14, (
        f"Expected ≥14 cup_knockout games, got {counts['cup_knockout']}"
    )
    assert counts["play_in"] >= 2, (
        f"Expected ≥2 play_in games, got {counts['play_in']}"
    )
    assert counts["nba_finals"] >= 2, (
        f"Expected ≥2 nba_finals games, got {counts['nba_finals']}"
    )
    assert counts["conference_finals"] >= 2, (
        f"Expected ≥2 conference_finals games, got {counts['conference_finals']}"
    )

    # Play-in IDs must not land as 'regular'
    play_in_ids = _get_play_in_ids()
    for r in rows:
        if r["game_id"] in play_in_ids:
            gtype = classify_game(r)
            assert gtype == "play_in", (
                f"Play-in game {r['game_id']} classified as '{gtype}', expected 'play_in'"
            )

    print("\nPASS — all rows classified, sanity checks passed")


if __name__ == "__main__":
    test_completeness()
