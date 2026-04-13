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

/** Pitcher data attached to a game, if available (MLB only). */
export interface PitcherMatchup {
  homeEra: number;
  awayEra: number;
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

/** Empirical home-win rates by sport. v0 uses these as its "always pick home"
 *  probability — an honest baseline, not a certainty.
 *  Council mandate (P0-4): using 1.0 inflated all improvement claims. */
const SPORT_HOME_WIN_RATE: Record<string, number> = {
  nba: 0.57,
  nfl: 0.57,
  mlb: 0.54,
  nhl: 0.55,
  mls: 0.49,
  epl: 0.46,
};

/** v0: Baseline. Always pick home at the sport's empirical home-win rate. */
export const v0: Iteration = {
  id: 'v0',
  version: '0',
  description: 'Baseline: always pick home team at empirical home-win rate',
  predict: (game) => SPORT_HOME_WIN_RATE[game.sport] ?? 0.55,
};

/** v1: v0 + flip to visitor if visitor has 10+ more wins */
export const v1: Iteration = {
  id: 'v1',
  version: '1',
  description: 'Home unless visitor has 10+ more wins in season',
  predict: (game, ctx) => {
    if (ctx.home.games < 5 || ctx.away.games < 5) return SPORT_HOME_WIN_RATE[game.sport] ?? 0.55;
    const winGap = ctx.away.wins - ctx.home.wins;
    if (winGap >= 10) return 0.40; // recalibrated (was 0.30)
    return SPORT_HOME_WIN_RATE[game.sport] ?? 0.55;
  },
};

/** v2: v1 + use point differential as tie-breaker
 *
 *  Recalibrated from 12,813 backfill predictions (Sprint 10.6):
 *  - winGap >= 10: was 0.25 (75% away), actual 50-62% → now 0.42 (~58%)
 *  - diffGap >= 5: was 0.30 (70% away), actual ~64% → now 0.38 (~62%)
 *  - diffGap >= 3: was 0.42 (58% away), actual ~58% → unchanged
 *  - default: baseRate + 0.03 → unchanged (well calibrated)
 */
export const v2: Iteration = {
  id: 'v2',
  version: '2',
  description: 'v1 + flip when visitor point differential is 3+ higher (recalibrated)',
  predict: (game, ctx) => {
    const baseRate = SPORT_HOME_WIN_RATE[game.sport] ?? 0.55;
    if (ctx.home.games < 5 || ctx.away.games < 5) return baseRate;

    const homeDiff = (ctx.home.pointsFor - ctx.home.pointsAgainst) / ctx.home.games;
    const awayDiff = (ctx.away.pointsFor - ctx.away.pointsAgainst) / ctx.away.games;
    const diffGap = awayDiff - homeDiff;

    const winGap = ctx.away.wins - ctx.home.wins;

    if (winGap >= 10) return 0.40; // recalibrated: was 0.25 (75%), actual ~56% (midpoint of 50-62%)
    if (diffGap >= 5) return 0.38;  // recalibrated: was 0.30 (70%), actual ~62%
    if (diffGap >= 3) return 0.43;  // was 0.42 — nudged up to preserve ordering vs winGap
    return baseRate + 0.03;
  },
};

/** v3: v2 + cold streak penalty */
export const v3: Iteration = {
  id: 'v3',
  version: '3',
  description: 'v2 + penalize home team on 3+ game losing streak',
  predict: (game, ctx) => {
    const baseRate = SPORT_HOME_WIN_RATE[game.sport] ?? 0.55;
    if (ctx.home.games < 5 || ctx.away.games < 5) return baseRate;

    const homeDiff = (ctx.home.pointsFor - ctx.home.pointsAgainst) / ctx.home.games;
    const awayDiff = (ctx.away.pointsFor - ctx.away.pointsAgainst) / ctx.away.games;
    const diffGap = awayDiff - homeDiff;
    const winGap = ctx.away.wins - ctx.home.wins;

    const homeColdStreak = ctx.home.lastNResults.length >= 3 &&
      ctx.home.lastNResults.slice(-3).every(r => !r);

    const awayHotStreak = ctx.away.lastNResults.length >= 3 &&
      ctx.away.lastNResults.slice(-3).every(r => r);

    let base = baseRate + 0.03;
    if (winGap >= 10) base = 0.40;      // recalibrated (was 0.25)
    else if (diffGap >= 5) base = 0.38;  // recalibrated (was 0.30)
    else if (diffGap >= 3) base = 0.43;

    // Cold streak reduces home probability
    if (homeColdStreak) base -= 0.05;  // reduced from 0.10 (council: arbitrary, halved)
    if (awayHotStreak) base -= 0.03;   // reduced from 0.05

    return Math.max(0.1, Math.min(0.9, base));
  },
};

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

/** v5: Continuous sigmoid model — replaces discrete v2 buckets.
 *
 *  Maps the point-differential gap to a continuous probability via logistic
 *  function. Every game gets a unique probability instead of one of 4 buckets.
 *
 *  prob_home = sigmoid(scale * (homeDiff - awayDiff + homeAdvBias))
 *
 *  Scale calibrated from 12,813 backfill predictions:
 *  - NBA at diffGap=0: ~60% home wins → homeAdvBias ≈ 3.0, scale ≈ 0.10
 *  - NBA at diffGap=5 (away better): ~38% home → sigmoid(0.10 * (-5+3)) ≈ 0.45
 *  - NBA at diffGap=-5 (home better): ~72% home → sigmoid(0.10 * (5+3)) ≈ 0.69
 *
 *  Per-sport scale accounts for scoring range: NBA/NFL use points (large
 *  differentials), MLB/NHL/soccer use runs/goals (small differentials).
 */
const SIGMOID_SCALE: Record<string, number> = {
  nba: 0.10,   // ~10 pts differential range
  nfl: 0.10,   // similar scoring range to NBA
  mlb: 0.25,   // council: 0.40 was too aggressive — 2.5-run gap gave 77%, now ~56%
  nhl: 0.50,   // ~1 goal differential range
  mls: 0.50,   // similar to NHL
  epl: 0.50,   // similar to NHL
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export const v5: Iteration = {
  id: 'v5',
  version: '5',
  description: 'Continuous sigmoid model — unique probability per game from differential gap',
  predict: (game, ctx) => {
    const baseRate = SPORT_HOME_WIN_RATE[game.sport] ?? 0.55;
    if (ctx.home.games < 5 || ctx.away.games < 5) return baseRate;

    const homeDiff = (ctx.home.pointsFor - ctx.home.pointsAgainst) / ctx.home.games;
    const awayDiff = (ctx.away.pointsFor - ctx.away.pointsAgainst) / ctx.away.games;
    const scale = SIGMOID_SCALE[game.sport] ?? 0.10;
    const homeAdv = SPORT_HOME_ADVANTAGE[game.sport] ?? 3.0;

    // x > 0 → home favored, x < 0 → away favored
    const x = scale * ((homeDiff - awayDiff) + homeAdv);
    const prob = sigmoid(x);

    // Clamp to [0.15, 0.85] — no game is truly 95% certain
    return Math.max(0.15, Math.min(0.85, prob));
  },
};

export const ITERATIONS: Iteration[] = [v0, v1, v2, v3, v5];

// =============================================================================
// SPREAD MODEL (Phase 2 — Sprint 10.6)
// =============================================================================
//
// Council mandate: coexists with v2 winner-prediction as a separate model
// version (`v4-spread`). Uses the same features (point differential, win
// records, streaks) but outputs a continuous predicted margin instead of a
// probability bucket. The margin is compared against the bookmaker spread
// to identify "value bets" — games where the model disagrees with the line.

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
 *  Same inputs as v3 but continuous output instead of probability buckets.
 *  For MLB, pitcher ERA differential adjusts the margin when available. */
export function predictMargin(game: GameForPrediction, ctx: PredictionContext, pitchers?: PitcherMatchup): number {
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

  // MLB pitcher ERA differential: lower ERA = better pitcher.
  // Council review (Statistical Validity + Domain Expert convergence):
  // Starters average ~5 IP, so ERA explains roughly half the game's run
  // prevention. Bullpen, defense, and park effects dilute the signal further.
  // A 1.0 ERA gap historically maps to ~0.3-0.4 run differential per game.
  // Coefficient: 0.3 (conservative — will recalibrate when N > 200).
  if (sport === 'mlb' && pitchers && pitchers.homeEra > 0 && pitchers.awayEra > 0) {
    const eraGap = pitchers.awayEra - pitchers.homeEra; // positive = home pitcher better
    margin += eraGap * 0.3;
  }

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

  // Edge = does the model predict that the home team covers?
  // Uses the same convention as sqlite.ts spread resolution:
  //   adjustedMargin = homeMargin + spreadLine
  //   adjustedMargin > 0 → home covers
  // So: edge = predictedMargin + signedSpread
  //   positive edge → model says home covers
  //   negative edge → model says away covers
  const edge = predictedMargin + signedSpread;
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
