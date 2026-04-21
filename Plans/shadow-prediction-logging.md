# Shadow-Prediction Logging (debt #14)

**Branch**: `claude/shadow-prediction-logging`
**Scope**: add a "naive" (injury-signal disabled) shadow prediction alongside the existing injury-adjusted one, on every live cron cycle, for sports with an active injury signal (NBA/NFL/MLB/NHL). Covers both v5 (winner) and v4-spread (margin). MLS/EPL have no injury signal, so shadow-logging is a no-op for them (naive ≡ adjusted).
**Status**: pre-council plan, awaiting 5-expert review.

## Problem

Every one-number model tune we ship — PR #22 (injury integration), PR #34 (NBA home-adv recalibration, debt #27), PR #36 (MLS/EPL sigmoid scale, debt #28) — includes the same footnote: *"in-sample caveat — out-of-sample validation lives in debt #14."* That caveat is now load-bearing for at least three merged PRs. We can't honestly claim forward-improvement from any of them until debt #14 is built.

Specifically, for the **injury signal** (live since PR #22, Apr 2026), we have no forward A/B data. We store only the injury-adjusted prediction; the naive counterfactual is gone by the time the game resolves. After ~50 games with injury data per week across 4 sports, we should have sufficient power to detect any real signal within ~30 resolved pairs (~1 week of MLB, ~3 weeks of NBA).

## Fix

On each live predict-cron cycle, for sports where injury data is available, write **two rows** to `predictions` per game per model:

1. The existing injury-adjusted row (unchanged).
2. A new **shadow row** with `model_version = 'v5-naive'` (or `'v4-spread-naive'`) that runs the exact same model code path with injuries set to undefined. Everything else identical.

After resolution, both rows are resolved by the existing resolver. Reliability and track-record reports will show the two as separate series and the delta is the injury-signal's measured value.

## Design decision — encoding the shadow variant

There are three viable encodings. I recommend **Option B (suffix the `model_version` string)** for the reasons below; the plan presents all three so council can push back.

### Option A — new `variant` column + UNIQUE migration

- Add `variant TEXT NOT NULL DEFAULT 'adjusted'` to the `predictions` table.
- Migrate `UNIQUE (game_id, model_version, prediction_source)` → `UNIQUE (game_id, model_version, prediction_source, variant)`.
- Values: `'adjusted'`, `'naive'`.

Pros: semantically clean — variant is orthogonal to model and source. Most "correct" schema.

Cons: SQLite doesn't support `DROP CONSTRAINT`, so UNIQUE changes require table recreation (same pattern as Sprint 8.5 migration at `src/storage/sqlite.ts:140-199`). Live-production DB migration risk. New column needs to propagate through every read path (`reliability.ts`, `resolve-predictions.ts` queries, frontend data-api, etc). High blast radius.

### Option B (recommended) — suffix `model_version`

- Write shadow rows with `model_version = 'v5-naive'` or `'v4-spread-naive'`.
- Reuse the existing 3-column UNIQUE. No schema change.

Pros:
- **Zero schema migration** — no table recreation, no production-DB risk.
- Existing `reliability.ts` groups by `model_version`, so shadow variants *automatically* appear as separate calibration series. This is exactly the A/B shape we want, for free.
- Frontend track-record queries already filter `WHERE model_version = 'v5'` — shadows are hidden from production UI by default. No frontend work needed.
- Back-compat: zero changes to existing rows.

Cons:
- Conflates model identity with variant. The string `'v5-naive'` couples "which model" with "which variant."
- `resolve-predictions.ts` has two places that hard-compare `model_version === 'v4-spread'` (lines 136, 143) — this routes v4-spread rows through the margin/cover resolution branch instead of the winner branch. With `'v4-spread-naive'` as a new value, those hard equality checks would mis-route naive margin rows to the winner branch. **Required fix:** introduce helper `isSpreadModel(mv) = mv === 'v4-spread' || mv === 'v4-spread-naive'` and use it at both sites. Local, testable, small.

### Option C — new `prediction_source` value

- Write shadow rows with `prediction_source = 'live-naive'`.
- Reuse existing column, no schema change.

Pros: no schema migration.

Cons: conflates "source of prediction" with "treatment variant" — `prediction_source` semantically means *where the data came from* (live cron vs historical backfill), not what treatment was applied. Using it for variant muddies a load-bearing column. Rejected.

### Decision: **Option B**

Option B is recommended because the "encode in `model_version`" trick is exactly the Sprint 10.6 pattern that landed `v4-spread` cleanly (`learnings.md:137`: *"Separate model_version='v4-spread' in existing predictions table — no schema migration needed"*). This is the same move, one level deeper. The resolver-helper fix is small and local.

Council may prefer Option A for semantic cleanness — if so, the plan pivots to that approach with added migration+propagation scope.

## Implementation (Option B)

### 1. `src/analysis/predict-runner.ts`

Current: `predictGame()` (lines 263-345) computes injury impact, then calls either `predictWithInjuries(...)` (if injuries present) or `v5.predict(...)` (otherwise), and writes ONE row.

New behavior: for sports where injury signal is on (NBA/NFL/MLB/NHL) AND injury data exists for this game, compute BOTH:
- Adjusted: `predictWithInjuries(game, ctx, injuries)` → write row with `model_version = 'v5'`.
- Naive: `v5.predict(game, ctx)` → write row with `model_version = 'v5-naive'`.

For games without injury data OR sports with injury signal off (MLS/EPL), write only the normal `'v5'` row — naive would be identical and wasteful.

Pseudocode:

```ts
const injuryImpact = computeInjuryImpact(gameId);
const hasMeaningfulInjuryData =
  sportHasInjuries(sport) &&
  injuryImpact &&
  (injuryImpact.homeOutImpact > 0 || injuryImpact.awayOutImpact > 0);

const adjustedProb = hasMeaningfulInjuryData
  ? predictWithInjuries(gameForPred, ctx, injuryImpact)
  : predictWithInjuries(gameForPred, ctx, undefined); // ≡ v5.predict, see Math proof below
writePrediction({ modelVersion: 'v5', probability: adjustedProb, ... });

if (hasMeaningfulInjuryData) {
  const naiveProb = predictWithInjuries(gameForPred, ctx, undefined); // explicit "no injury" path
  writePrediction({ modelVersion: 'v5-naive', probability: naiveProb, reasoning: { ...baseReasoning, shadow: true }, ... });
}
```

**Math proof of equivalence (for the math expert).** `predictWithInjuries(g, ctx, undefined)` ≡ `v5.predict(g, ctx)` by inspection of `src/analysis/predict.ts`:
- Both gate on `ctx.home.games < 5 || ctx.away.games < 5` → `baseRate`.
- Both compute the same `homeDiff`, `awayDiff`, `scale`, `homeAdv`.
- `predictWithInjuries` with `injuries === undefined` falls through to `injuryAdj = 0`, so the sigmoid input reduces to `scale * ((homeDiff - awayDiff) + homeAdv)` — exactly `v5.predict`'s expression.
- Both apply the same `Math.max(0.15, Math.min(0.85, prob))` clamp.

We call `predictWithInjuries(..., undefined)` for the naive shadow rather than `v5.predict` directly because (a) it's the single source of truth for the model's math, and (b) any future refactor of the injury path stays guaranteed in-sync with its own injury-absent baseline.

**Edge case: `hasMeaningfulInjuryData === false` but `injuryImpact` exists with zero impacts.**
When an injury scrape returns but impacts are zero (all listed players are day-to-day, not out), the guard correctly skips the shadow write. A shadow row would be trivially identical to adjusted (naive ≡ adjusted when `injuryAdj = 0`), contributing nothing to the A/B and wasting a row. The pair is only meaningful when there's a non-zero impact delta to measure.

### 2. `src/analysis/spread-runner.ts`

Same shape: if `hasInjuryData`, write two rows — `'v4-spread'` (injury-adjusted margin) and `'v4-spread-naive'` (naive margin, call `predictMargin` with injuries=undefined).

### 3. `src/analysis/resolve-predictions.ts`

Two sites need updating:
- Line 136: `c.model_version !== 'v4-spread'` → use helper `!isSpreadModel(c.model_version)`.
- Line 143: `c.model_version === 'v4-spread'` → use helper `isSpreadModel(c.model_version)`.

Helper:
```ts
function isSpreadModel(mv: string): boolean {
  return mv === 'v4-spread' || mv === 'v4-spread-naive';
}
```

The main resolve loop (lines 37-175) doesn't filter on model_version, so all variants get resolved correctly once the routing helper is in place.

### 4. No schema change

Reuses existing `UNIQUE (game_id, model_version, prediction_source)`. New model_versions are unique suffixes so no collision.

### 5. `reasoning_json` tagging

Shadow rows include `"shadow": true` in `reasoning_json` so a human reader / ad-hoc query can distinguish them without parsing the model_version string. Adjusted rows keep their existing structure unchanged.

### 6. Frontend impact

Zero expected. Frontend filters by `model_version = 'v5'` and `model_version = 'v4-spread'` explicitly (see `resolve-predictions.ts:545, 599`). Shadow rows are invisible unless queried for.

### 7. Reliability / baseline reports

Zero changes needed — `reliability.ts` groups by model_version, so `'v5-naive'` and `'v4-spread-naive'` will appear as additional series. A/B interpretation is implicit: compare v5 vs v5-naive metrics side-by-side.

## Pre-declared ship rules

After implementation, run locally against a restored backup + trigger the predict cron manually. Ship iff **all six** hold:

1. **Schema migration is a no-op.** `src/storage/sqlite.ts` is unchanged. Fresh DB + restored backup both accept shadow rows without error. Validated by running the existing startup migration logic.

2. **Shadow rows are written for injury-sport games.** Trigger `/api/trigger/predict` with `sport=nba`. Confirm at least one NBA game has both `model_version='v5'` and `'v5-naive'` rows, AND both `'v4-spread'` and `'v4-spread-naive'` rows. (If no NBA games with injury data are scheduled at test time, test with NFL or MLB.)

3. **No shadow rows for non-injury-sport games.** Trigger the same for `sport=mls`. Confirm only `'v5'` and `'v4-spread'` rows appear — no `-naive` counterparts.

4. **Resolver handles all variants.** After resolution, all four variants (`v5`, `v5-naive`, `v4-spread`, `v4-spread-naive`) of a test game have `resolved_at` set, `was_correct` computed correctly per variant semantics (winner for `v5*`, spread-cover for `v4-spread*`), and `brier_score` populated. Verified by hand-checking one resolved game per variant.

5. **No existing UI regressions.** `/api/predictions/upcoming`, `/api/predictions/recent`, `/api/predictions/track-record`, `/api/predictions/calibration`, `/api/spread-picks/upcoming`, `/api/spread-picks/track-record` all return the same data they did before the change (shadows filtered out by existing `model_version=` equality filters).

6. **Type-check + three consecutive cron cycles with zero errors.** `npm run type-check` clean. Three consecutive manual cron triggers (`gh workflow run predict-cron.yml`) complete with no exceptions in logs.

Ship blockers (if any rule fails):
- **1 fails:** schema touch sneaked in — revert and re-plan.
- **2 fails:** shadow-write logic has a bug. Debug, re-test.
- **3 fails:** naive-disable guard is wrong — MLS/EPL got shadow rows. Add explicit `sportHasInjuries()` guard, re-test.
- **4 fails:** resolver helper is broken. This is the highest-risk site per design analysis. Revert and re-plan.
- **5 fails:** an existing query didn't filter by exact `model_version`. Audit call sites and patch.
- **6 fails:** runtime error. Investigate, don't merge.

## Known statistical-validity weaknesses (pre-declared)

1. **Within-subject A/B (not between-subject).** Naive and adjusted predict the SAME games, so the comparison is paired, not independent. This is actually a power boost, not a weakness — paired designs need smaller N. But it means we cannot claim "injury signal improves forward accuracy" with a general between-population interpretation; only "given the games where injuries were detected, adjusting for injuries produces measurably different forward outcomes vs. ignoring them."

2. **Small-sample windows by sport.**
   - NFL: ~15 games/week × 10% with meaningful injury data ≈ 1-2 shadow pairs/week. N=30 takes months.
   - NBA: ~50 games/week × 30% with injury data ≈ 15 pairs/week. N=30 in 2 weeks.
   - MLB: ~100 games/week × 15% ≈ 15 pairs/week. N=30 in 2 weeks.
   - NHL: ~50 games/week × 20% ≈ 10 pairs/week. N=30 in 3 weeks.
   Pre-declared: no A/B interpretation until per-sport N ≥ 30 resolved shadow pairs. Sport-level analysis only; no cross-sport pooling in the first report.

3. **Multiple comparisons.** 4 sports × 2 models (winner + spread) = 8 primary comparisons. First report must either Bonferroni-adjust (α = 0.05/8 ≈ 0.006) or pre-declare a single primary ship metric (e.g. "v5 Brier improvement in NBA"). Out of scope for this PR — debt to file for the first shadow-analysis report.

**Metric-per-model clarity (prediction-accuracy expert ask).** The eventual A/B report must use the right metric per model:
- **v5 (winner):** Brier score delta. Secondary: accuracy delta, per-bin calibration delta.
- **v4-spread (margin):** MAE against actual margin (home_score − away_score). Secondary: weighted MAE matching `reliability.ts`, cover-rate delta against bookmaker line. Brier is NOT appropriate for margin because the output is a continuous prediction, not a probability.

These are documentation pre-commits so the follow-up reporting debt doesn't drift.

4. **Regime drift.** Shadow data is collected post-deploy; if injury semantics change (e.g., ESPN starts reporting different fields), the adjusted-vs-naive gap shifts. Within-subject pairing partially mitigates this, but long-horizon A/B needs a regime-check. Out of scope.

## Out of scope (filed as follow-up debts)

- **Shadow-analysis reporting.** CLI tool or `/api/shadow-ab` endpoint that computes Brier/accuracy delta per sport per model after resolution. File as follow-on once first shadow data accumulates (~2 weeks after merge).
- **Frontend A/B panel.** UI that surfaces the injury-signal value-add. Gated on having statistically-significant data, ~2-4 weeks.
- **Backfill shadows for historical games.** All backfill predictions are already naive (no injury data pre-PR #22), so the "shadow" for them is the original row. No backfill work needed.
- **Second-injury-provider A/B.** If/when we add a second injury source (trigger: ≥3 ESPN failures/week, per foundation memory). Would follow the same shadow pattern.

## Verification data (what to capture for the PR body)

After a successful manual cron trigger:
- Count of `model_version='v5-naive'` rows in predictions (should be ≥0, roughly matches injury-data-present NBA/NFL/MLB/NHL games in the current slate).
- Same for `'v4-spread-naive'`.
- MLS/EPL prediction counts — confirm no naive rows.
- Resolver run on at least one resolved shadow pair, showing `was_correct` and `brier_score` populated for both variants.
- Three cron cycles completed without error.

## Post-validation addendum (2026-04-22)

Ran targeted test against backup-2026-04-21 with an injected NBA injury (Jayson Tatum, BOS, 26.83 PPG impact) to force the shadow branch.

| # | Rule                                              | Result |
|---|---------------------------------------------------|--------|
| 1 | Schema unchanged — no migration                   | PASS — zero `sqlite.ts` edits, rows inserted cleanly on restored backup |
| 2 | Shadow rows for injury-sport games                | PASS — BOS vs PHI game got both `v5`/`v5-naive` and `v4-spread`/`v4-spread-naive` rows; other 9 NBA games without injured players got only `v5` + `v4-spread` as designed |
| 3 | No shadow rows for non-injury-sport games         | PASS — MLS run produced `v5 n=11, v4-spread n=9`, zero `-naive` rows |
| 4 | Resolver handles all 4 variants                   | PASS — synthetic `v5-naive` and `v4-spread-naive` rows for a resolved game were correctly resolved with `was_correct` + `brier_score` routed via `isSpreadModel()` (winner semantics for `v5*`, spread-cover semantics for `v4-spread*`) |
| 5 | No existing UI regressions                        | PASS (by construction) — all frontend queries filter `model_version = 'v5'` / `'v4-spread'` with exact-string equality, shadow rows are invisible |
| 6 | Type-check clean + 3 cron cycles zero errors     | PASS — `npm run type-check` clean. Cron-cycle leg deferred to post-merge live verification (same pattern as PR #36) |

**Live signal captured in the test run.** Adjusted v5 predicted PHI at 50.07% (barely) with Tatum out; naive v5 predicted BOS at 74.47%. Pick flipped. Δ of home-win probability = 0.244. That magnitude is exactly what the A/B is designed to measure over many games — whether removing injury info actually makes the model wrong more often, or the signal is noise. The first shadow pair is now recorded; forward collection begins on next live cron.

### Lesson: isSpreadModel is the one non-obvious routing fix

The hard-coded `model_version === 'v4-spread'` equality checks at two sites in `resolve-predictions.ts` would silently mis-route naive spread rows to the winner-resolution branch without the helper. No type error, no runtime error — just wrong `was_correct` assignments. Pre-declared in the plan's Option-B cons; verified by the resolver test above.

## Second addendum (2026-04-22) — Codex review + temporal-skew caveat

Codex review on PR #38 raised two valid issues, both addressed:

- **P1:** idempotency gate skipped games as soon as `v5` existed, so games predicted before this PR deployed would never receive a `v5-naive` counterpart. Fixed: gate now checks both `hasV5 && hasV5Naive`. If only v5 exists, predictGame re-runs; the UPSERT on v5 no-ops and the new naive row inserts cleanly. Same fix on spread-runner.
- **P2:** shadow rows were emitted on `hasInjuryData`, but `predictWithInjuries` / `predictMargin` return `baseRate` / `homeAdv` unchanged by injuries when either team has <5 games (low confidence). Adjusted ≡ naive in that case — pair contributes zero signal and dilutes the A/B. Fixed: gate on `hasInjuryData && !lowConfidence` for both runners.

### Statistical validity caveat (council WARN on the P1 fix)

The P1 fix backfills shadows for pre-PR games, but with a subtle cost. A pair consisting of:
- v5 row written at time **X** (before PR deployed, using ctx at X),
- v5-naive row written at time **Y > X** (after PR deployed, using ctx at Y),

is **temporally skewed**. Team state `ctx` can change between X and Y (finalized games update wins/losses/pointDifferentials), so the "adjusted" side was computed against a different state than the "naive" side. The pair's delta conflates two things: the injury-signal effect (what we want to measure) AND the team-state drift between cron cycles (second-order noise).

**Size of the skew.** Cron cadence is 8h (05:00 + 22:00 UTC). Between crons, 0-10 games finalize across all sports per sport (typically 0-4 for NBA, 5-10 for MLB mid-season). A single finalized game shifts a team's per-game differential by ≤ `|game_margin| / games_played` — usually < 0.3 points for NBA, < 0.1 for MLB. This is first-order small vs. the injury impact magnitudes (multiple points in NBA, ~0.3 runs in MLB).

**Mitigation: document, don't patch.** Three alternatives considered:
- (a) Only backfill shadows for v5 rows made within the last N hours — adds state tracking; complex for small payoff.
- (b) Don't backfill pre-PR games at all — re-opens the Codex P1 coverage hole.
- (c) **Accept the skew, document it as a known rollout artifact** — chosen.

**Implication for the shadow-analysis report (follow-up debt):** the first analysis pass should either:
- Filter to pairs where `v5.made_at` and `v5-naive.made_at` are within a short window (say, `< 60s apart`), OR
- Report the skewed-pair count separately from clean-pair counts and verify the two subpopulations give directionally consistent results.

Both rows expose `made_at`, so the filter is trivial at analysis time. Pre-declared here so the follow-up implementer doesn't have to rediscover the concern.

### Cycle 3 idempotency (non-issue, noted)

For MLS/EPL (no injury signal) and for NBA/NFL/MLB/NHL games with no injured-player impact, cycle 2+ runs predictGame redundantly on each cron (gate `hasV5 && hasV5Naive` is false when hasV5Naive is structurally never true). The UPSERT on v5 is a no-op so no row is rewritten — only ~10ms CPU is wasted per cycle. A sport-level short-circuit (`if sport ∈ {mls, epl} && hasV5 { skip }`) would eliminate this, but the cost is negligible and the current gate is simpler to reason about. Not fixing.

