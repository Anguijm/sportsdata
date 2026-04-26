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
 * Phase 2 implementation-review status:
 * - MUST-HAVE field list cross-checked against real ESPN responses for
 *   2022-23, 2023-24, 2024-25, 2025-26 fixtures. NICE-TO-HAVE policy:
 *   best-effort-parse (see `parseOneTeamSide` — unknown/malformed NICE
 *   fields emit a warning, validation continues).
 * - Fixtures: `src/scrapers/__tests__/fixtures/espn-nba-box-*.json` —
 *   one regular-season game per in-scope season + one 1-OT case.
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
  // tov is the player-summed turnover convention (matches bbref Pace/ORtg
  // glossary; addendum v10). team-attributed turnovers (24-sec, 8-sec,
  // 5-sec inbound, lane violations, etc.) are stored separately as the
  // NICE-TO-HAVE team_tov below.
  tov: number;
  pf: number;

  // Score + minutes (MUST-HAVE)
  pts: number;
  minutes_played: number;

  // Derived at scrape time (MUST-HAVE)
  possessions: number;

  // NICE-TO-HAVE (nullable). NOTE: time_of_possession removed — NBA boxscores
  // don't report it (see impl-review, addendum v7).
  points_off_turnovers?: number | null;
  fast_break_points?: number | null;
  points_in_paint?: number | null;
  largest_lead?: number | null;
  technical_fouls?: number | null;
  flagrant_fouls?: number | null;
  // team-attributed turnovers (added addendum v10). team_tov + tov ==
  // ESPN totalTurnovers as a structural identity; the consistency check
  // surfaces parse-level drift in scrape_warnings.
  team_tov?: number | null;
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
  'points_off_turnovers', 'fast_break_points',
  'points_in_paint', 'largest_lead', 'technical_fouls', 'flagrant_fouls',
  'team_tov',
] as const;

// ---------- Possessions formula (basketball-reference / Dean Oliver) ----------

/**
 * Pinned possession estimator per plan §Phase 2 (MUST-HAVE derived column).
 * Formula: FGA + 0.44·FTA − OREB + TOV
 * `tov` is the player-summed turnover convention (matches bbref Pace/ORtg
 * glossary; addendum v10). Both teams are averaged and the averaged value
 * is stored per-team per the basketball-reference convention. Averaging
 * happens in the caller, not here (this function returns the single-team
 * estimate).
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

/** ESPN per-team statistics entry (boxscore.teams[i].statistics[j]). */
interface EspnTeamStat {
  name: string;
  displayValue: string;
}

/** Map from ESPN stat `name` to our parsing behavior.
 *  `kind: 'made-att'` parses "42-89" into [made, attempts].
 *  `kind: 'int'` parses the displayValue as an integer.
 *  `kind: 'check-only'` parses the displayValue but does NOT persist to the
 *    NbaBoxStatsRow; the value is captured in a side-channel for consistency
 *    checks (e.g., totalTurnovers ?= turnovers + teamTurnovers — addendum v10).
 *  `must_have` means a missing field produces `missing_field` + ok:false.
 *  For `kind: 'check-only'` entries, `targets` names the side-channel key.
 */
type FieldMap = Record<string, {
  kind: 'int' | 'made-att' | 'check-only';
  must_have: boolean;
  targets: readonly string[]; // which NbaBoxStatsRow field(s) this populates
}>;

