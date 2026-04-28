#!/usr/bin/env python3
"""
K_base calibration — Plans/nba-cold-start-prior.md §K_base calibration.

Grid-searches K_base ∈ {3, 5, 10, 15, 20, 30} on NBA seasons 2019–2023,
minimising mean Brier score on games 1–25 of each season. Validates on 2024–25.

Requires:
  - data/bbref-player-bpm/{year}.json   (from scrape-bbref-player-bpm.ts)
  - data/bbref-draft/{year}.json        (from scrape-bbref-player-bpm.ts)
  - data/sqlite/sportsdata.db with game_results for seasons 2019-2025
    (run: BALLDONTLIE_API_KEY=... npx tsx src/scrapers/run-historical.ts 2019 2024
     if seasons 2019-2022 are missing)

Also requires the rookie calibration values from calibrate_rookie_prior.py
to be committed first (see ROOKIE_BPM_PRIOR below — fill in after running
calibrate_rookie_prior.py).

Run: /usr/bin/python3 ml/nba/calibrate_k.py

Outputs: prints K_base and continuity/coaching factor results.
         Commit the K_base value to Plans/nba-cold-start-prior.md.
"""

import json
import math
import pathlib
import sqlite3
from collections import defaultdict

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BPM_DIR = REPO_ROOT / "data" / "bbref-player-bpm"
DRAFT_DIR = REPO_ROOT / "data" / "bbref-draft"
DB_PATH = REPO_ROOT / "data" / "sqlite" / "sportsdata.db"

# --- Fill these in after running calibrate_rookie_prior.py ---
# Median BPM and projected MPG by draft bin (calibration set values).
# Set to None until calibrate_rookie_prior.py has been run.
ROOKIE_BPM_PRIOR: dict[str, dict] = {
    "picks_1_5":    {"median_bpm": -2.25, "projected_mpg": 22.2},
    "picks_6_14":   {"median_bpm": -2.05, "projected_mpg": 17.5},
    "picks_15_30":  {"median_bpm": -2.40, "projected_mpg": 13.4},
    "second_round": {"median_bpm": -2.60, "projected_mpg": 10.9},
    "undrafted":    {"median_bpm": -0.50, "projected_mpg": 18.3},
}

K_GRID = [3, 5, 10, 15, 20, 30]
MIN_COLD_GAMES = 1    # minimum games played to include in cold-start evaluation
MAX_COLD_GAMES = 25   # the cold-start window

# Calibration seasons (prior-season BPM: year-1; game data: year)
CAL_SEASONS = ["2019-regular", "2020-regular", "2021-regular", "2022-regular", "2023-regular"]
VAL_SEASONS  = ["2024-regular", "2025-regular"]


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def brier(p: float, outcome: int) -> float:
    return (p - outcome) ** 2


def load_bpm(year: int) -> dict[str, dict]:
    path = BPM_DIR / f"{year}.json"
    if not path.exists():
        return {}
    with open(path) as f:
        rows = json.load(f)
    return {r["bbref_id"]: r for r in rows}


def load_draft_index() -> dict[str, int]:
    """Build bbref_id → pick_number index across all draft years."""
    picks: dict[str, int] = {}
    for year in range(2010, 2026):
        path = DRAFT_DIR / f"{year}.json"
        if not path.exists():
            continue
        with open(path) as f:
            for p in json.load(f):
                if p["bbref_id"] not in picks:
                    picks[p["bbref_id"]] = p["pick"]
    return picks


def rookie_bpm_for_pick(pick: int) -> tuple[float, float]:
    """Return (median_bpm, projected_mpg) for a given draft pick number."""
    priors = ROOKIE_BPM_PRIOR
    if pick <= 5:
        p = priors["picks_1_5"]
    elif pick <= 14:
        p = priors["picks_6_14"]
    elif pick <= 30:
        p = priors["picks_15_30"]
    else:
        p = priors["second_round"]
    bpm = p["median_bpm"] or 0.0
    mpg = p["projected_mpg"] or 15.0
    return bpm, mpg


