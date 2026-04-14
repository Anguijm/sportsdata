/**
 * Baseline analysis — per-sport MAE / RMSE / Brier / winner accuracy
 * over the backfilled game history. Closes council debt #13.
 *
 * Scope (per session_state.json next_action):
 *   "v4-spread margin MAE baseline on 12,813 backfilled games. Pure analysis
 *    on existing data — no historical odds or injury data needed."
 *
 * Method:
 *   Replay v5.predict() and predictMargin() against the SAME point-in-time
 *   team-state snapshots the backfill used (walk games chronologically,
 *   snapshot BEFORE updating). No historical pitcher data, no historical
 *   injury data — those signals didn't exist in the backfill and still
 *   don't. This measures the *structural* model accuracy.
 *
 * Honest disclosure:
 *   The sigmoid_scale, home_advantage, and win-gap bucket constants were
 *   calibrated against this same data (learnings.md:134-246). These
 *   baseline numbers are therefore IN-SAMPLE with respect to those knobs.
 *   The train/test split (earliest 80% / latest 20% by date per sport)
 *   gives a holdout fingerprint for future tweak evaluation, not a clean
 *   out-of-sample test of the current parameters.
 *
 * Draws:
 *   Soccer (MLS/EPL) draws are included in margin metrics (|pred - 0|)
 *   but excluded from winner accuracy and Brier (the model emits binary
 *   win probability; draws are a known structural mismatch, flagged for
 *   the soccer-specific Poisson/Skellam follow-up).
 */

import { getDb } from '../storage/sqlite.js';
import type { Sport } from '../schema/provenance.js';
import { v5, predictMargin } from './predict.js';
import type { TeamState } from './predict.js';
import { isSoccer, predictPoisson } from './poisson.js';

const SPORTS: Sport[] = ['nba', 'nfl', 'mlb', 'nhl', 'mls', 'epl'];

/** Train cutoff used by the backfill — 2023 season. Games at or before
 *  this season were "seen" when the engine's parameters were chosen, so
 *  for per-sport baselines we analyze the same post-2023 held-out set. */
const TRAIN_CUTOFF_SEASON = 2023;

/** Fraction of each sport's post-cutoff games reserved as "recent holdout"
 *  for future tweak A/B measurement. Not a clean out-of-sample split — see
 *  honest-disclosure note above — just a date-ordered 80/20 slice. */
const HOLDOUT_TEST_FRAC = 0.20;

interface ScoredRow {
  game_id: string;
  date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  home_win: number;
  is_draw: number;
}

interface ReplayedGame {
  date: string;
  sport: Sport;
  predictedProb: number;
  predictedMargin: number;
  /** Poisson predicted margin (Skellam mean). Only populated for MLS/EPL;
   *  null for other sports. Coexists with predictedMargin (v4-spread
   *  sigmoid-derived) so the A/B can compare them on the same game set. */
  poissonMargin: number | null;
  /** Poisson draw probability: P(Skellam = 0). Only populated for MLS/EPL. */
  poissonDrawProb: number | null;
  actualMargin: number;      // signed: home_score - away_score
  homeWin: 0 | 1;            // 1 only if home won strictly (draws = 0)
  isDraw: boolean;
  lowConfidence: boolean;
}

/** A bootstrap 95% CI on a scalar statistic.
 *
 *  `estimate` is the point estimate on the full slice (what we'd have
 *  reported without bootstrapping). `low` and `high` are the 2.5th and
 *  97.5th percentiles from N_BOOTSTRAP resamples (with replacement) of
 *  the slice. When `low` and `high` have the same sign, the statistic
 *  is considered "significant" (directionally stable under resampling).
 *  When the interval crosses zero — for a diff — we cannot distinguish
 *  the effect from noise at 95%. */
export interface CI {
  estimate: number;
  low: number;
  high: number;
}

