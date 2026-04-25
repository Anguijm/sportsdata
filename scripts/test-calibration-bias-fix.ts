/**
 * Test for debt #31: getCalibration / computeCohort no longer drops
 * away-picked predictions.
 *
 * Same class of bug PR #30 fixed in reliability.ts. The pre-fix
 * computeCohort used `if (p < 0.5 || p > 1.0) continue` which silently
 * dropped every prediction where the model favored the away team — biasing
 * live ECE toward home-favored predictions only.
 *
 * Post-fix: confidence-in-pick transform (`p < 0.5` → `1 - p`) so both
 * sides contribute. `was_correct` already reflects correct-against-pick
 * (per resolveDuePredictions:165 for non-spread models), so we use it
 * directly.
 *
 * Run: npx tsx scripts/test-calibration-bias-fix.ts
 */

import { computeCohort, type CalibrationRow } from '../src/analysis/resolve-predictions.js';

let failures = 0;
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failures++;
  } else {
    console.log(`PASS ${label}`);
  }
}
function assertTrue(cond: boolean, label: string): void {
  if (!cond) { console.error(`FAIL ${label}`); failures++; } else console.log(`PASS ${label}`);
}
function assertNear(actual: number, expected: number, tol: number, label: string): void {
  if (Math.abs(actual - expected) > tol) {
    console.error(`FAIL ${label}: expected ${expected}±${tol}, got ${actual}`);
    failures++;
  } else {
    console.log(`PASS ${label} (${actual.toFixed(4)})`);
  }
}

// --- Scenario 1: away-picked rows are NOT dropped ---
// 4 home-favored predictions (p = 0.7, all correct) + 4 away-favored
// predictions (p = 0.3, all correct). Both sets have confidence-in-pick = 0.7.
// Pre-fix: only 4 rows would land in some bin. Post-fix: all 8 do.
// Use binCount=2 to dodge float-precision issues at the bin boundary.
{
  const rows: CalibrationRow[] = [
    { predicted_prob: 0.7, was_correct: 1, low_confidence: 0 },
    { predicted_prob: 0.7, was_correct: 1, low_confidence: 0 },
    { predicted_prob: 0.7, was_correct: 1, low_confidence: 0 },
    { predicted_prob: 0.7, was_correct: 1, low_confidence: 0 },
    { predicted_prob: 0.3, was_correct: 1, low_confidence: 0 }, // away-picked, away won
    { predicted_prob: 0.3, was_correct: 1, low_confidence: 0 },
    { predicted_prob: 0.3, was_correct: 1, low_confidence: 0 },
    { predicted_prob: 0.3, was_correct: 1, low_confidence: 0 },
  ];
  const c = computeCohort(rows, 'live', 2); // binCount=2 → bin 0 = [0.5, 0.75], bin 1 = [0.75, 1.0]
  assertEq(c.n, 8, 'scenario 1: n = 8 (all rows kept; pre-fix would have been 4)');
  // All 8 rows land in bin 0 (confidence 0.7 ∈ [0.5, 0.75])
  const bin0 = c.bins[0];
  assertEq(bin0.n, 8, 'scenario 1: all 8 rows landed in bin [0.5, 0.75]');
  assertNear(bin0.predictedAvg, 0.7, 1e-9, 'scenario 1: predictedAvg = 0.7 (mean confidence)');
  assertEq(bin0.actualRate, 1, 'scenario 1: actualRate = 1.0 (all correct)');
  // Total population must equal n
  const totalN = c.bins.reduce((s, b) => s + b.n, 0);
  assertEq(totalN, 8, 'scenario 1: bins sum to 8');
}

// --- Scenario 2: away-picked confidence transform → high bin ---
// p=0.85 (home-picked, conf 0.85) and p=0.15 (away-picked, conf 0.85) should
// land in the SAME bin. binCount=2 → both go to bin 1 ([0.75, 1.0]).
{
  const rows: CalibrationRow[] = [
    { predicted_prob: 0.85, was_correct: 1, low_confidence: 0 },
    { predicted_prob: 0.15, was_correct: 0, low_confidence: 0 }, // away-picked, away LOST
  ];
  const c = computeCohort(rows, 'live', 2);
  assertEq(c.n, 2, 'scenario 2: n = 2 (both kept)');
  const bin1 = c.bins[1];
  assertEq(bin1.n, 2, 'scenario 2: both rows in bin [0.75, 1.0]');
  assertEq(bin1.actualRate, 0.5, 'scenario 2: actualRate = 0.5 (1 of 2 correct)');
  assertNear(bin1.predictedAvg, 0.85, 1e-9, 'scenario 2: predictedAvg = 0.85');
}

