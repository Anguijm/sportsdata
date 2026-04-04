/**
 * Simple cron-like scheduler for sports data scraping.
 * Runs scrapes at configured intervals with retry logic.
 * Designed to be invoked via system cron or run as a long-lived process.
 */

import { fetchTeams, fetchScoreboard } from '../scrapers/espn.js';
import { fetchOdds } from '../scrapers/odds-api.js';
import { sqliteRepository, closeDb } from '../storage/sqlite.js';
import { formatScrapeSummary } from '../cli/tables.js';
import { appendLog } from '../storage/json-log.js';
import type { Sport } from '../schema/provenance.js';

export interface ScheduleConfig {
  sports: Sport[];
  oddsEnabled: boolean;
  maxRetries: number;
  retryDelayMs: number;
}

const DEFAULT_CONFIG: ScheduleConfig = {
  sports: ['nfl', 'nba', 'mlb'],
  oddsEnabled: !!process.env.THE_ODDS_API_KEY,
  maxRetries: 3,
  retryDelayMs: 5000,
};

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

  const games = await withRetry(
    () => fetchScoreboard(sport),
    `${sport} scoreboard`,
    config.maxRetries,
    config.retryDelayMs
  );
  for (const g of games) await sqliteRepository.upsertGame(g);

  return { teams: teams.length, games: games.length };
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

/** Run a full scrape cycle for all configured sports */
export async function runCycle(config: ScheduleConfig = DEFAULT_CONFIG): Promise<void> {
  const startTime = Date.now();
  console.log(`\n━━━ Scrape Cycle @ ${new Date().toISOString()} ━━━`);

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
  }

  formatScrapeSummary(results);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n━━━ Cycle complete in ${elapsed}s ━━━\n`);
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
