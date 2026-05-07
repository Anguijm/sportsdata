"""
Feature-engineering pipeline for Phase 3 NBA learned model (step 4).

Reads from nba_eligible_games + nba_game_box_stats to produce a fully
normalized feature tensor for training, validation, or live inference.

Plan: Plans/nba-learned-model.md addendum v12 §"Phase 3 step 4".
Council: R1 5 WARN avg 6.6/10 → fix-pack → Resolver CLEAR conditional on impl.

Key design decisions (pinned in addendum v12):
- One row per game (game-centric layout; home/away stats in named columns)
- Test-fold excluded: season NOT IN ('2025-regular', '2025-postseason')
- nba_eligible_games as_of: option (b) frozen-pre-as_of attestation
- nba_game_box_stats as_of: WHERE updated_at <= training_as_of
- Cup-knockout: accept-as-is (falsification confirmed Δ=0.0816)
- tov=0 sentinel rows: impute from team_season_avg (dynamic detection)
- TOV% formula: Oliver 100 × TOV / (FGA + 0.44·FTA + TOV)
- Injury signal dropped (no historical per-game record)
- Circadian flag dropped (no city/timezone lookup table)
- Home/away separate rolling windows per team
- Streak renamed to win_rate_last_7

Usage:
    from ml.nba.features import FeatureConfig, build_training_tensor, build_live_tensor
"""

from __future__ import annotations

import json
import math
import os
import sqlite3
from dataclasses import dataclass, field, replace
from datetime import datetime, date as Date, timedelta
from typing import Any, Literal

import numpy as np

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FeatureForm = Literal["rolling", "ewma", "season_agg"]

TEST_FOLD_SEASONS: frozenset[str] = frozenset({"2025-regular", "2025-postseason"})
REST_DAYS_CAP = 14
DENVER_TEAM_ID = "nba:DEN"

# Feature-level normalization transform assignment
_RATE_FEATURES = {
    "efg_pct_off", "efg_pct_def",
    "tov_pct_off", "tov_pct_def",
    "oreb_pct", "dreb_pct",
    "three_p_rate_off", "three_p_rate_def",
}
_COUNT_FEATURES = {
    "rest_days", "rest_days_in_last_7",
}
_BINARY_FEATURES = {
    "b2b", "is_denver_home", "neutral_site",
}

# Phase 7 hybrid feature pipeline (Plans/nba-learned-model.md addendum v18).
# 10 per-team stats × 2 teams × (season-agg + 3 EWMA-deltas) plus 9 game-level
# features → 89 total features (vs Phase 3's 42). Inner-CV in Step 3 selects
# the winning halflife from PHASE7_HALFLIVES.
PHASE7_AGG_STATS = [
    "net_rating",
    "efg_pct_off", "efg_pct_def",
    "tov_pct_off", "tov_pct_def",
    "oreb_pct", "dreb_pct",
    "three_p_rate_off", "three_p_rate_def",
    "pace",
]
PHASE7_HALFLIVES = [7, 14, 21]
# Rate-form season-agg features get logit_zscore; net_rating_agg + pace_agg
# get plain zscore. All deltas get zscore (real-valued, can be negative).
_PHASE7_AGG_RATE_STATS = {
    "efg_pct_off", "efg_pct_def",
    "tov_pct_off", "tov_pct_def",
    "oreb_pct", "dreb_pct",
    "three_p_rate_off", "three_p_rate_def",
}


@dataclass(frozen=True)
class NormParams:
    transform: Literal["logit_zscore", "log1p_zscore", "zscore", "passthrough"]
    mean: float = 0.0
    std: float = 1.0
    eps: float = 0.0


@dataclass
class FeatureConfig:
    window_size: int = 10
    feature_form: FeatureForm = "rolling"
    ewma_halflife: int | None = None
    training_as_of: str = ""
    feature_names: list[str] = field(default_factory=list)
    norm_params: dict[str, NormParams] = field(default_factory=dict)
    # Cold-start BPM prior index: {(team_id, season): prior_strength}
    # Populated by build_training_tensor / build_test_fold_tensor from bpm_prior.py.
    bpm_prior_index: dict[tuple[str, str], float] = field(default_factory=dict)

    def is_fitted(self) -> bool:
        return bool(self.norm_params)

    def eps_for(self, feature_name: str) -> float:
        """Return ε for logit clipping, 0.0 for non-rate features."""
        base = feature_name.removeprefix("home_").removeprefix("away_")

        # Phase 7 hybrid feature names (Plans/nba-learned-model.md addendum v18).
        # `_agg` rates use uniform ε=1e-6 per §"Logit edge-case handling"; deltas
        # are real-valued and use zscore (no logit clip needed).
        if base.endswith("_agg"):
            stat = base[: -len("_agg")]
            return 1e-6 if stat in _PHASE7_AGG_RATE_STATS else 0.0
        if "_delta_h" in base:
            return 0.0

        if base not in _RATE_FEATURES:
            return 0.0
        if self.feature_form == "rolling":
            return 1.0 / (2 * self.window_size)
        if self.feature_form == "ewma":
            h = self.ewma_halflife or 10
            alpha = 1 - 2 ** (-1.0 / h)
            n_eff = (2 - alpha) / alpha
            return 1.0 / (2 * n_eff)
        # season_agg (Phase 7): uniform ε=1e-6 per addendum v18 §"Logit edge-case handling".
        return 1e-6


def _weighted_mean(values: list[float], config: FeatureConfig) -> float | None:
    """Aggregate a list of per-game values (oldest → newest) per feature_form."""
    if not values:
        return None
    if config.feature_form == "rolling":
        window = values[-config.window_size:]
        return float(np.mean(window))
    if config.feature_form == "ewma":
        h = config.ewma_halflife or 10
        alpha = 1 - 2 ** (-1.0 / h)
        total_w = 0.0
        total_v = 0.0
        for k, v in enumerate(reversed(values)):
            w = alpha * (1 - alpha) ** k
            total_w += w
            total_v += w * v
        return total_v / total_w if total_w > 0 else None
    if config.feature_form == "season_agg":
        return float(np.mean(values))
    raise ValueError(f"Unknown feature_form: {config.feature_form}")


def _days_between(d1: str, d2: str) -> int:
    """Calendar days between two ISO date strings."""
    return (Date.fromisoformat(d2[:10]) - Date.fromisoformat(d1[:10])).days