export interface BaselineMetrics {
  n: number;
  nLowConfidence: number;
  nDraws: number;
  /** Games used for winner/Brier metrics (excludes low-confidence and draws). */
  nWinnerEligible: number;
  /** Per-sport home-win rate on the analyzed slice (excluding draws). */
  homeWinRate: number;
  /** Sample SD (N-1) of actual signed margin. Contextualizes MAE. */
  sigmaActualMargin: number;
  /** Sample SD (N-1) of predicted margin. */
  sigmaPredictedMargin: number;
  /** Mean absolute error of the margin prediction, with bootstrap 95% CI. */
  marginMAE: CI;
  /** Root-mean-square error of the margin prediction, with bootstrap 95% CI. */
  marginRMSE: CI;
  /** Signed bias: mean(predicted - actual). Negative = model under-predicts
   *  home margin. Bias alone is the portion of error that's correctable by
   *  adjusting home_advantage or similar shift parameters. */
  marginBias: CI;
  /** Fraction of games the v5 winner pick was correct (excluding low-conf and draws). */
  winnerAccuracy: CI;
  /** Mean Brier score of the v5 probability (excluding low-conf and draws). */
  brierScore: CI;
  /** Brier of constant-home-rate baseline (using per-resample home_win_rate). */
  naiveBrier: CI;
  /** MAE a "predict zero" model would achieve. Contextualizes marginMAE. */
  naiveZeroMAE: CI;
  /** MAE a "predict home_advantage" model would achieve. */
  naiveHomeAdvMAE: CI;
  /** Paired diff CIs (model minus baseline, same resample per bootstrap draw).
   *  Sign convention: NEGATIVE = model beats baseline (lower error).
   *  If CI crosses zero, the model is not significantly different from
   *  the baseline at 95%. */
  marginMAE_minus_naiveZero: CI;
  marginMAE_minus_naiveHomeAdv: CI;
  brierScore_minus_naiveBrier: CI;
  /** Whether this slice has Poisson predictions populated (MLS/EPL only).
   *  When false, the poisson* fields below are null — they were previously
   *  zero-filled which serialized as mathematically bogus values in the
   *  JSON artifact (e.g., NBA poissonMAE_minus_naiveZero = -12.96,
   *  implying Poisson crushed NBA predict-zero, which is nonsense).
   *  Codex review on PR #29 caught this; null forces downstream consumers
   *  to branch on hasPoisson explicitly. */
  hasPoisson: boolean;
  /** Poisson (Skellam-mean) margin MAE with bootstrap CI. MLS/EPL only;
   *  null for other sports. */
  poissonMAE: CI | null;
  /** Draw-probability Brier: mean((P(Skellam=0) - isDraw)^2) over all
   *  games in the slice. Secondary metric, not ship-gated. Null for
   *  non-soccer. */
  drawBrier: CI | null;
  /** Closed-form naive-draw Brier: drawRate*(1-drawRate). Null for non-soccer. */
  naiveDrawBrier: CI | null;
  /** Paired diff CI (poisson MAE − predict-zero MAE). Primary ship gate:
   *  must be entirely below zero for Poisson to beat the constant. Null
   *  for non-soccer. */
  poissonMAE_minus_naiveZero: CI | null;
  /** Paired diff CI (poisson MAE − v4-spread MAE). Secondary: informs
   *  fallback ship rule (Poisson can ship in a tie with v4-spread). Null
   *  for non-soccer. */
  poissonMAE_minus_v4spread: CI | null;
  /** Paired diff CI (poisson draw-Brier − naive-draw Brier). Null for
   *  non-soccer. */
  drawBrier_minus_naiveDraw: CI | null;
}

export interface SportBaseline {
  sport: Sport;
  all: BaselineMetrics;
  trainEarlier80: BaselineMetrics;
  testLatest20: BaselineMetrics;
  /** Split boundary date (games on/after this date are in test). */
  splitDate: string;
}

export interface BaselineReport {
  generatedAt: string;
  trainCutoffSeason: number;
  holdoutTestFrac: number;
  /** Number of bootstrap resamples used for CI estimation. */
  bootstrapIterations: number;
  models: {
    winner: 'v5';
    margin: 'v4-spread';
    /** Added 2026-04-14 in soccer-poisson branch. Soccer-only (MLS/EPL). */
    soccerMargin: 'v6-poisson-soccer';
  };
  totals: {
    games: number;
    lowConfidence: number;
    draws: number;
    /** Games skipped because no state snapshot was available (should be 0). */
    skippedSnapshots: number;
  };
  bySport: SportBaseline[];
}

// --- Helpers ---

function getSeasonYear(sport: Sport, date: string): number {
  const d = new Date(date);
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  switch (sport) {
    case 'mlb':
    case 'mls':
      return year;
    case 'nfl':
      return month >= 8 ? year : year - 1;
    case 'epl':
      return month >= 7 ? year : year - 1;
    case 'nhl':
    case 'nba':
    default:
      return month >= 9 ? year : year - 1;
  }
}

