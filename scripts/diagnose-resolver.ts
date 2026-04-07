import { getDb, closeDb } from '../src/storage/sqlite.js';

const db = getDb();

// Get a prediction's game info
const pred = db.prepare(`
  SELECT p.id, p.game_id, p.predicted_winner, pg.date, pg.home_team_id, pg.away_team_id, pg.status, pg.sport
  FROM predictions p
  JOIN games pg ON p.game_id = pg.id
  WHERE p.sport = 'nba' AND p.resolved_at IS NULL
  LIMIT 5
`).all() as Array<{ id: string; game_id: string; predicted_winner: string; date: string; home_team_id: string; away_team_id: string; status: string; sport: string }>;

console.log('Sample unresolved predictions:');
for (const p of pred) {
  console.log(`  ${p.game_id} | ${p.date.slice(0, 10)} | ${p.away_team_id.split(':')[1]}@${p.home_team_id.split(':')[1]} | status=${p.status}`);

  // Look for any game with matching natural key
  const matches = db.prepare(`
    SELECT id, status, date FROM games
    WHERE sport = ? AND home_team_id = ? AND away_team_id = ? AND date(date) = date(?)
  `).all(p.sport, p.home_team_id, p.away_team_id, p.date) as Array<{ id: string; status: string; date: string }>;
  console.log(`    Matching games (same teams + date): ${matches.length}`);
  for (const m of matches) {
    const gr = db.prepare('SELECT winner, resolved_at FROM game_results WHERE game_id = ?').get(m.id) as { winner: string; resolved_at: string } | undefined;
    console.log(`      ${m.id} status=${m.status} resolved=${gr ? 'YES' : 'no'}`);
  }
}

closeDb();