_SQL_LOAD_BOX_STATS = """
        SELECT bs.game_id, bs.team_id, bs.season,
               g.date, g.home_team_id, g.away_team_id,
               bs.fga, bs.fgm, bs.fg3a, bs.fg3m,
               bs.fta, bs.ftm, bs.tov,
               bs.oreb, bs.dreb, bs.ast, bs.stl, bs.blk,
               bs.pts, bs.possessions, bs.updated_at
        FROM nba_game_box_stats bs
        JOIN games g ON g.id = bs.game_id
        WHERE bs.season NOT IN ({placeholders})
          AND bs.updated_at <= ?
        ORDER BY g.date ASC, bs.game_id, bs.team_id
        """


def _load_box_stats(conn: sqlite3.Connection, training_as_of: str) -> list[dict]:
    """Load nba_game_box_stats filtered by updated_at and test-fold season exclusion."""
    placeholders = ",".join("?" * len(TEST_FOLD_SEASONS))
    sql = _SQL_LOAD_BOX_STATS.format(placeholders=placeholders)
    rows = conn.execute(sql, (*TEST_FOLD_SEASONS, training_as_of)).fetchall()
    cols = [
        "game_id", "team_id", "season", "date", "home_team_id", "away_team_id",
        "fga", "fgm", "fg3a", "fg3m", "fta", "ftm", "tov",
        "oreb", "dreb", "ast", "stl", "blk",
        "pts", "possessions", "updated_at",
    ]
    return [dict(zip(cols, r)) for r in rows]


_SQL_LOAD_ELIGIBLE_GAMES = """
        SELECT eg.game_id, eg.season, eg.home_team_id, eg.away_team_id,
               eg.date, eg.neutral_site,
               gr.home_win
        FROM nba_eligible_games eg
        JOIN game_results gr ON gr.game_id = eg.game_id
        WHERE eg.season NOT IN ({placeholders})
          AND eg.date <= SUBSTR(?, 1, 10)
        ORDER BY eg.date ASC, eg.game_id
        """


def _load_eligible_games(conn: sqlite3.Connection, training_as_of: str) -> list[dict]:
    """Load nba_eligible_games filtered by test-fold exclusion and training_as_of date.

    as_of filter for nba_eligible_games: option (b) frozen-pre-as-of attestation per
    addendum v12. The `date <= training_as_of[:10]` filter ensures only games that
    had been played as of the training cutoff are included. nba_eligible_games has no
    updated_at; this date filter is the practical equivalent.
    """
    placeholders = ",".join("?" * len(TEST_FOLD_SEASONS))
    sql = _SQL_LOAD_ELIGIBLE_GAMES.format(placeholders=placeholders)
    rows = conn.execute(sql, (*TEST_FOLD_SEASONS, training_as_of)).fetchall()
    cols = ["game_id", "season", "home_team_id", "away_team_id", "date", "neutral_site", "home_win"]
    return [dict(zip(cols, r)) for r in rows]


def _impute_sentinel_tov(box_rows: list[dict]) -> tuple[list[dict], list[dict], int]:
    """
    Replace tov=0 rows (implausible sentinel pattern from ESPN) with team_season_avg(tov).
    Detection: tov=0 AND fga>0 (any team that took field goal attempts had >0 turnovers
    on virtually all NBA game records).
    Returns: (imputed_rows, imputation_log).
    """
    # Pre-pass: replace NULL tov with 0 (plan §"Pinned dispositions": impute-zero for NULL tov).
    # This ensures the == 0 comparison below doesn't TypeError on None.
    null_tov_count = 0
    box_rows = list(box_rows)
    for i, r in enumerate(box_rows):
        if r["tov"] is None:
            box_rows[i] = dict(r, tov=0)
            null_tov_count += 1

    # Build team-season avg tov from non-sentinel rows
    team_season_tov: dict[tuple[str, str], list[int]] = {}
    for r in box_rows:
        if r["tov"] > 0 or r["fga"] == 0:  # non-sentinel or no shots
            key = (r["team_id"], r["season"])
            team_season_tov.setdefault(key, []).append(r["tov"])

    imputation_log = []
    result = []
    for r in box_rows:
        if r["tov"] == 0 and r["fga"] > 0:
            key = (r["team_id"], r["season"])
            avg_tov = np.mean(team_season_tov.get(key, [0])) if team_season_tov.get(key) else 0
            imputed = dict(r, tov=round(avg_tov))
            imputation_log.append({
                "game_id": r["game_id"],
                "team_id": r["team_id"],
                "season": r["season"],
                "original_tov": 0,
                "imputed_tov": round(avg_tov),
            })
            result.append(imputed)
        else:
            result.append(r)
    return result, imputation_log, null_tov_count


def _pair_game_rows(box_rows: list[dict]) -> dict[str, dict[str, dict]]:
    """
    For each game, pair the two team-rows so each team-row has access to opponent stats.
    Returns: {game_id: {team_id: row_with_opponent_fields}}.
    """
    by_game: dict[str, list[dict]] = {}
    for r in box_rows:
        by_game.setdefault(r["game_id"], []).append(r)

    paired: dict[str, dict[str, dict]] = {}
    for game_id, rows in by_game.items():
        if len(rows) != 2:
            continue  # skip games with missing team data
        r0, r1 = rows[0], rows[1]
        for this, opp in [(r0, r1), (r1, r0)]:
            enriched = dict(this)
            enriched["opp_fga"] = opp["fga"]
            enriched["opp_fgm"] = opp["fgm"]
            enriched["opp_fg3a"] = opp["fg3a"]
            enriched["opp_fg3m"] = opp["fg3m"]
            enriched["opp_fta"] = opp["fta"]
            enriched["opp_tov"] = opp["tov"]
            enriched["opp_oreb"] = opp["oreb"]
            enriched["opp_dreb"] = opp["dreb"]
            enriched["opp_pts"] = opp["pts"]
            enriched["opp_possessions"] = opp["possessions"]
            paired.setdefault(game_id, {})[this["team_id"]] = enriched
    return paired


