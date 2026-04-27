# Session Handoff

> **Purpose:** the very first thing a fresh session reads. Tight "Start here next session" block at the top. Everything below is historical log preserved for context.

---

## Start here next session — 2026-04-27 (Sprint 10.17 — Phase 3 step 4)

**Current branch:** `claude/phase3-step4-features` (PR open, not yet merged).
**Production state (Fly):** Phase 3 step 3 SHIPPED — `nba_neutral_site_games` table live, `nba_eligible_games` view updated, 6 neutral-site rows backfilled and confirmed. API healthy.

**Phase 3 step 4 — COMPLETE (pending merge):**
- Branch: `claude/phase3-step4-features`
- `ml/nba/features.py` (new, ~870 lines): rolling-window box-score features, 42-feature tensor, `build_training_tensor()`, `build_live_tensor()`, sentinel TOV imputation, rate/count/unbounded normalization, NaN→0.0 (mean imputation in normalized space)
- 5 unit tests (all PASS): `test_no_test_fold_in_training_tensor.py`, `test_as_of_filter_reproducibility.py`, `test_as_of_filter_completeness_behavioral.py`, `test_as_of_filter_completeness_structural.py`, `test_time_machine_feature_purity.py`
- Tensor: 2640 games, 42 features, home_win=54.6%, NaN=0, mean≈0, std≈1
- Plans/nba-learned-model.md: addendum v12 appended (R1 plan WARN→CLEAR avg 6.6/10; Gate 2 impl WARN→CLEAR avg 7.0/10 after 2 blocking bugs fixed)
- Gate 2 bug fixes: `rest_days_in_last_7` month-boundary arithmetic (→ timedelta), NULL tov pre-pass in `_impute_sentinel_tov`

**Next action:**

**Phase 3 step 5 — Inner-CV training infrastructure.** Implement `ml/nba/train_lightgbm.py`, `ml/nba/train_mlp.py`, 10-candidate feature-form grid, forward-chaining 5-fold CV. **Council plan review required first** (plan gate before any code). See addendum v12 §"Phase 3 implementation sequence" (steps 5–10).

**Known limitations forwarded from step 4:**
- `cup_pool` overincludes (all Nov 4–Dec 3 regular-season games, not just Cup-designated). Same TOV convention → no model impact.
- `play_in`: only 2 confirmed IDs in manifest; earlier-season play-in classified as `regular`. Non-blocking.
- `conference_finals` boundary (May 18): some conference-semi game 7s may be misclassified. Step 5 can refine if needed.
- `rescheduled_2022_23`: not in DB — skip this stratum.

