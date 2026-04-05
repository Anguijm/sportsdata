/**
 * BallDontLie API client — NBA historical game data.
 * Free tier: 5 req/min per sport. Cursor-based pagination.
 * API key from BALLDONTLIE_API_KEY environment variable.
 */

import type { Game } from '../schema/index.js';
import { appendLog } from '../storage/json-log.js';
import { createProvenance } from './normalizer.js';
import { resolveByProviderName } from '../storage/sqlite.js';

const BDL_BASE = 'https://api.balldontlie.io';
const RATE_DELAY_MS = 15000; // 5 req/min = 1 per 12s, pad to 15s for safety

function getApiKey(): string {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error('BALLDONTLIE_API_KEY environment variable not set');
  return key;
}

async function bdlFetch(path: string, retries = 2): Promise<unknown> {
  const url = `${BDL_BASE}${path}`;
  const response = await fetch(url, {
    headers: { Authorization: getApiKey() },
  });
  if (response.status === 429 && retries > 0) {
    console.log(`  ⟳ Rate limited, waiting 30s...`);
    await new Promise(resolve => setTimeout(resolve, 30000));
    return bdlFetch(path, retries - 1);
  }
  if (!response.ok) {
    throw new Error(`BDL returned ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

// --- Response types ---

interface BdlGamesResponse {
  data: BdlGame[];
  meta: { next_cursor: number | null; per_page: number };
}

interface BdlGame {
  id: number;
  date: string;
  season: number;
  status: string;
  home_team: BdlTeam;
  visitor_team: BdlTeam;
  home_team_score: number;
  visitor_team_score: number;
  postseason: boolean;
}

interface BdlTeam {
  id: number;
  name: string;
  full_name: string;
  abbreviation: string;
  city: string;
  conference: string;
  division: string;
}

// --- Normalizer ---

function bdlGameToGame(g: BdlGame): Game {
  // Try to resolve to canonical IDs via team mapping
  const homeCanonical = resolveByProviderName('balldontlie', g.home_team.full_name);
  const awayCanonical = resolveByProviderName('balldontlie', g.visitor_team.full_name);

  const homeId = homeCanonical ?? `nba:${g.home_team.abbreviation}`;
  const awayId = awayCanonical ?? `nba:${g.visitor_team.abbreviation}`;

  const isFinal = g.status === 'Final' || g.home_team_score + g.visitor_team_score > 0;

  return {
    id: `nba:bdl-${g.id}`,
    sport: 'nba',
    season: `${g.season}-${g.postseason ? 'postseason' : 'regular'}`,
    date: g.date,
    homeTeamId: homeId,
    awayTeamId: awayId,
    status: isFinal ? 'final' : 'scheduled',
    score: isFinal ? {
      home: g.home_team_score,
      away: g.visitor_team_score,
      overtime: false,
    } : undefined,
    provenance: createProvenance('balldontlie'),
  };
}

// --- Public API ---

/** Fetch all NBA games for a season with pagination and rate limiting */
export async function fetchNbaSeason(season: number): Promise<Game[]> {
  const allGames: Game[] = [];
  let cursor: number | null = null;
  let page = 0;
  const start = Date.now();

  try {
    do {
      const path = `/nba/v1/games?seasons[]=${season}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`;
      const data = await bdlFetch(path) as BdlGamesResponse;

      const games = data.data.map(bdlGameToGame);
      allGames.push(...games);
      cursor = data.meta.next_cursor;
      page++;

      process.stdout.write(`\r  Season ${season}: ${allGames.length} games (page ${page})...`);

      // Rate limit: wait between requests
      if (cursor) {
        await new Promise(resolve => setTimeout(resolve, RATE_DELAY_MS));
      }
    } while (cursor);

    console.log(`\r  Season ${season}: ${allGames.length} games total              `);

    appendLog('scrape', {
      timestamp: new Date().toISOString(),
      source: 'balldontlie',
      sport: 'nba',
      dataType: `season-${season}`,
      records: allGames.length,
      gate: 'CLEAR',
      durationMs: Date.now() - start,
    });

    return allGames;
  } catch (error) {
    appendLog('scrape', {
      timestamp: new Date().toISOString(),
      source: 'balldontlie',
      sport: 'nba',
      dataType: `season-${season}`,
      records: allGames.length,
      gate: 'FAIL',
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
    // Return partial results on failure (resumability)
    console.log(`\n  ⚠ Season ${season} failed after ${allGames.length} games: ${error instanceof Error ? error.message : error}`);
    return allGames;
  }
}

/** Ingest multiple seasons with progress tracking */
export async function ingestHistoricalNba(
  seasons: number[],
  persistGame: (game: Game) => Promise<void>,
  resolveOutcome: () => number
): Promise<{ totalGames: number; totalResolved: number; seasonsCompleted: number }> {
  let totalGames = 0;
  let totalResolved = 0;
  let seasonsCompleted = 0;

  for (const season of seasons) {
    console.log(`\n▸ NBA ${season}-${season + 1} season`);
    const games = await fetchNbaSeason(season);

    for (const game of games) {
      await persistGame(game);
    }
    totalGames += games.length;

    // Resolve outcomes for newly ingested games
    const resolved = resolveOutcome();
    totalResolved += resolved;
    seasonsCompleted++;

    console.log(`  ✓ ${games.length} games ingested, ${resolved} outcomes resolved`);
  }

  return { totalGames, totalResolved, seasonsCompleted };
}
