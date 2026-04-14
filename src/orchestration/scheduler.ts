/**
 * Simple cron-like scheduler for sports data scraping.
 * Runs scrapes at configured intervals with retry logic.
 * Designed to be invoked via system cron or run as a long-lived process.
 */

import { fetchTeams, fetchScoreboard } from '../scrapers/espn.js';
import { fetchOdds } from '../scrapers/odds-api.js';
import { fetchInjuries, storeInjuries } from '../scrapers/injuries.js';
import { sqliteRepository, closeDb, resolveGameOutcomes, writeOddsToGames } from '../storage/sqlite.js';
import { formatScrapeSummary } from '../cli/tables.js';
import { appendLog, readLog } from '../storage/json-log.js';
import type { ScrapeLogEntry } from '../storage/json-log.js';
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
  /**
   * Number of days ahead of today to scrape for scheduled games.
   * - `0` (default for manual triggers): today only.
   * - `N > 0`: also fetch `today + 1` through `today + N` to pick up
   *   scheduled games several days out, enabling multi-day predictions.
   */
  lookaheadDays: number;
}

const DEFAULT_CONFIG: ScheduleConfig = {
  sports: ['nfl', 'nba', 'mlb', 'nhl', 'mls', 'epl'],
  oddsEnabled: !!process.env.THE_ODDS_API_KEY,
  maxRetries: 3,
  retryDelayMs: 5000,
  backfillDays: 0,
  lookaheadDays: 0,
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
  if (config.backfillDays > 0 || config.lookaheadDays > 0) {
    const today = new Date();
    // Past dates (backfill)
    for (let offset = config.backfillDays; offset >= 1; offset--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - offset);
      dateQueries.push(toEspnDateStr(d));
    }
    // Today
    dateQueries.push(toEspnDateStr(today));
    // Future dates (lookahead for scheduled games)
    for (let offset = 1; offset <= config.lookaheadDays; offset++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() + offset);
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
  // Sprint 10.6: write odds back to games table so spread predictions can use them
  if (odds.length > 0) {
    const matched = writeOddsToGames(sport, odds);
    if (matched > 0) console.log(`  ↳ wrote odds to ${matched} games`);
  }
  return odds.length;
}

export interface CycleResult {
  results: { sport: Sport; teams: number; games: number }[];
  /**
   * FAIL entries written to the scrape log during this cycle. Non-empty means
   * upstream (ESPN schema drift, network outage, etc.) hit at least one
   * fail-closed path — `scrapedFetch` returns `[]` instead of throwing per
   * council mandate, so the only signal that a fetch failed is in the log.
   * Callers (notably `/api/trigger/scrape`) MUST check this and return a
   * non-2xx status, otherwise crons stay green while data goes stale.
   */
  failures: { sport: string; dataType: string; error?: string; timestamp: string }[];
}

/** Run a full scrape cycle for all configured sports. */
export async function runCycle(
  overrides: Partial<ScheduleConfig> = {},
): Promise<CycleResult> {
  const config: ScheduleConfig = { ...DEFAULT_CONFIG, ...overrides };
  const startTime = Date.now();
  const startIso = new Date(startTime).toISOString();
  console.log(`\n━━━ Scrape Cycle @ ${startIso} (backfillDays=${config.backfillDays}) ━━━`);

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
        // P2-11: Log odds failures so they appear in the cycle failure sweep
        appendLog('scrape', {
          timestamp: new Date().toISOString(),
          source: 'odds-api',
          sport,
          dataType: 'odds-failure',
          records: 0,
          gate: 'FAIL',
          durationMs: Date.now() - startTime,
          error: `Odds API: ${msg}`,
        });
      }
    }
  } else {
    console.log(`\n▸ Odds API: skipped (THE_ODDS_API_KEY not set)`);
  }

  // Injury reports — fetched before predictions so the model can use them.
  // storeInjuries is called unconditionally (even on empty list) so stale
  // rows from prior runs are cleared when ESPN returns no injuries.
  for (const sport of config.sports) {
    try {
      console.log(`\n▸ ${sport.toUpperCase()} injuries`);
      const injuries = await fetchInjuries(sport);
      storeInjuries(sport, injuries);
      if (injuries.length > 0) {
        console.log(`  ✓ ${injuries.length} injury entries`);
      } else {
        console.log(`  ○ no injury data (stale entries cleared)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ Injuries: ${msg}`);
    }
  }

  // Auto-resolve game outcomes for any newly finalized games
  resolveGameOutcomes();

  formatScrapeSummary(results);

  // Collect fail-closed ESPN failures that occurred during this cycle. The
  // scraper writes `gate: 'FAIL'` log entries but does NOT throw, so this
  // log sweep is the only reliable way to detect upstream breakage. Scoped
  // to entries whose timestamp is >= startIso so we don't count stale
  // failures from prior runs.
  //
  // Injuries are SUPPLEMENTARY — not all sports have injury endpoints, and
  // the endpoint is undocumented and can 404 unpredictably. A missing or
  // broken injury feed must NOT fail the whole cycle; the model degrades
  // gracefully by falling back to non-injury-adjusted predictions.
  const SUPPLEMENTARY_DATATYPES = new Set(['injuries']);
  const logEntries = readLog<ScrapeLogEntry>('scrape');
  const failures = logEntries
    .filter((e) => (e.source === 'espn' || e.source === 'odds-api') && e.gate === 'FAIL' && e.timestamp >= startIso)
    .filter((e) => config.sports.includes(e.sport as Sport))
    .filter((e) => !SUPPLEMENTARY_DATATYPES.has(e.dataType))
    .map((e) => ({ sport: e.sport, dataType: e.dataType, error: e.error, timestamp: e.timestamp }));

  if (failures.length > 0) {
    console.log(`\n⚠ ${failures.length} scrape failure(s) detected:`);
    for (const f of failures) console.log(`  ✗ ${f.sport}/${f.dataType}: ${f.error ?? 'unknown'}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n━━━ Cycle complete in ${elapsed}s ━━━\n`);

  return { results, failures };
}

// --- CLI entry point ---

if (import.meta.url === `file://${process.argv[1]}`) {
  runCycle()
    .then(({ failures }) => {
      closeDb();
      // Exit non-zero if any fail-closed ESPN failures were detected so that
      // `npm run cycle` from a shell / cron reflects reality.
      if (failures.length > 0) process.exit(1);
    })
    .catch((err) => {
      console.error('Cycle failed:', err);
      closeDb();
      process.exit(1);
    });
}
