/**
 * Regression test for the debt #1 canonical_game_id schema migration.
 *
 * Verifies that `getDb()` populates `games.canonical_id` correctly across
 * the production DB's two scraper namespaces:
 *
 *   - BDL  format: `nba:bdl-1037593`, season='2023-regular'
 *   - ESPN format: `nba:401591869`,    season='2023-24'
 *
 * Same physical games appear in both namespaces. Migration must:
 *   1. Add `canonical_id` column to games (idempotent)
 *   2. Populate canonical_id for every row using the natural key
 *      `<sport>:nk:<YYYY-MM-DD>:<home_short>:<away_short>`
 *   3. Produce IDENTICAL canonical_id for cross-namespace duplicate pairs
 *   4. Create an index for downstream DISTINCT/GROUP BY queries
 *
 * Run:
 *   npx tsx scripts/test-canonical-game-id-migration.ts [path-to-test.db]
 *
 * Default test DB is a temp file populated with a synthetic 6-row fixture
 * that exercises (a) BDL-only NBA game, (b) ESPN-only NBA game,
 * (c) cross-namespace NBA pair, (d) MLB game (single-namespace control),
 * (e) NHL game (single-namespace control).
 *
 * Optionally accepts a path to a real production snapshot for full-scale
 * verification (run AFTER the temp-DB scenarios pass).
 *
 * Non-zero exit on assertion failure.
 */

import Database from 'better-sqlite3';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = join(tmpdir(), `canonical-id-test-${process.pid}-${Date.now()}`);
mkdirSync(tmpDir, { recursive: true });
const tmpDb = process.argv[2] || join(tmpDir, 'test.db');

// Only point SQLITE_PATH at the temp file when we're generating it. If the
// caller passed a real snapshot path, we copy it to a side path so we don't
// mutate their original.
let dbPath = tmpDb;
if (process.argv[2]) {
  const sidePath = join(tmpDir, 'test-mutated.db');
  writeFileSync(sidePath, readFileSync(process.argv[2]));
  dbPath = sidePath;
}
process.env.SQLITE_PATH = dbPath;

let failures = 0;
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
    failures++;
  } else {
    console.log(`PASS: ${label}`);
  }
}

// ── Synthetic 6-row fixture for the temp-DB case ───────────────────────────

