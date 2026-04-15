/**
 * Reliability diagrams per sport, computed from the baseline replay.
 * Debt #11 (Sprint 7 Researcher, elevated + generalized Sprint 10.8).
 *
 * Two views per sport:
 *   A) Winner-prob reliability (v5): 10 equal bins over [0.5, 1.0], Wilson CI
 *      on actual home-win rate, ECE over populated bins, signed residual.
 *   B) Margin reliability (v4-spread, plus Poisson for MLS/EPL as a second
 *      track): sport-aware bin widths (NBA/NFL 2pt, MLB 1run, NHL/soccer
 *      1goal); normal-theory CI on actual-margin mean per bin (sample SD,
 *      n-1 denominator); weighted-MAE + signed residual + verdict.
 *
 * Pure logic: takes a ReplayedGame[] (from baseline.ts) and emits a typed
 * SportReliability. No DB, no I/O. Deterministic.
 *
 * Honest disclosure: inherits baseline.ts's in-sample caveat. The engine's
 * constants (sigmoid_scale, home_advantage, win-gap buckets) were
 * calibrated against this same corpus — reliability numbers are IN-SAMPLE
 * w.r.t. those knobs.
 *
 * See Plans/reliability-diagrams.md for the council-validated spec and
 * pre-declared ship rules.
 */

import type { Sport } from '../schema/provenance.js';
import type { ReplayedGame } from './baseline.js';

// --- View A: winner-prob bins (shape mirrors existing getCalibration()) ---

export interface WinnerProbBin {
  binLow: number;
  binHigh: number;
  n: number;
  /** True iff the bin has zero games. `predictedAvg` is then the bin midpoint. */
  empty: boolean;
  predictedAvg: number;
  actualRate: number;
  ciLow: number;
  ciHigh: number;
  /** Reporting flag (Stats WARN fix): true iff ciHigh - ciLow > 0.15. Not a
   *  methodological cutoff; just a readability hint. */
  ciWide: boolean;
}

export interface WinnerProbReliability {
  model: string;
  binCount: number;
  /** Winner-eligible games (excludes draws). For non-soccer sports == n. */
  n: number;
  bins: WinnerProbBin[];
  populatedBins: number;
  ece: number | null;
  signedResidual: number | null;
  verdict: 'HONEST' | 'OVERCONFIDENT' | 'SHY' | 'DISCRETE' | 'INSUFFICIENT' | null;
}

// --- View B: margin bins (sport-aware widths) ---

export interface MarginBin {
  binLow: number;
  binHigh: number;
  /** True iff this is the first or last bin (clamps predictions outside range).
   *  `predictedAvg` can drift outside [binLow, binHigh] for terminal bins;
   *  this is expected, not a bug. */
  terminal: boolean;
  n: number;
  empty: boolean;
  predictedAvg: number;
  actualAvg: number;
  /** Sample SD (n-1 denominator) of actual margin in the bin. */
  actualSampleSD: number;
  /** Standard error of actualAvg = actualSampleSD / sqrt(n). */
  actualSE: number;
  ciLow: number;
  ciHigh: number;
  /** Reporting flag: true iff actualSE > 2 * binWidth. */
  ciWide: boolean;
}

export interface MarginReliability {
  model: string;
  binWidth: number;
  binLow: number;
  binHigh: number;
  n: number;
  bins: MarginBin[];
  populatedBins: number;
  /** Weighted-MAE analog of ECE: sum(n_i / N * |residual_i|). Points-of-margin. */
  weightedMAE: number | null;
  signedResidual: number | null;
  verdict: 'HONEST' | 'BIASED_HIGH' | 'BIASED_LOW' | 'DISCRETE' | 'INSUFFICIENT' | null;
}

export interface SportReliability {
  sport: Sport;
  n: number;
  nLowConfidence: number;
  nDraws: number;
  winnerProb: WinnerProbReliability;
  margin: MarginReliability;
  /** Poisson margin reliability, only present for MLS/EPL. */
  poissonMargin: MarginReliability | null;
}

export interface ReliabilityReport {
  generatedAt: string;
  inSampleCaveat: string;
  bySport: SportReliability[];
  totals: {
    games: number;
    lowConfidence: number;
    draws: number;
  };
}