function loadScoredGames(sport: Sport): ScoredRow[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT gr.game_id, gr.date, g.home_team_id, g.away_team_id,
           gr.home_score, gr.away_score, gr.home_win, gr.is_draw
    FROM game_results gr
    JOIN games g ON gr.game_id = g.id
    WHERE gr.sport = ?
    ORDER BY gr.date
  `).all(sport) as ScoredRow[];
  return rows.filter(r => getSeasonYear(sport, r.date) > TRAIN_CUTOFF_SEASON);
}

/** Walk games chronologically, snapshot state BEFORE each game, then update.
 *  Mirrors backfill-predictions.ts:buildAllStateSnapshots — deliberately
 *  duplicated rather than imported to avoid entangling the backfill CLI
 *  with analysis code. If the logic diverges in the future, the backfill
 *  remains frozen (historical artifact) while this can evolve. */
function buildStateSnapshots(
  sport: Sport,
): Map<string, { home: TeamState; away: TeamState }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT gr.game_id, gr.date, g.home_team_id, g.away_team_id,
           gr.home_score, gr.away_score, gr.home_win, gr.is_draw
    FROM game_results gr
    JOIN games g ON gr.game_id = g.id
    WHERE gr.sport = ?
    ORDER BY gr.date
  `).all(sport) as ScoredRow[];

  const teamStates = new Map<string, TeamState>();
  const snapshots = new Map<string, { home: TeamState; away: TeamState }>();

  const init = (id: string): TeamState => {
    let s = teamStates.get(id);
    if (!s) {
      s = { games: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, lastNResults: [] };
      teamStates.set(id, s);
    }
    return s;
  };

  for (const r of rows) {
    const homeState = init(r.home_team_id);
    const awayState = init(r.away_team_id);

    // Snapshot BEFORE updating
    snapshots.set(r.game_id, {
      home: { ...homeState, lastNResults: [...homeState.lastNResults] },
      away: { ...awayState, lastNResults: [...awayState.lastNResults] },
    });

    const isDraw = r.is_draw === 1;
    const homeWon = !isDraw && r.home_win === 1;

    homeState.games++;
    awayState.games++;
    homeState.pointsFor += r.home_score;
    homeState.pointsAgainst += r.away_score;
    awayState.pointsFor += r.away_score;
    awayState.pointsAgainst += r.home_score;

    // Draws don't increment wins/losses for either team — matches the live
    // predict-runner convention for MLS/EPL. Same lastNResults contract:
    // false for "didn't win" (draws count as losses for streak purposes).
    if (isDraw) {
      // neither side gets a win
    } else if (homeWon) {
      homeState.wins++;
      awayState.losses++;
    } else {
      homeState.losses++;
      awayState.wins++;
    }
    homeState.lastNResults = [...homeState.lastNResults, homeWon].slice(-5);
    awayState.lastNResults = [...awayState.lastNResults, !homeWon && !isDraw].slice(-5);
  }

  return snapshots;
}

function replaySport(sport: Sport): { games: ReplayedGame[]; skipped: number } {
  const games = loadScoredGames(sport);
  const snapshots = buildStateSnapshots(sport);
  const out: ReplayedGame[] = [];
  let skipped = 0;

  for (const g of games) {
    const snap = snapshots.get(g.game_id);
    if (!snap) { skipped++; continue; }
    const { home, away } = snap;
    const lowConfidence = home.games < 5 || away.games < 5;

    const predictedProb = v5.predict(
      {
        game_id: g.game_id,
        date: g.date,
        sport,
        home_team_id: g.home_team_id,
        away_team_id: g.away_team_id,
        home_win: 0,
      },
      { home, away, asOfDate: g.date },
    );

    const predictedMargin = predictMargin(
      {
        game_id: g.game_id,
        date: g.date,
        sport,
        home_team_id: g.home_team_id,
        away_team_id: g.away_team_id,
        home_win: 0,
      },
      { home, away, asOfDate: g.date },
      undefined,  // no historical pitcher data
      undefined,  // no historical injury data
    );

    // Poisson margin + draw prob — MLS/EPL only. Other sports get null so
    // downstream metrics can cleanly skip non-soccer slices.
    let poissonMargin: number | null = null;
    let poissonDrawProb: number | null = null;
    if (isSoccer(sport)) {
      const pois = predictPoisson(sport, home, away);
      poissonMargin = pois.margin;
      poissonDrawProb = pois.probs.pDraw;
    }

    out.push({
      date: g.date,
      sport,
      predictedProb,
      predictedMargin,
      poissonMargin,
      poissonDrawProb,
      actualMargin: g.home_score - g.away_score,
      homeWin: g.home_win === 1 && g.is_draw !== 1 ? 1 : 0,
      isDraw: g.is_draw === 1,
      lowConfidence,
    });
  }
  return { games: out, skipped };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample SD (divides by N-1) — unbiased estimator. Council math-expert fix:
 *  was populationSD before. Practical impact at N≥500 is <0.1% but correct
 *  is correct. */
function sampleSD(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) ** 2;
  return Math.sqrt(ss / (xs.length - 1));
}

/** Deterministic PRNG (mulberry32) so bootstrap CIs are reproducible across
 *  runs. Seeded from a stable hash of the sport + slice label so each slice
 *  gets an independent but repeatable stream. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function percentile(sortedXs: number[], p: number): number {
  if (sortedXs.length === 0) return 0;
  const idx = p * (sortedXs.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedXs[lo];
  const frac = idx - lo;
  return sortedXs[lo] * (1 - frac) + sortedXs[hi] * frac;
}

function ciFrom(estimate: number, resamples: number[]): CI {
  if (resamples.length === 0) return { estimate, low: estimate, high: estimate };
  const sorted = [...resamples].sort((a, b) => a - b);
  return {
    estimate,
    low: percentile(sorted, 0.025),
    high: percentile(sorted, 0.975),
  };
}

/** Bootstrap iterations. 1000 gives ±0.5pp precision on 95% CI bounds,
 *  which is finer than the effect sizes we care about. Increase to 5000
 *  if anything lands exactly on the zero line. */
const N_BOOTSTRAP = 1000;

