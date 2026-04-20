#!/usr/bin/env python3
"""
validate-debt27.py — Self-contained ship-rule validation for debt #27.

Replays the baseline + reliability pipeline in pure Python (no native deps).
Uses Python's built-in sqlite3 module, so it runs on Termux/Android.

Usage:
  python3 scripts/validate-debt27.py [path-to-sportsdata.db]

If no path given, defaults to data/sqlite/sportsdata.db.
"""

import math
import sqlite3
import sys
import json

# ── Constants (must match src/analysis/predict.ts exactly) ──

SPORT_HOME_ADVANTAGE = {
    "nba": 2.4,   # ← THE CHANGE (was 3.0)
    "nfl": 2.5,
    "mlb": 0.5,
    "nhl": 0.3,
    "mls": 0.4,
    "epl": 0.4,
}

SPORT_HOME_WIN_RATE = {
    "nba": 0.57, "nfl": 0.57, "mlb": 0.54,
    "nhl": 0.55, "mls": 0.49, "epl": 0.46,
}

SIGMOID_SCALE = {
    "nba": 0.10, "nfl": 0.10, "mlb": 0.30,
    "nhl": 0.45, "mls": 0.60, "epl": 0.60,
}

SPORT_MARGIN_CLAMP = {
    "nba": 30, "nfl": 35, "mlb": 12, "nhl": 8, "mls": 6, "epl": 6,
}

MARGIN_BIN_SPECS = {
    "nba": (2, -20, 20), "nfl": (2, -20, 20),
    "mlb": (1, -10, 10), "nhl": (1, -6, 6),
    "mls": (1, -5, 5),   "epl": (1, -5, 5),
}

TRAIN_CUTOFF_SEASON = 2023
SPORTS = ["nba", "nfl", "mlb", "nhl", "mls", "epl"]

MARGIN_VERDICT_THRESH = 0.5
WINNER_VERDICT_THRESH = 0.02

# ── Pre-change reference values (from reliability-2026-04-15.json) ──

PRE = {
    "nba_margin_wMAE": 0.9565,
    "nba_margin_sR": -0.6050,
    "nba_winner_ece": 0.0156,
    "other_margin_verdicts": {
        "nfl": "HONEST", "mlb": "HONEST", "nhl": "HONEST",
        "mls": "HONEST", "epl": "HONEST",
    },
}


# ── Model functions ──

def sigmoid(x):
    if x > 500: return 1.0
    if x < -500: return 0.0
    return 1.0 / (1.0 + math.exp(-x))


def predict_v5(sport, home, away):
    base_rate = SPORT_HOME_WIN_RATE.get(sport, 0.55)
    if home["games"] < 5 or away["games"] < 5:
        return base_rate
    home_diff = (home["pointsFor"] - home["pointsAgainst"]) / home["games"]
    away_diff = (away["pointsFor"] - away["pointsAgainst"]) / away["games"]
    scale = SIGMOID_SCALE.get(sport, 0.10)
    home_adv = SPORT_HOME_ADVANTAGE.get(sport, 3.0)
    x = scale * ((home_diff - away_diff) + home_adv)
    prob = sigmoid(x)
    return max(0.15, min(0.85, prob))


def predict_margin(sport, home, away):
    home_adv = SPORT_HOME_ADVANTAGE.get(sport, 3.0)
    clamp = SPORT_MARGIN_CLAMP.get(sport, 30)
    if home["games"] < 5 or away["games"] < 5:
        return home_adv
    home_diff = (home["pointsFor"] - home["pointsAgainst"]) / home["games"]
    away_diff = (away["pointsFor"] - away["pointsAgainst"]) / away["games"]
    margin = (home_diff - away_diff) + home_adv

    last3h = home["lastN"][-3:] if len(home["lastN"]) >= 3 else []
    last3a = away["lastN"][-3:] if len(away["lastN"]) >= 3 else []
    home_cold = len(last3h) == 3 and all(not r for r in last3h)
    away_hot = len(last3a) == 3 and all(r for r in last3a)

    if home_cold:
        margin -= home_adv * 0.5
    if away_hot:
        margin -= home_adv * 0.3
    return max(-clamp, min(clamp, margin))


# ── Season helper ──

def get_season_year(sport, date_str):
    year = int(date_str[:4])
    month = int(date_str[5:7])
    if sport in ("nba", "nhl", "nfl"):
        return year if month >= 9 else year - 1
    elif sport == "mlb":
        return year
    else:  # soccer
        return year if month >= 8 else year - 1


# ── Replay ──

