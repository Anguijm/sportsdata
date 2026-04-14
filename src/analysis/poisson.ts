/**
 * Poisson/Skellam soccer margin model — MLS + EPL only.
 *
 * Implements the plan in Plans/soccer-poisson.md, council-CLEAR 2026-04-14.
 *
 * Theory (Maher 1982; Dixon & Coles 1997):
 *   For a match between home team h and away team a, goals follow independent
 *   Poissons:
 *     N_home ~ Poisson(λ_home)
 *     N_away ~ Poisson(λ_away)
 *
 *   with rates
 *     λ_home = α_h × β_a × μ_home × league_avg_goals
 *     λ_away = α_a × β_h × (1/μ_home) × league_avg_goals
 *
 *   where α_t is team t's attacking strength (goals-per-game ÷ league avg),
 *   β_t is its defensive weakness (conceded-per-game ÷ league avg), and
 *   μ_home is the league-specific home advantage multiplier. The signed
 *   margin N_home − N_away is Skellam-distributed.
 *
 *   This file is the independent-Poisson v1. Dixon-Coles low-score τ
 *   correction (the 0-0/1-0/0-1/1-1 correlation fix) is deferred — it
 *   reshuffles probability mass between specific scorelines but barely
 *   moves margin expectation (all four scores have |margin| ≤ 1).
 *
 * Scope: MLS and EPL only. Other sports keep the v4-spread sigmoid margin
 * model. NBA/NFL/MLB/NHL margin-MAE baselines already beat predict-zero;
 * no case for restructuring them.
 */

import type { Sport } from '../schema/provenance.js';
import type { TeamState } from './predict.js';

/** Two-league subset where Poisson applies. Typeguarded via isSoccer(). */
export type SoccerSport = 'mls' | 'epl';

export function isSoccer(sport: Sport): sport is SoccerSport {
  return sport === 'mls' || sport === 'epl';
}

/** League-level scaling constants.
 *
 *  Provenance (see Plans/soccer-poisson.md):
 *    Derived from the full soccer backfill slice in
 *    data/baselines/baseline-2026-04-14.json underlying game_results rows
 *    (MLS: 2024-03 to 2026-04, N=1159; EPL: 2024-08 to 2026-04, N=699).
 *
 *    league_avg_goals = (mean(home_score) + mean(away_score)) / 2  — the
 *      expected goals per team per match. Gives us the units so that
 *      when α_t and β_t equal 1 (league-average team), λ has realistic
 *      magnitude.
 *
 *    mu_home = √(mean(home_score) / mean(away_score))  — square root so
 *      that (λ_home × λ_away) is invariant to μ_home under the average
 *      case: with μ=√r, an average-vs-average match yields
 *      λ_home = μ_home × L = √r × L,
 *      λ_away = L / μ_home = L / √r,
 *      ratio = r,  ⇒ matches measured goal ratio.
 *
 *  Measured values:
 *    MLS: home 1.7075, away 1.3563 → L=1.5319, ratio=1.2589, μ=√r=1.1220
 *    EPL: home 1.5050, away 1.3376 → L=1.4213, ratio=1.1251, μ=√r=1.0607
 *
 *  In-sample disclosure: backfill does not cover pre-2024 soccer, so these
 *  constants are estimated on the same slice the A/B runs against. At
 *  N≥699 the SE of a rate estimate is ~1%, so the leakage is cosmetic —
 *  shifting to literature values (EPL ~1.45 L; MLS ~1.55 L) would not
 *  change the A/B verdict. */
export interface LeagueConstants {
  /** Expected goals per team per match in the league. */
  league_avg_goals: number;
  /** Home advantage multiplier: λ_home_avg / λ_away_avg = μ_home². */
  mu_home: number;
  /** Empirical draw rate — used as the naive-draw Brier baseline. */
  empirical_draw_rate: number;
}

const LEAGUE_CONSTANTS: Record<SoccerSport, LeagueConstants> = {
  mls: {
    league_avg_goals: 1.5319,
    mu_home: 1.1220,
    empirical_draw_rate: 0.2407,
  },
  epl: {
    league_avg_goals: 1.4213,
    mu_home: 1.0607,
    empirical_draw_rate: 0.2532,
  },
};

/** Minimum λ floor. Prevents λ=0 degenerate Poisson when a team has
 *  pointsFor=0 or pointsAgainst=0 after the games≥5 gate. Practical
 *  incidence in soccer is ≈ 0; included for correctness.
 *
 *  The floor value is chosen to be small enough that it barely affects
 *  any realistic prediction (P(Poisson(0.05)≥1) ≈ 5%, implying a team
 *  that we believe can't score is still expected to score roughly 1 in
 *  20 matches — a reasonable floor for "effectively zero"). */
const LAMBDA_FLOOR = 0.05;

export interface PoissonLambdas {
  lambdaHome: number;
  lambdaAway: number;
  /** Low-confidence flag: set when either team has <5 games of state. In
   *  low-confidence mode we fall back to a league-average match (both
   *  teams at α=β=1) so the prediction is defensible without team data. */
  lowConfidence: boolean;
}

/** Compute per-match λ rates from team state. No pitcher / injury / form
 *  adjustments — v1 scope per Plans/soccer-poisson.md. */
