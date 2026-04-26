# Backlog

> **Living document.** Append, edit, reorganize freely. Sprint-by-sprint
> detail lives in `SESSION_LOG.md`; tight session-pickup state lives in
> `SESSION_HANDOFF.md`; this file is the priority queue + idea bank.
> Update at session start (regenerate from `SESSION_LOG.md` + `git log` if
> stale) and at session end (when handing off).

Last regenerated: 2026-04-27 (post Sprint 10.15 — all 6 pre-flight scripts on branch `claude/phase3-preflight-1-3`, PR #51 open).

## Where to start

Fresh session? Read in this order:

1. `SESSION_HANDOFF.md` — tight "Start here next session" block at the top.
2. `CLAUDE.md` — durable operating rules.
3. This file — priority queue + open-debts snapshot.
4. Any `Plans/*.md` referenced by the active priorities (Phase 3: addendum v11 in `Plans/nba-learned-model.md`).

If `SESSION_HANDOFF.md` "Start here" block date is more than ~48 hours stale, regenerate it from `git log origin/main..HEAD` + the latest sprint entry in `SESSION_LOG.md`.

---

## Now (this week's actionable work)

- **Council results gate (3rd gate) on PR #51.** Review actual run outputs: v5 replay 11/11 PASS, falsification test FALSIFIED (Δ Brier=0.0816 > 0.02, CI [0.0105, 0.1671], evidence at `docs/cup-knockout-disposition-evidence.md`). Convention validator output pending manifest population (see next item). Once council clears 3rd gate, merge PR #51.
- **Populate manifest TODO entries, then run convention scripts.** `data/bbref-convention-manifest.json` has TODO entries in strata: `play_in` (2), `cup_pool` (2), `cup_knockout` (2), `conference_finals` (1), `nba_finals` (1), `marquee_broadcast` (1), `rescheduled_2022_23` (2), `ot` (2). Each TODO entry has a SQL query in the `note` field to find the missing game IDs. Once manifest is populated: run `validate-bbref-convention.ts` → `data/bbref-convention-report.json` → run `check-game-type-asymmetries.ts` → `docs/phase-3-game-type-handling.md`. Commit both outputs; convention gate complete.

## Next (queued, scoped)

- **Phase 3 step 2 — pre-flight runs.** *(Partially complete: v5-replay 11/11 PASS, falsification test FALSIFIED with evidence committed. Remaining: convention scripts after manifest population — see Now.)* Once convention outputs committed, all 6 pre-flight scripts are run-verified and ready for full council 3rd gate.
- **Phase 3 step 3 — game-type metadata.** Add `game_type` enum to `games`/`nba_eligible_games` (or document derivation rule). Backfill historical games. Use `scripts/snapshot-prebackfill-db.sh` per Supplementary Gate B.
- **Phase 3 step 4 — feature-engineering pipeline.** Implement `ml/nba/features.py` with all pinned dispositions (drop or keep Cup-knockout per falsification result, impute sentinel rows, etc.). Unit tests: `test_no_test_fold_in_training_tensor.py`, `test_as_of_filter_reproducibility.py`, `test_as_of_filter_completeness.py`, `test_time_machine_feature_purity.py`.
- **Phase 3 steps 5–10**: training infrastructure → calibration + serving → pre-flight ship-rule gates → test-fold evaluation → shadow window → live swap. See addendum v11 §"Phase 3 implementation sequence (gating plan)".

## Someday (daydreams, architectural ideas)

These are ideas that have surfaced but haven't been costed or scoped. Move to "Now" with a P0–P3 if/when they make the cut.

- **Player-based predictions** ("Does SGA score >30 tonight?") — needs a shotchart / per-game projection model on top of player stats.
- **Kaggle historical NBA import** (1946-present) — deeper findings, longer baselines, more N for any future learned model.
- **Headshots on hero cards** — UI polish, licensing/hosting complexity.
- **Schema migrations**: `last_updated_at` everywhere, `stat_category` enum normalization, JSON1 indexes on `player_stats`.
- **Phase 4+ NBA models** — once Phase 3 ships, what's next? Tree ensembles? Sequence models for recency? Player-aware features?
- **Cross-sport meta-learning** — does an MLB pitcher-strength prior generalize to NHL goalies? Probably not, but worth a thought.
- **Real-time prediction WebSocket** — push odds line-moves and prediction shifts to the frontend live.
- **Sportsbook arbitrage scanner** — pure data play, no modeling required; consume multiple odds feeds, detect mispriced lines.
- **Cup-format and play-in-tournament-aware features** — neutral-site characteristic isn't currently a feature in any model. Worth A/B-ing once Phase 3 is in motion (debt #35 surfaced this).
- **Fully retire v2 baseline** — once Phase 3 (or v6, if Phase 1 ships) has ≥6 months of live track record.

## Open issues (mirror of `gh issue list --state open`)

None. (`gh issue list --state open` returns empty as of 2026-04-26 end-of-session.)

## In flight (branches not yet merged)

- **PR #51** (`claude/phase3-preflight-1-3`) — all 6 Phase 3 pre-flight scripts + `.harness/council/README.md` + council WARN→fixes. Open, not yet merged. Pending: council results gate (3rd gate) + manifest population.
  - All Sprint 10.13–10.14 work already merged to main (PRs #47–#50).

---

## Open debts (compact snapshot)

See `SESSION_LOG.md` "Council Debts (Open)" table for full descriptions and source-sprint context. This is a quick scan only.

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

Closed (recent): #11 (Sprint 10.8), #13 (PR #28), #14 (PR #38), #27 (PR #34), #28 (PR #36), #31 (PR #44), #33 (PRs #42/#43/#45), #34 (Sprint 10.13), **#35 (Sprint 10.14, option-b after v10 forward-and-rollback)**.

## Plans (active)

| File | Status | Notes |
|---|---|---|
| `Plans/nba-learned-model.md` | Phase 2 SHIPPED. Phase 3 plan-draft (addendum v11) council-CLEAR 2026-04-26. Implementation gated on pre-flight tooling. | Addenda v1–v11 (+ v10 post-mortem) are append-only history. |
| `Plans/nba-phase2-backfill.md` | Debt #33 plan, fully executed; closed. | Reference for backfill mechanics. |
| `Plans/soccer-poisson.md` (+ addendum) | Reference for debt #25/#26 work. | |
| `Plans/shadow-prediction-logging.md` | Reference for debt #14/#32 work. | |
| `Plans/nba-home-adv-recalibration.md` | Closed; debt #27 closure record. | |
| `Plans/mls-epl-sigmoid-scale.md` | Closed; debt #28 closure record. | |
| `Plans/reliability-diagrams.md` | Closed; debt #11 closure record. | |
| `Plans/sprint3-plan.md`, `Plans/goofy-wibbling-fern.md` | Historical artifacts. | |

## Cross-cutting reminders

These are codified elsewhere; restated here for skim-scan.

- **Council discipline is non-negotiable.** Plans, implementations, AND test/results all get reviewed. See `feedback_council_discipline.md` (memory) and `.harness/council/*.md` for personas. **5 experts** (DQ / Stats / Pred / Domain / Math); Math sits out reviews with no calculations.
- **Dissenter-named falsification test (pm.5; codified Sprint 10.14).** When a council R1 surfaces a load-bearing convention disagreement and R2 entertains a reversal driven by an empirical claim, the falsification test named by the dissenting expert in R1 becomes blocking on R2 reversal.
- **Multi-row-write empirical-verification standard (pm.6; codified Sprint 10.14).** Any future plan that pivots on a single empirical check requires (a) ≥2 data points per stratum the population contains, (b) ≥5 total data points, (c) adversarial selection (≥1 data point per stratum chosen by the dissenting expert, not the proponent), AND (d) the dissenter's named falsification test. All four conditions are blocking.
- **Pre-backfill DB snapshot is mandatory (codified Sprint 10.14).** For any backfill / migration / mass-UPDATE on production data, capture `sqlite3 .backup` (or equivalent atomic snapshot) of `data/sportsdata.db` BEFORE execution begins. Risk-mitigation pre-states the rollback recipe; without the snapshot, the recipe is incomplete.
- **Pre-declare ship rules** before any A/B or benchmark code is written. PR #29 (soccer Poisson null result) is the canonical example.
- **`Plans/*.md` are append-only** once council-CLEAR. Post-mortems append addenda; don't back-edit prior plan content.
- **`learnings.md` is append-only.** Add new entries at the bottom.
- **Don't auto-create PRs.** The user opens them. Pushing to a feature branch is fine; opening the PR is the gate (overridable by explicit user ask, as in this session's #48 + #49 + #50).
- **Always go through a feature branch** (`claude/<topic-slug>`). Never push to main directly. The pre-push hook in `.claude/hooks/` blocks pushes to a branch that has no diff vs origin/main.
- **Before any "what shipped" narrative**, run `git fetch origin main && git log origin/main..HEAD` — local state is not authoritative.
- **`fly ssh -C` does NOT run through a shell.** Use `sh -c '...'` wrapper for any chained command.
