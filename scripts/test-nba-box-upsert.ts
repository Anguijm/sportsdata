/**
 * Integration check for upsertNbaBoxStats + recordScrapeWarnings.
 *
 * Uses a temp SQLite DB (via SQLITE_PATH env var set before importing
 * the module). Three scenarios:
 *   1. Fresh insert → status='inserted', no audit row
 *   2. Repeat identical row → status='unchanged', no mutation
 *   3. One MUST-HAVE field changed → status='updated', audit row written
 *      for that field, updated_at bumped, first_scraped_at preserved
 *
 * Run:
 *   npx tsx scripts/test-nba-box-upsert.ts
 *
 * Non-zero exit on assertion failure.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Point the DB at a fresh temp file BEFORE importing sqlite.ts
const tmpDir = join(tmpdir(), `sportsdata-test-${process.pid}-${Date.now()}`);
mkdirSync(tmpDir, { recursive: true });
const tmpDb = join(tmpDir, 'test.db');
process.env.SQLITE_PATH = tmpDb;

// Imports deferred so env var is honored
const { getDb, closeDb, upsertNbaBoxStats, recordScrapeWarnings, getNbaBoxStatsCount } = await import('../src/storage/sqlite.js');
const { validateNbaBoxScore } = await import('../src/scrapers/espn-box-schema.js');

const __dirname = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function assertEq<T>(actual: T, expected: T, label: string): void {
  const aStr = JSON.stringify(actual);
  const eStr = JSON.stringify(expected);
  if (aStr !== eStr) {
    console.error(`FAIL ${label}: expected ${eStr}, got ${aStr}`);
    failures++;
  } else {
    console.log(`PASS ${label}: ${eStr}`);
  }
}
function assertTrue(cond: boolean, label: string): void {
  if (!cond) {
    console.error(`FAIL ${label}`);
    failures++;
  } else {
    console.log(`PASS ${label}`);
  }
}

function cleanup(): void {
  try {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function main(): Promise<void> {
  const fixturePath = join(__dirname, '../src/scrapers/__tests__/fixtures/espn-nba-box-401811002.json');
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));

  const t0 = '2026-04-24T12:00:00Z';
  const validated = validateNbaBoxScore(raw, 'nba:401811002', 'nba:DEN', 'nba:POR', '2025-26', t0);
  if (!validated.ok) {
    console.error('Fixture failed validator:', validated.reason);
    cleanup();
    process.exit(1);
  }
  const { home, away } = validated.data;

  const db = getDb(); // triggers initTables, including nba_game_box_stats

  console.log('## Scenario 1: fresh insert (both teams)');
  const r1h = upsertNbaBoxStats(home, t0);
  const r1a = upsertNbaBoxStats(away, t0);
  assertEq(r1h.status, 'inserted', 'home: first upsert → inserted');
  assertEq(r1h.mutations, 0, 'home: first upsert → no mutations logged');
  assertEq(r1a.status, 'inserted', 'away: first upsert → inserted');
  assertEq(getNbaBoxStatsCount(), 2, 'row count after first inserts');
  const auditCountAfter1 = (db.prepare('SELECT COUNT(*) as c FROM nba_box_stats_audit').get() as { c: number }).c;
  assertEq(auditCountAfter1, 0, 'audit table empty after fresh inserts');
  console.log();

  console.log('## Scenario 2: repeat identical row (simulated recheck cron with no ESPN change)');
  const t1 = '2026-04-25T12:00:00Z';
  const r2h = upsertNbaBoxStats(home, t1);
  assertEq(r2h.status, 'unchanged', 'home: repeat identical → unchanged');
  assertEq(r2h.mutations, 0, 'home: repeat identical → no mutations');
  const updatedAtAfter2 = (db.prepare('SELECT updated_at FROM nba_game_box_stats WHERE team_id=?').get('nba:DEN') as { updated_at: string }).updated_at;
  assertEq(updatedAtAfter2, t0, 'updated_at NOT bumped on no-op upsert (still t0)');
  const auditCountAfter2 = (db.prepare('SELECT COUNT(*) as c FROM nba_box_stats_audit').get() as { c: number }).c;
  assertEq(auditCountAfter2, 0, 'audit still empty after unchanged upsert');
  console.log();

  console.log('## Scenario 3: ESPN retroactive correction (simulated) — 2 fields changed');
  const t2 = '2026-04-26T12:00:00Z';
  // Simulate ESPN correcting DEN's fgm 52→53 and ast 37→38
  const homeCorrected = { ...home, fgm: home.fgm + 1, ast: home.ast + 1 };
  const r3h = upsertNbaBoxStats(homeCorrected, t2);
  assertEq(r3h.status, 'updated', 'home: corrected → updated');
  assertEq(r3h.mutations, 2, 'home: 2 MUST-HAVE fields mutated → 2 audit rows');

  const denRow = db.prepare('SELECT * FROM nba_game_box_stats WHERE team_id=?').get('nba:DEN') as {
    first_scraped_at: string; updated_at: string; fgm: number; ast: number;
  };
  assertEq(denRow.fgm, home.fgm + 1, 'DEN fgm updated');
  assertEq(denRow.ast, home.ast + 1, 'DEN ast updated');
  assertEq(denRow.updated_at, t2, 'DEN updated_at bumped to t2');
  assertEq(denRow.first_scraped_at, t0, 'DEN first_scraped_at PRESERVED at t0');

  const auditRows = db.prepare('SELECT * FROM nba_box_stats_audit WHERE team_id=? ORDER BY field').all('nba:DEN') as Array<{
    field: string; old_value: string; new_value: string; changed_at: string;
  }>;
  assertEq(auditRows.length, 2, 'DEN audit rows written (2)');
  assertEq(auditRows[0].field, 'ast', 'audit row 1: field=ast');
  assertEq(auditRows[0].old_value, String(home.ast), 'audit row 1: old_value');
  assertEq(auditRows[0].new_value, String(home.ast + 1), 'audit row 1: new_value');
  assertEq(auditRows[0].changed_at, t2, 'audit row 1: changed_at');
  assertEq(auditRows[1].field, 'fgm', 'audit row 2: field=fgm');

  // POR untouched
  const porRow = db.prepare('SELECT * FROM nba_game_box_stats WHERE team_id=?').get('nba:POR') as { updated_at: string };
  assertEq(porRow.updated_at, t0, 'POR updated_at unchanged (still t0)');
  console.log();

  console.log('## Scenario 4: NICE-TO-HAVE-only change bumps updated_at but writes NO audit row');
  // Policy set in Phase 2 impl-review (Stats expert recommendation): NICE
  // mutations invalidate Phase-3 feature caches via updated_at, but audit
  // table is reserved for MUST-HAVE mutations only (load-bearing for
  // coverage-gate semantics).
  const t3 = '2026-04-27T12:00:00Z';
  const awayLargestLead = { ...away, largest_lead: (away.largest_lead ?? 0) + 5 };
  const r4a = upsertNbaBoxStats(awayLargestLead, t3);
  assertEq(r4a.status, 'updated', 'POR: NICE-TO-HAVE-only change → updated');
  assertEq(r4a.mutations, 0, 'POR: no MUST-HAVE mutations → mutations=0');
  const porRow2 = db.prepare('SELECT updated_at, largest_lead FROM nba_game_box_stats WHERE team_id=?').get('nba:POR') as { updated_at: string; largest_lead: number | null };
  assertEq(porRow2.updated_at, t3, 'POR updated_at BUMPED to t3 (NICE-TO-HAVE change invalidates cache)');
  assertEq(porRow2.largest_lead, (away.largest_lead ?? 0) + 5, 'POR largest_lead persisted');
  const auditAfter4 = (db.prepare('SELECT COUNT(*) as c FROM nba_box_stats_audit WHERE team_id=?').get('nba:POR') as { c: number }).c;
  assertEq(auditAfter4, 0, 'POR audit table STILL empty (NICE-TO-HAVE change does not audit)');
  console.log();

  console.log('## Scenario 5: recordScrapeWarnings batch insert');
  const warnCount = recordScrapeWarnings([
    { sport: 'nba', source: 'espn-box-stats', game_id: 'nba:401811002', warning_type: 'unknown_field', detail: 'test-unknown-field', scraped_at: t0 },
    { sport: 'nba', source: 'espn-box-stats', game_id: null, warning_type: 'schema_error', detail: 'test-schema-err', scraped_at: t0 },
  ]);
  assertEq(warnCount, 2, 'recordScrapeWarnings returns inserted count');
  const warnTotal = (db.prepare('SELECT COUNT(*) as c FROM scrape_warnings').get() as { c: number }).c;
  assertEq(warnTotal, 2, 'scrape_warnings table has 2 rows');

  console.log();
  if (failures === 0) {
    console.log(`✓ All upsert + audit + warning assertions passed`);
    cleanup();
    process.exit(0);
  } else {
    console.error(`✗ ${failures} assertion(s) failed`);
    cleanup();
    process.exit(1);
  }
}

await main();