// --- Sport bin specs (Domain WARN fix) ---

interface BinSpec { width: number; low: number; high: number; }

const SPORT_MARGIN_BINS: Record<Sport, BinSpec> = {
  nba: { width: 2, low: -20, high: 20 },
  nfl: { width: 2, low: -20, high: 20 },
  mlb: { width: 1, low: -10, high: 10 },
  nhl: { width: 1, low: -6,  high: 6 },
  mls: { width: 1, low: -5,  high: 5 },
  epl: { width: 1, low: -5,  high: 5 },
};

// --- Thresholds (pre-declared) ---

const INSUFFICIENT_N = 50;
const WINNER_VERDICT_THRESH = 0.02;      // signed residual |x| > 0.02 => OVERCONFIDENT/SHY
const MARGIN_VERDICT_THRESH = 0.5;       // signed residual |x| > 0.5 points => BIASED_*
const WINNER_CI_WIDE_THRESH = 0.15;      // report ciWide if Wilson CI width > 0.15
const MARGIN_CI_WIDE_MULT = 2;           // report ciWide if actualSE > 2 * binWidth

// --- Stats helpers ---

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

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample SD with (n-1) denominator. Returns 0 for n <= 1. */
function sampleSD(xs: number[]): number {
  if (xs.length <= 1) return 0;
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) ** 2;
  return Math.sqrt(ss / (xs.length - 1));
}

// --- View A: winner-prob reliability ---

export function computeWinnerProbReliability(
  rows: Array<{ predictedProb: number; homeWin: 0 | 1; isDraw: boolean }>,
  modelLabel = 'v5',
  binCount = 10,
): WinnerProbReliability {
  const binWidth = 0.5 / binCount;
  const buckets: { sumPred: number; correct: number; n: number }[] = Array.from(
    { length: binCount },
    () => ({ sumPred: 0, correct: 0, n: 0 }),
  );

  let eligible = 0;
  for (const r of rows) {
    if (r.isDraw) continue;                 // winner-prob reliability = binary; skip draws
    const p = r.predictedProb;
    if (p < 0.5 || p > 1.0) continue;       // defensive: shouldn't happen by convention
    let idx = Math.floor((p - 0.5) / binWidth);
    if (idx >= binCount) idx = binCount - 1; // terminal bin closed both ends
    if (idx < 0) idx = 0;
    buckets[idx].sumPred += p;
    buckets[idx].correct += r.homeWin;
    buckets[idx].n += 1;
    eligible += 1;
  }

  const bins: WinnerProbBin[] = [];
  let populated = 0;
  let eceSum = 0;
  let signedSum = 0;

  for (let i = 0; i < binCount; i++) {
    const b = buckets[i];
    const lo = 0.5 + i * binWidth;
    const hi = lo + binWidth;
    if (b.n === 0) {
      bins.push({
        binLow: lo, binHigh: hi, n: 0, empty: true,
        predictedAvg: lo + binWidth / 2,
        actualRate: 0, ciLow: 0, ciHigh: 1, ciWide: false,
      });
      continue;
    }
    populated += 1;
    const predictedAvg = b.sumPred / b.n;
    const wilson = wilsonCI(b.correct, b.n);
    const actualRate = b.correct / b.n;
    const residual = actualRate - predictedAvg;
    const width = wilson.hi - wilson.lo;
    bins.push({
      binLow: lo, binHigh: hi, n: b.n, empty: false,
      predictedAvg,
      actualRate,
      ciLow: wilson.lo, ciHigh: wilson.hi,
      ciWide: width > WINNER_CI_WIDE_THRESH,
    });
    eceSum += (b.n / Math.max(1, eligible)) * Math.abs(residual);
    signedSum += (b.n / Math.max(1, eligible)) * residual;
  }

  let verdict: WinnerProbReliability['verdict'] = null;
  if (eligible < INSUFFICIENT_N) {
    verdict = 'INSUFFICIENT';
  } else if (populated <= 2) {
    verdict = 'DISCRETE';
  } else if (signedSum > WINNER_VERDICT_THRESH) {
    verdict = 'SHY';                     // actual > predicted = model too modest
  } else if (signedSum < -WINNER_VERDICT_THRESH) {
    verdict = 'OVERCONFIDENT';           // actual < predicted = model claims too much
  } else {
    verdict = 'HONEST';
  }

  return {
    model: modelLabel,
    binCount,
    n: eligible,
    bins,
    populatedBins: populated,
    ece: eligible > 0 ? eceSum : null,
    signedResidual: eligible > 0 ? signedSum : null,
    verdict,
  };
}