const ESPN_FIELD_MAP: FieldMap = {
  // MUST-HAVE combined "made-attempted" counts
  'fieldGoalsMade-fieldGoalsAttempted': { kind: 'made-att', must_have: true, targets: ['fgm', 'fga'] },
  'threePointFieldGoalsMade-threePointFieldGoalsAttempted': { kind: 'made-att', must_have: true, targets: ['fg3m', 'fg3a'] },
  'freeThrowsMade-freeThrowsAttempted': { kind: 'made-att', must_have: true, targets: ['ftm', 'fta'] },

  // MUST-HAVE simple counts
  'offensiveRebounds': { kind: 'int', must_have: true, targets: ['oreb'] },
  'defensiveRebounds': { kind: 'int', must_have: true, targets: ['dreb'] },
  'totalRebounds': { kind: 'int', must_have: true, targets: ['reb'] },
  'assists': { kind: 'int', must_have: true, targets: ['ast'] },
  'steals': { kind: 'int', must_have: true, targets: ['stl'] },
  'blocks': { kind: 'int', must_have: true, targets: ['blk'] },
  // `turnovers` = player-summed (sum of individual stat lines). Matches
  // basketball-reference Pace/ORtg glossary convention. Addendum v10 switched
  // from `totalTurnovers` (player + team) to this. team-attributed turnovers
  // are captured separately as the NICE-TO-HAVE `teamTurnovers` → team_tov.
  'turnovers': { kind: 'int', must_have: true, targets: ['tov'] },
  'fouls': { kind: 'int', must_have: true, targets: ['pf'] },

  // NICE-TO-HAVE
  // team-attributed turnovers (24-sec, 8-sec, 5-sec inbound, lane violations,
  // illegal-screens not charged to an individual, etc.). NICE-TO-HAVE: NULL
  // if absent in the ESPN response (older fixtures may omit). Addendum v10.
  'teamTurnovers': { kind: 'int', must_have: false, targets: ['team_tov'] },
  'turnoverPoints': { kind: 'int', must_have: false, targets: ['points_off_turnovers'] },
  'fastBreakPoints': { kind: 'int', must_have: false, targets: ['fast_break_points'] },
  'pointsInPaint': { kind: 'int', must_have: false, targets: ['points_in_paint'] },
  'largestLead': { kind: 'int', must_have: false, targets: ['largest_lead'] },
  // ESPN has both 'technicalFouls' and 'totalTechnicalFouls'; prefer the total.
  'totalTechnicalFouls': { kind: 'int', must_have: false, targets: ['technical_fouls'] },
  'flagrantFouls': { kind: 'int', must_have: false, targets: ['flagrant_fouls'] },

  // CHECK-ONLY: parsed for the consistency check
  // `tov + team_tov == totalTurnovers` (addendum v10). Not stored to a column;
  // value captured in the parser's consistencyValues side-channel. Not
  // must_have because the canonical `tov` is already independently sourced
  // from `turnovers`; if `totalTurnovers` is absent we just skip the check.
  'totalTurnovers': { kind: 'check-only', must_have: false, targets: ['totalTurnovers'] },
};

/** ESPN stat keys we recognize but intentionally don't map to our schema
 *  (avoids firing `unknown_field` warnings on every game for fields we
 *  already know about and have decided not to persist). */
const RECOGNIZED_BUT_UNMAPPED = new Set<string>([
  'fieldGoalPct', 'threePointFieldGoalPct', 'freeThrowPct', // we derive rates downstream
  'technicalFouls', // we use totalTechnicalFouls
  'leadChanges', 'leadPercentage', // informational, not features
]);

function parseInt10(s: string, field: string, warnings: ScrapeWarning[], gameId: string): number | null {
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) {
    warnings.push({ warning_type: 'schema_error', detail: `${field}: non-numeric displayValue "${s}"`, game_id: gameId });
    return null;
  }
  return n;
}

function parseMadeAtt(s: string, field: string, warnings: ScrapeWarning[], gameId: string): [number, number] | null {
  const parts = s.split('-');
  if (parts.length !== 2) {
    warnings.push({ warning_type: 'schema_error', detail: `${field}: expected "made-att" format, got "${s}"`, game_id: gameId });
    return null;
  }
  const made = Number.parseInt(parts[0], 10);
  const att = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(made) || !Number.isFinite(att)) {
    warnings.push({ warning_type: 'schema_error', detail: `${field}: non-numeric in "${s}"`, game_id: gameId });
    return null;
  }
  return [made, att];
}

/** Convert a minutes token to integer minutes (floor).
 *  Accepts "M:SS" / "MM:SS" (legacy ESPN format) OR a plain integer string
 *  like "35" (current ESPN format). Returns null on malformed or empty. */