def compute_team_priors(
    season_label: str,
    draft_index: dict[str, int],
) -> dict[str, float]:
    """
    Compute prior_strength for each team at the start of season_label.
    Uses prior-season BPM (season_label year - 1).

    Returns {team_id: prior_strength} where prior_strength is in BPM units.
    """
    # bbref year = the ending year of the season (e.g. "2023-regular" → year 2023)
    season_year = int(season_label.split("-")[0])
    prior_year = season_year - 1  # prior season's BPM

    prior_bpm = load_bpm(prior_year)
    current_bpm = load_bpm(season_year)  # to know who played in the current season (roster proxy)

    if not prior_bpm:
        print(f"  WARNING: no BPM data for prior year {prior_year}")
        return {}
    if not current_bpm:
        print(f"  WARNING: no BPM data for current year {season_year} (roster proxy)")
        return {}

    # For each team in the current season, find players on that team.
    # We use current-season team assignment as a proxy for opening-day roster.
    # (Full roster snapshot pipeline is a future addition; this approximation
    #  understates free-agent movement but is acceptable for K calibration.)
    team_players: dict[str, list[str]] = defaultdict(list)
    for bbref_id, row in current_bpm.items():
        team_players[row["team"]].append(bbref_id)

    priors: dict[str, float] = {}
    for team, player_ids in team_players.items():
        if team == "TOT":
            continue  # skip aggregate rows

        contributions: list[tuple[float, float]] = []  # (bpm, mp)
        for pid in player_ids:
            if pid in prior_bpm:
                row = prior_bpm[pid]
                contributions.append((row["bpm"], row["mp"]))
            elif pid in draft_index:
                # Rookie: use draft-position prior
                pick = draft_index[pid]
                rbpm, rmpg = rookie_bpm_for_pick(pick)
                contributions.append((rbpm, rmpg * 82))  # convert MPG to total MP proxy
            # else: no prior, no draft entry → skip (they get 0 weight)

        if not contributions:
            priors[team] = 0.0
            continue

        total_mp = sum(mp for _, mp in contributions)
        if total_mp == 0:
            priors[team] = 0.0
            continue

        prior = sum(bpm * (mp / total_mp) for bpm, mp in contributions)
        priors[team] = prior

    return priors


def bbref_team_to_our_id(bbref_abbr: str) -> str:
    """Map bbref team abbreviation to our internal nba: team ID."""
    mapping = {
        "ATL": "nba:ATL", "BOS": "nba:BOS", "BRK": "nba:BKN", "CHO": "nba:CHA",
        "CHI": "nba:CHI", "CLE": "nba:CLE", "DAL": "nba:DAL", "DEN": "nba:DEN",
        "DET": "nba:DET", "GSW": "nba:GS",  "HOU": "nba:HOU", "IND": "nba:IND",
        "LAC": "nba:LAC", "LAL": "nba:LAL", "MEM": "nba:MEM", "MIA": "nba:MIA",
        "MIL": "nba:MIL", "MIN": "nba:MIN", "NOP": "nba:NO",  "NYK": "nba:NY",
        "OKC": "nba:OKC", "ORL": "nba:ORL", "PHI": "nba:PHI", "PHO": "nba:PHX",
        "POR": "nba:POR", "SAS": "nba:SA",  "SAC": "nba:SAC", "TOR": "nba:TOR",
        "UTA": "nba:UTAH","WAS": "nba:WSH",
    }
    return mapping.get(bbref_abbr, f"nba:{bbref_abbr}")