/** Home-advantage literal from predict.ts. Duplicated to keep this module
 *  independent and to measure a transparent naive baseline without coupling
 *  to implementation constants. If predict.ts changes these, rerun the
 *  baseline. */
const NAIVE_HOME_ADV: Record<Sport, number> = {
  nba: 3.0, nfl: 2.5, mlb: 0.5, nhl: 0.3, mls: 0.4, epl: 0.4,
};

/** Per-game pre-computed quantities, so the bootstrap inner loop is a
 *  single pass over resampled indices with no per-game branching. */
interface GameAggregates {
  absError: number;        // |v4-spread predicted - actual|
  sqError: number;         // (v4-spread predicted - actual)^2
  signedError: number;     // v4-spread predicted - actual
  actualMargin: number;
  predictedMargin: number; // v4-spread predicted margin
  absActual: number;       // |actual| — naive-zero MAE term
  absHomeAdv: number;      // |homeAdv - actual| — naive-homeAdv MAE term
  eligible: boolean;       // not draw AND not low-confidence
  homeWin: 0 | 1;
  brierContrib: number;    // (prob - homeWin)^2 on eligible, else 0
  winnerCorrect: 0 | 1;    // pick matches homeWin on eligible, else 0
  // Poisson-only (null for non-soccer sports — kept as NaN sentinel so the
  // bootstrap inner loop can stay branchless; Poisson metrics are only
  // consumed when hasPoisson is true for the slice).
  poissonAbsError: number;
  poissonDrawProb: number;      // P(Skellam = 0) per game; 0 if non-soccer
  drawBrierContrib: number;     // (poissonDrawProb - isDraw)^2 for soccer
}

function precompute(sport: Sport, games: ReplayedGame[]): GameAggregates[] {
  const homeAdv = NAIVE_HOME_ADV[sport] ?? 3.0;
  return games.map(g => {
    const err = g.predictedMargin - g.actualMargin;
    const eligible = !g.isDraw && !g.lowConfidence;
    const pickHome = g.predictedProb >= 0.5;
    const correct = eligible && ((pickHome && g.homeWin === 1) || (!pickHome && g.homeWin === 0)) ? 1 : 0;
    const brier = eligible ? (g.predictedProb - g.homeWin) ** 2 : 0;
    // Soccer-specific fields: Poisson error and draw-probability Brier.
    // For non-soccer sports these are zeroed so bootstrap sums are
    // mathematically valid but consumers must guard via hasPoisson.
    const poissonAbsError = g.poissonMargin != null
      ? Math.abs(g.poissonMargin - g.actualMargin)
      : 0;
    const poissonDrawProb = g.poissonDrawProb ?? 0;
    const drawBrierContrib = g.poissonDrawProb != null
      ? (g.poissonDrawProb - (g.isDraw ? 1 : 0)) ** 2
      : 0;
    return {
      absError: Math.abs(err),
      sqError: err * err,
      signedError: err,
      actualMargin: g.actualMargin,
      predictedMargin: g.predictedMargin,
      absActual: Math.abs(g.actualMargin),
      absHomeAdv: Math.abs(homeAdv - g.actualMargin),
      eligible,
      homeWin: g.homeWin,
      brierContrib: brier,
      winnerCorrect: correct as 0 | 1,
      poissonAbsError,
      poissonDrawProb,
      drawBrierContrib,
    };
  });
}

