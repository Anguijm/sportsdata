# Session Handoff

> **Purpose:** the very first thing a fresh session reads. Tight "Start here next session" block at the top. Everything below is historical log preserved for context.

---

## Start here next session — 2026-04-27 (Sprint 10.16)

**Current branch:** `claude/phase3-step3-game-type` at `8e90016`. PR not yet created.
**Main:** `6b21d42` — PR #51 squash-merged (Sprint 10.16).
**Production state (Fly):** unchanged — app v57, 7,604 box-stat rows. Step 3 DB changes local only; deploy + remote backfill pending.

**Phase 3 step 3 — COUNCIL-CLEAR + IMPLEMENTED (local):**
- `nba_neutral_site_games` table: 6 Cup SF/Final game IDs (Las Vegas neutral-site)
- `nba_eligible_games` view: updated with `neutral_site` column (LEFT JOIN)
- `ml/nba/game_type_rules.py`: Python derivation rules; 3802/3802 classified
- `ml/nba/test_game_type_classification_complete.py`: PASS
- `scripts/backfill-neutral-site.ts`: PASS (6 rows verified)
- v5 replay: 11/11 PASS (view migration backward-compatible)
- Council plan: CLEAR avg 9/10; council impl: CLEAR avg 8.75/10
- Snapshot: `data/snapshots/sportsdata-prebackfill-20260426T214309Z.db`

**Next 1-2 actions (priority order):**

1. **Open PR for step 3 + deploy.** Create PR from `claude/phase3-step3-game-type`. After merge to main: deploy to Fly (migration fires on app restart), then run `npx tsx scripts/backfill-neutral-site.ts` via fly ssh console for production backfill.
2. **Phase 3 step 4 — feature-engineering pipeline.** Implement `ml/nba/features.py` (rolling-window box-score features, neutral_site flag, sentinel imputation). Council plan review required first. Unit tests per plan addendum v11.

**Known limitations forwarded to step 4:**
- `cup_pool` overincludes (all Nov 4–Dec 3 regular-season games, not just Cup-designated). Same TOV convention → no model impact.
- `play_in`: only 2 confirmed IDs in manifest; earlier-season play-in classified as `regular`. Non-blocking.
- `conference_finals` boundary (May 18): some conference-semi game 7s may be misclassified. Step 4 can refine.
- `rescheduled_2022_23`: not in DB — skip this stratum.

**Pre-session context to read** (in order):
1. This file (you're already here).
2. `BACKLOG.md` "Now" section.
3. `learnings.md` `phase3-preflight-scripts` entry (last ~60 lines).
4. `Plans/nba-learned-model.md` addendum v11 §"Pre-flight tooling" + §"Phase 3 implementation sequence".

---

## Historical session log

Older session-end states are preserved below. Most recent at top.

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
