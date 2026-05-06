# Backlog

> **Living document.** Append, edit, reorganize freely. Sprint-by-sprint
> detail lives in `SESSION_LOG.md`; tight session-pickup state lives in
> `SESSION_HANDOFF.md`; this file is the priority queue + idea bank.
> Update at session start (regenerate from `SESSION_LOG.md` + `git log` if
> stale) and at session end (when handing off).

Last regenerated: 2026-05-01 (post Sprint 10.23 — Phase 7 plan council-CLEAR at 635e826; all Sprint 10.22 debt PRs #56–#63 merged; PR #68 debt #16 open awaiting council; v5 incumbent; Phase 7 Step 1 is next).

## Where to start

Fresh session? Read in this order:

1. `SESSION_HANDOFF.md` — tight "Start here next session" block at the top.
2. `CLAUDE.md` — durable operating rules.
3. This file — priority queue + open-debts snapshot.
4. Any `Plans/*.md` referenced by the active priorities (Phase 3: addendum v11 in `Plans/nba-learned-model.md`).

If `SESSION_HANDOFF.md` "Start here" block date is more than ~48 hours stale, regenerate it from `git log origin/main..HEAD` + the latest sprint entry in `SESSION_LOG.md`.

---

## Now (this week's actionable work)

- **Check + merge PR #68** (`claude/debt-16-position-weighted-injury`) — position-weighted injury multipliers; council running as of 2026-05-01 (main merged in at 72d02dd). Expect WARN on magic-number multipliers; pre-declared mitigation: backtest not yet feasible, logging added in predict-runner.ts for future validation.
- **Phase 7 Step 1** — TOV% fix in `ml/nba/features.py`: compute `tov_pct` on [0,1] scale, add ε=1e-6 clip before logit, unit test confirming non-zero std. Branch `claude/phase7-step1-tov-fix`. Council impl-review required before proceeding to Step 2.

## Next (queued, scoped)

- **Phase 7 Step 2** — Hybrid feature pipeline: add season-agg group + EWMA-delta group to `build_training_tensor()`. Council impl-review. (Gated on Step 1 CLEAR.)
- **Phase 7 Step 3** — Inner-CV training on 2021–2022-regular, K=5 folds, select halflife winner. Council results review. (Gated on Step 2 CLEAR.)
- **Phase 7 Steps 4–6** — Val fold eval (2023-regular), pre-flight, test fold eval (2024-regular). Each has a council gate. See `Plans/nba-learned-model.md` addendum v18.
- **debt #18** — Fit INJURY_COMPENSATION separately for margin vs winprob (gated on N≥200 injury games; follow-up to debt #16 shipping).
- **debt #22** — NBA cold_coef 0.5→0.92 coefficient change; still needs council review.

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

- `claude/debt-16-position-weighted-injury` (PR #68) — position-weighted injury multipliers; council running (main merged in 2026-05-01).

---

## Open debts (compact snapshot)

See `SESSION_LOG.md` "Council Debts (Open)" table for full descriptions and source-sprint context. This is a quick scan only.

| # | Title | Priority | Notes |
|---|---|---|---|
| 1 | canonical_game_id schema migration | P0-deferred | Sprint 8.5 |
| 2 | MLB doubleheader handling | Pre-generalize | Sprint 8.5 |
| 3 | Test fixture covering both ID shapes | With #1 | |
| 8 | Disable stale Cloudflare direct-git deploy source | Low | dashboard only |
| 16 | Position-weighted injury multipliers | Medium | PR pending; council running |
| 18 | Fit INJURY_COMPENSATION separately for margin vs winprob | Gated on N≥200 | follow-up to #16 |
| 19 | Second injury data provider | HELD | trigger met |
| 20 | Historical odds ingest | HIGH | unblocks ATS backtest |
| 24 | Dixon-Coles τ low-score correction | LOW | math-proven zero margin impact |
| 25 | Dixon-Coles ξ time-decay + MLE | HIGH | blocked on #26 |
| 26 | Pre-2024 soccer match scrape | HIGH | gating soccer-v2 |
| 29 | Ternary reliability for soccer Poisson | Low | gated on 1X2 |
| 32 | Shadow-analysis CLI / endpoint | HIGH | gated on N≥30 pairs |
| 36 | Injury-name fuzzy fallback can mismatch on duplicate last names | Low | PR #68 R3 ships interim mitigation (refuse non-unique LIKE); full fix = upstream player-ID normalization |

Closed (recent): #11 (Sprint 10.8), #13 (PR #28), #14 (PR #38), #27 (PR #34), #28 (PR #36), #31 (PR #44), #33 (PRs #42/#43/#45), #34 (Sprint 10.13), **#35 (Sprint 10.14, option-b after v10 forward-and-rollback)**.
Sprint 10.22 sweep (merged 2026-05-01): **#4** (PR #62), **#5/#6/#10** (PR #60), **#7** (PR #59), **#9** (PR #61), **#12** (PR #57), **#15/#22** (PR #63), **#17/#30** (PR #58), **#23** (already satisfied).
Sprint 10.23 in progress (2026-05-01): **#16** (PR #68, council running).

## Plans (active)

| File | Status | Notes |
|---|---|---|
| `Plans/nba-learned-model.md` | Phase 3 NULL RESULT (addenda v1–v17). Phase 7 plan council-CLEAR (addendum v18, PR #67, 2026-05-01). Splits: train 2021–2022-regular, val 2023-regular, test 2024-regular. Step 1 (TOV% fix) is next. | v5 remains incumbent. |
| `Plans/nba-phase2-backfill.md` | Debt #33 plan, fully executed; closed. | Reference for backfill mechanics. |
| `Plans/soccer-poisson.md` (+ addendum) | Reference for debt #25/#26 work. | |
| `Plans/shadow-prediction-logging.md` | Reference for debt #14/#32 work. | |
| `Plans/nba-home-adv-recalibration.md` | Closed; debt #27 closure record. | |
| `Plans/mls-epl-sigmoid-scale.md` | Closed; debt #28 closure record. | |
| `Plans/reliability-diagrams.md` | Closed; debt #11 closure record. | |
| `Plans/sprint3-plan.md`, `Plans/goofy-wibbling-fern.md` | Historical artifacts. | |

## Cross-cutting reminders

These are codified elsewhere; restated here for skim-scan.

- **Council is now automated via Gemini.** `.github/workflows/council.yml` runs on every PR open/push. `GEMINI_API_KEY` secret set. 60 runs/month budget. Add `[skip council]` to PR title to bypass. 503 retries = empty commit push. Plans, implementations, AND test/results still go through council — automation handles implementation/results; plan reviews must still be run before coding.
- **Council discipline is non-negotiable.** Plans, implementations, AND test/results all get reviewed. See `feedback_council_discipline.md` (memory) and `.harness/council/*.md` for personas. **5 experts** (DQ / Stats / Pred / Domain / Math); Math and Pred-Accuracy sit out infra/non-model reviews.
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
