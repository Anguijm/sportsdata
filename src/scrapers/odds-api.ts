/**
 * The Odds API client (free tier: 500 req/month).
 * Fetches current odds for US sports. Raw responses stored for accumulation.
 * API key from THE_ODDS_API_KEY environment variable.
 */

import type { GameOdds } from '../schema/game.js';
import type { Sport } from '../schema/provenance.js';
import { appendLog, countRecentRequests } from '../storage/json-log.js';
import { storeRawOdds } from '../storage/sqlite.js';
import { createProvenance } from './normalizer.js';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4/sports';

const SPORT_KEYS: Record<Sport, string> = {
  nfl: 'americanfootball_nfl',
  nba: 'basketball_nba',
  mlb: 'baseball_mlb',
  nhl: 'icehockey_nhl',
  mls: 'soccer_usa_mls',
  epl: 'soccer_epl',
};

// 500 req/month ≈ 16/day — be conservative
const DAILY_SAFE_LIMIT = 15;

function getApiKey(): string {
  const key = process.env.THE_ODDS_API_KEY;
  if (!key) {
    throw new Error('THE_ODDS_API_KEY environment variable not set');
  }
  return key;
}

/** Fetch current odds for a sport. Returns raw response + parsed odds. */
export async function fetchOdds(sport: Sport): Promise<{ raw: string; odds: ParsedOddsEvent[] }> {
  const sportKey = SPORT_KEYS[sport];
  const apiKey = getApiKey();
  const url = `${ODDS_API_BASE}/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=spreads,totals,h2h&oddsFormat=american`;
  const start = Date.now();

  // Rate limit check
  const recentRequests = countRecentRequests('odds-api', 60 * 24); // 24 hour window
  if (recentRequests >= DAILY_SAFE_LIMIT) {
    const err = `Odds API daily limit reached: ${recentRequests}/${DAILY_SAFE_LIMIT}`;
    appendLog('scrape', {
      timestamp: new Date().toISOString(),
      source: 'odds-api',
      sport,
      dataType: 'odds',
      records: 0,
      gate: 'FAIL',
      gateReason: err,
      durationMs: 0,
      error: err,
    });
    throw new Error(err);
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Odds API returned ${response.status}: ${response.statusText}`);
    }

    // Log remaining requests from response headers
    const remaining = response.headers.get('x-requests-remaining');
    const used = response.headers.get('x-requests-used');

    const raw = await response.text();

    // Store raw response for accumulation
    storeRawOdds(sport, raw);

    const data = JSON.parse(raw) as OddsApiResponse;
    const odds = normalizeOdds(data);

    appendLog('scrape', {
      timestamp: new Date().toISOString(),
      source: 'odds-api',
      sport,
      dataType: 'odds',
      records: odds.length,
      gate: 'CLEAR',
      durationMs: Date.now() - start,
    });

    if (remaining) {
      console.log(`  Odds API budget: ${used ?? '?'} used, ${remaining} remaining this month`);
    }

    return { raw, odds };
  } catch (error) {
    appendLog('scrape', {
      timestamp: new Date().toISOString(),
      source: 'odds-api',
      sport,
      dataType: 'odds',
      records: 0,
      gate: 'FAIL',
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// --- Odds API response types ---

interface OddsApiResponse extends Array<OddsApiEvent> {}

interface OddsApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: Array<{
      key: string; // h2h, spreads, totals
      outcomes: Array<{
        name: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
}

export interface ParsedOddsEvent {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  odds: GameOdds | null;
}

function normalizeOdds(events: OddsApiResponse): ParsedOddsEvent[] {
  return events.map((event) => {
    const bookmaker = event.bookmakers[0]; // Use first bookmaker
    let odds: GameOdds | null = null;

    if (bookmaker) {
      const h2h = bookmaker.markets.find(m => m.key === 'h2h');
      const spreads = bookmaker.markets.find(m => m.key === 'spreads');
      const totals = bookmaker.markets.find(m => m.key === 'totals');

      const homeML = h2h?.outcomes.find(o => o.name === event.home_team)?.price ?? 0;
      const awayML = h2h?.outcomes.find(o => o.name === event.away_team)?.price ?? 0;

      const spreadOutcome = spreads?.outcomes.find(o => o.name === event.home_team);
      const totalOver = totals?.outcomes.find(o => o.name === 'Over');

      odds = {
        spread: {
          favorite: (spreadOutcome?.point ?? 0) < 0 ? event.home_team : event.away_team,
          line: Math.abs(spreadOutcome?.point ?? 0),
        },
        overUnder: totalOver?.point ?? 0,
        moneyline: { home: homeML, away: awayML },
        source: bookmaker.title,
        asOf: new Date().toISOString(),
        provenance: createProvenance('odds-api'),
      };
    }

    return {
      eventId: event.id,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      commenceTime: event.commence_time,
      odds,
    };
  });
}
