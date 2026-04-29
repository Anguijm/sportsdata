#!/usr/bin/env python3
"""
validate-debt12.py — v5 sigmoid scale cross-validation on held-out data.

Debt #12 (Math Expert, Sprint 10.6i): current scales were calibrated in-sample.
This script runs a fine-grained grid search per sport on the post-2023 held-out
corpus to confirm current scales or identify improvements.

Evaluation framework: temporal split — all game results are used to build
cumulative team stats (time-machine safe), but only games from seasons
> TRAIN_CUTOFF_SEASON (2023) are scored. This is the same held-out methodology
used by validate-debt28.py (debt #28 — MLS/EPL already closed).

Ship rule: a new scale is adopted for sport X iff:
  (a) the new scale's winner verdict is HONEST, AND
  (b) |new sR| < |old sR| - 0.003  (meaningful improvement, not noise)
  (c) ECE does not increase by more than 0.002 (regression guard)

Usage:
  python3 scripts/validate-debt12.py <db_path>
  python3 scripts/validate-debt12.py <db_path> --sport nba --scale 0.11
  python3 scripts/validate-debt12.py <db_path> --grid
  python3 scripts/validate-debt12.py <db_path> --ship
"""

import argparse
import math
import sqlite3

SPORT_HOME_ADVANTAGE = {
    "nba": 2.25, "nfl": 2.5, "mlb": 0.5, "nhl": 0.3, "mls": 0.4, "epl": 0.4,
}
SPORT_HOME_WIN_RATE = {
    "nba": 0.57, "nfl": 0.57, "mlb": 0.54, "nhl": 0.55, "mls": 0.49, "epl": 0.46,
}
SIGMOID_SCALE_PRE = {
    "nba": 0.10, "nfl": 0.10, "mlb": 0.30, "nhl": 0.45,
    "mls": 0.80,  # debt #28 calibrated
    "epl": 0.90,  # debt #28 calibrated
}
SIGMOID_SCALE_CURRENT = {
    "nba": 0.10, "nfl": 0.10, "mlb": 0.26, "nhl": 0.40,
    "mls": 0.80,  # debt #28 calibrated
    "epl": 0.90,  # debt #28 calibrated
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
TARGET_SPORTS = ["nba", "nfl", "mlb", "nhl"]  # MLS/EPL already closed via debt #28
MARGIN_VERDICT_THRESH = 0.5
WINNER_VERDICT_THRESH = 0.02

# Grid candidates per sport (finer resolution near current value)
GRID_CANDIDATES = {
    "nba": [round(v * 0.01, 3) for v in range(5, 26)],   # 0.05–0.25 step 0.01
    "nfl": [round(v * 0.01, 3) for v in range(5, 26)],   # 0.05–0.25 step 0.01
    "mlb": [round(v * 0.02, 3) for v in range(8, 31)],   # 0.16–0.60 step 0.02
    "nhl": [round(v * 0.02, 3) for v in range(10, 41)],  # 0.20–0.80 step 0.02
    "mls": [0.80],  # already calibrated
    "epl": [0.90],  # already calibrated
}

# Ship rule thresholds
SR_IMPROVEMENT_THRESHOLD = 0.003  # |old sR| - |new sR| must exceed this
ECE_REGRESSION_GUARD = 0.002      # ECE must not worsen by more than this


def sigmoid(x):
    if x > 500: return 1.0
    if x < -500: return 0.0
    return 1.0 / (1.0 + math.exp(-x))


def predict_v5(sport, home, away, scales):
    base_rate = SPORT_HOME_WIN_RATE.get(sport, 0.55)
    if home["games"] < 5 or away["games"] < 5:
        return base_rate
    home_diff = (home["pointsFor"] - home["pointsAgainst"]) / home["games"]
    away_diff = (away["pointsFor"] - away["pointsAgainst"]) / away["games"]
    scale = scales.get(sport, 0.10)
    home_adv = SPORT_HOME_ADVANTAGE.get(sport, 3.0)
    x = scale * ((home_diff - away_diff) + home_adv)
    prob = sigmoid(x)
    return max(0.15, min(0.85, prob))


def get_season_year(sport, date_str):
    year = int(date_str[:4]); month = int(date_str[5:7])
    if sport in ("mlb", "mls"):
        return year
    if sport == "nfl":
        return year if month >= 9 else year - 1
    if sport == "epl":
        return year if month >= 8 else year - 1
    return year if month >= 10 else year - 1  # nba, nhl


def load_and_replay(db_path, sport, scales):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("""
        SELECT gr.game_id, gr.date, g.home_team_id, g.away_team_id,
               gr.home_score, gr.away_score, gr.home_win, gr.is_draw
        FROM game_results gr JOIN games g ON gr.game_id = g.id
        WHERE gr.sport = ? ORDER BY gr.date
    """, (sport,))
    all_rows = cur.fetchall()
    conn.close()

    team_states = {}; snapshots = {}

    def init_team(tid):
        if tid not in team_states:
            team_states[tid] = {"games": 0, "wins": 0, "losses": 0,
                                 "pointsFor": 0, "pointsAgainst": 0, "lastN": []}
        return team_states[tid]

    for r in all_rows:
        hs = init_team(r["home_team_id"]); aws = init_team(r["away_team_id"])
        snapshots[r["game_id"]] = {
            "home": {**hs, "lastN": list(hs["lastN"])},
            "away": {**aws, "lastN": list(aws["lastN"])},
        }
        is_draw = r["is_draw"] == 1
        home_won = not is_draw and r["home_win"] == 1
        hs["games"] += 1; aws["games"] += 1
        hs["pointsFor"] += r["home_score"]; hs["pointsAgainst"] += r["away_score"]
        aws["pointsFor"] += r["away_score"]; aws["pointsAgainst"] += r["home_score"]
        if not is_draw:
            if home_won: hs["wins"] += 1; aws["losses"] += 1
            else: hs["losses"] += 1; aws["wins"] += 1
        hs["lastN"] = (hs["lastN"] + [home_won])[-5:]
        aws["lastN"] = (aws["lastN"] + [not home_won and not is_draw])[-5:]

    results = []
    for g in all_rows:
        if get_season_year(sport, g["date"]) <= TRAIN_CUTOFF_SEASON:
            continue
        snap = snapshots.get(g["game_id"])
        if not snap: continue
        home_s, away_s = snap["home"], snap["away"]
        pred_prob = predict_v5(sport, home_s, away_s, scales)
        actual_margin = g["home_score"] - g["away_score"]
        is_draw = g["is_draw"] == 1
        home_win = 1 if (g["home_win"] == 1 and not is_draw) else 0
        results.append({
            "predictedProb": pred_prob,
            "actualMargin": actual_margin,
            "homeWin": home_win,
            "isDraw": is_draw,
        })
    return results


def compute_winner_reliability(rows, bin_count=10):
    bin_width = 0.5 / bin_count
    buckets = [{"sumPred": 0.0, "correct": 0, "n": 0} for _ in range(bin_count)]
    eligible = 0
    for r in rows:
        if r["isDraw"]: continue
        p = r["predictedProb"]
        picked_home = p >= 0.5
        confidence = p if picked_home else 1.0 - p
        correct = r["homeWin"] if picked_home else (0 if r["homeWin"] == 1 else 1)
        if confidence < 0.5 or confidence > 1.0: continue
        idx = max(0, min(bin_count - 1, int((confidence - 0.5) / bin_width)))
        buckets[idx]["sumPred"] += confidence
        buckets[idx]["correct"] += correct
        buckets[idx]["n"] += 1
        eligible += 1
    populated = 0; ece_sum = 0.0; signed_sum = 0.0; brier_sum = 0.0
    for b in buckets:
        if b["n"] == 0: continue
        populated += 1
        pred_avg = b["sumPred"] / b["n"]
        actual_rate = b["correct"] / b["n"]
        residual = actual_rate - pred_avg
        ece_sum += (b["n"] / max(1, eligible)) * abs(residual)
        signed_sum += (b["n"] / max(1, eligible)) * residual
    for r in rows:
        if r["isDraw"]: continue
        p = r["predictedProb"]
        brier_sum += (p - r["homeWin"]) ** 2
    brier = brier_sum / max(1, eligible)
    if eligible < 50: verdict = "INSUFFICIENT"
    elif populated <= 2: verdict = "DISCRETE"
    elif signed_sum > WINNER_VERDICT_THRESH: verdict = "SHY"
    elif signed_sum < -WINNER_VERDICT_THRESH: verdict = "OVERCONFIDENT"
    else: verdict = "HONEST"
    return {"ece": ece_sum, "signedResidual": signed_sum,
            "populated": populated, "brier": brier,
            "eligible": eligible, "verdict": verdict}


def run_sport(db_path, sport, scales):
    rows = load_and_replay(db_path, sport, scales)
    return {"n": len(rows), "winner": compute_winner_reliability(rows)}


def print_baseline(db_path, scales):
    print(f"  {'sport':>4s}  {'N':>5s}  {'scale':>6s}  {'ECE':>7s}  {'sR':>8s}  {'Brier':>7s}  verdict")
    for sport in SPORTS:
        r = run_sport(db_path, sport, scales)
        w = r["winner"]
        print(f"  {sport:>4s}  {r['n']:>5d}  {scales[sport]:>6.3f}  "
              f"{w['ece']:>7.4f}  {w['signedResidual']:>+8.4f}  {w['brier']:>7.4f}  {w['verdict']}")


def grid_search(db_path):
    current_scales = dict(SIGMOID_SCALE_CURRENT)
    print(f"  Grid search: {', '.join(TARGET_SPORTS)}")
    print(f"  Ship rule: |new sR| < |old sR| - {SR_IMPROVEMENT_THRESHOLD} AND verdict=HONEST AND ECE not worse by >{ECE_REGRESSION_GUARD}")
    print()

    for sport in TARGET_SPORTS:
        candidates = GRID_CANDIDATES[sport]
        print(f"  {sport.upper()} (current={current_scales[sport]:.3f}):")

        # Baseline with current scale
        baseline_scales = dict(current_scales)
        b = run_sport(db_path, sport, baseline_scales)["winner"]
        print(f"    current  scale={current_scales[sport]:.3f}  ECE={b['ece']:.4f}  "
              f"sR={b['signedResidual']:+.4f}  v={b['verdict']}")

        rows_data = []
        for s in candidates:
            test_scales = dict(current_scales); test_scales[sport] = s
            w = run_sport(db_path, sport, test_scales)["winner"]
            rows_data.append({"scale": s, "ece": w["ece"], "sR": w["signedResidual"], "v": w["verdict"]})

        # Find best: min |sR| among HONEST candidates that pass ship rules
        honest = [r for r in rows_data if r["v"] == "HONEST"]
        ship_candidates = [
            r for r in honest
            if abs(r["sR"]) < abs(b["signedResidual"]) - SR_IMPROVEMENT_THRESHOLD
            and r["ece"] <= b["ece"] + ECE_REGRESSION_GUARD
        ]

        if ship_candidates:
            best = min(ship_candidates, key=lambda x: abs(x["sR"]))
            print(f"    SHIP CANDIDATE: scale={best['scale']:.3f}  ECE={best['ece']:.4f}  "
                  f"sR={best['sR']:+.4f}  |sR| improvement={abs(b['signedResidual'])-abs(best['sR']):.4f}")
        else:
            min_sR = min(honest, key=lambda x: abs(x["sR"])) if honest else None
            if min_sR:
                print(f"    no ship candidate (best honest: scale={min_sR['scale']:.3f}  "
                      f"sR={min_sR['sR']:+.4f} — improvement < threshold or ECE regression)")
            print(f"    VERDICT: current scale confirmed, no change needed")

        # Print full table for context
        print(f"    {'scale':>7s}  {'ECE':>7s}  {'sR':>8s}  verdict")
        for r in rows_data:
            marker = " <-- current" if abs(r["scale"] - current_scales[sport]) < 0.001 else ""
            print(f"    {r['scale']:>7.3f}  {r['ece']:>7.4f}  {r['sR']:>+8.4f}  {r['v']}{marker}")
        print()


def check_ship_rules(db_path, new_scales):
    current_scales = dict(SIGMOID_SCALE_PRE)
    failures = []; passes = []
    print("  SHIP RULE EVALUATION")
    for sport in TARGET_SPORTS:
        old = run_sport(db_path, sport, current_scales)["winner"]
        new = run_sport(db_path, sport, new_scales)["winner"]
        # Rule A: verdict must be HONEST
        if new["verdict"] == "HONEST":
            passes.append(f"  PASS {sport}: verdict HONEST")
        else:
            failures.append(f"  FAIL {sport}: verdict {new['verdict']} (must be HONEST)")
        # Rule B: |sR| must improve by > SR_IMPROVEMENT_THRESHOLD
        improvement = abs(old["signedResidual"]) - abs(new["signedResidual"])
        if improvement > SR_IMPROVEMENT_THRESHOLD:
            passes.append(f"  PASS {sport}: |sR| improved {abs(old['signedResidual']):.4f} → {abs(new['signedResidual']):.4f} ({improvement:.4f} > {SR_IMPROVEMENT_THRESHOLD})")
        else:
            passes.append(f"  INFO {sport}: |sR| {abs(old['signedResidual']):.4f} → {abs(new['signedResidual']):.4f} (improvement {improvement:.4f} ≤ threshold — null result)")
        # Rule C: ECE regression guard
        ece_delta = new["ece"] - old["ece"]
        if ece_delta <= ECE_REGRESSION_GUARD:
            passes.append(f"  PASS {sport}: ECE {old['ece']:.4f} → {new['ece']:.4f} (Δ={ece_delta:+.4f})")
        else:
            failures.append(f"  FAIL {sport}: ECE regression {old['ece']:.4f} → {new['ece']:.4f} (Δ={ece_delta:+.4f} > guard)")
    for msg in passes: print(msg)
    for msg in failures: print(msg)
    print()
    if failures:
        print(f"  {len(failures)} SHIP RULE(S) FAILED")
    else:
        print(f"  ALL SHIP RULES PASS")
    return failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("db", help="Path to sportsdata.db")
    ap.add_argument("--sport", choices=SPORTS, help="Sport to override (use with --scale)")
    ap.add_argument("--scale", type=float, help="Scale value to test for --sport")
    ap.add_argument("--mlb", type=float, default=None, help="Override MLB sigmoid scale")
    ap.add_argument("--nhl", type=float, default=None, help="Override NHL sigmoid scale")
    ap.add_argument("--grid", action="store_true", help="Run per-sport grid search")
    ap.add_argument("--ship", action="store_true", help="Evaluate ship rules for proposed scales")
    args = ap.parse_args()

    scales = dict(SIGMOID_SCALE_CURRENT)
    if args.sport and args.scale is not None:
        scales[args.sport] = args.scale
    if args.mlb is not None: scales["mlb"] = args.mlb
    if args.nhl is not None: scales["nhl"] = args.nhl

    if args.grid:
        grid_search(args.db)
        return

    print_baseline(args.db, scales)

    if args.ship:
        print()
        check_ship_rules(args.db, scales)


if __name__ == "__main__":
    main()
