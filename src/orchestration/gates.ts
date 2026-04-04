/**
 * Evaluation gates — checkpoints that validate quality before proceeding.
 * In dev mode, gates log but don't block.
 */

import type { GateResult } from './pipeline.js';

export type GateName = 'idea' | 'plan' | 'build' | 'prediction' | 'data_quality';

export interface GateConfig {
  devMode: boolean;
}

export interface PredictionThresholds {
  confidence: number;
  minConfidence: number;
  sourceCount: number;
  minSources: number;
  isHighStakes: boolean;
  highStakesMinSources: number;
}

/** Idea Gate: evaluates hypothesis feasibility before planning */
export function ideaGate(
  hypothesis: string,
  dataAvailable: boolean,
  existingHypotheses: string[],
  config: GateConfig
): GateResult {
  const isDuplicate = existingHypotheses.some(
    (h) => h.toLowerCase() === hypothesis.toLowerCase()
  );

  if (isDuplicate) {
    return gateResult('idea', 'FAIL', 'Duplicate hypothesis already exists', config);
  }

  if (!dataAvailable) {
    return gateResult('idea', 'FAIL', 'Required data not available', config);
  }

  return gateResult('idea', 'CLEAR', 'Hypothesis is novel and data is available', config);
}

/** Plan Gate: validates methodology before implementation */
export function planGate(
  sampleSize: number,
  minSampleSize: number,
  methodologyDescription: string,
  confoundersIdentified: boolean,
  config: GateConfig
): GateResult {
  if (sampleSize < minSampleSize) {
    return gateResult('plan', 'FAIL', `Sample size ${sampleSize} below minimum ${minSampleSize}`, config);
  }

  if (!confoundersIdentified) {
    return gateResult('plan', 'WARN', 'Confounding variables not identified', config);
  }

  if (!methodologyDescription) {
    return gateResult('plan', 'FAIL', 'No methodology description provided', config);
  }

  return gateResult('plan', 'CLEAR', 'Methodology and sample size adequate', config);
}

/** Build Gate: validates results after implementation */
export function buildGate(
  metricImprovement: number,
  beatsBaseRate: boolean,
  config: GateConfig
): GateResult {
  if (metricImprovement <= 0) {
    return gateResult('build', 'FAIL', 'No improvement over baseline', config);
  }

  if (!beatsBaseRate) {
    return gateResult('build', 'WARN', 'Improvement exists but does not beat naive base rate', config);
  }

  return gateResult('build', 'CLEAR', 'Results improve over baseline and beat base rate', config);
}

/** Prediction Gate: validates before publishing predictions */
export function predictionGate(
  thresholds: PredictionThresholds,
  config: GateConfig
): GateResult {
  const { confidence, minConfidence, sourceCount, minSources, isHighStakes, highStakesMinSources } = thresholds;
  const requiredSources = isHighStakes ? highStakesMinSources : minSources;

  if (confidence < minConfidence) {
    return gateResult('prediction', 'FAIL', `Confidence ${confidence} below threshold ${minConfidence}`, config);
  }

  if (sourceCount < requiredSources) {
    return gateResult(
      'prediction',
      'FAIL',
      `Only ${sourceCount} sources, need ${requiredSources}${isHighStakes ? ' (high-stakes)' : ''}`,
      config
    );
  }

  return gateResult('prediction', 'CLEAR', `Confidence ${confidence} with ${sourceCount} sources`, config);
}

/** Data Quality Gate: validates scraped data */
export function dataQualityGate(
  recordCount: number,
  missingFields: string[],
  stalenessHours: number,
  maxStalenessHours: number,
  config: GateConfig
): GateResult {
  if (recordCount === 0) {
    return gateResult('data_quality', 'FAIL', 'No records returned', config);
  }

  if (missingFields.length > 0) {
    return gateResult('data_quality', 'WARN', `Missing fields: ${missingFields.join(', ')}`, config);
  }

  if (stalenessHours > maxStalenessHours) {
    return gateResult('data_quality', 'FAIL', `Data is ${stalenessHours}h old, max ${maxStalenessHours}h`, config);
  }

  return gateResult('data_quality', 'CLEAR', `${recordCount} records, fresh data`, config);
}

function gateResult(
  gate: GateName,
  verdict: 'CLEAR' | 'WARN' | 'FAIL',
  reason: string,
  config: GateConfig
): GateResult {
  return {
    gate,
    timestamp: new Date().toISOString(),
    verdict,
    reason,
    blocked: verdict === 'FAIL' && !config.devMode,
  };
}
