/**
 * Ratchet CLI — runs the backtest across all iterations and saves results.
 * Usage: npx tsx src/cli/ratchet.ts [sport]
 *
 * Output is saved as a static JSON artifact (per council mandate — no live endpoint).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Sport } from '../schema/provenance.js';
import { ITERATIONS } from '../analysis/predict.js';
import { runBacktest } from '../analysis/backtest.js';
import { computeVegasComparison } from '../analysis/vegas-baseline.js';
import { closeDb } from '../storage/sqlite.js';

const sport: Sport = (process.argv[2] as Sport) ?? 'nba';

function main() {
  console.log(`\n━━━ RATCHET RUN: ${sport.toUpperCase()} ━━━`);
  console.log(`Iterations: ${ITERATIONS.length}`);

  const results = runBacktest(sport, ITERATIONS);

  console.log('\n━━━ SUMMARY (test set) ━━━');
  for (const r of results) {
    const delta = r.deltaVsPrevious
      ? ` Δ ${r.deltaVsPrevious.brier > 0 ? '+' : ''}${r.deltaVsPrevious.brier.toFixed(4)}`
      : '';
    console.log(`  ${r.iterationId}: Brier ${r.test.brier.toFixed(4)}  Acc ${(r.test.accuracy * 100).toFixed(1)}%${delta}`);
  }

  // Find the winning iteration on test set
  const best = [...results].sort((a, b) => a.test.brier - b.test.brier)[0];
  console.log(`\n  Best iteration: ${best.iterationId} (Brier ${best.test.brier.toFixed(4)})`);

  // Verdict: did we beat the baseline?
  const baseline = results[0];
  const beatBaseline = best.iterationId !== 'v0' && best.test.brier < baseline.test.brier;
  const brierImprovement = baseline.test.brier - best.test.brier;
  const ciOverlap = best.test.brierCI95[1] > baseline.test.brierCI95[0];

  console.log(`\n  Beat baseline: ${beatBaseline ? 'YES' : 'NO'}`);
  console.log(`  Brier improvement: ${brierImprovement.toFixed(4)}`);
  console.log(`  CI overlap with baseline: ${ciOverlap ? 'YES (result may be noise)' : 'NO (result is significant)'}`);

  // Sprint 8: Vegas comparison (council mandate — instrumentation only)
  console.log('\nComputing Vegas baseline comparison...');
  const vegasComparison = computeVegasComparison(sport);
  console.log(`  Vegas matched games: ${vegasComparison.sampleSize}`);
  if (vegasComparison.preliminary) {
    console.log(`  ⚠ ${vegasComparison.note}`);
  }
  if (vegasComparison.vegas) {
    console.log(`  Vegas accuracy: ${(vegasComparison.vegas.accuracy * 100).toFixed(1)}% [${(vegasComparison.vegas.accuracyCI95[0] * 100).toFixed(1)}%, ${(vegasComparison.vegas.accuracyCI95[1] * 100).toFixed(1)}%]`);
    console.log(`  Vegas Brier: ${vegasComparison.vegas.brier.toFixed(4)}`);
  }

  // Save artifact (Sprint 8: schemaVersion 2 — adds vegas field)
  const artifact = {
    schemaVersion: 2,
    sport,
    runAt: new Date().toISOString(),
    trainCutoffSeason: 2023,
    iterations: results,
    vegas: vegasComparison,
    summary: {
      bestIteration: best.iterationId,
      baselineBrier: baseline.test.brier,
      bestBrier: best.test.brier,
      improvement: brierImprovement,
      beatBaseline,
      significanceNote: ciOverlap
        ? 'Bootstrap CIs overlap with baseline — improvement may not be statistically significant'
        : 'Bootstrap CIs do not overlap — improvement is statistically significant',
    },
  };

  const artifactPath = join(process.env.SQLITE_PATH ? '/app/data/ratchet' : 'data/ratchet', `${sport}-ratchet.json`);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log(`\n  ✓ Artifact saved: ${artifactPath}`);

  closeDb();
}

main();
