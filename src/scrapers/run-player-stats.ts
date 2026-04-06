/**
 * Player stats ingest runner — fetches all players + season stats for given sports.
 * Usage:
 *   npx tsx src/scrapers/run-player-stats.ts          # all 6 sports
 *   npx tsx src/scrapers/run-player-stats.ts nba      # one sport
 *   npx tsx src/scrapers/run-player-stats.ts nba mlb  # multiple
 */

import type { Sport } from '../schema/provenance.js';
import { fetchAllPlayersForSport } from './espn-players.js';
import { upsertPlayerStats, getPlayerCount, closeDb } from '../storage/sqlite.js';

const ALL_SPORTS: Sport[] = ['nfl', 'nba', 'mlb', 'nhl', 'mls', 'epl'];
const args = process.argv.slice(2) as Sport[];
const sports: Sport[] = args.length > 0 ? args : ALL_SPORTS;

const SITE_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const SPORT_PATHS: Record<Sport, string> = {
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  mlb: 'baseball/mlb',
  nhl: 'hockey/nhl',
  mls: 'soccer/usa.1',
  epl: 'soccer/eng.1',
};

interface RawTeamEntry {
  team: { id: string; abbreviation: string; displayName: string };
}

async function fetchTeamList(sport: Sport): Promise<Array<{ id: string; abbr: string }>> {
  const url = `${SITE_BASE}/${SPORT_PATHS[sport]}/teams`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${sport} teams: ${response.status}`);
  const data = await response.json() as {
    sports: Array<{ leagues: Array<{ teams: RawTeamEntry[] }> }>;
  };
  const teams: Array<{ id: string; abbr: string }> = [];
  for (const sportData of data.sports) {
    for (const league of sportData.leagues) {
      for (const t of league.teams) {
        teams.push({ id: t.team.id, abbr: t.team.abbreviation });
      }
    }
  }
  return teams;
}

async function ingestSport(sport: Sport): Promise<{ players: number; withStats: number }> {
  console.log(`\n━━━ ${sport.toUpperCase()} ━━━`);

  const teams = await fetchTeamList(sport);
  console.log(`  ${teams.length} teams found`);

  let totalInserted = 0;

  await fetchAllPlayersForSport(sport, teams, (teamAbbr, teamPlayers) => {
    if (teamPlayers.length === 0) return;
    const inserted = upsertPlayerStats(
      teamPlayers.map(p => ({
        playerId: p.playerId,
        sport: p.sport,
        season: p.season,
        fullName: p.fullName,
        position: p.position,
        jersey: p.jersey,
        age: p.age,
        teamId: p.teamId,
        teamAbbr: p.teamAbbr,
        gamesPlayed: p.gamesPlayed,
        stats: p.stats,
      }))
    );
    totalInserted += inserted;
    console.log(`  ${teamAbbr.padEnd(5)} +${inserted} (${totalInserted} total)`);
  });

  console.log(`  ✓ ${totalInserted} players persisted for ${sport.toUpperCase()}`);
  return { players: totalInserted, withStats: totalInserted };
}

async function main() {
  const startTime = Date.now();
  const totals: Array<{ sport: Sport; players: number; withStats: number }> = [];

  for (const sport of sports) {
    try {
      const result = await ingestSport(sport);
      totals.push({ sport, ...result });
    } catch (err) {
      console.log(`  ✗ ${sport}: ${err instanceof Error ? err.message : err}`);
      totals.push({ sport, players: 0, withStats: 0 });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n━━━ Player Stats Ingest Complete (${elapsed}s) ━━━`);

  for (const t of totals) {
    const dbCount = getPlayerCount(t.sport);
    console.log(`  ${t.sport.toUpperCase().padEnd(6)} ${String(t.withStats).padStart(4)} new · ${dbCount} total in DB`);
  }

  closeDb();
}

main().catch((err) => {
  console.error('Player stats ingest failed:', err);
  closeDb();
  process.exit(1);
});
