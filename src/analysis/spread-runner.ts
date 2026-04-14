/**
 * Spread prediction runner — applies the v4-spread margin model to upcoming
 * scheduled games that have odds data, compares predicted margin against the
 * bookmaker spread, and stores picks in the predictions table.
 *
 * Coexists with v2 winner-prediction. Same predictions table, different
 * model_version ('v4-spread'). Idempotent UPSERT on (game_id, model_version).
 *
 * Council mandate: reasoning_json stores the full spread comparison so
 * resolution can check pick_side against game_results.spread_result.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../storage/sqlite.js';
import type { Sport } from '../schema/provenance.js';
import type { GameOdds } from '../schema/game.js';
import { predictMargin, compareToSpread } from './predict.js';
import type { ConfidenceTier, SpreadComparison, PitcherMatchup, InjuryImpact } from './predict.js';
import { buildTeamStateUpTo, computeInjuryImpact } from './predict-runner.js';
import type { PredictionRecord } from './predict-runner.js';

interface ScheduledGameWithOdds {
  id: string;
  date: string;
  sport: Sport;
  home_team_id: string;
  away_team_id: string;
  odds_json: string;
  pitchers_json: string | null;
}

interface SpreadReasoningJson {
  model: 'v4-spread';
  features: {
    home_wins: number;
    home_losses: number;
    home_diff_per_game: number;
    away_wins: number;
    away_losses: number;
    away_diff_per_game: number;
    home_cold_streak: boolean;
    away_hot_streak: boolean;
    low_confidence: boolean;
    /** Total PPG/points-equivalent of recently-out home players (0 if no data) */
    home_out_impact: number;
    /** Total PPG/points-equivalent of recently-out away players (0 if no data) */
    away_out_impact: number;
  };
  spread: {
    predicted_margin: number;
    spread_line: number;
    edge: number;
    abs_edge: number;
    confidence_tier: ConfidenceTier;
    pick_side: 'home' | 'away';
    spread_source: string;
    spread_as_of: string;
  };
}

/** Map confidence tier to a pseudo-probability for Brier scoring compatibility.
 *  Council mandate: these are STARTING PRIORS, not calibrated values. Against-
 *  the-spread accuracy clusters tightly around 50% even for good models.
 *  Recalibrate once N > 200 resolved picks per tier. */
const TIER_PROB: Record<ConfidenceTier, number> = {
  strong: 0.58,
  lean: 0.54,
  skip: 0.51,
};

function generateSpreadReasoningText(
  comparison: SpreadComparison,
  homeAbbr: string,
  awayAbbr: string,
  lowConfidence: boolean,
): string {
  const { predictedMargin, spreadLine, edge, confidenceTier, pickSide } = comparison;
  const pickAbbr = pickSide === 'home' ? homeAbbr : awayAbbr;

  // Format the spread line for display
  const spreadStr = spreadLine < 0
    ? `${homeAbbr} ${spreadLine.toFixed(1)}`
    : `${awayAbbr} ${(-spreadLine).toFixed(1)}`;

  const marginStr = predictedMargin >= 0
    ? `${homeAbbr} by ${predictedMargin.toFixed(1)}`
    : `${awayAbbr} by ${(-predictedMargin).toFixed(1)}`;

  if (lowConfidence) {
    return `Spread pick: ${pickAbbr} (${spreadStr}). Low confidence — limited season data. Model margin: ${marginStr}, edge: ${Math.abs(edge).toFixed(1)}.`;
  }

  const tierLabel = confidenceTier === 'strong' ? 'Strong'
    : confidenceTier === 'lean' ? 'Lean' : 'Marginal';

  return `Spread pick: ${pickAbbr} to cover (line: ${spreadStr}). Model says ${marginStr}. Edge: ${Math.abs(edge).toFixed(1)} pts. ${tierLabel} confidence.`;
}

