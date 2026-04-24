/**
 * Phase 1 pre-flight diagnostic for the NBA learned-model pilot.
 *
 * Computes three numbers that the council-CLEAR plan
 * (Plans/nba-learned-model.md) requires to land in the plan body
 * before Phase 1 implementation begins:
 *
 *   1. v5 NBA Brier on the 2024-25 validation fold (incumbent anchor).
 *   2. Pearson correlations of (home_rolling_N − away_rolling_N) and
 *      (home_season − away_season) against per-game margin, for
 *      N ∈ {5, 7, 10, 15, 20}. Threshold: best rolling-N must exceed
 *      season-diff correlation by ≥ 0.02 absolute to avoid Phase 1
 *      premise failure.
 *   3. Expected paired-diff block-bootstrap SE from a v5-vs-{v5 +
 *      empirical logit-space Gaussian noise} simulation. Block =
 *      (home_team, ISO-week), B = 10,000 resamples. Threshold:
 *      SE ≤ 0.0033 → 0.010 absolute Brier beat is a 3σ gate.
 *
 * Run:
 *   npx tsx scripts/phase1-preflight-correlation.ts
 *
 * No DB writes. Pure read + stdout report.
 */

import { getDb, closeDb } from '../src/storage/sqlite.js';
import { v5 } from '../src/analysis/predict.js';
import type { PredictionContext, TeamState, GameForPrediction } from '../src/analysis/predict.js';

// ---------- Constants (match plan §Phase 1) ----------

const NBA_2024_25_START = '2024-10-01';
const NBA_2024_25_END = '2025-10-01';
const ROLLING_WINDOWS = [5, 7, 10, 15, 20] as const;
const COLD_START_MIN_GAMES = 5; // v5's internal cold-start; plan raises to 15 for v6
const BOOTSTRAP_B = 10_000;

// ---------- Types ----------

interface GameRow {
  game_id: string;
  date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  home_win: number;
}

interface Sample {
  game: GameForPrediction;
  ctx: PredictionContext;
  homeRollingDiff: Map<number, number | null>;
  awayRollingDiff: Map<number, number | null>;
  homeSeasonDiff: number | null;
  awaySeasonDiff: number | null;
  margin: number; // home_score - away_score
  week: string; // ISO yyyy-Www
  probV5: number;
}

// ---------- Helpers ----------

function isoWeek(dateStr: string): string {
  // ISO-8601 week: Monday-based, week 01 contains the first Thursday of the year
  const d = new Date(dateStr + 'T00:00:00Z');
  const target = new Date(d);
  const dayNr = (d.getUTCDay() + 6) % 7; // 0 = Monday
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  const weekNo = 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function logit(p: number): number {
  const clamped = Math.max(1e-6, Math.min(1 - 1e-6, p));
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const ss = xs.reduce((a, x) => a + (x - m) ** 2, 0);
  return Math.sqrt(ss / (xs.length - 1));
}

function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? NaN : num / denom;
}

// Box-Muller normal sampler
function randNormal(sigma: number): number {
  const u1 = Math.random() || 1e-12;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return sigma * z;
}

function brier(p: number, y: number): number {
  return (p - y) ** 2;
}

// ---------- Load + build point-in-time state + rolling-N ----------

