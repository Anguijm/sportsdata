# Council Process

The 5-expert council reviews every substantive change — plan, implementation, and test results — before it ships. This file is the authoritative reference for the **R1→R2 reversal rules (pm.5 + pm.6)** codified in Sprint 10.14. The full review protocol is distributed across this file, `CLAUDE.md` §"Council discipline", and `memory/feedback_council_discipline.md`.

---

## Experts

| File | Role | Sits out |
|---|---|---|
| `data-quality.md` | Data completeness, freshness, schema conformance, cross-source consistency | — |
| `statistical-validity.md` | Sample size, multiple comparisons, confounders, overfitting | — |
| `prediction-accuracy.md` | Calibration, backtesting, base rate, honest uncertainty | — |
| `domain-expert.md` | Situational factors, schedule effects, narrative vs data, rule changes | — |
| `mathematics.md` | Formula correctness, probability bounds, theoretical soundness | Reviews with no calculations |
| `resolver.md` | **Synthesis role** — reads all expert reviews, resolves conflicts, produces final verdict + action plan. Does not cast an independent vote. | — |

---

## Review gates (required for every substantive change)

1. **Plan review** → iterate until CLEAR (or WARN with mitigations pre-declared and council-accepted).
2. **Implementation review** → iterate if FAIL.
3. **Test / results review** → iterate if FAIL.

User is never the first reviewer. Skipping any gate is a CRITICAL FAILURE per `memory/feedback_council_discipline.md`.

---

## R1→R2 reversal rules (pm.5 + pm.6, codified Sprint 10.14)

These two rules govern when an R2 reversal of an R1 expert verdict is permitted. Both are blocking — failing either blocks the reversal.

### pm.5 — Dissenter-named falsification test

> When a council R1 surfaces a load-bearing convention disagreement and R2 entertains a reversal driven by an empirical claim, the falsification test **named by the dissenting expert in R1** becomes blocking on R2 reversal. The proponent must run that test before the reversal can stand.

- The dissenter names the test in their R1 writeup; it cannot be substituted post-hoc.
- "Running the test" means committing results to a `docs/` artifact and citing it explicitly in the R2 submission.
- pm.5 is in addition to pm.6, not in lieu of it.

### pm.6 — Multi-row-write empirical-verification standard

> Any plan that pivots on a single empirical check requires **all four** of the following before R2 reversal stands:
>
> (a) **≥2 data points per stratum** the population contains  
> (b) **≥5 total data points** across the population  
> (c) **Adversarial selection** — at least one data point per stratum chosen by the dissenting expert, not the proponent  
> (d) **The dissenter's named falsification test (pm.5)** passes  

All four are independently blocking. Any one failing blocks R2 reversal.

**Canonical example.** Sprint 10.14 debt #35 post-mortem: Domain expert's R1 falsification test (v5-on-Cup-knockout vs v5-on-regular-season-same-month Brier comparison) was blocking on whether option (b) drop-from-training could be pinned. The plan could not pre-commit to drop without running the test. See `Plans/nba-learned-model.md` addendum v11 §"Feature engineering" and §"Council process codification."

---

## Resolver hard rules (non-negotiable)

From `resolver.md`:

- Any **data quality FAIL** = overall FAIL.
- Any **statistical validity FAIL** = overall FAIL.
- Prediction accuracy FAIL + domain expert CLEAR = WARN.
- Domain expert FAIL + everything else CLEAR = WARN.
- Disputes escalate to human review after 2 rounds.

---

## Iteration cap

Maximum 2 rounds (R1 + R2) before escalating to the user. If R2 cannot close all experts to CLEAR or WARN-with-accepted-mitigations, the user decides whether to proceed, widen the threshold, or declare a null result.
