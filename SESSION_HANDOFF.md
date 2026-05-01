# Session Handoff

> **Purpose:** the very first thing a fresh session reads. Tight "Start here next session" block at the top. Everything below is historical log preserved for context.

---

## Start here next session — 2026-05-01 (Sprint 10.23 — Phase 7 plan locked; debt #16 in review)

**Current branch:** `main` (local synced to `635e826`).
**Production state (Fly):** v5 remains incumbent. Phase 7 plan council-CLEAR on main (addendum v18).
**Last merged:** PR #67 `plan(phase7): Hybrid Season-Agg + EWMA model — addendum v18` at `635e826`.

**Immediate next actions (in order):**
1. **Check PR #68 council** (`claude/debt-16-position-weighted-injury`) — main was merged into branch at `72d02dd` and pushed 2026-05-01; council should have fired. Expect WARN on magic-number position multipliers (pre-declared). If WARN mitigations are acceptable, merge.
2. **Phase 7 Step 1** — TOV% fix in `ml/nba/features.py`: compute `tov_pct = TOV / (FGA + 0.44·FTA + TOV)` on [0,1] scale; add ε=1e-6 clip before logit; unit test confirming non-zero std. Branch `claude/phase7-step1-tov-fix`. Council impl-review required before any retraining.

**Open PRs (1):**
- #68 `claude/debt-16-position-weighted-injury` — position-weighted injury multipliers; council running (main merged in at 72d02dd, 2026-05-01).

**Phase 7 data splits (locked, addendum v18):**
- Training (inner-CV): 2021-regular + 2022-regular (~2,466 games)
- Val fold: 2023-regular (~1,230 games)
- Test fold: 2024-regular (1,237 games) — **sealed**
- Ship rule: Brier improvement ≥ 0.005 + 95% block-bootstrap CI excluding zero on both val and test. 80%-power MDE ≈ 0.009. CI is the binding constraint.
- Postseason: explicitly out of scope.

**Blockers:**
- PR #68 council pending.
- debt #22 coefficient change (NBA cold_coef 0.5→0.92) deferred — still needs council.
- debt #18 (INJURY_COMPENSATION margin vs winprob) gated on debt #16 shipping.

**Council bootstrap gotcha (new, 2026-05-01):**
Branches predating Phase C rollout (PR #66) have no `council.yml`. GitHub Actions uses HEAD branch workflow files for same-repo PRs — so no workflows fire at all. Fix: merge `origin/main` into the branch before opening the PR. Fast check: `git show origin/<branch>:.github/workflows/council.yml 2>/dev/null || echo "MISSING"`.

---

## Historical session log

Older session-end states are preserved below. Most recent at top.

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
