# Backlog

> **Living document.** Append, edit, reorganize freely. Sprint-by-sprint
> detail lives in `SESSION_LOG.md`; this file is the priority queue, debt
> snapshot, and idea bank. Update at session start (regenerate from
> `SESSION_LOG.md` + `git log` if stale) and at session end (when handing off).

Last regenerated: 2026-04-26 (post Sprint 10.13 — Phase 2 ship-claim earned).

## Where to start

Fresh session? Read in this order:

1. `CLAUDE.md` — durable operating rules (git hygiene, council discipline, no auto-PR, append-only plans, etc.).
2. The most recent **Remote Resume** block at the top of `SESSION_LOG.md`.
3. This file — for the active priority queue and the open-debts snapshot.
4. Any `Plans/*.md` referenced by the active priorities.

If `SESSION_LOG.md` "Last updated" is more than ~48 hours stale, regenerate
the Remote Resume + Next Session Pickup blocks from the Sprint-by-Sprint Log
+ `git log origin/main..HEAD` before trusting them. Same for this file —
treat the priority queue below as canonical only when its date is recent.

## Active priorities

### P0 — In flight

- **Open + merge debt-34 PR.** Branch `claude/debt-34-pass-b-c-prime` at
  commit `0890a62` is pushed to origin. Once merged, `main` advances and
  the Phase 2 ship-claim is reflected in canonical history.
  https://github.com/Anguijm/sportsdata/pull/new/claude/debt-34-pass-b-c-prime

### P1 — Up next