// --- View B: margin reliability ---

export function computeMarginReliability(
  rows: Array<{ predictedMargin: number; actualMargin: number }>,
  modelLabel: string,
  spec: BinSpec,
): MarginReliability {
  const { width, low, high } = spec;
  const binCount = Math.round((high - low) / width);

  const buckets: { pred: number[]; actual: number[] }[] = Array.from(
    { length: binCount },
    () => ({ pred: [], actual: [] }),
  );

  for (const r of rows) {
    let idx = Math.floor((r.predictedMargin - low) / width);
    if (idx < 0) idx = 0;
    if (idx >= binCount) idx = binCount - 1;
    buckets[idx].pred.push(r.predictedMargin);
    buckets[idx].actual.push(r.actualMargin);
  }

  const bins: MarginBin[] = [];
  let populated = 0;
  let maeSum = 0;
  let signedSum = 0;
  const N = rows.length;

  for (let i = 0; i < binCount; i++) {
    const b = buckets[i];
    const lo = low + i * width;
    const hi = lo + width;
    const terminal = i === 0 || i === binCount - 1;
    if (b.pred.length === 0) {
      bins.push({
        binLow: lo, binHigh: hi, terminal, n: 0, empty: true,
        predictedAvg: lo + width / 2,
        actualAvg: 0, actualSampleSD: 0, actualSE: 0,
        ciLow: 0, ciHigh: 0, ciWide: false,
      });
      continue;
    }
    populated += 1;
    const predictedAvg = mean(b.pred);
    const actualAvg = mean(b.actual);
    const sd = sampleSD(b.actual);
    const se = sd / Math.sqrt(b.pred.length);
    const half = 1.96 * se;
    const residual = actualAvg - predictedAvg;
    bins.push({
      binLow: lo, binHigh: hi, terminal,
      n: b.pred.length, empty: false,
      predictedAvg, actualAvg,
      actualSampleSD: sd, actualSE: se,
      ciLow: actualAvg - half, ciHigh: actualAvg + half,
      ciWide: se > MARGIN_CI_WIDE_MULT * width,
    });
    maeSum += (b.pred.length / Math.max(1, N)) * Math.abs(residual);
    signedSum += (b.pred.length / Math.max(1, N)) * residual;
  }

  let verdict: MarginReliability['verdict'] = null;
  if (N < INSUFFICIENT_N) {
    verdict = 'INSUFFICIENT';
  } else if (populated <= 2) {
    verdict = 'DISCRETE';
  } else if (signedSum > MARGIN_VERDICT_THRESH) {
    verdict = 'BIASED_LOW';              // actual > predicted = model under-predicts
  } else if (signedSum < -MARGIN_VERDICT_THRESH) {
    verdict = 'BIASED_HIGH';             // actual < predicted = model over-predicts
  } else {
    verdict = 'HONEST';
  }

  return {
    model: modelLabel,
    binWidth: width,
    binLow: low,
    binHigh: high,
    n: N,
    bins,
    populatedBins: populated,
    weightedMAE: N > 0 ? maeSum : null,
    signedResidual: N > 0 ? signedSum : null,
    verdict,
  };
}

// --- Per-sport orchestration ---