if (!process.argv[2]) {
  const raw = new Database(dbPath);
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
  `);
  const ins = raw.prepare(`INSERT INTO games (id, sport, season, date, home_team_id, away_team_id, status, provenance_json) VALUES (?,?,?,?,?,?,?,'{}')`);
  // Cross-namespace NBA pair (same date, same teams, different scrapers)
  ins.run('nba:bdl-1037593', 'nba', '2023-regular', '2023-10-24',          'nba:DEN', 'nba:LAL', 'final');
  ins.run('nba:401591869',   'nba', '2023-24',      '2023-10-24T02:30Z',    'nba:DEN', 'nba:LAL', 'final');
  // BDL-only NBA game (a Phase 7 backfilled 2022 game)
  ins.run('nba:bdl-857355',  'nba', '2022-regular', '2022-10-18',          'nba:BOS', 'nba:PHI', 'final');
  // ESPN-only NBA game (a 2024 game from the ESPN scraper namespace)
  ins.run('nba:401591870',   'nba', '2023-24',      '2023-10-25T00:00Z',    'nba:GS',  'nba:PHX', 'final');
  // MLB control (single-namespace)
  ins.run('mlb:401570001',   'mlb', '2024',         '2024-04-01T18:00Z',    'mlb:LAD', 'mlb:SF',  'final');
  // NHL control (single-namespace)
  ins.run('nhl:401599999',   'nhl', '2024',         '2024-10-15T23:00Z',    'nhl:BOS', 'nhl:NYR', 'final');
  raw.close();
}

// ── Apply migration via getDb() ────────────────────────────────────────────

const { getDb, closeDb } = await import('../src/storage/sqlite.js');
const db = getDb();

// ── Assertions ─────────────────────────────────────────────────────────────

// 1. Column exists
const cols = db.pragma('table_info(games)') as Array<{ name: string }>;
assertEq(cols.some(c => c.name === 'canonical_id'), true, 'canonical_id column exists on games');

// 2. Every row has non-null canonical_id
const nullCount = (db.prepare('SELECT COUNT(*) AS n FROM games WHERE canonical_id IS NULL').get() as { n: number }).n;
assertEq(nullCount, 0, 'every games row has canonical_id populated');

// 3. Index exists
const indexes = (db.pragma('index_list(games)') as Array<{ name: string }>).map(r => r.name);
assertEq(indexes.includes('idx_games_canonical_id'), true, 'idx_games_canonical_id index exists');

if (!process.argv[2]) {
  // Synthetic fixture: precise assertions
  const bdlRow = db.prepare(`SELECT canonical_id FROM games WHERE id='nba:bdl-1037593'`).get() as { canonical_id: string };
  const espnRow = db.prepare(`SELECT canonical_id FROM games WHERE id='nba:401591869'`).get() as { canonical_id: string };
  assertEq(bdlRow.canonical_id, 'nba:nk:2023-10-24:DEN:LAL', 'BDL row canonical_id derived correctly from natural key');
  assertEq(espnRow.canonical_id, 'nba:nk:2023-10-24:DEN:LAL', 'ESPN row canonical_id derived correctly from natural key');
  assertEq(bdlRow.canonical_id, espnRow.canonical_id, 'cross-namespace pair shares the SAME canonical_id (DEDUP WORKS)');

  // Single-namespace rows
  const bdlOnly = db.prepare(`SELECT canonical_id FROM games WHERE id='nba:bdl-857355'`).get() as { canonical_id: string };
  assertEq(bdlOnly.canonical_id, 'nba:nk:2022-10-18:BOS:PHI', 'BDL-only NBA game gets canonical_id');
  const espnOnly = db.prepare(`SELECT canonical_id FROM games WHERE id='nba:401591870'`).get() as { canonical_id: string };
  assertEq(espnOnly.canonical_id, 'nba:nk:2023-10-25:GS:PHX', 'ESPN-only NBA game gets canonical_id (date truncated)');

  // MLB / NHL controls
  const mlbRow = db.prepare(`SELECT canonical_id FROM games WHERE id='mlb:401570001'`).get() as { canonical_id: string };
  assertEq(mlbRow.canonical_id, 'mlb:nk:2024-04-01:LAD:SF', 'MLB control row canonical_id');
  const nhlRow = db.prepare(`SELECT canonical_id FROM games WHERE id='nhl:401599999'`).get() as { canonical_id: string };
  assertEq(nhlRow.canonical_id, 'nhl:nk:2024-10-15:BOS:NYR', 'NHL control row canonical_id');

  // 4. Distinct count reflects expected dedup: 6 rows, 1 cross-namespace pair → 5 distinct canonical_ids
  const distinctCount = (db.prepare('SELECT COUNT(DISTINCT canonical_id) AS n FROM games').get() as { n: number }).n;
  assertEq(distinctCount, 5, '6 rows → 5 distinct canonical_id (one cross-namespace pair collapses)');

  // 5. Idempotent: re-running migration should NOT change anything.
  closeDb();
  const db2 = getDb();
  const reDistinct = (db2.prepare('SELECT COUNT(DISTINCT canonical_id) AS n FROM games').get() as { n: number }).n;
  assertEq(reDistinct, 5, 're-running migration: distinct count unchanged (idempotent)');
  closeDb();
} else {
  // Real prod snapshot: report aggregate dedup result, don't hardcode counts.
  const totalRows = (db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n;
  const distinctCount = (db.prepare('SELECT COUNT(DISTINCT canonical_id) AS n FROM games').get() as { n: number }).n;
  const nbaRows = (db.prepare(`SELECT COUNT(*) AS n FROM games WHERE sport='nba'`).get() as { n: number }).n;
  const nbaDistinct = (db.prepare(`SELECT COUNT(DISTINCT canonical_id) AS n FROM games WHERE sport='nba'`).get() as { n: number }).n;
  console.log(`\n--- production snapshot stats ---`);
  console.log(`total rows:  ${totalRows}, distinct canonical_id: ${distinctCount}, dedup: ${totalRows - distinctCount}`);
  console.log(`NBA rows:    ${nbaRows}, distinct canonical_id: ${nbaDistinct}, dedup: ${nbaRows - nbaDistinct}`);

  // Spot-check at least one cross-namespace NBA pair
  const dual = db.prepare(`
    SELECT g1.id AS id1, g1.canonical_id AS c1, g2.id AS id2, g2.canonical_id AS c2
    FROM games g1 JOIN games g2 ON
      g1.sport=g2.sport AND
      substr(g1.date,1,10)=substr(g2.date,1,10) AND
      g1.home_team_id=g2.home_team_id AND
      g1.away_team_id=g2.away_team_id
    WHERE g1.sport='nba' AND g1.id LIKE 'nba:bdl-%' AND g2.id NOT LIKE 'nba:bdl-%'
    LIMIT 3
  `).all() as Array<{ id1: string; c1: string; id2: string; c2: string }>;
  for (const r of dual) {
    assertEq(r.c1, r.c2, `cross-namespace pair (${r.id1.slice(0,16)} ↔ ${r.id2.slice(0,16)}): canonical_ids match`);
  }

  closeDb();
}

// Cleanup temp dir + side-mutated DB
if (!process.argv[2]) {
  rmSync(tmpDir, { recursive: true, force: true });
} else {
  rmSync(dbPath, { force: true }); // remove the side-mutated copy, leave original
  rmSync(tmpDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log(`\nAll assertions passed`);
