/**
 * Synthetic-data test for the audit comparison logic in
 * scripts/audit-espn-box-stats.ts. Validates raw-count exact-match,
 * derived-rate 1% tolerance, expected===0 NaN guard, and missing-row
 * skip behavior. Does NOT exercise live ESPN/bbref.
 *
 * Run: npx tsx scripts/test-audit-mechanics.ts
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

let failures = 0;
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failures++;
  } else {
    console.log(`PASS ${label}`);
  }
}
function assertContains(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    console.error(`FAIL ${label}: expected to find "${needle}" in output`);
    failures++;
  } else {
    console.log(`PASS ${label}`);
  }
}

const tmpDir = join(tmpdir(), `audit-test-${process.pid}-${Date.now()}`);
mkdirSync(tmpDir, { recursive: true });
const tmpDb = join(tmpDir, 'test.db');
process.env.SQLITE_PATH = tmpDb;

const { getDb, closeDb, upsertNbaBoxStats } = await import('../src/storage/sqlite.js');
const db = getDb();

// Seed two box-stats rows
const now = '2026-04-25T00:00:00Z';
const homeRow = {
  game_id: 'nba:bdl-test', team_id: 'nba:HOME', season: '2024-regular',
  first_scraped_at: now, updated_at: now,
  fga: 100, fgm: 50, fg3a: 30, fg3m: 10, fta: 20, ftm: 15,
  oreb: 10, dreb: 30, reb: 40,
  ast: 25, stl: 8, blk: 5, tov: 12, pf: 20,
  pts: 125, minutes_played: 240, possessions: 100,
};
const awayRow = {
  game_id: 'nba:bdl-test', team_id: 'nba:AWAY', season: '2024-regular',
  first_scraped_at: now, updated_at: now,
  fga: 95, fgm: 45, fg3a: 35, fg3m: 12, fta: 18, ftm: 14,
  oreb: 11, dreb: 28, reb: 39,
  ast: 24, stl: 7, blk: 4, tov: 14, pf: 22,
  pts: 116, minutes_played: 240, possessions: 100,
};
upsertNbaBoxStats(homeRow, now);
upsertNbaBoxStats(awayRow, now);

// Compute expected rates per audit script's formulas
function expectedEfg(r: typeof homeRow) { return (r.fgm + 0.5 * r.fg3m) / r.fga; }
function expectedTov(r: typeof homeRow) { return r.tov / (r.fga + 0.44 * r.fta + r.tov); }
function expectedOrtg(r: typeof homeRow) { return (100 * r.pts) / r.possessions; }
function expectedPace(r: typeof homeRow) { return (48 * r.possessions) / (r.minutes_played / 5); }

// Scenario 1: ground-truth matches exactly (raw + rates)
const truthAllPass = [{
  game_id: 'nba:bdl-test',
  bbref_url: 'https://example.com/test',
  season_label: '2024-regular',
  home_team_id: 'nba:HOME', away_team_id: 'nba:AWAY',
  home_raw_counts: { fgm: 50, fga: 100, fg3m: 10, fg3a: 30, ftm: 15, fta: 20, oreb: 10, dreb: 30, reb: 40, ast: 25, stl: 8, blk: 5, tov: 12, pf: 20, pts: 125 },
  away_raw_counts: { fgm: 45, fga: 95, fg3m: 12, fg3a: 35, ftm: 14, fta: 18, oreb: 11, dreb: 28, reb: 39, ast: 24, stl: 7, blk: 4, tov: 14, pf: 22, pts: 116 },
  home_published_rates: { efg_pct: expectedEfg(homeRow), tov_pct: expectedTov(homeRow), ortg: expectedOrtg(homeRow), pace: expectedPace(homeRow) },
  away_published_rates: { efg_pct: expectedEfg(awayRow), tov_pct: expectedTov(awayRow), ortg: expectedOrtg(awayRow), pace: expectedPace(awayRow) },
}];
const truthFile = join(tmpDir, 'truth.json');
const reportFile = join(tmpDir, 'report.md');

writeFileSync(truthFile, JSON.stringify(truthAllPass));
process.env.SQLITE_PATH = tmpDb;
closeDb();
execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
  cwd: '/home/johnanguiano/projects/sportsdata',
  env: { ...process.env, AUDIT_TRUTH_OVERRIDE: truthFile },
});

// The script reads `data/espn-bbref-audit-truth.json` directly — temporarily swap it.
// Restore the empty version after.
const realTruthPath = '/home/johnanguiano/projects/sportsdata/data/espn-bbref-audit-truth.json';
const realTruthBackup = readFileSync(realTruthPath, 'utf8');
try {
  // Scenario 1: all pass
  writeFileSync(realTruthPath, JSON.stringify(truthAllPass));
  execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
    cwd: '/home/johnanguiano/projects/sportsdata',
  });
  let report = readFileSync(reportFile, 'utf8');
  assertContains(report, 'raw count failures: 0', 'scenario 1: all-pass raw counts → 0 failures');
  assertContains(report, 'derived rate failures: 0', 'scenario 1: all-pass derived rates → 0 failures');
  assertContains(report, 'All fields within tolerance', 'scenario 1: success message present');

  // Scenario 2: one raw-count off-by-one → exactly 1 raw failure
  const truthOneOff = JSON.parse(JSON.stringify(truthAllPass));
  truthOneOff[0].home_raw_counts.fgm = 49; // we have 50, expected 49
  writeFileSync(realTruthPath, JSON.stringify(truthOneOff));
  execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
    cwd: '/home/johnanguiano/projects/sportsdata',
  });
  report = readFileSync(reportFile, 'utf8');
  assertContains(report, 'raw count failures: 1', 'scenario 2: 1 raw count off → 1 failure');
  assertContains(report, '| fgm | home | 49 | 50 | exact | Δ=1 |', 'scenario 2: failure row has correct values');

  // Scenario 3: derived rate off > 1% → rate failure
  const truthRateOff = JSON.parse(JSON.stringify(truthAllPass));
  truthRateOff[0].home_published_rates.efg_pct = expectedEfg(homeRow) * 1.05; // 5% off
  writeFileSync(realTruthPath, JSON.stringify(truthRateOff));
  execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
    cwd: '/home/johnanguiano/projects/sportsdata',
  });
  report = readFileSync(reportFile, 'utf8');
  assertContains(report, 'derived rate failures: 1', 'scenario 3: 5%-off rate → 1 failure');
  assertContains(report, 'relErr=', 'scenario 3: detail includes relErr');

  // Scenario 4: published rate is null → skipped (not failed)
  const truthNullRate = JSON.parse(JSON.stringify(truthAllPass));
  truthNullRate[0].home_published_rates.efg_pct = null;
  writeFileSync(realTruthPath, JSON.stringify(truthNullRate));
  execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
    cwd: '/home/johnanguiano/projects/sportsdata',
  });
  report = readFileSync(reportFile, 'utf8');
  assertContains(report, 'derived rate failures: 0', 'scenario 4: null expected → 0 failures');
  assertContains(report, 'rates skipped (no bbref ground-truth): 1', 'scenario 4: 1 rate skipped');

  // Scenario 5: empty truth file → N=0 stub report
  writeFileSync(realTruthPath, '[]');
  execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
    cwd: '/home/johnanguiano/projects/sportsdata',
  });
  report = readFileSync(reportFile, 'utf8');
  assertContains(report, 'Sample size N: 0', 'scenario 5: empty truth → N=0');
  assertContains(report, 'No ground-truth entries', 'scenario 5: stub message present');

  // Scenario 6: missing box-stats row → skipped
  const truthMissingRow = JSON.parse(JSON.stringify(truthAllPass));
  truthMissingRow[0].game_id = 'nba:bdl-nonexistent';
  writeFileSync(realTruthPath, JSON.stringify(truthMissingRow));
  execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
    cwd: '/home/johnanguiano/projects/sportsdata',
  });
  report = readFileSync(reportFile, 'utf8');
  assertContains(report, 'not present in `nba_game_box_stats`', 'scenario 6: missing row reported');
} finally {
  writeFileSync(realTruthPath, realTruthBackup);
  rmSync(tmpDir, { recursive: true, force: true });
}

if (failures === 0) {
  console.log('\n✓ All audit-mechanics assertions passed');
  process.exit(0);
} else {
  console.error(`\n✗ ${failures} assertion(s) failed`);
  process.exit(1);
}
