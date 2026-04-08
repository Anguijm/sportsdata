/**
 * Predictions resolver — walks unresolved predictions and marks them correct/incorrect.
 *
 * Council mandate: wait until game is `final` AND >2 hours old before resolving.
 * NBA games get stat-corrected hours after the buzzer; locking too early = wrong data.
 */

import { getDb } from '../storage/sqlite.js';
import type { Sport } from '../schema/provenance.js';

const RESOLUTION_DELAY_HOURS = 2;

interface UnresolvedPrediction {
  id: string;
  game_id: string;
  sport: Sport;
  predicted_winner: string;
  predicted_prob: number;
  low_confidence: number;
  /** SQL aliases gr.winner as actual_winner */
  actual_winner: string;
  resolved_at: string;
}

export interface ResolveResult {
  resolved: number;
  correct: number;
  stillPending: number;
}

export function resolvePredictions(sport?: Sport): ResolveResult {
  const db = getDb();
  const now = Date.now();
  const cutoffTime = new Date(now - RESOLUTION_DELAY_HOURS * 60 * 60 * 1000).toISOString();

  // Sprint 8.5: Cross-namespace matching by (sport, date, home, away).
  // Predictions are made against BDL game IDs (`nba:bdl-...`) but ESPN scrapes
  // create new rows under ESPN IDs (`nba:401...`). The SAME physical game can
  // have two rows. Match by composite natural key instead of game_id.
  //
  // Council debt: track canonical_game_id schema migration as Sprint 9 P0.
  // Council mandate: index on games(sport, date, home_team_id, away_team_id) added.
  // Council mandate: NBA-only scope tested first, MLB doubleheader risk acknowledged.
  const sportFilter = sport ? 'AND p.sport = ?' : '';
  const params: unknown[] = [cutoffTime];
  if (sport) params.push(sport);

  // Allow ±1 day on date match because ESPN dates are UTC of game start;
  // a 7pm PT game becomes 3am UTC next day, but BDL labels it as the local date.
  const candidates = db.prepare(`
    SELECT p.id, p.game_id, p.sport, p.predicted_winner, p.predicted_prob, p.low_confidence,
           gr.winner as actual_winner, gr.resolved_at
    FROM predictions p
    JOIN games pg ON p.game_id = pg.id
    JOIN games gg ON gg.sport = pg.sport
                 AND gg.home_team_id = pg.home_team_id
                 AND gg.away_team_id = pg.away_team_id
                 AND ABS(julianday(gg.date) - julianday(pg.date)) <= 1
                 AND gg.id != pg.id
    JOIN game_results gr ON gr.game_id = gg.id
    WHERE p.resolved_at IS NULL
      AND gr.resolved_at < ?
      ${sportFilter}
    LIMIT 500
  `).all(...params) as UnresolvedPrediction[];

  // Count still-pending predictions (game not yet final or too fresh)
  const pendingParams: unknown[] = [];
  if (sport) pendingParams.push(sport);
  const pendingResult = db.prepare(`
    SELECT COUNT(DISTINCT p.id) as count FROM predictions p
    JOIN games pg ON p.game_id = pg.id
    LEFT JOIN games gg ON gg.sport = pg.sport
                       AND gg.home_team_id = pg.home_team_id
                       AND gg.away_team_id = pg.away_team_id
                       AND ABS(julianday(gg.date) - julianday(pg.date)) <= 1
                       AND gg.id != pg.id
    LEFT JOIN game_results gr ON gr.game_id = gg.id
    WHERE p.resolved_at IS NULL
      AND (gr.game_id IS NULL OR gr.resolved_at >= ?)
      ${sportFilter}
  `).get(cutoffTime, ...pendingParams) as { count: number };

  const updateStmt = db.prepare(`
    UPDATE predictions
    SET resolved_at = ?,
        actual_winner = ?,
        was_correct = ?,
        brier_score = ?
    WHERE id = ?
  `);

  const resolveAll = db.transaction((items: typeof candidates) => {
    let correct = 0;
    const resolveTime = new Date().toISOString();
    for (const c of items) {
      const wasCorrect = c.predicted_winner === c.actual_winner ? 1 : 0;
      // Brier score for this single prediction:
      // outcome = 1 if predicted side won, 0 otherwise
      // brier = (predicted_prob - outcome)^2
      const outcome = wasCorrect;
      const brier = (c.predicted_prob - outcome) ** 2;

      updateStmt.run(resolveTime, c.actual_winner, wasCorrect, brier, c.id);
      if (wasCorrect) correct++;
    }
    return correct;
  });

  const correct = resolveAll(candidates);

  return {
    resolved: candidates.length,
    correct,
    stillPending: pendingResult.count,
  };
}

