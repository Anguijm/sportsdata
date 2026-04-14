# Soccer Poisson Margin Model — Council-Validated Plan

**Branch**: `claude/soccer-poisson-model`
**Scope**: MLS + EPL margin prediction only. NBA/NFL/MLB/NHL untouched.
**Status**: council-reviewed 2026-04-14, WARN→CLEAR after six corrections.

## Problem

Baseline analysis (PR #28, debt #13) showed MLS and EPL margin models from `v4-spread` cannot be distinguished from predict-zero at 95% CI:

- MLS: MAE − nv0 = −0.004 [−0.046, +0.035]
- EPL: MAE − nv0 = +0.03 [−0.039, +0.093]

Council math-expert verdict: binary sigmoid on a ternary outcome (W/D/L) is structurally wrong for soccer. Independent Poisson margins follow the Skellam distribution, which correctly admits margin=0 with positive probability — the canonical soccer family (Maher 1982; Dixon & Coles 1997).

## Model

For each MLS or EPL match between home team `h` and away team `a`:

```
λ_home = α_h × β_a × μ_home × league_avg_goals
λ_away = α_a × β_h × (1 / μ_home) × league_avg_goals
```

where:

- `α_t = team_t_goals_scored_per_game / league_avg_goals`  (attacking strength, dimensionless)
- `β_t = team_t_goals_conceded_per_game / league_avg_goals`  (defensive weakness, dimensionless)
- `μ_home` = league-specific home advantage multiplier
- `league_avg_goals` = average goals per team per match in the league

Per-game predictions:

- `predictedMargin = λ_home − λ_away`  (Skellam mean — what slots into the existing baseline pipeline)
- `predictedHomeProb = P(Skellam(λ_h, λ_a) > 0)`
- `predictedDrawProb = P(Skellam(λ_h, λ_a) = 0)`
- `predictedAwayProb = P(Skellam(λ_h, λ_a) < 0)`

Computed by joint Poisson truncated series: for each integer margin `n`, sum `Poisson(h;λ_h) × Poisson(a;λ_a)` over goal pairs `(h,a)` with `h − a = n`, truncated at 20 goals per side (soccer λ ≤ 3 typical; tail mass beyond 15 is <1e-5).

### Math-expert sign-off
- Formula includes `× league_avg_goals` so both teams at average produce realistic λ (EPL: ~1.55 home, ~1.28 away).
- λ floor at 0.05 guards against `pointsFor=0` degenerate cases (practical incidence ≈ zero for games ≥ 5).
- Truncation at k=20 gives Poisson tail mass <1e-5 for λ ≤ 5 — imperceptible.

## League constants (one-time derivation)

Backfill coverage for soccer starts at 2024; **no pre-cutoff training fold exists**. Constants are derived from the full backfill slice with in-sample disclosure. For per-league aggregates (SE ≈ 0.03 on 700–1200 games), the in-sample concern is cosmetic: the scalar is stable to ~1% precision regardless of split.

Measured from `data/baselines/baseline-2026-04-14.json` underlying data (2024-08 to 2026-04):

| League | N | home_goals/game | away_goals/game | `μ_home` (ratio) | draw_rate |
|---|---|---|---|---|---|
| MLS | 1159 | 1.7075 | 1.3563 | 1.2589 | 0.2407 |
| EPL | 699 | 1.5050 | 1.3376 | 1.1251 | 0.2532 |

Derivation for `league_avg_goals` and `μ_home`:
- `league_avg_goals` = `(home_goals + away_goals) / 2` per match, per team — i.e., the per-team expected goals. MLS = 1.532, EPL = 1.421.
- `μ_home` = `√(home_goals / away_goals)`. When applied as `λ_home = ... × μ_home × league_avg`, `λ_away = ... × (1/μ_home) × league_avg`, an average-vs-average match produces `λ_home = μ × L` and `λ_away = L/μ`, with ratio `μ²` matching the measured home/away goal ratio.
  - MLS `μ_home` = √1.2589 ≈ 1.1220
  - EPL `μ_home` = √1.1251 ≈ 1.0607

Constants committed in `src/analysis/poisson.ts` with provenance comments referencing this plan + the baseline artifact.

### Known limitations (filed, not fixed in v1)

- **In-sample league constants** — acknowledged above. Literature values are consistent with measured (EPL long-run ≈ 1.5/1.3; MLS ≈ 1.6/1.4); difference between literature and measured is <5% and would not change the A/B verdict.
- **MLS conference bias** — Eastern and Western teams face different opponent distributions. Season-average α/β conflate team strength with conference strength. EPL is balanced (full round-robin) so this is MLS-only. Flag for MLS-targeted follow-up if v1 fails on MLS but succeeds on EPL.
- **No recent form adjustment** — team strength is season-averaged. Literature (Dixon & Coles 1997) shows recent form matters but the improvement is small vs the structural Poisson switch.
- **No Dixon-Coles low-score τ correction** — the 0-0/1-0/0-1/1-1 correlation fix matters for predicting specific scorelines and for betting on 1X2 markets, but matters less for margin MAE (all four scorelines have |margin| ≤ 1). Deferred to v2 if warranted.
- **Probability calibration unmeasured at ship time** — the draw-probability Brier is reported as a secondary metric but not ship-gated. Filed as debt #17 in the baseline follow-up list (reliability diagram generalization).

## A/B measurement

Extend `src/analysis/baseline.ts`:

1. Replay soccer games with BOTH `predictMargin()` (v4-spread) AND `predictPoissonMargin()` (new).
2. Compute paired diff `v4spread_MAE − poisson_MAE` per slice with 1000-sample bootstrap CI.
3. Also compute `poisson_MAE − naiveZeroMAE` paired diff (primary ship gate).
4. Secondary: `poisson_draw_brier` vs naive-draw-rate-brier, reported but not ship-gated.

### Ship rules (pre-declared, no ex-post movement)

Poisson ships as the MLS/EPL margin model IF:

1. **Primary**: `poisson_MAE − naiveZeroMAE` CI entirely below zero on BOTH MLS and EPL (full slice). This is what v4-spread fails; this is what Poisson must do.

2. If primary holds but `poisson_MAE − v4spread_MAE` CI straddles zero on one or both leagues: **still ship**. The v4-spread-can't-beat-zero failure mode is the bug we're fixing, and a tie-with-v4-spread-that-also-beats-zero is strict improvement in the ratchet sense (moves us from "unclear" to "clearly working").

3. If primary fails on BOTH leagues (Poisson also can't beat predict-zero): **don't ship**. Consider Dixon-Coles correction or MLE fitting next.

4. If primary holds on one league but not the other: **ship only for the league where it holds**. Keep v4-spread for the other league. Document the asymmetry.

### Minimum detectable effect

EPL N=699 with σ_actual=1.76 → SE(MAE) ≈ 0.067. Meaningful Poisson improvement must exceed 2×SE ≈ 0.13 to produce CI clearly off zero. That's an 8-10% reduction in MAE. Literature suggests Poisson beats naive by 5-15% on soccer, so this is plausible but not guaranteed. If Poisson falls in the 3-7% "detectable but not statistically clean" zone, rule (4) above applies: honest report, no ship.

## Files

| File | Status | Purpose |
|---|---|---|
| `src/analysis/poisson.ts` | new | Model core: Skellam PMF/CDF, λ formula, `predictPoissonMargin`, league constants with provenance |
| `src/analysis/baseline.ts` | modify | Add optional `poissonMargin` field to `ReplayedGame`; extend metrics for paired A/B; draw-Brier secondary metric |
| `src/cli/baseline.ts` | unchanged | Just reruns |
| `Plans/soccer-poisson.md` | this file | Council-validated plan |

## Explicit non-scope

- No touching NBA / NFL / MLB / NHL models
- No UI changes
- No live-prediction runner wiring until A/B verdict is CLEAR (separate PR)
- No historical-odds ATS backtest (no data)

## Council verdict on this plan

After six corrections:

1. ✓ (Math) λ formula corrected to include `× league_avg_goals`
2. ✓ (Math) λ ≥ 0.05 floor specified
3. ✓ (Stats + Data Quality) League constants documented with provenance; in-sample concern disclosed explicitly (no pre-cutoff data exists)
4. ✓ (Stats) Fallback ship rule pre-declared
5. ✓ (Prediction Accuracy) Draw-Brier as secondary metric specified
6. ✓ (Domain) MLS conference-bias known limitation noted

Five-expert verdict: **CLEAR to implement**.

Deviating from this plan during implementation requires a fresh council pass — no silent scope drift.

---

## Post-implementation addendum (2026-04-14, post-#29 merge)

### Ship-gate outcome

Per pre-declared ship rules above, the Poisson v1 A/B produced these 95% bootstrap paired-diff CIs:

| League | Poisson MAE − predict-zero | Poisson MAE − v4-spread | Draw Brier − naive |
|---|---|---|---|
| MLS (N=1159) | −0.007 [−0.049, +0.032] ~ tie | −0.003 [−0.011, +0.005] ~ tie | −0.0023 [−0.0051, +0.0006] ~ tie |
| EPL (N=699)  | +0.007 [−0.053, +0.067] ~ tie | **−0.019 [−0.036, −0.002] ✓ beats** | +0.0003 [−0.0033, +0.0044] ~ tie |

Primary ship gate fails on both leagues → per rule 3, did NOT ship as v4-spread replacement. Infrastructure shipped, model swap did not. Recorded in SESSION_LOG Sprint 10.8 and `learnings.md`.

### Math-expert finding that reframed the v2 plan

When council was re-convened to plan "Dixon-Coles next", the math expert verified that the DC τ correction (the obvious reading of "add Dixon-Coles") **cannot change E[margin]**, and therefore cannot change margin MAE — the exact metric PR #29's primary ship gate measures.

**Derivation (for the record):** The DC τ correction modifies P(i,j) in 4 cells:
- `τ(0,0) = 1 − λh·λa·ρ`
- `τ(0,1) = 1 + λh·ρ`
- `τ(1,0) = 1 + λa·ρ`
- `τ(1,1) = 1 − ρ`
- `τ(i,j) = 1` elsewhere.

For `E[H−A] = ΣΣ (i−j)·τ(i,j)·P(i,j)`:
- (0,0) contributes `0·anything = 0`
- (1,1) contributes `0·anything = 0`
- (0,1) shift: `−1 · (λh·ρ) · λa·e^(−λh−λa) = −λh·λa·ρ·e^(−λh−λa)`
- (1,0) shift: `+1 · (λa·ρ) · λh·e^(−λh−λa) = +λh·λa·ρ·e^(−λh−λa)`
- Sum of shifts: 0.

Normalizer `Z = ΣΣ τ·P = 1 + ρ · [−λh·λa·e^(−λh−λa) + λh·λa·e^(−λh−λa) + λh·λa·e^(−λh−λa) − λh·λa·e^(−λh−λa)] = 1` (exact).

So `E[margin]_DC = E[margin]_independent` exactly; no renormalization; margin MAE is guaranteed identical across the two models on any dataset.

**What DC τ *does* improve:** scoreline-specific probabilities (especially 0-0, 1-1) and draw-Brier. Both are genuinely valuable, neither is on our current ship-gate metric set.

### v2 direction (council-endorsed, documented but not scheduled)

The obvious "add τ and re-run" was rejected by unanimous council vote. The correct v2 soccer sequence is:

1. **Debt #26 — Pre-2024 soccer scrape.** FBref or Understat (Understat includes xG). Unblocks proper train/test split AND grows N by 5-10× per league. Minimum detectable effect halves.
2. **Debt #25 — Dixon-Coles ξ time-decay + MLE fit.** The *actually* margin-moving half of the 1997 paper: weight recent matches more, MLE-fit α/β/μ_home over all history. Reduces estimator variance and captures recent-form drift. Blocked on #26.
3. **Debt #24 — Dixon-Coles τ correction.** Lowest priority. Optional polish on scoreline/draw calibration *after* steps 1-2 lift margin MAE off the predict-zero floor. Not on the ship-gate critical path.

**Zero-risk parallel track (P0 next session per Sprint 10.8 council):** Debt #11 reliability diagrams generalized across all sports from the 16,777-game baseline. Not part of the soccer v2 plan proper, but the measurement infra that every v2 attempt (soccer or otherwise) will benefit from.

### Do not edit the plan-proper above

The council-CLEAR plan sections above this addendum are the audit record of what was promised and what shipped. They should not be back-edited. Any further changes to the soccer model go into a new plan document (`Plans/soccer-poisson-v2.md` or similar) with its own council pass.
