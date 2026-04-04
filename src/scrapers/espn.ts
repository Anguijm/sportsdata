/**
 * ESPN undocumented API client.
 * Endpoints are community-documented, stable for years, but not guaranteed.
 * Rate limit: 60 requests/minute (from harness.yml).
 */

import type { Game, Team } from '../schema/index.js';
import type { Sport } from '../schema/provenance.js';
import type { ScrapeLogEntry } from '../storage/json-log.js';
import { appendLog, countRecentRequests } from '../storage/json-log.js';
import { createProvenance } from './normalizer.js';

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

async function rateLimitedFetch(url: string): Promise<Response> {
  const recentRequests = countRecentRequests('espn', RATE_WINDOW_MINUTES);
  if (recentRequests >= RATE_LIMIT) {
    throw new Error(`ESPN rate limit reached: ${recentRequests}/${RATE_LIMIT} in last ${RATE_WINDOW_MINUTES}m`);
  }
  return fetch(url);
}

/** Fetch, normalize, and log a scrape in one pass */
async function scrapedFetch<TRaw, TResult>(
  sport: Sport,
  endpoint: string,
  dataType: string,
  normalize: (raw: TRaw, sport: Sport, url: string) => TResult[]
): Promise<TResult[]> {
  const url = `${ESPN_BASE}/${SPORT_PATHS[sport]}/${endpoint}`;
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

  try {
    const response = await rateLimitedFetch(url);
    if (!response.ok) {
      throw new Error(`ESPN returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as TRaw;
    const results = normalize(data, sport, url);

    appendLog('scrape', logEntry({ records: results.length }));
    return results;
  } catch (error) {
    appendLog('scrape', logEntry({
      gate: 'FAIL',
      error: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
}

/** Fetch current scoreboard for a sport */
export function fetchScoreboard(sport: Sport): Promise<Game[]> {
  return scrapedFetch(sport, 'scoreboard', 'scoreboard', normalizeScoreboard);
}

/** Fetch teams for a sport */
export function fetchTeams(sport: Sport): Promise<Team[]> {
  return scrapedFetch(sport, 'teams', 'teams', normalizeTeams);
}

// --- ESPN Response Types (partial, based on community docs) ---

interface EspnScoreboardResponse {
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

interface EspnTeamsResponse {
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

// --- Normalizers ---

function normalizeScoreboard(data: EspnScoreboardResponse, sport: Sport, url: string): Game[] {
  return data.events.map((event) => {
    const comp = event.competitions[0];
    const home = comp?.competitors.find((c) => c.homeAway === 'home');
    const away = comp?.competitors.find((c) => c.homeAway === 'away');

    const game: Game = {
      id: `${sport}:${event.id}`,
      sport,
      season: '',
      date: event.date,
      homeTeamId: `${sport}:${home?.team.abbreviation ?? 'UNK'}`,
      awayTeamId: `${sport}:${away?.team.abbreviation ?? 'UNK'}`,
      venue: comp?.venue?.fullName,
      status: ESPN_STATUS_MAP[event.status.type.state] ?? 'scheduled',
      provenance: createProvenance('espn', url),
    };

    if (home?.score && away?.score) {
      game.score = {
        home: parseInt(home.score, 10),
        away: parseInt(away.score, 10),
        overtime: false,
      };
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
