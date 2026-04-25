# Plan: Phase 2 backfill + coverage + audit (debt #33)

**Status**: post-round-1-council DRAFT (round-1: WARN/CLEAR/CLEAR/CLEAR/CLEAR; revisions integrated below).
**Owner**: Phase 2 ship-claim is gated on this work.
**Parent plan**: `Plans/nba-learned-model.md` §Phase 2 + addendum v7.
**Branch**: `claude/nba-phase2-backfill` (cut from `claude/nba-phase2-impl-review-fixes` 2026-04-25).

## Pre-flight DB probe results (2026-04-25)

Domain F1 was unsure whether the season label uses start-year or end-year. Direct DB probe `SELECT season, MIN(date), MAX(date), COUNT(*) FROM games WHERE sport='nba' GROUP BY season`:

| `season` label | date range          | NBA season name (human) |
|----------------|---------------------|-------------------------|
| `2023-regular`     | 2023-10-24 – 2024-04-19 | 2023-24 regular         |
| `2023-postseason`  | 2024-04-20 – 2024-06-17 | 2023-24 playoffs        |
| `2024-regular`     | 2024-10-22 – 2025-04-18 | 2024-25 regular         |
| `2024-postseason`  | 2025-04-19 – 2025-06-22 | 2024-25 playoffs        |
| `2025-regular`     | 2025-10-21 – 2026-04-12 | 2025-26 regular (current) |

**Convention**: `<season-start-year>-regular`. There is NO `2026-regular` because the 2026-27 season hasn't started. The DB has all 3 in-scope seasons (2023-24, 2024-25, 2025-26 = current). 2025-postseason will populate as the current playoffs play out (April–June 2026).

NBA Cup championship games verified:
- 2023-24 Cup final: `nba:bdl-8258317`, 2023-12-09, `LAL` vs `IND`, season `2023-regular`. ✓ included.
- 2024-25 Cup final: `nba:bdl-17195500`, 2024-12-17, `OKC` vs `MIL`, season `2024-regular`. ✓ included.

NBA Cup championship games are in `*-regular`. The eligible-games view captures them automatically. No special carve-out needed.

Forfeit/cancellation probe: `SELECT COUNT(*) FROM games g JOIN game_results gr ON gr.game_id=g.id WHERE g.sport='nba' AND g.status='final' AND gr.home_score=0` returns **0**. The `home_score > 0` filter in v1 of this plan was a defensive heuristic with no current effect. **Removed in v2** — relying on `g.status='final'` alone.