- **Phase 3 NBA learned-model plan draft.** Phase 2 is shipped; data is
  ready. Inherited Phase-3-plan-review items pinned across
  `Plans/nba-learned-model.md` addenda v6 / v7 / v8 / v9:
  - test-fold training-time filter (addendum v7 §7)
  - as-of-snapshot reproducibility (addendum v7 §8)
  - season-aggregate as 10th feature-form candidate (addendum v6)
  - multiple-comparisons mitigation on the 9-way grid selection
  - cron ordering: box-stats AFTER predictions (addendum v7 §12)
  - Wilson-CI guidance for small-N Rule 3 cells (addendum v8)
  - opp-* self-join feature-export pattern
  - **TOV scraper-convention decision (debt #35)** — pin player-summed
    vs total before training tensors are constructed
  - Council-CLEAR before any model code.
- **Debt #35 — ESPN TOV scraper-convention decision.** Hard prerequisite
  for Phase 3 (must pin convention before training tensors). Three paths:
  - (a) Switch scraper to `turnovers` (player-summed), re-backfill 7,604
    rows. Invisible to current shipped surfaces (no live consumer reads
    `possessions`).
  - (b) Keep `totalTurnovers` and document the divergence — Phase 3
    features then use a different convention than bbref's published rates.
  - (c) Compute both and let Phase 3's feature-engineering layer pick.

### P2 — Strategic / unblocked but lower urgency

- **Debt #26 — pre-2024 soccer match scrape.** Gating dependency for
  serious soccer-v2 (debts #24, #25). FBref or Understat. Medium infra
  lift. Independent of NBA work.
- **Debt #20 — historical odds ingest.** Unblocks v4-spread ATS backtest.
  Kaggle or paid feed.

### P3 — Held / gated

- **Debt #19 — second injury data provider.** Escalation trigger met
  (4+ days × 6+ predict crons with zero `home_out_impact` for
  NBA/MLB/NHL). User holding for strategic decision.
- **Debt #32 — shadow-analysis CLI.** Gated on N≥30 shadow pairs per
  (sport × model). Zero pairs accruing while ESPN injury feed is flat.
  Once flowing, ~2–3 weeks for NBA/MLB/NHL to accumulate; longer for NFL.

## Open debts (compact snapshot)

See `SESSION_LOG.md` "Council Debts (Open)" table for full descriptions
and source-sprint context. This is a quick scan only.

| # | Title | Priority | Notes |
|---|---|---|---|
| 1 | canonical_game_id schema migration | P0-deferred | Sprint 8.5 |
| 2 | MLB doubleheader handling | Pre-generalize | Sprint 8.5 |
| 3 | Test fixture covering both ID shapes | With #1 | |
| 4 | Vegas frontend rendering | Quick win | Sprint 8 deferred |
| 5 | Ratchet media query consolidation | Low | cosmetic |
| 6 | Player name line-wrap in ranked list | Low | cosmetic |
| 7 | eceHighConfOnly → shared computeECE helper | Low | refactor |
| 8 | Disable stale Cloudflare direct-git deploy source | Low | dashboard only |
| 9 | Seed-stability test for v2 winning margin | Low | |
| 10 | Train/test shaded regions on ratchet chart | Low | |
| 12 | v5 sigmoid scale CV on held-out data | HIGH | |
| 15 | v5↔v4-spread injury consistency check | Medium | |
| 16 | Position-weighted injury impact (QB 3x, star 1.5x, bench 0.5x) | Medium | biggest quality win |
| 17 | Min-impact threshold (skip < 2 units) | Low | refinement |
| 18 | Fit INJURY_COMPENSATION separately for margin vs winprob | Gated on N≥200 | |
| 19 | Second injury data provider | HELD | trigger met |
| 20 | Historical odds ingest | HIGH | unblocks ATS backtest |
| 22 | v4-spread streak adjustments not empirically calibrated | Medium | |
| 23 | Brier clamp for NHL/soccer | Low | |
| 24 | Dixon-Coles τ low-score correction | LOW | math-proven zero margin impact |
| 25 | Dixon-Coles ξ time-decay + MLE | HIGH | blocked on #26 |
| 26 | Pre-2024 soccer match scrape | HIGH | gating soccer-v2 |
| 29 | Ternary reliability for soccer Poisson | Low | gated on 1X2 |
| 30 | check-branch-not-merged false positive on chained commit+push | Low | workaround exists |
| 32 | Shadow-analysis CLI / endpoint | HIGH | gated on N≥30 pairs |
| 35 | ESPN TOV scraper-convention decision | MEDIUM | Phase 3 prerequisite |

Closed (recent): #11 (Sprint 10.8), #13 (PR #28), #14 (PR #38), #27 (PR #34),
#28 (PR #36), #31 (PR #44), #33 (PRs #42/#43/#45), **#34 (Sprint 10.13)**.

## Plans (active)

| File | Status | Notes |
|---|---|---|
| `Plans/nba-learned-model.md` | Phase 2 SHIPPED. Phase 3 plan-draft is the next gate. | Addenda v1–v9.2 are append-only history. |
| `Plans/nba-phase2-backfill.md` | Debt #33 plan, fully executed; closed. | Reference for backfill mechanics. |
| `Plans/soccer-poisson.md` (+ addendum) | Reference for debt #25/#26 work. | |
| `Plans/shadow-prediction-logging.md` | Reference for debt #14/#32 work. | |
| `Plans/nba-home-adv-recalibration.md` | Closed; debt #27 closure record. | |
| `Plans/mls-epl-sigmoid-scale.md` | Closed; debt #28 closure record. | |
| `Plans/reliability-diagrams.md` | Closed; debt #11 closure record. | |
| `Plans/sprint3-plan.md`, `Plans/goofy-wibbling-fern.md` | Historical artifacts. | |

## Daydreams / not-yet-prioritized

These are ideas that have surfaced but haven't been costed or scoped.
Move to "Active priorities" with a P0–P3 if/when they make the cut.

- **Player-based predictions** ("Does SGA score >30 tonight?") — needs a
  shotchart / per-game projection model on top of player stats.
- **Kaggle historical NBA import** (1946-present) — deeper findings,
  longer baselines, more N for any future learned model.
- **Headshots on hero cards** — UI polish, licensing/hosting complexity.
- **Schema migrations**: `last_updated_at` everywhere, `stat_category`
  enum normalization, JSON1 indexes on `player_stats`.
- **Phase 4+ NBA models** — once Phase 3 ships, what's next? Tree
  ensembles? Sequence models for recency? Player-aware features?
- **Cross-sport meta-learning** — does an MLB pitcher-strength prior
  generalize to NHL goalies? Probably not, but worth a thought.
- **Real-time prediction WebSocket** — push odds line-moves and
  prediction shifts to the frontend live.
- **Sportsbook arbitrage scanner** — pure data play, no modeling
  required; consume multiple odds feeds, detect mispriced lines.
- **Cup-format and play-in-tournament-aware features** — neutral-site
  characteristic isn't currently a feature in any model. Worth A/B-ing
  once Phase 3 is in motion.

## Cross-cutting reminders

These are codified elsewhere; restated here for skim-scan.

- **Council discipline is non-negotiable.** Plans, implementations, AND
  test/results all get reviewed. See `feedback_council_discipline.md`
  (memory) and `.harness/council/*.md` for personas.
- **Pre-declare ship rules** before any A/B or benchmark code is written.
  PR #29 (soccer Poisson null result) is the canonical example.
- **`Plans/*.md` are append-only** once council-CLEAR. Post-mortems
  append addenda; don't back-edit prior plan content.
- **`learnings.md` is append-only.** Add new entries at the bottom.
- **Don't auto-create PRs.** The user opens them. Pushing to a feature
  branch is fine; opening the PR is the gate.
- **Always go through a feature branch** (`claude/<topic-slug>`). Never
  push to main directly. The pre-push hook in `.claude/hooks/` blocks
  pushes to a branch that has no diff vs origin/main (signature of an
  already-merged squash).
- **Before any "what shipped" narrative**, run `git fetch origin main &&
  git log origin/main..HEAD` — local state is not authoritative.
- **`fly ssh -C` does NOT run through a shell.** Use `sh -c '...'`
  wrapper for any chained command.
