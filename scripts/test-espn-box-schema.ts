/**
 * Integration check: runs validateNbaBoxScore against the captured
 * ESPN fixture and asserts expected values.
 *
 * Matches the repo convention (tsx-run validation scripts, no test
 * runner dep). Run:
 *
 *   npx tsx scripts/test-espn-box-schema.ts
 *
 * Non-zero exit on any assertion failure.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateNbaBoxScore,
  possessionsSingleTeam,
  possessionsAveraged,
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

function main(): void {
  const fixturePath = join(
    __dirname,
    '../src/scrapers/__tests__/fixtures/espn-nba-box-401811002.json',
  );
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));

  console.log('## Fixture: espn-nba-box-401811002.json (DEN 137 — POR 132, 2026-04-07)');
  console.log();

  // Game header (per the fixture): DEN home 137, POR away 132
  const scrapedAt = '2026-04-24T12:00:00Z';
  const result = validateNbaBoxScore(
    raw,
    'nba:401811002',
    'nba:DEN',
    'nba:POR',
    '2025-26',
    scrapedAt,
  );

  if (!result.ok) {
    console.error(`FAIL validator returned ok:false — reason: ${result.reason}`);
    console.error('Warnings:', JSON.stringify(result.warnings, null, 2));
    process.exit(1);
  }

  console.log(`PASS validator returned ok:true (${result.warnings.length} warnings)`);
  console.log();
  console.log('## Home (DEN) assertions');

  const { home, away } = result.data;

  // Shape
  assertEq(home.game_id, 'nba:401811002', 'home.game_id');
  assertEq(home.team_id, 'nba:DEN', 'home.team_id');
  assertEq(home.season, '2025-26', 'home.season');
  assertEq(home.first_scraped_at, scrapedAt, 'home.first_scraped_at');
  assertEq(home.updated_at, scrapedAt, 'home.updated_at');

  // Score: DEN won 137-132
  assertEq(home.pts, 137, 'home.pts');
  assertEq(away.pts, 132, 'away.pts');

  // MUST-HAVE shooting for POR (visible in original fixture inspection):
  // "42-89" FG, "25-52" 3PT, "23-28" FT → fgm=42, fga=89, fg3m=25, fg3a=52, ftm=23, fta=28
  assertEq(away.fgm, 42, 'away.fgm');
  assertEq(away.fga, 89, 'away.fga');
  assertEq(away.fg3m, 25, 'away.fg3m');
  assertEq(away.fg3a, 52, 'away.fg3a');
  assertEq(away.ftm, 23, 'away.ftm');
  assertEq(away.fta, 28, 'away.fta');
  // Rebounds: 11 OR, 28 DR, 39 REB
  assertEq(away.oreb, 11, 'away.oreb');
  assertEq(away.dreb, 28, 'away.dreb');
  assertEq(away.reb, 39, 'away.reb');
  // Defense + ball handling: AST 29
  assertEq(away.ast, 29, 'away.ast');
  // turnovers total should be a non-negative int
  assertTrue(away.tov >= 0 && Number.isInteger(away.tov), 'away.tov is non-negative int');

  // All numeric MUST-HAVE fields present and finite for both sides
  const mustHaveNumeric: Array<keyof typeof home> = [
    'fga', 'fgm', 'fg3a', 'fg3m', 'fta', 'ftm',
    'oreb', 'dreb', 'reb',
    'ast', 'stl', 'blk', 'tov', 'pf',
    'pts', 'minutes_played', 'possessions',
  ];
  for (const f of mustHaveNumeric) {
    const hv = home[f] as number;
    const av = away[f] as number;
    assertTrue(Number.isFinite(hv) && hv >= 0, `home.${String(f)} finite and non-negative (got ${hv})`);
    assertTrue(Number.isFinite(av) && av >= 0, `away.${String(f)} finite and non-negative (got ${av})`);
  }

  // Possessions sanity: ~100±20 for NBA; and home.possessions == away.possessions (averaged convention)
  assertEq(home.possessions, away.possessions, 'possessions is averaged (home == away)');
  assertTrue(home.possessions > 80 && home.possessions < 130, `possessions in NBA plausible range (got ${home.possessions.toFixed(2)})`);

  // Possessions math: matches possessionsAveraged formula
  const expectedPoss = possessionsAveraged(
    { fga: home.fga, fta: home.fta, oreb: home.oreb, tov: home.tov },
    { fga: away.fga, fta: away.fta, oreb: away.oreb, tov: away.tov },
  );
  assertEq(home.possessions, expectedPoss, 'possessions matches possessionsAveraged()');

  // Spot-check unit function
  const singlePos = possessionsSingleTeam({ fga: 100, fta: 20, oreb: 10, tov: 15 });
  // 100 + 0.44*20 − 10 + 15 = 100 + 8.8 − 10 + 15 = 113.8
  assertEq(singlePos, 113.8, 'possessionsSingleTeam math');

  // Minutes sanity: regulation = 240 per team. This game was reported as
  // 137-132 in regulation. DEN/POR totals should be 240 unless our fallback
  // kicked in (which would still give 240 as the default).
  assertTrue(home.minutes_played >= 240 && home.minutes_played <= 290, `home.minutes_played in regulation+OT range (got ${home.minutes_played})`);
  assertTrue(away.minutes_played >= 240 && away.minutes_played <= 290, `away.minutes_played in regulation+OT range (got ${away.minutes_played})`);

  // Warnings: should not contain `missing_field` for MUST-HAVE (those would have failed ok:false already)
  for (const w of result.warnings) {
    if (w.warning_type === 'missing_field') {
      // Permitted if it's about minutes_played fallback; fail otherwise
      if (!w.detail.includes('minutes_played')) {
        console.error(`FAIL unexpected missing_field warning: ${w.detail}`);
        failures++;
      }
    }
  }

  console.log();
  if (failures === 0) {
    console.log(`✓ All assertions passed (${result.warnings.length} warnings, all expected or informational)`);
    process.exit(0);
  } else {
    console.error(`✗ ${failures} assertion(s) failed`);
    process.exit(1);
  }
}

main();
