import { getDb, closeDb, getPlayerCount } from '../src/storage/sqlite.js';

const sports = ['nfl', 'nba', 'mlb', 'nhl', 'mls', 'epl'];
console.log('Player stats by sport:');
for (const s of sports) {
  console.log(`  ${s.toUpperCase().padEnd(5)} ${getPlayerCount(s)}`);
}
console.log(`  TOTAL ${getPlayerCount()}`);
closeDb();
