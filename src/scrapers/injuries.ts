/**
 * ESPN Injuries scraper — fetches current injury reports for all sports.
 *
 * ESPN's undocumented API provides per-team injury lists with:
 * - Player name, position, team
 * - Status (Out, Day-To-Day, IR, 15-Day-IL, etc.)
 * - Injury type and body part
 * - Expected return date
 *
 * This data is the KEY orthogonal signal for predictions — knowing that
 * a team's star is out tonight changes the expected outcome in ways that
 * season team differential cannot capture (council mandate from lineup
 * prediction review).
 */

import type { Sport } from '../schema/provenance.js';
import { appendLog } from '../storage/json-log.js';
import { getDb } from '../storage/sqlite.js';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const SPORT_PATHS: Record<Sport, string> = {
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  mlb: 'baseball/mlb',
  nhl: 'hockey/nhl',
  mls: 'soccer/usa.1',
  epl: 'soccer/eng.1',
};

export interface InjuryEntry {
  playerId: string;
  playerName: string;
  position: string;
  teamAbbr: string;
  teamId: string;
  sport: Sport;
  /** 'out' | 'day-to-day' | 'ir' | '15-day-il' | '60-day-il' | 'doubtful' | 'questionable' | 'probable' */
  status: string;
  injuryType: string;
  returnDate: string | null;
  shortComment: string;
  fetchedAt: string;
  /** Timestamp when this injury was first observed. Persists across scrape
   *  cycles so the recency filter can distinguish new injuries from chronic
   *  ones (whose impact is already reflected in team differential). */
  firstSeenAt: string;
}

/** Normalize ESPN status strings to a consistent set */
function normalizeStatus(raw: string): string {
  const lower = raw.toLowerCase().replace(/[- ]/g, '');
  if (lower.includes('out')) return 'out';
  if (lower.includes('daytoday') || lower === 'dd') return 'day-to-day';
  if (lower.includes('injuredreserve') || lower === 'ir') return 'ir';
  if (lower.includes('15day')) return '15-day-il';
  if (lower.includes('60day')) return '60-day-il';
  if (lower.includes('doubtful')) return 'doubtful';
  if (lower.includes('questionable')) return 'questionable';
  if (lower.includes('probable')) return 'probable';
  if (lower.includes('active')) return 'active';
  return raw.toLowerCase();
}

/** Determine if a player is effectively unavailable for the next game */
export function isEffectivelyOut(status: string): boolean {
  return ['out', 'ir', '15-day-il', '60-day-il', 'doubtful'].includes(status);
}

interface EspnInjuryResponse {
  injuries?: Array<{
    displayName?: string;
    injuries?: Array<{
      athlete?: {
        id?: number;
        displayName?: string;
        position?: { abbreviation?: string };
        team?: { abbreviation?: string; id?: string };
      };
      status?: { abbreviation?: string; name?: string };
      type?: { abbreviation?: string };
      details?: {
        type?: string;
        returnDate?: string;
      };
      shortComment?: string;
    }>;
  }>;
}

