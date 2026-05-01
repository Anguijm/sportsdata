"""
BPM-based team prior strength for the NBA cold-start feature.
Plans/nba-cold-start-prior.md — §Prior computation pipeline.

prior_strength(team, season) = Σ player_BPM(prior_year) × (MP / total_MP)
where players are grouped by their proxy-season team assignment and their
prior-season BPM is used as the quality estimate.

Convention: "N-regular" = season starting in year N.
  prior_year  = season_year     (bbref N = the N-1/N season, which just ended)
  proxy_year  = season_year + 1 (bbref N+1 = the N/N+1 season for team grouping)
  If proxy unavailable, prior_year used for both.

Rookie priors from calibrate_rookie_prior.py (draft classes 2010–2021, ≥500 MP).

Known v1 limitation: traded players appear only as "2TM"/"3TM" multi-team
aggregate rows in bbref. These rows are excluded (no team assignment). This
omits ~13–14% of active players per season from team priors. Teams that made
major deadline trades in the prior season may have underestimated prior strength
because the acquired player carries no weight. Accepted as a v1 limitation;
full roster-snapshot pipeline deferred.

Run standalone to check: python3 ml/nba/bpm_prior.py
"""
from __future__ import annotations

import json
import pathlib
from collections import defaultdict

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BPM_DIR = REPO_ROOT / "data" / "bbref-player-bpm"
DRAFT_DIR = REPO_ROOT / "data" / "bbref-draft"

# bbref team abbreviation → our internal nba:XXX ID
BBREF_TO_TEAM_ID: dict[str, str] = {
    "ATL": "nba:ATL", "BOS": "nba:BOS", "BRK": "nba:BKN", "CHO": "nba:CHA",
    "CHI": "nba:CHI", "CLE": "nba:CLE", "DAL": "nba:DAL", "DEN": "nba:DEN",
    "DET": "nba:DET", "GSW": "nba:GS",  "HOU": "nba:HOU", "IND": "nba:IND",
    "LAC": "nba:LAC", "LAL": "nba:LAL", "MEM": "nba:MEM", "MIA": "nba:MIA",
    "MIL": "nba:MIL", "MIN": "nba:MIN", "NOP": "nba:NO",  "NYK": "nba:NY",
    "OKC": "nba:OKC", "ORL": "nba:ORL", "PHI": "nba:PHI", "PHO": "nba:PHX",
    "POR": "nba:POR", "SAS": "nba:SA",  "SAC": "nba:SAC", "TOR": "nba:TOR",
    "UTA": "nba:UTAH", "WAS": "nba:WSH",
    # Historical abbreviations (teams that relocated)
    "NJN": "nba:BKN",  # New Jersey Nets
    "SEA": "nba:OKC",  # Seattle SuperSonics
    "NOH": "nba:NO",   # New Orleans Hornets
    "NOK": "nba:NO",   # New Orleans/Oklahoma City
    "CHA": "nba:CHA",  # Charlotte Bobcats era
    "VAN": "nba:MEM",  # Vancouver Grizzlies
}

# Rookie BPM priors by draft bin — committed values from calibrate_rookie_prior.py
# (calibration set, draft classes 2010-2021, ≥500 MP)
_ROOKIE_BPM: dict[str, float] = {
    "picks_1_5":    -2.25,
    "picks_6_14":   -2.05,
    "picks_15_30":  -2.40,
    "second_round": -2.60,
    "undrafted":    -0.50,
}
_ROOKIE_MPG: dict[str, float] = {
    "picks_1_5":    22.2,
    "picks_6_14":   17.5,
    "picks_15_30":  13.4,
    "second_round": 10.9,
    "undrafted":    18.3,
}

K_BASE: float = 10.0


def _load_bpm(year: int) -> dict[str, dict]:
    path = BPM_DIR / f"{year}.json"
    if not path.exists():
        return {}
    with open(path) as f:
        rows = json.load(f)
    return {r["bbref_id"]: r for r in rows}