def _per_game_derived(r: dict) -> dict[str, float]:
    """Compute per-game derived stats for one team-row (with opponent fields present)."""
    poss = max(r["possessions"], 1.0)
    opp_poss = max(r["opp_possessions"], 1.0)
    fga = max(r["fga"], 1)
    opp_fga = max(r["opp_fga"], 1)
    tov = r["tov"]
    opp_tov = r["opp_tov"]
    fta = r["fta"]
    opp_fta = r["opp_fta"]

    # Per-possession rates
    ortg = 100.0 * r["pts"] / poss
    drtg = 100.0 * r["opp_pts"] / opp_poss

    # eFG% = (FGM + 0.5*FG3M) / FGA
    efg_off = (r["fgm"] + 0.5 * r["fg3m"]) / fga
    efg_def = (r["opp_fgm"] + 0.5 * r["opp_fg3m"]) / opp_fga

    # TOV% = TOV / (FGA + 0.44*FTA + TOV)  [Oliver formula, stored as a fraction 0.0–1.0]
    #
    # IMPORTANT: do NOT multiply by 100 here. tov_pct_off/def are in _RATE_FEATURES,
    # which routes them through logit_zscore normalization. That transform clips values
    # to [eps, 1-eps] before taking logit — eps is roughly 0.008 for ewma-h21.
    # A percentage value like 12.5 would clip to 1-eps every single game, producing
    # the same logit for every observation. Std collapses to ~0, z-score becomes 0
    # for all games, and the feature carries zero information. Storing as a fraction
    # (0.12 instead of 12) keeps values inside [eps, 1-eps] so logit works correctly.
    # efg_pct, oreb_pct, dreb_pct are all fractions for exactly this reason.
    # Phase 5 bug fix — Plans/nba-phase5-bug-fixes.md Change 1.
    tov_denom_off = fga + 0.44 * fta + tov
    tov_pct_off = tov / max(tov_denom_off, 1.0)
    tov_denom_def = opp_fga + 0.44 * opp_fta + opp_tov
    tov_pct_def = opp_tov / max(tov_denom_def, 1.0)

    # OREB% = OREB / (OREB + opp_DREB)
    oreb_pct = r["oreb"] / max(r["oreb"] + r["opp_dreb"], 1)
    dreb_pct = r["dreb"] / max(r["dreb"] + r["opp_oreb"], 1)

    # 3P rate = 3PA / FGA (NOT 3P%)
    three_p_rate_off = r["fg3a"] / fga
    three_p_rate_def = r["opp_fg3a"] / opp_fga

    # Per-possession playmaking
    ast_per_poss = r["ast"] / poss
    stl_per_poss = r["stl"] / poss
    blk_per_poss = r["blk"] / poss

    net_rating = ortg - drtg

    # Pace = possessions per game (regulation 48-min equivalent). Symmetric
    # within a game: each team has the same possession count up to ±1 for
    # who started/ended quarters. Average smooths the residual asymmetry.
    # Used as a season-aggregate feature in Phase 7 (addendum v18).
    pace = (poss + opp_poss) / 2.0

    return {
        "ortg": ortg,
        "drtg": drtg,
        "net_rating": net_rating,
        "efg_pct_off": efg_off,
        "efg_pct_def": efg_def,
        "tov_pct_off": tov_pct_off,
        "tov_pct_def": tov_pct_def,
        "oreb_pct": oreb_pct,
        "dreb_pct": dreb_pct,
        "three_p_rate_off": three_p_rate_off,
        "three_p_rate_def": three_p_rate_def,
        "ast_per_poss": ast_per_poss,
        "stl_per_poss": stl_per_poss,
        "blk_per_poss": blk_per_poss,
        "pace": pace,
    }


def _build_team_histories(
    box_rows: list[dict],
    paired: dict[str, dict[str, dict]],
    eligible_game_ids: set[str],
) -> dict[str, dict[str, list[dict]]]:
    """
    For each team, build two ordered lists of per-game derived stats:
      - "home": games where this team was the home team
      - "away": games where this team was the away team
    Returns: {team_id: {"home": [...], "away": [...], "all": [...]}}
    Each list entry: {date, game_id, derived_stats..., opp_team_id, opp_drtg}
    """
    by_game: dict[str, list[dict]] = {}
    for r in box_rows:
        by_game.setdefault(r["game_id"], []).append(r)

    histories: dict[str, dict[str, list[dict]]] = {}

    for game_id, rows in by_game.items():
        if game_id not in eligible_game_ids:
            continue
        if len(rows) != 2:
            continue
        for r in rows:
            team_id = r["team_id"]
            is_home = r["team_id"] == r["home_team_id"]
            opp_team_id = r["away_team_id"] if is_home else r["home_team_id"]

            paired_row = paired.get(game_id, {}).get(team_id)
            if paired_row is None:
                continue
            derived = _per_game_derived(paired_row)

            entry = {
                "game_id": game_id,
                "date": r["date"],
                "season": r["season"],
                "opp_team_id": opp_team_id,
                "is_home": is_home,
                **derived,
            }

            h = histories.setdefault(team_id, {"home": [], "away": [], "all": []})
            venue = "home" if is_home else "away"
            h[venue].append(entry)
            h["all"].append(entry)

    # Sort each list by date ascending
    for team_id, h in histories.items():
        for key in ("home", "away", "all"):
            h[key].sort(key=lambda x: x["date"])

    return histories


def _games_before(
    history: list[dict],
    target_date: str,
    target_season: str,
    config: FeatureConfig,
) -> list[dict]:
    """Return relevant prior games for rolling computation."""
    prior = [g for g in history if g["date"] < target_date]
    if config.feature_form == "season_agg":
        return [g for g in prior if g["season"] == target_season]
    return prior