export interface TrackRecordCohort {
  source: 'live' | 'backfill';
  resolved: number;
  correct: number;
  accuracy: number;
  avgBrier: number;
  lowConfidenceResolved: number;
  lowConfidenceCorrect: number;
}

export interface TrackRecord {
  modelVersion: string;
  sport: string;
  // Council mandate (UX): SEPARATE cohorts, never merged
  live: TrackRecordCohort;
  backfill: TrackRecordCohort;
  // Backwards-compat top-level fields = LIVE cohort only (so old frontends don't show backfill as live)
  resolved: number;
  correct: number;
  accuracy: number;
  avgBrier: number;
  lowConfidenceResolved: number;
  lowConfidenceCorrect: number;
}

function getCohort(sport: Sport, modelVersion: string, source: 'live' | 'backfill'): TrackRecordCohort {
  const db = getDb();

  const main = db.prepare(`
    SELECT COUNT(*) as resolved,
           SUM(was_correct) as correct,
           AVG(brier_score) as avg_brier
    FROM predictions
    WHERE sport = ? AND model_version = ?
      AND COALESCE(prediction_source, 'live') = ?
      AND resolved_at IS NOT NULL
      AND low_confidence = 0
  `).get(sport, modelVersion, source) as { resolved: number; correct: number; avg_brier: number };

  const lowConf = db.prepare(`
    SELECT COUNT(*) as resolved, SUM(was_correct) as correct
    FROM predictions
    WHERE sport = ? AND model_version = ?
      AND COALESCE(prediction_source, 'live') = ?
      AND resolved_at IS NOT NULL
      AND low_confidence = 1
  `).get(sport, modelVersion, source) as { resolved: number; correct: number };

  const resolved = main.resolved ?? 0;
  const correct = main.correct ?? 0;

  return {
    source,
    resolved,
    correct,
    accuracy: resolved > 0 ? correct / resolved : 0,
    avgBrier: main.avg_brier ?? 0,
    lowConfidenceResolved: lowConf.resolved ?? 0,
    lowConfidenceCorrect: lowConf.correct ?? 0,
  };
}

export function getTrackRecord(sport: Sport, modelVersion = 'v2'): TrackRecord {
  const live = getCohort(sport, modelVersion, 'live');
  const backfill = getCohort(sport, modelVersion, 'backfill');

  return {
    modelVersion,
    sport,
    live,
    backfill,
    // Backwards-compat top-level = live only (UX mandate: never merge)
    resolved: live.resolved,
    correct: live.correct,
    accuracy: live.accuracy,
    avgBrier: live.avgBrier,
    lowConfidenceResolved: live.lowConfidenceResolved,
    lowConfidenceCorrect: live.lowConfidenceCorrect,
  };
}

// =============================================================================
// CALIBRATION (Sprint 10)
// =============================================================================
//
// Council mandate (Researcher): bin predicted_prob in [0.5, 1.0]; the predicted
// winner's probability is always >= 0.5 (verified at predict-runner.ts:228).
// Bin edges are [low, high) except the terminal bin which is [low, high] closed
// to capture predicted_prob = 1.0.
//
// Council mandate (Engineer): parameterize SQL, fetch all rows once, bin in JS.
// Wilson 95% CI per bin (handles n=0 and n=1 without divide-by-zero).
//
// Council mandate (Designer): include low_confidence rows in primary ECE
// (calibration is exactly the venue for honest uncertainty), but expose
// eceHighConfOnly as a secondary stat to honor the Engineer's instinct.

export interface CalibrationBin {
  binLow: number;
  binHigh: number;
  n: number;
  empty: boolean;
  predictedAvg: number; // mean predicted_prob in bin
  actualRate: number; // correct/n
  ciLow: number; // Wilson 95% lower bound
  ciHigh: number; // Wilson 95% upper bound
}

export interface CalibrationCohort {
  source: 'live' | 'backfill';
  n: number;
  bins: CalibrationBin[];
  populatedBins: number;
  ece: number | null;
  eceHighConfOnly: number | null;
  signedResidual: number | null; // mean(predicted - actual) — positive => overconfident
  // Council mandate (Researcher impl review): when populatedBins <= 2 the
  // verdict noun misleads — calibration curve has no curvature to inspect.
  // In that case verdict becomes 'DISCRETE'.
  verdict: 'HONEST' | 'OVERCONFIDENT' | 'SHY' | 'DISCRETE' | null;
}

