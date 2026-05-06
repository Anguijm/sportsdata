# Project Status — 2026-05-06

> Snapshot generated from `git log origin/main..HEAD`, `BACKLOG.md`,
> `SESSION_HANDOFF.md`, `SESSION_LOG.md`, and the live GitHub PR list. Not a
> handoff doc — `SESSION_HANDOFF.md` remains the authoritative session-pickup
> source. This is a one-shot human-readable summary.

## Headline

- **Production incumbent:** v5 model. No Phase 7 code shipped yet — plan is locked, Step 1 is next.
- **Last merged to main:** PR #67 `plan(phase7): Hybrid Season-Agg + EWMA model — addendum v18` at `635e826` (2026-05-01).
- **Sprint 10.23** closed 2026-05-01: Phase 7 plan council-CLEAR; Sprint 10.22 debt sweep (PRs #56–#63) all merged.

## Branch state

- **Current branch:** `claude/add-status-feature-E5FS6` — even with `origin/main` (no commits ahead before this report).
- **Main HEAD:** `19099d4 docs(handoff): close out Sprint 10.23`.
- **`SESSION_HANDOFF.md` "Start here" block:** dated 2026-05-01, now 5 days old — past the ~48h freshness window per CLAUDE.md, so regenerate before relying on it for the next session pickup.

## Open PRs (1)

| # | Branch | Title | State |
|---|---|---|---|
| 68 | `claude/debt-16-position-weighted-injury` | feat(debt#16): position-weighted injury impact multipliers | Council running; pre-declared WARN expected on magic-number multipliers (3×, 1.5×, 0.5×). Backtest not yet feasible — logging added in `predict-runner.ts` for future validation. Created 2026-04-30, last updated 2026-05-01. |

## Active plan — Phase 7 (NBA learned model, Hybrid Season-Agg + EWMA)

Locked via PR #67 (addendum v18 in `Plans/nba-learned-model.md`). Splits and ship rule:

- Train (inner-CV): 2021-regular + 2022-regular (~2,466 games)
- Val: 2023-regular (~1,230 games)
- Test: 2024-regular (1,237 games) — **sealed**
- Ship rule: Brier improvement ≥ 0.005 + 95% block-bootstrap CI excluding zero on **both** val and test. CI is the binding constraint (80%-power MDE ≈ 0.009).
- Postseason: explicitly out of scope.

**Step gating sequence:**

1. **Step 1 (next, not started)** — TOV% fix in `ml/nba/features.py`: compute `tov_pct = TOV / (FGA + 0.44·FTA + TOV)` on [0,1] scale; ε=1e-6 logit clip; unit test confirming non-zero std. Branch `claude/phase7-step1-tov-fix`. Council impl-review required.
2. Step 2 — hybrid feature pipeline (season-agg + EWMA-delta groups). Gated on Step 1 CLEAR.
3. Step 3 — inner-CV training, K=5, 2021–2022-regular, halflife winner selection.
4. Steps 4–6 — val eval, pre-flight, test eval. Each has its own council gate.

## Open debts (compact)

| # | Title | Priority | Notes |
|---|---|---|---|
| 1 | canonical_game_id schema migration | P0-deferred | Sprint 8.5 |
| 2 | MLB doubleheader handling | Pre-generalize | Sprint 8.5 |
| 3 | Test fixture covering both ID shapes | With #1 | |
| 8 | Disable stale Cloudflare direct-git deploy source | Low | dashboard only |
| 16 | Position-weighted injury multipliers | Medium | PR #68 in council |
| 18 | Fit INJURY_COMPENSATION separately for margin vs winprob | Gated | follow-up to #16 |
| 19 | Second injury data provider | HELD | trigger met |
| 20 | Historical odds ingest | HIGH | unblocks ATS backtest |
| 22 | NBA cold_coef 0.5→0.92 | Medium | still needs council |
| 24 | Dixon-Coles τ low-score correction | LOW | math-proven zero margin impact |
| 25 | Dixon-Coles ξ time-decay + MLE | HIGH | blocked on #26 |
| 26 | Pre-2024 soccer match scrape | HIGH | gating soccer-v2 |
| 29 | Ternary reliability for soccer Poisson | Low | gated on 1X2 |
| 32 | Shadow-analysis CLI / endpoint | HIGH | gated on N≥30 pairs |

**Recently closed (Sprint 10.22 sweep, 2026-05-01):** #4 (PR #62), #5/#6/#10 (PR #60), #7 (PR #59), #9 (PR #61), #12 (PR #57), #15/#22 (PR #63), #17/#30 (PR #58), #23 (already satisfied).

## Plans directory

| File | Status |
|---|---|
| `Plans/nba-learned-model.md` | Phase 3 NULL RESULT (addenda v1–v17). Phase 7 plan CLEAR (addendum v18, PR #67). Step 1 is next. |
| `Plans/soccer-poisson.md` | Reference for debt #25/#26 work. |
| `Plans/shadow-prediction-logging.md` | Reference for debt #14/#32 work. |
| `Plans/nba-phase2-backfill.md` | Closed; reference for backfill mechanics. |
| `Plans/nba-home-adv-recalibration.md`, `Plans/mls-epl-sigmoid-scale.md`, `Plans/reliability-diagrams.md` | Closed (#27, #28, #11 closure records). |
| `Plans/sprint3-plan.md`, `Plans/goofy-wibbling-fern.md` | Historical artifacts. |

## Blockers

- PR #68 council pending (debt #16).
- debt #18 gated on #16 shipping.
- debt #22 NBA cold_coef change — still needs council.
- Phase 7 Step 1 onward — sequential council gates per step.

## Immediate next actions (in order)

1. Check PR #68 council outcome; if WARN mitigations are acceptable, merge.
2. Open `claude/phase7-step1-tov-fix`; implement TOV% fix + unit test in `ml/nba/features.py`; run council impl-review before any retraining.
3. After Step 1 CLEAR → Phase 7 Step 2 (hybrid feature pipeline).

## Standing rules (from `CLAUDE.md`, restated for skim)

- Pushes blocked by `.claude/hooks/check-branch-not-merged.sh` if branch has no diff vs `origin/main`. Don't work around — branch fresh from main.
- Do **not** auto-create PRs.
- Council = 5 experts (DQ / Stats / Pred / Domain / Math). Plan reviews are still manual; impl + results reviews are Gemini-automated via `.github/workflows/council.yml`.
- `Plans/*.md` and `learnings.md` are append-only.
- Always go through a `claude/<topic-slug>` feature branch; never push to `main` directly.
