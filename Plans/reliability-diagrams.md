# Reliability Diagrams Across All Sports — Council-Validated Plan

**Branch**: `claude/sport-specific-predictions-95RA4`
**Scope**: debt #11 (generalized) — per-sport reliability for v5 winner-prob AND v4-spread/Poisson margin, over the 16,777-game baseline corpus.
**Status**: DRAFT, pending council review.

## Problem

Debt #11 (Sprint 7 Researcher, elevated + generalized Sprint 10.8). Today we have:
- `getCalibration()` in `src/analysis/resolve-predictions.ts` — pulls from the live `predictions` DB table, NBA-only in practice, winner-prob only, works on N<3000 per sport.
- `data/baselines/baseline-2026-04-14.json` — 16,777 resolved games across 6 sports with per-game `predictedProb`, `predictedMargin`, `poissonMargin` (soccer only), `actualMargin`, `homeWin`, `isDraw`, `lowConfidence`.

We can report per-sport ECE, MAE, Brier at the aggregate level from the baseline already, but we can't say **where** a model is miscalibrated. A model with ECE=0.08 can be (a) slightly off everywhere, or (b) perfect in 8 of 10 bins and catastrophic in 2 — different bugs, different fixes.

Sprint 10.8 council elevated this because:
- It's pure instrumentation. Zero regression risk, no model changes.
- It sharpens every *subsequent* model decision (e.g., "only the 70-80% confidence bin is miscalibrated" → surgical fix).
- It's the natural infra companion to the PR #29 null result: measurement > more modeling on already-noise-dominated slices.

## Model-agnostic scope

Two views per sport, computed from the baseline replay:

### View A — Winner-prob reliability (v5 model)

For each sport, bin `predictedProb` into 10 equal-width bins over [0.5, 1.0] (0.05 wide each). For each bin:
- `n`: count
- `predictedAvg`: mean of `predictedProb` in the bin
- `actualRate`: `Σ homeWin / n` (among winner-eligible games, i.e. non-draws)
- 95% Wilson CI on `actualRate`
- `residual = actualRate − predictedAvg` (signed; positive = shy, negative = overconfident)
- `ciWide`: boolean flag set if `ciHigh − ciLow > 0.15` (Stats WARN fix — reporting flag based on actual CI width, not an arbitrary n cutoff)

Per sport:
- `ECE = Σᵢ (nᵢ / N) × |residualᵢ|` over populated bins
- `signedResidual = Σᵢ (nᵢ / N) × residualᵢ` (signed, detects systematic over- vs under-confidence)
- `populatedBins`: count of bins with n > 0
- `verdict` (word): `DISCRETE` if populatedBins ≤ 2; else `OVERCONFIDENT` (signedResidual > 0.02), `SHY` (< −0.02), `HONEST` (|signedResidual| ≤ 0.02), `INSUFFICIENT` (N < 50)

This mirrors the existing `computeCohort()` in `resolve-predictions.ts` exactly — we reuse the same Wilson-CI + ECE + verdict logic (and can share helpers rather than copy-paste). The only new thing is: we run it per sport from the baseline, not only NBA-live from the predictions table.

### View B — Margin reliability (v4-spread for all sports; Poisson for soccer as second track)

Reliability for a regression model is the "predicted-bucket vs actual-bucket mean" curve with a y=x reference line. Deviation from the diagonal is miscalibration.

