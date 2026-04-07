/**
 * Backtest harness — runs a predictor over historical games with
 * point-in-time team state (no future leakage) and computes Brier score
 * + accuracy + bootstrap confidence intervals.
 *
 * Council mandate:
 * - Temporal holdout (pre-2024 train, 2024+ test)
 * - Bootstrap CIs, not point estimates
 * - Point-in-time team state
 */

import { getDb } from '../storage/sqlite.js';
import type { Sport } from '../schema/provenance.js';
import type { Iteration, PredictionContext, GameForPrediction, TeamState } from './predict.js';

function nbaSeasonYear(date: string): number {
  const d = new Date(date);
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  return month >= 9 ? year : year - 1;
}

interface GameRow {
  game_id: string;
  date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  home_win: number;
}

export interface BacktestResult {
  iterationId: string;
  version: string;
  description: string;
  train: ScoreBlock;
  test: ScoreBlock;
  /** delta vs previous iteration on test set (null for first iteration) */
  deltaVsPrevious?: { brier: number; accuracy: number };
}

export interface ScoreBlock {
  sampleSize: number;
  brier: number;
  brierCI95: [number, number];
  accuracy: number;
  accuracyCI95: [number, number];
  homeWinRate: number;
}

/** Load all games for a sport with point-in-time state baked in */
function loadGamesWithState(sport: Sport): Array<{ game: GameForPrediction; context: PredictionContext }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT gr.game_id, gr.date, g.home_team_id, g.away_team_id,
           gr.home_score, gr.away_score, gr.home_win
    FROM game_results gr
    JOIN games g ON gr.game_id = g.id
    WHERE gr.sport = ?
    ORDER BY gr.date
  `).all(sport) as GameRow[];

  // Build team state cumulatively — BEFORE each game
  const teamStates = new Map<string, TeamState>();

  const getOrInitState = (teamId: string): TeamState => {
    if (!teamStates.has(teamId)) {
      teamStates.set(teamId, {
        games: 0,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        lastNResults: [],
      });
    }
    return teamStates.get(teamId)!;
  };

  const result: Array<{ game: GameForPrediction; context: PredictionContext }> = [];

  for (const row of rows) {
    const homeState = getOrInitState(row.home_team_id);
    const awayState = getOrInitState(row.away_team_id);

    // Snapshot state BEFORE updating
    const context: PredictionContext = {
      home: { ...homeState, lastNResults: [...homeState.lastNResults] },
      away: { ...awayState, lastNResults: [...awayState.lastNResults] },
      asOfDate: row.date,
    };

    const game: GameForPrediction = {
      game_id: row.game_id,
      date: row.date,
      sport,
      home_team_id: row.home_team_id,
      away_team_id: row.away_team_id,
      home_win: row.home_win,
    };

    result.push({ game, context });

    // Update state AFTER recording context
    const homeWon = row.home_win === 1;
    homeState.games++;
    awayState.games++;
    homeState.pointsFor += row.home_score;
    homeState.pointsAgainst += row.away_score;
    awayState.pointsFor += row.away_score;
    awayState.pointsAgainst += row.home_score;
    if (homeWon) {
      homeState.wins++;
      awayState.losses++;
    } else {
      homeState.losses++;
      awayState.wins++;
    }

    // Keep last 5 results, push to end
    homeState.lastNResults = [...homeState.lastNResults, homeWon].slice(-5);
    awayState.lastNResults = [...awayState.lastNResults, !homeWon].slice(-5);
  }

  return result;
}

function brierScore(samples: Array<{ game: GameForPrediction; context: PredictionContext }>, predict: Iteration['predict']): number {
  if (samples.length === 0) return 0;
  const sum = samples.reduce((acc, { game, context }) => {
    const p = predict(game, context);
    return acc + (p - game.home_win) ** 2;
  }, 0);
  return sum / samples.length;
}

function accuracy(samples: Array<{ game: GameForPrediction; context: PredictionContext }>, predict: Iteration['predict']): number {
  if (samples.length === 0) return 0;
  const hits = samples.reduce((acc, { game, context }) => {
    const pred = predict(game, context) >= 0.5 ? 1 : 0;
    return acc + (pred === game.home_win ? 1 : 0);
  }, 0);
  return hits / samples.length;
}

/** Bootstrap confidence interval (95%) via resampling */
function bootstrapCI(
  samples: Array<{ game: GameForPrediction; context: PredictionContext }>,
  metric: (s: typeof samples) => number,
  iterations = 1000
): [number, number] {
  const results: number[] = [];
  const n = samples.length;

  for (let i = 0; i < iterations; i++) {
    const resample: typeof samples = [];
    for (let j = 0; j < n; j++) {
      resample.push(samples[Math.floor(Math.random() * n)]);
    }
    results.push(metric(resample));
  }

  results.sort((a, b) => a - b);
  const lower = results[Math.floor(iterations * 0.025)];
  const upper = results[Math.floor(iterations * 0.975)];
  return [lower, upper];
}

function scoreBlock(
  samples: Array<{ game: GameForPrediction; context: PredictionContext }>,
  iteration: Iteration
): ScoreBlock {
  const b = brierScore(samples, iteration.predict);
  const a = accuracy(samples, iteration.predict);
  const homeWins = samples.reduce((acc, { game }) => acc + game.home_win, 0);

  return {
    sampleSize: samples.length,
    brier: b,
    brierCI95: bootstrapCI(samples, s => brierScore(s, iteration.predict)),
    accuracy: a,
    accuracyCI95: bootstrapCI(samples, s => accuracy(s, iteration.predict)),
    homeWinRate: homeWins / samples.length,
  };
}

/** Run a full backtest across all iterations with temporal holdout */
export function runBacktest(sport: Sport, iterations: Iteration[], trainCutoffSeason = 2023): BacktestResult[] {
  const allGames = loadGamesWithState(sport);
  const train = allGames.filter(g => nbaSeasonYear(g.game.date) <= trainCutoffSeason);
  const test = allGames.filter(g => nbaSeasonYear(g.game.date) > trainCutoffSeason);

  console.log(`  Train: ${train.length} games (seasons ≤ ${trainCutoffSeason})`);
  console.log(`  Test:  ${test.length} games (seasons > ${trainCutoffSeason})`);

  const results: BacktestResult[] = [];

  for (let i = 0; i < iterations.length; i++) {
    const it = iterations[i];
    console.log(`\n  Scoring ${it.id}: ${it.description}`);
    const trainScore = scoreBlock(train, it);
    const testScore = scoreBlock(test, it);

    const result: BacktestResult = {
      iterationId: it.id,
      version: it.version,
      description: it.description,
      train: trainScore,
      test: testScore,
    };

    if (i > 0) {
      const prev = results[i - 1];
      result.deltaVsPrevious = {
        brier: testScore.brier - prev.test.brier,
        accuracy: testScore.accuracy - prev.test.accuracy,
      };
    }

    console.log(`    Test Brier: ${testScore.brier.toFixed(4)} [${testScore.brierCI95[0].toFixed(4)}, ${testScore.brierCI95[1].toFixed(4)}]`);
    console.log(`    Test Accuracy: ${(testScore.accuracy * 100).toFixed(1)}% [${(testScore.accuracyCI95[0] * 100).toFixed(1)}%, ${(testScore.accuracyCI95[1] * 100).toFixed(1)}%]`);

    results.push(result);
  }

  return results;
}