def _rolling_feature_vector(
    team_id: str,
    histories: dict[str, dict[str, list[dict]]],
    target_date: str,
    target_season: str,
    venue: str,
    config: FeatureConfig,
) -> dict[str, float]:
    """
    Compute rolling features for a team as of target_date using venue-specific history.
    Returns dict of feature_name -> value (NaN if insufficient data).
    """
    h = histories.get(team_id, {}).get(venue, [])
    prior = _games_before(h, target_date, target_season, config)

    STAT_NAMES = [
        "ortg", "drtg", "net_rating",
        "efg_pct_off", "efg_pct_def",
        "tov_pct_off", "tov_pct_def",
        "oreb_pct", "dreb_pct",
        "three_p_rate_off", "three_p_rate_def",
        "ast_per_poss", "stl_per_poss", "blk_per_poss",
    ]

    result: dict[str, float] = {}
    for stat in STAT_NAMES:
        values = [g[stat] for g in prior]
        val = _weighted_mean(values, config)
        result[stat] = float("nan") if val is None else val

    # Opponent-adjusted Net Rating: opp_adj_nrtg = rolling_ORtg - opp_drtg_avg
    # Uses each prior opponent's single-game DRtg for that game (time-ordered)
    opp_drtg_values = [g.get("opp_drtg_for_adj", g["drtg"]) for g in prior]
    # Note: opp's DRtg at that game = the opponent's per-game DRtg as observed in that game
    # We use the opponent's actual DRtg from that game's stats (pass-2 enrichment)
    # For now, use opp's realized drtg in that game; see _enrich_opp_drtg for pass-2
    opp_adj_nrtg = (
        float("nan")
        if not prior
        else result["ortg"] - float(np.mean(opp_drtg_values))
    )
    opp_adj_def = (
        float("nan")
        if not prior
        else result["drtg"] - float(np.mean([g.get("opp_ortg_for_adj", g["ortg"]) for g in prior]))
    )
    result["opp_adj_nrtg"] = opp_adj_nrtg
    result["opp_adj_def"] = opp_adj_def

    # Cold-start BPM prior blend: effective_strength = (K*prior + g*actual) / (K+g)
    # K_BASE=10, prior in BPM units (~NRtg scale). Uses all-venue season games.
    # NaN when no prior exists for (team, season); model imputes as training mean.
    prior_val = config.bpm_prior_index.get((team_id, target_season), float("nan"))
    if math.isnan(prior_val):
        result["bpm_effective"] = float("nan")
    else:
        all_h = histories.get(team_id, {}).get("all", [])
        season_games = [
            g for g in all_h
            if g["season"] == target_season and g["date"] < target_date
        ]
        g_count = len(season_games)
        actual_diff = (
            sum(g["net_rating"] for g in season_games) / g_count
            if g_count > 0 else 0.0
        )
        _K = 10.0
        result["bpm_effective"] = (_K * prior_val + g_count * actual_diff) / (_K + g_count)

    # Season-to-date mean Net Rating (ORtg − DRtg, per 100 possessions).
    # This is the ML analogue of v5's (pts_for − pts_against) / games — giving the
    # model direct access to the season-aggregate quality signal that v5 is built on.
    # Filter: g["season"] == target_season ensures only current regular-season games
    # are included (e.g. "2025-regular"), not postseason (e.g. "2025-postseason").
    # NaN for games where the team has no completed season games yet (early-season);
    # the normalization pipeline imputes NaN → 0.0 (= training mean).
    # Phase 6 addition — Plans/nba-phase6-season-aggregate.md.
    all_season_games = [
        g for g in histories.get(team_id, {}).get("all", [])
        if g["season"] == target_season and g["date"] < target_date
    ]
    if all_season_games:
        result["season_net_rating"] = (
            sum(g["net_rating"] for g in all_season_games) / len(all_season_games)
        )
    else:
        result["season_net_rating"] = float("nan")

    return result


def _phase7_team_features(
    team_id: str,
    histories: dict[str, dict[str, list[dict]]],
    target_date: str,
    target_season: str,
    venue: str,
) -> dict[str, float]:
    """
    Phase 7 hybrid per-team features: season-agg + EWMA-delta per stat per halflife.

    Both season-agg and EWMA-delta operate on the team's current-season-only prior
    games (filtered by `target_season`) — "zero at season start, converges to recency
    deviation from baseline as games accumulate" (Plans/nba-learned-model.md
    addendum v18 §"Feature architecture").

    Returns NaN for both groups when the team has no prior games this season; the
    normalization pipeline imputes NaN → 0.0 (training mean).
    """
    h = histories.get(team_id, {}).get(venue, [])
    prior = [g for g in h if g["season"] == target_season and g["date"] < target_date]

    result: dict[str, float] = {}

    # Group 1 — season-aggregate (simple mean of per-game stat values).
    agg_config = FeatureConfig(feature_form="season_agg")
    for stat in PHASE7_AGG_STATS:
        values = [g[stat] for g in prior]
        agg = _weighted_mean(values, agg_config)
        result[f"{stat}_agg"] = float("nan") if agg is None else agg

    # Group 2 — EWMA-delta = EWMA_h - season_agg, for each halflife.
    for halflife in PHASE7_HALFLIVES:
        ewma_config = FeatureConfig(feature_form="ewma", ewma_halflife=halflife)
        for stat in PHASE7_AGG_STATS:
            values = [g[stat] for g in prior]
            ewma = _weighted_mean(values, ewma_config)
            agg_val = result[f"{stat}_agg"]
            if ewma is None or math.isnan(agg_val):
                result[f"{stat}_delta_h{halflife}"] = float("nan")
            else:
                result[f"{stat}_delta_h{halflife}"] = ewma - agg_val

    return result


def _enrich_opp_drtg(
    histories: dict[str, dict[str, list[dict]]],
) -> None:
    """
    Pass 2: For each game entry in each team's history, look up the opponent's
    single-game DRtg from the opponent's history (as of that game date).
    This enriches entries with `opp_drtg_for_adj` and `opp_ortg_for_adj`.

    Using single-game DRtg for each prior opponent (not rolling opponent DRtg) —
    a simplified but valid SoS correction. Documented in addendum v12.
    """
    # Build lookup: (game_id, team_id) -> (drtg, ortg)
    game_team_stats: dict[tuple[str, str], tuple[float, float]] = {}
    for team_id, h in histories.items():
        for entry in h["all"]:
            game_team_stats[(entry["game_id"], team_id)] = (
                entry["drtg"],
                entry["ortg"],
            )

    # Enrich each entry with opponent's drtg/ortg from the same game
    for team_id, h in histories.items():
        for venue in ("home", "away", "all"):
            for entry in h[venue]:
                opp_id = entry["opp_team_id"]
                key = (entry["game_id"], opp_id)
                opp_drtg, opp_ortg = game_team_stats.get(key, (float("nan"), float("nan")))
                entry["opp_drtg_for_adj"] = opp_drtg
                entry["opp_ortg_for_adj"] = opp_ortg


def _schedule_features(
    team_id: str,
    histories: dict[str, dict[str, list[dict]]],
    target_date: str,
) -> dict[str, float]:
    """Compute rest days, B2B flag, games_in_last_7, win_rate_last_7 for a team."""
    all_prior = [g for g in histories.get(team_id, {}).get("all", []) if g["date"] < target_date]

    if not all_prior:
        rest_days = float(REST_DAYS_CAP)
        b2b = 0.0
        games_in_7 = 0.0
        win_rate_7 = 0.5  # default to neutral
    else:
        last_game_date = all_prior[-1]["date"]
        rest_days = min(float(_days_between(last_game_date, target_date)), REST_DAYS_CAP)
        b2b = 1.0 if rest_days == 1 else 0.0

        target_d = Date.fromisoformat(target_date[:10])
        cutoff = str(target_d - timedelta(days=7))
        recent_7 = [g for g in all_prior if g["date"] >= cutoff]
        games_in_7 = float(len(recent_7))

        # win_rate_last_7: determine win by checking if team scored more (approximate from drtg>ortg)
        # We need game_results for this; store is_win in history at build time
        wins = sum(1 for g in all_prior[-7:] if g.get("won", False))
        n = min(len(all_prior), 7)
        win_rate_7 = wins / max(n, 1)

    return {
        "rest_days": rest_days,
        "b2b": b2b,
        "rest_days_in_last_7": games_in_7,
        "win_rate_last_7": win_rate_7,
    }