def load_game_data(seasons: list[str], conn: sqlite3.Connection) -> list[dict]:
    """
    Load game results for given seasons, with game sequence number per team.
    Returns list of {season, game_id, home_team, away_team, home_score, away_score,
                      home_game_n, away_game_n, date}
    """
    placeholders = ",".join("?" * len(seasons))
    rows = conn.execute(
        f"""
        SELECT g.id, g.season, g.date, g.home_team_id, g.away_team_id,
               gr.home_score, gr.away_score, gr.home_win
        FROM games g
        JOIN game_results gr ON gr.game_id = g.id
        WHERE g.sport = 'nba' AND g.season IN ({placeholders})
        ORDER BY g.season, g.date
        """,
        seasons,
    ).fetchall()

    # Compute per-team game sequence number within the season.
    team_game_count: dict[str, int] = defaultdict(int)
    results = []
    current_season = None
    for game_id, season, date, home, away, h_score, a_score, home_win in rows:
        if season != current_season:
            team_game_count.clear()
            current_season = season
        team_game_count[home] += 1
        team_game_count[away] += 1
        results.append({
            "season": season,
            "game_id": game_id,
            "date": date,
            "home_team": home,
            "away_team": away,
            "home_score": h_score,
            "away_score": a_score,
            "home_win": home_win,
            "home_game_n": team_game_count[home],
            "away_game_n": team_game_count[away],
        })
    return results


# v5's sigmoid scale for NBA (from Plans/nba-learned-model.md, calibrated at 0.10)
V5_SCALE = 0.10
V5_HOME_ADV = 2.25  # points, from debt #27


def compute_effective_diff(
    prior: float,
    actual_diff: float,
    games_played: int,
    k_eff: float,
) -> float:
    return (k_eff * prior + games_played * actual_diff) / (k_eff + games_played)


def evaluate_k(
    k_base: float,
    cal_seasons: list[str],
    team_priors: dict[str, dict[str, float]],  # {season: {team: prior}}
    game_data: list[dict],
    window: tuple[int, int] = (MIN_COLD_GAMES, MAX_COLD_GAMES),
) -> float:
    """
    Compute mean Brier score on cold-start games (game_n in window) for a given K_base.
    Uses a simplified model: sigmoid(V5_SCALE * (effective_home_diff - effective_away_diff + HOME_ADV)).
    Actual team season diff is approximated from running game outcomes (simple season-to-date diff).
    """
    brier_scores: list[float] = []

    # Build running season diffs per team per season.
    team_diffs: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for g in game_data:
        if g["season"] not in {s for ss in [cal_seasons] for s in ss}:
            continue
        margin = g["home_score"] - g["away_score"]
        team_diffs[g["season"]][g["home_team"]].append(margin)
        team_diffs[g["season"]][g["away_team"]].append(-margin)

    # Evaluate on cold-start games.
    for g in game_data:
        season = g["season"]
        if season not in cal_seasons:
            continue

        # Use the minimum game number (both teams should be "cold")
        min_game_n = min(g["home_game_n"], g["away_game_n"])
        if min_game_n < window[0] or min_game_n > window[1]:
            continue

        home = g["home_team"]
        away = g["away_team"]
        season_priors = team_priors.get(season, {})

        home_prior = season_priors.get(home.replace("nba:", ""), 0.0)
        away_prior = season_priors.get(away.replace("nba:", ""), 0.0)

        # Season-to-date actual diffs (excluding current game — time-machine safe)
        home_margins = team_diffs[season][home]
        away_margins = team_diffs[season][away]
        games_before = min_game_n - 1

        home_actual = (sum(home_margins[:games_before]) / games_before) if games_before > 0 else 0.0
        away_actual = (sum(away_margins[:games_before]) / games_before) if games_before > 0 else 0.0

        home_eff = compute_effective_diff(home_prior, home_actual, games_before, k_base)
        away_eff = compute_effective_diff(away_prior, away_actual, games_before, k_base)

        prob_home = sigmoid(V5_SCALE * ((home_eff - away_eff) + V5_HOME_ADV))
        prob_home = max(0.05, min(0.95, prob_home))

        brier_scores.append(brier(prob_home, g["home_win"]))

    if not brier_scores:
        return float("nan")
    return sum(brier_scores) / len(brier_scores)


