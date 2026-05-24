# Session Handoff

> **Purpose:** the very first thing a fresh session reads. Tight "Start here next session" block at the top. Everything below is historical log preserved for context.

---

## Start here next session — 2026-05-24 (Phase 7 NULL RESULT; Phase 8 strategic decision pending)

**TL;DR.** Phase 7 hybrid season-agg + EWMA-delta architecture **failed the val-fold ship gate** on 2023-regular (PR #83, council CLEAR 10/10). Phase 7 is the fifth consecutive learned-model null result (Phase 3-7). v5 remains permanent NBA incumbent until a Phase 8 plan exists. **Debt #37 is now the top-priority backlog item: a strategic decision on Phase 8 direction needs user-level input before any Phase 8 plan PR.**

**Current branch:** `main` at the PR #84 (v23 close-out) merge commit.

### Phase 7 final result (PR #83)

| Metric | Phase 7 (h=14 + Platt) | v5 incumbent | Diff |
|---|---|---|---|
| Brier on 2023-regular val (N=1,237) | **0.222617** | 0.214916 | **-0.0077** (v5 better) |
| ECE | 0.0304 | 0.0249 | v5 better-calibrated |
| 95% block-bootstrap paired CI | mean -0.0077, **[-0.0144, -0.0008]** | — | entirely below 0 |
| IID per-game sensitivity CI | [-0.0148, -0.0007] | — | agrees with block-CI |

Artifact: `ml/nba/results/phase7-val-20260524T115328Z-3c730bbc.json`.

### Phase 8 strategic decision (debt #37) — candidate directions

Per v23 §"Phase 8 deferred", v22 plan-review domain-expert WARN, and cross-phase null-result pattern:

1. **Injury features** (highest signal per domain expert; multi-sprint, needs injury data infrastructure)
2. **Schedule/travel features** (smaller scope; mostly derivable from existing `games` table)
3. **Player-level BPM** (Phase 4 retry; needs trade-pipeline fix to address the 13-14% missing-player gap first)
4. **Declare v5 permanent NBA incumbent + redirect R&D to other sports** (e.g., MLB or NHL scale calibration; soccer Phase 8 work gated on debt #25/#26)
5. **Different model class** on existing features (Bayesian hierarchical, GP, calibrated probabilistic forest) — lower confidence in payoff per Phase 3's LightGBM↔MLP parity finding

None of these is committed. Each requires its own plan + pm.7 + pm.8 + council cycle.

### What this session shipped (Sprint 10.25, all merged to main 2026-05-24)

- PR #72 Step 3 harness + ddof=1 fix → CLEAR 10/10
- PR #73 addendum v19 (data-prereq gap) → CLEAR 10/10
- PR #74 PR-1: view widen + codify pm.7 → CLEAR 10/10
- PR #75 PR-2: 2021/2022 backfill (12,498 rows) + v20 gate adjustment → CLEAR 9/10 (DQ-FAIL override on input-data state)
- PR #76 v21: features.py time-machine fix + TEST_FOLD_SEASONS refresh + smoke → CLEAR 10/10
- PR #77 PR-3: Step 3 inner-CV results (h=14 winner) → WARN 8/10 (pre-declared per v18 Risk #4)
- PR #78 codify pm.8 council rule → CLEAR 10/10
- PR #79 SESSION_HANDOFF regen → WARN 8/10 (mirrors #77)
- PR #80 PR-2b: bbref cross-source audit 70/70 PASS → CLEAR 10/10
- PR #81 ledger close → CLEAR 10/10
- PR #82 v22 Step 4 plan → WARN 8/10 (model-arch concern, pre-declared)
- PR #83 Step 4 val-fold eval — **NULL RESULT** → CLEAR 10/10 (framework correctly falsifying)
- PR #84 v23 close-out (this push) — pending council

### Council rules codified this session

- **pm.7**: plan-review must verify data-prereq existence at plan-review time. Canonical: v19 + PR #74.
- **pm.8**: pipeline impl-review requires end-to-end smoke run on real data path. Canonical: v21 + PR #76 + PR #78.
- **Session-level autonomous override** (`feedback_autonomous_council_override.md`): user delegated plan-review judgment to Claude mid-session; Claude proposes own counter-challenges + proceeds without re-asking. Default discipline (manual plan-review) still applies in future sessions absent re-confirmation.

### Carry-forward debts (unchanged)

- **debt #18**: INJURY_COMPENSATION margin vs winprob — unblocked by debt #16 ship; can proceed independently of Phase 8 decision.
- **debt #22**: NBA `cold_coef` 0.5→0.92 — needs council, model-change protocol. Unrelated to Phase 7 close-out.
- **debt #37** (NEW): Phase 8 NBA learned-model strategic decision — see above; HIGH priority but gated on user-level input.

### Cross-phase lesson (codified in v23)

Five consecutive learned-model null results (Phase 3-7) on NBA win-probability prediction at n≈4k games. The architectural lesson is empirically robust: **v5's simple sigmoid on season-aggregate point differential is near-sufficient at this data scale**. Adding feature complexity (EWMA windowing, recency-delta, player-aggregate priors, season-aggregate companions) has NOT produced a robust Brier improvement ≥ 0.005 with CI excluding zero on any of Phase 3, 4, 5, 6, or 7. Phase 8, if pursued, must address this pattern with a different class of signal (likely injury / rest / travel, per domain expert) OR accept v5 as permanent.

### Phase 7 closed — splits, gates, and artifacts (for historical reference)

- Training (Phase 7 final, no re-run): 2021-regular (1,224/1,230 effective after PR-2 omissions) + 2022-regular (1,236/1,236) = 2,447 effective games, 4,894 team-rows in tensor.
- Val (Phase 7 final): 2023-regular, N=1,237, 100% coverage.
- Test (sealed, NEVER touched in Phase 7 per protocol when val failed): 2024-regular, N=1,237.
- Halflife winner: h=14 (Step 3 mean Brier 0.233946).
- Step 4 ship gate: FAIL (0.0077 worse than v5; CI entirely below zero).

---

## Historical session log

Older session-end states are preserved below. Most recent at top.

### 2026-05-23 — Phase 7 Step 3 harness written; training run pending

**What shipped (to branch + PR, not merged):**
- `ml/nba/phase7_cv_runner.py` (196 lines) + `ml/nba/test_phase7_cv_runner.py`
  (130 lines, 9 synthetic tests, all PASS) on `claude/phase7-step3-inner-cv` @ `f910d97`.
- PR #72 opened; council impl-review on harness code firing.

**What's pending:** the actual training run (see Start-here block). No DB in the
working environment this session, so the run is deferred to a DB-equipped session.

**Status reconciliation done this session:** `SESSION_HANDOFF.md` was ~3 weeks
stale (top block dated 2026-05-01, but Steps 1+2 and debt #16 had merged since).
Verified actual state from `git log origin/main` + GitHub PR list rather than
local/memory state, per CLAUDE.md doc-hygiene rule.

### 2026-05-01 — Sprint 10.23 — Phase 7 plan locked + debt sweep council close-out

**What shipped (merged):**
- PR #66 `harness: Phase C rollout` — canonical infrastructure at `7cb002f` (already on main from prior session).
- PRs #56–#63 — all 8 debt-sweep PRs merged during this session (CLEARs merged immediately; WARN on #58 soft-ramp fixed before merge; WARN on #60/#62 logging fixes added before merge).
- PR #67 `plan(phase7)`: Phase 7 plan addendum v18 CLEAR after 3 council rounds at `635e826`.

**What's staged (open PRs):**
- PR #68 `claude/debt-16-position-weighted-injury` — position-weighted injury multipliers; council running.

**Key decisions:**
- Phase 7 test fold changed from 2025-postseason (council Domain Expert FAIL) to 2024-regular (N=1,237, CI-powered). Postseason explicitly de-scoped.
- SE derivation: use Phase-3-scaled empirical block-bootstrap SE (0.0032 at N=1,237), not marginal Brier σ (0.0057). Paired diffs have much lower variance.
- Branches predating Phase C rollout need `origin/main` merged before any PR opens — GitHub Actions uses HEAD branch workflow files for same-repo PRs.

### 2026-04-29/30 — Sprint 10.22 — Debt sweep + Gemini council automation

**What shipped (merged):**
- PR #65 `feat(council)`: Gemini-powered automated council — `a696d43` on main.

**What's staged (open PRs, council triggered):**
- PRs #56–#63: 13 debts resolved across 8 PRs. Debt #16 on branch, no PR yet.

**Key decisions:**
- `resolver.md` renamed to `lead-architect.md` to match council.py's expected filename.
- prediction-accuracy persona gained abstain rule (mirrors Math expert) after spurious FAIL on infra PR.
- 503 retry = push empty commit, not `gh workflow run` (dispatch has no PR context).
- debt #16 Gemini council FAIL on contaminated diff was false alarm (position column 100% populated).

### 2026-04-28 — Sprint 10.20 — Phase 3 null result closed

### 2026-04-28 — Sprint 10.19 — Phase 3 step 6 (Platt calibration + serving)

**What shipped:**
- `ml/nba/calibrate.py`: Platt fit on val fold (n=528); A=1.350, B=0.016; raw Brier 0.2050→calibrated 0.2025. All 10 fix-pack items from addendum v14 Gate 1 verified.
- `ml/nba/infer.py`: `Predictor` class for serving — loads 20 LightGBM pickles + Platt params; predict-and-average → apply Platt to mean.
- `ml/nba/configs/calibration-params.json`: full calibration artifact (Platt params, norm_params, feature_names, diagnostics, data hash).
- addendum v14 appended to `Plans/nba-learned-model.md` (Gate 1 CLEAR avg 7.3/10, Gate 2 CLEAR avg 8.5/10).
- PR #54 (step 5) merged to main at `1bc750b`.
- Branch: `claude/phase3-step6-calibration` (PR open).

**Lessons codified:**
- LightGBM raw ensemble outputs are underconfident (A=1.35>1 in Platt); expect this behavior for GBMs on small tabular n.
- Platt calibration: logit space + `C=1e9` (not sklearn default); apply to ensemble mean, not per-seed.
- For LightGBM, weight-averaging is inapplicable — predict-and-average is the correct ensemble serving strategy.
- Model pickles gitignored but must have a documented regeneration recipe in the script's module docstring.

### 2026-04-27 — Sprint 10.18 — Phase 3 step 5 (inner-CV training infrastructure)

**What shipped:**
- `ml/nba/cv_runner.py`, `train_lightgbm.py`, `train_mlp.py`, `requirements-ml.txt`, `test-fold-touch-counter.json` on `claude/phase3-step5-cv-training` (PR open).
- 10-candidate feature-form inner CV: ewma-h21 wins both runs (segment-stable). Bias gate failed due to σ_inner planning error; council override justified and documented.
- Pinned: ewma-h21 + LightGBM {nl=31, mc=200, ra=1.0}. Ensemble val Brier=0.2065, seed-std=0.0012.
- addendum v13 appended to Plans/nba-learned-model.md (Gate 1 CLEAR, Gate 2 CLEAR).
- Gate 2 council override: Risk #7 season-agg fallback overridden for segment-stable ewma-h21.

**Lessons codified:**
- σ_inner planning estimate (0.095) was the std of the mean, not per-game std (actual: 0.151). Future threshold calibration: use per-game Brier std from a held-out calibration set.
- LightGBM num_leaves is non-binding at n=2640 (31=63=127 produce identical CV Brier). min_child_samples is the active constraint.
- Plan Risk #7 fallback ("season-agg if all candidates fail threshold") was designed for the null case — not for a segment-stable winner with consistent multi-run advantage.

### 2026-04-27 — Sprint 10.17 — Phase 3 step 4 (feature-engineering pipeline)

**What shipped:**
- `ml/nba/features.py` (new, ~870 lines): `build_training_tensor()`, `build_live_tensor()`, 42-feature rolling-window tensor. Rate/count/unbounded normalization. NaN→0.0 mean imputation. Sentinel TOV imputation. Opponent-adjusted Net Rating (two-pass). `is_denver_home` + `neutral_site` game-level flags.
- 5 unit tests: test_no_test_fold (2640 games, 0 violations), test_reproducibility (bit-identical), test_completeness_behavioral (1812→2640 strict ordered superset), test_completeness_structural (4 SQL statements, all filtered/attested), test_time_machine_purity (42 features, 0 NaN, bit-identical).
- `Plans/nba-learned-model.md`: addendum v12 appended (plan gate + impl gate; 2 blocking bugs fixed — timedelta month-boundary, NULL tov pre-pass).
- Branch: `claude/phase3-step4-features` (PR open, pending merge).

**Lessons codified:**
- f-string SQL constants split by Python AST → structural SQL test misses `updated_at` filter inside the f-string. Fix: module-level SQL string constants with `.format(placeholders=...)`.
- NaN raw → 0.0 in pre-normalization space creates extreme negative normalized values. Fix: fit on finite values only, then set NaN positions to 0.0 in normalized space (mean imputation).
- `target_d.replace(day=max(1, target_d.day - 7))` is wrong for days 1–7 of month. Fix: `timedelta(days=7)`.

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
