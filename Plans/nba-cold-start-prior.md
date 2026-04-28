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
