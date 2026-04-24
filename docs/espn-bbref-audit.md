# ESPN ↔ basketball-reference audit

Run timestamp: 2026-04-24T23:14:56.451Z
Ground-truth file: `data/espn-bbref-audit-truth.json`
Sample size N: 0

## No ground-truth entries

Pass-A1 status: script mechanics committed, ground-truth file is empty.

To populate Pass-A2 (5 seed entries):
1. Visit a basketball-reference box score (e.g. https://www.basketball-reference.com/boxscores/202412170OKC.html for the 2024-25 NBA Cup final).
2. Copy team-level raw counts (FGM/FGA/3PM/3PA/FTM/FTA/ORB/DRB/TRB/AST/STL/BLK/TOV/PF/PTS) for both teams.
3. Copy "Four Factors" rates (eFG%, TOV%, ORtg, Pace) for both teams.
4. Append to `data/espn-bbref-audit-truth.json` as a JSON object matching the GroundTruthEntry shape (see scripts/audit-espn-box-stats.ts).
5. Re-run this script.

Per addendum v7 §10 + addendum v8: Pass-A2 is informational; Pass-B (N=50) is the ship-claim blocker.