// --- Scenario 3: high-confidence ECE also fixed ---
// Same as scenario 1 but mark half low-confidence; eceHighConfOnly should
// only see the 4 high-conf rows (2 home-picked + 2 away-picked).
{
  const rows: CalibrationRow[] = [
    { predicted_prob: 0.7, was_correct: 1, low_confidence: 0 },
    { predicted_prob: 0.7, was_correct: 1, low_confidence: 0 },
    { predicted_prob: 0.7, was_correct: 1, low_confidence: 1 },
    { predicted_prob: 0.7, was_correct: 1, low_confidence: 1 },
    { predicted_prob: 0.3, was_correct: 1, low_confidence: 0 },
    { predicted_prob: 0.3, was_correct: 1, low_confidence: 0 },
    { predicted_prob: 0.3, was_correct: 1, low_confidence: 1 },
    { predicted_prob: 0.3, was_correct: 1, low_confidence: 1 },
  ];
  const c = computeCohort(rows, 'live', 10);
  // ECE should be ~0 (all rows hit the same bin with predicted = actual = 0.7
  // and 1.0 respectively → |0.7 - 1.0| = 0.3 weighted by 8/8 = 0.3).
  // Actually predictedAvg = 0.7, actualRate = 1.0, so |0.7 - 1.0| = 0.3.
  assertNear(c.ece ?? -1, 0.3, 1e-9, 'scenario 3: ECE = 0.3 (overconfident pick at p=0.7, all correct)');
  // High-conf-only: 4 rows (2 home-picked + 2 away-picked). Same predicted/actual.
  assertNear(c.eceHighConfOnly ?? -1, 0.3, 1e-9, 'scenario 3: eceHighConfOnly = 0.3 (low-conf rows excluded, both sides included)');
}

// --- Scenario 4: malformed inputs are skipped (defensive) ---
{
  const rows: CalibrationRow[] = [
    { predicted_prob: 0.7, was_correct: 1, low_confidence: 0 },
    { predicted_prob: NaN, was_correct: 1, low_confidence: 0 },
    { predicted_prob: -0.1, was_correct: 1, low_confidence: 0 },
    { predicted_prob: 1.5, was_correct: 1, low_confidence: 0 },
  ];
  const c = computeCohort(rows, 'live', 10);
  // Only the first row is valid
  const populated = c.bins.filter(b => !b.empty).reduce((acc, b) => acc + b.n, 0);
  assertEq(populated, 1, 'scenario 4: only 1 valid row contributed (NaN, <0, >1 skipped)');
}

// --- Scenario 5: empty input ---
{
  const c = computeCohort([], 'live', 10);
  assertEq(c.n, 0, 'scenario 5: empty input → n=0');
  assertEq(c.ece, null, 'scenario 5: ECE = null on empty');
}

// --- Scenario 6: regression — pre-fix would produce different ECE ---
// Construct a case where home-favored predictions are well-calibrated but
// away-favored ones are overconfident. Pre-fix: ECE looks great because
// away-favored rows are dropped. Post-fix: ECE captures the overconfidence.
{
  const rows: CalibrationRow[] = [
    // 10 home-favored at p=0.6, 6 correct → actual = 0.6, perfectly calibrated
    ...Array.from({ length: 6 }, () => ({ predicted_prob: 0.6, was_correct: 1, low_confidence: 0 })),
    ...Array.from({ length: 4 }, () => ({ predicted_prob: 0.6, was_correct: 0, low_confidence: 0 })),
    // 10 away-favored at p=0.4 (confidence 0.6), only 3 correct → actual 0.3, way overconfident
    ...Array.from({ length: 3 }, () => ({ predicted_prob: 0.4, was_correct: 1, low_confidence: 0 })),
    ...Array.from({ length: 7 }, () => ({ predicted_prob: 0.4, was_correct: 0, low_confidence: 0 })),
  ];
  const c = computeCohort(rows, 'live', 10);
  assertEq(c.n, 20, 'scenario 6: all 20 rows kept');
  // All 20 land in bin [0.6, 0.65] (idx = 2).
  // predictedAvg = 0.6. actualRate = 9/20 = 0.45.
  // |0.6 - 0.45| = 0.15 → ECE = 0.15.
  assertNear(c.ece ?? -1, 0.15, 1e-9, 'scenario 6: ECE = 0.15 captures away-side overconfidence');
  // Pre-fix would have computed 6/10 = 0.6 actual, ECE = 0 (false signal).
  // Post-fix correctly flags the overconfidence.
  assertTrue((c.ece ?? 0) > 0.1, 'scenario 6: ECE > 0.1 (pre-fix would have been ~0)');
}

console.log();
if (failures === 0) {
  console.log('✓ All calibration-bias-fix assertions passed');
  process.exit(0);
} else {
  console.error(`✗ ${failures} assertion(s) failed`);
  process.exit(1);
}
