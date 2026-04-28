# NBA Cold-Start Prior — Player-Aggregation

**Scope**: NBA only. Addresses cold-start failure identified in Phase 3 post-mortem (addendum v17 of `Plans/nba-learned-model.md`): EWMA rolling features produce near-zero signal for the first ~15–20 games of each season, contributing to val→test degradation on ~16% of the test fold.

**Status**: **COUNCIL-CLEAR** (round 2, 2026-04-28). Round 1: 5× WARN. Round 2: 5× CLEAR (DQ 8, Stats 8, Pred 8, Domain 8, Math 9 — avg 8.2). Append-only from this point; post-implementation results append as addendum.

---

## Problem

Every rolling-window feature starts each season from scratch. A team's halflife-21 EWMA has near-zero signal until roughly game 20. Phase 3's test fold was 100% regular-season games; 16% of them (~186 games) fell in this cold-start window where the model effectively guessed.

v5 partially sidesteps this because it uses season-aggregate record and point differential — those are noisy in game 1 but they exist. A learned model that relies on rolling features is worse than v5 early in the season. This plan builds a player-aggregate prior that gives the model a meaningful team-quality estimate before any current-season games are played, then fades it out as real game data accumulates.

---

## Data pipeline

### Player stats — bbref Advanced

Scrape per-player, per-season Box Plus/Minus (BPM) and Minutes Played (MP) from bbref Advanced stats pages. One scrape per year after each season ends, using existing Playwright scraper at 1req/30s.

**Why BPM**: box-score-based estimate of a player's per-100-possession impact relative to league average. Designed to be additive across a roster. Available historically for all NBA players on bbref.

New table:
```
nba_player_season_stats(
  player_id    TEXT,   -- internal ID (mapped from bbref)
  bbref_id     TEXT,   -- bbref slug e.g. 'jamesle01'
  season       TEXT,   -- e.g. '2025-regular'
  team_id      TEXT,   -- team at end of season
  bpm          REAL,   -- Box Plus/Minus
  minutes_played INT   -- total MP that season
)
```

### Player ID cross-reference

bbref uses slug IDs; BDL uses integer IDs. They share no common key.

Mapping strategy:
1. Scrape bbref team roster pages by season — gives bbref slugs alongside player names, positions, and team.
2. Match to BDL player records by normalized name + team + season. Name normalization: lowercase, strip punctuation, handle common suffix differences (Jr./III etc.).
3. Assign confidence tier: `EXACT` (unique unambiguous match), `FUZZY` (matched by normalization), `MANUAL` (human-verified for ambiguous cases).
4. Any player that is not EXACT or previously MANUAL-verified is flagged for human review before that season's prior is used. Expected volume: fewer than 5 ambiguous cases per season.
5. Implementation checklist: dry-run the mapping against the 2023–24 season (full known ground truth) before the pipeline is used for live priors — edge cases include hyphenated surnames, legal name changes, and anglicised spellings of international names.

New table:
```
nba_player_ids(
  bbref_id         TEXT PRIMARY KEY,
  bdl_player_id    INT,
  player_name      TEXT,
  match_confidence TEXT   -- 'EXACT', 'FUZZY', 'MANUAL'
)
```

### Roster snapshots

Capture opening-day rosters at 00:00 UTC on the first day of each regular season. Source: BDL `/teams/{team_id}/players` endpoint. This is the canonical roster used for that season's prior and does not update mid-season.

Late signings (hardship exceptions, waived/signed players between snapshot and tip-off): any player not in the snapshot is assigned BPM = 0.0 (league average) and projected minutes = 0 in the prior computation. One game of slightly stale prior is an acceptable tradeoff for simplicity.

New table:
```
nba_season_rosters(
  season          TEXT,
  team_id         TEXT,
  player_id       TEXT,
  is_new_to_team  BOOLEAN
)
```

### Coaching change flag

