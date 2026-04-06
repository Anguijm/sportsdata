/**
 * ESPN player stats client — works for all 6 sports.
 * Uses two endpoints:
 *   1. site.api.espn.com/.../teams/{teamId}/roster — get all players on a team
 *   2. sports.core.api.espn.com/v2/sports/.../athletes/{id}/statistics — season stats
 *
 * Sport stat categories vary:
 *   NBA:  general, offensive, defensive
 *   NFL:  general, passing, rushing, receiving, defensive
 *   MLB:  batting, pitching, fielding
 *   NHL:  general, offensive, defensive, goalKeeping, penalties
 *   MLS:  general, offensive, defensive, goalKeeping
 *   EPL:  general, offensive, defensive, goalKeeping
 */

import type { Sport } from '../schema/provenance.js';
import { appendLog, countRecentRequests } from '../storage/json-log.js';

const SITE_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE_BASE = 'https://sports.core.api.espn.com/v2/sports';

const SPORT_PATHS: Record<Sport, { site: string; core: string; coreSeason: string }> = {
  nfl: { site: 'football/nfl', core: 'football/leagues/nfl', coreSeason: '2025' },
  nba: { site: 'basketball/nba', core: 'basketball/leagues/nba', coreSeason: '2025' },
  mlb: { site: 'baseball/mlb', core: 'baseball/leagues/mlb', coreSeason: '2025' },
  nhl: { site: 'hockey/nhl', core: 'hockey/leagues/nhl', coreSeason: '2025' },
  mls: { site: 'soccer/usa.1', core: 'soccer/leagues/usa.1', coreSeason: '2025' },
  epl: { site: 'soccer/eng.1', core: 'soccer/leagues/eng.1', coreSeason: '2025' },
};

// Soccer leagues use season type 1 (regular), others use type 2
const SEASON_TYPE: Record<Sport, number> = {
  nfl: 2, nba: 2, mlb: 2, nhl: 2, mls: 1, epl: 1,
};

const RATE_LIMIT = 60;
const RATE_WINDOW_MIN = 1;

async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const recent = countRecentRequests('espn', RATE_WINDOW_MIN);
  if (recent >= RATE_LIMIT) {
    const waitMs = 5000;
    await new Promise(r => setTimeout(r, waitMs));
  }
  return fn();
}

// --- Player from roster ---

export interface EspnPlayer {
  id: string;
  fullName: string;
  position: string;
  jersey: string;
  age: number | null;
  height: number | null;
  weight: number | null;
  teamId: string;
  teamAbbr: string;
}

interface RawAthlete {
  id: string;
  fullName: string;
  position?: { abbreviation?: string; name?: string } | string;
  jersey?: string;
  age?: number;
  height?: number;
  weight?: number;
}

function normalizeAthlete(raw: RawAthlete, teamId: string, teamAbbr: string): EspnPlayer {
  let position = '';
  if (typeof raw.position === 'string') position = raw.position;
  else if (raw.position) position = raw.position.abbreviation ?? raw.position.name ?? '';
  return {
    id: raw.id,
    fullName: raw.fullName,
    position,
    jersey: raw.jersey ?? '',
    age: raw.age ?? null,
    height: raw.height ?? null,
    weight: raw.weight ?? null,
    teamId,
    teamAbbr,
  };
}

/** Fetch roster for a single team — handles both flat and grouped athlete shapes */
export async function fetchTeamRoster(sport: Sport, teamId: string, teamAbbr: string): Promise<EspnPlayer[]> {
  const url = `${SITE_BASE}/${SPORT_PATHS[sport].site}/teams/${teamId}/roster`;
  const start = Date.now();

  try {
    const response = await rateLimited(() => fetch(url));
    if (!response.ok) throw new Error(`ESPN roster ${response.status}`);
    const data = await response.json() as { athletes?: unknown[] };
    const athletes: EspnPlayer[] = [];

    for (const entry of data.athletes ?? []) {
      const e = entry as { items?: RawAthlete[]; id?: string; fullName?: string };
      if (e.items && Array.isArray(e.items)) {
        // Grouped by position (NFL, MLB, NHL)
        for (const a of e.items) athletes.push(normalizeAthlete(a, teamId, teamAbbr));
      } else if (e.id && e.fullName) {
        // Flat list (EPL, MLS, sometimes NBA)
        athletes.push(normalizeAthlete(e as RawAthlete, teamId, teamAbbr));
      }
    }

    appendLog('scrape', {
      timestamp: new Date().toISOString(),
      source: 'espn',
      sport,
      dataType: `roster-${teamAbbr}`,
      records: athletes.length,
      gate: 'CLEAR',
      durationMs: Date.now() - start,
    });

    return athletes;
  } catch (error) {
    appendLog('scrape', {
      timestamp: new Date().toISOString(),
      source: 'espn',
      sport,
      dataType: `roster-${teamAbbr}`,
      records: 0,
      gate: 'FAIL',
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// --- Player season stats ---

export interface PlayerStatRow {
  playerId: string;
  sport: Sport;
  season: string;
  gamesPlayed: number;
  /** Flat key-value of every stat the API returned */
  stats: Record<string, number>;
}

interface RawStatsResponse {
  splits?: {
    categories?: Array<{
      name: string;
      stats: Array<{
        name: string;
        displayName: string;
        value?: number;
        displayValue?: string;
      }>;
    }>;
  };
}

/** Fetch a single player's season stats */
export async function fetchPlayerStats(sport: Sport, playerId: string): Promise<PlayerStatRow | null> {
  const { core, coreSeason } = SPORT_PATHS[sport];
  const seasonType = SEASON_TYPE[sport];
  const url = `${CORE_BASE}/${core}/seasons/${coreSeason}/types/${seasonType}/athletes/${playerId}/statistics`;

  try {
    const response = await rateLimited(() => fetch(url));
    if (!response.ok) return null; // Players without stats return 404
    const data = await response.json() as RawStatsResponse;

    const stats: Record<string, number> = {};
    let gamesPlayed = 0;

    for (const cat of data.splits?.categories ?? []) {
      for (const s of cat.stats ?? []) {
        if (typeof s.value !== 'number') continue;
        // Prefix with category to avoid collisions: "passing.completions"
        const key = `${cat.name}.${s.name}`;
        stats[key] = s.value;
        // Look for games played in general category
        if (cat.name === 'general' && (s.name === 'gamesPlayed' || s.name === 'GP')) {
          gamesPlayed = s.value;
        }
      }
    }

    if (Object.keys(stats).length === 0) return null;

    return {
      playerId,
      sport,
      season: coreSeason,
      gamesPlayed,
      stats,
    };
  } catch {
    return null;
  }
}

/** Fetch all players + stats for a sport, with per-team callback for incremental persistence */
export async function fetchAllPlayersForSport(
  sport: Sport,
  teams: Array<{ id: string; abbr: string }>,
  onTeam?: (team: string, players: Array<EspnPlayer & PlayerStatRow>) => void
): Promise<Array<EspnPlayer & PlayerStatRow>> {
  const allResults: Array<EspnPlayer & PlayerStatRow> = [];

  for (const team of teams) {
    const roster = await fetchTeamRoster(sport, team.id, team.abbr);
    const teamResults: Array<EspnPlayer & PlayerStatRow> = [];

    for (const player of roster) {
      const stats = await fetchPlayerStats(sport, player.id);
      if (stats) teamResults.push({ ...player, ...stats });
    }

    allResults.push(...teamResults);
    onTeam?.(team.abbr, teamResults);
  }

  return allResults;
}
