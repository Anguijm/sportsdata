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

  // Find unresolved predictions where the game is final + old enough
  const sportFilter = sport ? 'AND p.sport = ?' : '';
  const params: unknown[] = [cutoffTime];
  if (sport) params.push(sport);

  const candidates = db.prepare(`
    SELECT p.id, p.game_id, p.sport, p.predicted_winner, p.predicted_prob, p.low_confidence,
           gr.winner as actual_winner, gr.resolved_at
    FROM predictions p
    JOIN game_results gr ON p.game_id = gr.game_id
    WHERE p.resolved_at IS NULL
      AND gr.resolved_at < ?
      ${sportFilter}
  `).all(...params) as UnresolvedPrediction[];

  // Count still-pending predictions (game not yet final or too fresh)
  const pendingParams: unknown[] = [];
  if (sport) pendingParams.push(sport);
  const pendingResult = db.prepare(`
    SELECT COUNT(*) as count FROM predictions p
    LEFT JOIN game_results gr ON p.game_id = gr.game_id
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

export interface TrackRecord {
  modelVersion: string;
  sport: string;
  resolved: number;
  correct: number;
  accuracy: number;
  avgBrier: number;
  /** Excluded from main cohort: predictions made on low-state team data */
  lowConfidenceResolved: number;
  lowConfidenceCorrect: number;
}

export function getTrackRecord(sport: Sport, modelVersion = 'v2'): TrackRecord {
  const db = getDb();

  const main = db.prepare(`
    SELECT COUNT(*) as resolved,
           SUM(was_correct) as correct,
           AVG(brier_score) as avg_brier
    FROM predictions
    WHERE sport = ? AND model_version = ?
      AND resolved_at IS NOT NULL
      AND low_confidence = 0
  `).get(sport, modelVersion) as { resolved: number; correct: number; avg_brier: number };

  const lowConf = db.prepare(`
    SELECT COUNT(*) as resolved, SUM(was_correct) as correct
    FROM predictions
    WHERE sport = ? AND model_version = ?
      AND resolved_at IS NOT NULL
      AND low_confidence = 1
  `).get(sport, modelVersion) as { resolved: number; correct: number };

  const resolved = main.resolved ?? 0;
  const correct = main.correct ?? 0;

  return {
    modelVersion,
    sport,
    resolved,
    correct,
    accuracy: resolved > 0 ? correct / resolved : 0,
    avgBrier: main.avg_brier ?? 0,
    lowConfidenceResolved: lowConf.resolved ?? 0,
    lowConfidenceCorrect: lowConf.correct ?? 0,
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