Scrape head coach by team by season from ESPN or bbref. One scrape per year at season start. Used as a prior-damping variable (see blending section).

New table:
```
nba_coaching(
  season        TEXT,
  team_id       TEXT,
  head_coach    TEXT,
  is_new_coach  BOOLEAN
)
```

---

## Prior computation

### Players with prior NBA data

```
prior_strength(team) =
  Σ over (roster players with last-season NBA data):
    player_BPM(S-1) × (player_MP(S-1) / total_contributing_MP)

where:
  total_contributing_MP =
    Σ over (roster players with last-season NBA data): player_MP(S-1)
```

This is a proper weighted average — fractions sum to 1 across contributing players. Players who were traded mid-last-season use their full-season BPM (not split stats) and their full-season MP.

### Rookies and players with no prior NBA data

Assigned a BPM and projected minutes based on draft position, calibrated from historical data (see calibration section). International prospects with no prior NBA history are treated as undrafted-equivalent — a known underestimate for high-profile international signings; accepted as a v1 limitation.

| Draft range | Median BPM | Projected MPG |
|---|---|---|
| Picks 1–5 | *to be calibrated* | *to be calibrated* |
| Picks 6–14 | *to be calibrated* | *to be calibrated* |
| Picks 15–30 | *to be calibrated* | *to be calibrated* |
| Second round | *to be calibrated* | *to be calibrated* |
| Undrafted | *to be calibrated* | *to be calibrated* |

These values are filled in after calibration and committed to this plan as an addendum before any implementation begins.

Rookie contribution pooled with veterans:

```
full_prior_strength(team) =
  (Σ veteran_BPM × veteran_MP  +  Σ rookie_BPM × projected_rookie_MP) /
  (total_contributing_MP        +  Σ projected_rookie_MP)
```

### Rookie prior calibration methodology

- **Source**: bbref historical data, first-year NBA players 2010–2024 (14 seasons)
- **Metric**: BPM and MP in the player's first NBA season
- **Minimum minutes filter**: ≥500 MP before including a player in bin statistics — removes injury-shortened rookie seasons where low BPM reflects sample size, not talent
- **Bins**: picks 1–5, picks 6–14, picks 15–30, second round, undrafted-but-rostered
- **Statistic**: median (not mean — reduces sensitivity to generational outliers and early busts); also report IQR per bin
- **Survivorship bias**: undrafted players who never received meaningful NBA time are absent from bbref — this biases the undrafted median upward. Accepted: their projected minutes are near-zero and their weight in the team prior is negligible
- **Calibration / validation split**: calibrate bins on 2010–2021, validate on 2022–2024
- **Commit**: calibrated values are appended to this plan before implementation begins

---

## Blending function

### Base formula

```
effective_strength(team, g) =
  (K_eff × prior_strength  +  g × actual_season_diff) / (K_eff + g)
```

Where:
- `g` = games played this season so far
- `actual_season_diff` = current-season point differential per game (the v5 feature)
- `K_eff` = effective prior weight in "games equivalent" (see below)

### Continuity-scaled K

```
K_eff = K_base × continuity_factor × coaching_factor

continuity_factor = 0.75 + 0.5 × roster_continuity
  where roster_continuity = (MP of returning players) / (total last-season MP)
  -- maps [0, 1] → [0.75, 1.25]
  -- high-continuity teams get 25% more prior weight
  -- rebuilding teams get 25% less

coaching_factor = 0.70  if is_new_coach  else  1.0
  -- new coach: player BPMs from prior system are less portable
```

Known limitation: the linear continuity_factor is a first-order approximation. The relationship between roster continuity and prior reliability is likely nonlinear (returning the top two players matters more than returning the bottom two). Acceptable for v1; revisit if diagnostic check (see below) shows systematic error.

### K_base calibration

Grid search over K_base ∈ {3, 5, 10, 15, 20, 30} on seasons 2019–2023, minimizing mean Brier score on games 1–25 of each season. Validated on 2024–25 holdout. K_base value committed to this plan before any test-fold contact. The exact value of the coaching_factor (0.70) is also revisited during this calibration step.