**Plan-vs-fixture-test season-string mismatch resolution**: the existing Phase 2 fixture test passes literal `'2025-26'` as the season string to `validateNbaBoxScore`. Backfill will pass `g.season` (e.g., `'2025-regular'`) instead, so live-stored rows use the DB-canonical convention. The fixture tests remain valid (they assert the validator stores whatever it's given) but DON'T exercise the backfill's actual season string format. Stored `season` values consistent across the codebase from this point forward = `<start-year>-regular`/`-postseason`.

---

## BLUF

Five components to land debt #33 and earn the Phase 2 ship-claim:

1. **BDL→ESPN event-ID resolution layer** — discovered during planning: NBA games in `games` are BDL-sourced (`nba:bdl-N`), not ESPN. `fetchNbaBoxScore()` needs ESPN event IDs. New mapping table + scoreboard-driven resolver.
2. **`box_stats_coverage` view** — SQL view computing the Rule 1/2/3 coverage gates against an explicit `eligible_games` definition (per addendum v7 §9).
3. **`scripts/backfill-nba-box-stats.ts`** — iterate eligible games, fetch+upsert. Idempotent, resumable, rate-limited.
4. **`scripts/recheck-recent-box-stats.ts`** — re-fetch last-7-days box scores. Cron-friendly.
5. **`scripts/audit-espn-box-stats.ts`** + `data/espn-bbref-audit-truth.json` + `docs/espn-bbref-audit.md` — cross-source audit per plan §item 6.

This plan builds on (does not modify) the council-CLEAR §Phase 2 of `Plans/nba-learned-model.md` and its addendum v7. No ship-rule changes; this plan implements the rules.

---

## Discovery: BDL/ESPN ID gap

**What `games.id` looks like:**
- `nba:bdl-18447947` — Ball Don't Lie source (3871 NBA games). All post-2022 historical games and current-season games up to ~2026-04-02.
- `nba:401810975` — ESPN scoreboard source (17 games, all dated 2026-04-03 or later, ALL with empty `season` strings — orphans).

**What `fetchNbaBoxScore()` requires:**
- `gameId` like `nba:401811002` — strips `nba:` prefix to call ESPN's `summary?event=401811002` endpoint.

**Implication.** The 3871 BDL-sourced games cannot be backfilled directly. We need to resolve their corresponding ESPN event IDs first.

**Strategy: scoreboard-by-date matching.** ESPN's scoreboard endpoint accepts `?dates=YYYYMMDD` and returns all NBA events on that date with `event.id` (the ESPN event ID we need) and `event.competitions[0].competitors[i].team.abbreviation`. Our `games.home_team_id` / `away_team_id` use the same abbreviation convention (ESPN-canonical). Match by `(date, home_abbr, away_abbr)` is unambiguous.

**Volume.** ~290 unique game-dates × 1 scoreboard fetch = 290 ESPN scoreboard requests at 2 req/s ≈ 2.5 min runtime to fully populate the mapping. One-shot operation; subsequent runs are no-ops.

---

## Scope

### Component 1 — ID resolution layer

**New table `nba_espn_event_ids`:**
```sql
CREATE TABLE nba_espn_event_ids (
  game_id TEXT PRIMARY KEY,           -- our canonical: nba:bdl-N or nba:4018N
  espn_event_id TEXT NOT NULL,        -- ESPN's pure numeric event ID
  resolved_at TEXT NOT NULL,
  match_method TEXT NOT NULL          -- 'date+abbrs' | 'native' | 'manual'
);
```

**New script `scripts/resolve-nba-espn-event-ids.ts`:**

**Algorithm (fixes incorporated post round 1):**
1. SELECT eligible games where `game_id NOT IN (SELECT game_id FROM nba_espn_event_ids)`.
2. **Native ESPN IDs**: for game_ids matching `nba:4018%`, INSERT mapping immediately with `espn_event_id = id.replace('nba:', '')`, `match_method='native'`. No fetch.
3. For BDL game_ids: group by `(et_date)` where `et_date = strftime('%Y%m%d', g.date, '-5 hours')` (approximate UTC → ET conversion via SQLite). **Per Domain F2 + DQ #2 (BLOCK)**: ESPN's `/scoreboard?dates=YYYYMMDD` parameter uses **Eastern Time**, not UTC.

   **Empirical verification (probe, 2026-04-25)**: ESPN scoreboard for `?dates=20241022` returns event `401704628` at `2024-10-23T02:00Z` (the MIN@LAL late-EDT-night game, which tips 7pm PDT = 10pm EDT = 02:00Z next UTC day). The next-day query `?dates=20241023` does NOT include that event. Confirms ESPN keys by ET tipoff calendar date.

   **DST-robust fetch strategy (per Math #1 round-2 finding)**: the `-5h` SQLite modifier is the EST offset. During EDT (March-Nov, covers ~70% of NBA season including all preseason, October regular start, late-March/April playoffs and the Finals), the true ET offset is `-4h`. The `-5h` shift pushes pseudo-ET 1 hour earlier than true ET. This causes a date rollback ONLY when true ET tipoff is in `[00:00, 01:00)` ET — which never happens for NBA scheduled tipoffs (earliest is noon ET, latest typical is 10:30pm ET).

   **Even so, defense in depth**: instead of a fixed-offset trick, fetch `[et_date−1, et_date, et_date+1]` for **every** unique date in the batch and dedupe events by `event.id`. Cost: ~3× scoreboard fetches = ~7 min instead of ~2.5 min. Negligible compared to the ~32-min backfill phase. Robust against any 0–24h timezone offset error including DST transitions.

4. For each unique ET date `D` in the batch: fetch scoreboard for `D−1`, `D`, `D+1`. Merge `events[]` from all three responses. Dedupe by `event.id`. (Across multiple `D` values in the batch, individual scoreboard URLs may overlap and be fetched multiple times — script caches by URL string within the run to avoid redundant requests.)
5. For each unresolved game on that ET date: match by `(home_abbr, away_abbr)` from `event.competitions[0].competitors[i].team.abbreviation`. Match must be **exactly one** event:
   - **0 matches** (no event has these abbrs on this date): log `scrape_warning` (source='espn-scoreboard', warning_type='missing_field', detail=`'date=YYYY-MM-DD home=ABC away=XYZ; no ESPN event matched'`), skip game.
   - **1 match**: INSERT mapping with `match_method='date+abbrs'`. Status of the matched event is irrelevant (resolution is status-agnostic per DQ #5 — pre-tipoff scheduled events have stable IDs; if our run sees them, the ID is correct).
   - **≥2 matches** (should never happen for NBA — same matchup back-to-back same day is impossible): log `scrape_warning` (warning_type='schema_error'), skip game. Treat as a runtime invariant violation worth investigating.
6. Idempotent: subsequent runs are no-ops on already-mapped games.
7. Rate limit: 2 req/s (existing `rateLimitedFetch`).

**Pagination check (DQ #4):** ESPN's `/scoreboard?dates=YYYYMMDD` is documented as returning all events for the day in a single payload. Largest day historically is Christmas (5–10 NBA games). Implementation will assert `events.length >= number_of_unresolved_games_on_this_date` after fetch, so pagination silently dropping events is detected (logged as `schema_error` if assertion fails).

**Integration with backfill.** The backfill script JOINs `eligible_games × nba_espn_event_ids` and only operates on the intersection. Games not in the mapping table are skipped silently in backfill but picked up next resolver run. This separation is intentional — keeps backfill simple.

**Post-run skip diagnostic (per Pred #2):** at end of resolver run, emit:
```sql
SELECT
  g.season,
  strftime('%w', g.date) AS dow,
  CAST(strftime('%H', g.date) AS INT) AS utc_hour,
  COUNT(*) AS skipped
FROM games g
WHERE g.id IN (SELECT game_id FROM scrape_warnings WHERE source='espn-scoreboard' AND scraped_at >= ?)
GROUP BY g.season, dow, utc_hour
ORDER BY skipped DESC LIMIT 20;
```
Surfaces systematic skipping by season/weekday/UTC-hour-bucket so West-coast clustering (or any other systematic miss) is visible at a glance, not buried in counts.

### Component 2 — `box_stats_coverage` view

**Eligible-games definition** (per addendum v7 §9, refined post-DQ-#1):
```sql
CREATE VIEW nba_eligible_games AS
SELECT
  g.id            AS game_id,
  g.season,
  g.home_team_id,
  g.away_team_id,
  g.date
FROM games g
WHERE g.sport = 'nba'
  AND g.status = 'final'
  AND g.season IN ('2023-regular', '2023-postseason',
                   '2024-regular', '2024-postseason',
                   '2025-regular', '2025-postseason');
```

Notes:
- The `home_score > 0` filter from v1 is dropped per DQ #1: probe confirms 0 NBA games today have `status='final' AND home_score=0`. Adding the filter as defense risks silently excluding a real forfeit if it ever occurs (NBA forfeits are rule-book recorded as `2-0`, but BDL ingest behavior on those is unverified). Trusting `status='final'` is cleaner and falsifiable.
- The JOIN to `game_results` is also dropped — eligibility is determined by `games.status`, not by results presence. (A `final` game with no results row would be a separate DQ alarm to investigate, not silently filter.)
- NBA Cup championship games tagged `*-regular` per DB probe → captured by this view. No special carve-out.
- 2025-postseason games will accrue as the 2025-26 playoffs are played; the view covers them in advance.

**Coverage interpretation pinned (per Math #3 + Stats F4):**
- `box_stats_coverage` reports **team-game coverage rate** (each game contributes one row per team-side, so denominator and numerator are inflated 2× symmetrically). This IS the correct measure for ship rules — a partial game (one side missing) shows up as 50% per-cell coverage which loudly fails Rule 3.
- Per-cell N ≈ 41 (regular season half-side) to ~82 (full season). At N=41 the 94% gate has Wilson 95% CI ≈ ±7pp on observed coverage. Documented in addendum v8 — Rules 1+2 (larger N) provide the cross-check that prevents a single noisy cell from carrying the gate.

**Coverage view (per-(team, season) cell):**
```sql
CREATE VIEW box_stats_coverage AS
WITH team_season_cells AS (
  SELECT season, home_team_id AS team_id FROM nba_eligible_games
  UNION
  SELECT season, away_team_id AS team_id FROM nba_eligible_games
),
games_per_cell AS (
  -- for each (team, season), count eligible games where the team played either side
  SELECT
    season,
    team_id,
    COUNT(*) AS eligible_games
  FROM (
    SELECT season, home_team_id AS team_id FROM nba_eligible_games
    UNION ALL
    SELECT season, away_team_id AS team_id FROM nba_eligible_games
  )
  GROUP BY season, team_id
),
covered_per_cell AS (
  SELECT
    eg.season,
    bs.team_id,
    COUNT(*) AS covered_games
  FROM nba_eligible_games eg
  JOIN nba_game_box_stats bs ON bs.game_id = eg.game_id
  WHERE bs.team_id IN (eg.home_team_id, eg.away_team_id)
  GROUP BY eg.season, bs.team_id
)
SELECT
  g.season,
  g.team_id,
  g.eligible_games,
  COALESCE(c.covered_games, 0)                                AS games_with_full_must_have,
  g.eligible_games - COALESCE(c.covered_games, 0)             AS games_missing_must_have,
  ROUND(100.0 * COALESCE(c.covered_games, 0) / g.eligible_games, 2) AS coverage_pct
FROM games_per_cell g
LEFT JOIN covered_per_cell c USING (season, team_id);
```

**Plus aggregation views for ship-rule evaluation:**
```sql
CREATE VIEW box_stats_coverage_per_season AS
SELECT
  season,
  SUM(eligible_games) AS eligible_games,
  SUM(games_with_full_must_have) AS covered,
  ROUND(100.0 * SUM(games_with_full_must_have) / SUM(eligible_games), 2) AS coverage_pct
FROM box_stats_coverage
GROUP BY season;

CREATE VIEW box_stats_coverage_aggregate AS
SELECT
  SUM(eligible_games) AS eligible_games,
  SUM(games_with_full_must_have) AS covered,
  ROUND(100.0 * SUM(games_with_full_must_have) / SUM(eligible_games), 2) AS coverage_pct
FROM box_stats_coverage;
```

Migration: `CREATE VIEW IF NOT EXISTS` on first DB init.

**Rule evaluation queries** — these MUST evaluate against the **unrounded ratio** (per Math #1; SQLite `ROUND` is half-away-from-zero, so `97.995` rounds to `98.00` and falsely passes Rule 1):

```sql
-- Rule 1: aggregate ≥ 98%
SELECT (1.0 * SUM(games_with_full_must_have) / SUM(eligible_games)) >= 0.98 AS pass
  FROM box_stats_coverage_aggregate;

-- Rule 2: every season ≥ 95%
SELECT MIN(1.0 * games_with_full_must_have / eligible_games) >= 0.95 AS pass
  FROM box_stats_coverage_per_season;

-- Rule 3: every (team, season) cell ≥ 94%
SELECT MIN(1.0 * games_with_full_must_have / eligible_games) >= 0.94 AS pass
  FROM box_stats_coverage;
```

The `coverage_pct` column on the views (rounded to 2 decimals) is for **human-readable reporting only** — it MUST NOT be used in gate logic.

### Component 3 — `scripts/backfill-nba-box-stats.ts`

**CLI:**
```
npx tsx scripts/backfill-nba-box-stats.ts [--season SEASON] [--limit N] [--dry-run]
```
- `--season`: filter to one season (e.g. `2024-regular`).
- `--limit`: hard cap on games processed this run (for testing).
- `--dry-run`: fetch + validate, but skip upsert. Counts only.

**`fetchNbaBoxScore` signature change**: refactor to accept a separate `espnEventId` argument:
```ts
export async function fetchNbaBoxScore(
  gameId: string,        // canonical (e.g. "nba:bdl-N" or "nba:401811002") — written to row.game_id
  espnEventId: string,   // pure ESPN event id (e.g. "401811002") — used for URL only
  homeTeamId: string,
  awayTeamId: string,
  season: string,        // canonical g.season label (e.g. "2024-regular")
): Promise<BoxScoreFetchResult>
```
This separates "what we call this game" from "where ESPN serves it." Fixture tests are updated to pass both args (the existing fixture's `gameId` was `nba:401811002`, so `espnEventId='401811002'` — same value, just split out). Documented in addendum v8.

**Algorithm:**
1. Load eligible-and-unresolved games:
   ```sql
   SELECT eg.game_id, eg.season, eg.home_team_id, eg.away_team_id, m.espn_event_id
   FROM nba_eligible_games eg
   JOIN nba_espn_event_ids m ON m.game_id = eg.game_id
   LEFT JOIN nba_game_box_stats h ON h.game_id = eg.game_id AND h.team_id = eg.home_team_id
   LEFT JOIN nba_game_box_stats a ON a.game_id = eg.game_id AND a.team_id = eg.away_team_id
   WHERE h.game_id IS NULL OR a.game_id IS NULL
   ORDER BY eg.date;
   ```
   (The OR-IS-NULL clause picks up partial games — one side scraped, the other missing — and re-fetches them. Per DQ #8: when a partial game is encountered, the home upsert returns `unchanged` and the away upsert returns `inserted`. Both sides are reported as part of one logical "game completed" event in progress logging.)
2. For each game:
   - `fetchNbaBoxScore(eg.game_id, m.espn_event_id, eg.home_team_id, eg.away_team_id, eg.season)`. The `season` arg is `g.season` directly (e.g. `'2024-regular'`) — stored as-is in `nba_game_box_stats.season` for join-consistency.
   - On `ok: false`: log `scrape_warnings` (source='espn-box-stats', warning_type per failure), continue.
   - On `ok: true`: **wrap both upserts in a single transaction** (per DQ #9):
     ```ts
     const tx = db.transaction(() => {
       upsertNbaBoxStats(result.data.home, now);
       upsertNbaBoxStats(result.data.away, now);
     });
     tx();
     recordScrapeWarnings(result.warnings);
     ```
     Atomic at the per-game level: a mid-game crash leaves both sides absent (next-run picks up cleanly) instead of half-completed.
3. Progress: log `[N/M] season game_id status` every 100 games. `status` = "OK" / "FAIL: <reason>". Track cumulative inserted / unchanged / updated / failed counters. **Each game = 1 progress unit**, regardless of inserted+inserted vs inserted+unchanged outcomes from the two sides.
4. **Post-run summary** prints:
   - Coverage view results: `box_stats_coverage_aggregate` + `_per_season` + minimum cell from `box_stats_coverage`.
   - **Warnings triage gate** (per DQ #7): aggregate query
     ```sql
     SELECT source, warning_type, COUNT(*)
     FROM scrape_warnings
     WHERE scraped_at >= ?  -- run start time
     GROUP BY source, warning_type
     ORDER BY 3 DESC;
     ```
     If any `schema_error` count > 0, print **"REVIEW REQUIRED: schema-error warnings present, investigate before declaring backfill complete."** as a final-line stderr message AND exit 2 (non-zero). If only `missing_field` / `unknown_field`, exit 0 but still print the table.
   - Skip diagnostic from component 1 reused (same SQL pattern, scoped to backfill warnings).

**Rate limit**: existing `rateLimitedFetch` (2 req/s).

**Error handling**: per-game failure is logged + skipped, never aborts the run. Network errors retry per existing `RETRY_ATTEMPTS=3`. Schema failures fail-closed for that game only.

**Resumability**: idempotent by construction.

**Estimated runtime**: 3871 games × 500ms (ESPN fetch) ≈ 32 min. Upsert overhead ≈ 6 min. Total ≈ 40 min.

### Component 4 — `scripts/recheck-recent-box-stats.ts`

**CLI:** `npx tsx scripts/recheck-recent-box-stats.ts` (no args).

**Algorithm:**
1. Find eligible games with `g.date >= datetime('now', '-7 days')` AND `m.espn_event_id IS NOT NULL`.
2. For each: same fetch+upsert as backfill. `upsertNbaBoxStats` change-detection handles the "unchanged vs updated" semantics; audit table captures retroactive ESPN corrections.
3. No `--dry-run` flag — simplicity. Cron-runnable.

**Estimated runtime per tick**: ~7 days × ~12 games/day = ~85 games × 500ms = 42 sec. Cheap.

**Cron wiring**: NOT done in this PR (per addendum v7 §12 — cron ordering is a Phase-3 concern). Script is wired up; cron config is deferred. Document in DEPLOY.md or session log when ready.

### Component 5 — `scripts/audit-espn-box-stats.ts` + ground-truth file

**Ground-truth strategy.** Plan §item 6 says "manually-curated list of basketball-reference URLs." We need:
- 50–100 (game_id, bbref_url, expected_values) tuples.
- 15 raw count fields per game × 50 games = 750 field values, plus bbref-published derived rates.

Manual curation of ~1000 numbers is tedious. Two-pass approach:

**Pass A (this PR)**: write the script + commit `data/espn-bbref-audit-truth.json` with **5 seed entries**, manually curated by me (the implementer) by visiting bbref URLs. Per Domain F5, prefer settled historical games:
- **Seed 1**: 2023-12-09 LAL vs IND (NBA Cup 2023-24 final, neutral-site Vegas) — exercises Cup-KO inclusion + neutral-site path.
- **Seed 2**: 2024-04-19 (or earliest date with playoff data) — first 2023-24 playoff game.
- **Seed 3**: a 2024-25 regular season game (mid-season, e.g. 2025-01-15).
- **Seed 4**: 2024-12-17 OKC vs MIL (NBA Cup 2024-25 final) — second Cup KO test.
- **Seed 5**: a 2025-26 regular season game (current season, e.g. the existing fixture's date 2026-04-07 DEN vs POR).

Run the audit with these 5. Validates the script logic + Oliver-formula correctness via Pred #1 ground-truth comparand.

**Pass B (deferred)**: expand to 50+ games. Until then, the audit is INFORMATIONAL not GATING.

**Honest disposition.** Per addendum v7 §10, ship rule 5 requires the cross-source audit to pass with the full sample. The N=5 partial doesn't satisfy ship rule 5. Documented in addendum-v8: "Rule 5 partially satisfied (N=5 informational); full ship-claim requires Pass B."

**Ground-truth schema (per Pred #1):**
```json
{
  "game_id": "nba:bdl-...",
  "bbref_url": "https://www.basketball-reference.com/boxscores/202312090LAL.html",
  "season_label": "2023-regular",
  "home_team_id": "nba:LAL",
  "away_team_id": "nba:IND",
  "home_raw_counts": {
    "fga": 87, "fgm": 47, "fg3a": 32, "fg3m": 12,
    "fta": 21, "ftm": 17, "oreb": 13, "dreb": 35, "reb": 48,
    "ast": 28, "stl": 6, "blk": 5, "tov": 13, "pf": 22, "pts": 123
  },
  "away_raw_counts": { "...": "..." },
  "home_published_rates": {
    "efg_pct": 0.610,        // bbref's published "eFG%" cell
    "tov_pct": 0.131,        // bbref's published "TOV%" cell
    "ortg": 132.4,           // bbref's published "ORtg" cell
    "pace_or_possessions": 92.9   // bbref's published "Pace" cell (per-48 possessions)
  },
  "away_published_rates": { "...": "..." }
}
```

The `*_published_rates` fields come from **bbref's own rendering** of the box score page (the "Four Factors" section), NOT from our re-derivation. This catches Oliver-formula bugs in our code — if our `eFG% = (FGM + 0.5·3PM)/FGA` had a wrong constant, the audit would flag the discrepancy from bbref's value.

**Script logic:**
1. Load `data/espn-bbref-audit-truth.json`.
2. For each entry: read the actual `nba_game_box_stats` rows for both teams. Compute our derived rates: `efg_pct = (fgm + 0.5*fg3m) / fga`, `tov_pct = tov / (fga + 0.44*fta + tov)`, `ortg = 100 * pts / possessions`, `pace = 48 * possessions / (minutes_played / 5)`.
3. Compare:
   - **Raw counts**: exact match. Any non-zero diff → audit failure for that field.
   - **Derived rates against bbref's published values**: tolerance 1%. Per Math #2, guard `expected === 0` (or near-zero, `< 1e-9`): if `expected_rate === 0`, require `actual_rate === 0` exactly; otherwise compare `Math.abs(actual - expected) / Math.abs(expected) <= 0.01`. (NBA games can't have eFG%=0 in practice but the guard prevents NaN propagation if a future ground-truth entry has a degenerate stat line.)
4. Write `docs/espn-bbref-audit.md`:
   - Sample size N
   - Per-game results table (15 raw count fields × 2 teams + 4 derived rates × 2 teams)
   - Aggregate pass/fail counts (`raw_count_failures`, `derived_rate_failures`)
   - Specific field-level discrepancies if any
   - Ship-rule disposition: "informational only at N=5" or "Pass-B target".

**Format of `data/espn-bbref-audit-truth.json`:** committed to repo. Pass-A entries are real data hand-curated from bbref pages by the implementer; values must be re-verified at impl time (URLs occasionally 404 if bbref reorganizes).

---

## Pre-declared ship rules

This plan does NOT modify the §Phase 2 ship rules in the parent plan. It implements them. Specifically:

- **Rule 1, 2, 3** (coverage gates): evaluated by the views in component 2. Pass condition: ≥98% / ≥95% / ≥94% from the corresponding views, all simultaneously true.
- **Rule 4** (schema integrity): satisfied since addendum v7. New views are additive (CREATE VIEW IF NOT EXISTS); migration tested.
- **Rule 5** (no regression + cross-source audit):
  - **No regression**: `npx tsc --noEmit` clean. `scripts/test-espn-box-schema.ts` and `scripts/test-nba-box-upsert.ts` still pass.
  - **Cross-source audit**: N=5 informational pass in this PR. Full ≥50-sample audit deferred (Pass B).

Phase 2 ship-claim earned ONLY when all 5 rules hold simultaneously, including Pass B audit.

---

## Pre-declared decisions on novel design choices

| Decision | Choice | Rationale |
|---|---|---|
| BDL→ESPN ID resolution | Separate mapping table + resolver script | Keeps backfill simple. Idempotent. ID gap was discovered during planning, not in original plan. |
| `nba_eligible_games` view | Hard-coded season list (`'2023-regular'` … `'2025-postseason'`) | Falsifiable per addendum v7 §9. New seasons require explicit view update — surfaces as code change, not silent drift. Probed: this list covers all 3 in-scope NBA seasons (2023-24, 2024-25, 2025-26 — labeled `<start-year>-regular`). |
| `home_score > 0` filter | **Removed** in v2 per DQ #1 | Probe: 0 games today match `status='final' AND home_score=0`. The filter was defensive but added a silent-exclusion failure mode for hypothetical forfeits. `status='final'` alone is cleaner and falsifiable. |
| Backfill `gameId` arg | Pass canonical BDL ID; add separate `espnEventId` arg to `fetchNbaBoxScore` | Preserves `nba_game_box_stats.game_id` ↔ `games.id` join. Refactor documented in addendum v8. |
| Backfill `season` arg | Pass `g.season` (e.g., `'2024-regular'`) | DB-canonical convention. Stored consistently across the codebase from this point forward. Fixture tests' `'2025-26'` literal is decoupled from backfill behavior. |
| Resolver date matching | ESPN scoreboard `?dates=YYYYMMDD` uses **Eastern Time**, not UTC (probe-verified 2026-04-25). Resolver computes `et_date = strftime('%Y%m%d', g.date, '-5 hours')` and fetches `[et_date−1, et_date, et_date+1]` for **every** game date, dedupes by `event.id`. | Per Domain F2 + DQ #2 BLOCK + Math #1 round-2 (DST robustness). The `-5h` offset is EST-only and would be 1 hour off during EDT — unreachable for NBA scheduled tipoffs but harmless given the 3-day boundary fetch. |
| Resolver match assertion | Exactly one event match required; 0 or ≥2 → log `scrape_warning`, skip | Per DQ #3 — runtime invariant, not a comment. |
| Resolver event status | Status-agnostic (accepts pre-game, in-progress, final) | Per DQ #5 — ESPN event IDs are stable across status states. |
| Coverage gate evaluation | Compare unrounded ratios, not the rounded `coverage_pct` column | Per Math #1 — SQLite `ROUND` is half-away-from-zero; `97.995` → `98.00` would falsely pass. |
| Coverage view interpretation | "Team-game coverage rate" (each game contributes 2 row-units, symmetric in numerator and denominator) | Per Math #3. This is the stricter and more correct measure for ship rules — a partial game (one side missing) shows as 50% per-(team, season) which loudly fails Rule 3. |
| Per-game upsert atomicity | Wrap home + away upserts in a single transaction | Per DQ #9 — atomic at the per-game level. Mid-game crash leaves both sides absent rather than half-completed. |
| Audit derived-rate comparand | Compare against bbref's **published** Four-Factors values, NOT against our own re-derivation | Per Pred #1 — catches Oliver-formula bugs in our code that would otherwise slip through if raw counts match exactly. |
| Audit `expected === 0` guard | If `expected_rate === 0`, require `actual === 0` exactly; otherwise relative tolerance 1% | Per Math #2 — prevents NaN propagation. |
| Audit ground-truth | Pass A = N=5 hand-curated, deferred Pass B = N=50 | Honest scope. Plan §item 6 N=50 is a ship-claim blocker, not a backfill blocker. |
| Cron wiring for recheck | Script committed, cron config deferred | Per addendum v7 §12 — cron ordering is Phase-3-adjacent. |
| Scrape-warnings triage gate | Backfill exits non-zero (exit 2) if any `schema_error` warnings emitted during the run | Per DQ #7 — forces human review before declaring backfill complete. |
| `first_scraped_at` documentation | Migration comment clarifies "observation time, not game time" | Per Pred #3 nit — prevents future feature-engineering misuse. |

---

## Risks + mitigations

1. **ESPN scoreboard returns events on a date that don't match our team abbreviations.** ESPN uses standard 3-letter abbrs (`LAL`, `BOS`, `NY` — note `NY` not `NYK`); our DB uses the same convention. Mitigation: log mismatches as `scrape_warning`, skip game. Post-resolver, query warnings by source/type to catch systematic abbr drift. If many missed, add a per-team alias map in the resolver.
2. **Timezone date matching.** ESPN scoreboard `?dates=YYYYMMDD` uses Eastern Time (probe-verified). Our `g.date` is UTC ISO 8601. **Resolution** (per Domain F2 + DQ #2 + Math #1 round-2): compute `et_date = strftime('%Y%m%d', g.date, '-5 hours')` and fetch `[et_date−1, et_date, et_date+1]` for **every** date in the batch, dedupe events by `event.id`. The `-5h` offset is EST-only (1h off during EDT) but the 3-day window absorbs the drift, plus the [00:00, 01:00) ET window where the offset would matter contains no NBA scheduled tipoffs. DST-robust by construction.
3. **NBA Cup championship game labels.** **Verified post-DB-probe**: 2023-24 Cup final tagged `2023-regular`, 2024-25 Cup final tagged `2024-regular`. Both included by eligible-games view. Risk closed.
4. **Backfill takes ~40 min and a network blip mid-run.** Mitigation: idempotent — re-run picks up where it left off. Per-game fetch+upsert is wrapped in a single transaction (DQ #9).
5. **`upsertNbaBoxStats` race in parallel.** Addendum v7 §5 documented single-threaded assumption. This script honors that — sequential `await` per game.
6. **Ground-truth Pass A bias.** N=5 hand-curated could miss systematic field-mapping bugs. Pass A audit is informational only, NOT a ship gate. Pass B (N=50) closes this.
7. **Scoreboard pagination on high-volume days.** ESPN scoreboard documented as single-payload up to ~25 events per day (Christmas: 5–10 NBA games). Implementation asserts `events.length >= number_of_unresolved_games_on_this_date` after fetch; if pagination ever silently drops events, the assertion fails and a `schema_error` warning is emitted.
8. **Per-cell coverage gate noise at N≈41.** Per Stats F4: at the per-(team, season) Rule-3 gate (≥94%), the Wilson 95% CI on observed coverage is ~±7pp. A truly-94%-covered cell can fail by chance ~10% of the time. Mitigation: Rules 1+2 (larger N → tighter CI) cross-check; a single noisy cell can't carry the gate. Documented in addendum v8.

---

## Files this plan will touch

**New:**
- `scripts/resolve-nba-espn-event-ids.ts`
- `scripts/backfill-nba-box-stats.ts`
- `scripts/recheck-recent-box-stats.ts`
- `scripts/audit-espn-box-stats.ts`
- `data/espn-bbref-audit-truth.json` (5 seed entries)
- `docs/espn-bbref-audit.md` (generated by audit script run)

**Modified:**
- `src/storage/sqlite.ts`: add `nba_espn_event_ids` table, add 4 views (`nba_eligible_games`, `box_stats_coverage`, `box_stats_coverage_per_season`, `box_stats_coverage_aggregate`). Comment on `first_scraped_at` clarifying observation-time semantics (Pred #3).
- `src/scrapers/espn.ts`: refactor `fetchNbaBoxScore` signature to take separate `espnEventId` parameter alongside `gameId`. Existing callers (test scripts) get updated.
- `scripts/test-espn-box-schema.ts` + `scripts/test-nba-box-upsert.ts`: update `fetchNbaBoxScore` calls to new signature (purely additive — pass `gameId` and `espnEventId` separately; for existing fixture they're related: `gameId='nba:401811002'`, `espnEventId='401811002'`). Tests already pass real data; signature change is mechanical.
- `Plans/nba-learned-model.md`: append addendum v8 documenting:
  - (a) BDL→ESPN ID resolution layer (new mapping table + resolver script)
  - (b) `fetchNbaBoxScore` signature change (gameId/espnEventId split, season convention)
  - (c) Audit Pass-A (N=5 informational, this PR) vs Pass-B (N=50, ship-claim blocker)
  - (d) ET-vs-UTC date convention for resolver (per Domain F2)
  - (e) Coverage gate "team-game coverage rate" interpretation (per Math #3)
  - (f) Per-cell CI noise floor at N≈41 (per Stats F4) — informational, not a ship-rule change
  - (g) Unrounded-ratio gate evaluation (per Math #1)
  - (h) Scrape-warnings triage gate at backfill exit
  - (i) `first_scraped_at` observation-time semantics (per Pred #3)

---

## Out of scope (explicit non-goals)

- Deduplicating BDL/ESPN ghost games (`nba:bdl-N` vs `nba:4018N` for same game). Separate data-quality issue.
- Cron config for recheck script (addendum v7 §12).
- Full N=50 cross-source audit ground-truth (Pass B).
- Phase 3 feature export, training filter, or any model code.
- Touching `predictions`, `game_results`, or other non-Phase-2 tables.

---

## Council ask — round 2

Round-1 verdicts: **WARN/CLEAR/CLEAR/CLEAR/CLEAR** (DQ 7, Stats 9, Pred 9, Domain 9, Math 8). Eighteen items folded into the plan; round 2 verifies each is properly resolved.

For round 2 each expert verifies their round-1 fixes are addressed and gives a fresh verdict. Required to reach overall CLEAR before implementation begins.
