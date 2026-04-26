# Session Handoff

> **Purpose:** the very first thing a fresh session reads. Tight "Start here next session" block at the top. Everything below is historical log preserved for context.

---

## Start here next session — 2026-04-27 (Sprint 10.16)

**Current branch:** `claude/phase3-step3-game-type` (fresh from main, no commits yet).
**Main:** `6b21d42` — PR #51 squash-merged (all 6 pre-flight scripts + convention gate complete).
**Production state (Fly):** unchanged — app v57, 7,604 box-stat rows, `tov = totalTurnovers`, `team_tov` populated, audit PASS 0/0/0.

**Pre-flight gate status — ALL COMPLETE:**
- Gate A: `validate-bbref-convention.ts` — 8/10 strata ≥2 validated, 22 total matches, 1 known mismatch cup_knockout (nba:bdl-8258317 LAL/IND 2023-24 Cup Final, pre-existing from debt #35 → db:20 vs bbref:18)
- Gate B: `check-game-type-asymmetries.ts` — matrix in `docs/phase-3-game-type-handling.md`; cup_knockout mismatch flagged with pm.5 falsification on record
- Gate C: `falsify-cup-knockout-disposition.ts` — FALSIFIED (Δ Brier=0.0816, CI [0.0105, 0.1671]), disposition=accept-as-is
- Gate D: `v5-prediction-replay.ts` — 11/11 PASS
- Gate E: `feature-extraction-parity.test.ts` — phase placeholder; activates at Phase 3 step 4
- Gate F: `snapshot-prebackfill-db.sh` — ready; Supplementary Gate B fires it before any backfill
- Council 3rd gate (test/results): **CLEAR** avg 8.25/10 (DQ 8, Stats 8, Pred 8, Domain 9)
- `rescheduled_2022_23` stratum: intentional N/A — 2022-regular not in eligible DB window

**Next 1-2 actions (priority order):**

1. **Phase 3 step 3 — game-type metadata.** Council plan review needed before implementation. Proposed approach: (a) add `neutral_site` BOOLEAN to `nba_eligible_games` (populated from `data/cup-knockout-game-ids.json` — 14 known neutral-site Cup games); (b) document full `game_type` derivation rule in Python for training-tensor construction (avoid full schema migration for stratification-only metadata). Supplementary Gate B (pre-backfill snapshot) required before any DB write. Read `Plans/nba-learned-model.md` addendum v11 §"Phase 3 implementation sequence" step 3 + §"Supplementary Gate B" before starting.
2. **Phase 3 step 4 (next)** — feature-engineering pipeline: `ml/nba/features.py` + `src/ml/features.ts`. Step 4 starts ONLY after step 3 council plan clears.

**Key facts:**
- Cup-knockout disposition = **accept-as-is** (keep in training; FALSIFIED → don't drop). Phase 3 adds `neutral_site=1` for Cup SF/Final games to let model learn the adjustment.
- Play-in games are coded as `2024-regular` in BDL API (NOT postseason). Derivation rule must use date range + season code, not season code alone.
- `rescheduled_2022_23`: not in DB — skip this stratum in training-tensor construction.

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