function parseMinutesToken(s: string): number | null {
  if (!s) return null;
  if (s.includes(':')) {
    const parts = s.split(':');
    if (parts.length !== 2) return null;
    const m = Number.parseInt(parts[0], 10);
    return Number.isFinite(m) ? m : null;
  }
  const m = Number.parseInt(s, 10);
  return Number.isFinite(m) ? m : null;
}

/** Type guards for nested payload shape. */
function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function isArr(x: unknown): x is unknown[] {
  return Array.isArray(x);
}

interface ParsedTeamSide {
  teamAbbr: string;
  stats: Partial<NbaBoxStatsRow>;
  pts: number;
  minutes_played: number;
  warnings: ScrapeWarning[];
}

/** Extract period count from ESPN header. Regulation = 4 periods; each OT
 *  adds a period. Parses `header.competitions[0].status.type.detail`
 *  (e.g. "Final", "Final/OT", "Final/2OT") — same convention as the
 *  existing scoreboard normalizer in espn.ts. Returns 4 (regulation) if
 *  the field is missing/malformed.
 *
 *  Exported for direct testability of the fallback path. */
export function extractPeriodsPlayed(header: unknown): number {
  if (!isObj(header)) return 4;
  const comps = header.competitions;
  if (!isArr(comps) || !isObj(comps[0])) return 4;
  const status = (comps[0] as Record<string, unknown>).status;
  if (!isObj(status)) return 4;
  const type = status.type;
  if (!isObj(type)) return 4;
  const detail = typeof type.detail === 'string'
    ? type.detail
    : typeof type.description === 'string' ? type.description : '';
  // "Final/OT" → 1 OT; "Final/2OT" → 2 OT; "Final/3OT" → 3 OT; "Final" → 0.
  const m = /(\d*)OT\b/i.exec(detail);
  if (!m) return 4;
  const otCount = m[1] === '' ? 1 : Number.parseInt(m[1], 10);
  if (!Number.isFinite(otCount) || otCount < 1) return 4;
  return 4 + otCount;
}

/** Regulation minutes per team = 48 min × 5 floor positions = 240.
 *  Each 5-min OT period adds 25 team-minutes. Exported for testability. */
export function regulationPlusOtMinutes(periodsPlayed: number): number {
  const otPeriods = Math.max(0, periodsPlayed - 4);
  return 240 + 25 * otPeriods;
}

