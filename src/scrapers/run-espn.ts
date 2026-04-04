import { fetchTeams, fetchScoreboard } from './espn.js';
import { sqliteRepository, closeDb } from '../storage/sqlite.js';
import { formatTeamsTable, formatGamesTable, formatScrapeSummary } from '../cli/tables.js';
import type { Sport } from '../schema/provenance.js';

const sport: Sport = (process.argv[2] as Sport) || 'nfl';
const allSports: Sport[] = sport === 'all' as unknown as Sport
  ? ['nfl', 'nba', 'mlb', 'nhl', 'mls']
  : [sport];

async function scrapeSport(s: Sport): Promise<{ teams: number; games: number }> {
  const teams = await fetchTeams(s);
  for (const t of teams) await sqliteRepository.upsertTeam(t);

  const games = await fetchScoreboard(s);
  for (const g of games) await sqliteRepository.upsertGame(g);

  return { teams: teams.length, games: games.length };
}

async function main() {
  const results: { sport: Sport; teams: number; games: number }[] = [];

  for (const s of allSports) {
    const result = await scrapeSport(s);
    results.push({ sport: s, ...result });
  }

  // CLI output
  for (const s of allSports) {
    const teams = await sqliteRepository.getTeamsBySport(s);
    formatTeamsTable(s, teams);

    const games = await sqliteRepository.getGamesByDate(new Date().toISOString().slice(0, 10));
    const sportGames = games.filter(g => g.sport === s);
    if (sportGames.length > 0) {
      formatGamesTable(s, sportGames);
    }
  }

  formatScrapeSummary(results);
  closeDb();
}

main().catch((err) => {
  console.error('Scrape failed:', err.message);
  closeDb();
  process.exit(1);
});
