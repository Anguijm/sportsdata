/**
 * ESPN NBA box-score response validator + schema-drift detector.
 *
 * Council mandate alignment:
 * - Hand-rolled type guards, no zod dependency. Matches the Sprint-8
 *   Engineer mandate documented in `src/scrapers/validators.ts` header.
 *   Plan `Plans/nba-learned-model.md` §Phase 2 item 1 originally said
 *   "Zod schema" — that specification was made without knowledge of
 *   the existing no-zod mandate. See plan addendum v4.
 * - Fail-open on NICE-TO-HAVE fields (log scrape_warning, continue);
 *   fail-closed on MUST-HAVE fields (log scrape_warning, reject game).
 * - Pure module: no DB imports. Warnings are returned to the caller
 *   which writes to `scrape_warnings` table.
 *
 * Schema drift detection surfaces:
 * - `unknown_field`: a field in ESPN's response that isn't in our
 *   recognized set (could be a new ESPN addition we should consider
 *   promoting to NICE-TO-HAVE).
 * - `missing_field`: a MUST-HAVE field absent from the response.
 * - `schema_error`: structural mismatch (wrong type, malformed).
 *
 * Phase 2 implementation-review checklist for this file:
 * - [ ] Cross-check MUST-HAVE field list against an actual ESPN
 *   response (e.g. curl the per-game box-score endpoint for one
 *   known game, diff field names).
 * - [ ] Decide NICE-TO-HAVE extraction policy: best-effort-parse
 *   (current plan) vs strict-reject-if-malformed.
 * - [ ] Add test fixtures in `src/scrapers/__tests__/fixtures/`
 *   with real responses, at least one per season to catch schema
 *   drift across seasons.
 */

// ---------- Parsed output types (what the scraper emits downstream) ----------

/** One team's box-score row as it will be persisted to nba_game_box_stats. */
export interface NbaBoxStatsRow {
  // Keys + audit (MUST-HAVE)
  game_id: string;
  team_id: string;
  season: string;
  first_scraped_at: string; // ISO 8601 UTC
  updated_at: string;       // ISO 8601 UTC

  // Shooting (MUST-HAVE)
  fga: number;
  fgm: number;
  fg3a: number;
  fg3m: number;
  fta: number;
  ftm: number;

  // Rebounds (MUST-HAVE)
  oreb: number;
  dreb: number;
  reb: number;

  // Defense + ball handling (MUST-HAVE)
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;

  // Score + minutes (MUST-HAVE)
  pts: number;
  minutes_played: number;

  // Derived at scrape time (MUST-HAVE)
  possessions: number;

  // NICE-TO-HAVE (nullable)
  time_of_possession?: string | null;
  points_off_turnovers?: number | null;
  fast_break_points?: number | null;
  points_in_paint?: number | null;
  largest_lead?: number | null;
  technical_fouls?: number | null;
  flagrant_fouls?: number | null;
}

/** Box-score for both teams of a single game. */
export interface NbaBoxStatsGame {
  home: NbaBoxStatsRow;
  away: NbaBoxStatsRow;
}

// ---------- Scrape warning (returned to caller; caller persists) ----------

export interface ScrapeWarning {
  warning_type: 'unknown_field' | 'missing_field' | 'schema_error';
  detail: string;
  game_id: string | null;
}

// ---------- Validator result ----------

export type ValidationResult<T> =
  | { ok: true; data: T; warnings: ScrapeWarning[] }
  | { ok: false; reason: string; warnings: ScrapeWarning[] };

// ---------- MUST-HAVE field set ----------

/** Enumerated explicitly so we can diff actual ESPN response keys against
 *  this set and fire `unknown_field` warnings for anything extra. */
export const MUST_HAVE_RAW_FIELDS = [
  'fga', 'fgm', 'fg3a', 'fg3m', 'fta', 'ftm',
  'oreb', 'dreb', 'reb',
  'ast', 'stl', 'blk', 'tov', 'pf',
  'pts', 'minutes_played',
] as const;

export const NICE_TO_HAVE_FIELDS = [
  'time_of_possession', 'points_off_turnovers', 'fast_break_points',
  'points_in_paint', 'largest_lead', 'technical_fouls', 'flagrant_fouls',
] as const;

// ---------- Possessions formula (basketball-reference / Dean Oliver) ----------

/**
 * Pinned possession estimator per plan §Phase 2 (MUST-HAVE derived column).
 * Formula: FGA + 0.44·FTA − OREB + TOV
 * Both teams are averaged and the averaged value is stored per-team per the
 * basketball-reference convention. Averaging happens in the caller, not here
 * (this function returns the single-team estimate).
 */
export function possessionsSingleTeam(row: {
  fga: number; fta: number; oreb: number; tov: number;
}): number {
  return row.fga + 0.44 * row.fta - row.oreb + row.tov;
}

/** Average of home and away single-team estimates — the standard convention. */
export function possessionsAveraged(home: {
  fga: number; fta: number; oreb: number; tov: number;
}, away: {
  fga: number; fta: number; oreb: number; tov: number;
}): number {
  return (possessionsSingleTeam(home) + possessionsSingleTeam(away)) / 2;
}

// ---------- Stub validators (Phase 2 implementation will complete these) ----------

/**
 * Stub: will parse ESPN's per-game boxscore JSON into two NbaBoxStatsRow
 * objects (home + away). Phase 2 implementation completes this once we
 * have sample ESPN responses to trace paths from.
 *
 * Implementation sketch (to guide Phase 2 author):
 * 1. Assert response shape at top level; return schema_error on structural
 *    mismatch.
 * 2. Locate the two team box-score objects (ESPN nests under
 *    `boxscore.teams[i].statistics`).
 * 3. For each team, build a Record<string, string | number> from the stats
 *    array (ESPN uses `name`/`displayValue` pairs).
 * 4. Diff keys against MUST_HAVE_RAW_FIELDS ∪ NICE_TO_HAVE_FIELDS:
 *    - Missing MUST-HAVE → push `missing_field` warning, return ok:false.
 *    - Unknown extras → push `unknown_field` warning, continue.
 * 5. Coerce strings to numbers for numeric fields; schema_error on NaN.
 * 6. Compute possessions per possessionsAveraged(home, away); store per-team.
 * 7. Return ok:true with both rows + accumulated warnings.
 */
export function validateNbaBoxScore(
  _raw: unknown,
  _gameId: string,
  _homeTeamId: string,
  _awayTeamId: string,
  _season: string,
  _scrapedAt: string,
): ValidationResult<NbaBoxStatsGame> {
  return {
    ok: false,
    reason: 'validateNbaBoxScore: not yet implemented (Phase 2 scaffolding only; real ESPN endpoint trace pending)',
    warnings: [],
  };
}