export function computeSportReliability(
  sport: Sport,
  games: ReplayedGame[],
): SportReliability {
  const spec = SPORT_MARGIN_BINS[sport];

  const winnerRows = games.map(g => ({
    predictedProb: g.predictedProb,
    homeWin: g.homeWin,
    isDraw: g.isDraw,
  }));
  const winnerProb = computeWinnerProbReliability(winnerRows, 'v5');

  const marginRows = games.map(g => ({
    predictedMargin: g.predictedMargin,
    actualMargin: g.actualMargin,
  }));
  const margin = computeMarginReliability(marginRows, 'v4-spread', spec);

  let poissonMargin: MarginReliability | null = null;
  const isSoccer = sport === 'mls' || sport === 'epl';
  if (isSoccer) {
    const poissonRows = games
      .filter(g => g.poissonMargin !== null)
      .map(g => ({
        predictedMargin: g.poissonMargin as number,
        actualMargin: g.actualMargin,
      }));
    if (poissonRows.length > 0) {
      poissonMargin = computeMarginReliability(poissonRows, 'v6-poisson-soccer', spec);
    }
  }

  return {
    sport,
    n: games.length,
    nLowConfidence: games.filter(g => g.lowConfidence).length,
    nDraws: games.filter(g => g.isDraw).length,
    winnerProb,
    margin,
    poissonMargin,
  };
}

// --- Human-readable rendering ---

function fmt(n: number, d = 2, signed = false): string {
  const s = (signed && n >= 0 ? '+' : '') + n.toFixed(d);
  return s;
}

function renderWinnerBlock(r: WinnerProbReliability): string[] {
  const lines: string[] = [];
  lines.push(`  Winner-prob reliability (${r.binCount} bins, 0.5-1.0, model ${r.model}, N=${r.n}):`);
  if (r.n === 0) { lines.push(`    (no winner-eligible games)`); return lines; }
  for (const b of r.bins) {
    if (b.empty) continue;
    const flag = b.ciWide ? '  ciWide' : '';
    lines.push(`    bin ${b.binLow.toFixed(2)}-${b.binHigh.toFixed(2)}  n=${String(b.n).padStart(5)}  pred=${b.predictedAvg.toFixed(3)}  actual=${b.actualRate.toFixed(3)} [${b.ciLow.toFixed(3)}, ${b.ciHigh.toFixed(3)}]  resid ${fmt(b.actualRate - b.predictedAvg, 3, true)}${flag}`);
  }
  lines.push(`    ECE=${r.ece === null ? 'n/a' : r.ece.toFixed(4)}   signedResid=${r.signedResidual === null ? 'n/a' : fmt(r.signedResidual, 4, true)}   populated=${r.populatedBins}/${r.binCount}   verdict: ${r.verdict}`);
  return lines;
}

function renderMarginBlock(r: MarginReliability): string[] {
  const lines: string[] = [];
  const nBins = r.bins.length;
  lines.push(`  Margin reliability (${r.binWidth}-unit bins, ${r.binLow}..${r.binHigh}, model ${r.model}, N=${r.n}):`);
  if (r.n === 0) { lines.push(`    (no games)`); return lines; }
  for (const b of r.bins) {
    if (b.empty) continue;
    const flag = (b.ciWide ? '  ciWide' : '') + (b.terminal ? '  terminal' : '');
    lines.push(`    bin ${fmt(b.binLow, 1, true).padStart(6)}..${fmt(b.binHigh, 1, true).padStart(6)}  n=${String(b.n).padStart(5)}  pred=${fmt(b.predictedAvg, 2, true)}  actual=${fmt(b.actualAvg, 2, true)} [${fmt(b.ciLow, 2, true)}, ${fmt(b.ciHigh, 2, true)}]  resid ${fmt(b.actualAvg - b.predictedAvg, 2, true)}${flag}`);
  }
  lines.push(`    weightedMAE=${r.weightedMAE === null ? 'n/a' : r.weightedMAE.toFixed(3)} units   signedResid=${r.signedResidual === null ? 'n/a' : fmt(r.signedResidual, 3, true)}   populated=${r.populatedBins}/${nBins}   verdict: ${r.verdict}`);
  return lines;
}

