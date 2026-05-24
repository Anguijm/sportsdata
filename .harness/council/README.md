# Council Protocol

Authoritative reference for all council review mechanics in this repo.
For durable session context see also `CLAUDE.md` §"Council discipline".

---

## Expert roster

| Handle | File | Role |
|---|---|---|
| DQ | `data-quality.md` | Data quality — schema, provenance, null coverage, sentinel rows |
| Stats | `statistical-validity.md` | Statistical validity — methodology, sample sizes, significance |
| Pred | `prediction-accuracy.md` | Prediction accuracy — model behaviour, calibration, leakage |
| Domain | `domain-expert.md` | Basketball domain — convention correctness, sport-specific edge cases |
| Math | `mathematics.md` | Numerical correctness — calculation review; **abstains on non-calculation reviews** |
| Lead Architect | `lead-architect.md` | Synthesis and verdict — reads all expert reviews, resolves conflicts, issues final verdict. **Not a voter**; run by Gemini via `.github/workflows/council.yml` on every PR. |

---

## Review gates

Every substantive change runs through three gates in order:

1. **Plan review** — before any code is written. Iterate until CLEAR (or WARN with mitigations pre-declared).
2. **Implementation review** — after code is built, before deploy. Council reviews actual code, outputs, data. Iterate if FAIL.
3. **Test / results review** — after deploy, council reviews live findings quality.

Skipping any gate is a CRITICAL process failure. The user must never be the first reviewer.

---

## R1 → R2 reversal rules

### pm.5 — Dissenter-named falsification test (blocking)

**When it applies:** a council R1 surfaces a load-bearing convention disagreement and R2 entertains a reversal driven by an empirical claim.

**Rule:** the falsification test named by the dissenting expert in R1 becomes blocking on R2 reversal. The proponent must run that test before the reversal can stand.

**How to apply:** when drafting an R2 fix-pack that addresses an R1 FAIL via empirical evidence, scan the dissenter's R1 verdict for phrases like "I'd want to verify on X," "spot-check Y," "what about Z," "verify on a different sample." Treat them as blocking. Run the test; if it confirms the reversal, fold the result into the fix-pack. If it falsifies, revert to the most-conservative reversible default and re-engage R2 council.

**Canonical example:** addendum v10 (Sprint 10.13) accepted a single-game algebraic closure (LAL/IND Cup-final bbref tov=18 = ESPN.turnovers) as dispositive for R2, overriding the Domain expert's R1 FAIL. The Domain expert's "I'd still like a one-time spot-check on a pre-2024 game" was not treated as blocking. That un-run check would have detected the Cup-vs-regular-season convention asymmetry; not running it caused a 7,604-row bad backfill + ~3 hours of rollback (Sprint 10.14 post-mortem).

---

### pm.6 — Multi-row-write empirical-verification standard (blocking)

**When it applies:** any plan that pivots on empirical evidence to support an R2 reversal.

**Rule:** all four conditions are blocking; any one failing blocks R2 reversal:

- **(a) ≥2 data points per stratum** present in the population (e.g., for NBA TOV convention: regular-season / postseason / Cup-pool / Cup-knockout / Play-In = 5 strata → ≥10 data points minimum)
- **(b) ≥5 total data points** across the population (binds when fewer strata are relevant)
- **(c) adversarial selection**: at least one data point per stratum chosen by the dissenting expert, not the proponent (prevents confirmation-bias selection)
- **(d) dissenter's named falsification test** (per pm.5 above)

**Why (a/b/c):** the v10 single-game check was proponent-selected confirming evidence. ≥3 stratified data points with adversarial selection is the antidote to confirmation bias.

**How to apply:** when drafting an R2 fix-pack that pivots on empirical evidence, enumerate before submitting: (a) strata in the population, (b) data points per stratum with provenance, (c) which were proponent-picked vs dissenter-picked, (d) the named falsification test result.

---

### pm.7 — Plan-review data-prereq audit (blocking)

**When it applies:** any plan whose body names specific training, validation, or test data slices (e.g. seasons, date ranges, leagues, segments).

**Rule:** the plan-review cannot return CLEAR until the proponent has explicitly verified, at plan-review time, that the corresponding rows exist in the storage layer at the granularity the plan requires (eligibility view + any joined fact tables). "We'll check later" is not a mitigation. The verification step must be cited inline in the plan.

