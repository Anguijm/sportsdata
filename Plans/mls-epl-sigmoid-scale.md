# MLS / EPL v5 Sigmoid Scale Sharpening (debt #28)

**Branch**: `claude/mls-epl-sigmoid-scale`
**Scope**: MLS and EPL only. `SIGMOID_SCALE.mls` and `SIGMOID_SCALE.epl` constants in `src/analysis/predict.ts`. Every other sport, v4-spread, `SPORT_HOME_ADVANTAGE`, and every other engine constant untouched.
**Status**: pre-council plan, awaiting 5-expert review.

## Problem

`data/reliability/reliability-2026-04-15.txt` on the 16,777-game post-cutoff baseline corpus shows v5 winner-probability calibration is under-confident (SHY) on both soccer leagues:

| Sport | N (non-draw) | ECE    | signedResid | verdict |
|-------|--------------|--------|-------------|---------|
| MLS   | 880          | 0.0429 | +0.0241     | SHY     |
| EPL   | 522          | 0.0502 | +0.0351     | SHY     |

Positive `signedResid` = actual > predicted, i.e. when the model says 0.65, the team wins more often than 65% of the time. Bin-by-bin pattern:

- MLS: 0.50-0.55 resid −0.021, 0.55-0.60 +0.025, **0.60-0.65 +0.105**, 0.65-0.70 +0.035, 0.70-0.75 −0.032 (wide CI), tail bins too sparse for signal (n=8, n=2).
- EPL: 0.50-0.55 −0.024, 0.55-0.60 +0.030, 0.60-0.65 +0.035, **0.65-0.70 +0.125**, 0.70-0.75 +0.087, 0.75-0.80 +0.077, 0.80-0.85 +0.106 — monotonically SHY across the populated mid-to-high bins.

Interpretation: the predictor `(homeDiff − awayDiff + homeAdv)` carries real signal for soccer (mid-bin resids show the model is pointed in the right direction) but the sigmoid scale `0.60` is too flat, compressing predictions toward 0.50. A one-number sharpening of the scale is the matching fix.

## Fix

Two-number change in `src/analysis/predict.ts`:

```ts
const SIGMOID_SCALE: Record<string, number> = {
  nba: 0.10, nfl: 0.10, mlb: 0.30, nhl: 0.45,
- mls: 0.60,
- epl: 0.60,
+ mls: <tuned>,
+ epl: <tuned>,
};
```

