/**
 * Predict-runner — applies the v2 ratchet model to upcoming scheduled games.
 *
 * Council mandates honored:
 * - reasoning_json (re-renderable) + reasoning_text (display)
 * - team_state_as_of (snapshot timestamp, not insert time)
 * - low_confidence flag for <5 games of state
 * - "Model pick:" framing in text output
 * - Idempotent UPSERT on (game_id, model_version)
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../storage/sqlite.js';
import type { Sport } from '../schema/provenance.js';
import { v2 } from './predict.js';
import type { TeamState } from './predict.js';

export interface PredictionRecord {
  id: string;
  game_id: string;
  sport: Sport;
  model_version: string;
  predicted_winner: string;
  predicted_prob: number;
  reasoning_json: string;
  reasoning_text: string;
  made_at: string;
  team_state_as_of: string;
  low_confidence: 0 | 1;
}

interface ScheduledGame {
  id: string;
  date: string;
  sport: Sport;
  home_team_id: string;
  away_team_id: string;
}

interface ReasoningJson {
  model: string;
  features: {
    home_wins: number;
    home_losses: number;
    home_diff_per_game: number;
    away_wins: number;
    away_losses: number;
    away_diff_per_game: number;
    win_gap: number;
    diff_gap: number;
    low_confidence: boolean;
  };
  pick: 'home' | 'away';
  prob_home_wins: number;
}

/** Determine the season year (NBA: Oct-Jun, season starts in October) */
function nbaSeasonYear(date: string): number {
  const d = new Date(date);
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  return month >= 9 ? year : year - 1;
}

/** Build CURRENT-SEASON team state for the sport up to (and not including) a target date.
 *  Council mandate: we don't carry stale records across seasons. */
function buildTeamStateUpTo(sport: Sport, targetDate: string): Map<string, TeamState> {
  const db = getDb();

  // Determine the current season for the target date
  const currentSeason = nbaSeasonYear(targetDate);
  // Season window: October 1 of currentSeason → September 30 of next year
  const seasonStart = `${currentSeason}-10-01`;

  const rows = db.prepare(`
    SELECT date, winner, loser, home_score, away_score, home_win
    FROM game_results
    WHERE sport = ? AND date >= ? AND date < ?
    ORDER BY date
  `).all(sport, seasonStart, targetDate) as Array<{
    date: string; winner: string; loser: string;
    home_score: number; away_score: number; home_win: number;
  }>;

  const states = new Map<string, TeamState>();
  const init = (id: string): TeamState => {
    if (!states.has(id)) {
      states.set(id, {
        games: 0, wins: 0, losses: 0,
        pointsFor: 0, pointsAgainst: 0,
        lastNResults: [],
      });
    }
    return states.get(id)!;
  };

  for (const r of rows) {
    const homeId = r.home_win === 1 ? r.winner : r.loser;
    const awayId = r.home_win === 1 ? r.loser : r.winner;
    const homeState = init(homeId);
    const awayState = init(awayId);

    homeState.games++;
    awayState.games++;
    homeState.pointsFor += r.home_score;
    homeState.pointsAgainst += r.away_score;
    awayState.pointsFor += r.away_score;
    awayState.pointsAgainst += r.home_score;

    const homeWon = r.home_win === 1;
    if (homeWon) {
      homeState.wins++;
      awayState.losses++;
    } else {
      homeState.losses++;
      awayState.wins++;
    }
    homeState.lastNResults = [...homeState.lastNResults, homeWon].slice(-5);
    awayState.lastNResults = [...awayState.lastNResults, !homeWon].slice(-5);
  }

  return states;
}

/** Generate human-readable reasoning text from reasoning JSON */
function generateReasoningText(
  reasoning: ReasoningJson,
  homeAbbr: string,
  awayAbbr: string,
): string {
  const f = reasoning.features;
  const pickedAbbr = reasoning.pick === 'home' ? homeAbbr : awayAbbr;
  const otherAbbr = reasoning.pick === 'home' ? awayAbbr : homeAbbr;
  const confidence = reasoning.pick === 'home' ? reasoning.prob_home_wins : 1 - reasoning.prob_home_wins;

  if (f.low_confidence) {
    return `Model pick: ${pickedAbbr}. Low confidence — both teams have fewer than 5 games of season state. Defaulting to slight home edge. Confidence: ${(confidence * 100).toFixed(0)}%.`;
  }

  const parts: string[] = [`Model pick: ${pickedAbbr} over ${otherAbbr}.`];

  if (Math.abs(f.win_gap) >= 10) {
    const aheadAbbr = f.win_gap > 0 ? awayAbbr : homeAbbr;
    parts.push(`${aheadAbbr} has ${Math.abs(f.win_gap)} more wins (${f.win_gap > 0 ? f.away_wins : f.home_wins} vs ${f.win_gap > 0 ? f.home_wins : f.away_wins}).`);
  }

  if (Math.abs(f.diff_gap) >= 3) {
    const home_diff_str = f.home_diff_per_game >= 0 ? `+${f.home_diff_per_game.toFixed(1)}` : f.home_diff_per_game.toFixed(1);
    const away_diff_str = f.away_diff_per_game >= 0 ? `+${f.away_diff_per_game.toFixed(1)}` : f.away_diff_per_game.toFixed(1);
    parts.push(`Point differential: ${homeAbbr} ${home_diff_str}, ${awayAbbr} ${away_diff_str}.`);
  }

  if (parts.length === 1) {
    parts.push(`Records and point differentials are close — slight home court edge.`);
  }

  parts.push(`Confidence: ${(confidence * 100).toFixed(0)}%.`);
  return parts.join(' ');
}

