/**
 * Predict CLI — runs prediction service for a sport.
 *
 * Usage:
 *   npx tsx src/cli/predict.ts [sport]      # default: nba
 *   npx tsx src/cli/predict.ts nba          # predict + resolve NBA
 *
 * Cron-callable. Idempotent. Council-mandated to run twice daily (05:00 + 22:00 UTC).
 */

import type { Sport } from '../schema/provenance.js';
import { predictUpcoming } from '../analysis/predict-runner.js';
import { resolvePredictions, getTrackRecord } from '../analysis/resolve-predictions.js';
import { closeDb } from '../storage/sqlite.js';

const sport: Sport = (process.argv[2] as Sport) ?? 'nba';

function main() {
  console.log(`\n━━━ PREDICT RUN: ${sport.toUpperCase()} @ ${new Date().toISOString()} ━━━`);

  // Step 1: Resolve any predictions whose games are now final
  console.log('\nResolving completed predictions...');
  const resolveResult = resolvePredictions(sport);
  console.log(`  Resolved: ${resolveResult.resolved} (${resolveResult.correct} correct)`);
  console.log(`  Still pending: ${resolveResult.stillPending}`);

  // Step 2: Generate new predictions for upcoming games
  console.log('\nGenerating new predictions...');
  const predictResult = predictUpcoming(sport);
  console.log(`  Generated: ${predictResult.predictions.length}`);
  console.log(`  Skipped (already predicted): ${predictResult.skipped}`);

  if (predictResult.predictions.length > 0) {
    console.log('\nSample predictions:');
    for (const p of predictResult.predictions.slice(0, 5)) {
      console.log(`  ${p.reasoning_text}`);
    }
  }

  // Step 3: Show current track record
  console.log('\nCurrent track record (excluding low-confidence):');
  const tr = getTrackRecord(sport);
  if (tr.resolved === 0) {
    console.log(`  No resolved predictions yet (${tr.lowConfidenceResolved} low-confidence excluded)`);
  } else {
    console.log(`  ${tr.correct}-${tr.resolved - tr.correct} (${(tr.accuracy * 100).toFixed(1)}%)`);
    console.log(`  Avg Brier: ${tr.avgBrier.toFixed(4)}`);
    if (tr.lowConfidenceResolved > 0) {
      console.log(`  Excluded (low confidence): ${tr.lowConfidenceCorrect}-${tr.lowConfidenceResolved - tr.lowConfidenceCorrect}`);
    }
  }

  closeDb();
}

main();
