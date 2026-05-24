-- Phase 7 addendum v20 A3: NULL the anomalous DET team_tov=-14 row in
-- nba:bdl-857816 (DET vs UTAH, 2022-12-20). Negative TOV is impossible;
-- ESPN's response had a malformed value. NULL is the canonical missing-
-- value sentinel; Phase 7 feature pipeline handles NULL natively.
--
-- Idempotent: WHERE clause checks current value, so re-runs are no-ops.
-- Affected rows: 1.
--
-- Run:
--   sqlite3 data/sqlite/sportsdata.db < scripts/migrate-fix-anomalous-team-tov.sql

UPDATE nba_game_box_stats
SET team_tov = NULL
WHERE game_id = 'nba:bdl-857816'
  AND team_id = 'nba:DET'
  AND team_tov = -14;
