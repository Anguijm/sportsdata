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
  actualMargin: number;      // signed: home_score - away_score
  homeWin: 0 | 1;            // 1 only if home won strictly (draws = 0)
  isDraw: boolean;
  lowConfidence: boolean;
}

export interface BaselineMetrics {
  n: number;
  nLowConfidence: number;
  nDraws: number;
  /** Games used for winner/Brier metrics (excludes low-confidence and draws). */
  nWinnerEligible: number;
  /** Per-sport home-win rate on the analyzed slice (excluding draws). */
  homeWinRate: number;
  /** Population SD of actual signed margin. Contextualizes MAE. */
  sigmaActualMargin: number;
  /** Population SD of predicted margin. */
  sigmaPredictedMargin: number;
  /** Mean absolute error of the margin prediction. */
  marginMAE: number;
  /** Root-mean-square error of the margin prediction. */
  marginRMSE: number;
  /** Signed bias: mean(predicted - actual). Negative = model under-predicts
   *  home margin. Bias alone is the portion of error that's correctable by
   *  adjusting home_advantage or similar shift parameters. */
  marginBias: number;
  /** Fraction of games the v5 winner pick was correct (excluding low-conf and draws). */
  winnerAccuracy: number;
  /** Mean Brier score of the v5 probability (excluding low-conf and draws). */
  brierScore: number;
  /** Naive baseline for Brier: constant home_win_rate prediction each game. */
  naiveBrier: number;
  /** MAE a "predict zero" model would achieve. Contextualizes marginMAE. */
  naiveZeroMAE: number;
  /** MAE a "predict home_advantage" model would achieve. */
  naiveHomeAdvMAE: number;
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
  models: {
    winner: 'v5';
    margin: 'v4-spread';
  };
  totals: {
    games: number;
    lowConfidence: number;
    draws: number;
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

function replaySport(sport: Sport): ReplayedGame[] {
  const games = loadScoredGames(sport);
  const snapshots = buildStateSnapshots(sport);
  const out: ReplayedGame[] = [];

  for (const g of games) {
    const snap = snapshots.get(g.game_id);
    if (!snap) continue;
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

    out.push({
      date: g.date,
      sport,
      predictedProb,
      predictedMargin,
      actualMargin: g.home_score - g.away_score,
      homeWin: g.home_win === 1 && g.is_draw !== 1 ? 1 : 0,
      isDraw: g.is_draw === 1,
      lowConfidence,
    });
  }
  return out;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function populationSD(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) ** 2;
  return Math.sqrt(ss / xs.length);
}

/** Home-advantage literal from predict.ts. Duplicated to keep this module
 *  independent and to measure a transparent naive baseline without coupling
 *  to implementation constants. If predict.ts changes these, rerun the
 *  baseline. */
const NAIVE_HOME_ADV: Record<Sport, number> = {
  nba: 3.0, nfl: 2.5, mlb: 0.5, nhl: 0.3, mls: 0.4, epl: 0.4,
};

function computeMetrics(sport: Sport, games: ReplayedGame[]): BaselineMetrics {
  const n = games.length;
  const nDraws = games.filter(g => g.isDraw).length;
  const nLowConfidence = games.filter(g => g.lowConfidence).length;

  // Margin metrics: all games (including draws and low-conf) — the margin
  // model is supposed to produce a number for every game.
  const actualMargins = games.map(g => g.actualMargin);
  const predictedMargins = games.map(g => g.predictedMargin);
  const errors = games.map(g => g.predictedMargin - g.actualMargin);

  const marginMAE = mean(errors.map(Math.abs));
  const marginRMSE = Math.sqrt(mean(errors.map(e => e * e)));
  const marginBias = mean(errors);
  const sigmaActualMargin = populationSD(actualMargins);
  const sigmaPredictedMargin = populationSD(predictedMargins);

  // Naive baselines
  const naiveZeroMAE = mean(actualMargins.map(Math.abs));
  const homeAdv = NAIVE_HOME_ADV[sport] ?? 3.0;
  const naiveHomeAdvMAE = mean(actualMargins.map(a => Math.abs(homeAdv - a)));

  // Winner metrics: exclude draws and low-confidence
  const eligible = games.filter(g => !g.isDraw && !g.lowConfidence);
  const nWinnerEligible = eligible.length;
  const homeWins = eligible.filter(g => g.homeWin === 1).length;
  const homeWinRate = nWinnerEligible > 0 ? homeWins / nWinnerEligible : 0;

  let correct = 0;
  let brierSum = 0;
  let naiveBrierSum = 0;
  for (const g of eligible) {
    const pickHome = g.predictedProb >= 0.5;
    if ((pickHome && g.homeWin === 1) || (!pickHome && g.homeWin === 0)) correct++;
    brierSum += (g.predictedProb - g.homeWin) ** 2;
    naiveBrierSum += (homeWinRate - g.homeWin) ** 2;
  }

  const winnerAccuracy = nWinnerEligible > 0 ? correct / nWinnerEligible : 0;
  const brierScore = nWinnerEligible > 0 ? brierSum / nWinnerEligible : 0;
  const naiveBrier = nWinnerEligible > 0 ? naiveBrierSum / nWinnerEligible : 0;

  return {
    n, nLowConfidence, nDraws, nWinnerEligible,
    homeWinRate,
    sigmaActualMargin, sigmaPredictedMargin,
    marginMAE, marginRMSE, marginBias,
    winnerAccuracy, brierScore, naiveBrier,
    naiveZeroMAE, naiveHomeAdvMAE,
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

  for (const sport of SPORTS) {
    const games = replaySport(sport);
    if (games.length === 0) {
      // Still record an empty entry so UI/downstream don't silently drop the sport.
      bySport.push({
        sport,
        all: computeMetrics(sport, []),
        trainEarlier80: computeMetrics(sport, []),
        testLatest20: computeMetrics(sport, []),
        splitDate: '',
      });
      continue;
    }
    const { train, test, splitDate } = splitByDate(games, HOLDOUT_TEST_FRAC);
    bySport.push({
      sport,
      all: computeMetrics(sport, games),
      trainEarlier80: computeMetrics(sport, train),
      testLatest20: computeMetrics(sport, test),
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
    models: { winner: 'v5', margin: 'v4-spread' },
    totals: {
      games: totalGames,
      lowConfidence: totalLowConf,
      draws: totalDraws,
    },
    bySport,
  };
}

// --- Human-readable rendering ---

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function pct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

function renderMetricsRow(label: string, m: BaselineMetrics): string {
  return [
    label.padEnd(18),
    String(m.n).padStart(6),
    String(m.nLowConfidence).padStart(7),
    String(m.nDraws).padStart(6),
    fmt(m.sigmaActualMargin).padStart(8),
    fmt(m.marginMAE).padStart(6),
    fmt(m.marginRMSE).padStart(6),
    (m.marginBias >= 0 ? '+' : '') + fmt(m.marginBias).padStart(5),
    fmt(m.naiveZeroMAE).padStart(7),
    fmt(m.naiveHomeAdvMAE).padStart(7),
    pct(m.winnerAccuracy).padStart(7),
    fmt(m.brierScore, 4).padStart(7),
    fmt(m.naiveBrier, 4).padStart(7),
  ].join(' ');
}

export function renderReport(report: BaselineReport): string {
  const lines: string[] = [];
  lines.push(`Baseline Analysis — generated ${report.generatedAt}`);
  lines.push(`Models: winner=${report.models.winner}, margin=${report.models.margin}`);
  lines.push(`Train cutoff: season ${report.trainCutoffSeason} (analyzing post-cutoff held-out games)`);
  lines.push(`Holdout split: earliest ${((1 - report.holdoutTestFrac) * 100).toFixed(0)}% / latest ${(report.holdoutTestFrac * 100).toFixed(0)}% by date`);
  lines.push(`Totals: ${report.totals.games} games, ${report.totals.lowConfidence} low-confidence, ${report.totals.draws} draws`);
  lines.push('');
  lines.push('Note: margin model = v4-spread predictMargin() with no pitcher/injury data');
  lines.push('      winner model = v5.predict() sigmoid, no injury adjustment');
  lines.push('      In-sample w.r.t. the parameter calibration. See honest disclosure in baseline.ts.');
  lines.push('');

  const header = [
    'slice             ',
    '     N',
    ' lowCnf',
    ' draws',
    '   σ_act',
    '   MAE',
    '  RMSE',
    '  bias',
    ' nv0MAE',
    ' nvHMAE',
    '    acc',
    ' Brier',
    '  nvBr',
  ].join(' ');

  for (const s of report.bySport) {
    lines.push(`━━━ ${s.sport.toUpperCase()} ${'━'.repeat(Math.max(0, 60 - s.sport.length))}`);
    if (s.all.n === 0) {
      lines.push('  (no data)');
      continue;
    }
    lines.push(header);
    lines.push(renderMetricsRow('all', s.all));
    lines.push(renderMetricsRow(`train (<${s.splitDate})`, s.trainEarlier80));
    lines.push(renderMetricsRow(`test  (>=${s.splitDate})`, s.testLatest20));
    lines.push('');
  }

  lines.push('Column legend:');
  lines.push('  N        total games in slice');
  lines.push('  lowCnf   games with <5 state games (excluded from winner metrics)');
  lines.push('  draws    soccer draws (excluded from winner metrics, kept in margin metrics)');
  lines.push('  σ_act    population SD of actual signed margin (points/runs/goals)');
  lines.push('  MAE      mean |predicted_margin - actual_margin|');
  lines.push('  RMSE     sqrt(mean((predicted - actual)^2)) — heavy-tail sensitive');
  lines.push('  bias     mean(predicted - actual); + = model over-predicts home margin');
  lines.push('  nv0MAE   MAE of "always predict 0" baseline — contextualizes MAE');
  lines.push('  nvHMAE   MAE of "always predict home_advantage" baseline');
  lines.push('  acc      v5 winner accuracy (excl low-conf and draws)');
  lines.push('  Brier    v5 Brier score (excl low-conf and draws)');
  lines.push('  nvBr     Brier of constant home_win_rate prediction — reference');

  return lines.join('\n');
}
