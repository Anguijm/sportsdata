import { getDb, closeDb } from '../src/storage/sqlite.js';

const db = getDb();
const top = db.prepare(`
  SELECT full_name, team_abbr, position, games_played, stats_json
  FROM player_stats WHERE sport = 'nba'
  ORDER BY games_played DESC LIMIT 5
`).all() as Array<{ full_name: string; team_abbr: string; position: string; games_played: number; stats_json: string }>;

for (const p of top) {
  const stats = JSON.parse(p.stats_json) as Record<string, number>;
  const ppg = stats['offensive.avgPoints'] ?? stats['offensive.points'] ?? 0;
  const fgPct = stats['offensive.fieldGoalPct'] ?? 0;
  console.log(`${p.full_name.padEnd(25)} ${p.team_abbr.padEnd(4)} GP:${p.games_played} PPG:${ppg.toFixed(1)} FG%:${fgPct.toFixed(1)}`);
}

console.log('\nSample stat keys (first 30):');
const sample = JSON.parse(top[0].stats_json) as Record<string, number>;
Object.keys(sample).slice(0, 30).forEach(k => console.log(`  ${k} = ${sample[k]}`));

closeDb();
