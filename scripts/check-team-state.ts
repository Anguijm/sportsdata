import { getDb, closeDb } from '../src/storage/sqlite.js';

const db = getDb();

const today = new Date().toISOString();

// What is BOS's current-season record?
const bosWins = db.prepare(`
  SELECT COUNT(*) as c FROM game_results
  WHERE sport='nba' AND winner='nba:BOS' AND date >= '2025-10-01' AND date <= ?
`).get(today) as { c: number };

const bosLosses = db.prepare(`
  SELECT COUNT(*) as c FROM game_results
  WHERE sport='nba' AND loser='nba:BOS' AND date >= '2025-10-01' AND date <= ?
`).get(today) as { c: number };

console.log(`BOS current season (2025-26): ${bosWins.c}-${bosLosses.c}`);

// CHA
const chaWins = db.prepare(`
  SELECT COUNT(*) as c FROM game_results
  WHERE sport='nba' AND winner='nba:CHA' AND date >= '2025-10-01' AND date <= ?
`).get(today) as { c: number };
const chaLosses = db.prepare(`
  SELECT COUNT(*) as c FROM game_results
  WHERE sport='nba' AND loser='nba:CHA' AND date >= '2025-10-01' AND date <= ?
`).get(today) as { c: number };
console.log(`CHA current season (2025-26): ${chaWins.c}-${chaLosses.c}`);

// What does the date filter look like?
const dateRange = db.prepare(`
  SELECT MIN(date) as min, MAX(date) as max, COUNT(*) as c
  FROM game_results
  WHERE sport='nba' AND date >= '2025-10-01'
`).get() as { min: string; max: string; c: number };
console.log(`\n2025-26 season games in DB: ${dateRange.c}`);
console.log(`  Range: ${dateRange.min} → ${dateRange.max}`);

closeDb();
