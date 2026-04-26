# Session Handoff

> **Purpose:** the very first thing a fresh session reads. Tight "Start here next session" block at the top. Everything below is historical log preserved for context.

---

## Start here next session — 2026-04-27 (Sprint 10.16+deploy)

**Current branch:** `main` at `70ac487`.
**Production state (Fly):** Phase 3 step 3 SHIPPED — `nba_neutral_site_games` table live, `nba_eligible_games` view updated, 6 neutral-site rows backfilled and confirmed. API healthy (21,819 games / 21,666 results).

**Phase 3 step 3 — SHIPPED (prod):**
- PR #52 merged at `c3b8e65` — game-type metadata: neutral_site flag + derivation rules
- Dockerfile updated: `COPY data/*.json ./data/` in both stages (note: shadowed by Fly volume; reference JSONs also uploaded to volume via sftp — see `DEPLOY.md §"Reference JSON files on the Fly volume"`)
- `ml/nba/game_type_rules.py`: 3802/3802 PASS. Distribution: regular=2962, cup_pool=658, cup_knockout=14, postseason=130, conference_finals=24, nba_finals=12, play_in=2
- Council plan CLEAR avg 9/10; impl CLEAR avg 8.75/10

**Next action:**

**Phase 3 step 4 — feature-engineering pipeline.** Implement `ml/nba/features.py` (rolling-window box-score features, neutral_site flag, game_type weights, sentinel imputation). **Council plan review required first.** Unit tests per addendum v11: `test_no_test_fold_in_training_tensor.py`, `test_as_of_filter_reproducibility.py`, `test_as_of_filter_completeness.py`, `test_time_machine_feature_purity.py`.

**Known limitations forwarded to step 4:**
- `cup_pool` overincludes (all Nov 4–Dec 3 regular-season games, not just Cup-designated). Same TOV convention → no model impact.
- `play_in`: only 2 confirmed IDs in manifest; earlier-season play-in classified as `regular`. Non-blocking.
- `conference_finals` boundary (May 18): some conference-semi game 7s may be misclassified. Step 4 can refine.
- `rescheduled_2022_23`: not in DB — skip this stratum.

**Pre-session context to read** (in order):
1. This file (you're already here).
2. `BACKLOG.md` "Now" section.
3. `Plans/nba-learned-model.md` addendum v11 §"Phase 3 implementation sequence" (steps 4–10).

---

## Historical session log

Older session-end states are preserved below. Most recent at top.

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
