/**
 * Integration check: runs validateNbaBoxScore against captured ESPN
 * fixtures (one per in-scope season + extras) and asserts expected values.
 *
 * Matches the repo convention (tsx-run validation scripts, no test
 * runner dep). Run:
 *
 *   npx tsx scripts/test-espn-box-schema.ts
 *
 * Non-zero exit on any assertion failure.
 *
 * Fixture set (Phase 2 impl-review hardening — one per season):
 *  - 401468016: 2022-23 opening night (PHI @ BOS), regulation
 *  - 401584689: 2023-24 opening night (LAL @ DEN), regulation
 *  - 401704627: 2024-25 opening night (NYK @ BOS), regulation
 *  - 401811002: 2025-26 late-regular (POR @ DEN), 1-OT
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateNbaBoxScore,
  possessionsSingleTeam,
  possessionsAveraged,
  extractPeriodsPlayed,
  regulationPlusOtMinutes,
} from '../src/scrapers/espn-box-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

interface FixtureCase {
  eventId: string;
  season: string;
  home: { id: string; expectedScore: number };
  away: { id: string; expectedScore: number };
  expectedPeriods: 4 | 5 | 6;
  label: string;
}

const FIXTURES: FixtureCase[] = [
  { eventId: '401468016', season: '2022-23', home: { id: 'nba:BOS', expectedScore: 126 }, away: { id: 'nba:PHI', expectedScore: 117 }, expectedPeriods: 4, label: '2022-23 PHI@BOS (regulation)' },
  { eventId: '401584689', season: '2023-24', home: { id: 'nba:DEN', expectedScore: 119 }, away: { id: 'nba:LAL', expectedScore: 107 }, expectedPeriods: 4, label: '2023-24 LAL@DEN (regulation)' },
  { eventId: '401704627', season: '2024-25', home: { id: 'nba:BOS', expectedScore: 132 }, away: { id: 'nba:NY',  expectedScore: 109 }, expectedPeriods: 4, label: '2024-25 NYK@BOS (regulation)' },
  { eventId: '401811002', season: '2025-26', home: { id: 'nba:DEN', expectedScore: 137 }, away: { id: 'nba:POR', expectedScore: 132 }, expectedPeriods: 5, label: '2025-26 POR@DEN (1-OT)' },
];

const MUST_HAVE_NUMERIC_FIELDS = [
  'fga', 'fgm', 'fg3a', 'fg3m', 'fta', 'ftm',
  'oreb', 'dreb', 'reb',
  'ast', 'stl', 'blk', 'tov', 'pf',
  'pts', 'minutes_played', 'possessions',
] as const;

function runFixture(fc: FixtureCase): void {
  const fixturePath = join(__dirname, `../src/scrapers/__tests__/fixtures/espn-nba-box-${fc.eventId}.json`);
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));

  console.log(`\n## ${fc.label} — fixture ${fc.eventId}`);

  const scrapedAt = '2026-04-25T12:00:00Z';
  const result = validateNbaBoxScore(
    raw,
    `nba:${fc.eventId}`,
    fc.home.id,
    fc.away.id,
    fc.season,
    scrapedAt,
  );

  if (!result.ok) {
    console.error(`FAIL validator returned ok:false — reason: ${result.reason}`);
    console.error('Warnings:', JSON.stringify(result.warnings, null, 2));
    failures++;
    return;
  }
  console.log(`PASS validator ok:true (${result.warnings.length} warnings)`);

  const { home, away } = result.data;

  // Scores
  assertEq(home.pts, fc.home.expectedScore, `${fc.eventId}: home.pts`);
  assertEq(away.pts, fc.away.expectedScore, `${fc.eventId}: away.pts`);

  // Shape
  assertEq(home.team_id, fc.home.id, `${fc.eventId}: home.team_id`);
  assertEq(away.team_id, fc.away.id, `${fc.eventId}: away.team_id`);
  assertEq(home.season, fc.season, `${fc.eventId}: home.season`);
  assertEq(home.first_scraped_at, scrapedAt, `${fc.eventId}: home.first_scraped_at`);

  // All MUST-HAVE numerics finite + non-negative on both sides
  for (const f of MUST_HAVE_NUMERIC_FIELDS) {
    const hv = home[f] as number;
    const av = away[f] as number;
    assertTrue(Number.isFinite(hv) && hv >= 0, `${fc.eventId}: home.${f} finite/non-negative (got ${hv})`);
    assertTrue(Number.isFinite(av) && av >= 0, `${fc.eventId}: away.${f} finite/non-negative (got ${av})`);
  }

  // Possessions: averaged convention + NBA plausible range
  assertEq(home.possessions, away.possessions, `${fc.eventId}: possessions averaged (home == away)`);
  assertTrue(home.possessions > 80 && home.possessions < 130, `${fc.eventId}: possessions plausible (got ${home.possessions.toFixed(2)})`);
  const expectedPoss = possessionsAveraged(
    { fga: home.fga, fta: home.fta, oreb: home.oreb, tov: home.tov },
    { fga: away.fga, fta: away.fta, oreb: away.oreb, tov: away.tov },
  );
  assertEq(home.possessions, expectedPoss, `${fc.eventId}: possessions matches possessionsAveraged()`);

  // Minutes match period count (regulation 240, each OT +25)
  const expectedMinutesLo = regulationPlusOtMinutes(fc.expectedPeriods) - 1; // allow ±1 for DNP edge case
  const expectedMinutesHi = regulationPlusOtMinutes(fc.expectedPeriods) + 1;
  assertTrue(home.minutes_played >= expectedMinutesLo && home.minutes_played <= expectedMinutesHi,
    `${fc.eventId}: home.minutes_played ~${regulationPlusOtMinutes(fc.expectedPeriods)} (got ${home.minutes_played}) periods=${fc.expectedPeriods}`);
  assertTrue(away.minutes_played >= expectedMinutesLo && away.minutes_played <= expectedMinutesHi,
    `${fc.eventId}: away.minutes_played ~${regulationPlusOtMinutes(fc.expectedPeriods)} (got ${away.minutes_played}) periods=${fc.expectedPeriods}`);

  // time_of_possession removed in impl-review — NbaBoxStatsRow no longer has the field
  assertTrue(!('time_of_possession' in home), `${fc.eventId}: time_of_possession removed from home row`);
  assertTrue(!('time_of_possession' in away), `${fc.eventId}: time_of_possession removed from away row`);

  // Unexpected missing_field warnings indicate schema drift
  for (const w of result.warnings) {
    if (w.warning_type === 'missing_field' && !w.detail.includes('minutes_played')) {
      console.error(`FAIL ${fc.eventId}: unexpected missing_field warning: ${w.detail}`);
      failures++;
    }
  }

  // Addendum v10 + rollback (post-mortem): tov sources from ESPN's
  // totalTurnovers (player + team-attributed). team_tov NICE-TO-HAVE column
  // captures the team-attributed component for forensic + Phase-3 use.
  // No sum-identity check — tov IS totalTurnovers, so the check is meaningless.
  // No tov<team_tov ordering check — tov ≥ team_tov is structurally guaranteed
  // when tov = turnovers + teamTurnovers and turnovers ≥ 0.
  // Bounds checks ([0,40] and [0,10]) retained.
  assertTrue(typeof home.team_tov === 'number' && home.team_tov >= 0,
    `${fc.eventId}: home.team_tov populated as NICE-TO-HAVE int (got ${home.team_tov})`);
  assertTrue(typeof away.team_tov === 'number' && away.team_tov >= 0,
    `${fc.eventId}: away.team_tov populated as NICE-TO-HAVE int (got ${away.team_tov})`);
  for (const w of result.warnings) {
    if (w.warning_type === 'schema_error' && (w.detail.includes('tov out of bounds') || w.detail.includes('team_tov out of bounds'))) {
      console.error(`FAIL ${fc.eventId}: unexpected schema_error on bounds: ${w.detail}`);
      failures++;
    }
  }
}

function runUnitTests(): void {
  console.log('\n## Unit tests: helpers');

  // possessionsSingleTeam
  const singlePos = possessionsSingleTeam({ fga: 100, fta: 20, oreb: 10, tov: 15 });
  assertEq(singlePos, 113.8, 'possessionsSingleTeam(100,20,10,15) = 113.8');

  // extractPeriodsPlayed: regex on status.type.detail
  assertEq(extractPeriodsPlayed({ competitions: [{ status: { type: { detail: 'Final' } } }] }), 4, 'extractPeriodsPlayed: "Final" → 4');
  assertEq(extractPeriodsPlayed({ competitions: [{ status: { type: { detail: 'Final/OT' } } }] }), 5, 'extractPeriodsPlayed: "Final/OT" → 5');
  assertEq(extractPeriodsPlayed({ competitions: [{ status: { type: { detail: 'Final/2OT' } } }] }), 6, 'extractPeriodsPlayed: "Final/2OT" → 6');
  assertEq(extractPeriodsPlayed({ competitions: [{ status: { type: { detail: 'Final/3OT' } } }] }), 7, 'extractPeriodsPlayed: "Final/3OT" → 7');
  assertEq(extractPeriodsPlayed(null), 4, 'extractPeriodsPlayed: null → 4 (regulation default)');
  assertEq(extractPeriodsPlayed({}), 4, 'extractPeriodsPlayed: {} → 4');
  assertEq(extractPeriodsPlayed({ competitions: [{ status: { type: { description: 'Final/OT' } } }] }), 5, 'extractPeriodsPlayed: falls back to description when detail absent');

  // regulationPlusOtMinutes: 240 + 25 per OT period
  assertEq(regulationPlusOtMinutes(4), 240, 'regulationPlusOtMinutes(4) = 240 (regulation)');
  assertEq(regulationPlusOtMinutes(5), 265, 'regulationPlusOtMinutes(5) = 265 (1-OT)');
  assertEq(regulationPlusOtMinutes(6), 290, 'regulationPlusOtMinutes(6) = 290 (2-OT)');
  assertEq(regulationPlusOtMinutes(3), 240, 'regulationPlusOtMinutes(3) clamps at regulation');
}

function runOtFallbackIntegration(): void {
  // Exercise the fallback path end-to-end by clobbering the players array
  // on the 1-OT fixture. Validator's primary summation path should fail,
  // causing the OT-aware fallback to return 265 (not a bare 240).
  console.log('\n## OT-aware fallback: synthetic malformed players array on 1-OT fixture');
  const fixturePath = join(__dirname, '../src/scrapers/__tests__/fixtures/espn-nba-box-401811002.json');
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
  // Empty the player statistics arrays so the primary summation yields 0
  // and the fallback fires.
  for (const t of raw.boxscore.players) {
    t.statistics = [];
  }
  const result = validateNbaBoxScore(raw, 'nba:401811002', 'nba:DEN', 'nba:POR', '2025-26', '2026-04-25T12:00:00Z');
  if (!result.ok) {
    console.error(`FAIL fallback integration: validator returned ok:false — ${result.reason}`);
    failures++;
    return;
  }
  assertEq(result.data.home.minutes_played, 265, 'fallback fires: home.minutes_played = 265 (1-OT, NOT bare 240)');
  assertEq(result.data.away.minutes_played, 265, 'fallback fires: away.minutes_played = 265 (1-OT, NOT bare 240)');
  const fallbackWarnings = result.warnings.filter(w => w.warning_type === 'missing_field' && w.detail.includes('minutes_played'));
  assertTrue(fallbackWarnings.length === 2, `fallback emits 2 warnings (one per side), got ${fallbackWarnings.length}`);
  assertTrue(fallbackWarnings[0].detail.includes('periods=5'), `fallback warning identifies period count, got: ${fallbackWarnings[0].detail}`);
}

function runTovBoundsChecks(): void {
  // Post-rollback: only bounds checks remain. Synthetic-corruption fixtures
  // must produce schema_error warnings for (a) tov out-of-bounds and
  // (b) team_tov out-of-bounds. Validator must NOT flip ok:false (warning-only:
  // ESPN data drift is informational, not data-corrupting at the row level).
  console.log('\n## TOV bounds checks (addendum v10 retained post-rollback)');
  const fixturePath = join(__dirname, '../src/scrapers/__tests__/fixtures/espn-nba-box-401704627.json');
  const baseRaw = JSON.parse(readFileSync(fixturePath, 'utf8'));

  // (a) tov out-of-bounds: synthesize totalTurnovers=50 (above [0,40]).
  {
    const raw = JSON.parse(JSON.stringify(baseRaw));
    raw.boxscore.teams[0].statistics.find((s: { name: string }) => s.name === 'totalTurnovers').displayValue = '50';
    const result = validateNbaBoxScore(raw, 'nba:401704627', 'nba:BOS', 'nba:NY', '2024-25', '2026-04-25T12:00:00Z');
    assertTrue(result.ok, '(a) tov=50 out-of-bounds: validator stays ok:true');
    if (result.ok) {
      const boundsWarn = result.warnings.find(w => w.warning_type === 'schema_error' && w.detail.includes('tov out of bounds'));
      assertTrue(!!boundsWarn, `(a) tov out-of-bounds: schema_error warning fired (got: ${boundsWarn?.detail ?? 'NONE'})`);
    }
  }

  // (b) team_tov out of bounds: 15 (above team_tov ∈ [0,10]).
  {
    const raw = JSON.parse(JSON.stringify(baseRaw));
    raw.boxscore.teams[0].statistics.find((s: { name: string }) => s.name === 'teamTurnovers').displayValue = '15';
    const result = validateNbaBoxScore(raw, 'nba:401704627', 'nba:BOS', 'nba:NY', '2024-25', '2026-04-25T12:00:00Z');
    assertTrue(result.ok, '(b) team_tov=15: validator stays ok:true');
    if (result.ok) {
      const teamBoundsWarn = result.warnings.find(w => w.warning_type === 'schema_error' && w.detail.includes('team_tov out of bounds'));
      assertTrue(!!teamBoundsWarn, `(b) team_tov bounds: schema_error warning fired (got: ${teamBoundsWarn?.detail ?? 'NONE'})`);
    }
  }

  // (c) ESPN sentinel pattern (negative team_tov): teamTurnovers=-N. Real
  // ESPN data observed during v10 backfill (CHI/LAC 2026-01-20 game showed
  // teamTurnovers=-16 with totalTurnovers=0). Must produce a schema_error
  // warning but not orphan the row.
  {
    const raw = JSON.parse(JSON.stringify(baseRaw));
    raw.boxscore.teams[0].statistics.find((s: { name: string }) => s.name === 'teamTurnovers').displayValue = '-12';
    const result = validateNbaBoxScore(raw, 'nba:401704627', 'nba:BOS', 'nba:NY', '2024-25', '2026-04-25T12:00:00Z');
    assertTrue(result.ok, '(c) ESPN sentinel team_tov=-12: validator stays ok:true');
    if (result.ok) {
      const sentinelWarn = result.warnings.find(w => w.warning_type === 'schema_error' && w.detail.includes('team_tov out of bounds'));
      assertTrue(!!sentinelWarn, `(c) ESPN sentinel: schema_error warning fired (got: ${sentinelWarn?.detail ?? 'NONE'})`);
    }
  }
}

function main(): void {
  for (const fc of FIXTURES) {
    runFixture(fc);
  }
  runUnitTests();
  runOtFallbackIntegration();
  runTovBoundsChecks();

  console.log();
  if (failures === 0) {
    console.log(`✓ All assertions passed across ${FIXTURES.length} fixtures + unit tests`);
    process.exit(0);
  } else {
    console.error(`✗ ${failures} assertion(s) failed`);
    process.exit(1);
  }
}

main();