def load_and_replay(db_path, sport):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("""
        SELECT gr.game_id, gr.date, g.home_team_id, g.away_team_id,
               gr.home_score, gr.away_score, gr.home_win, gr.is_draw
        FROM game_results gr
        JOIN games g ON gr.game_id = g.id
        WHERE gr.sport = ?
        ORDER BY gr.date
    """, (sport,))
    all_rows = cur.fetchall()
    conn.close()

    # Filter to post-cutoff
    scored = [r for r in all_rows if get_season_year(sport, r["date"]) > TRAIN_CUTOFF_SEASON]

    # Build snapshots by walking ALL rows chronologically
    team_states = {}
    snapshots = {}

    def init_team(tid):
        if tid not in team_states:
            team_states[tid] = {
                "games": 0, "wins": 0, "losses": 0,
                "pointsFor": 0, "pointsAgainst": 0, "lastN": [],
            }
        return team_states[tid]

    for r in all_rows:
        hs = init_team(r["home_team_id"])
        aws = init_team(r["away_team_id"])

        # Snapshot BEFORE update
        snapshots[r["game_id"]] = {
            "home": {**hs, "lastN": list(hs["lastN"])},
            "away": {**aws, "lastN": list(aws["lastN"])},
        }

        is_draw = r["is_draw"] == 1
        home_won = not is_draw and r["home_win"] == 1

        hs["games"] += 1
        aws["games"] += 1
        hs["pointsFor"] += r["home_score"]
        hs["pointsAgainst"] += r["away_score"]
        aws["pointsFor"] += r["away_score"]
        aws["pointsAgainst"] += r["home_score"]

        if not is_draw:
            if home_won:
                hs["wins"] += 1
                aws["losses"] += 1
            else:
                hs["losses"] += 1
                aws["wins"] += 1

        hs["lastN"] = (hs["lastN"] + [home_won])[-5:]
        aws["lastN"] = (aws["lastN"] + [not home_won and not is_draw])[-5:]

    # Now replay scored (post-cutoff) games
    results = []
    for g in scored:
        snap = snapshots.get(g["game_id"])
        if not snap:
            continue
        home_s, away_s = snap["home"], snap["away"]
        low_conf = home_s["games"] < 5 or away_s["games"] < 5

        pred_prob = predict_v5(sport, home_s, away_s)
        pred_margin = predict_margin(sport, home_s, away_s)
        actual_margin = g["home_score"] - g["away_score"]
        is_draw = g["is_draw"] == 1
        home_win = 1 if (g["home_win"] == 1 and not is_draw) else 0

        results.append({
            "predictedProb": pred_prob,
            "predictedMargin": pred_margin,
            "actualMargin": actual_margin,
            "homeWin": home_win,
            "isDraw": is_draw,
            "lowConfidence": low_conf,
        })
    return results


# ── Reliability computation ──

def compute_margin_reliability(rows, spec):
    width, low, high = spec
    bin_count = round((high - low) / width)
    buckets = [{"pred": [], "actual": []} for _ in range(bin_count)]

    for r in rows:
        idx = int((r["predictedMargin"] - low) / width)
        idx = max(0, min(bin_count - 1, idx))
        buckets[idx]["pred"].append(r["predictedMargin"])
        buckets[idx]["actual"].append(r["actualMargin"])

    N = len(rows)
    populated = 0
    mae_sum = 0.0
    signed_sum = 0.0

    for b in buckets:
        if not b["pred"]:
            continue
        populated += 1
        pred_avg = sum(b["pred"]) / len(b["pred"])
        actual_avg = sum(b["actual"]) / len(b["actual"])
        residual = actual_avg - pred_avg
        mae_sum += (len(b["pred"]) / max(1, N)) * abs(residual)
        signed_sum += (len(b["pred"]) / max(1, N)) * residual

    if N < 50:
        verdict = "INSUFFICIENT"
    elif populated <= 2:
        verdict = "DISCRETE"
    elif signed_sum > MARGIN_VERDICT_THRESH:
        verdict = "BIASED_LOW"
    elif signed_sum < -MARGIN_VERDICT_THRESH:
        verdict = "BIASED_HIGH"
    else:
        verdict = "HONEST"

    return {
        "weightedMAE": mae_sum if N > 0 else None,
        "signedResidual": signed_sum if N > 0 else None,
        "populated": populated,
        "verdict": verdict,
    }


def compute_winner_reliability(rows, bin_count=10):
    bin_width = 0.5 / bin_count
    buckets = [{"sumPred": 0.0, "correct": 0, "n": 0} for _ in range(bin_count)]

    eligible = 0
    for r in rows:
        if r["isDraw"]:
            continue
        p = r["predictedProb"]
        picked_home = p >= 0.5
        confidence = p if picked_home else 1.0 - p
        correct = r["homeWin"] if picked_home else (0 if r["homeWin"] == 1 else 1)
        if confidence < 0.5 or confidence > 1.0:
            continue

        idx = int((confidence - 0.5) / bin_width)
        idx = max(0, min(bin_count - 1, idx))
        buckets[idx]["sumPred"] += confidence
        buckets[idx]["correct"] += correct
        buckets[idx]["n"] += 1
        eligible += 1

    populated = 0
    ece_sum = 0.0
    signed_sum = 0.0

    for b in buckets:
        if b["n"] == 0:
            continue
        populated += 1
        pred_avg = b["sumPred"] / b["n"]
        actual_rate = b["correct"] / b["n"]
        residual = actual_rate - pred_avg
        ece_sum += (b["n"] / max(1, eligible)) * abs(residual)
        signed_sum += (b["n"] / max(1, eligible)) * residual

    if eligible < 50:
        verdict = "INSUFFICIENT"
    elif populated <= 2:
        verdict = "DISCRETE"
    elif signed_sum > WINNER_VERDICT_THRESH:
        verdict = "SHY"
    elif signed_sum < -WINNER_VERDICT_THRESH:
        verdict = "OVERCONFIDENT"
    else:
        verdict = "HONEST"

    return {
        "ece": ece_sum if eligible > 0 else None,
        "signedResidual": signed_sum if eligible > 0 else None,
        "populated": populated,
        "verdict": verdict,
    }


