# Debt #22 — streak-adjustment recalibration findings (2026-05-28)

## TL;DR

The "ready to ship" framing of debt #22 — *raise NBA `cold_coef` from `0.5` to `~0.92` per the 8,699-game replay in PR #63* — is **stale and no longer holds**. A fresh re-run of `scripts/validate-debt22.py` against today's snapshot (`sportsdata-prebackfill-20260527T231626Z.injury-fix-verify.db`) on `N = 20,279` games across NBA/NFL/MLB/NHL shows the empirical NBA `cold_coef` has moved from `0.922` (April) to **`2.227`** (today). MLB and NHL produce **negative** empirical coefficients (cold home teams beat the spread, not lose to it). NFL is the only sport currently within ±0.15 of the in-code default.

**Recommended disposition: do NOT ship any single-number change to `src/analysis/predict.ts:358` today.** Reframe debt #22 as a methodology robustness study instead. The deferral to "council review (model change protocol)" in PR #63's commit message stands; what's needed before any code change is not just a vote, it's a re-grounded methodology that produces stable estimates.

This document is the **finding**, not the **fix**. No production code changes in this PR.

---

## Reproducible measurement (today)

```
$ python3 scripts/validate-debt22.py \
    data/snapshots/sportsdata-prebackfill-20260527T231626Z.injury-fix-verify.db

Loaded 20279 scored games across NBA/NFL/MLB/NHL.

Sport   N_all  N_cold  N_hot   base_err   cold_err    hot_err  cold_coef   hot_coef
-----------------------------------------------------------------------------------
nba      7887    1922   1131     -0.298     -5.307     -4.853      2.227      2.024
nfl       871     141    131     -0.212     -1.227     -0.756      0.406      0.218
mlb      6783     856    571     -0.414     -0.316     -0.143     -0.196     -0.542
nhl      4345     578    501     -0.080     +0.043     -0.077     -0.409     -0.008
```

Verdicts from the script (`±0.15` tolerance vs in-code defaults `cold=0.5, hot=0.3`):

- NBA cold: **RECALIBRATE** (empirical `2.227`, current `0.5`, diff `1.727`)
- NBA hot:  **RECALIBRATE** (empirical `2.024`, current `0.3`, diff `1.724`)
- NFL cold/hot: within tolerance
- MLB cold/hot: **RECALIBRATE** (both empirical negative)
- NHL cold/hot: **RECALIBRATE** (both empirical near-zero/negative)

## Comparison to PR #63 (April 2026)

| Sport | Quantity | PR #63 (Apr) | Today (May 28) | Δ |
|---|---|---|---|---|
| NBA | N_all | 8,699 | 7,887 | -812 |
| NBA | N_cold | 1,392 | 1,922 | +530 |
| NBA | empirical cold_coef | 0.922 | **2.227** | +1.305 |
| MLB | N_all | not run | 6,783 | — |
| NHL | N_all | not run | 4,345 | — |
| NFL | N_all | not run | 871 | — |

The N_all decrease for NBA + N_cold increase is hard to explain on first glance. The likely driver is **selection: today's snapshot may include a different time-window slice of `game_results` than the April snapshot did**, AND/OR the streak-detection has shifted because more games means more 3-game-cold sequences within long stretches.

The methodology produces estimates that shift by `1.3×` between successive snapshots taken ~5 weeks apart. That's not the property a coefficient calibration is supposed to have.

## Why this matters for the ship decision

Shipping `0.5 → 0.92` today would lock in a number from a moment-in-time that the data has since moved away from. The next snapshot may report a different empirical value again, and we'd be repeating this loop. Worse: shipping the NBA-only `0.92` while ignoring the negative MLB/NHL coefficients silently keeps `cold_coef = 0.5` for sports where the cold adjustment is **actively hurting** ATS predictions.

The original "model change protocol" deferral language in the PR #63 commit was a council-discipline tell that the proponent didn't trust the single-snapshot estimate enough to ship it unconditionally. That instinct was correct.

## Re-scoped debt #22

**Old framing**: NBA `cold_coef` 0.5 → 0.92. Council impl-review the change.

**New framing**: streak-adjustment methodology robustness study, multi-sport.

Specifically, before any coefficient change ships, this debt needs:

1. **Bootstrap CI on the empirical estimates per sport.** The current script reports point estimates. A 95% CI gives the council a concrete sense of how stable each estimate is. If NBA `cold_coef` has CI like `[0.5, 3.5]`, even the in-code `0.5` is inside the CI and "no change" is a defensible council outcome.
2. **Cross-window stability check.** Re-run on a series of historical end-dates (e.g., end-of-each-season since 2019) to see if the empirical coefficient is drifting over time, snapshot-dependent, or stationary. If drift is real, a fixed coefficient is the wrong abstraction — we'd want a rolling re-estimate or a different model form (e.g., a regression on streak length rather than a binary >=3-cold threshold).
3. **Per-sport gate.** Sports with negative empirical coefficients (MLB, NHL today) need either: (a) the cold-streak adjustment removed for that sport (`coef = 0`), or (b) a positive-direction explanation for the negative empirical (e.g., regression-to-mean dominates the cold-streak signal for those sports).
4. **Methodology audit.** Why does N_all change between snapshots? Is the script joining tables differently than expected? Is `game_results` being pruned somewhere? Does it depend on a derived column like `home_win IN (0,1)` that has hidden null behavior?

Items 1-2 are quantitative work. Item 3 requires per-sport reasoning. Item 4 is a debugging audit.

## Plans/* anchor

Debt #22 should be moved out of the BACKLOG snapshot table and into a `Plans/streak-adjustment-recalibration.md` plan file, with the four work-items above as the implementation sequence. That plan needs a council plan-review (pm.7 + pm.8 apply) before any code is written — including methodology code, not just the eventual coefficient change.

## What this PR ships

- This document: `docs/debt-22-recalibration-findings.md`.
- BACKLOG.md edit: move debt #22 out of "open debts (compact snapshot)" and into "Now (this week's actionable work)" as the reframed methodology study. Reword the entry to reflect the actual scope.
- **Zero source-code changes.** `src/analysis/predict.ts:358` stays at `0.5` for NBA cold_coef. No production behavior change.

## Council framing

Council impl-review on this PR is reviewing the **finding + reframing**, not a coefficient change. Expected outcome: CLEAR or WARN with mitigations on the reframing itself; the actual coefficient change is a future PR that depends on the Plans/* anchor being drafted, council-CLEAR'd, and executed.

## What this PR does NOT do

- Does NOT change `cold_coef` or `hot_coef` in code.
- Does NOT change `src/analysis/predict.ts` or any production prediction path.
- Does NOT propose values for the eventual coefficient change — that requires the methodology work above first.
- Does NOT modify Phase 7 / NBA learned-model work.
- Does NOT touch the 2024-regular sealed test fold.
- Does NOT mark debt #22 closed. It is still open, just reframed.
