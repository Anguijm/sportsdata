/**
 * ESPN undocumented API client.
 * Endpoints are community-documented, stable for years, but not guaranteed.
 * Rate limit: 60 requests/minute (from harness.yml).
 */

import type { Game, Team } from '../schema/index.js';
import type { ProbablePitcher } from '../schema/game.js';
import type { Sport } from '../schema/provenance.js';
import type { ScrapeLogEntry } from '../storage/json-log.js';
import { appendLog, countRecentRequests } from '../storage/json-log.js';
import { formatSeasonLabel, getSeasonYear } from '../analysis/season.js';
import { createProvenance } from './normalizer.js';
import {
  validateScoreboard, validateTeams,
  type EspnScoreboardResponse, type EspnTeamsResponse, type ValidationResult,
} from './validators.js';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const SPORT_PATHS: Record<Sport, string> = {
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  mlb: 'baseball/mlb',
  nhl: 'hockey/nhl',
  mls: 'soccer/usa.1',
  epl: 'soccer/eng.1',
};

const RATE_LIMIT = 60; // per minute
const RATE_WINDOW_MINUTES = 1;

const ESPN_STATUS_MAP: Record<string, Game['status']> = {
  pre: 'scheduled',
  in: 'in_progress',
  post: 'final',
};

/** Council mandate (Sprint 8): retry with backoff, fail-closed on schema drift */
const RETRY_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2000, 4000, 8000];

async function rateLimitedFetch(url: string): Promise<Response> {
  const recentRequests = countRecentRequests('espn', RATE_WINDOW_MINUTES);
  if (recentRequests >= RATE_LIMIT) {
    throw new Error(`ESPN rate limit reached: ${recentRequests}/${RATE_LIMIT} in last ${RATE_WINDOW_MINUTES}m`);
  }
  return fetch(url);
}

/** Optional alerting webhook (Discord, Slack, etc.) — opt-in via env */
async function alertOnFailure(reason: string, sport: Sport, dataType: string): Promise<void> {
  const webhook = process.env.ESPN_ALERT_WEBHOOK;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🚨 ESPN scrape FAIL: ${sport}/${dataType} — ${reason}`,
      }),
    });
  } catch {
    // Alerting failure is non-fatal
  }
}

type FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

/**
 * Council mandate (Sprint 8 / Engineer):
 * Discriminated union return — no throws, easier to gate on.
 * Retry with backoff, fail-closed on schema validation.
 */
async function safeFetch<T>(
  url: string,
  validator: (raw: unknown) => ValidationResult<T>,
): Promise<FetchResult<T>> {
  let lastError = 'unknown';
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await rateLimitedFetch(url);
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`;
        if (attempt < RETRY_ATTEMPTS - 1) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        return { ok: false, reason: lastError };
      }

      const raw = await response.json() as unknown;
      const validation = validator(raw);
      if (!validation.ok) {
        // Schema drift — do NOT retry, fail closed immediately
        return { ok: false, reason: `schema validation failed: ${validation.reason}` };
      }
      return { ok: true, data: validation.data };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < RETRY_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
  }
  return { ok: false, reason: `network error after ${RETRY_ATTEMPTS} attempts: ${lastError}` };
}

/** Fetch, validate, normalize, and log a scrape in one pass */
async function scrapedFetch<TRaw, TResult>(
  sport: Sport,
  endpoint: string,
  dataType: string,
  validator: (raw: unknown) => ValidationResult<TRaw>,
  normalize: (raw: TRaw, sport: Sport, url: string) => TResult[],
  query?: string,
): Promise<TResult[]> {
  const url = `${ESPN_BASE}/${SPORT_PATHS[sport]}/${endpoint}${query ? `?${query}` : ''}`;
  const start = Date.now();

  const logEntry = (overrides: Partial<ScrapeLogEntry>): ScrapeLogEntry => ({
    timestamp: new Date().toISOString(),
    source: 'espn',
    sport,
    dataType,
    records: 0,
    gate: 'CLEAR',
    durationMs: Date.now() - start,
    ...overrides,
  });

  const result = await safeFetch(url, validator);
  if (!result.ok) {
    appendLog('scrape', logEntry({ gate: 'FAIL', error: result.reason }));
    await alertOnFailure(result.reason, sport, dataType);
    // Council mandate: fail-closed → return empty array, do NOT throw
    // Caller can detect via empty result + log entry
    return [];
  }

  const results = normalize(result.data, sport, url);
  appendLog('scrape', logEntry({ records: results.length }));
  return results;
}