export interface Calibration {
  modelVersion: string;
  sport: string;
  binCount: number;
  live: CalibrationCohort;
  backfill: CalibrationCohort;
}

interface CalibrationRow {
  predicted_prob: number;
  was_correct: number;
  low_confidence: number;
}

/** Wilson 95% CI for binomial proportion p̂ = k/n. Stable for n ∈ {0,1}. */
function wilsonCI(k: number, n: number): { center: number; lo: number; hi: number } {
  const z = 1.96;
  if (n <= 0) return { center: 0, lo: 0, hi: 1 };
  const phat = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;
  return { center, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

function emptyCohort(source: 'live' | 'backfill', binCount: number): CalibrationCohort {
  const binWidth = 0.5 / binCount;
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const lo = 0.5 + i * binWidth;
    bins.push({
      binLow: lo,
      binHigh: lo + binWidth,
      n: 0,
      empty: true,
      predictedAvg: lo + binWidth / 2,
      actualRate: 0,
      ciLow: 0,
      ciHigh: 1,
    });
  }
  return {
    source,
    n: 0,
    bins,
    populatedBins: 0,
    ece: null,
    eceHighConfOnly: null,
    signedResidual: null,
    verdict: null,
  };
}

function computeCohort(
  rows: CalibrationRow[],
  source: 'live' | 'backfill',
  binCount: number,
): CalibrationCohort {
  if (rows.length === 0) return emptyCohort(source, binCount);

  const binWidth = 0.5 / binCount; // 0.5 → 1.0 split into binCount buckets
  const buckets: { sumPred: number; correct: number; n: number }[] = Array.from(
    { length: binCount },
    () => ({ sumPred: 0, correct: 0, n: 0 }),
  );

  for (const row of rows) {
    const p = row.predicted_prob;
    if (p < 0.5 || p > 1.0) continue; // defensive: shouldn't happen given convention
    let idx = Math.floor((p - 0.5) / binWidth);
    if (idx >= binCount) idx = binCount - 1; // terminal bin closed on both ends
    buckets[idx]!.sumPred += p;
    buckets[idx]!.correct += row.was_correct;
    buckets[idx]!.n += 1;
  }

  const bins: CalibrationBin[] = buckets.map((b, i) => {
    const lo = 0.5 + i * binWidth;
    const hi = lo + binWidth;
    if (b.n === 0) {
      return {
        binLow: lo,
        binHigh: hi,
        n: 0,
        empty: true,
        predictedAvg: lo + binWidth / 2,
        actualRate: 0,
        ciLow: 0,
        ciHigh: 1,
      };
    }
    const predictedAvg = b.sumPred / b.n;
    const actualRate = b.correct / b.n;
    const wilson = wilsonCI(b.correct, b.n);
    return {
      binLow: lo,
      binHigh: hi,
      n: b.n,
      empty: false,
      predictedAvg,
      actualRate,
      ciLow: wilson.lo,
      ciHigh: wilson.hi,
    };
  });

  // ECE: sum_i (n_i / N_total) * |predicted_avg_i - actual_rate_i|, non-empty bins only
  const nonEmpty = bins.filter(b => !b.empty);
  const nTotal = nonEmpty.reduce((a, b) => a + b.n, 0);
  const ece = nTotal > 0
    ? nonEmpty.reduce((acc, b) => acc + (b.n / nTotal) * Math.abs(b.predictedAvg - b.actualRate), 0)
    : null;

  // ECE excluding low_confidence rows (Engineer's secondary stat)
  const highConfRows = rows.filter(r => r.low_confidence === 0);
  let eceHighConfOnly: number | null = null;
  if (highConfRows.length > 0) {
    const hcBuckets: { sumPred: number; correct: number; n: number }[] = Array.from(
      { length: binCount },
      () => ({ sumPred: 0, correct: 0, n: 0 }),
    );
    for (const row of highConfRows) {
      let idx = Math.floor((row.predicted_prob - 0.5) / binWidth);
      if (idx >= binCount) idx = binCount - 1;
      if (idx < 0) continue;
      hcBuckets[idx]!.sumPred += row.predicted_prob;
      hcBuckets[idx]!.correct += row.was_correct;
      hcBuckets[idx]!.n += 1;
    }
    const hcNonEmpty = hcBuckets.filter(b => b.n > 0);
    const hcN = hcNonEmpty.reduce((a, b) => a + b.n, 0);
    if (hcN > 0) {
      eceHighConfOnly = hcNonEmpty.reduce((acc, b) => {
        const pAvg = b.sumPred / b.n;
        const aRate = b.correct / b.n;
        return acc + (b.n / hcN) * Math.abs(pAvg - aRate);
      }, 0);
    }
  }

  // Signed residual: mean(predicted - actual) over non-empty bins, weighted by n
  const signedResidual = nTotal > 0
    ? nonEmpty.reduce((acc, b) => acc + (b.n / nTotal) * (b.predictedAvg - b.actualRate), 0)
    : null;

  // Verdict word (Designer + Researcher mandates).
  // Researcher impl review: when ≤2 bins populated, signed-residual math is
  // valid but the curve verdict misleads — surface DISCRETE instead.
  let verdict: CalibrationCohort['verdict'] = null;
  const populatedBins = nonEmpty.length;
  if (populatedBins <= 2 && populatedBins > 0) {
    verdict = 'DISCRETE';
  } else if (signedResidual !== null) {
    if (signedResidual > 0.02) verdict = 'OVERCONFIDENT';
    else if (signedResidual < -0.02) verdict = 'SHY';
    else verdict = 'HONEST';
  }

  return {
    source,
    n: rows.length,
    bins,
    populatedBins,
    ece,
    eceHighConfOnly,
    signedResidual,
    verdict,
  };
}

export function getCalibration(sport: Sport, modelVersion = 'v2', binCount = 10): Calibration {
  const db = getDb();
  const fetchRows = (source: 'live' | 'backfill'): CalibrationRow[] =>
    db.prepare(`
      SELECT predicted_prob, was_correct, low_confidence
      FROM predictions
      WHERE sport = ? AND model_version = ?
        AND COALESCE(prediction_source, 'live') = ?
        AND resolved_at IS NOT NULL
        AND was_correct IS NOT NULL
    `).all(sport, modelVersion, source) as CalibrationRow[];

  const liveRows = fetchRows('live');
  const backfillRows = fetchRows('backfill');

  return {
    modelVersion,
    sport,
    binCount,
    live: computeCohort(liveRows, 'live', binCount),
    backfill: computeCohort(backfillRows, 'backfill', binCount),
  };
}

export interface PredictionWithGame {
  id: string;
  game_id: string;
  sport: string;
  model_version: string;
  predicted_winner: string;
  predicted_prob: number;
  reasoning_text: string;
  made_at: string;
  resolved_at: string | null;
  actual_winner: string | null;
  was_correct: number | null;
  brier_score: number | null;
  low_confidence: number;
  game_date: string;
  home_team_id: string;
  away_team_id: string;
  game_status: string;
}

export function getUpcomingPredictions(sport: Sport, limit = 20): PredictionWithGame[] {
  const db = getDb();
  return db.prepare(`
    SELECT p.id, p.game_id, p.sport, p.model_version, p.predicted_winner,
           p.predicted_prob, p.reasoning_text, p.made_at, p.resolved_at,
           p.actual_winner, p.was_correct, p.brier_score, p.low_confidence,
           g.date as game_date, g.home_team_id, g.away_team_id, g.status as game_status
    FROM predictions p
    JOIN games g ON p.game_id = g.id
    WHERE p.sport = ? AND p.resolved_at IS NULL
    ORDER BY g.date
    LIMIT ?
  `).all(sport, limit) as PredictionWithGame[];
}

export function getRecentResolvedPredictions(sport: Sport, limit = 20): PredictionWithGame[] {
  const db = getDb();
  return db.prepare(`
    SELECT p.id, p.game_id, p.sport, p.model_version, p.predicted_winner,
           p.predicted_prob, p.reasoning_text, p.made_at, p.resolved_at,
           p.actual_winner, p.was_correct, p.brier_score, p.low_confidence,
           g.date as game_date, g.home_team_id, g.away_team_id, g.status as game_status
    FROM predictions p
    JOIN games g ON p.game_id = g.id
    WHERE p.sport = ? AND p.resolved_at IS NOT NULL
    ORDER BY p.resolved_at DESC
    LIMIT ?
  `).all(sport, limit) as PredictionWithGame[];
}
