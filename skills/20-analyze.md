# Analyze Skill

Analysis and prediction pipeline using the ratchet loop.

## Prerequisites
- Data available in SQLite operational store
- Hypothesis defined (or generate new one)

## Pipeline

### 1. Idea Gate
Before starting any analysis:
- Is this hypothesis novel? (Check `data/logs/analysis-log.jsonl` for duplicates)
- Is data available? (Check SQLite for required records)
- Is it feasible with current data volume?

If FAIL: log reason, suggest alternative hypothesis.

### 2. Plan Gate
Before implementation:
- What statistical method will be used?
- Is the sample size sufficient? (Check harness.yml thresholds)
- Are confounding variables identified?
- What is the improvement metric? (From harness.yml ratchet config)

If FAIL: log methodology concerns, request revision.

### 3. Ratchet Loop Execution
```
For each iteration (max from harness.yml):
  1. HYPOTHESIZE: State the specific claim
  2. MODIFY: Adjust model/parameters/features
  3. EXECUTE: Run against data (historical backtest)
  4. EVALUATE: Compute improvement metric
  5. COMPARE: Better than previous best?
     - YES → KEEP (update best, log iteration)
     - NO → REVERT (restore previous state, log revert reason)
```

### 4. Build Gate
After ratchet loop completes:
- Did the model improve over baseline?
- Is the improvement statistically significant?
- Does it beat the naive base rate?

If FAIL: log results, mark hypothesis as rejected.

### 5. Log Results
Every analysis run logged to `data/logs/analysis-log.jsonl`:
```json
{"timestamp": "ISO", "hypothesisId": "H-001", "iterations": 12, "bestMetric": 0.23, "metricType": "brier_score", "improvement": 0.04, "gate": "CLEAR"}
```

### 6. Prediction Gate (if publishing)
Before any prediction is surfaced:
- Confidence above threshold (from harness.yml)
- Source corroboration met (2 default, 3 for high-stakes)
- Backtesting evidence present

If FAIL: do not publish. Log as "pending corroboration."

## Ratchet State Management
- Each hypothesis has its own state file in `data/ratchet/`
- State includes: current best parameters, metric history, iteration log
- Revert restores from the last "kept" snapshot
