import type { CorroborationResult, Provenance } from './provenance.js';

export interface Prediction {
  id: string;
  createdAt: string; // ISO 8601
  type: PredictionType;
  subject: string; // e.g., "nfl:2025-W12-KC@BUF"
  claim: string; // human-readable: "Chiefs win by 4+"
  confidence: number; // 0-1
  confidenceInterval?: { low: number; high: number };
  methodology: string;
  features: string[]; // which factors fed the prediction
  corroboration: CorroborationResult;
  ratchetIterationId?: string;
  outcome?: PredictionOutcome;
}

export type PredictionType =
  | 'game_winner'
  | 'spread'
  | 'over_under'
  | 'player_stat'
  | 'trend';

export interface PredictionOutcome {
  resolvedAt: string;
  actual: string;
  correct: boolean;
  error?: number; // numerical distance from prediction
  brierScore?: number;
}

export interface RatchetIteration {
  id: string;
  hypothesisId: string;
  iterationNumber: number;
  timestamp: string;
  hypothesis: string;
  modification: string;
  metricBefore: number;
  metricAfter: number;
  metricType: ImprovementMetric;
  kept: boolean;
  revertReason?: string;
}

export type ImprovementMetric =
  | 'brier_score' // game outcomes (lower = better)
  | 'mae' // point spread (lower = better)
  | 'rmse' // player stats (lower = better)
  | 'pearson_r'; // trend detection (higher = better)

export interface Hypothesis {
  id: string;
  createdAt: string;
  statement: string; // "NFL home teams with <3 days rest lose at higher rate"
  domain: string; // sport or cross-sport
  status: 'active' | 'validated' | 'rejected' | 'paused';
  iterations: RatchetIteration[];
  bestMetric: number;
  bestIteration?: string;
  provenance: Provenance;
}
