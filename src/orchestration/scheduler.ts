/**
 * Simple cron-like scheduler for sports data scraping.
 * Runs scrapes at configured intervals with retry logic.
 * Designed to be invoked via system cron or run as a long-lived process.
 */

import { fetchTeams, fetchScoreboard } from '../scrapers/espn.js';
import { fetchOdds } from '../scrapers/odds-api.js';
import { sqliteRepository, closeDb, resolveGameOutcomes } from '../storage/sqlite.js';
import { formatScrapeSummary } from '../cli/tables.js';
import { appendLog } from '../storage/json-log.js';
import type { Sport } from '../schema/provenance.js';

export interface ScheduleConfig {
  sports: Sport[];
  oddsEnabled: boolean;
  maxRetries: number;
  retryDelayMs: number;
  /**
   * Number of days prior to today to re-scrape, inclusive of today.
   * - `0` (default): today only, using ESPN's default scoreboard window.
   * - `N > 0`: loop from `today - N` through `today`, hitting the ESPN
   *   scoreboard with `?dates=YYYYMMDD` for each day. Lets the system
   *   self-heal after a missed cron run.
   */
  backfillDays: number;
}

const DEFAULT_CONFIG: ScheduleConfig = {
  sports: ['nfl', 'nba', 'mlb', 'nhl', 'mls', 'epl'],
  oddsEnabled: !!process.env.THE_ODDS_API_KEY,
  maxRetries: 3,
  retryDelayMs: 5000,
  backfillDays: 0,
};

/** Format a Date as `YYYYMMDD` (UTC) — ESPN scoreboard date parameter format. */
function toEspnDateStr(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number,
  delayMs: number
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        console.log(`  ⟳ ${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delayMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

async function scrapeEspn(sport: Sport, config: ScheduleConfig): Promise<{ teams: number; games: number }> {
  const teams = await withRetry(
    () => fetchTeams(sport),
    `${sport} teams`,
    config.maxRetries,
    config.retryDelayMs
  );
  for (const t of teams) await sqliteRepository.upsertTeam(t);

  // Build the list of dates to fetch. Default (backfillDays=0) is a single
  // no-date fetch, preserving the previous behavior. When backfillDays > 0,
  // iterate from (today - N) through today and hit the scoreboard once per
  // day with an explicit `?dates=YYYYMMDD` parameter so we catch games that
  // fell outside ESPN's default "current day" window.
  const dateQueries: (string | undefined)[] = [];
  if (config.backfillDays > 0) {
    const today = new Date();
    for (let offset = config.backfillDays; offset >= 0; offset--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - offset);
      dateQueries.push(toEspnDateStr(d));
    }
  } else {
    dateQueries.push(undefined);
  }

  const seen = new Set<string>();
  let gamesUpserted = 0;
  for (const dateQuery of dateQueries) {
    const games = await withRetry(
      () => fetchScoreboard(sport, dateQuery),
      `${sport} scoreboard${dateQuery ? ` (${dateQuery})` : ''}`,
      config.maxRetries,
      config.retryDelayMs
    );
    for (const g of games) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      await sqliteRepository.upsertGame(g);
      gamesUpserted++;
    }
  }

  return { teams: teams.length, games: gamesUpserted };
}

async function scrapeOdds(sport: Sport, config: ScheduleConfig): Promise<number> {
  const { odds } = await withRetry(
    () => fetchOdds(sport),
    `${sport} odds`,
    config.maxRetries,
    config.retryDelayMs
  );
  return odds.length;
}

/** Run a full scrape cycle for all configured sports. */
export async function runCycle(
  overrides: Partial<ScheduleConfig> = {},
): Promise<{ sport: Sport; teams: number; games: number }[]> {
  const config: ScheduleConfig = { ...DEFAULT_CONFIG, ...overrides };
  const startTime = Date.now();
  console.log(`\n━━━ Scrape Cycle @ ${new Date().toISOString()} (backfillDays=${config.backfillDays}) ━━━`);

  const results: { sport: Sport; teams: number; games: number }[] = [];

  for (const sport of config.sports) {
    try {
      console.log(`\n▸ ${sport.toUpperCase()}`);
      const result = await scrapeEspn(sport, config);
      results.push({ sport, ...result });
      console.log(`  ✓ ${result.teams} teams, ${result.games} games`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ESPN failed after ${config.maxRetries} retries: ${msg}`);
      results.push({ sport, teams: 0, games: 0 });

      appendLog('scrape', {
        timestamp: new Date().toISOString(),
        source: 'espn',
        sport,
        dataType: 'cycle-failure',
        records: 0,
        gate: 'FAIL',
        durationMs: Date.now() - startTime,
        error: `Failed after ${config.maxRetries} retries: ${msg}`,
      });
    }
  }

  // Odds API (if enabled and key present)
  if (config.oddsEnabled) {
    for (const sport of config.sports) {
      try {
        console.log(`\n▸ ${sport.toUpperCase()} odds`);
        const count = await scrapeOdds(sport, config);
        console.log(`  ✓ ${count} odds events captured`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ Odds API: ${msg}`);
      }
    }
  } else {
    console.log(`\n▸ Odds API: skipped (THE_ODDS_API_KEY not set)`);
  }

  // Auto-resolve game outcomes for any newly finalized games
  resolveGameOutcomes();

  formatScrapeSummary(results);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n━━━ Cycle complete in ${elapsed}s ━━━\n`);

  return results;
}

// --- CLI entry point ---

if (import.meta.url === `file://${process.argv[1]}`) {
  runCycle()
    .then(() => closeDb())
    .catch((err) => {
      console.error('Cycle failed:', err);
      closeDb();
      process.exit(1);
    });
}