/** Point statistics on the full slice. Single pass, no resampling. */
function pointStats(agg: GameAggregates[]): {
  marginMAE: number; marginRMSE: number; marginBias: number;
  naiveZeroMAE: number; naiveHomeAdvMAE: number;
  winnerAccuracy: number; brierScore: number; naiveBrier: number;
  homeWinRate: number; nWinnerEligible: number;
  marginMAE_minus_naiveZero: number;
  marginMAE_minus_naiveHomeAdv: number;
  brierScore_minus_naiveBrier: number;
  // Poisson-specific (zero-filled for non-soccer; consumers guard via hasPoisson)
  poissonMAE: number;
  drawBrier: number;
  naiveDrawBrier: number;
  poissonMAE_minus_naiveZero: number;
  poissonMAE_minus_v4spread: number;
  drawBrier_minus_naiveDraw: number;
} {
  const n = agg.length;
  if (n === 0) {
    return {
      marginMAE: 0, marginRMSE: 0, marginBias: 0,
      naiveZeroMAE: 0, naiveHomeAdvMAE: 0,
      winnerAccuracy: 0, brierScore: 0, naiveBrier: 0,
      homeWinRate: 0, nWinnerEligible: 0,
      marginMAE_minus_naiveZero: 0,
      marginMAE_minus_naiveHomeAdv: 0,
      brierScore_minus_naiveBrier: 0,
      poissonMAE: 0, drawBrier: 0, naiveDrawBrier: 0,
      poissonMAE_minus_naiveZero: 0,
      poissonMAE_minus_v4spread: 0,
      drawBrier_minus_naiveDraw: 0,
    };
  }
  let sumAbs = 0, sumSq = 0, sumSigned = 0, sumAbsAct = 0, sumAbsHA = 0;
  let sumPoisAbs = 0, sumDrawBrier = 0, drawCount = 0;
  let eligN = 0, homeWinSum = 0, brierSum = 0, correctSum = 0;
  for (const g of agg) {
    sumAbs += g.absError; sumSq += g.sqError; sumSigned += g.signedError;
    sumAbsAct += g.absActual; sumAbsHA += g.absHomeAdv;
    sumPoisAbs += g.poissonAbsError;
    sumDrawBrier += g.drawBrierContrib;
    if (g.actualMargin === 0) drawCount++;
    if (g.eligible) {
      eligN++; homeWinSum += g.homeWin; brierSum += g.brierContrib; correctSum += g.winnerCorrect;
    }
  }
  const marginMAE = sumAbs / n;
  const marginRMSE = Math.sqrt(sumSq / n);
  const marginBias = sumSigned / n;
  const naiveZeroMAE = sumAbsAct / n;
  const naiveHomeAdvMAE = sumAbsHA / n;
  const homeWinRate = eligN > 0 ? homeWinSum / eligN : 0;
  const brierScore = eligN > 0 ? brierSum / eligN : 0;
  const winnerAccuracy = eligN > 0 ? correctSum / eligN : 0;
  // Naive Brier uses the in-slice home-win rate as its constant prediction,
  // which is the Brier-minimizing constant. Tightest naive baseline.
  // On eligible games: Σ(p - y)^2 = eligN * p*(1-p) when y∈{0,1}.
  const naiveBrier = eligN > 0 ? homeWinRate * (1 - homeWinRate) : 0;

  // Poisson: MAE uses poissonAbsError (0 for non-soccer → zero-valued but
  // meaningless; hasPoisson gates consumption). drawBrier is per-game mean
  // of (drawProb - isDraw)^2 on all games (not just eligible). The naive
  // draw-Brier uses the in-slice draw rate, same closed-form as naiveBrier.
  const poissonMAE = sumPoisAbs / n;
  const drawBrier = sumDrawBrier / n;
  const drawRate = drawCount / n;
  const naiveDrawBrier = drawRate * (1 - drawRate);

  return {
    marginMAE, marginRMSE, marginBias,
    naiveZeroMAE, naiveHomeAdvMAE,
    winnerAccuracy, brierScore, naiveBrier,
    homeWinRate, nWinnerEligible: eligN,
    marginMAE_minus_naiveZero: marginMAE - naiveZeroMAE,
    marginMAE_minus_naiveHomeAdv: marginMAE - naiveHomeAdvMAE,
    brierScore_minus_naiveBrier: brierScore - naiveBrier,
    poissonMAE, drawBrier, naiveDrawBrier,
    poissonMAE_minus_naiveZero: poissonMAE - naiveZeroMAE,
    poissonMAE_minus_v4spread: poissonMAE - marginMAE,
    drawBrier_minus_naiveDraw: drawBrier - naiveDrawBrier,
  };
}

/** Run B bootstrap resamples (with replacement), recomputing all statistics
 *  on each resample. Paired diffs are computed within the same resample so
 *  CIs reflect covariance between model and baseline metrics. */