def check_prerequisites() -> bool:
    ok = True
    for year in range(2018, 2025):
        if not (BPM_DIR / f"{year}.json").exists():
            print(f"  MISSING: data/bbref-player-bpm/{year}.json")
            ok = False
    if not DB_PATH.exists():
        print(f"  MISSING: {DB_PATH}")
        ok = False
    if any(v["median_bpm"] is None for v in ROOKIE_BPM_PRIOR.values()):
        print("  MISSING: ROOKIE_BPM_PRIOR values not filled in.")
        print("  Run calibrate_rookie_prior.py first and fill in the dict at the top of this file.")
        ok = False
    return ok


def main() -> None:
    print("=" * 60)
    print("K_base calibration — cold-start prior")
    print(f"Calibration seasons: {', '.join(CAL_SEASONS)}")
    print(f"Validation seasons:  {', '.join(VAL_SEASONS)}")
    print(f"Cold-start window:   games {MIN_COLD_GAMES}–{MAX_COLD_GAMES}")
    print("=" * 60)

    if not check_prerequisites():
        print("\nHalting — resolve prerequisites first.")
        return

    conn = sqlite3.connect(str(DB_PATH))
    draft_index = load_draft_index()
    print(f"\nDraft index loaded: {len(draft_index)} players")

    # Compute team priors for all relevant seasons.
    all_seasons = CAL_SEASONS + VAL_SEASONS
    team_priors: dict[str, dict[str, float]] = {}
    for season in all_seasons:
        print(f"\nComputing priors for {season}...")
        priors = compute_team_priors(season, draft_index)
        team_priors[season] = priors
        if priors:
            vals = list(priors.values())
            print(f"  {len(priors)} teams: mean={sum(vals)/len(vals):.2f}, "
                  f"min={min(vals):.2f}, max={max(vals):.2f}")

    # Load game data.
    print(f"\nLoading game data...")
    game_data = load_game_data(all_seasons, conn)
    print(f"  {len(game_data)} games loaded")
    conn.close()

    # Grid search K on calibration seasons.
    print(f"\nGrid search K_base on calibration seasons (cold-start window: games {MIN_COLD_GAMES}-{MAX_COLD_GAMES}):")
    print(f"{'K_base':>8}  {'Cal Brier':>10}")
    print("-" * 22)

    best_k = None
    best_brier = float("inf")
    cal_results = {}
    for k in K_GRID:
        b = evaluate_k(k, CAL_SEASONS, team_priors, game_data)
        cal_results[k] = b
        marker = " ← best" if b < best_brier else ""
        print(f"{k:>8}  {b:>10.6f}{marker}")
        if b < best_brier:
            best_brier = b
            best_k = k

    # Validate on validation seasons.
    print(f"\nValidation (K_base={best_k}):")
    val_brier = evaluate_k(best_k, VAL_SEASONS, team_priors, game_data)
    cal_brier_at_best = cal_results[best_k]
    print(f"  Calibration Brier: {cal_brier_at_best:.6f}")
    print(f"  Validation Brier:  {val_brier:.6f}")
    delta = val_brier - cal_brier_at_best
    if abs(delta) > 0.005:
        print(f"  WARNING: val/cal delta {delta:+.4f} > 0.005 — possible overfit or distribution shift")

    # K=0 baseline (no prior).
    k0_brier = evaluate_k(0.001, CAL_SEASONS, team_priors, game_data)
    print(f"\nBaseline (K≈0, prior disabled): {k0_brier:.6f}")
    improvement = k0_brier - best_brier
    print(f"Prior improvement over no-prior: {improvement:+.6f} Brier points")
    if improvement <= 0:
        print("  WARNING: prior does not help on calibration set — re-council before proceeding.")

    print("\n" + "=" * 60)
    print("VALUE TO COMMIT TO Plans/nba-cold-start-prior.md")
    print("=" * 60)
    print(f"\n  K_base = {best_k}")
    print(f"  (Calibration Brier: {cal_brier_at_best:.6f}, Validation Brier: {val_brier:.6f})")
    print("\nCommit this value to the plan before writing implementation code.")


if __name__ == "__main__":
    main()