function parseOneTeamSide(
  boxTeam: unknown,
  playersTeam: unknown,
  scoreStr: string,
  gameId: string,
  periodsPlayed: number,
): { ok: true; side: ParsedTeamSide } | { ok: false; reason: string; warnings: ScrapeWarning[] } {
  const warnings: ScrapeWarning[] = [];

  if (!isObj(boxTeam)) return { ok: false, reason: 'boxscore.teams[i] not an object', warnings };
  const teamObj = boxTeam.team;
  if (!isObj(teamObj) || typeof teamObj.abbreviation !== 'string') {
    return { ok: false, reason: 'boxscore.teams[i].team.abbreviation missing', warnings };
  }
  const teamAbbr = teamObj.abbreviation;

  const statistics = boxTeam.statistics;
  if (!isArr(statistics)) {
    return { ok: false, reason: `team ${teamAbbr}: statistics not an array`, warnings };
  }

  const stats: Partial<NbaBoxStatsRow> = {};
  const seenNames = new Set<string>();
  // Side-channel for `kind: 'check-only'` values used in post-parse consistency
  // assertions (e.g., totalTurnovers ?= tov + team_tov — addendum v10).
  const consistencyValues: Record<string, number> = {};

  for (const raw of statistics) {
    if (!isObj(raw)) continue;
    const stat = raw as Partial<EspnTeamStat>;
    if (typeof stat.name !== 'string' || typeof stat.displayValue !== 'string') {
      warnings.push({ warning_type: 'schema_error', detail: `team ${teamAbbr}: malformed stat entry`, game_id: gameId });
      continue;
    }
    seenNames.add(stat.name);
    const spec = ESPN_FIELD_MAP[stat.name];
    if (!spec) {
      if (!RECOGNIZED_BUT_UNMAPPED.has(stat.name)) {
        warnings.push({ warning_type: 'unknown_field', detail: `team ${teamAbbr}: unknown stat name "${stat.name}"`, game_id: gameId });
      }
      continue;
    }
    if (spec.kind === 'int') {
      const v = parseInt10(stat.displayValue, stat.name, warnings, gameId);
      if (v != null) (stats as Record<string, number>)[spec.targets[0]] = v;
    } else if (spec.kind === 'made-att') {
      const parsed = parseMadeAtt(stat.displayValue, stat.name, warnings, gameId);
      if (parsed != null) {
        (stats as Record<string, number>)[spec.targets[0]] = parsed[0];
        (stats as Record<string, number>)[spec.targets[1]] = parsed[1];
      }
    } else if (spec.kind === 'check-only') {
      const v = parseInt10(stat.displayValue, stat.name, warnings, gameId);
      if (v != null) consistencyValues[spec.targets[0]] = v;
    }
  }

  // MUST-HAVE presence check
  for (const [espnName, spec] of Object.entries(ESPN_FIELD_MAP)) {
    if (!spec.must_have) continue;
    if (!seenNames.has(espnName)) {
      warnings.push({ warning_type: 'missing_field', detail: `team ${teamAbbr}: MUST-HAVE field "${espnName}" absent`, game_id: gameId });
      return { ok: false, reason: `team ${teamAbbr}: MUST-HAVE field "${espnName}" absent`, warnings };
    }
  }

  // Consistency + bounds checks (addendum v10).
  // - tov + team_tov == totalTurnovers (sum-identity).
  // - tov ∈ [0, 40], team_tov ∈ [0, 10], tov ≥ team_tov (per-component bounds).
  // All violations emit `schema_error` warnings but do not flip ok:false; the
  // canonical `tov` value is already sourced from ESPN's `turnovers` field
  // which is well-defined independently. Hard-failing would orphan the row
  // from coverage gates for what is informational drift, not data corruption.
  // Cross-source bbref consistency remains the audit-script's job, not a
  // per-scrape assertion.
  const tov = stats.tov;
  const teamTov = stats.team_tov;
  if (typeof tov === 'number') {
    if (tov < 0 || tov > 40) {
      warnings.push({ warning_type: 'schema_error', detail: `team ${teamAbbr}: tov out of bounds [0,40]: ${tov}`, game_id: gameId });
    }
  }
  if (typeof teamTov === 'number') {
    if (teamTov < 0 || teamTov > 10) {
      warnings.push({ warning_type: 'schema_error', detail: `team ${teamAbbr}: team_tov out of bounds [0,10]: ${teamTov}`, game_id: gameId });
    }
    if (typeof tov === 'number' && tov < teamTov) {
      warnings.push({ warning_type: 'schema_error', detail: `team ${teamAbbr}: tov<team_tov violates ordering: tov=${tov}, team_tov=${teamTov}`, game_id: gameId });
    }
  }
  if (typeof tov === 'number' && typeof teamTov === 'number' && 'totalTurnovers' in consistencyValues) {
    const expected = tov + teamTov;
    const got = consistencyValues.totalTurnovers;
    if (expected !== got) {
      warnings.push({ warning_type: 'schema_error', detail: `team ${teamAbbr}: tov+team_tov!=totalTurnovers: ${tov}+${teamTov}=${expected}, got ${got}`, game_id: gameId });
    }
  }

  // Points: score is authoritative (from header.competitions[0].competitors[i].score)
  const pts = Number.parseInt(scoreStr, 10);
  if (!Number.isFinite(pts)) {
    return { ok: false, reason: `team ${teamAbbr}: score "${scoreStr}" not an integer`, warnings };
  }

  // Minutes: sum per-player minutes (label "MIN" in players[].statistics[0])
  let minutesTotal = 0;
  if (isObj(playersTeam) && isArr(playersTeam.statistics) && playersTeam.statistics.length > 0) {
    const first = playersTeam.statistics[0];
    if (isObj(first) && isArr(first.labels) && isArr(first.athletes)) {
      const minIdx = first.labels.indexOf('MIN');
      if (minIdx >= 0) {
        for (const ath of first.athletes) {
          if (!isObj(ath) || !isArr(ath.stats)) continue;
          const token = ath.stats[minIdx];
          if (typeof token === 'string') {
            const m = parseMinutesToken(token);
            if (m != null) minutesTotal += m;
          }
        }
      }
    }
  }
  if (minutesTotal === 0) {
    // Fallback path: player-summation failed (malformed players array, empty
    // stats, etc.). Use regulation + OT-period count from header instead of
    // a bare 240 — a 240 in an OT game would contaminate per-minute features
    // downstream. Emit a warning so the fallback is detectable post-backfill.
    const fallback = regulationPlusOtMinutes(periodsPlayed);
    warnings.push({
      warning_type: 'missing_field',
      detail: `team ${teamAbbr}: could not derive minutes_played from player totals; using period-aware fallback ${fallback} (periods=${periodsPlayed})`,
      game_id: gameId,
    });
    minutesTotal = fallback;
  }

  return {
    ok: true,
    side: { teamAbbr, stats, pts, minutes_played: minutesTotal, warnings },
  };
}

