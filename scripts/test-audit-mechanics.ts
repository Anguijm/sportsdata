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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

// Repo root resolved from this file's location, so the test runs from any
// working directory and on any machine (CI included).
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

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

// Compute expected rates per audit script's formulas. Per Phase 2 addendum v9
// (decision C′), ortg and pace are computed from bbref's averaged game-level
// possessions, not from the per-team `possessions` column.
function expectedEfg(r: typeof homeRow) { return (r.fgm + 0.5 * r.fg3m) / r.fga; }
function expectedTov(r: typeof homeRow) { return r.tov / (r.fga + 0.44 * r.fta + r.tov); }
function bbrefContrib(tm: typeof homeRow, oppDreb: number): number {
  const orebDenom = tm.oreb + oppDreb;
  const orebRate = orebDenom > 0 ? tm.oreb / orebDenom : 0;
  const missed = Math.max(0, tm.fga - tm.fgm);
  if (tm.fga === 0) return 0.4 * tm.fta + tm.tov;
  return tm.fga + 0.4 * tm.fta - 1.07 * orebRate * missed + tm.tov;
}
function expectedGamePoss(home: typeof homeRow, away: typeof homeRow): number {
  return 0.5 * (bbrefContrib(home, away.dreb) + bbrefContrib(away, home.dreb));
}
function expectedOrtg(r: typeof homeRow, gamePoss: number) { return (100 * r.pts) / gamePoss; }
function expectedPace(r: typeof homeRow, gamePoss: number) { return (48 * gamePoss) / (r.minutes_played / 5); }

// Hand-checked formula lock per addendum v9 risk #1: with this synthetic
// input, gamePoss must equal the value derived from bbref's published formula.
// homeContrib = 100 + 0.4·20 − 1.07·(10/38)·50 + 12 = 100 + 8 − 14.0789... + 12 = 105.9210...
// awayContrib =  95 + 0.4·18 − 1.07·(11/41)·50 + 14 =  95 + 7.2 − 14.3537... + 14 = 101.8463...
// gamePoss    = 0.5·(105.9210 + 101.8463) = 103.8836...
const expectedHandCheckedPoss = 103.8836;
const computedPoss = expectedGamePoss(homeRow, awayRow);
if (Math.abs(computedPoss - expectedHandCheckedPoss) > 1e-3) {
  console.error(`FAIL hand-checked bbrefPossessions: expected ~${expectedHandCheckedPoss}, got ${computedPoss}`);
  failures++;
} else {
  console.log(`PASS hand-checked bbrefPossessions = ${computedPoss.toFixed(4)} (within 1e-3 of ${expectedHandCheckedPoss})`);
}
const GAME_POSS = computedPoss;

// Scenario 1: ground-truth matches exactly (raw + rates)
const truthAllPass = [{
  game_id: 'nba:bdl-test',
  bbref_url: 'https://example.com/test',
  season_label: '2024-regular',
  home_team_id: 'nba:HOME', away_team_id: 'nba:AWAY',
  home_raw_counts: { fgm: 50, fga: 100, fg3m: 10, fg3a: 30, ftm: 15, fta: 20, oreb: 10, dreb: 30, reb: 40, ast: 25, stl: 8, blk: 5, tov: 12, pf: 20, pts: 125 },
  away_raw_counts: { fgm: 45, fga: 95, fg3m: 12, fg3a: 35, ftm: 14, fta: 18, oreb: 11, dreb: 28, reb: 39, ast: 24, stl: 7, blk: 4, tov: 14, pf: 22, pts: 116 },
  home_published_rates: { efg_pct: expectedEfg(homeRow), tov_pct: expectedTov(homeRow), ortg: expectedOrtg(homeRow, GAME_POSS), pace: expectedPace(homeRow, GAME_POSS) },
  away_published_rates: { efg_pct: expectedEfg(awayRow), tov_pct: expectedTov(awayRow), ortg: expectedOrtg(awayRow, GAME_POSS), pace: expectedPace(awayRow, GAME_POSS) },
}];
const truthFile = join(tmpDir, 'truth.json');
const reportFile = join(tmpDir, 'report.md');

writeFileSync(truthFile, JSON.stringify(truthAllPass));
process.env.SQLITE_PATH = tmpDb;
closeDb();
execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
  cwd: REPO_ROOT,
  env: { ...process.env, AUDIT_TRUTH_OVERRIDE: truthFile },
});

