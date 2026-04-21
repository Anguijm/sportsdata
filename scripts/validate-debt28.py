#!/usr/bin/env python3
"""
validate-debt28.py — Self-contained ship-rule validation for debt #28.

MLS / EPL v5 sigmoid-scale sharpening. Replays the winner-reliability pipeline
in pure Python (no native deps) under overridable SIGMOID_SCALE.{mls,epl}.

Usage:
  # Baseline (reproduce reliability-2026-04-15.txt):
  python3 scripts/validate-debt28.py <db_path>

  # Override scales for grid search / ship candidate:
  python3 scripts/validate-debt28.py <db_path> --mls 0.80 --epl 0.90

  # Grid search (MLS and EPL independently, writes table to stdout):
  python3 scripts/validate-debt28.py <db_path> --grid
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
SIGMOID_SCALE_DEFAULT = {
    "nba": 0.10, "nfl": 0.10, "mlb": 0.30, "nhl": 0.45, "mls": 0.60, "epl": 0.60,
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

PRE = {
    "mls_winner_ece":  0.0429, "mls_winner_sR":  0.0241, "mls_winner_verdict":  "SHY",
    "epl_winner_ece":  0.0502, "epl_winner_sR":  0.0351, "epl_winner_verdict":  "SHY",
    "nba_winner_ece":  0.0156, "nfl_winner_ece": 0.0515,
    "mlb_winner_ece":  0.0152, "nhl_winner_ece": 0.0162,
    "all_margin_verdicts": {
        "nba": "HONEST", "nfl": "HONEST", "mlb": "HONEST",
        "nhl": "HONEST", "mls": "HONEST", "epl": "HONEST",
    },
}


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
    if home_cold: margin -= home_adv * 0.5
    if away_hot:  margin -= home_adv * 0.3
    return max(-clamp, min(clamp, margin))


def get_season_year(sport, date_str):
    # Mirrors src/analysis/season.ts:getSeasonYear — JS months are 0-indexed, Python date[5:7] is 1-indexed.
    year = int(date_str[:4]); month = int(date_str[5:7])  # 1-indexed: Jan=1, Sep=9, Oct=10
    if sport in ("mlb", "mls"):
        return year  # calendar-year sports
    if sport == "nfl":
        return year if month >= 9 else year - 1  # Sept-Dec -> current year
    if sport == "epl":
        return year if month >= 8 else year - 1  # Aug-Dec -> current year
    # nba, nhl
    return year if month >= 10 else year - 1  # Oct-Dec -> current year


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

    scored = [r for r in all_rows if get_season_year(sport, r["date"]) > TRAIN_CUTOFF_SEASON]
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
    for g in scored:
        snap = snapshots.get(g["game_id"])
        if not snap: continue
        home_s, away_s = snap["home"], snap["away"]
        low_conf = home_s["games"] < 5 or away_s["games"] < 5
        pred_prob = predict_v5(sport, home_s, away_s, scales)
        pred_margin = predict_margin(sport, home_s, away_s)
        actual_margin = g["home_score"] - g["away_score"]
        is_draw = g["is_draw"] == 1
        home_win = 1 if (g["home_win"] == 1 and not is_draw) else 0
        results.append({
            "predictedProb": pred_prob, "predictedMargin": pred_margin,
            "actualMargin": actual_margin, "homeWin": home_win,
            "isDraw": is_draw, "lowConfidence": low_conf,
        })
    return results


def compute_margin_reliability(rows, spec):
    width, low, high = spec
    bin_count = round((high - low) / width)
    buckets = [{"pred": [], "actual": []} for _ in range(bin_count)]
    for r in rows:
        idx = max(0, min(bin_count - 1, int((r["predictedMargin"] - low) / width)))
        buckets[idx]["pred"].append(r["predictedMargin"])
        buckets[idx]["actual"].append(r["actualMargin"])
    N = len(rows); populated = 0; mae_sum = 0.0; signed_sum = 0.0
    for b in buckets:
        if not b["pred"]: continue
        populated += 1
        pred_avg = sum(b["pred"]) / len(b["pred"])
        actual_avg = sum(b["actual"]) / len(b["actual"])
        residual = actual_avg - pred_avg
        mae_sum += (len(b["pred"]) / max(1, N)) * abs(residual)
        signed_sum += (len(b["pred"]) / max(1, N)) * residual
    if N < 50: verdict = "INSUFFICIENT"
    elif populated <= 2: verdict = "DISCRETE"
    elif signed_sum > MARGIN_VERDICT_THRESH: verdict = "BIASED_LOW"
    elif signed_sum < -MARGIN_VERDICT_THRESH: verdict = "BIASED_HIGH"
    else: verdict = "HONEST"
    return {"weightedMAE": mae_sum if N > 0 else None,
            "signedResidual": signed_sum if N > 0 else None,
            "populated": populated, "verdict": verdict}


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
    # Brier computed directly over rows (not over bins)
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
    return {"ece": ece_sum if eligible > 0 else None,
            "signedResidual": signed_sum if eligible > 0 else None,
            "populated": populated, "brier": brier,
            "eligible": eligible, "verdict": verdict}


def run_once(db_path, scales):
    out = {}
    for sport in SPORTS:
        games = load_and_replay(db_path, sport, scales)
        out[sport] = {
            "n": len(games),
            "margin": compute_margin_reliability(games, MARGIN_BIN_SPECS[sport]),
            "winner": compute_winner_reliability(games),
        }
    return out


def print_summary(results, scales):
    print(f"  scales: mls={scales['mls']:.2f}  epl={scales['epl']:.2f}")
    for sport in SPORTS:
        r = results[sport]; m = r["margin"]; w = r["winner"]
        print(f"  {sport:>3s}  N={r['n']:>5d}  margin: wMAE={m['weightedMAE']:.4f} sR={m['signedResidual']:+.4f} v={m['verdict']:>12s}  "
              f"winner: ECE={w['ece']:.4f} sR={w['signedResidual']:+.4f} Brier={w['brier']:.4f} v={w['verdict']:>12s}")


def check_ship_rules(results):
    failures = []
    mls_w, epl_w = results["mls"]["winner"], results["epl"]["winner"]
    # Rule 1: MLS ECE decreases
    if mls_w["ece"] < PRE["mls_winner_ece"]:
        print(f"  PASS Rule 1: MLS ECE {PRE['mls_winner_ece']:.4f} → {mls_w['ece']:.4f}")
    else:
        print(f"  FAIL Rule 1: MLS ECE {PRE['mls_winner_ece']:.4f} → {mls_w['ece']:.4f}"); failures.append(1)
    # Rule 2: EPL ECE decreases
    if epl_w["ece"] < PRE["epl_winner_ece"]:
        print(f"  PASS Rule 2: EPL ECE {PRE['epl_winner_ece']:.4f} → {epl_w['ece']:.4f}")
    else:
        print(f"  FAIL Rule 2: EPL ECE {PRE['epl_winner_ece']:.4f} → {epl_w['ece']:.4f}"); failures.append(2)
    # Rule 3: MLS verdict HONEST
    if mls_w["verdict"] == "HONEST":
        print(f"  PASS Rule 3: MLS verdict HONEST")
    else:
        print(f"  FAIL Rule 3: MLS verdict {mls_w['verdict']} (expected HONEST)"); failures.append(3)
    # Rule 4: EPL verdict HONEST
    if epl_w["verdict"] == "HONEST":
        print(f"  PASS Rule 4: EPL verdict HONEST")
    else:
        print(f"  FAIL Rule 4: EPL verdict {epl_w['verdict']} (expected HONEST)"); failures.append(4)
    # Rule 5: Other sports' v5 winner verdicts unchanged (all should be HONEST in baseline)
    other_winner_ok = True
    for sp in ["nba", "nfl", "mlb", "nhl"]:
        if results[sp]["winner"]["verdict"] != "HONEST":
            print(f"  FAIL Rule 5: {sp} winner verdict changed to {results[sp]['winner']['verdict']}"); failures.append(5); other_winner_ok = False
    if other_winner_ok:
        print(f"  PASS Rule 5: NBA/NFL/MLB/NHL winner verdicts all still HONEST")
    # Rule 6: All margin verdicts unchanged (should be trivially true — scale doesn't affect margin)
    margin_ok = True
    for sp, expected in PRE["all_margin_verdicts"].items():
        if results[sp]["margin"]["verdict"] != expected:
            print(f"  FAIL Rule 6: {sp} margin verdict changed: {expected} → {results[sp]['margin']['verdict']}"); failures.append(6); margin_ok = False
    if margin_ok:
        print(f"  PASS Rule 6: all margin verdicts unchanged")
    return failures


def grid_search(db_path):
    candidates = [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 1.10, 1.20]
    print(f"  {'mls scale':>10s}  {'epl scale':>10s}  {'mls_ECE':>8s}  {'mls_sR':>8s}  {'mls_v':>12s}  {'epl_ECE':>8s}  {'epl_sR':>8s}  {'epl_v':>12s}")
    rows = []
    for mls_s in candidates:
        for epl_s in candidates:
            scales = {**SIGMOID_SCALE_DEFAULT, "mls": mls_s, "epl": epl_s}
            r = run_once(db_path, scales)
            m, e = r["mls"]["winner"], r["epl"]["winner"]
            print(f"  {mls_s:>10.2f}  {epl_s:>10.2f}  {m['ece']:>8.4f}  {m['signedResidual']:>+8.4f}  {m['verdict']:>12s}  {e['ece']:>8.4f}  {e['signedResidual']:>+8.4f}  {e['verdict']:>12s}")
            rows.append({"mls_scale": mls_s, "epl_scale": epl_s,
                         "mls_ece": m["ece"], "mls_sR": m["signedResidual"], "mls_v": m["verdict"],
                         "epl_ece": e["ece"], "epl_sR": e["signedResidual"], "epl_v": e["verdict"]})
    # Find per-league best (min |signedResid| among HONEST-verdict candidates with ECE decrease)
    mls_candidates = [r for r in rows if r["mls_v"] == "HONEST" and r["mls_ece"] < PRE["mls_winner_ece"]]
    epl_candidates = [r for r in rows if r["epl_v"] == "HONEST" and r["epl_ece"] < PRE["epl_winner_ece"]]
    # Dedupe by scale value (grid search is 2D but each league is 1D)
    mls_by_scale = {}
    for r in mls_candidates:
        mls_by_scale.setdefault(r["mls_scale"], r)
    epl_by_scale = {}
    for r in epl_candidates:
        epl_by_scale.setdefault(r["epl_scale"], r)
    print()
    print(f"  MLS HONEST+ECE-decrease candidates (min |sR| first):")
    for r in sorted(mls_by_scale.values(), key=lambda x: abs(x["mls_sR"])):
        print(f"    mls={r['mls_scale']:.2f}  ECE={r['mls_ece']:.4f}  sR={r['mls_sR']:+.4f}")
    print(f"  EPL HONEST+ECE-decrease candidates (min |sR| first):")
    for r in sorted(epl_by_scale.values(), key=lambda x: abs(x["epl_sR"])):
        print(f"    epl={r['epl_scale']:.2f}  ECE={r['epl_ece']:.4f}  sR={r['epl_sR']:+.4f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("db", help="Path to sportsdata.db")
    ap.add_argument("--mls", type=float, default=None, help="Override MLS sigmoid scale")
    ap.add_argument("--epl", type=float, default=None, help="Override EPL sigmoid scale")
    ap.add_argument("--grid", action="store_true", help="Run grid search over candidate scales")
    ap.add_argument("--ship", action="store_true", help="Evaluate ship rules against PRE baseline")
    args = ap.parse_args()

    if args.grid:
        grid_search(args.db)
        return

    scales = dict(SIGMOID_SCALE_DEFAULT)
    if args.mls is not None: scales["mls"] = args.mls
    if args.epl is not None: scales["epl"] = args.epl

    results = run_once(args.db, scales)
    print_summary(results, scales)

    if args.ship:
        print()
        print("SHIP RULE CHECKS")
        failures = check_ship_rules(results)
        print()
        if not failures:
            print("ALL 6 SHIP RULES PASS")
        else:
            print(f"{len(failures)} SHIP RULE(S) FAILED: {failures}")


if __name__ == "__main__":
    main()