**Pre-session context to read** (in order):
1. This file (you're already here).
2. `BACKLOG.md` "Now" section.
3. `Plans/nba-learned-model.md` addendum v12 §"Phase 3 implementation sequence" (steps 5–10).

---

## Historical session log

Older session-end states are preserved below. Most recent at top.

### 2026-04-27 — Sprint 10.17 — Phase 3 step 4 (feature-engineering pipeline)

**What shipped:**
- `ml/nba/features.py` (new, ~870 lines): `build_training_tensor()`, `build_live_tensor()`, 42-feature rolling-window tensor. Rate/count/unbounded normalization. NaN→0.0 mean imputation. Sentinel TOV imputation. Opponent-adjusted Net Rating (two-pass). `is_denver_home` + `neutral_site` game-level flags.
- 5 unit tests: test_no_test_fold (2640 games, 0 violations), test_reproducibility (bit-identical), test_completeness_behavioral (1812→2640 strict ordered superset), test_completeness_structural (4 SQL statements, all filtered/attested), test_time_machine_purity (42 features, 0 NaN, bit-identical).
- `Plans/nba-learned-model.md`: addendum v12 appended (plan gate + impl gate; 2 blocking bugs fixed — timedelta month-boundary, NULL tov pre-pass).
- Branch: `claude/phase3-step4-features` (PR open, pending merge).

**Lessons codified:**
- f-string SQL constants split by Python AST → structural SQL test misses `updated_at` filter inside the f-string. Fix: module-level SQL string constants with `.format(placeholders=...)`.
- NaN raw → 0.0 in pre-normalization space creates extreme negative normalized values. Fix: fit on finite values only, then set NaN positions to 0.0 in normalized space (mean imputation).
- `target_d.replace(day=max(1, target_d.day - 7))` is wrong for days 1–7 of month. Fix: `timedelta(days=7)`.

### 2026-04-27 — Sprint 10.16 + Phase 3 step 3 deploy

**What shipped:**
- PR #51 merged at `6b21d42` (Sprint 10.16): all 6 pre-flight scripts + convention gate. Convention validator 8/10 strata PASS. Falsification (pm.5) FALSIFIED Δ=0.0816. v5 replay 11/11 PASS.
- PR #52 merged at `c3b8e65` (Phase 3 step 3): `nba_neutral_site_games` table, updated `nba_eligible_games` view with `neutral_site`, `ml/nba/game_type_rules.py` (3802/3802 PASS), `scripts/backfill-neutral-site.ts`.
- Fix commit `f21fbd2`: Dockerfile updated to include `data/*.json` in image.
- Fix commit `70ac487`: `DEPLOY.md` updated — Fly volume shadowing note + sftp upload procedure.
- Production: deployed, neutral-site backfill complete (6 rows), API healthy.

**Lessons codified:**
- Fly volume at `/app/data` shadows Docker image's `data/` layer. Reference JSON files (cup-knockout-game-ids.json, bbref-convention-manifest.json) must be explicitly uploaded to the volume via `fly sftp shell` before any on-Fly script that reads them.

### 2026-04-26 — Sprint 10.14 + Phase-3-plan-draft (this session)

**What shipped:**
- PR #48 — `debt(#35): close as option-b — v10 forward-and-rollback cycle`. Merged at `7313bc3`. Closes debt #35 after a complete forward (player-summed convention switch with full council process + Fly backfill) and rollback (audit failure → revert + rescrape). Post-mortem council 2 rounds, R2 5/5 CLEAR avg 9.6/10. Documented Cup-knockout convention asymmetry as <0.18% bias forwarded to Phase 3.
- PR #49 — `plan(phase-3): addendum v11 council-CLEAR (Phase 3 plan-draft)`. Merged at `525bc4d`. Plan-draft only (no model code). Integrates ~20 forwarded items from addenda v6/v7/v8/v9/v10/post-mortem. R2 5/5 CLEAR avg 9.4/10. 4 supplementary ship-rule gates pinned. 10-step gating sequence pinned. 6 pre-flight scripts gated to land BEFORE any model code.

**Lessons codified (see learnings.md):**
- Single-game empirical checks are insufficient for R2 reversals of council expert priors.
- Pre-backfill DB snapshot is mandatory for any production-data irreversible operation.
- Stratified-bbref-validation regression harness pattern for any future TOV-related model-affecting backfill.
- pm.5 (dissenter-named falsification test) + pm.6 (≥2/stratum + ≥5 total + adversarial selection) — both validated within addendum v11's own R1→R2 cycle.

### 2026-04-26 (earlier) — Sprint 10.13 (Phase 2 ship-claim EARNED)

**What shipped:**
- PR #47 — debt #34 close (Phase 2 cross-source audit Pass-B with C′ disposition). Merged at `ce13e31` 2026-04-25 23:05 UTC. Pass-B verdict PASS at N=50 (0/0/0). All 5 Phase 2 ship rules satisfied.

### 2026-04-25 — Sprint 10.12

**What shipped:**
- PRs #42, #43, #45 (debt #33 work — Phase 2 backfill, coverage views, recheck script, cross-source audit script).
- PR #46 (handoff doc + session log refresh).

(Older entries preserved in `SESSION_LOG.md` Sprint-by-Sprint Log.)