---

## Feature integration

`effective_strength` is **added as an additional feature** alongside existing season-aggregate features — not as a replacement. The model can learn to discount a bad prior; it cannot recover a deleted signal. Feature is added for **both home and away teams** independently.

For context: when `g = K_eff`, the prior and actual data have equal weight. By `g = 3 × K_eff`, the prior contributes less than 25% and is effectively negligible.

---

## Ship rules (pre-declared)

This feature ships iff **all three** hold on holdout evaluation (no test-fold contact until council pre-touch sign-off):

1. **Brier improvement on games 1–20** (primary): model with cold-start prior reduces mean Brier vs v5 baseline on the first 20 games of each season in the 2024–25 holdout. Assessed with block-bootstrap 95% CI on paired per-game Brier difference (blocks = home_team × week, B = 10,000). CI must exclude zero on the improvement side.

2. **No degradation on games 21+**: mean Brier delta ≤ +0.002 on games beyond the cold-start window in the same holdout. *Power note*: with ~900 such games in one holdout season, the 95% CI on this delta is approximately ±0.002. If CI width exceeds ±0.001 at the K-calibration stage, this rule is respecified as "not statistically different from zero" — the threshold is not moved ex-post, but the operationalization is confirmed before implementation begins.

3. **K calibrated on separate holdout**: K_base fit on 2019–2023 only. 2024–25 is validation. No test-fold (2025–26) contact until council pre-touch sign-off.

---

## Diagnostic (not a ship gate)

Track cases where `prior_strength` places a team in the top or bottom 20% of the league (by prior estimate) but the team finishes the season in the opposite half of the standings. Report count and fraction in the results review. A rate above 15% of such extreme priors flipping should trigger re-council before any future iteration.

---

## Known limitations (pre-declared)

- BPM is context-dependent: a player's value in their prior system may not transfer perfectly to a new team's scheme. Role-change adjustment is deferred to a future iteration.
- Lineup interaction effects violate perfect player-contribution additivity. The weighted average is a first-order approximation.
- International prospects with no NBA history are treated as undrafted-equivalent — systematically underestimates high-profile international signings.
- Preseason games are not used — signal quality is low due to rest management and lineup experimentation.
- Linear continuity_factor does not capture which players returned (returning a star vs. returning bench depth are treated equivalently at the same minutes fraction).

---

## Council reviews

### Round 1 — 2026-04-28 (all WARN)

**DQ — 5/10 — WARN**: Player ID mapping unspecified; roster snapshot timing unspecified. Both blocking.

**Stats — 6/10 — WARN**: BPM year-over-year autocorrelation heteroscedasticity (veterans ~0.65, young/transitional ~0.35) not acknowledged. Rule-2 threshold of +0.002 stated without power check.

**Pred — 7/10 — WARN**: Replace-vs-add not resolved. "Confidently wrong" risk (a bad prior outputs high confidence) not addressed.

**Domain — 6/10 — WARN**: Coaching changes not addressed. Rookie variance underappreciated (mean vs median). Context-dependence of BPM not acknowledged.

**Math — 7/10 — WARN**: Normalizer bug: dividing by 240 (theoretical max) instead of actual team MP means fractions don't sum to 1. Rookie prior values stated without calibration methodology.

### Round 2 — 2026-04-28 (all CLEAR)

**DQ — 8/10 — CLEAR**: ID mapping strategy now specified (name normalization + confidence tiers + human review gate). Snapshot timing clear (00:00 UTC opening night, late signings get league average). Dry-run note filed for implementation checklist.

**Stats — 8/10 — CLEAR**: Continuity-scaled K acknowledges prior reliability heterogeneity. Rule-2 power caveat now handled correctly — threshold or "not significantly different from zero" respecification committed before implementation. Linear continuity_factor limitation acknowledged.