function loadSamples(): Sample[] {
  const db = getDb();

  // All NBA games ever resolved, chronological. State walks globally so
  // pre-2024 games feed state before we start recording 2024-25 samples.
  const rows = db.prepare(`
    SELECT gr.game_id, gr.date, g.home_team_id, g.away_team_id,
           gr.home_score, gr.away_score, gr.home_win
    FROM game_results gr
    JOIN games g ON gr.game_id = g.id
    WHERE gr.sport = 'nba'
    ORDER BY gr.date, gr.game_id
  `).all() as GameRow[];

  // Global team state: season-reset at NBA season boundary (matches
  // buildTeamStateUpTo convention in predict-runner.ts).
  const seasonState = new Map<string, TeamState>();
  const seasonKey = new Map<string, number>();

  // Per-team rolling margin history within the current season.
  // Stores chronologically ordered (signedMarginForThisTeam) numbers.
  const rollingHistory = new Map<string, number[]>();

  const nbaSeasonYear = (date: string): number => {
    const d = new Date(date);
    return d.getUTCMonth() >= 9 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  };

  const getOrInit = (teamId: string, gameSeasonYear: number): TeamState => {
    const currentSeason = seasonKey.get(teamId);
    if (currentSeason !== gameSeasonYear) {
      // Season boundary: reset state
      seasonState.set(teamId, {
        games: 0, wins: 0, losses: 0,
        pointsFor: 0, pointsAgainst: 0,
        lastNResults: [],
      });
      rollingHistory.set(teamId, []);
      seasonKey.set(teamId, gameSeasonYear);
    }
    return seasonState.get(teamId)!;
  };

  const rollingDiffAt = (teamId: string, N: number): number | null => {
    const hist = rollingHistory.get(teamId);
    if (!hist || hist.length < N) return null;
    const window = hist.slice(-N);
    return window.reduce((a, b) => a + b, 0) / N;
  };

  const seasonDiff = (s: TeamState): number | null => {
    return s.games > 0 ? (s.pointsFor - s.pointsAgainst) / s.games : null;
  };

  const samples: Sample[] = [];

  for (const r of rows) {
    const seasonYear = nbaSeasonYear(r.date);
    const homeState = getOrInit(r.home_team_id, seasonYear);
    const awayState = getOrInit(r.away_team_id, seasonYear);

    const inValFold = r.date >= NBA_2024_25_START && r.date < NBA_2024_25_END;

    if (inValFold) {
      const context: PredictionContext = {
        home: { ...homeState, lastNResults: [...homeState.lastNResults] },
        away: { ...awayState, lastNResults: [...awayState.lastNResults] },
        asOfDate: r.date,
      };
      const game: GameForPrediction = {
        game_id: r.game_id,
        date: r.date,
        sport: 'nba',
        home_team_id: r.home_team_id,
        away_team_id: r.away_team_id,
        home_win: r.home_win,
      };

      const homeRollingDiff = new Map<number, number | null>();
      const awayRollingDiff = new Map<number, number | null>();
      for (const N of ROLLING_WINDOWS) {
        homeRollingDiff.set(N, rollingDiffAt(r.home_team_id, N));
        awayRollingDiff.set(N, rollingDiffAt(r.away_team_id, N));
      }

      samples.push({
        game,
        ctx: context,
        homeRollingDiff,
        awayRollingDiff,
        homeSeasonDiff: seasonDiff(homeState),
        awaySeasonDiff: seasonDiff(awayState),
        margin: r.home_score - r.away_score,
        week: isoWeek(r.date),
        probV5: v5.predict(game, context),
      });
    }

    // Update state AFTER snapshotting
    homeState.games++;
    awayState.games++;
    homeState.pointsFor += r.home_score;
    homeState.pointsAgainst += r.away_score;
    awayState.pointsFor += r.away_score;
    awayState.pointsAgainst += r.home_score;
    if (r.home_win === 1) {
      homeState.wins++;
      awayState.losses++;
    } else {
      homeState.losses++;
      awayState.wins++;
    }
    homeState.lastNResults = [...homeState.lastNResults, r.home_win === 1].slice(-5);
    awayState.lastNResults = [...awayState.lastNResults, r.home_win !== 1].slice(-5);

    const homeMargin = r.home_score - r.away_score;
    const homeHist = rollingHistory.get(r.home_team_id)!;
    const awayHist = rollingHistory.get(r.away_team_id)!;
    homeHist.push(homeMargin);
    awayHist.push(-homeMargin);
  }

  return samples;
}

// ---------- Metric: v5 Brier ----------

function v5BrierValFold(samples: Sample[]): { brier: number; n: number; lowConf: number } {
  let sum = 0;
  let n = 0;
  let lowConf = 0;
  for (const s of samples) {
    sum += brier(s.probV5, s.game.home_win);
    n++;
    if (s.ctx.home.games < COLD_START_MIN_GAMES || s.ctx.away.games < COLD_START_MIN_GAMES) {
      lowConf++;
    }
  }
  return { brier: sum / n, n, lowConf };
}

// ---------- Metric: rolling vs season correlations ----------

function correlationsVsMargin(samples: Sample[]): {
  season: { n: number; r: number };
  rolling: Array<{ N: number; n: number; r: number }>;
} {
  // season-diff gap feature: home_season - away_season
  const seasonPairs: Array<{ gap: number; margin: number }> = [];
  for (const s of samples) {
    if (s.homeSeasonDiff != null && s.awaySeasonDiff != null) {
      seasonPairs.push({
        gap: s.homeSeasonDiff - s.awaySeasonDiff,
        margin: s.margin,
      });
    }
  }
  const seasonR = pearson(
    seasonPairs.map((p) => p.gap),
    seasonPairs.map((p) => p.margin),
  );

  const rolling = ROLLING_WINDOWS.map((N) => {
    const pairs: Array<{ gap: number; margin: number }> = [];
    for (const s of samples) {
      const h = s.homeRollingDiff.get(N);
      const a = s.awayRollingDiff.get(N);
      if (h != null && a != null) {
        pairs.push({ gap: h - a, margin: s.margin });
      }
    }
    return {
      N,
      n: pairs.length,
      r: pearson(pairs.map((p) => p.gap), pairs.map((p) => p.margin)),
    };
  });

  return {
    season: { n: seasonPairs.length, r: seasonR },
    rolling,
  };
}