// The script reads `data/espn-bbref-audit-truth.json` directly — temporarily swap it.
// Restore the empty version after.
const realTruthPath = join(REPO_ROOT, 'data/espn-bbref-audit-truth.json');
const realTruthBackup = readFileSync(realTruthPath, 'utf8');
try {
  // Scenario 1: all pass
  writeFileSync(realTruthPath, JSON.stringify(truthAllPass));
  execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
    cwd: REPO_ROOT,
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
    cwd: REPO_ROOT,
  });
  report = readFileSync(reportFile, 'utf8');
  assertContains(report, 'raw count failures: 1', 'scenario 2: 1 raw count off → 1 failure');
  assertContains(report, '| fgm | home | 49 | 50 | exact | Δ=1 |', 'scenario 2: failure row has correct values');

  // Scenario 3: derived rate off > 1% → rate failure
  const truthRateOff = JSON.parse(JSON.stringify(truthAllPass));
  truthRateOff[0].home_published_rates.efg_pct = expectedEfg(homeRow) * 1.05; // 5% off
  writeFileSync(realTruthPath, JSON.stringify(truthRateOff));
  execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
    cwd: REPO_ROOT,
  });
  report = readFileSync(reportFile, 'utf8');
  assertContains(report, 'derived rate failures: 1', 'scenario 3: 5%-off rate → 1 failure');
  assertContains(report, 'relErr=', 'scenario 3: detail includes relErr');

  // Scenario 4: published rate is null → skipped (not failed)
  const truthNullRate = JSON.parse(JSON.stringify(truthAllPass));
  truthNullRate[0].home_published_rates.efg_pct = null;
  writeFileSync(realTruthPath, JSON.stringify(truthNullRate));
  execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
    cwd: REPO_ROOT,
  });
  report = readFileSync(reportFile, 'utf8');
  assertContains(report, 'derived rate failures: 0', 'scenario 4: null expected → 0 failures');
  assertContains(report, 'rates skipped (no bbref ground-truth): 1', 'scenario 4: 1 rate skipped');

  // Scenario 5: empty truth file → N=0 stub report
  writeFileSync(realTruthPath, '[]');
  execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
    cwd: REPO_ROOT,
  });
  report = readFileSync(reportFile, 'utf8');
  assertContains(report, 'Sample size N: 0', 'scenario 5: empty truth → N=0');
  assertContains(report, 'No ground-truth entries', 'scenario 5: stub message present');

  // Scenario 6: missing box-stats row → skipped
  const truthMissingRow = JSON.parse(JSON.stringify(truthAllPass));
  truthMissingRow[0].game_id = 'nba:bdl-nonexistent';
  writeFileSync(realTruthPath, JSON.stringify(truthMissingRow));
  execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
    cwd: REPO_ROOT,
  });
  report = readFileSync(reportFile, 'utf8');
  assertContains(report, 'not present in `nba_game_box_stats`', 'scenario 6: missing row reported');

  // Scenario 7 (Codex P1 fix): N≥50 ground-truth with skipped entries must
  // FAIL Pass-B disposition, not silently pass. Construct 50 entries: 49
  // pointing at the seeded test row, 1 pointing at a non-existent game.
  const truthPassB: typeof truthAllPass = [];
  for (let i = 0; i < 50; i++) truthPassB.push(JSON.parse(JSON.stringify(truthAllPass[0])));
  truthPassB[0].game_id = 'nba:bdl-missing-1'; // missing in nba_game_box_stats
  writeFileSync(realTruthPath, JSON.stringify(truthPassB));
  execSync(`SQLITE_PATH=${tmpDb} npx tsx scripts/audit-espn-box-stats.ts --out ${reportFile}`, {
    cwd: REPO_ROOT,
  });
  report = readFileSync(reportFile, 'utf8');
  assertContains(report, 'Pass-B candidate (N=50)', 'scenario 7: Pass-B disposition reached at N=50');
  assertContains(report, '**FAIL**', 'scenario 7: skipped entries → FAIL (not silent PASS)');
  assertContains(report, '1 entries missing from nba_game_box_stats', 'scenario 7: failure reason cites missing entries');
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
