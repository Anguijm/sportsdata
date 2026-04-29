#!/usr/bin/env python3
"""
validate-debt22.py — Empirical calibration of v4-spread streak adjustment coefficients.

Replays historical game results to identify games where:
  (A) home team had a cold streak (lost last 3+)
  (B) away team had a hot streak (won last 3+)

Measures actual margin differential in those games vs non-streak games.
Reports whether current coefficients (home_cold: 0.5, away_hot: 0.3) are
within ±0.15 of the empirical values.

Run: python3 scripts/validate-debt22.py [path-to-sportsdata.db]
"""

import sqlite3, sys, json, math
from collections import defaultdict

DB_PATH = sys.argv[1] if len(sys.argv) > 1 else "data/sportsdata.db"

# Current v4-spread streak coefficients (fraction of homeAdv to subtract)
CURRENT_HOME_COLD_COEF = 0.5
CURRENT_AWAY_HOT_COEF  = 0.3

SPORT_HOME_ADVANTAGE = {
    "nba": 2.25, "nfl": 2.5, "mlb": 0.5,
    "nhl": 0.3, "mls": 0.4, "epl": 0.4,
}
SPORT_HOME_WIN_RATE = {
    "nba": 0.57, "nfl": 0.57, "mlb": 0.54,
    "nhl": 0.55, "mls": 0.49, "epl": 0.46,
}

def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x))

# ── Load games ──

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

rows = conn.execute("""
    SELECT gr.game_id, gr.sport, gr.date, gr.home_score, gr.away_score,
           gr.home_win, gr.margin, g.home_team_id, g.away_team_id,
           COALESCE(g.season, 0) as season
    FROM game_results gr
    JOIN games g ON gr.game_id = g.id
    WHERE gr.sport IN ('nba','nfl','mlb','nhl')
      AND gr.margin IS NOT NULL
      AND gr.home_win IN (0, 1)
    ORDER BY gr.date, gr.game_id
""").fetchall()

print(f"Loaded {len(rows)} scored games across NBA/NFL/MLB/NHL.\n")

# ── Replay team states ──

# team_state: last_n_results (list of bool)
team_last = defaultdict(list)  # teamId → [bool, ...] (True=win)

# Per-sport: collect (actual_margin, base_margin_pred, cold_home, hot_away)
# base_margin_pred = (homeDiff - awayDiff) + homeAdv (NO streak adjustment)
# team_games: games played so far this season
team_games = defaultdict(int)  # (sport, teamId) → games count
team_pts_for = defaultdict(float)
team_pts_against = defaultdict(float)

results_by_sport = defaultdict(list)  # sport → list of (actual_margin, base_pred, cold_home, hot_away)

for r in rows:
    sport = r['sport']
    home_id = r['home_team_id']
    away_id = r['away_team_id']

    hk = (sport, home_id)
    ak = (sport, away_id)

    hg = team_games[hk]
    ag = team_games[ak]

    if hg >= 5 and ag >= 5:
        # Compute base prediction (no streak)
        home_diff = team_pts_for[hk] / hg - team_pts_against[hk] / hg
        away_diff = team_pts_for[ak] / ag - team_pts_against[ak] / ag
        home_adv = SPORT_HOME_ADVANTAGE[sport]

        base_margin = (home_diff - away_diff) + home_adv

        # Streak flags (same logic as predictMargin in predict.ts)
        h_last = team_last[home_id]
        a_last = team_last[away_id]

        cold_home = len(h_last) >= 3 and all(not x for x in h_last[-3:])
        hot_away  = len(a_last) >= 3 and all(x for x in a_last[-3:])

        actual_margin = float(r['home_score'] - r['away_score'])
        results_by_sport[sport].append((actual_margin, base_margin, cold_home, hot_away))

    # Update state
    home_won = bool(r['home_win'])
    team_games[hk] += 1
    team_games[ak] += 1
    team_pts_for[hk]  += r['home_score']
    team_pts_against[hk] += r['away_score']
    team_pts_for[ak]  += r['away_score']
    team_pts_against[ak] += r['home_score']

    team_last[home_id] = (team_last[home_id] + [home_won])[-5:]
    team_last[away_id] = (team_last[away_id] + [not home_won])[-5:]

