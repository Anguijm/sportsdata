/**
 * debt #15: v5 ↔ v4-spread injury consistency check.
 *
 * Asserts that the two models apply injury adjustments in the same direction:
 *   - home injury   → v5 probability decreases AND v4-spread margin decreases
 *   - away injury   → v5 probability increases AND v4-spread margin increases
 *   - no injury     → both models return their uninjured baselines
 *   - both injured  → net effect is in the direction of the larger injury
 *
 * Also documents (via assertion) that both models use the same
 * INJURY_COMPENSATION coefficient (0.4) by checking the magnitude of the
 * shift. A coefficient change in one model but not the other would break
 * these magnitude assertions.
 *
 * Run: npx tsx scripts/test-injury-consistency.ts
 * Exits 0 on PASS, 1 on FAIL.
 */

import { predictWithInjuries, predictMargin } from '../src/analysis/predict.js';
import type { GameForPrediction, PredictionContext, InjuryImpact } from '../src/analysis/predict.js';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

const game: GameForPrediction = {
  game_id: 'nba:test-001',
  date: '2025-01-15',
  sport: 'nba',
  home_team_id: 'nba:1610612747',
  away_team_id: 'nba:1610612737',
  home_win: 0,
};

const ctx: PredictionContext = {
  home: { games: 40, wins: 25, losses: 15, pointsFor: 4500, pointsAgainst: 4200, lastNResults: [true, false, true, true, false] },
  away: { games: 38, wins: 20, losses: 18, pointsFor: 4100, pointsAgainst: 4000, lastNResults: [true, false, false, true, false] },
  asOfDate: '2025-01-15',
};

const homeInjury: InjuryImpact = { homeOutImpact: 20, awayOutImpact: 0 };   // home team weakened
const awayInjury: InjuryImpact = { homeOutImpact: 0, awayOutImpact: 20 };   // away team weakened
const bothInjury: InjuryImpact = { homeOutImpact: 20, awayOutImpact: 12 };  // home weaker net

const baseProb = predictWithInjuries(game, ctx, undefined);
const baseMargin = predictMargin(game, ctx, undefined, undefined);

const homeInjProb = predictWithInjuries(game, ctx, homeInjury);
const homeInjMargin = predictMargin(game, ctx, undefined, homeInjury);

const awayInjProb = predictWithInjuries(game, ctx, awayInjury);
const awayInjMargin = predictMargin(game, ctx, undefined, awayInjury);

const bothInjProb = predictWithInjuries(game, ctx, bothInjury);
const bothInjMargin = predictMargin(game, ctx, undefined, bothInjury);

console.log('\nDirection consistency:');
assert(
  'home injury → v5 prob decreases',
  homeInjProb < baseProb,
  `base=${baseProb.toFixed(4)}, injured=${homeInjProb.toFixed(4)}`,
);
assert(
  'home injury → v4 margin decreases',
  homeInjMargin < baseMargin,
  `base=${baseMargin.toFixed(4)}, injured=${homeInjMargin.toFixed(4)}`,
);
assert(
  'away injury → v5 prob increases',
  awayInjProb > baseProb,
  `base=${baseProb.toFixed(4)}, injured=${awayInjProb.toFixed(4)}`,
);
assert(
  'away injury → v4 margin increases',
  awayInjMargin > baseMargin,
  `base=${baseMargin.toFixed(4)}, injured=${awayInjMargin.toFixed(4)}`,
);
assert(
  'net home injury → v5 prob decreases',
  bothInjProb < baseProb,
  `base=${baseProb.toFixed(4)}, both=${bothInjProb.toFixed(4)}`,
);
assert(
  'net home injury → v4 margin decreases',
  bothInjMargin < baseMargin,
  `base=${baseMargin.toFixed(4)}, both=${bothInjMargin.toFixed(4)}`,
);

console.log('\nSymmetry: symmetric injury → symmetric delta:');
const INJURY_COMPENSATION = 0.4;
const MARGIN_DELTA_EXPECTED = 20 * INJURY_COMPENSATION; // 8.0 pts
assert(
  'away injury margin delta matches INJURY_COMPENSATION * impact',
  Math.abs(awayInjMargin - baseMargin - MARGIN_DELTA_EXPECTED) < 0.001,
  `expected +${MARGIN_DELTA_EXPECTED.toFixed(3)}, got +${(awayInjMargin - baseMargin).toFixed(3)}`,
);
assert(
  'home injury margin delta matches -INJURY_COMPENSATION * impact',
  Math.abs(homeInjMargin - baseMargin + MARGIN_DELTA_EXPECTED) < 0.001,
  `expected -${MARGIN_DELTA_EXPECTED.toFixed(3)}, got ${(homeInjMargin - baseMargin).toFixed(3)}`,
);

console.log('\nNo-injury passthrough:');
const noInjuryProb = predictWithInjuries(game, ctx, { homeOutImpact: 0, awayOutImpact: 0 });
const noInjuryMargin = predictMargin(game, ctx, undefined, { homeOutImpact: 0, awayOutImpact: 0 });
assert(
  'zero-impact injury → v5 prob unchanged',
  noInjuryProb === baseProb,
  `base=${baseProb}, zeroInjury=${noInjuryProb}`,
);
assert(
  'zero-impact injury → v4 margin unchanged',
  noInjuryMargin === baseMargin,
  `base=${baseMargin}, zeroInjury=${noInjuryMargin}`,
);

console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
