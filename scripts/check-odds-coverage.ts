import { getDb, closeDb } from '../src/storage/sqlite.js';

const db = getDb();

// Games with odds_json populated
const withOdds = db.prepare(`
  SELECT COUNT(*) as c FROM games WHERE sport='nba' AND odds_json IS NOT NULL AND odds_json != ''
`).get() as { c: number };
console.log(`NBA games with odds_json: ${withOdds.c}`);

// Resolved games with odds (the testable subset)
const testable = db.prepare(`
  SELECT COUNT(*) as c
  FROM game_results gr
  JOIN games g ON gr.game_id = g.id
  WHERE gr.sport = 'nba' AND g.odds_json IS NOT NULL AND g.odds_json != ''
`).get() as { c: number };
console.log(`Resolved NBA games with odds (testable subset): ${testable.c}`);

// Sample odds_json
const sample = db.prepare(`
  SELECT id, odds_json FROM games WHERE sport='nba' AND odds_json IS NOT NULL LIMIT 1
`).get() as { id: string; odds_json: string } | undefined;
if (sample) {
  console.log(`\nSample odds_json:\n${sample.odds_json.slice(0, 500)}`);
}

// Raw odds entries (separate table)
const rawCount = db.prepare(`
  SELECT COUNT(*) as c FROM odds_raw WHERE sport='nba'
`).get() as { c: number };
console.log(`\nRaw odds_raw rows for NBA: ${rawCount.c}`);

closeDb();
