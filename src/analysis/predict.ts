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

// =============================================================================
// SPREAD MODEL (Phase 2 — Sprint 10.6)
// =============================================================================
//
// Council mandate: coexists with v2 winner-prediction as a separate model
// version (`v4-spread`). Uses the same features (point differential, win
// records, streaks) but outputs a continuous predicted margin instead of a
// probability bucket. The margin is compared against the bookmaker spread
// to identify "value bets" — games where the model disagrees with the line.

/** Home court / home field / home ice advantage in margin units per sport.
 *  Derived from historical home-win rates:
 *  - NBA ~54.7% ≈ +3.0 pts, NFL ~57% ≈ +2.5 pts, MLB ~54% ≈ +0.5 runs,
 *    NHL ~55% ≈ +0.3 goals, MLS ~49% ≈ +0.4 goals, EPL ~46% ≈ +0.4 goals */
const SPORT_HOME_ADVANTAGE: Record<string, number> = {
  nba: 3.0,
  nfl: 2.5,
  mlb: 0.5,
  nhl: 0.3,
  mls: 0.4,
  epl: 0.4,
};

/** Maximum reasonable margin per sport (clamp bounds). */
const SPORT_MARGIN_CLAMP: Record<string, number> = {
  nba: 30,
  nfl: 35,
  mlb: 12,
  nhl: 8,
  mls: 6,
  epl: 6,
};

/** Edge thresholds per sport for confidence tiers. NBA uses 5/2 points;
 *  lower-scoring sports scale down proportionally. */
const SPORT_EDGE_THRESHOLDS: Record<string, { strong: number; lean: number }> = {
  nba: { strong: 5, lean: 2 },
  nfl: { strong: 4, lean: 2 },
  mlb: { strong: 2, lean: 1 },
  nhl: { strong: 1.5, lean: 0.5 },
  mls: { strong: 1.5, lean: 0.5 },
  epl: { strong: 1.5, lean: 0.5 },
};

/** Predict expected margin: positive = home team wins by that many units.
 *
 *  Formula: base margin from differential gap + home advantage + streak adjustments.
 *  Same inputs as v3 but continuous output instead of probability buckets. */
export function predictMargin(game: GameForPrediction, ctx: PredictionContext): number {
  const sport = game.sport;
  const homeAdv = SPORT_HOME_ADVANTAGE[sport] ?? 3.0;
  const clamp = SPORT_MARGIN_CLAMP[sport] ?? 30;

  // Low-confidence: just return home advantage
  if (ctx.home.games < 5 || ctx.away.games < 5) return homeAdv;

  const homeDiff = (ctx.home.pointsFor - ctx.home.pointsAgainst) / ctx.home.games;
  const awayDiff = (ctx.away.pointsFor - ctx.away.pointsAgainst) / ctx.away.games;

  // Base margin: differential gap + home advantage
  let margin = (homeDiff - awayDiff) + homeAdv;

  // Streak adjustments (same logic as v3)
  const homeColdStreak = ctx.home.lastNResults.length >= 3 &&
    ctx.home.lastNResults.slice(-3).every(r => !r);
  const awayHotStreak = ctx.away.lastNResults.length >= 3 &&
    ctx.away.lastNResults.slice(-3).every(r => r);

  if (homeColdStreak) margin -= homeAdv * 0.5; // halve home advantage when cold
  if (awayHotStreak) margin -= homeAdv * 0.3;  // further reduce for hot visitor

  return Math.max(-clamp, Math.min(clamp, margin));
}

// --- Spread comparison ---

export type ConfidenceTier = 'strong' | 'lean' | 'skip';

export interface SpreadComparison {
  predictedMargin: number;
  /** Signed spread line: negative = home favored, positive = away favored */
  spreadLine: number;
  /** predictedMargin - spreadLine: positive = model says home covers */
  edge: number;
  absEdge: number;
  confidenceTier: ConfidenceTier;
  /** Which side the model picks to cover the spread */
  pickSide: 'home' | 'away';
}

/** Convert the GameOdds spread (always-positive line + favorite team name) to a
 *  signed home-relative spread and compare against the predicted margin.
 *
 *  @param predictedMargin — positive means home wins by that much
 *  @param spreadFavorite — team name from odds API (may be full name or ID)
 *  @param spreadLine — always positive (e.g., 4.5)
 *  @param homeTeamId — canonical home team ID
 *  @param sport — for edge threshold lookup
 */
export function compareToSpread(
  predictedMargin: number,
  spreadFavorite: string,
  spreadLine: number,
  homeTeamId: string,
  sport: string,
): SpreadComparison {
  // Convert to signed home-relative: negative = home favored
  const homeIsFavorite = spreadFavorite === homeTeamId ||
    homeTeamId.includes(spreadFavorite) ||
    spreadFavorite.includes(homeTeamId.split(':')[1] ?? '');
  const signedSpread = homeIsFavorite ? -spreadLine : spreadLine;

  // Edge = how much model disagrees with the line
  // predictedMargin is home-relative (positive = home wins)
  // signedSpread is home-relative (negative = home needs to win by that much)
  // edge = predictedMargin - (-spreadLine) = predictedMargin + spreadLine (when home is fav)
  const edge = predictedMargin - signedSpread;
  const absEdge = Math.abs(edge);

  const thresholds = SPORT_EDGE_THRESHOLDS[sport] ?? SPORT_EDGE_THRESHOLDS['nba'];
  let confidenceTier: ConfidenceTier;
  if (absEdge >= thresholds.strong) confidenceTier = 'strong';
  else if (absEdge >= thresholds.lean) confidenceTier = 'lean';
  else confidenceTier = 'skip';

  // If edge > 0, model says home covers; if edge < 0, model says away covers
  const pickSide: 'home' | 'away' = edge >= 0 ? 'home' : 'away';

  return {
    predictedMargin,
    spreadLine: signedSpread,
    edge,
    absEdge,
    confidenceTier,
    pickSide,
  };
}