export function renderReliabilityReport(report: ReliabilityReport): string {
  const lines: string[] = [];
  lines.push('=== Reliability Diagrams (per sport, from baseline replay) ===');
  lines.push(`generated: ${report.generatedAt}`);
  lines.push(`total games: ${report.totals.games}  lowCnf: ${report.totals.lowConfidence}  draws: ${report.totals.draws}`);
  lines.push('');
  lines.push('In-sample caveat: ' + report.inSampleCaveat);
  lines.push('');

  for (const s of report.bySport) {
    lines.push(`── ${s.sport.toUpperCase()}  (N=${s.n}, lowCnf=${s.nLowConfidence}, draws=${s.nDraws}) ──`);
    if (s.n === 0) {
      lines.push('  (no replay data)');
      lines.push('');
      continue;
    }
    lines.push(...renderWinnerBlock(s.winnerProb));
    lines.push(...renderMarginBlock(s.margin));
    if (s.poissonMargin) {
      lines.push(...renderMarginBlock(s.poissonMargin));
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- Orchestrator that pulls replay data via baseline.ts ---

export async function computeReliabilityReport(): Promise<ReliabilityReport> {
  // Lazy import to avoid circular: baseline.ts imports are side-effect-free
  // for pure functions but replaySportForExport touches the DB.
  const baseline = await import('./baseline.js');
  const bySport: SportReliability[] = [];
  let totalGames = 0, totalLowConf = 0, totalDraws = 0;

  for (const sport of baseline.SPORTS) {
    const { games } = baseline.replaySportForExport(sport);
    const entry = computeSportReliability(sport, games);
    bySport.push(entry);
    totalGames += entry.n;
    totalLowConf += entry.nLowConfidence;
    totalDraws += entry.nDraws;
  }

  return {
    generatedAt: new Date().toISOString(),
    inSampleCaveat:
      'Engine constants (sigmoid_scale, home_advantage, win-gap buckets) were ' +
      'calibrated against this same corpus. Reliability numbers are IN-SAMPLE ' +
      'w.r.t. those knobs. See src/analysis/baseline.ts header for the full disclosure.',
    bySport,
    totals: { games: totalGames, lowConfidence: totalLowConf, draws: totalDraws },
  };
}

// --- Inline determinism / correctness check (ship rule 3-4) ---
//
// Tiny synthetic dataset hand-computed to verify ECE and weightedMAE match
// expected values. Run at module load in dev via `tsx reliability.ts --check`.
// This is not a test framework — just a sanity check for shipped math.

export function __selfCheck(): { pass: boolean; reason?: string } {
  // View A: 4 games, all in bin 0.6-0.65. pred avg = 0.625. 3 of 4 correct = 0.75.
  // ECE contribution = (4/4) * |0.75 - 0.625| = 0.125.
  const rowsA = [
    { predictedProb: 0.62, homeWin: 1 as 0 | 1, isDraw: false },
    { predictedProb: 0.63, homeWin: 1 as 0 | 1, isDraw: false },
    { predictedProb: 0.63, homeWin: 1 as 0 | 1, isDraw: false },
    { predictedProb: 0.62, homeWin: 0 as 0 | 1, isDraw: false },
  ];
  const a = computeWinnerProbReliability(rowsA);
  if (a.ece === null || Math.abs(a.ece - 0.125) > 1e-9) {
    return { pass: false, reason: `ECE expected 0.125, got ${a.ece}` };
  }
  // View B: 4 games, all predicted 5.0, actuals [4, 5, 6, 5]. predAvg=5, actualAvg=5, residual=0.
  const rowsB = [
    { predictedMargin: 5.0, actualMargin: 4 },
    { predictedMargin: 5.0, actualMargin: 5 },
    { predictedMargin: 5.0, actualMargin: 6 },
    { predictedMargin: 5.0, actualMargin: 5 },
  ];
  const b = computeMarginReliability(rowsB, 'test', { width: 2, low: -20, high: 20 });
  if (b.weightedMAE === null || Math.abs(b.weightedMAE) > 1e-9) {
    return { pass: false, reason: `weightedMAE expected ~0, got ${b.weightedMAE}` };
  }
  // Sample SD of [4,5,6,5] with (n-1) = sqrt((1+0+1+0)/3) = sqrt(2/3) ≈ 0.8165
  const bin = b.bins.find(x => !x.empty);
  if (!bin || Math.abs(bin.actualSampleSD - Math.sqrt(2 / 3)) > 1e-9) {
    return { pass: false, reason: `sample SD expected sqrt(2/3), got ${bin?.actualSampleSD}` };
  }
  return { pass: true };
}
