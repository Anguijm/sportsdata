/**
 * debt #9: Seed-stability test for v2 winning-probability and predictMargin.
 *
 * Both functions are pure (no Math.random, no Date.now, no global state). This
 * test guards against accidental introduction of non-determinism — e.g., a
 * refactor that adds randomness, mutable closure state, or Date-dependent
 * branching.
 *
 * Run: npx tsx scripts/test-predict-stability.ts
 * Exits 0 on PASS, 1 on FAIL.
 */

import { v2, predictMargin } from '../src/analysis/predict.js';
import type { GameForPrediction, PredictionContext, PitcherMatchup, InjuryImpact } from '../src/analysis/predict.js';

const REPEAT = 20; // call each fixture this many times

// --- Fixtures ---

const baseGame: GameForPrediction = {
  game_id: 'nba:test-001',
  date: '2025-01-15',
  sport: 'nba',
  home_team_id: 'nba:1610612747',
  away_team_id: 'nba:1610612737',
  home_win: 1,
};

const baseCtx: PredictionContext = {
  home: { games: 40, wins: 25, losses: 15, pointsFor: 4500, pointsAgainst: 4200, lastNResults: [true, false, true, true, false] },
  away: { games: 38, wins: 20, losses: 18, pointsFor: 4100, pointsAgainst: 4000, lastNResults: [false, false, false, true, true] },
  asOfDate: '2025-01-15',
};

const mlbGame: GameForPrediction = { ...baseGame, game_id: 'mlb:test-001', sport: 'mlb' };
const pitchers: PitcherMatchup = { homeEra: 3.20, awayEra: 4.50 };
const injuries: InjuryImpact = { homeOutImpact: 5.0, awayOutImpact: 2.0 };

// coldStreak context: home team lost last 3 (triggers streak penalty in predictMargin)
const coldCtx: PredictionContext = {
  ...baseCtx,
  home: { ...baseCtx.home, lastNResults: [true, true, false, false, false] },
};

// Low-confidence context: fewer than 5 games played
const lowConfCtx: PredictionContext = {
  ...baseCtx,
  home: { ...baseCtx.home, games: 3 },
};

// --- Runner ---

let passed = 0;
let failed = 0;

function assertStable(label: string, fn: () => number): void {
  const results: number[] = [];
  for (let i = 0; i < REPEAT; i++) results.push(fn());
  const allSame = results.every(r => r === results[0]);
  if (allSame) {
    console.log(`  ✓ ${label} — stable at ${results[0]}`);
    passed++;
  } else {
    const unique = [...new Set(results)];
    console.error(`  ✗ ${label} — NON-DETERMINISTIC: saw ${unique.join(', ')} across ${REPEAT} calls`);
    failed++;
  }
}

console.log('\nv2.predict stability:');
assertStable('v2 NBA base', () => v2.predict(baseGame, baseCtx));
assertStable('v2 NBA cold streak home', () => v2.predict(baseGame, coldCtx));
assertStable('v2 NBA low confidence', () => v2.predict(baseGame, lowConfCtx));
assertStable('v2 MLB', () => v2.predict(mlbGame, baseCtx));

console.log('\npredictMargin stability:');
assertStable('margin NBA base', () => predictMargin(baseGame, baseCtx));
assertStable('margin NBA cold streak', () => predictMargin(baseGame, coldCtx));
assertStable('margin NBA with injuries', () => predictMargin(baseGame, baseCtx, undefined, injuries));
assertStable('margin NBA low confidence', () => predictMargin(baseGame, lowConfCtx));
assertStable('margin MLB with pitchers', () => predictMargin(mlbGame, baseCtx, pitchers));
assertStable('margin MLB with pitchers+injuries', () => predictMargin(mlbGame, baseCtx, pitchers, injuries));

console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