/** Fetch and parse injury data for a sport */
export async function fetchInjuries(sport: Sport): Promise<InjuryEntry[]> {
  // Soccer leagues may not have injury endpoints
  if (sport === 'mls' || sport === 'epl') return [];

  const url = `${ESPN_BASE}/${SPORT_PATHS[sport]}/injuries`;
  const start = Date.now();
  const entries: InjuryEntry[] = [];
  const now = new Date().toISOString();

  try {
    const response = await fetch(url);
    if (!response.ok) {
      appendLog('scrape', {
        timestamp: now,
        source: 'espn',
        sport,
        dataType: 'injuries',
        records: 0,
        gate: 'FAIL',
        durationMs: Date.now() - start,
        error: `HTTP ${response.status}`,
      });
      return [];
    }

    const data = await response.json() as EspnInjuryResponse;

    if (data.injuries) {
      for (const team of data.injuries) {
        if (!team.injuries) continue;
        for (const inj of team.injuries) {
          if (!inj.athlete?.displayName) continue;
          const status = normalizeStatus(
            inj.status?.name ?? inj.status?.abbreviation ?? inj.type?.abbreviation ?? 'unknown'
          );
          // Skip active players — we only care about unavailable ones
          if (status === 'active') continue;

          entries.push({
            playerId: String(inj.athlete.id ?? ''),
            playerName: inj.athlete.displayName,
            position: inj.athlete.position?.abbreviation ?? '',
            teamAbbr: inj.athlete.team?.abbreviation ?? '',
            teamId: `${sport}:${inj.athlete.team?.abbreviation ?? 'UNK'}`,
            sport,
            status,
            injuryType: inj.details?.type ?? '',
            returnDate: inj.details?.returnDate ?? null,
            shortComment: inj.shortComment ?? '',
            fetchedAt: now,
            firstSeenAt: now, // will be overwritten by storeInjuries if player already existed
          });
        }
      }
    }

    appendLog('scrape', {
      timestamp: now,
      source: 'espn',
      sport,
      dataType: 'injuries',
      records: entries.length,
      gate: 'CLEAR',
      durationMs: Date.now() - start,
    });
  } catch (err) {
    appendLog('scrape', {
      timestamp: now,
      source: 'espn',
      sport,
      dataType: 'injuries',
      records: 0,
      gate: 'FAIL',
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return entries;
}

/** Store injuries in the database. Full refresh for the sport: deletes rows
 *  NOT in the current fetch, upserts current ones. Preserves first_seen_at
 *  so the recency filter works correctly across scrape cycles.
 *
 *  Called unconditionally (even when entries is empty) so stale rows from
 *  prior runs are cleared when ESPN returns an empty list. */
export function storeInjuries(sport: Sport, entries: InjuryEntry[]): void {
  const db = getDb();

  // Ensure table exists (with first_seen_at column)
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_injuries (
      player_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      position TEXT,
      team_id TEXT NOT NULL,
      team_abbr TEXT NOT NULL,
      sport TEXT NOT NULL,
      status TEXT NOT NULL,
      injury_type TEXT,
      return_date TEXT,
      short_comment TEXT,
      fetched_at TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      PRIMARY KEY (player_id, sport)
    )
  `);

  // Migration: add first_seen_at if missing on older DBs
  try {
    db.exec(`ALTER TABLE player_injuries ADD COLUMN first_seen_at TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }

  // Delete all entries for this sport, then re-insert current ones.
  // first_seen_at is preserved: if the player already existed, we keep
  // their original first_seen_at; otherwise we set it to now.
  const deleteStmt = db.prepare('DELETE FROM player_injuries WHERE sport = ?');

  // Look up existing first_seen_at for a player
  const lookupStmt = db.prepare(
    `SELECT first_seen_at FROM player_injuries WHERE player_id = ? AND sport = ?`
  );

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO player_injuries
    (player_id, player_name, position, team_id, team_abbr, sport, status, injury_type, return_date, short_comment, fetched_at, first_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertAll = db.transaction(() => {
    // Snapshot existing first_seen_at values before deleting
    const existingFirstSeen = new Map<string, string>();
    for (const e of entries) {
      const row = lookupStmt.get(e.playerId, sport) as { first_seen_at: string } | undefined;
      if (row && row.first_seen_at) {
        existingFirstSeen.set(e.playerId, row.first_seen_at);
      }
    }

    deleteStmt.run(sport);
    for (const e of entries) {
      const firstSeen = existingFirstSeen.get(e.playerId) || e.fetchedAt;
      insertStmt.run(
        e.playerId, e.playerName, e.position, e.teamId, e.teamAbbr,
        e.sport, e.status, e.injuryType, e.returnDate, e.shortComment, e.fetchedAt, firstSeen
      );
    }
  });

  upsertAll();
}

/** Get all effectively-out players for a team. Used by the prediction model
 *  to adjust expected team strength when key players are missing.
 *
 *  Maps snake_case DB columns to camelCase InjuryEntry fields so downstream
 *  code (computeInjuryImpact) can access .playerName, .teamAbbr, .firstSeenAt
 *  correctly. Without this mapping, SELECT * returns snake_case keys and all
 *  camelCase property accesses resolve to undefined. */
export function getTeamInjuries(sport: Sport, teamId: string): InjuryEntry[] {
  const db = getDb();

  // Table might not exist yet
  try {
    const rows = db.prepare(`
      SELECT
        player_id   AS playerId,
        player_name AS playerName,
        position,
        team_id     AS teamId,
        team_abbr   AS teamAbbr,
        sport,
        status,
        injury_type   AS injuryType,
        return_date   AS returnDate,
        short_comment AS shortComment,
        fetched_at    AS fetchedAt,
        first_seen_at AS firstSeenAt
      FROM player_injuries
      WHERE sport = ? AND team_id = ? AND status IN ('out', 'ir', '15-day-il', '60-day-il', 'doubtful')
    `).all(sport, teamId) as InjuryEntry[];
    return rows;
  } catch {
    return []; // Table doesn't exist yet
  }
}
