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

## Root cause: debt #1 (canonical_game_id) is unresolved (revision 2026-05-28b)

Cross-snapshot inspection found the actual source of instability. Production has **two scrapers writing the same physical NBA games as separate rows**, with non-overlapping `game_id` namespaces and distinct season strings:

| Scraper | game_id format | Season value (NBA 2023-24) | NBA 2023-24 row count |
|---|---|---|---|
| ESPN | `nba:401591869` | `'2023-24'` | 1,395 |
| BDL | `nba:bdl-1037593` | `'2023-regular'` + `'2023-postseason'` | 1,237 + 82 = 1,319 |

Same games, same teams, same dates — two row sets with **zero overlap on `game_id`**. The validate-debt22.py script counts both row sets as independent entries when replaying team game-history. Every NBA team's history double-counts each game, every 3-game cold streak gets identified ~2× (once per scraper namespace), and the resulting cold_coef estimate is distorted upward.

Cross-source `N_all` comparison:

| Source | NBA games | NBA cold_coef |
|---|---|---|
| LOCAL DB (May 24, BDL-only, single namespace) | 8,699 | 0.922 |
| PROD DB (May 28, ESPN + BDL dual-namespace) | 7,887* | 2.227 |
| April snapshot (smaller dataset, dual-namespace already present) | 3,738 | 0.515 |

*Prod has fewer NBA games than local because local picked up Path A 2021/2022 BDL backfill but Path A code/data never deployed to Fly (those are pure local-dev artifacts). Prod still has the ESPN-namespace 2023-25 dual-counting.

**This is debt #1** — `canonical_game_id schema migration` — flagged in BACKLOG as `P0-deferred, Sprint 8.5`. It has been deferred for ~5 months. The original Sprint-8.5-era impact assessment did not account for downstream effects on empirical-calibration analyses like debt #22; this PR is the first concrete evidence that debt #1 has a load-bearing downstream consequence.

**The methodology instability the council's DQ FAIL flagged is correct — and the actual fix is at debt #1, not at the validate-debt22.py script (which is doing the right thing on the data it was given). Debt #22 is downstream-blocked on debt #1.**

## Why this matters for the ship decision

Shipping `0.5 → 0.92` today would lock in a number from a moment-in-time that the data has since moved away from. The next snapshot may report a different empirical value again, and we'd be repeating this loop. Worse: shipping the NBA-only `0.92` while ignoring the negative MLB/NHL coefficients silently keeps `cold_coef = 0.5` for sports where the cold adjustment is **actively hurting** ATS predictions.

The original "model change protocol" deferral language in the PR #63 commit was a council-discipline tell that the proponent didn't trust the single-snapshot estimate enough to ship it unconditionally. That instinct was correct.

## Re-scoped debt #22

**Old framing**: NBA `cold_coef` 0.5 → 0.92. Council impl-review the change.

**Revised framing (after root cause)**: debt #22 is downstream-blocked on debt #1 (canonical_game_id schema migration). The streak-adjustment recalibration cannot produce stable estimates while the games table has two non-overlapping ID namespaces for the same physical games. Resolving debt #1 unblocks debt #22; not resolving debt #1 means any debt #22 work stays inside the dual-namespace distortion.

Two possible paths forward, depending on which debt the user prioritizes:

### Path A — resolve debt #1 first, then debt #22

1. Draft `Plans/canonical-game-id-migration.md` per Sprint-8.5-era issue. Plan-review council.
2. Implement: add `canonical_game_id` column, populate via `(sport, date, home_team_id, away_team_id)` natural key, dedupe games with multiple namespace rows.
3. Cascade: update `game_results`, `nba_game_box_stats`, `predictions`, `nba_eligible_games` view, etc. to reference the canonical key.
4. Once unified, re-run validate-debt22.py. Methodology robustness work (items below) becomes meaningful.

### Path B — script-side dedupe as interim mitigation

Add a dedupe pass to `scripts/validate-debt22.py`: collapse `(sport, date, home_team_id, away_team_id)` to a single team-history entry. This works around the dual-namespace issue WITHOUT solving debt #1. Caveat: every downstream analysis that uses `games` joins is similarly distorted (e.g., the Phase 3-7 NBA learned model work probably has the same issue — though Phase 7 used a season-filter that may have avoided cross-namespace double-counting).

### Methodology robustness items (still needed after either Path)

After debt #1 (or interim dedupe) lands, the following work remains:

1. **Bootstrap CI on the empirical estimates per sport.**
2. **Cross-window stability check** (re-run on a series of historical end-dates).
3. **Per-sport gate** for sports with negative empirical (MLB, NHL today, even after dedupe — those negatives may be real, not artifactual).
4. **Methodology audit** — once debt #1 lands, re-verify N_all is now stable across snapshots taken on different dates.

## Plans/* anchor

The methodology work above should be tracked in a `Plans/streak-adjustment-recalibration.md` plan file (post debt #1 resolution OR post script-side dedupe). The plan needs a council plan-review (pm.7 + pm.8 apply) before any code is written — including methodology code, not just the eventual coefficient change.

## What this PR ships

- This document: `docs/debt-22-recalibration-findings.md`. Updated 2026-05-28b with root-cause finding (debt #1 dual-namespace IDs).
- BACKLOG.md edit: debt #22 reframed in "Now" with the debt-#1 dependency made explicit.
- **Zero source-code changes.** `src/analysis/predict.ts:358` stays at `0.5` for NBA cold_coef. No production behavior change.

## Council framing (revision after R1 FAIL)

Round 1 council on this PR (Gemini, 2026-05-28) returned FAIL 4/10 — the hard rule "any DQ FAIL → FAIL" fired correctly on the unexplained N_all instability between snapshots. The DQ finding was correct; the inferred cause (script methodology problem) was incomplete — the actual cause is upstream at the data layer (debt #1).

The revision in this commit adds the root-cause finding **and acknowledges that debt #22 is downstream-blocked on debt #1**. The "ship 0.92" recommendation is even more clearly stale than the round-1 framing suggested: not just unstable, but unstable BECAUSE of a known-but-deferred architectural debt.

Expected R2 council disposition: CLEAR or WARN on the revised framing. The next concrete action item moves to **debt #1** (canonical_game_id migration), not to a debt-#22-internal methodology study.

## What this PR does NOT do

- Does NOT change `cold_coef` or `hot_coef` in code.
- Does NOT change `src/analysis/predict.ts` or any production prediction path.
- Does NOT propose values for the eventual coefficient change — that requires the methodology work above first.
- Does NOT modify Phase 7 / NBA learned-model work.
- Does NOT touch the 2024-regular sealed test fold.
- Does NOT mark debt #22 closed. It is still open, just reframed.
