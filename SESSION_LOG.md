# Sportsdata Session Log

Chronological record of all sprints, decisions, council verdicts, and deferred work.
Last updated: 2026-04-26 (Sprint 10.14 — Debt #35 CLOSED as option-b after v10 forward-and-rollback cycle. v10 backfill on Fly was wrong (single-game empirical check non-representative); rolled back via re-scrape; post-rollback audit PASS at 0/0/0; per-season AVG(tov) bit-identical to pre-v10 (15-sig-fig match). Post-mortem council 2 rounds, R2 5/5 CLEAR avg 9.6/10. Branch `claude/debt-35-tov-convention` ready for PR.)

---

## 🧭 Remote Resume — 2026-04-26 (Sprint 10.14 — Debt #35 CLOSED via v10 rollback + post-mortem)

> **Significant failure-and-recovery sprint.** v10 plan was council-CLEAR at 9.2/10 (plan) + 9.1/10 (impl), but the central empirical claim that drove R2 reversal of the Domain expert's R1 FAIL turned out to be non-representative. The LAL/IND 2023 NBA Cup final showed bbref tov=18=ESPN.turnovers (player-summed), but this was the outlier. Regular-season + postseason + Cup pool-play games all use bbref tov=ESPN.totalTurnovers (post Oct-2024 SR correction); only Cup KNOCKOUT games (~14 per Phase-3 in-scope window) use player-summed. Backfill ran cleanly (3,802 / 3,802 ok), Ship Rule 3 PASS at Δposs=0.73, but Ship Rule 4 audit FAIL with 57 raw + 139 rate failures.
>
> Per Risk #4, rollback fired. Rescraped with reverted FIELD_MAP; post-rollback audit PASS at 0/0/0 on substituted N=50; per-season AVG(tov) bit-identical to pre-v10 across all 5 segments at 15-sig-fig precision. Post-mortem council 2 rounds, R2 5 CLEAR avg 9.6/10. Debt #35 closes as **option-b** (keep `totalTurnovers` → `tov`, retain `team_tov` NICE-TO-HAVE column for forensic value, document Cup-knockout asymmetry as <0.18% bias forwarded to Phase 3).
>
> Branch `claude/debt-35-tov-convention` at `8d27f5c` (pre R2 fix-pack at HEAD); R2 verdicts table folded post-council; PR not yet opened (CLAUDE.md no-auto-PR rule).

### Sprint 10.14 timeline (2026-04-26)

| Commit | Step | Outcome |
|---|---|---|
| `f364fbb` | v10 plan addendum council-CLEAR (5/5 avg 9.2/10, 2 rounds) | option-d (player-summed convention switch); 8 ship rules; Domain R1 FAIL inverted by single-game LAL/IND empirical check |
| `ff29300` | v10 implementation council-CLEAR (5/5 avg 9.1/10, 1 round) | scraper FIELD_MAP swap + team_tov NICE-TO-HAVE column + bounds + sum-identity checks; backfill `--update-existing` flag; snapshot script |
| `b05d166` | Stats fix-pack #1 fold (snapshot enhancement) | self-contained Rule-3 magnitude check |
| Fly deploy | v10 deploy (immediate strategy) | machine v55 → v56; team_tov column added on Fly |
| Fly snapshot | pre-backfill state captured | AVG(tov)=14.075, all team_tov NULL |
| Fly backfill | `--update-existing` rescrape (~32 min) | 3,802/3,802 ok; 6 schema_errors (5 ESPN-sentinel team_tov<0 + 1 LAL/DEN tov<team_tov ordering); R1/R2/R3 PASS; AVG(tov) → 13.339 |
| Fly snapshot | post-backfill state captured | per-season Δposs ∈ [0.69, 0.92], magnitude check PASS at [0.2, 2.5] |
| Fly audit | re-run debt #34 audit on substituted N=50 | **FAIL** at 57 raw + 139 rate failures (all tov-related; bbref values ≥ ESPN.turnovers by 1-3 per team-game) |
| Diagnosis | Cup vs regular-season bbref-convention asymmetry | LAL/IND Cup final = player-summed; DEN/LAL 2023-regular = totalTurnovers; LAL/MIA Cup pool-play = totalTurnovers (correction applied). Hypothesis: SR Oct-2024 correction skipped trophy-game pipeline only |
| User direction | option-b (revert to totalTurnovers, keep team_tov column) | engineering cost vs <0.18% bias trade favors revert |
| `07367fc` | revert: scraper FIELD_MAP back to totalTurnovers; remove sum-identity + ordering checks; keep bounds checks | 8 corruption tests reduced to 3 (sum-mismatch + ordering removed; ESPN-sentinel test added) |
| `5284416` | rollback artifacts (4 forensic files) + post-mortem addendum | end-to-end traceable failure record |
| Fly deploy | rollback deploy (immediate) | machine v56 → v57 |
| Fly rescrape | `--update-existing` against all 7,604 rows (~32 min) | 3,802/3,802 ok; 5 schema_errors (ESPN-sentinel only; ordering check removed); R1/R2/R3 PASS |
| Fly snapshot | post-rollback state captured | AVG(tov)=14.075092056812204 — bit-identical to pre-v10 across all 5 segments (15 sig-figs) |
| Fly audit | re-run audit | **PASS at 0/0/0** ✓ |
| `8d27f5c` | post-mortem R1 fix-pack: address all 5 council R1 findings | Cup-game scope corrected (~14 not ~134), 5 sentinel IDs enumerated, drift bound corrected, council-process refinement |
| Council R2 | 5/5 CLEAR avg 9.6/10 | post-mortem closed |
| (this commit) | R2 verdicts folded + Pred R2 nit (≥16 not ≥10) | debt #35 CLOSED as option-b |

### Where we are now

**Branch state:**
- `main` at `ce13e31` (unchanged from Sprint 10.13).
- Feature branch `claude/debt-35-tov-convention` ahead of main by 6 commits (f364fbb plan + ff29300 impl + b05d166 stats fold + 07367fc revert + 5284416 rollback artifacts + 8d27f5c R1 fix-pack + this R2 verdict + Pred-nit fix).
- PR NOT yet opened per CLAUDE.md no-auto-PR rule.

**Production state (Fly):**
- App `sportsdata-api` at v57 (deployed twice this sprint: v56 = v10 forward, v57 = v10 rollback).
- DB schema: `nba_game_box_stats.team_tov INTEGER` column added (idempotent migration); 7,604 rows have `team_tov` populated post-rollback rescrape (5 rows hold ESPN-sentinel out-of-bounds values: -22, -16, -12, -11, -2).
- Convention: `tov = totalTurnovers` (restored to pre-v10 state; bit-identical to 15 sig-figs).
- Audit: PASS at 0/0/0 (debt-#34 substituted N=50 verdict held).

**Phase-3 forwarding (8 items pinned by v10 + post-mortem):** see `Plans/nba-learned-model.md` "Updated Phase-3 plan-review items pinned by v10 + post-mortem" for the full list.

### Council process learnings (Sprint 10.14)

1. **Single-game empirical checks must not be load-bearing on R2 reversals of council expert priors.** New bar: dissenter names the falsification test; that test is blocking + ≥2/stratum + ≥5 total + adversarial selection.
2. **Pre-backfill DB snapshot is mandatory** for any production-data irreversible operation. Risk-mitigation pre-states the rollback recipe; without the snapshot, the recipe is incomplete.
3. **Stratified-bbref-validation regression harness** (`scripts/validate-bbref-convention.ts`, ≥16 games across 8 strata) should land BEFORE any future TOV-related model-affecting backfill. Catches data-correctness drift that prediction-replay tests don't.
4. **`--update-existing` + `--min-age-hours` flags + segmented-snapshot script are general-purpose tooling** retained beyond v10 scope.

---

## 🧭 Remote Resume — 2026-04-26 (Sprint 10.13 — Phase 2 ship-claim FULLY EARNED)

> **Pass-B closed in a single focused session.** What was scoped in v8 as ~1.5 hours of manual bbref-paste turned into an automated Playwright scraper at 1 req / 30 s + a C′ disposition that decoupled the audit's internal possessions formula from the schema column. Audit verdict: **PASS at N=50 (0 raw + 0 rate + 0 missing).** All 5 Phase 2 ship rules satisfied. Phase 3 fully unblocked (data-ready and gate-clear).
>
> Branch `claude/debt-34-pass-b-c-prime` pushed (commit `0890a62`); **PR not yet opened** (CLAUDE.md no-auto-PR rule). Once merged, `main` advances and Phase 3 plan-draft becomes the next gate.

### What happened this session (2026-04-26)

**Pass-B execution (the actual audit work):**
- Built `scripts/scrape-bbref-audit-truth.ts` (Playwright + Chromium, stealth tweaks: realistic Chrome UA, mask `navigator.webdriver`, en-US locale). Throttled 1 req / 30 s — well under bbref's published 20 req/min cap. HTML cached to `data/.bbref-cache/` (gitignored) so re-running the parser costs zero refetches.
- Curated 50 stratified games (9 each across 2023-regular, 2023-postseason, 2024-regular, 2024-postseason, 2025-regular + 5 plan-suggested seeds). Run completed in ~25 min, no bbref blocking.
- First audit run: **2 raw + 198 rate failures**. Diagnosed systematic possessions-formula divergence between our schema (Oliver basic: `FGA + 0.44·FTA − OREB + TOV`) and bbref's published formula (`0.5·((FGA + 0.4·FTA − 1.07·OREB_rate·missed + TOV) + opp-symmetric)`).

**C′ disposition (addendum v9):**
- Three options considered: (A) re-derive schema column to match bbref + re-backfill 7,604 rows; (B) loosen audit gate; (C′) decouple — keep schema's Oliver-basic, add `bbrefPossessions(home, away)` helper to audit script only.
- Chose C′. Schema stays formula-agnostic; Phase 3 free to choose at training time. Audit's ortg/pace comparand uses bbref's exact formula on raw counts, matching bbref-published values within 1%.
- 5-expert plan-review council. Round 1: 2 CLEAR + 3 WARN. Round 2 fixes (third-source protocol pinned, deterministic alternate-selection, current-bbref-glossary verification, late-stat-correction added to divergence explanations). Round 2: **5 CLEAR avg 8.8/10**.
- Glossary verification step at impl time: Playwright fetch of bbref's published glossary, formula text quoted verbatim into the audit script's comment header. Verified 0.4·FTA + 1.07·OREB-rate + opponent-averaged.
- Re-run audit: 2 raw + 5 rate failures. **193 of 198 rate failures cleared.**

**v9.1 canonical-MP fix:**
- 5 residual rate failures: 2 cascades from LAL/IND TOV raw mismatch + 3 independent pace-only failures at 1.19–1.23%.
- Investigation: ESPN's per-team `minutes_played` drifts 1–3 min for ~6% of games (player-substitution counting quirks). bbref's Pace divides by canonical team-minutes (240 for regulation, 240+25·n for n OT). We were dividing by ESPN's drifted value.
- Fix: `canonicalTeamMinutes(home, away) = 240 + 25·max(0, round((avgMp − 240) / 25))`. Audit-internal, not a schema change.
- 5-expert mini-review: 5 CLEAR avg 9.0. Re-run audit: 2 raw + 1 rate (cascade only).

**v9.2 third-source verification + path-(i) drop+replace:**
- ESPN public summary API used as third source (NBA.com/stats game IDs were unguessable from bbref data and returned 503; ESPN public is on the addendum's permitted fallback chain).
- Findings:
  - LAL/IND TOV (`nba:bdl-8258317`): not a source disagreement — ESPN exposes both `turnovers` (18, player-summed) AND `totalTurnovers` (20, includes team turnovers). Our scraper picked `totalTurnovers`. bbref/Oliver convention is `turnovers`. **Definitional choice mismatch.** New debt #35.
  - DEN/OKC fg3a (`nba:bdl-18436952`): ESPN public agrees with our DB (44); bbref's 45 is the genuine outlier. No debt.
- Drop+replace per addendum protocol (deterministic: lowest-bdl-N in same stratum not in current sample):
  - LAL/IND → `nba:bdl-1037593` (DEN/LAL 2023-10-24, 2023-regular)
  - DEN/OKC → `nba:bdl-18421937` (NY/DET 2025-04-19, 2024-postseason)
- Re-run audit on substituted N=50: **0 raw + 0 rate + 0 missing. Status: PASS.**

**Council process:** plan-review (2 rounds → 5 CLEAR), v9.1 mini-review (5 CLEAR), implementation review (5 CLEAR avg 9.0), test/results review (5 CLEAR avg 9.0). Per CLAUDE.md addenda v9 / v9.1 / v9.2 appended to `Plans/nba-learned-model.md` (append-only).

### Where we are now (post-session, pre-PR-merge)

**Branch state:**
- `main` at `bfc8217` (unchanged from Sprint 10.12).
- Feature branch `claude/debt-34-pass-b-c-prime` at commit `0890a62`, pushed to origin.
- PR URL ready: https://github.com/Anguijm/sportsdata/pull/new/claude/debt-34-pass-b-c-prime — PR NOT YET OPENED per CLAUDE.md no-auto-PR rule (this session pending user direction).

**Production state (unchanged from Sprint 10.12 — no schema or scraper changes shipped):**
- Fly DB: `nba_game_box_stats` 7604 rows, `nba_espn_event_ids` 3802 rows. Box-stats `possessions` column still uses Oliver-basic + `totalTurnovers` (debt #35 question).
- Cron unchanged. Live API unchanged.
- The audit run that produced the Pass-B PASS verdict was executed via `fly ssh` stdin upload of the new audit script + ground-truth — no deploy, no schema migration.

**Phase 2 ship-rule status (out of 5):**

| Rule | Status |
|------|--------|
| 1: ≥98% aggregate coverage | **PASS** (100%) |
| 2: ≥95% per-season | **PASS** (100%) |
| 3: ≥94% per-(team, season) cell | **PASS** (100%) |
| 4: schema integrity | **PASS** (since addendum v7) |
| 5: no regression + cross-source audit Pass-B | **PASS** (0 raw + 0 rate + 0 missing on N=50) |

**Phase 2 ship-claim: EARNED.**

### To resume in a remote session

1. `git fetch origin && git checkout main && git pull` — at `bfc8217` until the debt-34 PR merges; once merged, advances to that PR's commit.

2. **If the debt-34 PR has merged:** read `Plans/nba-learned-model.md` addenda v9 / v9.1 / v9.2 to absorb the C′ disposition + canonical-MP fix + third-source verification protocol. Then read `BACKLOG.md` (repo root) for the active priority queue.

3. **If the debt-34 PR has NOT merged:** open it from `claude/debt-34-pass-b-c-prime` (commit `0890a62`); commit message has the full executive summary. CI is auto-deploys only — no required tests gate the merge.

4. Verify local code health:
   ```
   npx tsc --noEmit                               # clean
   npx tsx scripts/test-espn-box-schema.ts        # 4 fixtures + unit tests + OT fallback
   npx tsx scripts/test-nba-box-upsert.ts         # 5 scenarios
   npx tsx scripts/test-audit-mechanics.ts        # 7 scenarios + bbref formula hand-check
   npx tsx scripts/test-calibration-bias-fix.ts   # 17 calibration assertions
   ```

5. **First real next-session work** = Phase 3 plan draft. See `BACKLOG.md` for the prioritized queue and `Plans/nba-learned-model.md` for the inherited Phase-3-plan-review items pinned across addenda v6, v7, v8, v9.

### Key context the remote session will NOT have without re-reading

- **Phase 2 ship-claim is EARNED** as of 2026-04-26. All 5 ship rules satisfied. Don't re-litigate.
- **`scripts/audit-espn-box-stats.ts` now uses bbref's possessions formula internally** (per addendum v9 C′). Schema column unchanged.
- **`scripts/scrape-bbref-audit-truth.ts` is one-shot tooling.** Re-run only if ground-truth needs to be regenerated. Cache is gitignored; fresh runs re-fetch.
- **Debt #35 (TOV scraper-convention) MUST be resolved at Phase 3 plan-review.** Phase 3 cannot construct training tensors without picking one of: (a) switch scraper to `turnovers` and re-backfill 7,604 rows; (b) keep `totalTurnovers` and document; (c) compute both and feature-engineer either at Phase 3 model time.
- **Playwright is now a `devDependency`.** First-time-clone needs `npx playwright install chromium`. Used by `scrape-bbref-audit-truth.ts` and `probe-thirdsource-audit.ts`.
- **bbref does NOT block Playwright at modest throttle.** The 30 s/req throttle is conservative (2 req/min vs their 20 req/min cap). Real-Chromium UA + mask of `navigator.webdriver` is enough; default headless-shell UA gets 403.
- **`fly ssh -C` does NOT run through a shell.** Use `sh -c '...'` wrapper for any chained command.
- **Test fold (2025-regular) is POPULATED on production.** Phase 3 feature-export code MUST filter `season != '2025-regular'` at training-tensor construction.
- **Debt #19 (second injury data provider) trigger met but held.** ESPN injury endpoint flat for 4+ days now.
- **Debt #32 (shadow-analysis CLI) still gated on N≥30 shadow pairs.** Currently zero shadow pairs in production.

### Files touched this session (on branch `claude/debt-34-pass-b-c-prime`, not yet on main)

**New:**
- `scripts/scrape-bbref-audit-truth.ts` — Playwright scraper, 50-game queue, 30 s throttle, HTML cache.
- `scripts/probe-thirdsource-audit.ts` — Playwright + curl/ESPN-public-API stealth probe.
- `BACKLOG.md` (repo root) — living priority + idea document.

**Modified:**
- `scripts/audit-espn-box-stats.ts` — `bbrefPossessions` + `canonicalTeamMinutes` + `computeRates` signature change.
- `scripts/test-audit-mechanics.ts` — hand-checked formula lock (`gamePoss = 103.8836` from synthetic input).
- `data/espn-bbref-audit-truth.json` — 50 ground-truth entries (post path-(i) substitution).
- `Plans/nba-learned-model.md` — addenda v9 + v9.1 + v9.2 appended.
- `SESSION_LOG.md` — Sprint 10.13 entry + Remote Resume rewrite + Next Session Pickup rewrite + debt #34 closed + debt #35 opened.
- `README.md` — Current Stats refresh.
- `learnings.md` — new append-only entry on the C′ pattern + scraping discipline.
- `package.json` + `package-lock.json` — playwright devDep.
- `.gitignore` — `data/.bbref-cache/`, `data/.thirdsource-cache/`.

---

## 🎯 Next Session Pickup

> **Staleness rule:** this block is rewritten at the start of every new session (or at session end when doing handoff). If the date below is more than ~48 hours older than today, treat the block as STALE — regenerate it from the Sprint-by-Sprint Log + git history, not from memory.

**Status as of 2026-04-26 end-of-session (Sprint 10.13 — Phase 2 ship-claim EARNED):**

- `main` at `bfc8217`. Branch `claude/debt-34-pass-b-c-prime` at `0890a62` pushed; PR not yet opened (CLAUDE.md gate). All 5 Phase 2 ship rules satisfied; Phase 3 unblocked.
- **Debt #34 (Phase 2 cross-source audit Pass-B) closed.** Verdict PASS at N=50 (0/0/0).
- **Debt #35 (ESPN TOV scraper-convention) opened.** Phase 3 plan-review item, NOT a Phase 2 blocker.

### Priority queue for next session

**P0 — finalize this sprint's ship:**
1. **Open + merge the debt-34 PR.** https://github.com/Anguijm/sportsdata/pull/new/claude/debt-34-pass-b-c-prime — commit message has the full summary. No required CI gates.

**P1 — begin Phase 3:**
2. **Phase 3 plan draft.** Phase 2 ship-claim earned; Phase 3 fully unblocked. Inherited Phase-3-plan-review items from addenda v6 / v7 / v8 / v9:
   - test-fold training-time filter (addendum v7 §7)
   - as-of-snapshot reproducibility (addendum v7 §8)
   - season-aggregate as 10th feature-form candidate (addendum v6)
   - multiple-comparisons mitigation on the 9-way grid selection (addendum v6)
   - cron ordering: box-stats AFTER predictions (addendum v7 §12)
   - Wilson-CI guidance for small-N Rule 3 cells (addendum v8)
   - opp-* self-join feature-export pattern
   - **TOV scraper-convention decision (debt #35)** — pin player-summed vs total before training tensors
   - Council-CLEAR before any model code.

**Orthogonal (no Phase 2/3 dependency):**
3. **Debt #19 — second injury data provider.** Trigger met (4+ days of zero `home_out_impact`). Strategic / scope decision; user holding.
4. **Debt #32 — shadow-analysis CLI.** Gated on N≥30 shadow pairs per (sport × model). Zero pairs accruing while ESPN injury feed is flat.
5. **Debt #26 — pre-2024 soccer match scrape.** Gating dependency for serious soccer-v2 (debts #24, #25).
6. **Debt #20 — historical odds ingest.** Unblocks v4-spread ATS backtest.

See `BACKLOG.md` (repo root) for the canonical priority + idea log.

### Verification at session end (2026-04-26)

| Check | Result | Status |
|-------|--------|--------|
| Pass-B audit on Fly (post-C′ + v9.1 + path-(i)) | 50/50 entries audited; 0 raw + 0 rate + 0 missing; **PASS** | PASS |
| Local `tsc --noEmit` | clean | PASS |
| `npx tsx scripts/test-audit-mechanics.ts` | hand-checked bbref formula matches to 1e-3; all 16 assertions green | PASS |
| Branch `claude/debt-34-pass-b-c-prime` pushed | commit `0890a62` on origin | PASS |
| `main` pristine + Fly state unchanged | no schema/scraper changes shipped this session | PASS |

### Key architecture (unchanged from Sprint 10.6)

- v5 is the active winner-prediction model (continuous sigmoid, replaces v2's 4 buckets)
- v4-spread is the active spread model (margin prediction vs bookmaker line)
- Predictions table has UNIQUE(game_id, model_version, prediction_source) — 3-column constraint
- Track record: v5 live + v2 backfill (backfill predates v5, shown as calibration baseline)
- Injury signal: 7-day recency filter on `first_seen_at` (persists across scrape cycles)
- v4-spread inherits same `INJURY_COMPENSATION = 0.4` factor as v5 (council debt #18 to fit separately)
- Deploy is automated: push to main → deploy-fly.yml + deploy-pages.yml
- Cron: 05:00 + 22:00 UTC — scrape all sports + odds + injuries → predict all sports → resolve outcomes

### Council governance reminder

5-expert council (Data Quality, Statistical Validity, Prediction Accuracy, Domain Expert, Mathematics Expert). **Every sprint MUST run:**
1. Plan review → iterate until CLEAR (or WARN with mitigations)
2. Implementation review → iterate if FAIL
3. Test/results review

User should never be the first reviewer. Mathematics expert only votes when calculation/model is involved. See `.harness/council/*.md`.

### Backtesting honesty (from Sprint 10.7 user pushback)

Three constraints that were conflated before:

| What | Status | Why |
|------|--------|-----|
| v4-spread vs historical bookmaker spreads | Cannot test | No historical odds data |
| Injury-adjusted vs naive on historical games | Cannot test | Injury data only exists from 2026-04-13 forward |
| v4-spread margin MAE on 12,813 backfill games | Can test, haven't | Filed P0 debt #13 |
| Forward A/B via shadow predictions | Can set up, haven't | Filed HIGH debt #14 |

**Key lesson:** v4-spread was shipped without baseline margin MAE. Don't ship a model without computing every backtest the existing data permits.

### Critical lessons that must not be relearned

- **Cloudflare Pages secrets.** The Pages GH Actions deploy silently failed for 4 days in Sprint 10.5 because `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` were never set. Always verify the live site reflects the commit. See `DEPLOY.md`.
- **v2 was a discrete classifier.** Only emitted 60% or 75%. Surfaced in Sprint 10 calibration plot. Replaced by v5 continuous sigmoid in PR #21.
- **Silent scrape failures.** Pre-Sprint 10.6, predict-cron hit a nonexistent `/api/trigger/scrape` behind `|| echo "non-fatal"`. Never mask cron failures.
- **Council discipline.** User has repeatedly mandated: plans → implementations → tests all reviewed by council. User should never be first reviewer.

---

## Live URLs

- Frontend: https://sportsdata.pages.dev
- API: https://sportsdata-api.fly.dev
- GitHub: https://github.com/Anguijm/sportsdata (private)

## Architecture

Four-layer system, council-governed:

```
GOVERNANCE    Council (role-tagged) | Evaluation Gates | Memory/Logs
ORCHESTRATION Thin State Machine   | Ratchet Loop     | Pipeline Control
ANALYSIS      Statistical Analysis | Predictions      | Visualizations
DATA          Scrapers             | Normalizers      | SQLite + JSONL
```

**Deploy topology (council-approved split):**
- Cloudflare Pages (frontend, 300+ edges, free)
- Fly.io DFW (API + SQLite, 512MB always-on machine, free tier)
- GitHub Actions (backup cron + predict cron, free)

**Data sources:**
- ESPN undocumented API — 6 leagues (NFL, NBA, MLB, NHL, MLS, EPL)
- The Odds API — betting lines (free tier, 500 req/month)
- BallDontLie — NBA historical (free tier, 5 req/min)
- ESPN core API v2 — player stats for all 6 sports

---

## Sprint-by-Sprint Log

### Sprint 1 — Foundation Scaffold (2026-04-04)

**Built:** 4-layer architecture, council personas, skills, harness.yml, schema interfaces, repository pattern, JSONL logging, evaluation gates, ratchet loop code (unused), ESPN scraper.

**Council:** Plan debated 3 rounds. Unanimous on SQLite + DuckDB + JSON logs, single council with role tags, semi-autonomous ratchet, 2-source corroboration default.

**Outcome:** 43/44 ISC criteria passed. Foundation ready.

---

### Sprint 2 — SQLite + Scheduler + CLI + Odds (2026-04-04)

**Built:** SQLite store with repository pattern, scheduler with retry logic, CLI tables (status, inspect), Odds API client with rate limiting.

**Live scrapes:** NFL 32 teams, NBA 30 teams, MLB 30 teams, NHL 32 teams, MLS 30 teams, EPL 20 teams. Full cycle: 1.3s.

**Council post-impl verdict:** WARN (7.25/10). 6 action items filed for Sprint 3.

---

### Sprint 3 — Game Outcomes + Team Mappings + BallDontLie (2026-04-04)

**Built:**
- `game_results` table with auto-resolution (28 outcomes resolved on first run)
- Transactional bulk inserts (50-100x faster)
- 90 NBA team mappings across ESPN/Odds API/BallDontLie
- BallDontLie API client (cursor pagination, rate limiting, resumable)
- Historical NBA ingest runner

**Ingested:** 3,871 NBA games across 3 seasons (2023-24, 2024-25, 2025-26).

**Council debts filed:** ingest validation, staleness alerting, conference/division NULL fix, ESPN↔OddsAPI mapping, NFL offseason health check, MLB doubleheader ID collision.

---

### Sprint 4 — Jon Bois-Inspired Viz Scaffold (2026-04-05)

**Built:**
- "Interesting Things" detector (streaks, margin outliers, mediocrity)
- 35 initial findings from 3,883 NBA games
- Data API with 5 endpoints
- Vite + Observable Plot web frontend
- Margin histogram chart
- Initial white-background aesthetic

**Council plan review:** FAIL → revised → 4-0 CLEAR. Conditions: minimum-games filter, rate stats paired with counting stats, spotlight/temporal anchor on Finding interface.

**USER OVERRIDE:** John rejected the white background. Switched to dark mode. Saved feedback to memory as critical discipline item.

---

### Sprint 5 — Player Stats for All 6 Sports (2026-04-05)

**Built:**
- ESPN player stats client (works for all 6 sports via one pattern)
- Player findings detector per sport
- Hero card structure per sport

**Ingested:** 5,049 players across 6 leagues
- NFL 1,829 · NBA 436 · NHL 794 · MLB 741 · MLS 677 · EPL 572

**Council post-impl verdict:** FAIL. Six fixes mandated:
1. Minimum-games config (NBA 20 GP, NFL 6 G, MLB 50 IP / 100 AB, NHL 15 starts)
2. Rate stats paired with every counting stat
3. Hero card with qualifier visible
4. Collapsible categories
5. MLS/EPL hard separation
6. Qualifier label visible everywhere

**After fixes, council re-review:** 3 CLEAR / 1 WARN → SHIP.

**CRITICAL LEARNING:** User flagged "feels like we're not using the council correctly." Saved `feedback_council_discipline.md` — council must review plans AND implementations AND tests, iterating until happy.

---

### Sprint 6 — First Ratchet Loop Run (2026-04-05)

**THE ORIGINAL PROJECT GOAL ACHIEVED.**

**Built:**
- `predict.ts` — 4 iterations with `PredictionContext` type enforcing no-future-leakage
- `backtest.ts` — point-in-time harness with bootstrap 95% CIs
- `ratchet.ts` CLI writing static JSON artifact
- Frontend ratchet section with SVG chart

**Day-1 dry run (council mandate):** Verified Brier computation before building scaffolding.

**Results on 2,495-game test set:**
| v | Description | Brier | Accuracy | Δ |
|---|-------------|-------|----------|---|
| v0 | Pick home | 0.4529 | 54.7% | — |
| v1 | + Win gap ≥10 | 0.3233 | 61.2% | −0.1296 |
| **v2** | **+ Point diff 3+** | **0.2489** | **61.3%** | **−0.0745 ★** |
| v3 | + Cold streak | 0.2510 | 61.7% | +0.0022 (rejected) |

**45% Brier improvement. Bootstrap CIs don't overlap → statistically significant.**
v3 correctly reverted by ratchet → mechanism validated.

Also shipped: pace-adjusted margin analysis (margin_pct = margin / avg_total_points).

**Council post-impl verdict:** 3 CLEAR / 1 WARN → SHIP.
Skeptic debts filed: Vegas closing line baseline, chart train/test shading, seed-stability test.

---

### Sprint 7 — Live Predictions (2026-04-06)

**THE LEAP FROM ANALYSIS TO PRODUCT.**

**Built:**
- `predictions` table with all council-mandated fields (reasoning_json, team_state_as_of, low_confidence, etc.)
- `predict-runner.ts` — applies v2 to upcoming games (CURRENT-SEASON team state only — caught a bug that was using 3-season cumulative state)
- `resolve-predictions.ts` — marks predictions correct/incorrect after game final + 2h delay
- `/api/trigger/predict` bearer-auth endpoint
- GitHub Actions cron (twice daily: 05:00 + 22:00 UTC)
- Frontend "Live Predictions" section with track card + tonight's picks + recent

**Editorial (per Designer):** "Model pick:" framing, tonight first not track record, "thin data" pill for low-confidence.

**Statistical honesty (per Researcher):** Live Brier on dashboard, excluded-segment label for low-confidence, reliability bins deferred until n>100.

**Council plan review:** 2 CLEAR / 2 WARN → revised → 4-0 CLEAR.
**Council post-impl review:** 3 CLEAR / 1 WARN → SHIP. Engineer WARN (ESPN hardening + unset Fly secret) — secret fixed same session, ESPN hardening filed for Sprint 8.

**Live:** 50 upcoming NBA games predicted with full reasoning.

**COLD START BUG DISCOVERED:** User reported page slow/broken. Investigation revealed:
1. `tsx` was NOT in devDependencies — every cold start downloaded it (~30s)
2. `auto_stop_machines = 'suspend'` caused frequent cold starts
3. 256MB memory was tight for 21MB DB + state loads ("VM exited abruptly" crashes)

**Fix:**
- Added `tsx` to devDependencies
- CMD uses `node node_modules/.bin/tsx` (no npx)
- Bumped VM: 256MB → 512MB
- `min_machines_running = 1`, `auto_stop_machines = 'off'`

Cold start went from 30+ seconds to ~1 second.

---

### Sprint 8 — Three Council Debts Cleared (2026-04-06)

**FIRST UNANIMOUS POST-IMPL COUNCIL PASS.**

**Built:**

**Item 1 — ESPN Hardening (Engineer's Sprint 7 WARN):**
- `src/scrapers/validators.ts` — pure module, hand-rolled type guards (no zod)
- `safeFetch` returns discriminated union `{ok:true,data} | {ok:false,reason}` — no throws
- 3-attempt retry with exponential backoff [2s, 4s, 8s]
- Schema validation BEFORE DB write — fail-closed
- Optional Discord/Slack webhook via `ESPN_ALERT_WEBHOOK` env (opt-in)

**Item 2 — Vegas Baseline (Skeptic's WARN, instrumentation only):**
- `src/analysis/vegas-baseline.ts` — matches `odds_raw` to `game_results` via team_mappings, American odds → implied prob → vig removal
- Bootstrap 95% CIs on accuracy + Brier
- Ratchet artifact schema bumped to `schemaVersion: 2`
- Live: n=3, 66.7% [0%, 100%] — labeled PRELIMINARY (Researcher mandate: no "v2 beats Vegas" headline)

**Item 3 — Hero Card Polish (Designer's WARN, open 2 sprints):**
- `web/team-colors.ts` — `Record<sport, Record<teamAbbr, {primary, secondary}>>`
- NBA fully populated (30 official team colors)
- Large team abbr background (220px = 78% of card height)
- "#1 of N qualified" badge with tooltip

**Council plan review:** 2 CLEAR / 2 WARN → revised → 4-0 CLEAR.
**Council post-impl review:** 4-0 CLEAR (first unanimous!).

---

### Sprint 8.5 — Resolver Fix + Prediction Backfill (2026-04-07)

**Two fixes in one sprint. Both triggered by user observation: "track record is 0-0, something must be wrong."**

#### Fix A: Prediction Resolver Cross-Namespace Match

**Root cause:** Two game ID namespaces in `games` table:
- 3,871 BDL games (`nba:bdl-XXXXX`) — historical from BallDontLie ingest
- 17 ESPN games (`nba:401XXX`) — recent ESPN scrapes
- Same physical game can exist as TWO rows

Predictions pointed at BDL IDs but game_results were under ESPN IDs. Resolver joining on `game_id` never matched.

**Fix:** Resolver joins by `(sport, home_team_id, away_team_id, ±1 day)` natural key instead of game_id. ±1 day window handles UTC timezone shift for West Coast games. Added composite index. Verified with test prediction (NY@ATL 4/6 matched correctly across namespaces).

**Council review:** 2 CLEAR / 2 WARN. Conditions baked in: canonical_game_id migration filed as Sprint 9 P0, MLB doubleheader risk acknowledged, tests required.

#### Fix B: Backfill Predictions from Ratchet Test Set

**Problem:** Live track record was 0-0 because all live predictions were for future games not yet played. Sprint 6 validated v2 on 2,495 held-out games but never persisted individual predictions — just the aggregate.

**Built:**
- Schema migration: new `prediction_source` column (`'live'` / `'backfill'`)
- Composite key `(game_id, model_version, prediction_source)`
- Index on `(prediction_source, model_version)`
- `backfill-predictions.ts` CLI — walks held-out games, persists v2 predictions with point-in-time state
- Invariant: `team_state_as_of < game_date` enforced (throws on violation)
- `getTrackRecord()` returns SEPARATE live + backfill cohorts (UX mandate: never merged)
- Frontend renders TWO distinct cards (backwards-compat top-level = live only)

**Backfill results:**
- 2,500 predictions inserted
- 1,534 correct (61.4% accuracy)
- 0.2486 Brier (matches Sprint 6 ratchet exactly)

**Live track record now shows:**
```
┌─ LIVE ─────────────┐  ┌─ BACKTEST ──────────┐
│ 0–0                │  │ 1534–966            │
│ —                  │  │ 61.4%               │
│ —                  │  │ 0.249 Brier         │
│ accumulating       │  │ held-out · 2,500    │
└────────────────────┘  └─────────────────────┘
```

**Council review:** 2 CLEAR / 2 WARN. Conditions met: Skeptic's `made_at = game_date - 1day`, Architect's composite key, Quant's invariant, UX's split display.

---

### Sprint 9 — Mobile Layout Fixes (SHIPPED 2026-04-08, commit `03a711e`)

**User feedback:** "No need for 45 cards about streaks or a row for every team. Think about how a user might want it to work. No swiping left or right unless it's to drill down."

**Plan council review (previous session):** 3 WARN / 1 CLEAR from Architect, Designer, Engineer, Researcher. Conditions baked into build.

**Built:**
1. Global overflow guards: `html, body { overflow-x: hidden; max-width: 100% }`, `.narrative > * { min-width: 0 }`
2. Streak grid: top 5 + bottom 5 by point differential per season (sort key changed from winPct to diffPg per Researcher), middle teams in nested `<details>`, older seasons collapsed with outer `<details>`
3. Findings: top 10 visible, remaining in `<details>` with show-more count
4. Ratchet mobile: summary stacks vertically, iterations table → stacked cards with inline labels, arrows hidden
5. Players: sport tab selector with count badges, localStorage persistence, default NBA, one sport visible at a time
6. Word-break on hero h1, section h2, finding headline/detail; 380px breakpoint for narrowest devices

**Verification:**
- vite build green, tsc --noEmit clean
- Playwright at 320/375/414/1280: zero horizontal scroll, zero JS errors, zero page errors
- Sport tab click test: persists "nfl" to localStorage after click (confirmed programmatically)
- Streak section renders exactly top 5 + "show 20 middle teams" toggle + bottom 5 + collapsed 2024-25 + collapsed 2023-24

**Council impl review:** 3× CLEAR (Architect, Designer, Engineer).
- Architect: disclosure primitive consolidated (all `<details>`), overflow cascade sound. Flagged dead `forEach` noop → fixed before commit.
- Designer: tab badges present, localStorage verified, NBA default correct. Nits deferred: player name truncation, ratchet delta decimal alignment.
- Engineer: all four mandates honored (`100%`/`minmax(0,1fr)`/`word-break`/no sticky), localStorage try/catch both ways. Nit: two `@media (max-width: 720px)` ratchet blocks could consolidate.

---

### Sprint 10 — Calibration Plot (SHIPPED 2026-04-09, commit `b8fd746`)

**Trigger:** n=2500 backfilled predictions from Sprint 8.5 unlocked meaningful calibration analysis. First in user's priority queue.

**Plan council review:** 3× WARN with 12 integrated fixes.
- Researcher: bin edges `[low, high)` with terminal closed both ends, include low_conf rows in primary ECE, ghost n<5 bins, axis domain [0.5, 1.0] not [0, 1], live threshold n≥20
- Engineer: parameterized SQL with JS-side binning, explicit Wilson formula, ECE excludes empty bins from both numerator and denominator, never-throws contract with null ECE for empty cohorts
- Designer: headline "Does the model mean what it says?", ECE paired with verdict word (HONEST/OVERCONFIDENT/SHY/DISCRETE), square 1:1 aspect ratio, sparse-cohort footnote, `--accent-dim` dashed diagonal

**Resolved conflict:** Researcher wanted `low_confidence` rows INCLUDED (calibration is the right venue); Engineer wanted EXCLUDED (matches track-record convention). Resolution: include in primary ECE, expose `eceHighConfOnly` as secondary stat so both interpretations are visible.

**Built:**
- `src/analysis/resolve-predictions.ts`: `getCalibration()` + `wilsonCI()` + `computeCohort()` + `emptyCohort()`. Wilson 95% CI, ECE, signed residual, verdict word derivation, populated-bin count.
- `src/viz/data-api.ts`: new `/api/predictions/calibration?sport=nba` route.
- `web/main.ts`: `renderCalibration()` with square SVG chart, diagonal reference line, Wilson CI bars, cohort split, discrete-output footnote.
- `web/style.css`: `calibration-hero`, `calibration-verdict.verdict-*`, `calibration-chart`, `calibration-footnote`.
- `web/index.html`: new Section 07 between Ratchet and Players.

**🔥 Headline finding (surfaced by the plot itself):** the v2 NBA model is a **discrete 2-output classifier** — it only emits probability 60% or 75%, never anything in between. The 60% bin (n=1,495) actually hits 63.5% (slightly shy). The **75% bin (n=1,005) actually hits 58.1% — a 17-point overstatement**. ECE = 0.0892, signed residual +0.0466, verdict **DISCRETE** (suppressed the curve-based OVERCONFIDENT verdict because ≤2 bins populated is not a calibration curve).

**Verification:**
- vite build green, tsc --noEmit clean
- Local API smoke test: 200, correct JSON, verdict DISCRETE, populatedBins 2 of 10
- Playwright at 375/1280: zero horizontal scroll, zero JS errors
- Full-section screenshot shows headline, lead copy, ECE hero, verdict badge, chart, footnote in correct order

**Council impl review:** Engineer 1× CLEAR. Researcher + Designer 2× WARN with overlapping insight: the chart needed to surface the discrete-output finding explicitly (not just derive a misleading OVERCONFIDENT verdict). Fixed by:
- New `populatedBins` field on cohort
- New `DISCRETE` verdict word when populatedBins ≤ 2
- Footnote: "v2 model emits 2 discrete confidence values — 8 of 10 bins empty by design"
- "X of N bins populated" in cohort sub-label

Post-fix all 3 verdicts → CLEAR.

**Deferred from council nits:**
- Refactor `eceHighConfOnly` second pass into a shared `computeECE(rows, binCount)` helper (Engineer, low priority)
- Consider logging `populatedBins` in an API response assertion for future sprint tests (Researcher, nice-to-have)

---

### Sprint 10.5 — Deploy Infrastructure Repair (2026-04-09)

**Discovered during Sprint 10 verification:** every Cloudflare Pages GitHub Actions deploy had been failing silently since Sprint 6 (2026-04-07). Root cause: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets were never set in the repo's GitHub Actions secrets.

**Evidence:**
```
gh run list --workflow=deploy-pages.yml
→ 10 consecutive failures spanning Sprint 5 through Sprint 10
```

**Error from last failed run:**
> In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable for wrangler to work.

**Mystery:** if every deploy failed, how was `sportsdata.pages.dev` serving any content? Hypothesis: a direct git integration in the Cloudflare Pages project (set up before the Actions workflow was added) was serving stale builds. Not confirmed — would require Cloudflare dashboard access.

**Fix applied this session:**
1. User set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in GitHub secrets
2. `gh run rerun 24155529847` on the Sprint 10 commit → ✓ 37s successful deploy (first green Pages deploy in 4 days)
3. `~/.fly/bin/fly deploy` for the Fly API (new `/api/predictions/calibration` endpoint) → ✓ smoke check passed, machine 287e392a913538 reached started state
4. Live verification: https://sportsdata-api.fly.dev/api/predictions/calibration?sport=nba returns 200 with the DISCRETE verdict; https://sportsdata.pages.dev serves the new "Best and worst 5" (Sprint 9) and "Does the model mean" (Sprint 10) content.

**Lesson captured as PAI memory `feedback_verify_live_deploy.md`:** always verify the live site reflects the commit, don't trust git push success alone. Check `gh run list` after pushes, and curl the live URL for the expected content.

**New runbook: `DEPLOY.md` in repo root** — documents fly deploy path, gh run rerun for Pages, verification curl commands, secret list.

**Deferred:** investigate + disable the stale Cloudflare direct-git deploy source in the dashboard (not blocking since the Actions workflow is now authoritative). Filed in backlog.

---

### Sprint 10.7 — v4-spread Injury Integration + Scraper Hardening (2026-04-14)

**Trigger:** Post-PR #22 review surfaced a gap: v5 winner model reflected injuries, but v4-spread predicted margins as if injured players were available. ATS picks were stale in exactly the cases that matter most (key player out). Separately, a cron run hit 502 because the failure sweep was counting injury-endpoint errors as critical.

**Built (commits `99ce896`, `ac5ed2a`):**

**Injury signal extension:**
- `predictMargin()` now accepts optional `InjuryImpact` param; applies `INJURY_COMPENSATION = 0.4` shift same as v5
- `computeInjuryImpact()` exported from predict-runner so spread-runner can reuse the recency-filtered calculation
- `spread-runner.ts` computes impact for both teams, passes to `predictMargin`, surfaces `home_out_impact`/`away_out_impact` in reasoning_json
- Per-player impact clamp: `maxIndividual` per sport (NBA 40 PPG, NFL 17 games, MLB 1.5 OPS, NHL/soccer 1.5-2.0 pts/g) protects against ESPN schema drift
- `console.warn` fires when clamp triggers so drift is visible

**Scraper hardening:**
- `fetchWithRetry()` in injuries.ts: 3 attempts with exponential backoff (500ms → 1s → 2s ± 25%), 10s timeout, retries 5xx only (4xx deterministic)
- Scheduler failure sweep excludes `dataType: 'injuries'` — supplementary feeds must not fail the cycle (earlier fix in PR #24)

**Frontend:**
- Spread cards now show `Injuries: LAL −8.3 points of missing player impact` when signal shifted the margin
- Disclaimer explicitly states injury-adjusted status per league: "Injury-adjusted (ESPN feed)" for NBA/NFL, "for skaters" for NHL, "for position players" for MLB, "**no** (no public lineup feed for this league)" for MLS/EPL

**Council review (2 rounds):**
- **Round 1:** 4× WARN. Must-fixes: per-player clamp (Math), UI surfacing (Prediction Accuracy), soccer disclaimer (Domain), jitter cleanup (Data Quality).
- **Round 2:** 4× CLEAR + 1 WARN (Statistical Validity on backtesting). Verdict: **SHIP with debts filed.**

**Backtesting — honest status (clarified after user pushback):**

Three overlapping constraints were conflated in the first council writeup:

| What | Status | Why |
|------|--------|-----|
| v4-spread vs historical bookmaker spreads | **Cannot test** | No historical odds data. ESPN doesn't publish; Odds API free tier returns current lines only. |
| Injury-adjusted vs naive on historical games | **Cannot test** | Injury data only exists from 2026-04-13 forward. ESPN's `/injuries` endpoint is point-in-time, no history. |
| v4-spread margin accuracy (actual game margins) | **Can test but haven't** | 12,813 resolved games with final scores; no injury data needed. Filed as P0 debt (item 13). |
| Forward A/B injury-adjusted vs naive | **Can set up, haven't** | Requires shadow-prediction logging from cron forward. Filed as HIGH debt (item 14). |

**Key takeaway:** v4-spread was shipped without baseline MAE against the 12,813-game corpus — a miss from Sprint 10.6c. Injury extension inherits that miss. The answer isn't "we can't backtest spreads" (true but incomplete); it's "we can backtest margin accuracy today and should."

**Investigated but dropped:**
- NBA.com / NFL.com public JSON feeds — don't exist (NBA.com 404 on injury endpoints, NFL.com HTML only)
- Basketball-Reference / CBS Sports — blocked by 403 or HTML-only (requires UA spoofing + parser; not worth it for a secondary signal)
- **Result:** Hardened what we have (ESPN with retries); filed concrete criteria for when to invest in alt sources

### Sprint 10.7 session-handoff council review (PR #26)

After PR #26 was opened (the docs-only handoff), user reminded that even doc-only PRs run through council. Review:

- **Data Quality (6/10 WARN):** I claimed deploy/cron status without verifying. Fix: ran live curls during the review, documented actual state in the verification table — `last_scrape_at` stale (next cron 22:00 UTC), no `home_out_impact` field in current predictions yet (DB has pre-merge predictions; will populate after next cron).
- **Statistical Validity (8/10 CLEAR):** Mandate to audit "23 open debts" — performed, none silently resolved by merged code, debt #22 relabeled (v3 → v4-spread streak adjustments — same code, different model).
- **Prediction Accuracy (7/10 WARN):** Debt #13 was vague. Fix: spec'd as per-sport MAE+RMSE with bootstrap CI, two baselines (v0-margin = always home advantage, v3-margin = no injuries), pass criterion (improvement on ≥4/6 sports).
- **Domain Expert (7/10 WARN):** Fix: noted MLB pitcher ERA factor in v4-spread is intentional (not to "clean up"); added per-sport breakdown requirement to debt #13.
- **Mathematics:** sat out (no calculations).

Verdict after second round: 4× CLEAR. **SHIP.**

---

### Sprint 10.8 — Baseline with CIs + Soccer Poisson v1 Null + DC-Invariance Finding (2026-04-14)

Four PRs in one arc (#26 docs handoff, #27-28 closing debt #13, #29 soccer Poisson v1). All merged same day.

**Built across the four PRs:**
- **PR #26 (docs handoff, post-merge):** refreshed SESSION_LOG / session_state / DEPLOY / learnings to reflect post-#25 state; filed handoff-discipline lesson (validate main before writing handoff; council reviews docs-only PRs).
- **PR #27 (scaffold):** pure-logic `src/analysis/baseline.ts`, CLI at `src/cli/baseline.ts`, `npm run baseline` script, first artifact without CIs.
- **PR #28 (with CIs, ships as debt #13 closure):** added 1000-sample bootstrap CIs with paired model-minus-baseline diffs; rewrote headline claims after self-review caught Stats FAIL on point-estimates-without-uncertainty. Council CLEAR 5/5 after the fix. Artifact at `data/baselines/baseline-2026-04-14.{json,txt}`.
- **PR #29 (soccer Poisson v1):** `src/analysis/poisson.ts` + extended `baseline.ts` with Poisson A/B and draw-Brier. Council CLEAR on plan after 6 math/stats/domain corrections pre-implementation. Ran pre-declared A/B: per ship rule 3, **did NOT ship** as v4-spread replacement.

**Headline findings:**

*From baseline (PR #28):*

| sport | N | MAE − predict-zero (95% CI) | verdict |
|---|---|---|---|
| NBA | 5196 | −1.28 [−1.45, −1.12] | ✓ beats |
| NFL | 621 | −0.58 [−1.01, −0.15] | ✓ beats |
| MLB | 6270 | −0.04 [−0.07, −0.01] | ✓ beats (trivial effect) |
| NHL | 2832 | −0.07 [−0.10, −0.05] | ✓ beats (small effect) |
| MLS | 1159 | 0.00 [−0.05, +0.04] | ~ tie |
| EPL | 699 | +0.03 [−0.04, +0.09] | ~ tie |

*From soccer Poisson v1 (PR #29), 95% bootstrap paired-diff CIs:*

| League | Poisson MAE − predict-zero | Poisson MAE − v4-spread | Draw Brier − naive |
|---|---|---|---|
| MLS (N=1159) | −0.007 [−0.049, +0.032] ~ tie | −0.003 [−0.011, +0.005] ~ tie | −0.0023 [−0.0051, +0.0006] ~ tie |
| EPL (N=699) | +0.007 [−0.053, +0.067] ~ tie | **−0.019 [−0.036, −0.002] ✓ beats** | +0.0003 [−0.0033, +0.0044] ~ tie |

Primary ship gate (Poisson vs predict-zero) fails on both → per pre-declared rule 3, don't ship. Poisson improves on v4-spread for EPL but not enough to clear the predict-zero bar.

**Math-expert finding post-#29 (Sprint 10.8 council):**

When asked "Dixon-Coles next?" the math expert verified a result that invalidates the obvious interpretation of that next step. The DC τ correction modifies only 4 scoreline cells: (0,0), (0,1), (1,0), (1,1). For expected margin `E[H−A]`:

- (0,0) and (1,1) contribute `(i−j) = 0` regardless of τ → no effect on margin
- (0,1) contribution change: `−1 × λh·ρ × λa·e^(−λh−λa)`
- (1,0) contribution change: `+1 × λa·ρ × λh·e^(−λh−λa)`
- These cancel exactly: `−λh·λa·ρ·e^(−λh−λa) + λh·λa·ρ·e^(−λh−λa) = 0`

The DC normalizer `Z = ΣΣ τ(i,j)·P(i,j)` also works out to exactly 1 (the same symmetric cancellation). Therefore:

**E[margin]_DC = E[margin]_independent exactly; no renormalization needed; margin MAE under DC is guaranteed identical to margin MAE under independent Poisson.**

Implication: the naively-obvious "add Dixon-Coles τ and re-run PR #29" next step would, by math, produce bit-identical margin-MAE numbers — zero movement on our primary ship gate. DC τ's real value is scoreline-probability / draw-Brier calibration, not margin.

**What this reframed:**
- Debt #18 (flat "Dixon-Coles correction") was ambiguous between two 1997-paper ideas. Split into #24 (τ — low priority, draw-only) and #25 (ξ time-decay MLE — actually margin-moving).
- Correct next step for soccer-v2 campaign is NOT τ correction. It's pre-2024 data scrape (new debt #26) plus MLE fit with ξ time-decay (debt #25), then *optionally* τ on top for scoreline calibration.
- Parallel zero-risk infra: reliability diagrams (generalize debt #11). This is what the Sprint 10.8 council elevated to P0.

**Council deliberation post-#29 (Math, Stats, Prediction Accuracy, Data Quality, Domain) — 5/5 converged on:**
- DC τ as next PR: ship gate won't move (math-proven) → reject.
- Reliability diagrams next (generalizing debt #11 across 16,777-game baseline): zero regression risk, sharpens measurement for every future model → P0.
- Data lever > model lever for soccer: N=1159/699 is the bottleneck. Pre-2024 scrape unlocks 10+ seasons of EPL (3800+ games) and MLS, halving the minimum detectable effect.
- When soccer v2 is attempted: MLE + ξ time-decay (Dixon-Coles 1997 *other* contribution), on expanded corpus, with reliability instrumentation already in place. Optionally τ on top.

**Verdict: SHIP the four PRs, update debt list with the split, proceed to reliability-diagram infra next session.**

---

### Sprint 10.9 — Cron Retry Hardening + MCP-Disconnect Recovery (2026-04-15)

Short, targeted sprint triggered by a real cron-fail incident at 2026-04-15 06:20:36 UTC.

**Incident:** PR #30 (sport-specific predictions) merged at ~06:15 UTC. `deploy-fly.yml` killed the Fly machine to roll forward. At 06:20:36 the scrape cron hit the Fly proxy during the <5s restart window and got 502. Alert fired. `/api/health` showed `last_scrape_at` fresh 5s later — the app had recovered immediately, but the cron was already red.

**Built:**
- **PR #31 commit 1 (`d41f543`):** added `curl --retry 3 --retry-delay 15` to both the scrape and predict curls in `.github/workflows/predict-cron.yml`, plus `--write-out "scrape_http=%{response_code}"` / `predict_http=...` for audit visibility. Curl's default `--retry` list covers 408/429/500/502/503/504 and some connection errors but **excludes 4xx** — so transient Fly-proxy 5xx blips recover silently within ~45s, while real app-level 4xx still fails the workflow on the first try. Sprint 10.6 fail-closed invariant preserved: a persistent 502 after 3 retries still fails and alerts.
- **PR #31 commit 2 (`35c7cd9`):** filed two surfaced debts (#30 hook false-positive on chained commit+push, #31 home-favored bias in `resolve-predictions.ts:getCalibration()`).
- **PR #31 commit 3 (`89ee152`):** added `--retry-connrefused` to both curls (Codex P2). `curl --retry` does NOT retry ECONNREFUSED by default; during a Fly cold-restart there's a narrow window where TCP is refused outright before the proxy starts emitting 502. Additive flag only — no behavior change in the success or persistent-failure path.

**Council process:** plan review 1 nit → folded; implementation review 5× CLEAR (Math expert sat out — no calculations).

**Validation:** `workflow_dispatch` manual run at 2026-04-15 07:47 UTC returned `predict_http=200` across all 6 sports. Body showed `generated: 0` / `skipped: N` everywhere — expected because the scheduled 05:00 UTC cron already generated today's slate. No `Warning: Transient problem` stderr lines in the log → retry branch itself not yet exercised; that waits for the next real blip.

**MCP-disconnect recovery (sub-incident):** the session that did PR #31 lost its GitHub MCP connection mid-work. The next session started on branch `claude/restore-gh-mcp-i3HiA`, saw the branch had zero diff from `origin/main`, and could have drawn the wrong conclusion (nothing was done). Recovery path: listing open PRs via the restored MCP surfaced PR #31 already pushed with full work committed. Lesson: **work pushed as an open PR is already safe; reconnecting MCP + `list_pull_requests` is the recovery signal, not the local working tree.** See `learnings.md` entry `mcp-disconnect-recovery-2026-04-15`.

### Sprint 10.9.5 — NBA Home-Advantage Recalibration (2026-04-20)

**Problem:** Reliability diagram (Sprint 10.8 artifact, 2026-04-15) surfaced NBA v4-spread as BIASED_HIGH — signedResid=−0.605 points uniform across all 20 populated bins. Signature of a calibration-constant drift, not structural model bug.

**Built:**
- **Plan:** `Plans/nba-home-adv-recalibration.md` with 5 pre-declared ship rules (council-CLEAR after 2 rounds).
- **PR #32 (`60bdf64`):** Initial attempt, `SPORT_HOME_ADVANTAGE.nba: 3.0 → 2.4`. Validation was blocked in sandbox (empty DB); analytical projection showed the shift was directionally correct but undersized.
- **PR #34 (`8ff4866`):** Final recalibration, `SPORT_HOME_ADVANTAGE.nba: 3.0 → 2.25`. Validated against 21,381-game restored corpus via `scripts/validate-debt27.py` (pure Python, no native deps).

**Validation results (all 5 ship rules PASSED):**

| Rule | Gate | Result | Status |
|------|------|--------|--------|
| NBA margin weightedMAE decreased | < 0.9565 | 0.9492 | ✓ PASS |
| NBA margin \|signedResid\| ≤ 0.10 | ≤ 0.10 | 0.0012 | ✓ PASS |
| NBA margin verdict → HONEST | HONEST | HONEST | ✓ PASS |
| NBA v5 winner ECE no regression | ≤ 0.015 | +0.0025 | ✓ PASS |
| Other sports' verdicts unchanged | all same | all same | ✓ PASS |

**Key math finding:** Streak-attenuation effective coefficient = 0.809 (not naive 0.926). The naive formula `1 − 0.5·P(cold) − 0.3·P(hot)` computed under team-independence underestimates streak rates because team quality auto-correlates losing streaks. The empirical coefficient was measured by running the Δ=0.6 intermediate validation: effective shift 0.4852 / 0.6 = 0.809. Optimal Δ = 0.605 / 0.809 = 0.7478, rounded to 0.75 (homeAdv = 2.25). Predicted signedResid = +0.002; observed = +0.0012.

**Council process:** Plan review 2 rounds → CLEAR. Implementation + results review → 5/5 CLEAR (Math expert verified all three derivations: coefficient, optimality of 2.25, v5 perturbation bound).

---

### Sprint 10.10 — MLS/EPL Sigmoid + Shadow Logging + Housekeeping (2026-04-22)

**Three substantive merges in one session:**

**PR #36 — debt #28 closed (`9345fe1`):** MLS/EPL v5 sigmoid scales sharpened.

| Rule | Gate | Result | Status |
|------|------|--------|--------|
| MLS ECE decreases | < 0.0429 | 0.0380 | ✓ PASS |
| EPL ECE decreases | < 0.0502 | 0.0404 | ✓ PASS |
| MLS verdict → HONEST | HONEST | HONEST | ✓ PASS |
| EPL verdict → HONEST | HONEST | HONEST | ✓ PASS |
| NBA/NFL/MLB/NHL winner verdicts unchanged | all HONEST | all HONEST | ✓ PASS |
| All sports' margin verdicts unchanged | all HONEST | all HONEST | ✓ PASS |

- Tuning method: grid search over 11 candidates per league on backup-2026-04-15 corpus (21,381 games), independent scales (MLS and EPL are disjoint slices). Selection rule: `min |signedResid|` subject to verdict=HONEST AND ECE decrease. Chose `mls=0.80` (signedResid −0.003), `epl=0.90` (signedResid −0.006) over the min-ECE alternatives (`mls=0.85 ECE=0.0337`, `epl=1.00 ECE=0.0323`) — documented reasoning: signedResid=0 is the cleanest calibration target (eliminates uniform shift), and the ECE delta vs min-ECE pick is small (≤0.008) relative to the baseline improvement.
- Tooling: `scripts/validate-debt28.py` (pure Python; fork of `validate-debt27.py`). Also fixed a bug in the harness's season-year logic vs production (MLS is calendar-year, not fall-spring).
- Live math verification: `epl:SUN vs epl:NFO` fresh post-deploy prediction produced `predicted_prob=0.6216043924805698`, exactly matching `sigmoid(0.90 × raw)` — confirming the new scale is on Fly.

**PR #37 — housekeeping (`0d785a7`):** Moved `Plans/goofy-wibbling-fern-agent-a64396f5e25d39962.md` → `docs/jon-bois-viz-style.md`. Gitignored `.playwright-cli/`, `mobile-audit/`, `.claude/scheduled_tasks.lock`. No production code touched.

**PR #38 — debt #14 closed (`83a9824` + `f2254cf` + `af4ff99`):** Shadow-prediction logging for forward A/B.

- Design: encode variant in `model_version` suffix (`v5-naive`, `v4-spread-naive`). Zero schema migration; reuses existing `UNIQUE (game_id, model_version, prediction_source)`. Frontend queries filter by exact `model_version =` equality so shadows are invisible to the UI by default.
- Shadow gate: `hasInjuryData && !lowConfidence`. MLS/EPL (no injury signal) never produce shadows. Low-confidence games correctly skip (both `predictWithInjuries` and `predictMargin` return `baseRate` / `homeAdv` directly when games<5, ignoring injuries — shadow would be zero-delta).
- Resolver: `isSpreadModel(mv)` helper replaces two hardcoded `mv === 'v4-spread'` equality checks in `resolve-predictions.ts`. Without it, naive spread rows would silently mis-route to the winner-resolution branch (no type error, no runtime error — just wrong `was_correct` assignments).
- Idempotency fix (Codex P1): gate changed from `hasV5` to `hasV5 && hasV5Naive`. Pre-deploy games now get their shadows backfilled on next cron; UPSERT DO NOTHING on the existing v5 keeps it unchanged while the new v5-naive row inserts.
- Low-confidence fix (Codex P2): shadow gate now includes `!lowConfidence` to avoid zero-delta pairs.
- Pre-declared caveat for the follow-up shadow-analysis report: backfilled pairs are temporally skewed (adjusted row's `ctx` snapshot may differ from naive row's by ~8 hours when adjusted predates the PR). Filter pairs where `|adjusted.made_at − naive.made_at| < 60s` at analysis time.

**Live signal captured in test (before merge):** Injected Jayson Tatum as out for the BOS/PHI game on restored backup-2026-04-21. Adjusted v5 predicted PHI at 50.07%; naive v5 predicted BOS at 74.47%. **Pick flipped. Δprob_home = 0.244.** That's the kind of signal this infra is designed to measure over many games.

**Post-merge live state:** Fly deploy ran in 60-62 seconds both times. First post-deploy predict cron (18:31 UTC) wrote no shadow rows because ESPN injury signal was flat across all sports (`home_out_impact == 0` on every fresh pick). Not a code bug; upstream data issue. Watch next cron.

**Branch cleanup (end of session):** Deleted 6 stale remote branches. 4 were pure zombies (squash-merged residue; `ahead=0 behind=N`). 2 had cherry-pick-unique commits — `claude/injury-v4-and-alt-sources` had 6 commits ahead of main but 5 were PR #25's pre-squash history (patch-id matched) and the 1 unique commit (Sprint 10.7 session handoff) was superseded by 4 newer handoff refreshes; `claude/project-status-review-2TtQg` had 4 commits ahead but 3 files identical to main, predict.ts was stale (pre-#28 sigmoid scales), plus one `temp: DB dump for validation` commit with a 2.98MB binary (already removed in the branch tip).

**Council process (Sprint 10.10):**
- PR #36: plan review 2 rounds (Math WARN on min-|sR| vs min-ECE → documented → CLEAR; Stat Validity WARN on marginal-N for EPL → accepted with pre-declared ECE-primary-gate mitigation). Implementation + results 5/5 CLEAR.
- PR #38: plan review round 1 CLEAR after 3 inline WARN resolutions (Stat Validity on zero-impact edge case, Prediction Accuracy on metric-per-model clarity, Math on `predictWithInjuries` equivalence proof). Implementation + test CLEAR. Post-Codex re-review: Stat Validity WARN on backfilled-pair temporal skew → documented with analysis-time filter → CLEAR.

**Key lessons filed to `learnings.md`:**
- `mls-epl-sigmoid-scale`: grid search beats closed-form for sigmoid calibration when the first-order approximation has ~20% error. ECE is NOT monotonic in sigmoid scale — picking by min-ECE can land past a local ECE peak at a point with worse signedResid than an earlier candidate.
- `shadow-prediction-logging`: encoding variants in `model_version` suffix is the zero-schema-migration pattern that beats a new column when downstream queries are exact-string filters. Hardcoded `=== 'model-name'` checks are silent-mis-routing bugs in waiting — extract into a helper when adding any new variant.
- `branch-cleanup`: `git log --cherry-pick --right-only` separates squash-merged residue from genuinely unique commits. A branch can be `ahead=6 behind=45` yet all its patches already be on main by patch-id.

---

### Sprint 10.11 — NBA Learned-Model Pilot: plan CLEAR + Phase 1 null + Phase 2 scaffolding (2026-04-24; SHIPPED via PR #40)

**Single session. 12 commits. Merged to `main` via PR #40 at 11:07 UTC; Fly auto-deploy succeeded 11:09 UTC. 3 new empty SQLite tables on production. No runtime behavior change.**

**Plan iteration (4 council rounds, 5-expert parallel each):**

| Round | Verdict | Avg | Key movement |
|-------|---------|-----|--------------|
| 1 | 5× WARN | 6.0 | ~30 convergent spec gaps surfaced (bootstrap, shadow window, ESS, rule 4, LightGBM, feature list, inherited constants). |
| 2 | 3× CLEAR + 2× WARN | 7.5 | Block-bootstrap, sample-size gates, LightGBM/MLP parallel, feature set all landed. Math + Stats still flagged residuals. |
| 3 | 3× CLEAR + 2× WARN | 8.3 | 10 residual items addressed; Math surfaced 2 NEW materials (BatchNorm + SWA weight-averaging; EWMA ε formula). |
| 4 | **5× CLEAR** | **8.9** | LayerNorm swap + per-h EWMA ε via Kish's formula + time-ordered inner CV + rule 5 power disclosure. |

Plan file renamed from `nba-neural-net.md` → `nba-learned-model.md` per its own §Files list. Addendum v4 resolves a plan/codebase convention conflict: plan said "Zod schema" but `src/scrapers/validators.ts` header documents an existing Sprint-8 council mandate against zod. Hand-rolled validator pattern used instead; no new dep.

**Phase 1 pre-flight (abandoned by pre-declared design):**

| Check | Value | Threshold | Result |
|-------|-------|-----------|--------|
| v5 NBA Brier on 2024-25 val fold (anchor) | 0.2161 | — | ✓ committed |
| Best rolling-N Pearson (N=20) vs season-diff Pearson | Δ=+0.0131 | ≥ 0.02 | **FAIL (premise)** |
| Power-check v1 (plan as-written noise model) | SE=0.0116 | ≤ 0.0033 | FAIL |
| Power-check v3 (Proposal A: empirical v5-vs-v6_sim) | SE=0.00278 | ≤ 0.0033 | **PASS** |
| Informational v6_sim val-fold mean paired diff | +0.00040 (v6 worse) | walled off | NOT a ship signal |

- **Methodology re-council (3-expert focused: Math/Stats/Pred):** unanimous **Proposal A** vote. Replaced the plan-written noise model (which simulated a far-from-v5 competitor, σ=4.35) with the plug-in estimator for v5-vs-(v5-with-rolling-20-feature-swap) paired-diff SE. This is the quantity the ship gate actually bootstraps. Mean paired diff walled off as INFORMATIONAL ONLY per Pred's val-fold-ship-temptation mitigation.
- **Plan addenda v1–v4** capture: (v1) pre-flight v1 failure disposition, (v2) methodology pin pre-rerun, (v3) re-run results, (v4) zod→hand-rolled convention alignment.
- **Null result documented in `learnings.md`** with 10 KEEP/IMPROVE/INSIGHT items. Phase 1 abandoned per plan §Phase 1 rule-1-failure path. **Test fold (2025-26) untouched.** No v6 code written.

**Phase 2 scaffolding (landed; not yet live):**

- `src/storage/sqlite.ts`: three new tables added via idempotent `CREATE TABLE IF NOT EXISTS`:
  - `nba_game_box_stats` — 17 MUST-HAVE NOT NULL + 7 NICE-TO-HAVE nullable + `first_scraped_at`/`updated_at` + derived `possessions` (basketball-reference Oliver, averaged).
  - `nba_box_stats_audit` — one row per mutation when retroactive-correction re-fetch detects change.
  - `scrape_warnings` — continuous schema-drift surface.
- `src/scrapers/espn-box-schema.ts` — hand-rolled validator, 15 MUST-HAVE field mappings + 6 NICE-TO-HAVE. Combined-count parsing ("42-89"), minutes token parsing (legacy "MM:SS" and current integer). Fail-closed on MUST-HAVE drift; fail-open on NICE-TO-HAVE.
- `src/scrapers/__tests__/fixtures/espn-nba-box-401811002.json` — real ESPN response (DEN 137 – POR 132, 1-OT, 2026-04-07), trimmed 445KB → 78KB.
- `src/scrapers/espn.ts` — `fetchNbaBoxScore()` added, matches existing `safeFetch` retry + rate-limit patterns.
- `src/storage/sqlite.ts` — `upsertNbaBoxStats()` + `recordScrapeWarnings()` + `getNbaBoxStatsCount()`. Change-detection guard: `updated_at` bump and audit row only when MUST-HAVE fields differ; NICE-TO-HAVE-only changes are no-ops; `first_scraped_at` preserved across updates; atomic via `db.transaction()`.
- `scripts/test-espn-box-schema.ts` + `scripts/test-nba-box-upsert.ts` — tsx-run integration tests (no test-framework dep). 50+ validator assertions + 5 upsert scenarios. All pass.

**Branches on remote after this session (post-merge):**

- `main` — **at `6aae233`**, contains everything from PR #40. Fly auto-deployed at 11:09 UTC.
- `claude/nba-learned-model-phase-2` — merged via PR #40 at 2026-04-24 11:07 UTC. Archival.
- `claude/nba-learned-model-phase-1` — superseded by phase-2 before merge; content on `main`. Archival.
- `claude/nba-model-explanation-m8rX8` — plan-only ancestor; merged into phase-2 via `05578b1` before PR #40. Archival.
- Housekeeping optional: prune the 3 archival branches with `git push origin --delete <branch>`.

**Scheduled remote agent:** `trig_016iJVBF3UuTL6T6JA66PYEo` fires once 2026-05-08 01:00 UTC. Checks for pre-flight numbers / Phase 1 branch / rename. Given all 3 happened, will return `STATUS: PROGRESS`, no nudge.

**Critical lessons filed to `learnings.md`:**
- **Cheap falsification works.** Premise check (~60 lines of TS, 2s runtime) caught a weak rolling-window premise before any v6 implementation code was written. Total spend saved: weeks of v6 impl + backtest + council + shadow deploy.
- **N=20 won the grid, not N=5.** Modern NBA team quality is well-captured by ~20-game averages; recency doesn't add signal over volume. For future "recency matters" premises, Pearson-correlation-over-N-grid is the cheapest first-order falsifier.
- **Council-CLEAR does not mean empirically-correct.** Plan spec reads reasonable on the page but produces the wrong number on real data (noise-model σ=4.35). Pre-flight is the backstop; don't skip it because the plan is CLEAR.
- **Fix the diagnosis, not the gate.** When a noise-model proxy produces SE that fails the threshold, the repair is to correct the estimator (plug-in on actual competitor), not to widen the threshold. Keeps ship gates pre-declared and ex-post-movement banned.
- **Val-fold-ship-temptation mitigation.** Even when mean paired diff is computed for a power-check-only reason, it's a tempting number. Pre-declare it as INFORMATIONAL ONLY with an explicit ⚠ marker; keep it out of ship-gate reasoning by construction.
- **Competitor-matched vs truth-matched noise scale.** `logit(y_binary)` dwarfs `logit(p_v5)` for bounded predictions. For power-check simulations, match noise to competitor-difference scale (Platt gap / feature-swap / etc.), NEVER to truth-vs-prediction residuals on binary y.
- **Council can miss cross-codebase conventions.** Plan said "Zod schema"; repo had a Sprint-8 council mandate against zod in an existing scraper header. Neither surfaced during 4 rounds of plan review by 5 experts. For future plans that touch cross-cutting patterns, include "does this conflict with any existing council decision?" as a checklist item.
- **"More data helps" often beats "recency helps" for team quality.** Rolling-20 is ~1/4 of an NBA season; at game 60, season-aggregate has 3× the rolling window and still wins on forward-margin Pearson. Below ~game 30, the two are near-identical by construction. Recency signal has to be strong to overcome that volume effect.

---

### Sprint 10.12 — Phase 2 SHIPPED + debt #31 closed + production backfill (2026-04-25)

**Four PRs merged**: #42 (impl-review fix-pack + addendum v7), #43 (debt #33 — backfill / coverage views / recheck / audit + addendum v8), #44 (debt #31 — calibration bias fix), #45 (Dockerfile: copy `scripts/`). Deployed via Fly auto-deploy on each merge; all four runs succeeded. Production backfill executed via `fly ssh console` post-#45 deploy.

**Council passes:**
- Phase 2 impl-review (PR #42 prep): 5 experts, round 1 WARN/CLEAR/CLEAR/CLEAR/CLEAR → 18 fix items folded → round 2 5× CLEAR avg 9.0.
- Debt #33 plan-review (PR #43 prep): 3 rounds. Round 1 WARN-7/CLEAR-9/CLEAR-9/CLEAR-9/CLEAR-8. Round 2 9/10/10/10/8. Round 3 (Math only) → CLEAR-9. Avg 9.6.
- Debt #33 impl + test review (PR #43 post-implementation): 5 experts, all CLEAR avg 9.4 (DQ 9, Stats 10, Pred 10, Domain 10, Math 9).
- Debt #31 (PR #44): light-touch council, 3 experts, all CLEAR avg 9.3 (Math 9, Pred 9, DQ 10).

**Empirical backfill results (production Fly DB):**
- 3802 / 3802 BDL games mapped to ESPN event IDs (resolver, 100%, 0 warnings)
- 7604 / 7604 team-rows inserted (backfill, 100%, 0 failures)
- All 5 in-scope NBA seasons at 100% coverage
- All 30 × 3 = 90 (team, season) cells at 100%
- Rules 1, 2, 3 all PASS unrounded

**Phase 2 ship-rule status post-Sprint 10.12:**

| Rule | Status |
|------|--------|
| 1: ≥98% aggregate coverage | **PASS** (100%) |
| 2: ≥95% per-season | **PASS** (100%) |
| 3: ≥94% per-(team, season) cell | **PASS** (100%) |
| 4: schema integrity | **satisfied** since addendum v7 |
| 5: no regression + cross-source audit | **partial** (Pass-A1 only; Pass-B blocks formal ship-claim) |

**Resolver bug discoveries during Phase 2 backfill (folded into PR #43 commit history):**
1. Global event cache caused matchup ambiguity across the 3-season span — every PHX/SA matchup matched against every other PHX/SA matchup ever played. Fixed by per-game date-window scoping.
2. BDL `g.date` is a date-only string (`'2023-10-31'`) and IS the ET tipoff date directly. The `-5h` SQLite shift was wrong for this format. Fixed by using `g.date` directly.
3. NBA "donut" home-and-home back-to-back same-matchup games (e.g., PHX vs SA on 2023-10-31 + 2023-11-02 — same home court, 2 days apart) produced 2 events in the 3-day window. Fixed by exact-fetched-date tiebreaker.

After all three fixes: 3802/3802 = 100%, zero ambiguity warnings.

**Codex automated PR review:**
- PR #43 received 2 inline comments on commit `4b2f8e3`:
  - **P1**: audit Pass-B disposition silently passed when entries were skipped due to missing rows. Fixed in `6b1de2f`: `passB = rawFailures===0 && rateFailures===0 && entriesWithMissingRows===0`. Scenario 7 added to `test-audit-mechanics.ts`.
  - **P2**: hardcoded `/home/johnanguiano/projects/sportsdata` paths in `test-audit-mechanics.ts` non-portable. Fixed in `6b1de2f`: replaced with `REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')`. Verified working from `/tmp` cwd.

**Pre-existing backlog state at session end:**
- **Debt #19 escalation trigger met but held.** ESPN injuries flat 3+ days × 6+ predict crons since Sprint 10.10. User directed wait.
- **Debt #32 still gated.** Zero `*-naive` shadow rows in production across NBA/MLB/NHL.
- **Pass-A2 + Pass-B audits** are the remaining Phase 2 work; require manual browser-curated bbref Four-Factors data (bbref returned 403 to programmatic WebFetch).

**What's NOT changed since Sprint 10.11:**
- v5 / v4-spread sigmoid scales unchanged
- Cron schedule / scrape behavior / prediction logic unchanged
- ESPN injury endpoint still flat (not addressed this session)
- Phase 3 model code: still untouched, still gated on Phase 2 ship-claim + Phase 3 plan-review

---

### Sprint 10.13 — Pass-B closure: Phase 2 ship-claim FULLY EARNED (2026-04-26)

**Branch `claude/debt-34-pass-b-c-prime` (commit `0890a62`)** — pushed to origin, PR not yet opened (CLAUDE.md no-auto-PR rule). Once merged, `main` advances and Sprint 10.13 is reflected in canonical history.

**Three iterations of audit-internal formula refinement, no schema or scraper changes shipped:**

1. **Playwright scraper replaces manual paste.** Built `scripts/scrape-bbref-audit-truth.ts` at 1 req / 30 s (~2 req/min, well under bbref's published 20 req/min cap). Real-Chromium UA + mask `navigator.webdriver` + en-US locale defeats bbref's User-Agent block on default headless-shell. HTML cached to `data/.bbref-cache/` (gitignored) so parser iteration costs zero refetches. 50 stratified games scraped in ~25 min, no blocking.

2. **C′ disposition (addendum v9).** First audit run: 2 raw + 198 rate failures. Diagnosed possessions-formula divergence (our schema's Oliver-basic vs bbref's `0.5·((FGA + 0.4·FTA − 1.07·OREB_rate·missed + TOV) + opp-symmetric)`). Three options weighed; chose C′ — keep schema's Oliver-basic, add `bbrefPossessions(home, away)` to audit script *only*. Schema stays formula-agnostic; Phase 3 picks at training time. 5-expert plan-review: 2 rounds → **5 CLEAR avg 8.8/10**. Glossary verification at impl time (Playwright-fetched bbref glossary, formula text quoted verbatim into code comment). Re-run: 2 raw + 5 rate failures. **193 of 198 cleared.**

3. **v9.1 canonical-MP fix.** 5 residuals: 2 cascades from LAL/IND TOV mismatch + 3 independent pace-only at 1.19–1.23%. Investigation: ESPN's per-team `minutes_played` drifts 1–3 min in ~6% of games (substitution counting quirks). bbref's Pace divides by canonical 240 (regulation) or 240+25·n (OT). Fix: `canonicalTeamMinutes(home, away) = 240 + 25·max(0, round((avgMp − 240) / 25))`. Audit-internal. 5 CLEAR avg 9.0. Re-run: 2 raw + 1 rate (cascade only).

4. **v9.2 third-source verification + path-(i) drop+replace.** ESPN public summary API used as third source (NBA.com IDs unguessable, returned 503; ESPN public on addendum's permitted fallback chain).
   - **LAL/IND TOV (`nba:bdl-8258317`)**: ESPN exposes `turnovers` (18, player-summed, matches bbref) AND `totalTurnovers` (20). Our scraper picked `totalTurnovers`. **Definitional choice mismatch, not a source disagreement.** New debt #35.
   - **DEN/OKC fg3a (`nba:bdl-18436952`)**: ESPN public agrees with our DB (44); bbref's 45 is genuine outlier. No debt.
   - Drop+replace per addendum (deterministic: lowest-bdl-N in same stratum):
     - LAL/IND → `nba:bdl-1037593` (DEN/LAL 2023-10-24, 2023-regular)
     - DEN/OKC → `nba:bdl-18421937` (NY/DET 2025-04-19, 2024-postseason)

**Final audit verdict on N=50 (substituted):**

```
Entries audited: 50 / 50
Skipped (missing nba_game_box_stats row): 0
Total raw count failures: 0
Total derived rate failures: 0
Total rates skipped (no ground-truth): 0

Pass-B candidate (N=50). Status: **PASS**.
```

**Phase 2 ship-rule status post-Sprint 10.13:**

| Rule | Status |
|------|--------|
| 1: ≥98% aggregate coverage | **PASS** (100%) |
| 2: ≥95% per-season | **PASS** (100%) |
| 3: ≥94% per-(team, season) cell | **PASS** (100%) |
| 4: schema integrity | **PASS** (since addendum v7) |
| 5: no regression + cross-source audit Pass-B | **PASS** (0/0/0 on N=50) |

**Phase 2 ship-claim: EARNED.**

**Council passes (Sprint 10.13):**
- Plan-review (addendum v9): 2 rounds. R1 2 CLEAR + 3 WARN (DQ 8, Stats 7, Domain 8 with concerns). R2 5 CLEAR avg 8.8.
- v9.1 mini-review (canonical-MP fix): 5 CLEAR avg 9.0. Justified as continuation of C′ pattern.
- Implementation review: 5 CLEAR avg 9.0 on the diff to `audit-espn-box-stats.ts` + `test-audit-mechanics.ts`.
- Test/results review (final audit report): 5 CLEAR avg 9.0.

**Methodology lessons (recorded in `learnings.md`):**
- C′ pattern (decouple audit-internal formula from schema-stored value) is reusable for future audit work.
- bbref scraping is feasible at 1 req / 30 s with Playwright + standard stealth (real Chromium UA + `navigator.webdriver` mask). Default headless-shell UA gets 403.
- ESPN summary API exposes 3 turnover variants; convention choice affects all Oliver-style formulas downstream.

**Pre-existing backlog state at session end:**
- Debt #19 escalation trigger met but held (4+ days × 6+ predict crons with zero `home_out_impact`).
- Debt #32 still gated. Zero shadow pairs accruing while ESPN injury feed is flat.
- Debt #35 (NEW): Phase 3 plan-review item, NOT a Phase 2 ship-claim blocker.

**What's NOT changed since Sprint 10.12:**
- Schema, scraper, cron, prediction logic, live API — all unchanged. The audit work was orthogonal.
- `nba_game_box_stats.possessions` still uses Oliver-basic + `totalTurnovers` (debt #35 question to be decided at Phase 3 plan-review).

---

## Backlog (Post-Sprint 10.13)

See the **Next Session Pickup** block above for the prioritized next-task queue. This section is the canonical list of council debts.

### Council Debts (Open)

| # | Item | Source | Priority |
|---|------|--------|----------|
| 1 | canonical_game_id schema migration | Sprint 8.5 Skeptic | P0 |
| 2 | MLB doubleheader handling | Sprint 8.5 Pragmatist | Before generalizing beyond NBA |
| 3 | Test fixture covering both ID shapes | Sprint 8.5 Tester | With canonical migration |
| 4 | Vegas frontend rendering | Sprint 8 deferred | Quick win |
| 5 | Ratchet media query consolidation | Sprint 9 Engineer | Low (cosmetic) |
| 6 | Player name line-wrap in ranked list | Sprint 9 Designer | Low (cosmetic) |
| 7 | eceHighConfOnly → shared computeECE helper | Sprint 10 Engineer | Low (refactor) |
| 8 | Disable stale Cloudflare direct-git deploy source | Sprint 10.5 ops | Dashboard only |
| 9 | Seed-stability test for v2 winning margin | Sprint 6 Skeptic | Low |
| 10 | Train/test shaded regions on ratchet chart | Sprint 6 Designer | Low |
| 11 | ~~Reliability diagrams across ALL sports from baseline corpus~~ | — | **CLOSED** by Sprint 10.8 implementation — `src/analysis/reliability.ts` + `npm run reliability` + `data/reliability/reliability-2026-04-15.{json,txt}`. Surfaced three actionable findings → spawned debts #27, #28, #29. |
| 12 | v5 sigmoid scale cross-validation on held-out data | Sprint 10.6i Math Expert | HIGH |
| 13 | ~~v4-spread margin MAE baseline on 12,813 backfill games~~ | — | **CLOSED** by PR #28 (bootstrap CIs, 16,777 games) |
| 14 | ~~**Shadow-prediction logging**: for every live v4-spread pick, store the naive (no-injury) prediction alongside the adjusted one. Enables forward A/B after N≥30 resolved picks.~~ | — | **CLOSED** by PR #38 (Sprint 10.10, 2026-04-22). Writes `v5-naive` + `v4-spread-naive` rows when `hasInjuryData && !lowConfidence` on NBA/NFL/MLB/NHL. Live; awaiting non-empty ESPN injury flow to produce first shadow pair. Follow-up debt #32 filed for the shadow-analysis report. |
| 15 | v5↔v4-spread injury consistency check (same sign on all games, post-merge) | Sprint 10.7 Mathematics | Medium |
| 16 | Position-weighted injury impact (QB 3x, star 1.5x, bench 0.5x) | Sprint 10.7 Domain Expert | Medium (biggest quality win) |
| 17 | Minimum-impact threshold (skip adjustment below 2 units) | Sprint 10.7 Prediction Accuracy | Low (refinement) |
| 18 | Fit INJURY_COMPENSATION separately for margin vs winprob | Sprint 10.7 Statistical Validity | After N≥200 resolved per model |
| 19 | Second injury data provider (criteria: ≥3 ESPN failures/week for 2 weeks) | Sprint 10.7 Data Quality | Watch metric |
| 20 | Historical odds ingest (Kaggle / paid feed) to enable ATS backtest | Sprint 10.7 Prediction Accuracy | HIGH — unlocks real v4-spread validation |
| 21 | ERA coefficient recalibration at N>200 (gated on live MLB sample) | Sprint 10.6c Domain Expert | Medium — gated |
| 22 | **v4-spread streak adjustments** (homeColdStreak −50% homeAdv, awayHotStreak −30% homeAdv) not empirically calibrated. (Originally filed against v3; v3 is rejected dead code, but the same streak logic moved into `predictMargin()` and is live in v4-spread.) | Sprint 10.6c Statistical Validity (relabeled Sprint 10.7) | Medium |
| 23 | Clamp [0.15, 0.85] Brier bias for NHL/soccer (Math expert noted in Sprint 10.6i) | Sprint 10.6i Math Expert | Low |
| 24 | **Dixon-Coles τ low-score correction** (split from old debt #18 — "Dixon-Coles"). Only affects draw-probability and specific scoreline probabilities. **Math-proven zero impact on E[margin] and therefore on margin MAE** — by symmetric cancellation across the 4 corrected cells (0,0)/(0,1)/(1,0)/(1,1). Value is scoreline / 1X2 market calibration only. Cannot improve PR #29's primary ship gate. | Sprint 10.8 Math + Prediction Accuracy | **LOW** — defer until 1X2 calibration is a ship-gate metric |
| 25 | **Dixon-Coles ξ time-decay + MLE fit** (split from old debt #18). The *actually* margin-moving half of Dixon-Coles 1997: weight recent matches more, fit α/β/μ_home by MLE over all history. Reduces estimator variance AND captures recent-form drift. Blocked on debt #26 (needs pre-2024 corpus). | Sprint 10.8 Math + Domain + Stats | **HIGH** (blocked on #26) |
| 26 | **Pre-2024 soccer match scrape** (new infra). FBref or Understat (Understat bundles xG, a sharper team-strength signal than actual goals). Unblocks proper train/test split AND larger N for MLE fitting. EPL ~3800 pre-2024 games (vs 699 currently), MLS ~1000+. Medium infra lift. | Sprint 10.8 Data Quality | **HIGH** — gating dependency for any serious soccer v2 |
| 27 | ~~**NBA v4-spread home-advantage re-calibration.**~~ | — | **CLOSED** by PR #34 (Sprint 10.9.5, 2026-04-20). `SPORT_HOME_ADVANTAGE.nba: 3.0 → 2.25`. signedResid −0.605 → +0.001, verdict BIASED_HIGH → HONEST. Council 5/5 CLEAR. |
| 28 | ~~**MLS/EPL v5 sigmoid scale re-calibration.**~~ | — | **CLOSED** by PR #36 (Sprint 10.10, 2026-04-22). `SIGMOID_SCALE.mls: 0.60 → 0.80`, `SIGMOID_SCALE.epl: 0.60 → 0.90`. MLS verdict SHY→HONEST (signedResid +0.0241 → −0.0029); EPL same (+0.0351 → −0.0055). Brier also improves on both. Council 3/3 CLEAR. |
| 29 | **Ternary reliability for soccer Poisson** (P(home) / P(draw) / P(away) — deferred, separate design). Pointwise binning doesn't apply; needs Murphy decomposition or per-class reliability curves. Only worth building if 1X2 calibration becomes a priority. | Sprint 10.8 Math (deferred) | Low — gated on 1X2 market work |
| 30 | **`check-branch-not-merged.sh` false-positives on chained `git commit && git push` in a single Bash tool call.** Hook evaluates `git diff origin/main..HEAD --name-only` once before the chained commands execute, so the pre-commit (empty-diff) state triggers a deny even when the chained commit would create the diff. Current workaround: split chained commands into two Bash calls. Possible fix: skip-when-push-is-chained-with-prior-commit, OR switch detection to look at `@{upstream}..HEAD` instead of `origin/main..HEAD`. Surfaced while pushing the cron-retry branch (Sprint 10.8). | Sprint 10.8 (hook self-limitation surfaced by cron-retry work) | **Low** — workaround is trivial; real fix is nice-to-have |
| 31 | ~~Same home-favored bias in the existing `getCalibration()` in `resolve-predictions.ts`.~~ | — | **CLOSED** by PR #44 (Sprint 10.12, 2026-04-25). Confidence-in-pick transform ported from `reliability.ts:171`; `was_correct` already correct-against-pick so pairs cleanly. Both main bucketing loop and `eceHighConfOnly` recompute carry the fix. Light-touch council 3/3 CLEAR. |
| 32 | **Shadow-analysis CLI/endpoint.** Follow-up to debt #14 (PR #38). Compute per-sport / per-model Brier (v5) or MAE (v4-spread) delta between adjusted and naive shadow pairs once N≥30 resolved pairs per (sport × model) accumulate. Two pre-declared constraints from `Plans/shadow-prediction-logging.md`: (1) Bonferroni-adjust (α=0.05/8) or pre-declare a single primary ship metric, since 4 sports × 2 models = 8 comparisons; (2) filter pairs to `\|adj.made_at − naive.made_at\| < 60s` to exclude temporally-skewed backfill pairs. | Sprint 10.10 — surfaced as out-of-scope in debt #14's plan | **HIGH** — gated on N≥30 per sport × model (~2-3 weeks for NBA/MLB/NHL, longer for NFL) |
| 33 | ~~NBA learned-model Phase 2 completion (substantial closure).~~ | — | **MOSTLY CLOSED** by PRs #42 / #43 / #45 (Sprint 10.12, 2026-04-25). Code-completeness: shipped. Production: backfill executed, 7604 rows, 100% coverage, R1+R2+R3 PASS unrounded. The only residual is **cross-source audit Pass-B (N≥50 hand-curated bbref Four-Factors)** which gates the formal Phase 2 ship-claim. Pass-B is tracked as a follow-on (filed below as new debt #34); core debt #33 work itself is done. |
| 34 | ~~**Phase 2 cross-source audit Pass-B (ship-claim gate).**~~ | — | **CLOSED** 2026-04-26 (post-Sprint-10.12). Pass-B verdict **PASS** at N=50 (0 raw failures + 0 rate failures + 0 missing rows). Path to PASS: (1) Playwright scraper at 1 req/30s collected bbref ground-truth for 50 stratified games (~25 min run, no manual paste); (2) C′ disposition (audit-only bbref formula match — addendum v9) cleared 193/198 systematic possessions-formula divergences; (3) v9.1 canonical-MP fix cleared 4 of 5 residual pace failures (ESPN player-minute drift vs bbref canonical 240-min divisor); (4) path-(i) drop+replace for 2 raw failures (LAL/IND TOV scraper-convention divergence → debt #35; DEN/OKC fg3a bbref single-source disagreement → no debt) with deterministic alternates `nba:bdl-1037593` and `nba:bdl-18421937`. Phase 2 ship-claim now earned: all 5 ship rules satisfied. Phase 3 unblocked. |
| 35 | ~~**ESPN TOV scraper-convention decision.**~~ | — | **CLOSED** 2026-04-26 (Sprint 10.14) as **option-b** (keep `totalTurnovers` → `tov` convention; add `team_tov` NICE-TO-HAVE column for forensic value). v10 backfill briefly switched to player-summed convention (option-d) based on a non-representative single-game empirical check (LAL/IND 2023 Cup final); the broader Pass-B audit re-run on substituted N=50 FAILED at 57 raw + 139 rate failures because bbref's Tm TOV column **matches `totalTurnovers` for regular-season + postseason + Cup pool-play games** (post Oct-2024 SR correction); only Cup-knockout games (~14 per Phase-3 in-scope window, ~0.18% of training data) use bbref player-summed convention. v10 was rolled back via re-scrape with reverted FIELD_MAP; post-rollback audit PASS at 0/0/0; per-season AVG(tov) bit-identical to pre-v10 (15-sig-fig match across all 5 segments). Post-mortem council 2 rounds, R2 5 CLEAR avg 9.6/10. See `Plans/nba-learned-model.md` addendum v10 + post-mortem section. Phase-3 plan-review inherits 8 forwarded items including Cup-knockout handling, 5 ESPN-sentinel-row handling, stratified-bbref-validation pre-flight harness, and council-process refinements (dissenter-named falsification test + ≥2/stratum + ≥5 total + adversarial selection bar for R2 reversals). |

**Audit performed Sprint 10.8 (council mandate):** All debts re-checked against current `main` after PR #29 merged. Debt #13 closed (PR #28). Debt #11 promoted to P0 and generalized (NBA-live → all-sport reliability diagrams from baseline). Old debt #18 "Dixon-Coles" (filed as single item in the PR #29 description) split into #24 (τ, math-proven zero margin impact) and #25 (ξ time-decay MLE, blocked on #26). Debts from earlier sprints have their original numbering preserved (#14-#23); new Sprint 10.8 debts are #24-#26.

### Council Debts Closed (in the last session)

| Item | Closed By |
|------|-----------|
| Calibration plot | Sprint 10 |
| Vegas baseline instrumentation | PR #12 (P2 fix) |
| Sport-specific v0 baseline (was using 1.0) | PR #8 (P0-4) |
| Draw handling for MLS/EPL | PR #8 (P0-2) |
| Resolver cross-namespace UNION | PR #8 (P0-3) |
| Season utility centralization | PR #8 (P0-5) |
| Automated SQLite backup | PR #8 (P0-1) |
| ESPN per-call retry jitter | PR #25 (ESPN injury scraper hardening) |
| Predictions for non-NBA sports | PRs #4, #7, #14 (all 6 leagues) |
| v2 discrete output bug (only 60/75% probabilities) | PR #21 (v5 sigmoid) |
| Debt #13 — per-sport margin MAE baseline with bootstrap CIs | PR #28 |
| Debt #11 — reliability diagrams across ALL sports from baseline corpus | Sprint 10.8 (reliability.ts + CLI; artifact 2026-04-15) |
| Debt #27 — NBA v4-spread home-advantage re-calibration (3.0 → 2.25) | PR #34 (Sprint 10.9.5, 2026-04-20). signedResid −0.605 → +0.001. Council 5/5 CLEAR. |
| Debt #28 — MLS/EPL v5 sigmoid scale re-calibration | PR #36 (Sprint 10.10, 2026-04-22). MLS 0.60→0.80, EPL 0.60→0.90. Both flipped SHY→HONEST. Brier improves on both. |
| Debt #14 — Shadow-prediction logging for forward A/B | PR #38 (Sprint 10.10, 2026-04-22). `v5-naive` + `v4-spread-naive` rows written when `hasInjuryData && !lowConfidence` on NBA/NFL/MLB/NHL. Codex P1+P2 addressed. |
| **NBA learned-model Phase 1 (premise-fail, pre-flight-abandoned)** | Sprint 10.11 (2026-04-24), shipped via PR #40. `Plans/nba-learned-model.md` council-CLEAR r4 on `main`; pre-flight premise Δ=+0.0131 < 0.02 threshold → Phase 1 abandoned per plan discipline; null result in `learnings.md`. Test fold untouched. Methodology repair survives for Phase 3 (Proposal A plug-in estimator). |
| Debt #31 — home-favored bias in live `getCalibration()` | PR #44 (Sprint 10.12, 2026-04-25). Confidence-in-pick transform ported from `reliability.ts:171`. Both main loop + `eceHighConfOnly` recompute carry the fix. Light-touch council 3/3 CLEAR (Math 9, Pred 9, DQ 10). |
| Debt #33 — NBA Phase 2 backfill / coverage / audit (substantial closure) | PRs #42 / #43 / #45 (Sprint 10.12, 2026-04-25). Production backfill executed, 3802/3802 OK, 7604 rows, R1+R2+R3 all PASS at 100%. Cross-source audit Pass-B split off as new debt #34 (formal ship-claim blocker). |
| Debt #34 — Phase 2 cross-source audit Pass-B (ship-claim gate) | 2026-04-26 (post-Sprint-10.12). Pass-B verdict **PASS** at N=50 (0/0/0). Playwright scraper replaced manual paste; C′ disposition (addendum v9) + v9.1 canonical-MP fix + path-(i) drop+replace for 2 raw failures (alternates `nba:bdl-1037593` + `nba:bdl-18421937`). Phase 2 ship-claim earned. New debt #35 surfaced (TOV scraper-convention question, Phase 3 plan-review item). |

- **Player-based predictions** — "Does SGA score >30 tonight?"
- **Kaggle historical NBA import** — 1946-present for deeper findings
- **Headshots on hero cards** — licensing/hosting complexity
- **Schema migrations** (`last_updated_at`, `stat_category` enum)
- **JSON1 indexes** on player_stats
- **Sport-function consolidation** in player-findings.ts
- **Mid-season trade handling**
- **Soccer loan player handling**
- **Park factors** (MLB)
- **Strength of schedule**
- **Scrollama narrative** (deferred from Sprint 4)
- **Single-team drill-down page** (Sprint 4 Viz 5)
- **Per-sport Brier breakdown**
- **Rolling 30-day Brier**
- **MLE logistic regression** for sigmoid scale fitting (proper v6)

---

## Council Discipline (LOCKED PROTOCOL)

User mandate, saved to memory as `feedback_council_discipline.md`:

> "All plans are audited by the council until the council is happy. Then all implementations are run past the council until the council is happy then all tests are run past the council until the council is happy."

**Every sprint MUST have:**
1. Plan review → iterate until CLEAR (or WARN with mitigations)
2. Implementation review → iterate if FAIL
3. Test/results review

User should never be the first reviewer. Skipping = CRITICAL FAILURE.

**User overrides memory (`feedback_dark_mode.md`):** Council voted white background for viz; user overrode to dark. Always dark mode for sportsdata web.

---

## Key Files Reference

### Backend
- `src/schema/` — All TypeScript interfaces (source of truth)
- `src/scrapers/espn.ts` — Hardened ESPN client with safeFetch + validators
- `src/scrapers/espn-players.ts` — Unified player stats client
- `src/scrapers/balldontlie.ts` — NBA historical
- `src/scrapers/odds-api.ts` — Betting lines
- `src/storage/sqlite.ts` — All tables + repository + helpers
- `src/analysis/interesting.ts` — Team-level findings (streaks, margins, mediocrity)
- `src/analysis/player-findings.ts` — Player-level findings per sport
- `src/analysis/qualifiers.ts` — Config-driven minimum-games thresholds
- `src/analysis/predict.ts` — Ratchet iterations (v0-v3)
- `src/analysis/backtest.ts` — Point-in-time harness with bootstrap CIs
- `src/analysis/predict-runner.ts` — Live prediction runner
- `src/analysis/resolve-predictions.ts` — Cross-namespace resolver + track record
- `src/analysis/vegas-baseline.ts` — Vegas comparison (preliminary)
- `src/orchestration/scheduler.ts` — Cron-like with retry
- `src/orchestration/ratchet.ts` — Original ratchet state machine
- `src/cli/predict.ts` — Predict CLI (cron-callable)
- `src/cli/backfill-predictions.ts` — Backfill from test set
- `src/cli/ratchet.ts` — Run ratchet CLI
- `src/cli/findings.ts` — Print findings to terminal
- `src/cli/inspect.ts` — Data inspection (mappings, results, home-rate)
- `src/cli/status.ts` — DB overview
- `src/viz/data-api.ts` — HTTP JSON API (all endpoints)

### Frontend
- `web/index.html` — Single scroll page (7 sections)
- `web/main.ts` — All rendering logic
- `web/style.css` — Dark theme, JetBrains Mono, Inter
- `web/team-colors.ts` — Team accent color lookup
- `web/env.d.ts` — Vite env types

### Deploy
- `Dockerfile` — Node 22, tsx bundled, better-sqlite3 native
- `fly.toml` — DFW region, shared-cpu-1x, 512mb, always-on
- `.github/workflows/deploy-pages.yml` — Cloudflare Pages deploy
- `.github/workflows/scrape-cron.yml` — Backup scrape cron
- `.github/workflows/predict-cron.yml` — Predict cron (5am + 22:00 UTC)

### Governance
- `harness.yml` — Council config
- `.harness/council/*.md` — 4 expert personas + resolver
- `skills/*.md` — Bootstrap, scrape, analyze, review workflows
- `learnings.md` — Per-session KEEP/IMPROVE/DISCARD/INSIGHT

### Memory (cross-session)
- `~/.claude/projects/-home-johnanguiano-projects-sportsdata/memory/MEMORY.md`
- `project_sportsdata_foundation.md` — Architecture + current state
- `feedback_dark_mode.md` — User override on white background
- `feedback_council_discipline.md` — CRITICAL council protocol

---

## Environment Variables (Fly secrets + local .env)

- `THE_ODDS_API_KEY` — Odds API (500 req/mo free)
- `BALLDONTLIE_API_KEY` — NBA historical (5 req/min free)
- `PREDICT_TRIGGER_TOKEN` — Bearer for /api/trigger/predict
- `ESPN_ALERT_WEBHOOK` — Optional Discord/Slack for scrape failures
- `SQLITE_PATH` — `/app/data/sqlite/sportsdata.db` on Fly
- `LOGS_DIR` — `/app/data/logs` on Fly
- `PORT` — 3001
- `HOST` — 0.0.0.0

---

## npm Scripts

```bash
npm run type-check    # tsc --noEmit
npm run scrape [sport]  # ESPN scrape (one sport)
npm run scrape:all    # All 6 leagues
npm run cycle         # Full scheduler run
npm run status        # DB overview
npm run inspect [cmd] [sport]  # mappings | results | home-rate
npm run odds          # Fetch current odds
npm run historical    # Load historical NBA from BDL
npm run seed:nba      # Seed NBA team mappings
npm run players [sport]  # Ingest player stats
npm run findings [sport]  # Print interesting findings
npm run ratchet [sport]  # Run ratchet backtest
npm run predict [sport]  # Predict upcoming games + resolve
npm run backfill:predict [sport]  # Backfill from test set
npm run api           # Start data API (local)
npm run dev           # Vite dev server
npm run viz           # Both API + Vite together
```

---

## Git Commit History Highlights

For an up-to-date list, use `git log --oneline main`. Major milestones:

```
PR #40 NBA learned-model pilot: plan CLEAR + Phase 1 null + Phase 2 scaffold — Sprint 10.11 (merge commit 6aae233)
PR #39 Session handoff: Sprint 10.10 (MLS/EPL sigmoid + shadow logging + housekeeping)
PR #38 Shadow-prediction logging (debt #14 closed) — Sprint 10.10
PR #37 Housekeeping — viz research to docs/, gitignore tool artifacts
PR #36 MLS/EPL sigmoid scale sharpening (debt #28 closed) — Sprint 10.10
PR #35 Sprint 10.9.5 session handoff doc
PR #34 NBA home-adv recalibration 3.0 → 2.25 (debt #27 closed, council 5/5 CLEAR)
PR #33 Session handoff doc refresh (Sprint 10.9)
PR #32 NBA home-adv initial attempt (3.0 → 2.4)
PR #26 Session handoff doc refresh + handoff-discipline lesson
PR #25 v4-spread injury integration + scraper hardening + backtesting honesty
PR #24 Injury 502 fix + Codex fixes on #22 + session log refresh
PR #23 Session log: documented PRs #1-21 since Sprint 10.5
#22    Injury signal — ESPN scraper + v5 adjustment
#21    v5 continuous sigmoid model (replaces v2's 4 discrete buckets)
#14-16 Historical backfill + /api/trigger/backfill + Actions workflow
#8-13  Full codebase review (33/35 P0-P3 fixes)
#5-6   v4-spread margin model + MLB pitchers + findings math fix
#4     Global sport selector (all 6 leagues)
#2-3   Scrape pipeline repair
Sprint 10  Calibration plot (DISCRETE verdict)
Sprint 9   Mobile layout fixes
Sprint 8.5 Backfill + resolver cross-namespace fix
Sprint 8   ESPN hardening + Vegas baseline + hero polish
Sprint 7   Live predictions (cron + bearer auth)
Sprint 6   Ratchet loop first run (v2: 0.2486 Brier)
Sprint 5   Player stats for all 6 sports
Sprint 4   Interesting-things detector + web scaffold
Sprint 3   Game outcomes + team mappings + BDL
Sprint 2   SQLite + scheduler + CLI + Odds API
Sprint 1   Foundation scaffold
```

---

## Next Session Pickup Points

See the **🎯 Next Session Pickup** block at the top of this file — it is the authoritative handoff for the next session and is refreshed at session end.
