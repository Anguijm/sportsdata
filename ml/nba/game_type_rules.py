"""
game_type derivation rules for NBA eligible games (Phase 3 step 3).

Maps each row in nba_eligible_games to one of:
  regular | postseason | play_in | cup_pool | cup_knockout
  nba_finals | conference_finals | marquee_broadcast | ot

These rules derive game_type at training-tensor construction time (Phase 3
step 4) without storing a game_type column in the DB. The nba_eligible_games
view provides: game_id, season, home_team_id, away_team_id, date, neutral_site.

Plan: Plans/nba-learned-model.md addendum v11 §"Phase 3 step 3".
Convention: data/bbref-convention-manifest.json defines each stratum; the
derivation rules below implement the same logic programmatically.

Usage:
  from ml.nba.game_type_rules import classify_game
  game_type = classify_game(row)  # row is a dict with game_id, season, date, neutral_site, ...
"""

import json
import os
from datetime import date as Date
from typing import Literal

GameType = Literal[
    "regular",
    "postseason",
    "play_in",
    "cup_pool",
    "cup_knockout",
    "nba_finals",
    "conference_finals",
    "marquee_broadcast",
    "ot",
]

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def _load_cup_knockout_ids() -> frozenset[str]:
    path = os.path.join(_REPO_ROOT, "data", "cup-knockout-game-ids.json")
    with open(path) as f:
        return frozenset(json.load(f)["game_ids"])


def _load_play_in_ids() -> frozenset[str]:
    """
    Play-in game IDs from the convention manifest (validated against bbref).
    BDL API codes play-in games as season='YYYY-regular', not 'YYYY-postseason'.
    These IDs are the ground truth for play-in classification.
    """
    path = os.path.join(_REPO_ROOT, "data", "bbref-convention-manifest.json")
    with open(path) as f:
        manifest = json.load(f)
    ids = set()
    for entry in manifest["strata"].get("play_in", []):
        if entry.get("game_id"):
            ids.add(entry["game_id"])
    return frozenset(ids)


# Lazy-loaded singletons — populated on first call to classify_game().
_cup_knockout_ids: frozenset[str] | None = None
_play_in_ids: frozenset[str] | None = None


def _get_cup_knockout_ids() -> frozenset[str]:
    global _cup_knockout_ids
    if _cup_knockout_ids is None:
        _cup_knockout_ids = _load_cup_knockout_ids()
    return _cup_knockout_ids


def _get_play_in_ids() -> frozenset[str]:
    global _play_in_ids
    if _play_in_ids is None:
        _play_in_ids = _load_play_in_ids()
    return _play_in_ids


def classify_game(row: dict) -> GameType:
    """
    Classify a single nba_eligible_games row to a GameType string.

    Priority order (first match wins):
    1. play_in      — game_id in play-in manifest (BDL codes as 'regular')
    2. cup_knockout — game_id in cup-knockout-game-ids.json
    3. cup_pool     — season='YYYY-regular', date in Nov 4 – Dec 3 (Cup pool window)
    4. nba_finals   — season='YYYY-postseason', date month = June
    5. conference_finals — season='YYYY-postseason', date May 18–31
    6. postseason   — season='YYYY-postseason' (R1, R2, other rounds)
    7. regular      — season='YYYY-regular' (default)

    Note: 'marquee_broadcast' and 'ot' are NOT derived here because:
    - marquee_broadcast: no reliable DB signal; stratum exists for convention
      validation only; not used as a training-tensor feature.
    - ot: can be detected at tensor-construction from game box stats
      (minutes_played > 240) but is not needed as a feature label — OT
      games are kept in training without special treatment.

    Note: 'rescheduled_2022_23' is not in the eligible DB window; no rows
    to classify.
    """
    game_id: str = row["game_id"]
    season: str = row["season"]
    date_str: str = row["date"]
    d = Date.fromisoformat(date_str[:10])

    # 1. Play-in (coded as 'regular' in BDL; use ID lookup as ground truth)
    if game_id in _get_play_in_ids():
        return "play_in"

    # 2. Cup knockout (QF at home arenas + SF/Final at Las Vegas)
    if game_id in _get_cup_knockout_ids():
        return "cup_knockout"

    if "regular" in season:
        # 3. Cup pool-play: Nov 4 – Dec 3 in a regular season year
        # The NBA Cup pool-play runs Nov 4 – Dec 3 each year since 2023-24.
        season_year = int(season.split("-")[0])  # e.g., '2024-regular' → 2024
        cup_pool_start = Date(season_year, 11, 4)
        cup_pool_end = Date(season_year, 12, 3)
        if cup_pool_start <= d <= cup_pool_end:
            return "cup_pool"

        # 7. Default for regular season
        return "regular"

    if "postseason" in season:
        # 4. NBA Finals: June games
        if d.month == 6:
            return "nba_finals"

        # 5. Conference Finals: roughly May 18–31
        if d.month == 5 and d.day >= 18:
            return "conference_finals"

        # 6. All other postseason (R1, Conference Semis)
        return "postseason"

    raise ValueError(f"Unclassifiable game: game_id={game_id} season={season} date={date_str}")


def classify_all(rows: list[dict]) -> list[GameType]:
    return [classify_game(r) for r in rows]