**Per-sport bin widths** (Domain WARN fix — low-variance sports get narrower bins so they're not forced into a DISCRETE verdict by bin-width alone):

| sport | bin width | range | bins |
|---|---|---|---|
| NBA | 2 pts | −20 .. +20 | 21 |
| NFL | 2 pts | −20 .. +20 | 21 |
| MLB | 1 run | −10 .. +10 | 21 |
| NHL | 1 goal | −6 .. +6 | 13 |
| MLS | 1 goal | −5 .. +5 | 11 |
| EPL | 1 goal | −5 .. +5 | 11 |

Ranges informed by each sport's typical actual-margin σ (NBA/NFL ~12-13, MLB ~3-4 runs, NHL ~1.5 goals, soccer ~1.7 goals). Widths committed as a `SPORT_BIN_SPECS` constant in reliability.ts.

**Terminal bins clamp** predictions beyond the range into the end buckets. A clamped prediction still contributes its own `predictedMargin` value to `predictedAvg`, so the bin's `predictedAvg` can drift outside the bin edges for the terminal-most buckets — this is expected, not a bug, and the artifact should include a `terminal: true` flag on those bins so readers aren't surprised (Prediction Accuracy nit).

For each bin:
- `n`: count
- `predictedAvg`: mean predicted margin in the bin
- `actualAvg`: mean actual margin in the bin
- `actualSampleSD`: sample standard deviation, `√[Σ(x − x̄)² / (n − 1)]` (Math WARN fix — sample, not population)
- `actualSE`: `actualSampleSD / √n`
- 95% normal-theory CI on `actualAvg`: `[actualAvg − 1.96 × actualSE, actualAvg + 1.96 × actualSE]`
- `residual = actualAvg − predictedAvg` (signed)
- `ciWide`: boolean flag set if `actualSE > 2 × binWidth` (Stats WARN fix — flag on CI width, not an arbitrary n cutoff)

Per sport:
- `weightedMAE = Σᵢ (nᵢ / N) × |residualᵢ|` — the margin analog of ECE, units of points
- `signedResidual = Σᵢ (nᵢ / N) × residualᵢ` — detects systematic over- vs under-prediction of margin
- `populatedBins`, `verdict`:
  - `DISCRETE` if populatedBins ≤ 2
  - `BIASED_HIGH` if signedResidual > +0.5 points (predictions systematically run hotter than actual)
  - `BIASED_LOW` if signedResidual < −0.5
  - `HONEST` if |signedResidual| ≤ 0.5
  - `INSUFFICIENT` if N < 50

**For soccer (MLS/EPL)**, repeat View B for the Poisson model (`poissonMargin`) as a second track, reusing the same bin structure. This gives a side-by-side: v4-spread bias pattern vs Poisson bias pattern, at the bin level, for the two leagues where both exist.

### Why no Poisson winner-prob?

The Poisson model in `poisson.ts` doesn't emit a head-to-head winner probability suitable for View A (it emits P(home), P(draw), P(away) — a ternary distribution; our winner-prob reliability is binary). Ternary reliability requires a different construction: either per-class reliability curves (three curves, one per outcome) or the full Murphy decomposition (`Brier = reliability − resolution + uncertainty`). Neither is a pointwise 10-bin plot. Deferred — not forgotten. Filed as a follow-up if 1X2-market work becomes a priority. (Math WARN fix.)

## Non-scope (deliberate)

- **No new API endpoint.** `/api/reliability/:sport` can follow in a UI-focused PR.
- **No frontend rendering.** Reliability plots (a) need their own SVG render and (b) will be driven by the API endpoint above. This PR ships the numbers, not the visuals.
- **No live-predictions reliability.** The existing `getCalibration()` in `resolve-predictions.ts` already does live, and its sample sizes (N<500 on the live side) are too small for bin-level signal. The baseline corpus (16,777 games) is where the signal is.
- **No ternary (1X2) reliability for soccer.** Separate design problem (see above).
- **No multi-model comparison rollups** (e.g., "Poisson beats v4-spread on bins 5-7 by X"). The per-bin numbers will make this easy for a human reader; we don't need a rollup formula yet.
- **No time-evolving reliability** (reliability per season, per month).

## Files

| File | Status | Purpose |
|---|---|---|
| `src/analysis/reliability.ts` | new | Pure logic: View A (winner-prob bins) + View B (margin bins). No DB, no I/O. Takes an array of `ReplayedGame` (from baseline.ts) as input; returns a typed `SportReliability` structure. |
| `src/cli/reliability.ts` | new | CLI entry: `npm run reliability`. Calls `computeBaseline()` from baseline.ts (to get the replays), then `computeReliability(games)` per sport, writes artifact. |
| `src/analysis/baseline.ts` | modify | Export the per-sport replay function / ReplayedGame list so reliability.ts can consume them without duplicating 700 lines of replay logic. Minimal change. |
| `package.json` | modify | Add `"reliability": "node node_modules/.bin/tsx src/cli/reliability.ts"` script. |
| `data/reliability/reliability-YYYY-MM-DD.{json,txt}` | new | Artifact: machine-readable JSON + human-readable text, same shape pattern as `data/baselines/`. |
| `Plans/reliability-diagrams.md` | this file | Council-validated plan. |

## Ship rules (pre-declared, same discipline as PR #29)

This is **infrastructure**, not a model change. There is no "does it beat baseline X?" question. Ships if:

1. ✓ Artifact generates cleanly on all 6 sports (no unhandled NaN, no empty-bin division-by-zero).
2. ✓ Bin counts sum: for each sport and each view, `Σ nᵢ = N_sport` (invariant, hand-checked on one example).
3. ✓ ECE and weightedMAE match a hand-computed example on a tiny synthetic 10-game dataset (committed as an inline unit check in reliability.ts).
4. ✓ Verdict words are consistent across identical inputs (determinism test).
5. ✓ No regression: `npm run baseline` still produces the same artifact byte-for-byte after this PR as before (we are ADDING reliability, not mutating baseline's outputs).
6. ✓ Council 5/5 CLEAR.

If ANY of 1-5 fails, fix and re-review. Don't ship partial.

## Known limitations (pre-declared, same discipline as PR #29)

- **In-sample caveat** inherited from baseline.ts: sigmoid_scale, home_advantage, etc. were calibrated against this same 16,777-game corpus. Reliability on in-sample data over-states calibration quality. This limitation is documented in baseline.ts header; inherit the same disclosure in reliability.ts header.
- **No train/test split on reliability.** Unlike baseline.ts which has 80/20 train/test, reliability needs N per bin to be interpretable. Splitting 80/20 would halve small-bin counts. Report `all` only (with the in-sample caveat explicit).
- **Margin bin boundaries are arbitrary.** 2-point buckets from −20 to +20 is a defensible choice (most games fall in ±15; NBA σ ≈ 12 points, NFL σ ≈ 13). Document the choice; allow bin params as CLI flags for exploration.
- **Wilson CI is for binary proportions.** View A uses Wilson. View B uses normal-theory CI on actual-margin mean; normal-theory assumes actual margins in each bin are approximately normal. For small bins this can be off — report the CI but flag bins with `n<30` as "wide".
- **Low-confidence rows**: include in primary reliability (same as existing `getCalibration()`) but report `lowConfOnly` and `highConfOnly` secondary ECE / weightedMAE per sport so both interpretations are visible. Mirrors Sprint 10 resolved conflict.

## Expected output snapshot (indicative, not a target)

```
── NBA (N=5196, model: v5/v4-spread) ──
  Winner-prob reliability (10 bins, 0.5-1.0):
    bin 0.50-0.55  n=  12   pred=0.527   actual=0.500 [0.267, 0.733]   resid +0.027  ciWide
    bin 0.55-0.60  n= 342   pred=0.572   actual=0.582 [0.529, 0.632]   resid +0.010
    ...
    ECE=0.018   signedResid=+0.004   populated=10/10   verdict: HONEST

  Margin reliability (2-pt bins, -20..+20):
    bin  -8..-6   n= 121   pred=-6.84   actual=-7.23 [-8.01, -6.45]   resid -0.39
    bin  -6..-4   n= 234   pred=-4.89   actual=-4.22 [-4.78, -3.66]   resid +0.67
    ...
    weightedMAE=0.82 points   signedResid=+0.11   populated=18/21   verdict: HONEST
```

## Council verdict trail

Round 1 (plan draft): 1× CLEAR (Prediction Accuracy), 4× WARN (Math / Stats / Data Quality / Domain). All WARNs addressed in-plan before any code was written:
- Math: sample SD (n−1) in View B; ternary-reliability deferral note sharpened
- Stats: `ciWide` reporting flag replaces arbitrary n<30 cutoff
- Data Quality: explicit no-regression ship rule on `npm run baseline` byte-identity
- Domain: per-sport bin widths (NBA/NFL 2pt, MLB 1run, NHL/soccer 1goal)

Round 2 expected verdict: 5× CLEAR. To be recorded below once the plan is re-reviewed by the user / next council pass.

## Deviation discipline

Same as PR #29: deviating from this plan during implementation requires a fresh council pass. No silent scope drift.

If during implementation I find the bin-count invariant fails (e.g., NaN-producing code path I didn't anticipate), I stop and document the issue — I don't silently clamp or skip rows.

## Council verdict request

Five-expert review sought on:
1. **Math:** Wilson CI (View A) and normal-theory CI (View B) formulas; ECE and weightedMAE definitions; bin-width and boundary choices.
2. **Stats:** in-sample caveat handling; no-train/test-split decision (rationale: N per bin); INSUFFICIENT threshold (N<50); low-conf handling.
3. **Prediction Accuracy:** verdict-word thresholds (0.02 for winner-prob ECE, 0.5 points for margin bias); edge-case handling (empty bins, terminal clipping).
4. **Data Quality:** artifact structure (JSON + TXT), determinism, invariant testing, no-regression-on-baseline-output guarantee.
5. **Domain:** bin choices per sport — soccer rarely produces |margin|>5, so the ±20 range has many empty bins for MLS/EPL. Is that the right default, or should bins be sport-aware? (Proposal: keep symmetric ±20 for consistency across the 6 sports; bins beyond typical range will show up as `empty` and won't pollute metrics since weighted by nᵢ/N.)

Council verdict required before any code is written.
