/**
 * Inspect CLI — review team mappings, game results, and data quality.
 * Usage: npx tsx src/cli/inspect.ts [mappings|results|home-rate] [sport]
 */

import type { Sport } from '../schema/provenance.js';
import {
  getMappingsForSport, getMappingGaps, getResultsBySport,
  getHomeWinRate, getResultCount, closeDb,
} from '../storage/sqlite.js';
import { pad } from './tables.js';

const command = process.argv[2] ?? 'mappings';
const sport: Sport = (process.argv[3] as Sport) ?? 'nba';

function inspectMappings(sport: Sport): void {
  const mappings = getMappingsForSport(sport);
  const gaps = getMappingGaps(sport);

  console.log(`\n┌─ Team Mappings: ${sport.toUpperCase()} ──────────────────────────────────────────────────┐`);
  console.log(`│ ${pad('Canonical', 12)} ${pad('Provider', 12)} ${pad('Provider ID', 28)} ${pad('Confidence', 10)} │`);
  console.log(`├──────────────────────────────────────────────────────────────────────────┤`);

  let lastTeam = '';
  for (const m of mappings) {
    const teamLabel = m.canonical_id === lastTeam ? '' : m.canonical_id;
    lastTeam = m.canonical_id;
    console.log(`│ ${pad(teamLabel, 12)} ${pad(m.provider, 12)} ${pad(m.provider_name, 28)} ${pad(String(m.confidence), 10)} │`);
  }
  console.log(`└──────────────────────────────────────────────────────────────────────────┘`);

  if (gaps.length > 0) {
    console.log(`\n⚠ Missing mappings:`);
    for (const g of gaps) {
      console.log(`  ${g.canonical_id}: missing [${g.missing_providers.join(', ')}]`);
    }
  } else {
    console.log(`\n✓ All ${sport.toUpperCase()} teams fully mapped across all providers.`);
  }
}

function inspectResults(sport: Sport): void {
  const results = getResultsBySport(sport, 20);
  const totalResults = getResultCount(sport);

  console.log(`\n┌─ Game Results: ${sport.toUpperCase()} (${totalResults} total, showing last 20) ─────────────────┐`);
  console.log(`│ ${pad('Date', 12)} ${pad('Winner', 12)} ${pad('Loser', 12)} ${pad('Score', 10)} ${pad('Margin', 8)} ${pad('Spread', 8)} │`);
  console.log(`├──────────────────────────────────────────────────────────────────────────┤`);

  for (const r of results) {
    const date = r.date.slice(0, 10);
    const score = `${r.home_score}-${r.away_score}`;
    const spread = r.spread_result ?? '---';
    const winnerAbbr = r.winner.split(':')[1] ?? r.winner;
    const loserAbbr = r.loser.split(':')[1] ?? r.loser;
    console.log(`│ ${pad(date, 12)} ${pad(winnerAbbr, 12)} ${pad(loserAbbr, 12)} ${pad(score, 10)} ${pad(String(r.margin), 8)} ${pad(spread, 8)} │`);
  }
  console.log(`└──────────────────────────────────────────────────────────────────────────┘`);
}

function inspectHomeRate(sport: Sport): void {
  const stats = getHomeWinRate(sport);
  const pct = (stats.rate * 100).toFixed(1);

  console.log(`\n┌─ Home Win Rate: ${sport.toUpperCase()} ────────────────────────┐`);
  console.log(`│ Total games resolved: ${pad(String(stats.total), 20)}   │`);
  console.log(`│ Home wins:            ${pad(String(stats.homeWins), 20)}   │`);
  console.log(`│ Home win rate:        ${pad(`${pct}%`, 20)}   │`);
  console.log(`└──────────────────────────────────────────────────┘`);
}

function main(): void {
  switch (command) {
    case 'mappings':
      inspectMappings(sport);
      break;
    case 'results':
      inspectResults(sport);
      break;
    case 'home-rate':
      inspectHomeRate(sport);
      break;
    default:
      console.log('Usage: npx tsx src/cli/inspect.ts [mappings|results|home-rate] [sport]');
  }
  closeDb();
}

main();
