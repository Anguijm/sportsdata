/**
 * Karpathy-inspired ratchet loop for sports predictions.
 * Hypothesize → Modify → Execute → Evaluate → Keep or Revert
 *
 * The ratchet ensures monotonic improvement: each iteration either
 * improves the metric or reverts, so we never get worse.
 */

import type { Hypothesis, RatchetIteration, ImprovementMetric } from '../schema/prediction.js';
import { appendLog } from '../storage/json-log.js';

export interface RatchetConfig {
  maxIterations: number;
  devMode: boolean; // log gates but don't block
  metrics: Record<string, ImprovementMetric>;
}

export interface RatchetState {
  hypothesis: Hypothesis;
  currentBest: {
    parameters: Record<string, unknown>;
    metric: number;
    iterationId: string;
  };
  iterations: RatchetIteration[];
}

/**
 * Determines if a metric value is "better" based on metric type.
 * Lower is better for: brier_score, mae, rmse
 * Higher is better for: pearson_r
 */
export function isBetter(metricType: ImprovementMetric, newValue: number, oldValue: number): boolean {
  switch (metricType) {
    case 'brier_score':
    case 'mae':
    case 'rmse':
      return newValue < oldValue;
    case 'pearson_r':
      return newValue > oldValue;
  }
}

export function createRatchetState(hypothesis: Hypothesis, initialMetric: number): RatchetState {
  return {
    hypothesis,
    currentBest: {
      parameters: {},
      metric: initialMetric,
      iterationId: 'baseline',
    },
    iterations: [],
  };
}

/**
 * Execute one ratchet iteration.
 * Returns updated state — kept or reverted.
 */
export function evaluateIteration(
  state: RatchetState,
  iteration: Omit<RatchetIteration, 'kept' | 'revertReason'>,
  metricType: ImprovementMetric
): RatchetState {
  const improved = isBetter(metricType, iteration.metricAfter, state.currentBest.metric);

  const fullIteration: RatchetIteration = {
    ...iteration,
    kept: improved,
    revertReason: improved ? undefined : `No improvement: ${iteration.metricAfter} vs best ${state.currentBest.metric}`,
  };

  // Log the iteration
  appendLog('analysis', {
    timestamp: new Date().toISOString(),
    hypothesisId: state.hypothesis.id,
    iterations: state.iterations.length + 1,
    bestMetric: improved ? iteration.metricAfter : state.currentBest.metric,
    metricType,
    improvement: improved ? Math.abs(iteration.metricAfter - state.currentBest.metric) : 0,
    gate: improved ? 'CLEAR' : 'WARN',
    gateReason: improved ? undefined : fullIteration.revertReason,
  });

  if (improved) {
    return {
      ...state,
      currentBest: {
        parameters: {}, // caller would populate with actual params
        metric: iteration.metricAfter,
        iterationId: iteration.id,
      },
      iterations: [...state.iterations, fullIteration],
    };
  }

  // Revert — state unchanged except iteration is logged
  return {
    ...state,
    iterations: [...state.iterations, fullIteration],
  };
}

export function shouldContinue(state: RatchetState, config: RatchetConfig): boolean {
  return state.iterations.length < config.maxIterations;
}

export function getRatchetSummary(state: RatchetState): {
  totalIterations: number;
  keptIterations: number;
  revertedIterations: number;
  bestMetric: number;
  improvementFromBaseline: number;
} {
  const kept = state.iterations.filter((i) => i.kept);
  const baseline = state.iterations[0]?.metricBefore ?? state.currentBest.metric;

  return {
    totalIterations: state.iterations.length,
    keptIterations: kept.length,
    revertedIterations: state.iterations.length - kept.length,
    bestMetric: state.currentBest.metric,
    improvementFromBaseline: Math.abs(state.currentBest.metric - baseline),
  };
}