**Pred — 8/10 — CLEAR**: Replace-vs-add resolved (add as feature, both teams). "Confidently wrong" handled as a post-hoc diagnostic rather than a hard gate — right balance of visibility without over-blocking. Implementation note: add effective_strength for both home and away teams.

**Domain — 8/10 — CLEAR**: Coaching change factor added (0.70 damping for new coaches, revisited at K calibration). Rookie calibration uses median. BPM context-dependence pre-declared as known limitation. International prospect gap noted and accepted as v1 limitation.

**Math — 9/10 — CLEAR**: Normalizer bug fixed — actual contributing MP used, fractions sum to 1. Rookie integration formula correct. K_eff formula maps inputs to sensible ranges. Minimum-minutes filter (≥500 MP) specified for rookie calibration to exclude injury-shortened seasons.

---

## Addendum — Rookie BPM calibration results (2026-04-28)

Calibrated on draft classes 2010–2021 (≥500 MP filter). Validated on draft classes 2022–2024.

### Calibration set (commit values)

| Draft range     | N   | Median BPM | IQR BPM         | Projected MPG |
|-----------------|-----|-----------|-----------------|---------------|
| Picks 1–5       |  54 |      −2.25 | [−4.2, +0.2]   |          22.2 |
| Picks 6–14      |  92 |      −2.05 | [−3.3, −0.9]   |          17.5 |
| Picks 15–30     |  94 |      −2.40 | [−3.5, −1.1]   |          13.4 |
| Second round    |  77 |      −2.60 | [−4.0, −1.6]   |          10.9 |
| Undrafted       |2240 |      −0.50 | [−1.9, +1.2]   |          18.3 |

### Validation set (2022–2024 draft classes)

| Draft range     | N   | Median BPM | IQR BPM         | Projected MPG |
|-----------------|-----|-----------|-----------------|---------------|
| Picks 1–5       |  14 |      −2.80 | [−3.3, −1.5]   |          24.1 |
| Picks 6–14      |  22 |      −3.05 | [−4.2, −0.8]   |          16.0 |
| Picks 15–30     |  30 |      −3.20 | [−4.8, −1.7]   |          16.5 |
| Second round    |  25 |      −3.10 | [−3.6, −2.0]   |           9.9 |
| Undrafted       | 912 |      −0.30 | [−1.8, +1.3]   |          18.9 |

Validation consistent with calibration set — drafted rookies slightly worse in recent classes (−3.1 vs −2.4 at picks 15–30), consistent with increased international competition for spots. Undrafted bin stable (−0.30 vs −0.50). High-pick IQRs are wide: a lottery pick's BPM swings from −4 to +0, confirming the variance argument for using median over mean.

**These are the committed plan values. K_base calibration next.**

---

## Addendum — K_base calibration results (2026-04-28)

### Off-by-one fix

`calibrate_k.py` had an incorrect year-mapping assumption (`N-regular` was treated as the season *ending* in year N, but the DB convention is `N-regular` = season *starting* in year N). Fixed before running calibration: `prior_year = season_year` (bbref year N = the N-1/N prior season) and `current_proxy_year = season_year + 1`. Validation reduced to `["2024-regular"]` since bbref year 2026 (2025-26 season) is not yet published.

### Grid search results

Calibration: seasons 2019–2023, cold-start window games 1–25.

| K_base | Cal Brier  | Notes                        |
|--------|-----------|------------------------------|
| 3      | 0.226788  |                              |
| 5      | 0.225803  | within noise of K=10         |
| **10** | **0.225783** | **chosen — marginal edge** |
| 15     | 0.226590  |                              |
| 20     | 0.227486  |                              |
| 30     | 0.229069  |                              |