export function validateNbaBoxScore(
  raw: unknown,
  gameId: string,
  homeTeamId: string,
  awayTeamId: string,
  season: string,
  scrapedAt: string,
): ValidationResult<NbaBoxStatsGame> {
  const warnings: ScrapeWarning[] = [];

  if (!isObj(raw)) {
    return { ok: false, reason: 'response is not an object', warnings };
  }

  const boxscore = raw.boxscore;
  if (!isObj(boxscore)) return { ok: false, reason: 'boxscore missing or not an object', warnings };
  const boxTeams = boxscore.teams;
  if (!isArr(boxTeams) || boxTeams.length !== 2) {
    return { ok: false, reason: 'boxscore.teams: expected length 2', warnings };
  }
  const boxPlayers = boxscore.players;
  if (!isArr(boxPlayers) || boxPlayers.length !== 2) {
    return { ok: false, reason: 'boxscore.players: expected length 2', warnings };
  }

  // Get scores + homeAway from header.competitions[0].competitors
  const header = raw.header;
  if (!isObj(header)) return { ok: false, reason: 'header missing', warnings };
  const comps = header.competitions;
  if (!isArr(comps) || !isObj(comps[0])) return { ok: false, reason: 'header.competitions[0] missing', warnings };
  const competitors = (comps[0] as Record<string, unknown>).competitors;
  if (!isArr(competitors) || competitors.length !== 2) {
    return { ok: false, reason: 'header competitors: expected length 2', warnings };
  }

  // Map abbreviation → homeAway + score. We'll pair by boxscore.teams[i].team.abbreviation.
  const bySideAbbr = new Map<string, { homeAway: string; score: string }>();
  for (const c of competitors) {
    if (!isObj(c)) continue;
    const tm = c.team;
    const abbr = isObj(tm) && typeof tm.abbreviation === 'string' ? tm.abbreviation : null;
    const score = typeof c.score === 'string' ? c.score : null;
    const homeAway = typeof c.homeAway === 'string' ? c.homeAway : null;
    if (abbr && score != null && homeAway) {
      bySideAbbr.set(abbr, { homeAway, score });
    }
  }
  if (bySideAbbr.size !== 2) {
    return { ok: false, reason: 'could not extract home/away from competitors', warnings };
  }

  // Extract period count once (header-level), used for minutes fallback.
  const periodsPlayed = extractPeriodsPlayed(header);

  // Parse both teams
  const sides: ParsedTeamSide[] = [];
  for (let i = 0; i < 2; i++) {
    const boxTeam = boxTeams[i];
    if (!isObj(boxTeam) || !isObj(boxTeam.team) || typeof boxTeam.team.abbreviation !== 'string') {
      return { ok: false, reason: `boxscore.teams[${i}]: abbreviation missing`, warnings };
    }
    const abbr = boxTeam.team.abbreviation;
    const meta = bySideAbbr.get(abbr);
    if (!meta) {
      return { ok: false, reason: `team ${abbr} absent from header competitors`, warnings };
    }
    const parsed = parseOneTeamSide(boxTeam, boxPlayers[i], meta.score, gameId, periodsPlayed);
    if (!parsed.ok) {
      warnings.push(...parsed.warnings);
      return { ok: false, reason: parsed.reason, warnings };
    }
    warnings.push(...parsed.side.warnings);
    sides.push(parsed.side);
  }

  // Assign home/away
  const [sideA, sideB] = sides;
  const metaA = bySideAbbr.get(sideA.teamAbbr)!;
  const homeSide = metaA.homeAway === 'home' ? sideA : sideB;
  const awaySide = metaA.homeAway === 'home' ? sideB : sideA;

  // Verify caller-provided team IDs match the home/away abbreviations
  const homeAbbrFromId = homeTeamId.replace(/^nba:/, '');
  const awayAbbrFromId = awayTeamId.replace(/^nba:/, '');
  if (homeSide.teamAbbr !== homeAbbrFromId) {
    warnings.push({ warning_type: 'schema_error', detail: `home team mismatch: expected ${homeAbbrFromId}, got ${homeSide.teamAbbr}`, game_id: gameId });
    return { ok: false, reason: `home team mismatch: expected ${homeAbbrFromId}, got ${homeSide.teamAbbr}`, warnings };
  }
  if (awaySide.teamAbbr !== awayAbbrFromId) {
    warnings.push({ warning_type: 'schema_error', detail: `away team mismatch: expected ${awayAbbrFromId}, got ${awaySide.teamAbbr}`, game_id: gameId });
    return { ok: false, reason: `away team mismatch: expected ${awayAbbrFromId}, got ${awaySide.teamAbbr}`, warnings };
  }

  // Possessions: averaged convention (plan §Phase 2 MUST-HAVE).
  const homeBase = {
    fga: homeSide.stats.fga!, fta: homeSide.stats.fta!,
    oreb: homeSide.stats.oreb!, tov: homeSide.stats.tov!,
  };
  const awayBase = {
    fga: awaySide.stats.fga!, fta: awaySide.stats.fta!,
    oreb: awaySide.stats.oreb!, tov: awaySide.stats.tov!,
  };
  const possessions = possessionsAveraged(homeBase, awayBase);

  // Assemble final rows
  const assemble = (side: ParsedTeamSide, teamId: string): NbaBoxStatsRow => ({
    game_id: gameId,
    team_id: teamId,
    season,
    first_scraped_at: scrapedAt,
    updated_at: scrapedAt,
    fga: side.stats.fga!, fgm: side.stats.fgm!,
    fg3a: side.stats.fg3a!, fg3m: side.stats.fg3m!,
    fta: side.stats.fta!, ftm: side.stats.ftm!,
    oreb: side.stats.oreb!, dreb: side.stats.dreb!, reb: side.stats.reb!,
    ast: side.stats.ast!, stl: side.stats.stl!, blk: side.stats.blk!,
    tov: side.stats.tov!, pf: side.stats.pf!,
    pts: side.pts,
    minutes_played: side.minutes_played,
    possessions,
    points_off_turnovers: side.stats.points_off_turnovers ?? null,
    fast_break_points: side.stats.fast_break_points ?? null,
    points_in_paint: side.stats.points_in_paint ?? null,
    largest_lead: side.stats.largest_lead ?? null,
    technical_fouls: side.stats.technical_fouls ?? null,
    flagrant_fouls: side.stats.flagrant_fouls ?? null,
    team_tov: side.stats.team_tov ?? null,
  });

  return {
    ok: true,
    data: {
      home: assemble(homeSide, homeTeamId),
      away: assemble(awaySide, awayTeamId),
    },
    warnings,
  };
}
