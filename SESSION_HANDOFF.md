# Session Handoff

> **Purpose:** the very first thing a fresh session reads. Tight "Start here next session" block at the top. Everything below is historical log preserved for context.

---

## Start here next session — 2026-04-26 end-of-session

**Current branch:** `main` at `525bc4d` (all session work merged).
**Last-merged PRs this session:** #48 (debt-35 close, `7313bc3`) + #49 (Phase-3-plan-draft, `525bc4d`).
**Production state (Fly):** app v57, 7,604 box-stat rows, `tov = totalTurnovers`, `team_tov` column populated, audit PASS at 0/0/0.

**Next 1-2 actions (priority order):**

1. **Phase 3 step 1 — pre-flight tooling batch.** 6 scripts must land BEFORE any model code per addendum v11 §"Phase 3 implementation sequence (gating plan)" (Plans/nba-learned-model.md, ~last 200 lines). Council impl-review on the batch before proceeding to step 2. Scripts:
   - `scripts/validate-bbref-convention.ts` (≥20 games × 10 strata + 4 sentinel game_ids re-probe)
   - `scripts/v5-prediction-replay.ts` + `data/v5-replay-fixtures.json` + `data/v5-replay-expected.json`
   - `scripts/snapshot-prebackfill-db.sh`
   - `scripts/falsify-cup-knockout-disposition.ts` (Domain's named falsification test per pm.5)
   - `scripts/check-game-type-asymmetries.ts` (depends on validate-bbref-convention output)
   - `scripts/feature-extraction-parity.test.ts` (Python ↔ TS parity scaffolding)
2. **(Adjacent) Council-process docs.** v11 codified pm.5 + pm.6 rules in the addendum body but `.harness/council/` doesn't yet have a README consolidating them. Land that as a small commit alongside or before #1.

**Blockers:** none. Phase 3 implementation is fully unblocked per addendum v11 §"R2 verdicts" (5/5 CLEAR avg 9.4/10).

**Pre-session context to read** (in order):
1. This file (you're already here).
2. `BACKLOG.md` "Now" section.
3. `Plans/nba-learned-model.md` addendum v11 (most recent ~330 lines).
4. `learnings.md` Sprint 10.14 + phase-3-plan-draft entries (last ~150 lines).

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
