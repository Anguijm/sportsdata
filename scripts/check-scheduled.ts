import { getDb, closeDb } from '../src/storage/sqlite.js';

const db = getDb();

const upcoming = db.prepare(`
  SELECT id, date, status, home_team_id, away_team_id
  FROM games
  WHERE sport = 'nba' AND status = 'scheduled'
  ORDER BY date
  LIMIT 10
`).all() as Array<{ id: string; date: string; status: string; home_team_id: string; away_team_id: string }>;

console.log(`Upcoming NBA games: ${upcoming.length}`);
for (const g of upcoming) {
  console.log(`  ${g.date.slice(0, 10)} ${g.away_team_id.split(':')[1]} @ ${g.home_team_id.split(':')[1]}`);
}

const totalCount = (db.prepare("SELECT COUNT(*) as c FROM games WHERE sport='nba' AND status='scheduled'").get() as { c: number }).c;
console.log(`\nTotal scheduled NBA games in DB: ${totalCount}`);

// Date range of scheduled games
const range = db.prepare("SELECT MIN(date) as min, MAX(date) as max FROM games WHERE sport='nba' AND status='scheduled'").get() as { min: string; max: string };
console.log(`Date range: ${range.min} → ${range.max}`);

closeDb();
