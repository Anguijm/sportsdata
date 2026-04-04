# Review Skill

Council review and evaluation for analyses and predictions.

## Prerequisites
- Analysis completed and logged
- Results ready for review

## When to Invoke Council

| Situation | Review Level |
|-----------|-------------|
| Routine scrape results | Automated gate only (no council) |
| New analysis methodology | Full council review |
| Prediction before publishing | Full council review |
| Scraper modification | Human-gated (harness.yml: semi_autonomous) |
| Ratchet structural changes | Full council + human approval |

## Council Review Process

### 1. Prepare Review Package
Assemble for council:
- Hypothesis statement and rationale
- Methodology description
- Data sources and sample sizes
- Results with confidence intervals
- Ratchet iteration history (if applicable)

### 2. Council Invocation
Send to each council expert (role-tagged, single council):
- **Data Quality**: Review data freshness, completeness, source reliability
- **Statistical Validity**: Review methodology, sample size, confounders
- **Prediction Accuracy**: Review calibration, backtesting, base rate comparison
- **Domain Expert**: Review context, situational factors, narrative vs data

### 3. Resolver Synthesis
Resolver reads all expert reviews and produces:
- Overall verdict: FAIL / WARN / CLEAR
- Convergence points
- Conflict resolutions
- Action plan

### 4. Act on Verdict
- **CLEAR**: Proceed to publish/ship
- **WARN**: Address specific concerns, re-review flagged items
- **FAIL**: Do not proceed. Log failure. Return to analysis with council feedback.

### 5. Log Review
Append to learnings.md:
```markdown
### [hypothesis-id] Council Review (YYYY-MM-DD)
- **Verdict**: [FAIL/WARN/CLEAR]
- **KEEP**: [what the analysis got right]
- **IMPROVE**: [council feedback to address]
- **INSIGHT**: [generalizable learning]
```

## Dev Mode Behavior
When `harness.yml: ratchet.dev_mode: true`:
- Gates log what they WOULD block but do not actually block
- Council reviews are optional (but recommended)
- All gate decisions still logged for post-hoc analysis
