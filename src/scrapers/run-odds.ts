/**
 * Standalone odds capture runner.
 * Usage: THE_ODDS_API_KEY=xxx npx tsx src/scrapers/run-odds.ts [sport]
 */

import { fetchOdds } from './odds-api.js';
import { closeDb } from '../storage/sqlite.js';
import type { Sport } from '../schema/provenance.js';

const sport: Sport = (process.argv[2] as Sport) || 'nba';

async function main() {
  console.log(`\n=== Fetching ${sport.toUpperCase()} odds ===`);
  const { odds } = await fetchOdds(sport);

  console.log(`Got ${odds.length} events with odds:\n`);
  for (const event of odds.slice(0, 10)) {
    const line = event.odds
      ? `${event.odds.spread.favorite} -${event.odds.spread.line} | O/U ${event.odds.overUnder} | ML ${event.odds.moneyline.home}/${event.odds.moneyline.away}`
      : 'no odds';
    console.log(`  ${event.awayTeam} @ ${event.homeTeam} (${new Date(event.commenceTime).toLocaleDateString()})`);
    console.log(`    ${line}`);
  }
  if (odds.length > 10) console.log(`  ... and ${odds.length - 10} more`);

  closeDb();
}

main().catch((err) => {
  console.error('Odds fetch failed:', err.message);
  closeDb();
  process.exit(1);
});