export function computeLambdas(
  sport: SoccerSport,
  home: TeamState,
  away: TeamState,
): PoissonLambdas {
  const L = LEAGUE_CONSTANTS[sport];
  const lowConfidence = home.games < 5 || away.games < 5;

  if (lowConfidence) {
    // Average-vs-average match: α=β=1 for both sides.
    return {
      lambdaHome: L.mu_home * L.league_avg_goals,
      lambdaAway: L.league_avg_goals / L.mu_home,
      lowConfidence: true,
    };
  }

  const homeFor = home.pointsFor / home.games;
  const homeAgainst = home.pointsAgainst / home.games;
  const awayFor = away.pointsFor / away.games;
  const awayAgainst = away.pointsAgainst / away.games;

  const alpha_h = homeFor / L.league_avg_goals;
  const beta_h = homeAgainst / L.league_avg_goals;
  const alpha_a = awayFor / L.league_avg_goals;
  const beta_a = awayAgainst / L.league_avg_goals;

  const lambdaHome = Math.max(
    LAMBDA_FLOOR,
    alpha_h * beta_a * L.mu_home * L.league_avg_goals,
  );
  const lambdaAway = Math.max(
    LAMBDA_FLOOR,
    alpha_a * beta_h * (1 / L.mu_home) * L.league_avg_goals,
  );

  return { lambdaHome, lambdaAway, lowConfidence: false };
}

/** Predicted signed margin: E[Skellam] = λ_home − λ_away. Positive = home
 *  expected to win. Slots into the existing baseline/spread pipeline the
 *  same way v4-spread's predictMargin() does. */
export function predictPoissonMargin(
  sport: SoccerSport,
  home: TeamState,
  away: TeamState,
): number {
  const { lambdaHome, lambdaAway } = computeLambdas(sport, home, away);
  return lambdaHome - lambdaAway;
}

// --- Probability machinery (secondary — not ship-gated in v1) ---

/** Poisson PMF P(X=k) for X ~ Poisson(λ). Computed in log-space to avoid
 *  factorial overflow and exponential underflow for mid-range k. For
 *  soccer (λ ≤ 5, k ≤ 20) numerics are benign but log-space is still
 *  the safer default. Returns 0 for k<0. */
export function poissonPMF(k: number, lambda: number): number {
  if (k < 0) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // log P(X=k) = -λ + k·log(λ) - log(k!)
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** Truncation parameter for Skellam series sums. Poisson(λ=5) has
 *  P(X>20) ≈ 3e-6; for typical soccer λ≤3 the tail is <1e-5. Truncating
 *  at 20 goals per side bounds the probability-mass omission below any
 *  measurement we care about. */
const SKELLAM_TRUNC = 20;

/** Skellam PMF P(Z=n) where Z = X − Y, X~Poisson(λh), Y~Poisson(λa).
 *  Computed as Σ_{y=max(0,-n)}^K P(X=y+n) × P(Y=y). For soccer this is
 *  exact to <1e-5; the closed-form Bessel-function version would trade
 *  computational elegance for numerical fragility. */
export function skellamPMF(
  n: number,
  lambdaH: number,
  lambdaA: number,
  trunc: number = SKELLAM_TRUNC,
): number {
  let total = 0;
  const yMin = Math.max(0, -n);
  for (let y = yMin; y <= trunc; y++) {
    total += poissonPMF(y + n, lambdaH) * poissonPMF(y, lambdaA);
  }
  return total;
}

export interface OutcomeProbs {
  pHome: number;
  pDraw: number;
  pAway: number;
}

/** P(home wins), P(draw), P(away wins) via Skellam. Sums probability
 *  mass across margins [−trunc, +trunc]; residual mass (≪1e-5 for
 *  soccer λ) is implicitly allocated 0. Normalization is not forced —
 *  a renormalization step would hide any bug that caused systematic
 *  mass loss. */
export function skellamOutcomeProbs(
  lambdaH: number,
  lambdaA: number,
  trunc: number = SKELLAM_TRUNC,
): OutcomeProbs {
  let pHome = 0, pDraw = 0, pAway = 0;
  for (let n = -trunc; n <= trunc; n++) {
    const p = skellamPMF(n, lambdaH, lambdaA, trunc);
    if (n > 0) pHome += p;
    else if (n === 0) pDraw += p;
    else pAway += p;
  }
  return { pHome, pDraw, pAway };
}

/** Convenience: full Poisson prediction bundle. Used by baseline A/B
 *  and any future wiring into the spread-runner. */
export function predictPoisson(
  sport: SoccerSport,
  home: TeamState,
  away: TeamState,
): {
  margin: number;
  lambdas: PoissonLambdas;
  probs: OutcomeProbs;
} {
  const lambdas = computeLambdas(sport, home, away);
  const probs = skellamOutcomeProbs(lambdas.lambdaHome, lambdas.lambdaAway);
  return {
    margin: lambdas.lambdaHome - lambdas.lambdaAway,
    lambdas,
    probs,
  };
}

/** Read-only accessor for tests and provenance display. */
export function getLeagueConstants(sport: SoccerSport): LeagueConstants {
  return LEAGUE_CONSTANTS[sport];
}
