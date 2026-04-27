# Backlog

> **Living document.** Append, edit, reorganize freely. Sprint-by-sprint
> detail lives in `SESSION_LOG.md`; tight session-pickup state lives in
> `SESSION_HANDOFF.md`; this file is the priority queue + idea bank.
> Update at session start (regenerate from `SESSION_LOG.md` + `git log` if
> stale) and at session end (when handing off).

Last regenerated: 2026-04-27 (post Sprint 10.18 — Phase 3 step 5 inner-CV training infrastructure complete; branch claude/phase3-step5-cv-training, PR open; prod still at step 3 / a0ba673 on main).

## Where to start

Fresh session? Read in this order:

1. `SESSION_HANDOFF.md` — tight "Start here next session" block at the top.
2. `CLAUDE.md` — durable operating rules.
3. This file — priority queue + open-debts snapshot.
4. Any `Plans/*.md` referenced by the active priorities (Phase 3: addendum v11 in `Plans/nba-learned-model.md`).

If `SESSION_HANDOFF.md` "Start here" block date is more than ~48 hours stale, regenerate it from `git log origin/main..HEAD` + the latest sprint entry in `SESSION_LOG.md`.

---

## Now (this week's actionable work)

- **Phase 3 step 5 — DONE (PR open, pending merge).** ewma-h21 wins inner CV (segment-stable, council override of bias gate). LightGBM {nl=31, mc=200, ra=1.0}. Ensemble val Brier=0.2065, seed-std=0.0012. See branch `claude/phase3-step5-cv-training`.
- **Phase 3 step 6 — Calibration + serving.** Platt scaling on val fold. ONNX export. **Council plan review required first.**

## Next (queued, scoped)

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
- **Fully retire v2 baseline** — once Phase 3 (or v6, if Phase 1 ships) has ≥6 months of live track record.

## Open issues (mirror of `gh issue list --state open`)

None. (`gh issue list --state open` returns empty as of 2026-04-27.)

## In flight (branches not yet merged)

None.

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
