# Session Handoff

> **Purpose:** the very first thing a fresh session reads. Tight "Start here next session" block at the top. Everything below is historical log preserved for context.

---

## Start here next session — 2026-04-27 end-of-session

**Current branch:** `claude/phase3-preflight-1-3` at `6c8be25`. PR #51 open — not yet merged.
**Main:** `525bc4d` (unchanged from 2026-04-26 — PR #51 not merged yet).
**Production state (Fly):** unchanged — app v57, 7,604 box-stat rows, `tov = totalTurnovers`, `team_tov` populated, audit PASS 0/0/0.

**Next 1-2 actions (priority order):**

1. **Council results gate (3rd gate) on PR #51 pre-flight scripts.** Run the council test/results review on the actual run outputs: v5 replay 11/11 PASS, falsification test FALSIFIED (Δ Brier=0.0816, CI [0.0105, 0.1671], evidence at `docs/cup-knockout-disposition-evidence.md`). Convention validator output is not yet available (manifest TODO entries need populating first — see action 2). Review what exists now; note convention gate as pending. Once council clears, merge PR #51.
2. **Populate manifest TODO entries + run convention scripts.** `data/bbref-convention-manifest.json` has TODO entries in strata: `play_in` (2), `cup_pool` (2), `cup_knockout` (2), `conference_finals` (1), `nba_finals` (1), `marquee_broadcast` (1), `rescheduled_2022_23` (2), `ot` (2). Each TODO entry has a SQL query in the `note` field to find the missing game IDs. Once manifest is populated: run `validate-bbref-convention.ts` → produces `data/bbref-convention-report.json` → run `check-game-type-asymmetries.ts` → produces `docs/phase-3-game-type-handling.md`. Commit both outputs. Then the full council results gate can run.

**Blockers:** Convention scripts blocked on manifest population (needs DB queries). Gate A (`validate-bbref-convention.ts`) requires ≥2 validated games per stratum to exit 0.

**Key facts from this session:**
- pm.5 falsification test result: Δ Brier = 0.0816 > 0.02 → **FALSIFIED**. Cup-knockout disposition = **accept-as-is** for Phase 3. Mechanism: v5's neutral-site blind spot (applies 2.25pt home-adv to "home" team even at T-Mobile Arena). Phase 3 ML model should add `neutral_site` binary feature.
- All 6 pre-flight scripts implemented, council impl-reviewed, run-verified.

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