function bootstrapStats(
  agg: GameAggregates[],
  B: number,
  seed: number,
): Record<string, number[]> {
  const keys = [
    'marginMAE', 'marginRMSE', 'marginBias',
    'naiveZeroMAE', 'naiveHomeAdvMAE',
    'winnerAccuracy', 'brierScore', 'naiveBrier',
    'marginMAE_minus_naiveZero',
    'marginMAE_minus_naiveHomeAdv',
    'brierScore_minus_naiveBrier',
    'poissonMAE', 'drawBrier', 'naiveDrawBrier',
    'poissonMAE_minus_naiveZero',
    'poissonMAE_minus_v4spread',
    'drawBrier_minus_naiveDraw',
  ];
  const out: Record<string, number[]> = {};
  for (const k of keys) out[k] = [];
  const n = agg.length;
  if (n === 0) return out;

  const rng = mulberry32(seed);
  for (let b = 0; b < B; b++) {
    let sumAbs = 0, sumSq = 0, sumSigned = 0, sumAbsAct = 0, sumAbsHA = 0;
    let sumPoisAbs = 0, sumDrawBrier = 0, drawCount = 0;
    let eligN = 0, homeWinSum = 0, brierSum = 0, correctSum = 0;
    for (let i = 0; i < n; i++) {
      const g = agg[Math.floor(rng() * n)];
      sumAbs += g.absError; sumSq += g.sqError; sumSigned += g.signedError;
      sumAbsAct += g.absActual; sumAbsHA += g.absHomeAdv;
      sumPoisAbs += g.poissonAbsError;
      sumDrawBrier += g.drawBrierContrib;
      if (g.actualMargin === 0) drawCount++;
      if (g.eligible) {
        eligN++; homeWinSum += g.homeWin; brierSum += g.brierContrib; correctSum += g.winnerCorrect;
      }
    }
    const marginMAE = sumAbs / n;
    const marginRMSE = Math.sqrt(sumSq / n);
    const marginBias = sumSigned / n;
    const naiveZeroMAE = sumAbsAct / n;
    const naiveHomeAdvMAE = sumAbsHA / n;
    const homeWinRate = eligN > 0 ? homeWinSum / eligN : 0;
    const brierScore = eligN > 0 ? brierSum / eligN : 0;
    const winnerAccuracy = eligN > 0 ? correctSum / eligN : 0;
    const naiveBrier = eligN > 0 ? homeWinRate * (1 - homeWinRate) : 0;
    const poissonMAE = sumPoisAbs / n;
    const drawBrier = sumDrawBrier / n;
    const drawRate = drawCount / n;
    const naiveDrawBrier = drawRate * (1 - drawRate);
    out.marginMAE.push(marginMAE);
    out.marginRMSE.push(marginRMSE);
    out.marginBias.push(marginBias);
    out.naiveZeroMAE.push(naiveZeroMAE);
    out.naiveHomeAdvMAE.push(naiveHomeAdvMAE);
    out.winnerAccuracy.push(winnerAccuracy);
    out.brierScore.push(brierScore);
    out.naiveBrier.push(naiveBrier);
    out.marginMAE_minus_naiveZero.push(marginMAE - naiveZeroMAE);
    out.marginMAE_minus_naiveHomeAdv.push(marginMAE - naiveHomeAdvMAE);
    out.brierScore_minus_naiveBrier.push(brierScore - naiveBrier);
    out.poissonMAE.push(poissonMAE);
    out.drawBrier.push(drawBrier);
    out.naiveDrawBrier.push(naiveDrawBrier);
    out.poissonMAE_minus_naiveZero.push(poissonMAE - naiveZeroMAE);
    out.poissonMAE_minus_v4spread.push(poissonMAE - marginMAE);
    out.drawBrier_minus_naiveDraw.push(drawBrier - naiveDrawBrier);
  }
  return out;
}

function computeMetrics(
  sport: Sport,
  games: ReplayedGame[],
  sliceLabel: string,
): BaselineMetrics {
  const n = games.length;
  const nDraws = games.filter(g => g.isDraw).length;
  const nLowConfidence = games.filter(g => g.lowConfidence).length;

  const agg = precompute(sport, games);
  const actualMargins = games.map(g => g.actualMargin);
  const predictedMargins = games.map(g => g.predictedMargin);
  const sigmaActualMargin = sampleSD(actualMargins);
  const sigmaPredictedMargin = sampleSD(predictedMargins);

  const point = pointStats(agg);
  const seed = hashSeed(`${sport}:${sliceLabel}`);
  const boots = n > 0 ? bootstrapStats(agg, N_BOOTSTRAP, seed) : {} as Record<string, number[]>;

  const ci = (name: string, est: number): CI =>
    ciFrom(est, boots[name] ?? []);

  const hasPoisson = isSoccer(sport) && n > 0;

  return {
    n, nLowConfidence, nDraws,
    nWinnerEligible: point.nWinnerEligible,
    homeWinRate: point.homeWinRate,
    sigmaActualMargin, sigmaPredictedMargin,
    marginMAE: ci('marginMAE', point.marginMAE),
    marginRMSE: ci('marginRMSE', point.marginRMSE),
    marginBias: ci('marginBias', point.marginBias),
    winnerAccuracy: ci('winnerAccuracy', point.winnerAccuracy),
    brierScore: ci('brierScore', point.brierScore),
    naiveBrier: ci('naiveBrier', point.naiveBrier),
    naiveZeroMAE: ci('naiveZeroMAE', point.naiveZeroMAE),
    naiveHomeAdvMAE: ci('naiveHomeAdvMAE', point.naiveHomeAdvMAE),
    marginMAE_minus_naiveZero:
      ci('marginMAE_minus_naiveZero', point.marginMAE_minus_naiveZero),
    marginMAE_minus_naiveHomeAdv:
      ci('marginMAE_minus_naiveHomeAdv', point.marginMAE_minus_naiveHomeAdv),
    brierScore_minus_naiveBrier:
      ci('brierScore_minus_naiveBrier', point.brierScore_minus_naiveBrier),
    hasPoisson,
    // Poisson fields: null for non-soccer so consumers must branch on
    // hasPoisson. Previously zero-filled, which produced deceptive large
    // negative diffs for NBA/NFL/MLB/NHL — see Codex PR #29 comment.
    poissonMAE: hasPoisson ? ci('poissonMAE', point.poissonMAE) : null,
    drawBrier: hasPoisson ? ci('drawBrier', point.drawBrier) : null,
    naiveDrawBrier: hasPoisson ? ci('naiveDrawBrier', point.naiveDrawBrier) : null,
    poissonMAE_minus_naiveZero: hasPoisson
      ? ci('poissonMAE_minus_naiveZero', point.poissonMAE_minus_naiveZero)
      : null,
    poissonMAE_minus_v4spread: hasPoisson
      ? ci('poissonMAE_minus_v4spread', point.poissonMAE_minus_v4spread)
      : null,
    drawBrier_minus_naiveDraw: hasPoisson
      ? ci('drawBrier_minus_naiveDraw', point.drawBrier_minus_naiveDraw)
      : null,
  };
}