**Why:** Phase 7 addendum v18 was council-CLEAR with `PHASE7_TRAINING_SEASONS = ('2021-regular','2022-regular')`. All 5 experts + lead architect approved the plan. The plan included a test-fold completeness pre-flight but no parallel training-fold one. When the Step 3 harness ran (2026-05-24), it exited with `RuntimeError: No games matched PHASE7_TRAINING_SEASONS=('2021-regular','2022-regular')` — `nba_game_box_stats` had zero rows for 2021/2022 (Phase 2 backfill was scoped post-2022 per debt #33 ship rule), and the `nba_eligible_games` view whitelist excluded those seasons. A 5-expert panel and the lead architect missed the prereq. Surfaced in addendum v19 and codified here.

**How to apply:** when reading a plan that names a data slice, before voting CLEAR:

1. Run the eligibility query the plan would run (or its closest analogue) against `data/sqlite/sportsdata.db` and confirm row counts at the granularity the plan needs.
2. If a coverage view exists (e.g. `box_stats_coverage` for NBA Phase 2), check the per-cell numbers for the slice in question.
3. If the slice spans tables the plan joins on (e.g. NBA needs `games` + `nba_game_box_stats` + `nba_espn_event_ids`), confirm row counts on each.
4. If any slice has zero rows or coverage below the plan's stated threshold, the plan must declare a pre-flight gate (with executable steps + a coverage threshold + a halt protocol) before any code that consumes the slice is written. Verdict before such a gate exists: WARN at minimum; FAIL if the plan is silent on the gap.

**Canonical example:** addendum v19 (Sprint 10.24) — `nba_game_box_stats` had 0 rows for 2021/2022 + `nba_eligible_games` view whitelist excluded those seasons. Codified rule + Path A backfill remediation: `Plans/nba-learned-model.md` addendum v19.

---

### pm.8 — Pipeline impl-review requires end-to-end smoke (blocking)

**When it applies:** any PR whose diff modifies a feature-engineering or training pipeline (i.e., code that reads from a data source, computes derived values, and produces a tensor or other consumable artifact).

**Rule:** impl-review cannot return CLEAR until the proponent has demonstrated, with an in-PR smoke run, that the pipeline produces non-degenerate output on a representative input slice. Specifically:

1. **Non-empty output:** the tensor/artifact has rows. `X.shape[0] > 0`.
2. **Non-degenerate variance:** for each feature group the plan declares (e.g. season-agg vs. EWMA-delta vs. game-level), at least one column has columnwise variance > 0.
3. **Non-degenerate labels:** if the pipeline produces labels, both classes are present (for classification) or labels have non-zero variance (for regression).
4. **Cross-parameter inequality:** if the pipeline produces parallel feature groups parameterized by a hyperparameter (e.g. EWMA halflives), at least one canary column must differ row-by-row across the parameter values. Otherwise the inner-CV winner selection is meaningless.

The smoke run must be inside the PR (a committed test script + verified PASS in the PR description, OR a CI workflow step). "Tests pass on synthetic data" is NOT sufficient — synthetic data hides interaction bugs with the production schema, the time-machine filter, and the eligibility view.

If a smoke run is genuinely impossible (the training data doesn't yet exist), the plan-review for the consuming step MUST declare this prereq inline AND the impl-review must defer CLEAR until the data arrives. Council reviewers verify the prereq is named before voting CLEAR on the consuming-step plan.

**Why:** Phase 7 Step 2 (PR #71) shipped a feature pipeline with two latent bugs (Phase 7 addendum v21: `updated_at` time-machine filter excluded backfilled rows; `TEST_FOLD_SEASONS` was stale Phase 3 era). Both bugs CLEAR'd impl-review on code-shape + isolated-unit-test grounds, because no end-to-end run against real backfilled data was possible at the time. The bugs only manifested when Path A (v19+v20) populated the training data and PR-3 ran the harness: Brier was identical to 14 decimal places across all 3 halflives, because the prior history was empty for every 2021/2022 game. Codified rule + remediation: `Plans/nba-learned-model.md` addendum v21.

**How to apply:** when reading a pipeline PR, before voting CLEAR:

1. Locate the smoke test script (or CI workflow step) in the diff. If absent, vote WARN minimum.
2. Confirm the smoke test exercises the production data path (real DB, real eligibility view, real downstream consumer) — not a mocked tensor.
3. Confirm the smoke test asserts at least the four non-degeneracy properties above.
4. If the consuming-step's training data doesn't yet exist, confirm the plan declared the prereq AND the impl-review explicitly defers CLEAR pending that data — do NOT issue CLEAR on the basis of "code looks right, can't test yet."

**Canonical example:** PR #76 / addendum v21 (Sprint 10.25) — features.py shipped at PR #71 with `updated_at`-based time-machine filter that broke on backfilled data. Smoke test `ml/nba/test_phase7_feature_variance.py` introduced post-hoc; council impl-review CLEAR'd it 10/10 once the bug was fixed AND the smoke test was added.

---

## Lead Architect hard rules

The Lead Architect applies these non-negotiable verdicts regardless of other expert scores:

| Condition | Resolver verdict |
|---|---|
| Any DQ FAIL | FAIL (garbage in, garbage out) |
| Any Stats FAIL | FAIL (wrong conclusions harm trust) |
| Pred FAIL + Domain CLEAR | WARN (model needs work, concept sound) |
| Domain FAIL + all others CLEAR | WARN (redo with context) |

---

## Iteration cap

If experts fundamentally disagree after Resolver synthesis across **2 rounds**, escalate to human review. Do not loop indefinitely.

---

## Cross-references

- `Plans/nba-learned-model.md` addendum v10 + post-mortem — source incident for pm.5 + pm.6
- `Plans/nba-learned-model.md` addendum v11 — first end-to-end use of pm.5 in the same R1→R2 cycle
- `learnings.md` Sprint 10.14 — narrative summary "v10-tov-convention-rollback"
- `memory/feedback_council_pm5_pm6_rules.md` — cross-session rule record