# ── Main ──

def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else "data/sqlite/sportsdata.db"
    print(f"Using DB: {db_path}")
    print()

    failures = 0
    results_by_sport = {}

    for sport in SPORTS:
        games = load_and_replay(db_path, sport)
        margin_rel = compute_margin_reliability(games, MARGIN_BIN_SPECS[sport])
        winner_rel = compute_winner_reliability(games)
        results_by_sport[sport] = {
            "n": len(games),
            "margin": margin_rel,
            "winner": winner_rel,
        }
        wMAE = margin_rel["weightedMAE"] or 0
        sR = margin_rel["signedResidual"] or 0
        ece = winner_rel["ece"] or 0
        print(f"  {sport:>3s}  N={len(games):>5d}  margin: wMAE={wMAE:.4f}  sR={sR:+.4f}  verdict={margin_rel['verdict']}")
        print(f"       winner: ECE={ece:.4f}  sR={winner_rel['signedResidual'] or 0:+.4f}  verdict={winner_rel['verdict']}")

    print()
    print("=" * 60)
    print("SHIP RULE CHECKS")
    print("=" * 60)
    print()

    nba = results_by_sport["nba"]

    # Rule 1: NBA v4-spread weightedMAE decreases
    new_wmae = nba["margin"]["weightedMAE"]
    if new_wmae < PRE["nba_margin_wMAE"]:
        print(f"  \033[32mPASS\033[0m Rule 1: NBA margin weightedMAE decreased: {PRE['nba_margin_wMAE']:.4f} → {new_wmae:.4f}")
    else:
        print(f"  \033[31mFAIL\033[0m Rule 1: NBA margin weightedMAE did NOT decrease: {PRE['nba_margin_wMAE']:.4f} → {new_wmae:.4f}")
        failures += 1

    # Rule 2: |signedResid| ≤ 0.10
    new_sr = nba["margin"]["signedResidual"]
    if abs(new_sr) <= 0.10:
        print(f"  \033[32mPASS\033[0m Rule 2: NBA margin |signedResid| ≤ 0.10: {new_sr:+.4f} (|{abs(new_sr):.4f}|)")
    else:
        print(f"  \033[31mFAIL\033[0m Rule 2: NBA margin |signedResid| > 0.10: {new_sr:+.4f} (|{abs(new_sr):.4f}|)")
        failures += 1

    # Rule 3: verdict == HONEST
    v = nba["margin"]["verdict"]
    if v == "HONEST":
        print(f"  \033[32mPASS\033[0m Rule 3: NBA margin verdict = HONEST")
    else:
        print(f"  \033[31mFAIL\033[0m Rule 3: NBA margin verdict = {v} (expected HONEST)")
        failures += 1

    # Rule 4: NBA v5 winner ECE regression ≤ +0.015
    new_ece = nba["winner"]["ece"]
    regression = new_ece - PRE["nba_winner_ece"]
    if regression <= 0.015:
        sign = "+" if regression >= 0 else ""
        print(f"  \033[32mPASS\033[0m Rule 4: NBA winner ECE regression = {sign}{regression:.4f} (≤ 0.015). ECE: {PRE['nba_winner_ece']:.4f} → {new_ece:.4f}. Verdict: {nba['winner']['verdict']}")
    else:
        print(f"  \033[31mFAIL\033[0m Rule 4: NBA winner ECE regression = +{regression:.4f} (> 0.015). ECE: {PRE['nba_winner_ece']:.4f} → {new_ece:.4f}. Verdict: {nba['winner']['verdict']}")
        failures += 1

    # Rule 5: No other sport's margin verdict changed
    rule5_ok = True
    for sport, expected in PRE["other_margin_verdicts"].items():
        actual = results_by_sport[sport]["margin"]["verdict"]
        if actual != expected:
            print(f"  \033[31mFAIL\033[0m Rule 5: {sport} margin verdict changed: {expected} → {actual}")
            failures += 1
            rule5_ok = False
    if rule5_ok:
        print(f"  \033[32mPASS\033[0m Rule 5: All other sports margin verdicts unchanged")

    print()
    if failures == 0:
        print("\033[32m✓ ALL 5 SHIP RULES PASS — safe to merge.\033[0m")
    else:
        print(f"\033[31m✗ {failures} SHIP RULE(S) FAILED — do NOT merge.\033[0m")
    sys.exit(failures)


if __name__ == "__main__":
    main()