function splitByDate(games: ReplayedGame[], testFrac: number): {
  train: ReplayedGame[]; test: ReplayedGame[]; splitDate: string;
} {
  if (games.length === 0) return { train: [], test: [], splitDate: '' };
  const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date));
  const splitIdx = Math.floor(sorted.length * (1 - testFrac));
  const train = sorted.slice(0, splitIdx);
  const test = sorted.slice(splitIdx);
  const splitDate = test[0]?.date ?? sorted[sorted.length - 1].date;
  return { train, test, splitDate };
}

export function computeBaseline(): BaselineReport {
  const bySport: SportBaseline[] = [];
  let totalGames = 0;
  let totalLowConf = 0;
  let totalDraws = 0;
  let totalSkipped = 0;

  for (const sport of SPORTS) {
    const { games, skipped } = replaySport(sport);
    totalSkipped += skipped;
    if (games.length === 0) {
      // Still record an empty entry so UI/downstream don't silently drop the sport.
      bySport.push({
        sport,
        all: computeMetrics(sport, [], 'all'),
        trainEarlier80: computeMetrics(sport, [], 'train80'),
        testLatest20: computeMetrics(sport, [], 'test20'),
        splitDate: '',
      });
      continue;
    }
    const { train, test, splitDate } = splitByDate(games, HOLDOUT_TEST_FRAC);
    bySport.push({
      sport,
      all: computeMetrics(sport, games, 'all'),
      trainEarlier80: computeMetrics(sport, train, 'train80'),
      testLatest20: computeMetrics(sport, test, 'test20'),
      splitDate,
    });
    totalGames += games.length;
    totalLowConf += games.filter(g => g.lowConfidence).length;
    totalDraws += games.filter(g => g.isDraw).length;
  }

  return {
    generatedAt: new Date().toISOString(),
    trainCutoffSeason: TRAIN_CUTOFF_SEASON,
    holdoutTestFrac: HOLDOUT_TEST_FRAC,
    bootstrapIterations: N_BOOTSTRAP,
    models: { winner: 'v5', margin: 'v4-spread', soccerMargin: 'v6-poisson-soccer' },
    totals: {
      games: totalGames,
      lowConfidence: totalLowConf,
      draws: totalDraws,
      skippedSnapshots: totalSkipped,
    },
    bySport,
  };
}

// --- Human-readable rendering ---

/** A directional verdict on a paired diff CI.
 *   "beats"   — CI entirely below zero: model significantly better than baseline
 *   "loses"   — CI entirely above zero: model significantly WORSE than baseline
 *   "tie"     — CI straddles zero: cannot distinguish from baseline at 95% */
function significance(diff: CI): 'beats' | 'loses' | 'tie' {
  if (diff.high < 0) return 'beats';
  if (diff.low > 0) return 'loses';
  return 'tie';
}

function ciStr(c: CI, digits = 2, signed = false): string {
  const pre = (n: number) => (signed && n >= 0 ? '+' : '') + n.toFixed(digits);
  return `${pre(c.estimate)} [${pre(c.low)}, ${pre(c.high)}]`;
}