def _load_draft_index() -> dict[str, int]:
    picks: dict[str, int] = {}
    for year in range(2005, 2027):
        path = DRAFT_DIR / f"{year}.json"
        if not path.exists():
            continue
        with open(path) as f:
            for p in json.load(f):
                if p["bbref_id"] not in picks:
                    picks[p["bbref_id"]] = p["pick"]
    return picks


def _rookie_bin(pick: int) -> str:
    if pick <= 5:
        return "picks_1_5"
    if pick <= 14:
        return "picks_6_14"
    if pick <= 30:
        return "picks_15_30"
    return "second_round"


def _is_multi_team_row(abbr: str) -> bool:
    return len(abbr) == 3 and abbr[0].isdigit() and abbr.endswith("TM")


def compute_season_priors(
    season: str,
    draft_index: dict[str, int],
) -> dict[str, float]:
    """
    Returns {our_team_id: prior_strength} for one season.

    prior_strength is a weighted-BPM estimate in ~NRtg units (points/100 poss).
    """
    season_year = int(season.split("-")[0])
    prior_year = season_year        # bbref year N = N-1/N season (the prior season)
    proxy_year = season_year + 1   # bbref year N+1 = N/N+1 season (current roster proxy)

    prior_bpm = _load_bpm(prior_year)
    proxy_bpm = _load_bpm(proxy_year)

    if not prior_bpm:
        return {}

    grouping_bpm = proxy_bpm if proxy_bpm else prior_bpm

    team_contributions: dict[str, list[tuple[float, float]]] = defaultdict(list)

    for bbref_id, row in grouping_bpm.items():
        team_abbr = row["team"]
        if _is_multi_team_row(team_abbr):
            continue

        if bbref_id in prior_bpm:
            pbpm = prior_bpm[bbref_id]["bpm"]
            pmp = prior_bpm[bbref_id]["mp"]
            team_contributions[team_abbr].append((pbpm, pmp))
        elif bbref_id in draft_index:
            pick = draft_index[bbref_id]
            bname = _rookie_bin(pick)
            rbpm = _ROOKIE_BPM[bname]
            rmpg = _ROOKIE_MPG[bname]
            team_contributions[team_abbr].append((rbpm, rmpg * 82))
        # else: no prior data → zero weight (skip)

    result: dict[str, float] = {}
    for abbr, contribs in team_contributions.items():
        our_id = BBREF_TO_TEAM_ID.get(abbr)
        if not our_id:
            continue
        total_mp = sum(mp for _, mp in contribs)
        if total_mp == 0:
            continue
        result[our_id] = sum(bpm * (mp / total_mp) for bpm, mp in contribs)

    return result


def build_prior_index(
    seasons: list[str] | None = None,
) -> dict[tuple[str, str], float]:
    """
    Build full prior index for all available seasons.
    Returns {(team_id, season): prior_strength}.
    """
    if seasons is None:
        available_years = sorted(int(p.stem) for p in BPM_DIR.glob("*.json"))
        seasons = [f"{y}-regular" for y in available_years]

    draft_index = _load_draft_index()
    index: dict[tuple[str, str], float] = {}
    for season in seasons:
        priors = compute_season_priors(season, draft_index)
        for team_id, prior in priors.items():
            index[(team_id, season)] = prior
    return index


if __name__ == "__main__":
    idx = build_prior_index()
    seasons = sorted({s for _, s in idx.keys()})
    print(f"Built prior index: {len(idx)} entries across {len(seasons)} seasons")
    for season in seasons[-3:]:
        entries = {t: v for (t, s), v in idx.items() if s == season}
        if entries:
            best = max(entries, key=entries.get)
            worst = min(entries, key=entries.get)
            mean = sum(entries.values()) / len(entries)
            print(f"  {season}: {len(entries)} teams, mean={mean:.2f}, "
                  f"best={best}({entries[best]:.2f}), worst={worst}({entries[worst]:.2f})")