# ── Analysis ──

print(f"{'Sport':6} {'N_all':>6} {'N_cold':>7} {'N_hot':>6} {'base_err':>10} {'cold_err':>10} {'hot_err':>10} {'cold_coef':>10} {'hot_coef':>10}")
print("-" * 89)

any_warn = False
for sport in ['nba', 'nfl', 'mlb', 'nhl']:
    data = results_by_sport[sport]
    if not data:
        continue

    home_adv = SPORT_HOME_ADVANTAGE[sport]

    residuals_all   = [a - b for (a, b, c, h) in data]
    residuals_cold  = [a - b for (a, b, c, h) in data if c]       # cold home, no hot away
    residuals_hot   = [a - b for (a, b, c, h) in data if h and not c]  # hot away, no cold home

    base_err  = sum(residuals_all) / len(residuals_all) if residuals_all else 0.0
    cold_err  = sum(residuals_cold) / len(residuals_cold) if residuals_cold else float('nan')
    hot_err   = sum(residuals_hot)  / len(residuals_hot)  if residuals_hot  else float('nan')

    # cold_coef: how many fractions of homeAdv to subtract for cold home
    # We expect: cold_err = base_err - homeAdv * cold_coef  (cold should lower actual margin)
    # cold_coef = (base_err - cold_err) / homeAdv
    cold_coef = (base_err - cold_err) / home_adv if residuals_cold and home_adv > 0 else float('nan')
    hot_coef  = (base_err - hot_err)  / home_adv if residuals_hot  and home_adv > 0 else float('nan')

    n_all  = len(data)
    n_cold = len(residuals_cold)
    n_hot  = len(residuals_hot)

    print(f"{sport:6} {n_all:>6} {n_cold:>7} {n_hot:>6} {base_err:>+10.3f} {cold_err:>+10.3f} {hot_err:>+10.3f} {cold_coef:>10.3f} {hot_coef:>10.3f}")

    TOLERANCE = 0.15
    if not math.isnan(cold_coef) and n_cold >= 10:
        diff = abs(cold_coef - CURRENT_HOME_COLD_COEF)
        if diff > TOLERANCE:
            print(f"  ⚠  {sport} cold_coef empirical={cold_coef:.3f} vs current={CURRENT_HOME_COLD_COEF} → diff={diff:.3f} > {TOLERANCE} — RECALIBRATE")
            any_warn = True
        else:
            print(f"  ✓  {sport} cold_coef within tolerance (empirical={cold_coef:.3f}, current={CURRENT_HOME_COLD_COEF}, diff={diff:.3f})")
    else:
        print(f"  —  {sport} cold_coef: n={n_cold} < 10, insufficient data")

    if not math.isnan(hot_coef) and n_hot >= 10:
        diff = abs(hot_coef - CURRENT_AWAY_HOT_COEF)
        if diff > TOLERANCE:
            print(f"  ⚠  {sport} hot_coef  empirical={hot_coef:.3f} vs current={CURRENT_AWAY_HOT_COEF} → diff={diff:.3f} > {TOLERANCE} — RECALIBRATE")
            any_warn = True
        else:
            print(f"  ✓  {sport} hot_coef  within tolerance (empirical={hot_coef:.3f}, current={CURRENT_AWAY_HOT_COEF}, diff={diff:.3f})")
    else:
        print(f"  —  {sport} hot_coef:  n={n_hot} < 10, insufficient data")

print()
if any_warn:
    print("RESULT: Recalibration recommended for flagged sports.")
else:
    print("RESULT: All tested coefficients within ±0.15 tolerance of empirical values.")
