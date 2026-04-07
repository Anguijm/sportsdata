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
    status: { type: { state: string; completed: boolean } };
    competitions: Array<{
      venue?: { fullName: string };
      competitors: Array<{
        id: string;
        homeAway: string;
        team: { abbreviation: string; displayName: string };
        score?: string;
      }>;
      odds?: Array<{ details: string; overUnder: number }>;
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

  for (const [i, eventRaw] of (obj.events as unknown[]).entries()) {
    if (!eventRaw || typeof eventRaw !== 'object') {
      return { ok: false, reason: `events[${i}] is not an object` };
    }
    const event = eventRaw as Record<string, unknown>;
    if (typeof event.id !== 'string') return { ok: false, reason: `events[${i}].id missing or not string` };
    if (typeof event.date !== 'string') return { ok: false, reason: `events[${i}].date missing or not string` };
    if (!event.status || typeof event.status !== 'object') {
      return { ok: false, reason: `events[${i}].status missing` };
    }
    if (!Array.isArray(event.competitions)) {
      return { ok: false, reason: `events[${i}].competitions missing or not array` };
    }
    if (event.competitions.length === 0) {
      return { ok: false, reason: `events[${i}].competitions is empty` };
    }
    const comp = event.competitions[0] as Record<string, unknown>;
    if (!Array.isArray(comp.competitors) || comp.competitors.length !== 2) {
      return { ok: false, reason: `events[${i}].competitions[0].competitors must have exactly 2 entries` };
    }
  }

  return { ok: true, data: raw as EspnScoreboardResponse };
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