def _build_team_histories_with_wins(
    box_rows: list[dict],
    paired: dict[str, dict[str, dict]],
    eligible_game_ids: set[str],
    game_results: dict[str, int],
) -> dict[str, dict[str, list[dict]]]:
    """Like _build_team_histories but also stores `won` field per game entry."""
    by_game: dict[str, list[dict]] = {}
    for r in box_rows:
        by_game.setdefault(r["game_id"], []).append(r)

    histories: dict[str, dict[str, list[dict]]] = {}

    for game_id, rows in by_game.items():
        if game_id not in eligible_game_ids:
            continue
        if len(rows) != 2:
            continue

        home_win = game_results.get(game_id)

        for r in rows:
            team_id = r["team_id"]
            is_home = r["team_id"] == r["home_team_id"]
            opp_team_id = r["away_team_id"] if is_home else r["home_team_id"]

            paired_row = paired.get(game_id, {}).get(team_id)
            if paired_row is None:
                continue
            derived = _per_game_derived(paired_row)

            won = (home_win == 1) if is_home else (home_win == 0)

            entry = {
                "game_id": game_id,
                "date": r["date"],
                "season": r["season"],
                "opp_team_id": opp_team_id,
                "is_home": is_home,
                "won": won,
                **derived,
            }

            h = histories.setdefault(team_id, {"home": [], "away": [], "all": []})
            venue = "home" if is_home else "away"
            h[venue].append(entry)
            h["all"].append(entry)

    for team_id, h in histories.items():
        for key in ("home", "away", "all"):
            h[key].sort(key=lambda x: x["date"])

    return histories


def _get_transform(feature_name: str) -> str:
    # Phase 7 hybrid features (Plans/nba-learned-model.md addendum v18).
    # Match before Phase 3 routing so `tov_pct_off_agg` doesn't fall through to
    # _RATE_FEATURES (which is keyed on the un-suffixed name).
    if feature_name in {"home_advantage", "b2b_home", "b2b_away"}:
        return "passthrough"
    if feature_name in {"days_rest_home", "days_rest_away",
                        "games_played_home", "games_played_away"}:
        return "log1p_zscore"
    base = feature_name.removeprefix("home_").removeprefix("away_")
    if base.endswith("_agg"):
        stat = base[: -len("_agg")]
        if stat in _PHASE7_AGG_RATE_STATS:
            return "logit_zscore"
        return "zscore"  # net_rating_agg, pace_agg
    if "_delta_h" in base:
        return "zscore"  # deltas are real-valued (can be negative)

    # Phase 3 (existing) — keep below the Phase 7 branches above.
    if base in _RATE_FEATURES:
        return "logit_zscore"
    if base in _COUNT_FEATURES:
        return "log1p_zscore"
    if base in _BINARY_FEATURES:
        return "passthrough"
    return "zscore"


def _apply_norm(col: np.ndarray, params: NormParams) -> np.ndarray:
    if params.transform == "passthrough":
        return col.astype(float)
    if params.transform == "logit_zscore":
        col = np.clip(col, params.eps, 1 - params.eps)
        col = np.log(col / (1 - col))
    elif params.transform == "log1p_zscore":
        col = np.log1p(col)
    return (col - params.mean) / params.std


def _fit_and_normalize(
    X_raw: np.ndarray,
    feature_names: list[str],
    config: FeatureConfig,
) -> tuple[np.ndarray, FeatureConfig]:
    """Fit normalization params on X_raw and return normalized X + updated config."""
    norm_params: dict[str, NormParams] = {}
    for i, name in enumerate(feature_names):
        col = X_raw[:, i].astype(float)
        finite = col[np.isfinite(col)]
        transform = _get_transform(name)
        eps = config.eps_for(name)

        if transform == "logit_zscore":
            transformed = np.log(
                np.clip(finite, eps, 1 - eps) / (1 - np.clip(finite, eps, 1 - eps))
            )
        elif transform == "log1p_zscore":
            transformed = np.log1p(finite)
        elif transform == "passthrough":
            norm_params[name] = NormParams(transform="passthrough")
            continue
        else:
            transformed = finite

        mean_ = float(transformed.mean()) if len(transformed) > 0 else 0.0
        std_ = float(transformed.std(ddof=0)) if len(transformed) > 1 else 1.0
        norm_params[name] = NormParams(
            transform=transform,
            mean=mean_,
            std=max(std_, 1e-8),
            eps=eps,
        )

    fitted_config = replace(config, norm_params=norm_params)

    X_norm = np.zeros_like(X_raw, dtype=float)  # 0.0 = mean in normalized space
    for i, name in enumerate(feature_names):
        col = X_raw[:, i].astype(float)
        finite_mask = np.isfinite(col)
        if finite_mask.any():
            X_norm[finite_mask, i] = _apply_norm(col[finite_mask], norm_params[name])
        # NaN positions stay 0.0 = mean of training distribution (valid imputation)
    return X_norm, fitted_config


def _normalize_live(X_raw: np.ndarray, feature_names: list[str], config: FeatureConfig) -> np.ndarray:
    """Apply pre-fitted normalization params to a single feature vector."""
    X_norm = np.zeros_like(X_raw, dtype=float)  # 0.0 = mean in normalized space
    for i, name in enumerate(feature_names):
        val = float(X_raw[i])
        if np.isfinite(val):
            X_norm[i] = _apply_norm(np.array([val]), config.norm_params[name])[0]
        # NaN stays 0.0 = mean imputation
    return X_norm


