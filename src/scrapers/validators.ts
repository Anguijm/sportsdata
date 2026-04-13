/**
 * Lightweight runtime validators for ESPN API responses.
 *
 * Council mandate (Sprint 8):
 * - Hand-rolled type guards (no zod dependency — Engineer)
 * - Pure module: no DB imports (Architect)
 * - Used by safeFetch to fail-closed on schema drift
 */

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

// --- ESPN Scoreboard ---

export interface EspnScoreboardResponse {
  events: Array<{
    id: string;
    date: string;
    name: string;
    status: { type: { state: string; completed: boolean; detail?: string; description?: string } };
    competitions: Array<{
      venue?: { fullName: string };
      competitors: Array<{
        id: string;
        homeAway: string;
        team: { abbreviation: string; displayName: string };
        score?: string;
      }>;
      odds?: Array<{ details: string; overUnder: number }>;
      /** MLB probable starting pitchers — present on scheduled games. */
      probables?: Array<{
        athlete: {
          id: number;
          fullName: string;
          displayName: string;
          shortName: string;
          team?: { id: number };
        };
        statistics?: Array<{
          name: string;
          abbreviation: string;
          displayValue: string;
        }>;
        record?: string;
      }>;
    }>;
  }>;
}

export function validateScoreboard(raw: unknown): ValidationResult<EspnScoreboardResponse> {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'response is not an object' };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.events)) {
    return { ok: false, reason: 'events field is missing or not an array' };
  }

  // P2-9: Filter out malformed events instead of failing the whole response.
  // Exhibition/all-star games may have non-standard competitor counts.
  const validEvents: unknown[] = [];
  for (const [i, eventRaw] of (obj.events as unknown[]).entries()) {
    if (!eventRaw || typeof eventRaw !== 'object') {
      console.warn(`ESPN: events[${i}] is not an object, skipping`);
      continue;
    }
    const event = eventRaw as Record<string, unknown>;
    if (typeof event.id !== 'string' || typeof event.date !== 'string') {
      console.warn(`ESPN: events[${i}] missing id or date, skipping`);
      continue;
    }
    if (!event.status || typeof event.status !== 'object') {
      console.warn(`ESPN: events[${i}] missing status, skipping`);
      continue;
    }
    if (!Array.isArray(event.competitions) || event.competitions.length === 0) {
      console.warn(`ESPN: events[${i}] missing competitions, skipping`);
      continue;
    }
    const comp = event.competitions[0] as Record<string, unknown>;
    if (!Array.isArray(comp.competitors) || comp.competitors.length !== 2) {
      console.warn(`ESPN: events[${i}] has ${(comp.competitors as unknown[])?.length ?? 0} competitors (expected 2), skipping`);
      continue;
    }
    validEvents.push(eventRaw);
  }

  // Replace events array with only valid events
  obj.events = validEvents;
  return { ok: true, data: obj as unknown as EspnScoreboardResponse };
}

// --- ESPN Teams ---

export interface EspnTeamsResponse {
  sports: Array<{
    leagues: Array<{
      teams: Array<{
        team: {
          id: string;
          abbreviation: string;
          displayName: string;
          location: string;
          groups?: { parent?: { name: string }; name: string };
        };
      }>;
    }>;
  }>;
}

export function validateTeams(raw: unknown): ValidationResult<EspnTeamsResponse> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'response is not an object' };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.sports) || obj.sports.length === 0) {
    return { ok: false, reason: 'sports field missing or empty' };
  }

  const sport = obj.sports[0] as Record<string, unknown>;
  if (!Array.isArray(sport.leagues) || sport.leagues.length === 0) {
    return { ok: false, reason: 'sports[0].leagues missing or empty' };
  }

  const league = sport.leagues[0] as Record<string, unknown>;
  if (!Array.isArray(league.teams)) {
    return { ok: false, reason: 'sports[0].leagues[0].teams not an array' };
  }

  // Spot-check first team has required fields
  if (league.teams.length > 0) {
    const first = league.teams[0] as Record<string, unknown>;
    if (!first.team || typeof first.team !== 'object') {
      return { ok: false, reason: 'first team entry missing team field' };
    }
    const team = first.team as Record<string, unknown>;
    if (typeof team.abbreviation !== 'string') {
      return { ok: false, reason: 'first team missing abbreviation' };
    }
    if (typeof team.displayName !== 'string') {
      return { ok: false, reason: 'first team missing displayName' };
    }
  }

  return { ok: true, data: raw as EspnTeamsResponse };
}