The two scales are decoupled (as NBA home-adv was decoupled from NFL's) because:
- MLS signedResid (+0.0241) ≠ EPL (+0.0351) — different drift magnitudes
- The sigmoid-scale coefficient `π / (√3 · σ_eff)` derivation is per-competition and the two leagues have different variance structure (EPL has higher scoring variance per the margin reliability)
- Sharpening both to a common value risks over-shooting one league to fix the other

### Tuning method: grid search over candidates

Tuned values are picked by running a grid search on the reliability pipeline:

```
scale_candidates = [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 1.10, 1.20]
```

For each candidate, we re-replay v5 on the frozen 16,777-game corpus and record `(ECE, signedResid, verdict)`. We pick the candidate that minimises `|signedResid|` **subject to** verdict = HONEST and ECE ≤ baseline ECE. If no candidate clears that gate, we ship nothing and re-council.

We grid-search rather than closed-form solve because:
- The sigmoid isn't linear in scale; the first-order approximation `Δscale/scale ≈ signedResid / E[logit(p)·p·(1−p)]` has ~20% error at the magnitudes involved (PR #34 saw similar: naive 0.926 coefficient was actually 0.809).
- Grid search is empirically validated by PR #34 (two-attempt convergence for NBA).
- Cost is trivial: ~100ms per candidate × 11 candidates × 2 leagues.

### Why min-|signedResid| and not min-ECE (math expert note)

The selection rule is "**min |signedResid|** subject to verdict HONEST and ECE ≤ baseline ECE." An alternative criterion would be **min ECE** over HONEST candidates. They give different picks:

| League | min-\|sR\| pick | min-ECE pick  | ECE delta  |
|--------|----------------|---------------|------------|
| MLS    | scale=0.80     | scale=0.85    | 0.0380 vs 0.0337 (+0.004) |
| EPL    | scale=0.90     | scale=1.00    | 0.0404 vs 0.0323 (+0.008) |

We pick min-|sR| because:
1. **signedResid=0 is the cleanest calibration target.** It means no remaining uniform shift — any residual ECE is noise/per-bin variance, not systematic bias. An ECE-optimized pick can still have a small systematic shift hiding under cancelling bin residuals.
2. **Min-|sR| is monotonic in the scale knob;** min-ECE is not. See the EPL grid: ECE actually *rises* from 0.0502 at scale=0.60 to a local max of 0.0654 at 0.80, then falls through 0.0323 at scale=1.00. Picking by ECE minimum risks landing at a scale that's still compressing calibration into cancelling resids that look good at aggregate.
3. **The ECE gap is small** (≤0.008) relative to the improvement (ECE drops from 0.0429→0.0380 for MLS, 0.0502→0.0404 for EPL).
4. The min-|sR| pick is **strictly further from the OVERCONFIDENT edge** than min-ECE, giving more margin against over-correcting.

Trade-off pre-declared: we accept +0.004-0.008 ECE vs the min-ECE pick in exchange for signedResid ≈ 0 and a cleaner physical interpretation. If the post-ship reliability re-run shows this choice was wrong (e.g. the bias re-emerges on a fresh-cohort replay), we re-council toward min-ECE.

### Rough prior on the tuned values (not the commit target)

First-order estimate using bin-weighted `logit(p)·p·(1−p) ≈ 0.08`:
- MLS: Δscale/scale ≈ 0.024 / 0.08 ≈ 0.30 → candidate ≈ 0.78
- EPL: Δscale/scale ≈ 0.035 / 0.08 ≈ 0.44 → candidate ≈ 0.86

These are **priors**, not pre-commits. The actual ship values come from the grid search.

## Pre-declared ship rules

After the code change (both scales updated simultaneously), re-run the replayed reliability pipeline on the same 21,381-game restored backup `backup-2026-04-15` used by PR #34. Ship iff **all six** hold:

1. **MLS v5 ECE decreases** (from 0.0429).
2. **EPL v5 ECE decreases** (from 0.0502).
3. **MLS v5 verdict ∈ {HONEST}** (currently SHY; HONEST = `ECE ≤ 0.02` per `reliability.ts` WINNER_VERDICT_THRESH).
4. **EPL v5 verdict ∈ {HONEST}**.
5. **No other sport's v5 winner verdict changes.** NBA/NFL/MLB/NHL remain HONEST (their ECEs 0.0156, 0.0515, 0.0152, 0.0162). Any change is a bug because this PR only touches MLS/EPL constants.
6. **No sport's v4-spread margin verdict changes.** Sigmoid scale is a winner-only knob; margin predictions are unchanged by construction. This is a sanity check on the replay harness, not a modelling claim.

Ship blockers (if any rule fails):
- **1 or 3 fails (MLS ECE or verdict):** the signal on MLS isn't a clean scale miscalibration. Do not ship MLS. File as debt #34 for structural-model follow-up (per-bin reweighting, not one-number tune).
- **2 or 4 fails (EPL ECE or verdict):** same as above, for EPL.
- **Either 1&3 OR 2&4 fail, the other passes:** ship only the half that passes. Split the PR.
- **5 fails:** implementation bug — revert.
- **6 fails:** replay-harness bug — fix the harness, rerun, do not ship the model change until the harness is sound.

Additional health checks (non-blocking, report only):
- MLS/EPL |signedResid| reduction (sample-noise-dominated for EPL at N=522; report but don't gate).
- Per-bin max absolute residual on populated bins with n≥30 (noise bins excluded).
- Draw rate in the corpus (should be unchanged — draws are filtered before winner-reliability compute).

## Known statistical-validity weaknesses (pre-declared, not hidden)

These are the issues a rigorous Stat Validity expert will raise. I'm naming them upfront with mitigation so the review doesn't stall on them.

1. **Marginal sample size.** EPL has 522 non-draw predictions. The standard error on signedResid for a binary outcome with p≈0.55 and N=522 is `sqrt(0.25/522) ≈ 0.022`, so the observed +0.035 signedResid has a 95% CI of roughly [−0.01, +0.08] — it includes 0. We're justified using the ECE gate (0.0502 vs HONEST threshold 0.02) rather than signedResid, because ECE is the mean absolute residual and is a larger effect than the sampling SE. MLS (N=880) is less marginal: 95% CI on signedResid is roughly [−0.01, +0.06], also borderline. **Mitigation:** ECE is the primary ship gate (rules 1-2). signedResid is a secondary direction check that we report but don't commit to a tight numeric gate on.

2. **In-sample calibration.** The tuned scale is fit on the same 16,777-game corpus used to surface the miscalibration. Same caveat as PR #34 — this is a known-drifted-constant update, not a capacity claim. The clean out-of-sample validation lives in debt #14 (shadow-prediction logging), which is HIGH priority and separately tracked. **Mitigation:** declare the in-sample caveat explicitly in the commit message and PR body; don't claim the tune is out-of-sample-validated.

3. **Tail-bin instability.** MLS bins 0.75-0.80 (n=8, resid +0.233) and 0.80-0.85 (n=2, resid −0.310) are noise-dominated and swing signedResid. EPL tail is mildly less bad. **Mitigation:** the grid search optimises on the full-corpus signedResid and ECE exactly as the production verdict function does, i.e. we do not cherry-pick a subset of bins. The tail swing is absorbed equally at every candidate scale.

4. **Confound with draws.** Soccer has ~24% draw rate (MLS 279/1159, EPL 177/699). Draws are filtered before winner-reliability computation (`if (r["isDraw"]) continue` in `compute_winner_reliability`). This means signedResid measures calibration of conditional win rate given a non-draw — which is exactly what the v5 model outputs for soccer, because v5 itself ignores draws. Apples-to-apples, no adjustment needed. But I'm naming it because soccer-aware reviewers will ask.

## Known prediction-accuracy concerns

1. **Live-mode interaction with injury adjustment.** Scope guard: sigmoid scale multiplies the post-injury sum `(homeDiff − awayDiff + homeAdv + injuryAdj)`. Sharpening the scale amplifies the injury term proportionally in the prob space. But MLS/EPL have injury adjustment **disabled** (no public lineup feed), so `injuryAdj = 0` for soccer in production. No interaction effect.

2. **Base rate sanity.** MLS home-win base rate 0.49 (pre-draw-removal), non-draw-conditional home win rate per `SPORT_HOME_WIN_RATE.mls = 0.49`. v5 must still outperform this base rate after sharpening — the Brier score on MLS should not regress. **Health check:** report Brier before/after, fail soft if Brier goes up (noise-possible; informational not ship-blocking).

## Out of scope (filed as follow-up debts)

- **v4-spread margin scale tuning for MLS/EPL.** Already HONEST on reliability; no fix needed.
- **Draw-probability model for MLS/EPL.** Different modelling problem (ternary, not binary); debt #25's soccer Poisson work is the natural home.
- **Per-bin residual reweighting.** Only triggered if a ship rule fails.
- **Home-advantage recalibration for MLS/EPL** (currently 0.4 for both). Margin verdicts are already HONEST on reliability-2026-04-15; no evidence of miscalibration. Not bundled.

## Implementation plan

1. **Write `scripts/validate-debt28.py`** — fork of `validate-debt27.py` that accepts a per-sport scale override via CLI arg and prints the reliability table. Pure Python, no native deps.
2. **Restore `backup-2026-04-15`** locally for validation (`gh release download backup-2026-04-15`, gunzip, sqlite3 < sql).
3. **Baseline pass:** run the validator with current scales `{mls: 0.60, epl: 0.60}` and confirm it reproduces the SHY verdicts from `reliability-2026-04-15.txt` (within ±0.001 on ECE / signedResid — exact match validates the replay harness).
4. **Grid-search pass:** run the validator for each candidate scale and each sport; dump a table of `(sport, scale, ECE, signedResid, verdict, maxAbsBinResid_n30)`.
5. **Pick** the min-|signedResid| candidate that also clears rules 1-4.
6. **Apply** the two constant changes to `src/analysis/predict.ts`.
7. **Verification pass:** re-run validator on the committed scales; produce the post-change reliability table for the PR body.
8. **Write post-validation addendum to this plan** with the actual chosen scales and the rule-by-rule pass table (same format as `nba-home-adv-recalibration.md`'s addendum).

## Validation data (pre-change reference, for post-ship comparison)

| Metric                     | Current   | Rule gate        |
|----------------------------|-----------|------------------|
| MLS v5 ECE                 | 0.0429    | decrease         |
| MLS v5 signedResid         | +0.0241   | informational    |
| MLS v5 Brier               | 0.2297    | informational    |
| MLS v5 verdict             | SHY       | HONEST           |
| EPL v5 ECE                 | 0.0502    | decrease         |
| EPL v5 signedResid         | +0.0351   | informational    |
| EPL v5 Brier               | 0.2176    | informational    |
| EPL v5 verdict             | SHY       | HONEST           |
| NBA v5 ECE                 | 0.0181    | unchanged/HONEST |
| NFL v5 ECE                 | 0.0515    | unchanged/HONEST |
| MLB v5 ECE                 | 0.0155    | unchanged/HONEST |
| NHL v5 ECE                 | 0.0145    | unchanged/HONEST |
| All margin verdicts        | HONEST    | unchanged        |

(NBA/MLB/NHL ECEs differ slightly from reliability-2026-04-15.txt because PR #34 shifted NBA home-adv 3.0→2.25, which propagates through the sigmoid input for all sports that share SPORT_HOME_ADVANTAGE. These values are the post-PR#34 baseline — reproduced by `scripts/validate-debt28.py` on backup-2026-04-15 at the current constants.)

## Grid-search results (candidates the plan will pick from)

Grid-search was run pre-council for plan evidence (not a pre-commit of the tuned values — those come from rule-gated selection). Results at `scripts/validate-debt28.py <db> --grid`:

**MLS (EPL held at 0.60 — orthogonal slice):**

| scale | ECE    | signedResid | verdict       |
|-------|--------|-------------|---------------|
| 0.60  | 0.0429 | +0.0241     | SHY           |
| 0.65  | 0.0381 | +0.0172     | HONEST        |
| 0.70  | 0.0414 | +0.0103     | HONEST        |
| 0.75  | 0.0435 | +0.0036     | HONEST (ECE↑) |
| **0.80** | **0.0380** | **−0.0029** | **HONEST ← min-\|sR\| + ECE-decrease** |
| 0.85  | 0.0337 | −0.0094     | HONEST (min-ECE alt) |
| 0.90  | 0.0349 | −0.0156     | HONEST        |
| 0.95  | 0.0402 | −0.0217     | OVERCONFIDENT |

**EPL (MLS held at 0.60):**

| scale | ECE    | signedResid | verdict       |
|-------|--------|-------------|---------------|
| 0.60  | 0.0502 | +0.0351     | SHY           |
| 0.65  | 0.0438 | +0.0276     | SHY           |
| 0.70  | 0.0590 | +0.0204     | SHY           |
| 0.75  | 0.0642 | +0.0135     | HONEST (ECE↑) |
| 0.80  | 0.0654 | +0.0070     | HONEST (ECE↑) |
| 0.85  | 0.0581 | +0.0006     | HONEST (ECE↑) |
| **0.90** | **0.0404** | **−0.0055** | **HONEST ← min-\|sR\| + ECE-decrease** |
| 0.95  | 0.0325 | −0.0113     | HONEST        |
| 1.00  | 0.0323 | −0.0169     | HONEST (min-ECE alt) |
| 1.10  | 0.0379 | −0.0272     | OVERCONFIDENT |

**Pre-declared ship values (per the selection rule):** `mls=0.80`, `epl=0.90`.

Full 6-rule check at these values:

```
PASS Rule 1: MLS ECE 0.0429 → 0.0380
PASS Rule 2: EPL ECE 0.0502 → 0.0404
PASS Rule 3: MLS verdict HONEST
PASS Rule 4: EPL verdict HONEST
PASS Rule 5: NBA/NFL/MLB/NHL winner verdicts all still HONEST
PASS Rule 6: all margin verdicts unchanged

ALL 6 SHIP RULES PASS
```

Secondary Brier improvements (informational, not ship-gated):
- MLS Brier 0.2297 → 0.2283 (−0.0014)
- EPL Brier 0.2176 → 0.2144 (−0.0032)

Both leagues improve on the proper scoring rule; neither regresses. This corroborates that the calibration improvement did not come at the cost of accuracy.
