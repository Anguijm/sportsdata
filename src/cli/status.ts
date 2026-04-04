/**
 * CLI status command — shows database contents and scrape health.
 * Usage: npx tsx src/cli/status.ts [sport]
 */

import type { Sport } from '../schema/provenance.js';
import { sqliteRepository, getTeamCount, getGameCount, getLastScrapeTime, closeDb } from '../storage/sqlite.js';
import { formatTeamsTable, formatGamesTable, formatDbStatus } from './tables.js';
import { readLog } from '../storage/json-log.js';
import type { ScrapeLogEntry } from '../storage/json-log.js';

const sportFilter = process.argv[2] as Sport | undefined;
const ALL_SPORTS: Sport[] = ['nfl', 'nba', 'mlb', 'nhl', 'mls', 'epl'];
const sports = sportFilter ? [sportFilter] : ALL_SPORTS;

async function main() {
  // Database stats
  const stats = sports.map(s => ({
    sport: s,
    teams: getTeamCount(s),
    games: getGameCount(s),
  }));

  formatDbStatus(stats, getLastScrapeTime());

  // Show teams and games for filtered sport
  if (sportFilter) {
    const teams = await sqliteRepository.getTeamsBySport(sportFilter);
    if (teams.length > 0) formatTeamsTable(sportFilter, teams);

    const games = await sqliteRepository.getGamesByDate(new Date().toISOString().slice(0, 10));
    const sportGames = games.filter(g => g.sport === sportFilter);
    if (sportGames.length > 0) formatGamesTable(sportFilter, sportGames);
  }

  // Recent scrape log
  const recentLogs = readLog<ScrapeLogEntry>('scrape', 10);
  if (recentLogs.length > 0) {
    console.log(`\n┌─ Recent Scrapes (last ${recentLogs.length}) ────────────────────────────┐`);
    for (const log of recentLogs.reverse()) {
      const icon = log.gate === 'CLEAR' ? '✓' : log.gate === 'WARN' ? '⚠' : '✗';
      const ts = new Date(log.timestamp).toLocaleTimeString();
      console.log(`│ ${icon} ${ts}  ${log.source}/${log.sport}/${log.dataType}  ${log.records} records  ${log.durationMs}ms │`);
    }
    console.log(`└────────────────────────────────────────────────────────────┘`);
  }

  closeDb();
}

main().catch((err) => {
  console.error('Status check failed:', err.message);
  closeDb();
  process.exit(1);
});