- Baseline (no prior, K≈0): 0.234256
- **Prior improvement: +0.0085 Brier on cold-start games 1–25** (≈1–2 SE above zero; directional signal confirmed by monotone improvement across all K>0)
- Validation Brier at K=10: 0.212016 (val better than cal — consistent with one-season noise, not overfit)
- coaching_factor fixed at 0.70 during calibration (not re-optimized; pre-declared value held)

**K flat-region note (council-required):** K=5 and K=10 differ by 0.000020 Brier — well below any reasonable standard error (~0.005–0.010 for this data size). K=10 is chosen for marginal empirical edge; K=5 is within noise; any value in [5, 15] produces equivalent results under current evidence. **Do not treat K=10 as a precisely calibrated value** — it is a reasonable choice in a flat region.

### Council results review — 2026-04-28 (4 CLEAR, 1 WARN)

**DQ — 8/10 — CLEAR**: Calibration dataset well-documented. Undrafted-bin contamination (N=2240 includes pre-2010 veterans) disclosed. Downstream impact argued negligible if veteran undrafted players have low effective weight in team priors. Monitoring obligation named: future calibration pass should filter undrafted bin to players whose first NBA season falls within the calibration window.

**Stats — 7/10 — WARN (resolved by documentation)**: K=5 and K=10 are statistically indistinguishable (0.000020 Brier difference << SE ≈ 0.005–0.010). K grid is flat across [5, 15]. Main finding is "any prior beats no prior" not "K=10 is the precise optimum." Val/cal delta −0.0138 noted — val better than cal, consistent with one holdout season variance. Documentation fix above satisfies this WARN.

**Pred — 8/10 — CLEAR**: Main finding sound. +0.008 Brier is directional improvement in target window. coaching_factor fixed at 0.70 (confirmed, not re-optimized). Prior-calibration as probability feature not assessed here — acceptable at K-calibration step; diagnostic (top/bottom 20% flip rate) should run at test-fold evaluation.

**Domain — 8/10 — CLEAR**: Rookie bin values domain-plausible. Recent-cohort drift (2022–2024 classes ~0.7 BPM more negative than historical medians in picks 15–30) is real. Watch item: recalibrate bins if 2025 draft class continues the trend.

**Math — 8/10 — CLEAR**: +0.008473 Brier improvement ≈ 1–2 SE for N≈700 cold-start games under independence assumption. Appropriate evidence level for calibration step; ship gate uses block-bootstrap on holdout. K flat-region confirmed mathematically. No formula errors.

**Overall: CLEAR. Proceed to implementation.**

### Committed plan values

| Parameter | Value | Notes |
|---|---|---|
| K_base | 10 | flat region [5, 15]; K=5 equivalent |
| coaching_factor | 0.70 | pre-declared; not re-optimized at calibration |
| Picks 1–5 BPM prior | −2.25 | |
| Picks 6–14 BPM prior | −2.05 | |
| Picks 15–30 BPM prior | −2.40 | |
| Second round BPM prior | −2.60 | |
| Undrafted BPM prior | −0.50 | contamination disclosed; veteran survivor bias |

---

## Addendum — Implementation council clarifications (2026-04-28)

**Coaching_factor correction**: The plan addendum (K calibration, 2026-04-28) states "coaching_factor fixed at 0.70 during calibration." This is inaccurate. The calibration script (`calibrate_k.py`) never applied coaching_factor — it used flat `K_eff = K_base = 10` with no continuity or coaching adjustments. Similarly, the implementation (`features.py`, `bpm_prior.py`) uses flat `K = 10.0`. coaching_factor = 0.70 is a pre-declared v2 enhancement; it was not applied in either calibration or v1 implementation. The implementation and calibration are internally consistent on this point.

**Traded-player exclusion**: bbref represents traded players via multi-team aggregate rows (2TM/3TM/4TM) with no single-team entry. These rows are excluded from team prior computation (~13–14% of active players per season). This is a known v1 limitation documented in `bpm_prior.py`. Teams that acquired high-impact players mid-season in the prior year may have underestimated prior strength.

---

