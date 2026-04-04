/**
 * Thin state machine for pipeline orchestration.
 * Not a framework — a simple JSON config driving pipeline state.
 */

export type PipelinePhase =
  | 'idle'
  | 'scraping'
  | 'normalizing'
  | 'analyzing'
  | 'predicting'
  | 'reviewing'
  | 'publishing'
  | 'error';

export interface PipelineState {
  phase: PipelinePhase;
  startedAt: string;
  updatedAt: string;
  currentSource?: string;
  currentSport?: string;
  currentHypothesis?: string;
  error?: string;
  gateResults: GateResult[];
}

export interface GateResult {
  gate: string;
  timestamp: string;
  verdict: 'CLEAR' | 'WARN' | 'FAIL';
  reason: string;
  blocked: boolean; // false in dev mode even on FAIL
}

export type PipelineTransition = {
  from: PipelinePhase;
  to: PipelinePhase;
  requiredGate?: string;
};

/** Valid state transitions */
const TRANSITIONS: PipelineTransition[] = [
  { from: 'idle', to: 'scraping' },
  { from: 'scraping', to: 'normalizing', requiredGate: 'data_quality' },
  { from: 'normalizing', to: 'analyzing' },
  { from: 'analyzing', to: 'predicting', requiredGate: 'build' },
  { from: 'predicting', to: 'reviewing', requiredGate: 'prediction' },
  { from: 'reviewing', to: 'publishing' },
  { from: 'publishing', to: 'idle' },
  // Error recovery
  { from: 'error', to: 'idle' },
  { from: 'scraping', to: 'error' },
  { from: 'normalizing', to: 'error' },
  { from: 'analyzing', to: 'error' },
  { from: 'predicting', to: 'error' },
];

export function canTransition(from: PipelinePhase, to: PipelinePhase): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.to === to);
}

export function getRequiredGate(from: PipelinePhase, to: PipelinePhase): string | undefined {
  const transition = TRANSITIONS.find((t) => t.from === from && t.to === to);
  return transition?.requiredGate;
}

export function createInitialState(): PipelineState {
  const now = new Date().toISOString();
  return {
    phase: 'idle',
    startedAt: now,
    updatedAt: now,
    gateResults: [],
  };
}

export function transition(
  state: PipelineState,
  to: PipelinePhase,
  gateResult?: GateResult
): PipelineState {
  if (!canTransition(state.phase, to)) {
    throw new Error(`Invalid transition: ${state.phase} → ${to}`);
  }

  const requiredGate = getRequiredGate(state.phase, to);
  if (requiredGate && !gateResult) {
    throw new Error(`Transition ${state.phase} → ${to} requires gate: ${requiredGate}`);
  }

  return {
    ...state,
    phase: to,
    updatedAt: new Date().toISOString(),
    gateResults: gateResult ? [...state.gateResults, gateResult] : state.gateResults,
  };
}