// ---------- Metric: paired-diff block-bootstrap SE (Proposal A, revised) ----------
//
// Addendum v2 methodology (council-CLEAR 2026-04-24): replaces the original
// logit-space-Gaussian noise simulation with the plug-in estimator for
// v5-vs-(v5-with-rolling-20-feature-swap). This is the paired Brier diff
// between v5 and a "v6-simulated" that uses rolling-20 point differential
// instead of season-to-date differential. Same sigmoid, scale, home-adv,
// cold-start fallback.
//
// SE feeds forward to the §Phase 3 rule 1 0.010/3σ threshold.
// Mean paired diff is INFORMATIONAL ONLY — NOT a ship signal.

const V6_SIM_ROLLING_WINDOW = 20 as const; // premise-check grid-winner

// Sigmoid constants — matches v5 for NBA
const NBA_SIGMOID_SCALE = 0.10;
const NBA_HOME_ADV = 2.25; // post-PR #34 recalibration
const NBA_BASE_RATE = 0.57; // empirical NBA home-win rate (cold-start fallback)
const V5_MIN_GAMES = 5;    // cold-start threshold in v5.predict

function predictV6Simulated(s: Sample): { prob: number; coldStart: boolean } {
  // Cold-start fallback: if either team has fewer than 20 rolling-window
  // entries, or if v5 itself would have cold-started (games < 5), fall
  // through to v5's season-diff path. This ensures v6-simulated is NEVER
  // worse than v5 when it has less info than v5 does.
  const homeRolling = s.homeRollingDiff.get(V6_SIM_ROLLING_WINDOW);
  const awayRolling = s.awayRollingDiff.get(V6_SIM_ROLLING_WINDOW);

  if (homeRolling == null || awayRolling == null) {
    return { prob: s.probV5, coldStart: true };
  }
  if (s.ctx.home.games < V5_MIN_GAMES || s.ctx.away.games < V5_MIN_GAMES) {
    return { prob: s.probV5, coldStart: true };
  }

  // v5 sigmoid with rolling-20 feature swap
  const x = NBA_SIGMOID_SCALE * ((homeRolling - awayRolling) + NBA_HOME_ADV);
  let prob = sigmoid(x);
  prob = Math.max(0.15, Math.min(0.85, prob));
  return { prob, coldStart: false };
}

function pairedDiffBlockBootstrapSE(samples: Sample[]): {
  pairedDiffMean: number;
  pairedDiffSE: number;
  blockCount: number;
  pairCount: number;
  coldStartExcluded: number;
} {
  // 1. Compute per-game paired Brier diff (v6_sim − v5). Exclude games
  //    where v6-simulated cold-started to v5 (identical predictions →
  //    zero-diff blocks that artificially deflate SE).
  const pairedDiffs: Array<{ diff: number; block: string }> = [];
  let coldStartExcluded = 0;
  for (const s of samples) {
    const { prob: probV6, coldStart } = predictV6Simulated(s);
    if (coldStart) {
      coldStartExcluded++;
      continue;
    }
    const brierV5 = brier(s.probV5, s.game.home_win);
    const brierV6 = brier(probV6, s.game.home_win);
    pairedDiffs.push({
      diff: brierV6 - brierV5, // negative if v6 is better
      block: `${s.game.home_team_id}|${s.week}`,
    });
  }

  // 2. Block bootstrap: group diffs by (home_team, week); resample blocks
  //    with replacement; aggregate mean paired diff; SE is std across
  //    bootstrap means.
  const blocks = new Map<string, number[]>();
  for (const pd of pairedDiffs) {
    if (!blocks.has(pd.block)) blocks.set(pd.block, []);
    blocks.get(pd.block)!.push(pd.diff);
  }
  const blockKeys = [...blocks.keys()];
  const totalGames = pairedDiffs.length;

  const bootstrapMeans: number[] = [];
  for (let i = 0; i < BOOTSTRAP_B; i++) {
    let sum = 0;
    let n = 0;
    while (n < totalGames) {
      const k = blockKeys[Math.floor(Math.random() * blockKeys.length)];
      const blk = blocks.get(k)!;
      for (const d of blk) {
        sum += d;
        n++;
        if (n >= totalGames) break;
      }
    }
    bootstrapMeans.push(sum / n);
  }

  return {
    pairedDiffMean: mean(bootstrapMeans),
    pairedDiffSE: std(bootstrapMeans),
    blockCount: blockKeys.length,
    pairCount: totalGames,
    coldStartExcluded,
  };
}