function renderSportBlock(s: SportBaseline): string {
  const lines: string[] = [];
  const slices: Array<{ label: string; m: BaselineMetrics }> = [
    { label: 'all', m: s.all },
    { label: `train (<${s.splitDate})`, m: s.trainEarlier80 },
    { label: `test  (>=${s.splitDate})`, m: s.testLatest20 },
  ];

  for (const { label, m } of slices) {
    if (m.n === 0) {
      lines.push(`  ${label}: (no data)`);
      continue;
    }
    const sigZero = significance(m.marginMAE_minus_naiveZero);
    const sigHA = significance(m.marginMAE_minus_naiveHomeAdv);
    const sigBrier = significance(m.brierScore_minus_naiveBrier);
    const verdict = (s: 'beats' | 'loses' | 'tie') =>
      s === 'beats' ? '✓ beats' : s === 'loses' ? '✗ LOSES' : '~ tie';
    lines.push(`  ${label}  (N=${m.n}, lowCnf=${m.nLowConfidence}, draws=${m.nDraws}, σ_act=${m.sigmaActualMargin.toFixed(2)})`);
    lines.push(`    MAE          ${ciStr(m.marginMAE)}   nv0 ${ciStr(m.naiveZeroMAE)}   nvHA ${ciStr(m.naiveHomeAdvMAE)}`);
    lines.push(`    RMSE         ${ciStr(m.marginRMSE)}   bias ${ciStr(m.marginBias, 2, true)}`);
    lines.push(`    MAE − nv0    ${ciStr(m.marginMAE_minus_naiveZero, 3, true)}  → ${verdict(sigZero)} predict-zero`);
    lines.push(`    MAE − nvHA   ${ciStr(m.marginMAE_minus_naiveHomeAdv, 3, true)}  → ${verdict(sigHA)} predict-home_adv`);
    if (m.nWinnerEligible > 0) {
      lines.push(`    winner acc   ${ciStr(m.winnerAccuracy, 3)}   (eligible N=${m.nWinnerEligible}, home-win rate ${m.homeWinRate.toFixed(3)})`);
      lines.push(`    Brier        ${ciStr(m.brierScore, 4)}   nvBr ${ciStr(m.naiveBrier, 4)}`);
      lines.push(`    Brier − nvBr ${ciStr(m.brierScore_minus_naiveBrier, 4, true)}  → ${verdict(sigBrier)} naive Brier`);
    }
    if (m.hasPoisson
      && m.poissonMAE && m.poissonMAE_minus_naiveZero
      && m.poissonMAE_minus_v4spread && m.drawBrier
      && m.naiveDrawBrier && m.drawBrier_minus_naiveDraw) {
      const sigPoisZero = significance(m.poissonMAE_minus_naiveZero);
      const sigPoisV4 = significance(m.poissonMAE_minus_v4spread);
      const sigDrawBrier = significance(m.drawBrier_minus_naiveDraw);
      lines.push(`    [v6-poisson-soccer]`);
      lines.push(`    poisson MAE  ${ciStr(m.poissonMAE)}  (v4-spread MAE ${ciStr(m.marginMAE)}; nv0 ${ciStr(m.naiveZeroMAE)})`);
      lines.push(`    pois − nv0   ${ciStr(m.poissonMAE_minus_naiveZero, 3, true)}  → ${verdict(sigPoisZero)} predict-zero  [PRIMARY SHIP GATE]`);
      lines.push(`    pois − v4sp  ${ciStr(m.poissonMAE_minus_v4spread, 3, true)}  → ${verdict(sigPoisV4)} v4-spread`);
      lines.push(`    drawBrier    ${ciStr(m.drawBrier, 4)}  nvDraw ${ciStr(m.naiveDrawBrier, 4)}`);
      lines.push(`    drawB − nvDr ${ciStr(m.drawBrier_minus_naiveDraw, 4, true)}  → ${verdict(sigDrawBrier)} naive draw Brier  [secondary]`);
    }
  }
  return lines.join('\n');
}

export function renderReport(report: BaselineReport): string {
  const lines: string[] = [];
  lines.push(`Baseline Analysis — generated ${report.generatedAt}`);
  lines.push(`Models: winner=${report.models.winner}, margin=${report.models.margin}, soccer-margin=${report.models.soccerMargin}`);
  lines.push(`Train cutoff: season ${report.trainCutoffSeason} (analyzing post-cutoff held-out games)`);
  lines.push(`Holdout split: earliest ${((1 - report.holdoutTestFrac) * 100).toFixed(0)}% / latest ${(report.holdoutTestFrac * 100).toFixed(0)}% by date`);
  lines.push(`Bootstrap: ${report.bootstrapIterations} resamples with replacement (deterministic seed per sport:slice)`);
  lines.push(`Totals: ${report.totals.games} games, ${report.totals.lowConfidence} low-confidence, ${report.totals.draws} draws, ${report.totals.skippedSnapshots} snapshot-skipped`);
  lines.push('');
  lines.push('Margin model = v4-spread predictMargin() with no pitcher/injury data.');
  lines.push('Winner model = v5.predict() sigmoid, no injury adjustment.');
  lines.push('In-sample w.r.t. the parameter calibration. CIs are bootstrap; in-sample');
  lines.push('caveat applies — see honest-disclosure note in baseline.ts header.');
  lines.push('');
  lines.push('Paired-diff verdicts use 95% bootstrap CI:');
  lines.push('  ✓ beats  = CI entirely below zero (model significantly better)');
  lines.push('  ✗ LOSES  = CI entirely above zero (model significantly WORSE than baseline)');
  lines.push('  ~ tie    = CI straddles zero (cannot distinguish at 95%)');
  lines.push('');

  for (const s of report.bySport) {
    lines.push(`━━━ ${s.sport.toUpperCase()} ${'━'.repeat(Math.max(0, 60 - s.sport.length))}`);
    lines.push(renderSportBlock(s));
    lines.push('');
  }

  lines.push('Legend:');
  lines.push('  MAE    mean |predicted_margin - actual_margin|');
  lines.push('  RMSE   sqrt(mean((predicted - actual)^2))');
  lines.push('  bias   mean(predicted - actual); + = model over-predicts home margin');
  lines.push('  nv0    naive "always predict 0" baseline');
  lines.push('  nvHA   naive "always predict home_advantage" baseline');
  lines.push('  nvBr   naive Brier of constant home_win_rate prediction');
  lines.push('  σ_act  sample SD of actual signed margin (units: points/runs/goals)');

  return lines.join('\n');
}
