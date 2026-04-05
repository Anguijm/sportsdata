/**
 * Historical NBA data ingest via BallDontLie API.
 * Usage: BALLDONTLIE_API_KEY=xxx npx tsx src/scrapers/run-historical.ts [startSeason] [endSeason]
 *
 * Defaults to last 3 seasons. Rate limited to 5 req/min.
 * Resumable — safe to re-run (upserts, no duplicates).
 */

import { ingestHistoricalNba } from './balldontlie.js';
import { sqliteRepository, resolveGameOutcomes, closeDb, getGameCount, getResultCount } from '../storage/sqlite.js';
import { seedNbaMappings } from '../storage/seed-nba-mappings.js';

const currentYear = new Date().getFullYear();
const startSeason = parseInt(process.argv[2] ?? String(currentYear - 3), 10);
const endSeason = parseInt(process.argv[3] ?? String(currentYear - 1), 10);

const seasons = Array.from(
  { length: endSeason - startSeason + 1 },
  (_, i) => startSeason + i
);

async function main() {
  // Ensure NBA mappings are seeded first (P3 blocks P4)
  console.log('=== Seeding NBA team mappings ===');
  const mappingCount = seedNbaMappings();
  console.log(`✓ ${mappingCount} teams × 3 providers = ${mappingCount * 3} mappings\n`);

  const gamesBefore = getGameCount('nba');
  const resultsBefore = getResultCount('nba');

  console.log(`=== Historical NBA Ingest: ${startSeason}-${endSeason} ===`);
  console.log(`Current NBA data: ${gamesBefore} games, ${resultsBefore} results\n`);

  const result = await ingestHistoricalNba(
    seasons,
    (game) => sqliteRepository.upsertGame(game),
    resolveGameOutcomes
  );

  const gamesAfter = getGameCount('nba');
  const resultsAfter = getResultCount('nba');

  console.log(`\n━━━ Historical Ingest Complete ━━━`);
  console.log(`  Seasons processed: ${result.seasonsCompleted}`);
  console.log(`  Games ingested:    ${result.totalGames}`);
  console.log(`  Outcomes resolved: ${result.totalResolved}`);
  console.log(`  NBA totals:        ${gamesAfter} games, ${resultsAfter} results`);

  closeDb();
}

main().catch((err) => {
  console.error('Historical ingest failed:', err.message);
  closeDb();
  process.exit(1);
});