ORDERED_STATS = [
    "ortg", "drtg", "net_rating", "opp_adj_nrtg", "opp_adj_def",
    "efg_pct_off", "efg_pct_def",
    "tov_pct_off", "tov_pct_def",
    "oreb_pct", "dreb_pct",
    "three_p_rate_off", "three_p_rate_def",
    "ast_per_poss", "stl_per_poss", "blk_per_poss",
    "bpm_effective",     # cold-start prior blend (Plans/nba-cold-start-prior.md)
    "season_net_rating", # season-to-date mean Net Rating — v5's core signal (Phase 6)
]
SITUATIONAL_STATS = ["rest_days", "b2b", "rest_days_in_last_7", "win_rate_last_7"]


def _feature_names_for(prefix: str) -> list[str]:
    return [f"{prefix}_{s}" for s in ORDERED_STATS + SITUATIONAL_STATS]


FEATURE_NAMES_ALL = (
    _feature_names_for("home")
    + _feature_names_for("away")
    + ["is_denver_home", "neutral_site"]
)


# Phase 7 hybrid feature pipeline feature-name assembly
# (Plans/nba-learned-model.md addendum v18)
PHASE7_GAME_LEVEL_NAMES = [
    "home_advantage", "neutral_site", "is_denver_home",
    "days_rest_home", "days_rest_away",
    "b2b_home", "b2b_away",
    "games_played_home", "games_played_away",
]
NBA_HOME_ADVANTAGE_V5 = 2.25  # v5 NBA home-advantage (debt #27 closure, Sprint 10.9.5)


def _phase7_team_feature_names(prefix: str) -> list[str]:
    """Per-team Phase 7 names: agg for each stat + delta for each (stat × halflife)."""
    names = [f"{prefix}_{s}_agg" for s in PHASE7_AGG_STATS]
    for h in PHASE7_HALFLIVES:
        names.extend(f"{prefix}_{s}_delta_h{h}" for s in PHASE7_AGG_STATS)
    return names


PHASE7_FEATURE_NAMES_ALL = (
    _phase7_team_feature_names("home")
    + _phase7_team_feature_names("away")
    + PHASE7_GAME_LEVEL_NAMES
)


def _game_feature_vector(
    game: dict,
    histories: dict[str, dict[str, list[dict]]],
    config: FeatureConfig,
) -> np.ndarray:
    """Compute raw (un-normalized) feature vector for one game."""
    home_id = game["home_team_id"]
    away_id = game["away_team_id"]
    target_date = game["date"]
    target_season = game["season"]

    home_rolling = _rolling_feature_vector(
        home_id, histories, target_date, target_season, "home", config
    )
    away_rolling = _rolling_feature_vector(
        away_id, histories, target_date, target_season, "away", config
    )
    home_sched = _schedule_features(home_id, histories, target_date)
    away_sched = _schedule_features(away_id, histories, target_date)

    home_vals = [home_rolling.get(s, float("nan")) for s in ORDERED_STATS] + \
                [home_sched.get(s, float("nan")) for s in SITUATIONAL_STATS]
    away_vals = [away_rolling.get(s, float("nan")) for s in ORDERED_STATS] + \
                [away_sched.get(s, float("nan")) for s in SITUATIONAL_STATS]

    game_vals = [
        1.0 if home_id == DENVER_TEAM_ID else 0.0,
        float(game.get("neutral_site", 0)),
    ]

    return np.array(home_vals + away_vals + game_vals, dtype=float)


def _phase7_game_feature_vector(
    game: dict,
    histories: dict[str, dict[str, list[dict]]],
) -> np.ndarray:
    """Phase 7 hybrid feature vector for one game (un-normalized).

    Order: home_team_features + away_team_features + game-level. Aligned with
    `PHASE7_FEATURE_NAMES_ALL`.
    """
    home_id = game["home_team_id"]
    away_id = game["away_team_id"]
    target_date = game["date"]
    target_season = game["season"]
    neutral_site = float(game.get("neutral_site", 0))

    home_team = _phase7_team_features(home_id, histories, target_date, target_season, "home")
    away_team = _phase7_team_features(away_id, histories, target_date, target_season, "away")
    home_sched = _schedule_features(home_id, histories, target_date)
    away_sched = _schedule_features(away_id, histories, target_date)

    # games_played per team: count of current-season prior games in the team's "all" history
    home_gp = float(sum(
        1 for g in histories.get(home_id, {}).get("all", [])
        if g["season"] == target_season and g["date"] < target_date
    ))
    away_gp = float(sum(
        1 for g in histories.get(away_id, {}).get("all", [])
        if g["season"] == target_season and g["date"] < target_date
    ))

    home_vals = [home_team[name.removeprefix("home_")] for name in _phase7_team_feature_names("home")]
    away_vals = [away_team[name.removeprefix("away_")] for name in _phase7_team_feature_names("away")]

    game_vals = [
        NBA_HOME_ADVANTAGE_V5 * (1.0 - neutral_site),  # home_advantage
        neutral_site,
        1.0 if home_id == DENVER_TEAM_ID else 0.0,
        float(home_sched.get("rest_days", float("nan"))),
        float(away_sched.get("rest_days", float("nan"))),
        float(home_sched.get("b2b", float("nan"))),
        float(away_sched.get("b2b", float("nan"))),
        home_gp,
        away_gp,
    ]

    return np.array(home_vals + away_vals + game_vals, dtype=float)