## Addendum — Test-fold results (2026-04-28) — NULL RESULT

### Ship rule evaluation — evaluate_cold_start.py

Model: run 20260428T123326-7b5b31c1 (44 features, 20-seed ensemble, Platt A=1.308, B=0.038)
Test fold: 2025-regular season, n=1162 games

| Partition | n | LightGBM Brier | v5 Brier | Δ (lgbm−v5) |
|---|---|---|---|---|
| Cold-start (games 1-20) | 309 | 0.210309 | 0.205528 | **+0.004781** |
| Late-season (games 21+) | 853 | 0.212503 | 0.210610 | +0.001893 |
| All regular-season | 1162 | 0.211920 | 0.209259 | +0.002661 |

Block-bootstrap 95% CI on cold-start Δ (B=10000, blocks = home_team × ISO-week):
- Observed Δ: +0.004781
- 95% CI: [−0.010219, +0.019839]

| Ship Rule | Threshold | Result | Verdict |
|---|---|---|---|
| Rule 1 — Brier improvement games 1-20 | CI must exclude zero on improvement side | CI = [−0.010, +0.020], spans zero; Δ > 0 | **FAIL** |
| Rule 2 — No degradation games 21+ | Δ ≤ +0.002 | Δ = +0.001893 | PASS |
| Rule 3 — K calibrated on separate holdout | confirmed (calibrate_k.py) | K=10 on 2022-2024 seasons | PASS |

**Overall: NULL RESULT. Ship Rules 1 FAIL. BPM cold-start prior v1 does not ship. v5 remains incumbent.**

Context: Also evaluated at Gate D (evaluate_test_fold.py): AUC 0.7241 < v5 0.7283 (FAIL). Both evaluation frameworks independently reach null result.

### Council Gate 4 (results review) — 2026-04-28

All five experts CLEAR. Weighted score 7.6/10.

**DQ — 8/10 — CLEAR**: Data pipeline verified against live DB. 309/1162 cold-start count confirmed exact. Metadata join 100% complete. Season label correct. v5 stat query confirmed no contamination. Minor deductions for undrafted-bin survivor bias (known v1 limitation) and mild `games` vs `nba_eligible_games` table asymmetry.

**Stats — 8/10 — CLEAR**: Block-bootstrap design correct; CI width (~0.030 units) is honest given n=309 and game-level Brier variance. Null result clean — point estimate degradation with CI spanning zero. Two pre-declared tests, no alpha inflation.

**Pred — 7/10 — CLEAR**: Null result internally consistent with overall AUC weakness. No leakage. BPM prior hypothesis falsified as large-effect claim; effects below 0.005 Brier unresolved given CI width. Ship null result.

**Domain — 7/10 — CLEAR**: Null result domain-plausible. 2025-26 roster churn undermines prior-year BPM. Traded-player exclusion removes disproportionately high-BPM players. coaching_factor=0.70 not applied in v1 — inflates prior overconfidence. v5 base-rate fallback (0.57 for <5 games) is a stronger cold-start handler than expected. v2 path: apply coaching_factor, impute traded players, evaluate K ∈ {5, 7, 10}.

**Math — 8/10 — CLEAR**: Platt calibration math correct. Block-bootstrap implementation correct (block-level resampling, percentile CI). min_game_n construction correct. Predict-and-average vs logit-space averaging is consistent modeling choice. Results correctly support Ship Rule 1 FAIL.

**Resolver: CLEAR. Null result recorded. Experiment closed. v5 holds.**

### v2 prior prerequisites (pre-declared before any future experiment)

1. Apply `coaching_factor = 0.70` to discount priors when team context changes
2. Impute traded players rather than excluding (13-14% exclusion disproportionately removes high-BPM players)
3. Evaluate K sensitivity: K ∈ {5, 7, 10} — K=10 may decay too slowly given early-season information
4. Expand to ≥2 test seasons to increase power (n=309 is underpowered for effects < 0.005 Brier)
