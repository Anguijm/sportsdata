/**
 * Prediction function interface — point-in-time, no future leakage.
 * Council mandate: every predict takes (game, as_of_state) — no access to future.
 */

import type { Sport } from '../schema/provenance.js';

export interface GameForPrediction {
  game_id: string;
  date: string;
  sport: Sport;
  home_team_id: string;
  away_team_id: string;
  home_win: number; // actual outcome — used for scoring only, NOT passed to predictors
}

/** Point-in-time team state as of the moment BEFORE a game was played */
export interface TeamState {
  games: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  lastNResults: boolean[]; // most recent N game results (true = won)
}

/** The context a predictor is allowed to see */
export interface PredictionContext {
  home: TeamState;
  away: TeamState;
  asOfDate: string;
}

/** Returns probability that the home team wins (0.0 - 1.0) */
export type Predictor = (game: GameForPrediction, ctx: PredictionContext) => number;

// --- The iteration ladder ---
// Council mandate: call this hyperparameter descent, NOT hypothesis competition.
// Each iteration adds a refinement to the previous. All trained on pre-2024 data.

export interface Iteration {
  id: string;
  version: string;
  description: string;
  predict: Predictor;
}

/** v0: Baseline. Always pick home. */
export const v0: Iteration = {
  id: 'v0',
  version: '0',
  description: 'Baseline: always pick home team',
  predict: () => 1.0,
};

/** v1: v0 + flip to visitor if visitor has 10+ more wins */
export const v1: Iteration = {
  id: 'v1',
  version: '1',
  description: 'Home unless visitor has 10+ more wins in season',
  predict: (_game, ctx) => {
    if (ctx.home.games < 5 || ctx.away.games < 5) return 1.0; // no reliable record
    const winGap = ctx.away.wins - ctx.home.wins;
    if (winGap >= 10) return 0.3;
    return 1.0;
  },
};

/** v2: v1 + use point differential as tie-breaker */
export const v2: Iteration = {
  id: 'v2',
  version: '2',
  description: 'v1 + flip when visitor point differential is 3+ higher',
  predict: (_game, ctx) => {
    if (ctx.home.games < 5 || ctx.away.games < 5) return 1.0;

    const homeDiff = (ctx.home.pointsFor - ctx.home.pointsAgainst) / ctx.home.games;
    const awayDiff = (ctx.away.pointsFor - ctx.away.pointsAgainst) / ctx.away.games;
    const diffGap = awayDiff - homeDiff;

    const winGap = ctx.away.wins - ctx.home.wins;

    if (winGap >= 10) return 0.25;
    if (diffGap >= 5) return 0.30;
    if (diffGap >= 3) return 0.42;
    return 0.60; // slight home edge (league average is 54.7%, so 0.60 is above base rate)
  },
};

/** v3: v2 + cold streak penalty */
export const v3: Iteration = {
  id: 'v3',
  version: '3',
  description: 'v2 + penalize home team on 3+ game losing streak',
  predict: (_game, ctx) => {
    if (ctx.home.games < 5 || ctx.away.games < 5) return 1.0;

    const homeDiff = (ctx.home.pointsFor - ctx.home.pointsAgainst) / ctx.home.games;
    const awayDiff = (ctx.away.pointsFor - ctx.away.pointsAgainst) / ctx.away.games;
    const diffGap = awayDiff - homeDiff;
    const winGap = ctx.away.wins - ctx.home.wins;

    // Check if home team on cold streak (last 3 games all losses)
    const homeColdStreak = ctx.home.lastNResults.length >= 3 &&
      ctx.home.lastNResults.slice(-3).every(r => !r);

    // Check if away team hot (last 3 games all wins)
    const awayHotStreak = ctx.away.lastNResults.length >= 3 &&
      ctx.away.lastNResults.slice(-3).every(r => r);

    let base = 0.60;
    if (winGap >= 10) base = 0.25;
    else if (diffGap >= 5) base = 0.30;
    else if (diffGap >= 3) base = 0.42;

    // Cold streak reduces home probability
    if (homeColdStreak) base -= 0.10;
    if (awayHotStreak) base -= 0.05;

    return Math.max(0.1, Math.min(0.9, base));
  },
};

export const ITERATIONS: Iteration[] = [v0, v1, v2, v3];