def build_training_tensor(
    config: FeatureConfig,
    db_path: str,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """
    Build training tensor from the DB.

    Returns:
        X: (N, F) normalized float64 feature matrix
        y: (N,) int array — 1 = home win, 0 = away win
        game_ids: aligned list of game IDs

    Side effects:
        - Updates config.norm_params and config.feature_names in place
        - Writes sidecar _training_manifest.json next to db_path
    """
    if not config.training_as_of:
        raise ValueError("config.training_as_of must be set before calling build_training_tensor")

    # Populate BPM prior index if not already loaded
    if not config.bpm_prior_index:
        from ml.nba.bpm_prior import build_prior_index  # lazy import
        config.bpm_prior_index = build_prior_index()

    conn = sqlite3.connect(db_path)
    conn.row_factory = None

    # Load data
    box_rows = _load_box_stats(conn, config.training_as_of)
    eligible_games = _load_eligible_games(conn, config.training_as_of)
    game_results_raw = conn.execute(
        "SELECT game_id, home_win FROM game_results WHERE sport = 'nba'"
    ).fetchall()
    game_results: dict[str, int] = {r[0]: r[1] for r in game_results_raw}
    conn.close()

    eligible_game_ids = {g["game_id"] for g in eligible_games}

    # Sentinel imputation
    box_rows, imputation_log, null_tov_count = _impute_sentinel_tov(box_rows)

    # (null_tov_count was already computed inside _impute_sentinel_tov pre-pass)

    # Pair rows within each game
    paired = _pair_game_rows(box_rows)

    # Build team histories with win outcomes
    histories = _build_team_histories_with_wins(
        box_rows, paired, eligible_game_ids, game_results
    )

    # Pass 2: enrich with opponent DRtg for opp-adjusted Net Rating
    _enrich_opp_drtg(histories)

    # Build feature matrix
    feature_names = FEATURE_NAMES_ALL
    X_raw_rows = []
    y_list = []
    game_ids = []

    for game in eligible_games:
        gid = game["game_id"]
        if game_results.get(gid) is None:
            continue
        vec = _game_feature_vector(game, histories, config)
        X_raw_rows.append(vec)
        y_list.append(int(game["home_win"]))
        game_ids.append(gid)

    X_raw = np.array(X_raw_rows, dtype=float)
    y = np.array(y_list, dtype=int)

    # Fit normalization + normalize
    X_norm, fitted_config = _fit_and_normalize(X_raw, feature_names, config)

    # Update config in place (mutable fields)
    config.feature_names = fitted_config.feature_names if fitted_config.feature_names else feature_names
    config.norm_params = fitted_config.norm_params
    config.feature_names = feature_names

    # Write manifest
    manifest = {
        "training_as_of": config.training_as_of,
        "feature_form": config.feature_form,
        "window_size": config.window_size,
        "ewma_halflife": config.ewma_halflife,
        "n_games": int(X_norm.shape[0]),
        "n_features": int(X_norm.shape[1]),
        "feature_names": feature_names,
        "sentinel_imputation": imputation_log,
        "sentinel_imputation_count": len(imputation_log),
        "team_tov_null_imputed": null_tov_count,
        "season_distribution": {},
        "dropped_features": [
            "home_out_impact (no historical injury record)",
            "away_out_impact (no historical injury record)",
            "circadian_penalty_flag (no city/timezone lookup table)",
            "games_played_together_top5 (player minutes not in Phase 2)",
        ],
    }
    for game in eligible_games:
        manifest["season_distribution"][game["season"]] = (
            manifest["season_distribution"].get(game["season"], 0) + 1
        )

    manifest_path = os.path.join(os.path.dirname(db_path), "_training_manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    return X_norm, y, game_ids


def build_phase7_training_tensor(
    config: FeatureConfig,
    db_path: str,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """
    Build the Phase 7 hybrid training tensor.

    Layout: home (10 agg + 30 delta) + away (10 agg + 30 delta) + 9 game-level
    = 89 features. See `PHASE7_FEATURE_NAMES_ALL` for the exact ordering.

    Plan: Plans/nba-learned-model.md addendum v18 §"Feature architecture".
    Returns: (X_norm, y, game_ids).

    Side effects:
        - Sets config.feature_names = PHASE7_FEATURE_NAMES_ALL
        - Sets config.norm_params (fitted on this training fold)
        - Writes `_phase7_training_manifest.json` next to db_path
    """
    if not config.training_as_of:
        raise ValueError(
            "config.training_as_of must be set before build_phase7_training_tensor"
        )

    conn = sqlite3.connect(db_path)
    conn.row_factory = None

    box_rows = _load_box_stats(conn, config.training_as_of)
    eligible_games = _load_eligible_games(conn, config.training_as_of)
    game_results_raw = conn.execute(
        "SELECT game_id, home_win FROM game_results WHERE sport = 'nba'"
    ).fetchall()
    game_results: dict[str, int] = {r[0]: r[1] for r in game_results_raw}
    conn.close()

    eligible_game_ids = {g["game_id"] for g in eligible_games}
    box_rows, imputation_log, null_tov_count = _impute_sentinel_tov(box_rows)
    paired = _pair_game_rows(box_rows)
    histories = _build_team_histories_with_wins(
        box_rows, paired, eligible_game_ids, game_results
    )
    # Note: Phase 7 does NOT call _enrich_opp_drtg — opp-adjusted Net Rating is
    # not in the Phase 7 feature set per addendum v18 §"Feature architecture".

    feature_names = PHASE7_FEATURE_NAMES_ALL
    X_raw_rows = []
    y_list = []
    game_ids = []

    for game in eligible_games:
        gid = game["game_id"]
        if game_results.get(gid) is None:
            continue
        vec = _phase7_game_feature_vector(game, histories)
        X_raw_rows.append(vec)
        y_list.append(int(game["home_win"]))
        game_ids.append(gid)

    X_raw = np.array(X_raw_rows, dtype=float)
    y = np.array(y_list, dtype=int)

    X_norm, fitted_config = _fit_and_normalize(X_raw, feature_names, config)

    config.feature_names = feature_names
    config.norm_params = fitted_config.norm_params

    manifest = {
        "training_as_of": config.training_as_of,
        "architecture": "phase7_hybrid",
        "halflives": PHASE7_HALFLIVES,
        "agg_stats": PHASE7_AGG_STATS,
        "n_games": int(X_norm.shape[0]),
        "n_features": int(X_norm.shape[1]),
        "feature_names": feature_names,
        "sentinel_imputation_count": len(imputation_log),
        "team_tov_null_imputed": null_tov_count,
        "season_distribution": {},
    }
    for game in eligible_games:
        manifest["season_distribution"][game["season"]] = (
            manifest["season_distribution"].get(game["season"], 0) + 1
        )

    manifest_path = os.path.join(os.path.dirname(db_path), "_phase7_training_manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    return X_norm, y, game_ids


def build_live_tensor(
    config: FeatureConfig,
    game_row: dict,
    db_path: str,
) -> np.ndarray:
    """
    Compute normalized feature vector for a single upcoming game.

    config must have been fitted (config.is_fitted() == True).
    game_row must have: home_team_id, away_team_id, date, season, neutral_site.

    For live inference, uses ALL available box stats (no as_of filter;
    training_as_of is not applied — use all observations to date).
    """
    if not config.is_fitted():
        raise ValueError("config must be fitted via build_training_tensor before build_live_tensor")

    if not config.bpm_prior_index:
        from ml.nba.bpm_prior import build_prior_index  # lazy import
        config.bpm_prior_index = build_prior_index()

    conn = sqlite3.connect(db_path)
    conn.row_factory = None

    # Load all box stats (no as_of filter for live inference)
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
        (game_row["date"],),
    ).fetchall()
    conn.close()

    cols = [
        "game_id", "team_id", "season", "date", "home_team_id", "away_team_id",
        "fga", "fgm", "fg3a", "fg3m", "fta", "ftm", "tov",
        "oreb", "dreb", "ast", "stl", "blk",
        "pts", "possessions", "updated_at",
    ]
    box_rows = [dict(zip(cols, r)) for r in rows]

    box_rows, _, _ = _impute_sentinel_tov(box_rows)

    all_game_ids = {r["game_id"] for r in box_rows}
    paired = _pair_game_rows(box_rows)
    game_results_dummy: dict[str, int] = {}

    histories = _build_team_histories_with_wins(
        box_rows, paired, all_game_ids, game_results_dummy
    )
    _enrich_opp_drtg(histories)

    vec = _game_feature_vector(game_row, histories, config)
    return _normalize_live(vec, config.feature_names, config)


# ---------------------------------------------------------------------------
# Test-fold tensor builder (Phase 3 step 8)
# ---------------------------------------------------------------------------

_SQL_LOAD_BOX_STATS_WITH_TEST = """
        SELECT bs.game_id, bs.team_id, bs.season,
               g.date, g.home_team_id, g.away_team_id,
               bs.fga, bs.fgm, bs.fg3a, bs.fg3m,
               bs.fta, bs.ftm, bs.tov,
               bs.oreb, bs.dreb, bs.ast, bs.stl, bs.blk,
               bs.pts, bs.possessions, bs.updated_at
        FROM nba_game_box_stats bs
        JOIN games g ON g.id = bs.game_id
        WHERE bs.updated_at <= ?
        ORDER BY g.date ASC, bs.game_id, bs.team_id
        """


def _load_box_stats_with_test(conn: sqlite3.Connection, training_as_of: str) -> list[dict]:
    """Load ALL box stats including test-fold seasons.

    Fix-pack #1 (DQ, addendum v15): needed for correct rolling-window history
    when building test-fold features — prior test-fold game stats must be
    visible to subsequent test-fold game feature vectors.
    """
    rows = conn.execute(_SQL_LOAD_BOX_STATS_WITH_TEST, (training_as_of,)).fetchall()
    cols = [
        "game_id", "team_id", "season", "date", "home_team_id", "away_team_id",
        "fga", "fgm", "fg3a", "fg3m", "fta", "ftm", "tov",
        "oreb", "dreb", "ast", "stl", "blk",
        "pts", "possessions", "updated_at",
    ]
    return [dict(zip(cols, r)) for r in rows]


_SQL_LOAD_TEST_ELIGIBLE_GAMES = """
        SELECT eg.game_id, eg.season, eg.home_team_id, eg.away_team_id,
               eg.date, eg.neutral_site,
               gr.home_win
        FROM nba_eligible_games eg
        JOIN game_results gr ON gr.game_id = eg.game_id
        WHERE eg.season IN ({placeholders})
          AND eg.date <= SUBSTR(?, 1, 10)
        ORDER BY eg.date ASC, eg.game_id
        """


def _load_test_eligible_games(
    conn: sqlite3.Connection, training_as_of: str,
    test_seasons: frozenset[str] = TEST_FOLD_SEASONS,
) -> list[dict]:
    """Load eligible games for test-fold seasons only."""
    placeholders = ",".join("?" * len(test_seasons))
    sql = _SQL_LOAD_TEST_ELIGIBLE_GAMES.format(placeholders=placeholders)
    rows = conn.execute(sql, (*test_seasons, training_as_of)).fetchall()
    cols = ["game_id", "season", "home_team_id", "away_team_id", "date", "neutral_site", "home_win"]
    return [dict(zip(cols, r)) for r in rows]


def build_test_fold_tensor(
    config: FeatureConfig,
    db_path: str,
    test_seasons: frozenset[str] = TEST_FOLD_SEASONS,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Build feature tensor for test-fold games with frozen normalization.

    Fix-pack #1 (DQ, addendum v15): bypasses the NOT IN test-fold exclusion
    used in build_training_tensor(). Loads ALL box stats (training + test-fold)
    so rolling windows span the full history. Computes feature vectors for
    test-fold games only. Applies frozen norm_params from config — does NOT
    refit normalization.

    config must have norm_params pre-populated (e.g. loaded from
    calibration-params.json via infer._build_fitted_config()).
    """
    if not config.is_fitted():
        raise ValueError(
            "config.norm_params must be pre-populated. Load from calibration-params.json "
            "via infer._build_fitted_config() before calling build_test_fold_tensor()."
        )
    if not config.training_as_of:
        raise ValueError("config.training_as_of must be set")

    if not config.bpm_prior_index:
        from ml.nba.bpm_prior import build_prior_index  # lazy import
        config.bpm_prior_index = build_prior_index()

    conn = sqlite3.connect(db_path)
    conn.row_factory = None

    # Load ALL box stats (training + test fold) for complete rolling windows
    box_rows = _load_box_stats_with_test(conn, config.training_as_of)

    # Load test-fold eligible games (only these get feature vectors)
    test_eligible_games = _load_test_eligible_games(conn, config.training_as_of, test_seasons)

    # All game results (including test fold outcomes for won/lost tracking in histories)
    game_results_raw = conn.execute(
        "SELECT game_id, home_win FROM game_results WHERE sport = 'nba'"
    ).fetchall()
    game_results: dict[str, int] = {r[0]: r[1] for r in game_results_raw}

    conn.close()

    # Use ALL games in box_rows for history building (includes prior test-fold games)
    all_game_ids = {r["game_id"] for r in box_rows}

    # Sentinel imputation (same as training)
    box_rows, _, _ = _impute_sentinel_tov(box_rows)

    # Build team histories spanning training + test-fold games
    paired = _pair_game_rows(box_rows)
    histories = _build_team_histories_with_wins(
        box_rows, paired, all_game_ids, game_results
    )
    _enrich_opp_drtg(histories)

    # Compute feature vectors for test-fold games only
    feature_names = FEATURE_NAMES_ALL
    X_norm_rows = []
    y_list = []
    game_ids = []

    for game in test_eligible_games:
        gid = game["game_id"]
        if game_results.get(gid) is None:
            continue
        vec = _game_feature_vector(game, histories, config)
        x_norm = _normalize_live(vec, feature_names, config)
        X_norm_rows.append(x_norm)
        y_list.append(int(game["home_win"]))
        game_ids.append(gid)

    X_norm = np.array(X_norm_rows, dtype=float)
    y = np.array(y_list, dtype=int)

    return X_norm, y, game_ids