/** Run spread predictions for all upcoming scheduled games with odds data. */
export function predictUpcomingSpreads(sport: Sport): { predictions: PredictionRecord[]; skipped: number } {
  const db = getDb();

  const today = new Date().toISOString().slice(0, 10);
  const scheduledGames = db.prepare(`
    SELECT id, date, sport, home_team_id, away_team_id, odds_json, pitchers_json
    FROM games
    WHERE sport = ? AND status = 'scheduled' AND date >= ? AND odds_json IS NOT NULL
    ORDER BY date
    LIMIT 50
  `).all(sport, today) as ScheduledGameWithOdds[];

  if (scheduledGames.length === 0) {
    return { predictions: [], skipped: 0 };
  }

  const asOfDate = new Date().toISOString();
  const states = buildTeamStateUpTo(sport, asOfDate);

  const predictions: PredictionRecord[] = [];
  let skipped = 0;

  const existingStmt = db.prepare(
    'SELECT 1 FROM predictions WHERE game_id = ? AND model_version = ?'
  );

  for (const game of scheduledGames) {
    if (existingStmt.get(game.id, 'v4-spread')) {
      skipped++;
      continue;
    }

    // Parse odds
    let odds: GameOdds;
    try {
      odds = JSON.parse(game.odds_json) as GameOdds;
    } catch {
      skipped++;
      continue;
    }

    if (!odds.spread?.favorite || odds.spread?.line == null) {
      skipped++;
      continue;
    }

    // Build context
    const homeState = states.get(game.home_team_id) ?? {
      games: 0, wins: 0, losses: 0,
      pointsFor: 0, pointsAgainst: 0, lastNResults: [],
    };
    const awayState = states.get(game.away_team_id) ?? {
      games: 0, wins: 0, losses: 0,
      pointsFor: 0, pointsAgainst: 0, lastNResults: [],
    };

    const ctx = { home: homeState, away: awayState, asOfDate };
    const lowConfidence = homeState.games < 5 || awayState.games < 5;

    // Parse pitcher data for MLB
    let pitchers: PitcherMatchup | undefined;
    if (game.sport === 'mlb' && game.pitchers_json) {
      try {
        const pj = JSON.parse(game.pitchers_json) as { home?: { era: number }; away?: { era: number } };
        if (pj.home?.era && pj.away?.era) {
          pitchers = { homeEra: pj.home.era, awayEra: pj.away.era };
        }
      } catch { /* ignore */ }
    }

    // Compute injury impact (same orthogonal signal used by v5 winner model).
    // When key players are out, the expected margin shifts — without this,
    // v4-spread predicts a margin as if the injured player is playing, so
    // the ATS edge is stale in exactly the cases that matter most.
    const injuries: InjuryImpact = {
      homeOutImpact: computeInjuryImpact(game.sport, game.home_team_id),
      awayOutImpact: computeInjuryImpact(game.sport, game.away_team_id),
    };
    const hasInjuryData = injuries.homeOutImpact > 0 || injuries.awayOutImpact > 0;

    // Predict margin
    const margin = predictMargin(
      {
        game_id: game.id,
        date: game.date,
        sport: game.sport,
        home_team_id: game.home_team_id,
        away_team_id: game.away_team_id,
        home_win: 0,
      },
      ctx,
      pitchers,
      hasInjuryData ? injuries : undefined,
    );

    // Compare to spread
    const comparison = compareToSpread(
      margin,
      odds.spread.favorite,
      odds.spread.line,
      game.home_team_id,
      game.sport,
    );

    // Build reasoning
    const homeDiff = homeState.games > 0 ? (homeState.pointsFor - homeState.pointsAgainst) / homeState.games : 0;
    const awayDiff = awayState.games > 0 ? (awayState.pointsFor - awayState.pointsAgainst) / awayState.games : 0;
    const homeColdStreak = homeState.lastNResults.length >= 3 &&
      homeState.lastNResults.slice(-3).every(r => !r);
    const awayHotStreak = awayState.lastNResults.length >= 3 &&
      awayState.lastNResults.slice(-3).every(r => r);

    const reasoning: SpreadReasoningJson = {
      model: 'v4-spread',
      features: {
        home_wins: homeState.wins,
        home_losses: homeState.losses,
        home_diff_per_game: homeDiff,
        away_wins: awayState.wins,
        away_losses: awayState.losses,
        away_diff_per_game: awayDiff,
        home_cold_streak: homeColdStreak,
        away_hot_streak: awayHotStreak,
        low_confidence: lowConfidence,
        home_out_impact: hasInjuryData ? injuries.homeOutImpact : 0,
        away_out_impact: hasInjuryData ? injuries.awayOutImpact : 0,
      },
      spread: {
        predicted_margin: comparison.predictedMargin,
        spread_line: comparison.spreadLine,
        edge: comparison.edge,
        abs_edge: comparison.absEdge,
        confidence_tier: comparison.confidenceTier,
        pick_side: comparison.pickSide,
        spread_source: odds.source ?? 'unknown',
        spread_as_of: odds.asOf ?? asOfDate,
      },
    };

    const homeAbbr = game.home_team_id.split(':')[1] ?? game.home_team_id;
    const awayAbbr = game.away_team_id.split(':')[1] ?? game.away_team_id;
    const reasoningText = generateSpreadReasoningText(comparison, homeAbbr, awayAbbr, lowConfidence);

    const pickTeamId = comparison.pickSide === 'home' ? game.home_team_id : game.away_team_id;

    predictions.push({
      id: randomUUID(),
      game_id: game.id,
      sport: game.sport,
      model_version: 'v4-spread',
      predicted_winner: pickTeamId,
      predicted_prob: TIER_PROB[comparison.confidenceTier],
      reasoning_json: JSON.stringify(reasoning),
      reasoning_text: reasoningText,
      made_at: asOfDate,
      team_state_as_of: asOfDate,
      low_confidence: lowConfidence ? 1 : 0,
    });
  }

  // Persist
  const insertStmt = db.prepare(`
    INSERT INTO predictions (
      id, game_id, sport, model_version, prediction_source,
      predicted_winner, predicted_prob,
      reasoning_json, reasoning_text,
      made_at, team_state_as_of, low_confidence
    ) VALUES (?, ?, ?, ?, 'live', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (game_id, model_version, prediction_source) DO NOTHING
  `);

  const insertAll = db.transaction((items: PredictionRecord[]) => {
    for (const p of items) {
      insertStmt.run(
        p.id, p.game_id, p.sport, p.model_version,
        p.predicted_winner, p.predicted_prob,
        p.reasoning_json, p.reasoning_text,
        p.made_at, p.team_state_as_of, p.low_confidence
      );
    }
  });

  insertAll(predictions);
  return { predictions, skipped };
}