/**
 * Fetch scoreboard for a sport.
 *
 * @param sport — league code
 * @param dates — optional ESPN `?dates=` parameter. Accepts `YYYYMMDD` for a
 *   single day or `YYYYMMDD-YYYYMMDD` for a range. When omitted, ESPN returns
 *   the current day's scoreboard window (default behavior).
 */
export function fetchScoreboard(sport: Sport, dates?: string): Promise<Game[]> {
  const query = dates ? `dates=${dates}` : undefined;
  return scrapedFetch(sport, 'scoreboard', 'scoreboard', validateScoreboard, normalizeScoreboard, query);
}

/** Fetch teams for a sport */
export function fetchTeams(sport: Sport): Promise<Team[]> {
  return scrapedFetch(sport, 'teams', 'teams', validateTeams, normalizeTeams);
}

// --- Normalizers (response types now in validators.ts) ---

function normalizeScoreboard(data: EspnScoreboardResponse, sport: Sport, url: string): Game[] {
  return data.events.map((event) => {
    const comp = event.competitions[0];
    const home = comp?.competitors.find((c) => c.homeAway === 'home');
    const away = comp?.competitors.find((c) => c.homeAway === 'away');

    const game: Game = {
      id: `${sport}:${event.id}`,
      sport,
      season: formatSeasonLabel(sport, getSeasonYear(sport, event.date)),
      date: event.date,
      homeTeamId: `${sport}:${home?.team.abbreviation ?? 'UNK'}`,
      awayTeamId: `${sport}:${away?.team.abbreviation ?? 'UNK'}`,
      venue: comp?.venue?.fullName,
      status: ESPN_STATUS_MAP[event.status.type.state] ?? 'scheduled',
      provenance: createProvenance('espn', url),
    };

    if (home?.score && away?.score) {
      // P1-6: Detect overtime from ESPN status detail (e.g., "Final/OT", "Final/2OT")
      const statusDetail = event.status.type.detail ?? event.status.type.description ?? '';
      const isOvertime = /\bOT\b|overtime|shootout/i.test(statusDetail);
      game.score = {
        home: parseInt(home.score, 10),
        away: parseInt(away.score, 10),
        overtime: isOvertime,
      };
    }

    // MLB probable starting pitchers — ESPN includes these on scheduled games.
    // probables[] is at the competition level, each entry has an athlete + team.
    if (sport === 'mlb' && comp?.probables && comp.probables.length >= 2) {
      const pitchers: Game['probablePitchers'] = {};
      for (const p of comp.probables) {
        const teamId = p.athlete.team?.id;
        // Match to home or away by ESPN team ID
        const isHome = teamId?.toString() === home?.id;
        const isAway = teamId?.toString() === away?.id;
        const eraStat = p.statistics?.find(s => s.abbreviation === 'ERA');
        const pitcher: ProbablePitcher = {
          name: p.athlete.fullName ?? p.athlete.displayName,
          espnId: p.athlete.id,
          era: eraStat ? parseFloat(eraStat.displayValue) || 0 : 0,
          record: p.record,
        };
        if (isHome) pitchers.home = pitcher;
        else if (isAway) pitchers.away = pitcher;
        else {
          // Fallback: ESPN convention is first=away, second=home.
          // Council (Data Quality): log when fallback fires so misassignment
          // is auditable rather than silent.
          console.warn(`  ⚠ Pitcher ${pitcher.name}: team.id ${teamId} didn't match home(${home?.id}) or away(${away?.id}), using positional fallback`);
          if (!pitchers.away) pitchers.away = pitcher;
          else if (!pitchers.home) pitchers.home = pitcher;
        }
      }
      if (pitchers.home || pitchers.away) {
        pitchers.fetchedAt = new Date().toISOString();
        game.probablePitchers = pitchers;
      }
    }

    return game;
  });
}

function normalizeTeams(data: EspnTeamsResponse, sport: Sport, url: string): Team[] {
  const teams: Team[] = [];

  for (const sportData of data.sports) {
    for (const league of sportData.leagues) {
      for (const entry of league.teams) {
        const t = entry.team;
        teams.push({
          id: `${sport}:${t.abbreviation}`,
          sport,
          name: t.displayName,
          abbreviation: t.abbreviation,
          city: t.location,
          conference: t.groups?.parent?.name,
          division: t.groups?.name,
          provenance: createProvenance('espn', url),
        });
      }
    }
  }

  return teams;
}