/** Run v2 prediction on a single scheduled game */
export function predictGame(
  game: ScheduledGame,
  states: Map<string, TeamState>,
  asOfDate: string,
): PredictionRecord {
  const homeState = states.get(game.home_team_id) ?? {
    games: 0, wins: 0, losses: 0,
    pointsFor: 0, pointsAgainst: 0, lastNResults: [],
  };
  const awayState = states.get(game.away_team_id) ?? {
    games: 0, wins: 0, losses: 0,
    pointsFor: 0, pointsAgainst: 0, lastNResults: [],
  };

  const ctx = {
    home: homeState,
    away: awayState,
    asOfDate,
  };

  const probHome = v2.predict(
    {
      game_id: game.id,
      date: game.date,
      sport: game.sport,
      home_team_id: game.home_team_id,
      away_team_id: game.away_team_id,
      home_win: 0, // unknown — predictor must not use this
    },
    ctx,
  );

  const lowConfidence = homeState.games < 5 || awayState.games < 5;
  const pick = probHome >= 0.5 ? 'home' : 'away';
  const winnerId = pick === 'home' ? game.home_team_id : game.away_team_id;

  const homeDiff = homeState.games > 0 ? (homeState.pointsFor - homeState.pointsAgainst) / homeState.games : 0;
  const awayDiff = awayState.games > 0 ? (awayState.pointsFor - awayState.pointsAgainst) / awayState.games : 0;

  const reasoning: ReasoningJson = {
    model: 'v2',
    features: {
      home_wins: homeState.wins,
      home_losses: homeState.losses,
      home_diff_per_game: homeDiff,
      away_wins: awayState.wins,
      away_losses: awayState.losses,
      away_diff_per_game: awayDiff,
      win_gap: awayState.wins - homeState.wins,
      diff_gap: awayDiff - homeDiff,
      low_confidence: lowConfidence,
    },
    pick,
    prob_home_wins: probHome,
  };

  const homeAbbr = game.home_team_id.split(':')[1] ?? game.home_team_id;
  const awayAbbr = game.away_team_id.split(':')[1] ?? game.away_team_id;
  const reasoningText = generateReasoningText(reasoning, homeAbbr, awayAbbr);

  return {
    id: randomUUID(),
    game_id: game.id,
    sport: game.sport,
    model_version: 'v2',
    predicted_winner: winnerId,
    predicted_prob: pick === 'home' ? probHome : 1 - probHome,
    reasoning_json: JSON.stringify(reasoning),
    reasoning_text: reasoningText,
    made_at: new Date().toISOString(),
    team_state_as_of: asOfDate,
    low_confidence: lowConfidence ? 1 : 0,
  };
}

/** Run predictions for all upcoming scheduled games of a sport */
export function predictUpcoming(sport: Sport): { predictions: PredictionRecord[]; skipped: number } {
  const db = getDb();

  // Find scheduled games (status = 'scheduled' and date >= today)
  const today = new Date().toISOString().slice(0, 10);
  const scheduledGames = db.prepare(`
    SELECT id, date, sport, home_team_id, away_team_id
    FROM games
    WHERE sport = ? AND status = 'scheduled' AND date >= ?
    ORDER BY date
    LIMIT 50
  `).all(sport, today) as ScheduledGame[];

  if (scheduledGames.length === 0) {
    return { predictions: [], skipped: 0 };
  }

  // Build state once at the asOfDate (today midnight UTC)
  const asOfDate = new Date().toISOString();
  const states = buildTeamStateUpTo(sport, asOfDate);

  const predictions: PredictionRecord[] = [];
  let skipped = 0;

  // Idempotent: skip games we've already predicted with v2
  const existingStmt = db.prepare(
    'SELECT 1 FROM predictions WHERE game_id = ? AND model_version = ?'
  );

  for (const game of scheduledGames) {
    if (existingStmt.get(game.id, 'v2')) {
      skipped++;
      continue;
    }
    predictions.push(predictGame(game, states, asOfDate));
  }

  // Persist via UPSERT (council: idempotent on conflict)
  const insertStmt = db.prepare(`
    INSERT INTO predictions (
      id, game_id, sport, model_version,
      predicted_winner, predicted_prob,
      reasoning_json, reasoning_text,
      made_at, team_state_as_of, low_confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (game_id, model_version) DO NOTHING
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
