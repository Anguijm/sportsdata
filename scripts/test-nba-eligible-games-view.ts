/**
 * Integration test for the nba_eligible_games view migration introduced
 * by Phase 7 addendum v19 (widen whitelist to include 2021-regular +
 * 2022-regular).
 *
 * Three scenarios on a fresh temp SQLite DB:
 *   1. Fresh-install view definition includes 2021-regular + 2022-regular
 *      seasons; postseason 2021/2022 NOT included (Phase 7 regular-only).
 *   2. Games table populated across 2021–2025 → view surfaces 2021/2022
 *      regular + 2023/2024/2025 reg+postseason, but NOT 2021/2022 postseason.
 *   3. Migration path: pre-create view with OLD 6-season whitelist; call
 *      getDb() again; verify view definition auto-updates to include
 *      2021/2022 regular seasons (idempotent re-recreate).
 *
 * Run:
 *   npx tsx scripts/test-nba-eligible-games-view.ts
 *
 * Non-zero exit on assertion failure.
 */

import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = join(tmpdir(), `sportsdata-view-test-${process.pid}-${Date.now()}`);
mkdirSync(tmpDir, { recursive: true });
const tmpDb = join(tmpDir, 'test.db');
process.env.SQLITE_PATH = tmpDb;

const { getDb, closeDb } = await import('../src/storage/sqlite.js');

let failures = 0;
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
    failures++;
  } else {
    console.log(`PASS: ${label}`);
  }
}

function seedGames(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT INTO games (id, sport, season, status, date, home_team_id, away_team_id, provenance_json)
    VALUES (?, 'nba', ?, 'final', ?, 'TEAM-A', 'TEAM-B', '{}')
  `);
  const rows: Array<[string, string, string]> = [
    ['nba:test-2021reg-1',  '2021-regular',     '2021-11-01'],
    ['nba:test-2021post-1', '2021-postseason',  '2022-05-15'],
    ['nba:test-2022reg-1',  '2022-regular',     '2022-11-01'],
    ['nba:test-2022post-1', '2022-postseason',  '2023-05-15'],
    ['nba:test-2023reg-1',  '2023-regular',     '2023-11-01'],
    ['nba:test-2023post-1', '2023-postseason',  '2024-05-15'],
    ['nba:test-2024reg-1',  '2024-regular',     '2024-11-01'],
    ['nba:test-2024post-1', '2024-postseason',  '2025-05-15'],
    ['nba:test-2025reg-1',  '2025-regular',     '2025-11-01'],
    ['nba:test-2025post-1', '2025-postseason',  '2026-05-15'],
  ];
  for (const [id, season, date] of rows) {
    insert.run(id, season, date);
  }
}

// Scenario 1 + 2: fresh-install view definition + content
{
  const db = getDb();
  seedGames(db);

  const viewSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='nba_eligible_games'").get() as { sql: string };
  assertEq(viewSql.sql.includes("'2021-regular'"), true,  "fresh-install view whitelist includes 2021-regular");
  assertEq(viewSql.sql.includes("'2022-regular'"), true,  "fresh-install view whitelist includes 2022-regular");
  assertEq(viewSql.sql.includes("'2021-postseason'"), false, "fresh-install view whitelist EXCLUDES 2021-postseason");
  assertEq(viewSql.sql.includes("'2022-postseason'"), false, "fresh-install view whitelist EXCLUDES 2022-postseason");

  const seasons = (db.prepare('SELECT DISTINCT season FROM nba_eligible_games ORDER BY season').all() as Array<{ season: string }>).map(r => r.season);
  assertEq(seasons, [
    '2021-regular',
    '2022-regular',
    '2023-postseason',
    '2023-regular',
    '2024-postseason',
    '2024-regular',
    '2025-postseason',
    '2025-regular',
  ], "view surfaces 2021/2022 regular + 2023/2024/2025 reg+post (postseason 2021/2022 excluded)");

  closeDb();
}

// Scenario 3: migration from OLD view to new whitelist
{
  // Pre-create the view with the OLD 6-season whitelist on a freshly-reset DB.
  // We do this by manually executing CREATE VIEW with the old SQL, then calling
  // getDb() which should detect the missing '2021-regular' signal and re-recreate.
  rmSync(tmpDb, { force: true });

  // Open with raw better-sqlite3, create only the games table + the OLD view def
  // (matches games schema in src/storage/sqlite.ts), then let getDb() migrate.
  const raw = new Database(tmpDb);
  raw.exec(`
    CREATE TABLE games (
      id TEXT PRIMARY KEY,
      sport TEXT NOT NULL,
      season TEXT NOT NULL,
      date TEXT NOT NULL,
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      venue TEXT,
      status TEXT NOT NULL,
      score_json TEXT,
      odds_json TEXT,
      weather_json TEXT,
      provenance_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE nba_neutral_site_games (game_id TEXT PRIMARY KEY);
    CREATE VIEW nba_eligible_games AS
      SELECT
        g.id AS game_id, g.season, g.home_team_id, g.away_team_id, g.date,
        (nsgs.game_id IS NOT NULL) AS neutral_site
      FROM games g
      LEFT JOIN nba_neutral_site_games nsgs ON nsgs.game_id = g.id
      WHERE g.sport = 'nba'
        AND g.status = 'final'
        AND g.season IN ('2023-regular', '2023-postseason',
                         '2024-regular', '2024-postseason',
                         '2025-regular', '2025-postseason');
  `);
  raw.close();

  const oldSqlBefore = (new Database(tmpDb).prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='nba_eligible_games'").get() as { sql: string }).sql;
  assertEq(oldSqlBefore.includes("'2021-regular'"), false, "pre-migration view does NOT include 2021-regular");

  // Now call getDb() — migration should detect the gap and re-recreate the view.
  const db = getDb();

  const newSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='nba_eligible_games'").get() as { sql: string }).sql;
  assertEq(newSql.includes("'2021-regular'"), true, "post-migration view INCLUDES 2021-regular");
  assertEq(newSql.includes("'2022-regular'"), true, "post-migration view INCLUDES 2022-regular");
  assertEq(newSql.includes('neutral_site'),   true, "post-migration view preserves neutral_site column");

  seedGames(db);
  const seasons = (db.prepare('SELECT DISTINCT season FROM nba_eligible_games ORDER BY season').all() as Array<{ season: string }>).map(r => r.season);
  assertEq(seasons, [
    '2021-regular',
    '2022-regular',
    '2023-postseason',
    '2023-regular',
    '2024-postseason',
    '2024-regular',
    '2025-postseason',
    '2025-regular',
  ], "post-migration view returns 2021/2022 regular (full whitelist active)");

  closeDb();
}

// Cleanup
rmSync(tmpDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log(`\nAll assertions passed`);
