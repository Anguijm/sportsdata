import { fetchTeams, fetchScoreboard } from './espn.js';
import type { Sport } from '../schema/provenance.js';

const sport: Sport = (process.argv[2] as Sport) || 'nfl';

async function main() {
  console.log(`\n=== Fetching ${sport.toUpperCase()} teams ===`);
  const teams = await fetchTeams(sport);
  console.log(`Got ${teams.length} teams:`);
  for (const t of teams.slice(0, 5)) {
    console.log(`  ${t.id} — ${t.name} (${t.city}) [${t.conference ?? '?'} / ${t.division ?? '?'}]`);
  }
  if (teams.length > 5) console.log(`  ... and ${teams.length - 5} more`);

  console.log(`\n=== Fetching ${sport.toUpperCase()} scoreboard ===`);
  const games = await fetchScoreboard(sport);
  console.log(`Got ${games.length} games:`);
  for (const g of games.slice(0, 5)) {
    const score = g.score ? `${g.score.away}-${g.score.home}` : 'TBD';
    console.log(`  ${g.awayTeamId} @ ${g.homeTeamId} — ${g.status} (${score})`);
  }
  if (games.length > 5) console.log(`  ... and ${games.length - 5} more`);

  console.log(`\nDone. Check data/logs/scrape-log.jsonl for entries.`);
}

main().catch((err) => {
  console.error('Scrape failed:', err.message);
  process.exit(1);
});