// ---------- Main ----------

function main(): void {
  const startedAt = new Date().toISOString();
  console.log(`# Phase 1 pre-flight diagnostic — NBA learned-model pilot`);
  console.log(`# Started: ${startedAt}`);
  console.log(`# Validation fold: ${NBA_2024_25_START} (inclusive) .. ${NBA_2024_25_END} (exclusive)`);
  console.log();

  const samples = loadSamples();
  if (samples.length === 0) {
    console.error('No samples in 2024-25 validation fold. DB missing data?');
    closeDb();
    process.exit(1);
  }

  // 1. v5 Brier
  const { brier: v5Brier, n, lowConf } = v5BrierValFold(samples);
  console.log(`## 1. v5 NBA Brier on 2024-25 validation fold`);
  console.log(`   N games: ${n}`);
  console.log(`   Low-confidence games (either team < ${COLD_START_MIN_GAMES} season games): ${lowConf}`);
  console.log(`   v5 Brier: ${v5Brier.toFixed(4)}`);
  console.log();

  // 2. Correlations
  const corr = correlationsVsMargin(samples);
  console.log(`## 2. Pearson correlations vs per-game margin`);
  console.log(`   season_diff (home_season - away_season) vs margin:`);
  console.log(`     N = ${corr.season.n}, r = ${corr.season.r.toFixed(4)}`);
  console.log(`   rolling-N diff (home_rolling - away_rolling) vs margin:`);
  let bestRolling = { N: 0, r: -Infinity };
  for (const rw of corr.rolling) {
    console.log(`     N=${rw.N.toString().padStart(2)}, samples=${rw.n}, r = ${rw.r.toFixed(4)}`);
    if (rw.r > bestRolling.r) bestRolling = { N: rw.N, r: rw.r };
  }
  const delta = bestRolling.r - corr.season.r;
  const premisePass = delta >= 0.02;
  console.log(`   Best rolling-N: N=${bestRolling.N}, r=${bestRolling.r.toFixed(4)}`);
  console.log(`   Δ(best_rolling − season) = ${delta >= 0 ? '+' : ''}${delta.toFixed(4)}`);
  console.log(`   Premise threshold: Δ ≥ 0.02  →  ${premisePass ? 'PASS' : 'FAIL (re-council)'}`);
  console.log();

  // 3. Power-check paired-diff SE (Proposal A, addendum v2 methodology)
  const power = pairedDiffBlockBootstrapSE(samples);
  const powerPass = power.pairedDiffSE <= 0.0033;
  console.log(`## 3. Paired-diff block-bootstrap SE (power check, addendum v2 methodology)`);
  console.log(`   Method: empirical v5-vs-(v5 with rolling-20-feature-swap), per council A-vote.`);
  console.log(`   Bootstrap: B=${BOOTSTRAP_B}, blocks=(home_team, ISO-week), block count=${power.blockCount}`);
  console.log(`   Paired games: ${power.pairCount}, cold-start excluded: ${power.coldStartExcluded}`);
  console.log(`   Paired-diff SE:   ${power.pairedDiffSE.toFixed(5)}`);
  console.log(`   Power threshold: SE ≤ 0.0033  →  ${powerPass ? 'PASS' : 'FAIL (re-council)'}`);
  console.log();
  console.log(`   ⚠ INFORMATIONAL-ONLY (not a ship signal):`);
  console.log(`   Paired-diff mean (v6_sim − v5): ${power.pairedDiffMean.toFixed(5)}`);
  console.log(`   (negative = v6_sim better on val fold; ship decision lives on test fold only)`);
  console.log();

  // 4. Summary
  console.log(`## Summary`);
  console.log(`   v5 Brier (anchor): ${v5Brier.toFixed(4)}`);
  console.log(`   Premise: ${premisePass ? 'PASS' : 'FAIL'} (Δ=${delta.toFixed(4)})`);
  console.log(`   Power:   ${powerPass ? 'PASS' : 'FAIL'} (SE=${power.pairedDiffSE.toFixed(5)})`);
  const overall = premisePass && powerPass
    ? 'CLEAR — commit numbers, proceed to Phase 1'
    : premisePass
      ? 'PARTIAL — premise OK, power fail, re-council'
      : powerPass
        ? 'PARTIAL — power OK, premise fail, skip Phase 1 per plan, proceed to Phase 2'
        : 'BLOCKED — both fail, re-council';
  console.log(`   Overall: ${overall}`);

  closeDb();
}

main();
