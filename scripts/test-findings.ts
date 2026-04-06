import { getSportPlayerData } from '../src/analysis/player-findings.js';
import { closeDb } from '../src/storage/sqlite.js';
import type { Sport } from '../src/schema/provenance.js';

const sport = (process.argv[2] ?? 'nba') as Sport;
const { hero, findings } = getSportPlayerData(sport);

console.log(`\n${sport.toUpperCase()} player findings:\n`);

if (hero) {
  console.log('═══ HERO ═══');
  console.log(`  ${hero.name} · ${hero.team} · ${hero.position} (${hero.category})`);
  console.log(`  ${hero.primaryStat.label}: ${hero.primaryStat.value}`);
  console.log(`  Context: ${hero.contextStats.map(s => `${s.label}=${s.value}`).join(' · ')}`);
  console.log(`  Qualifier: ${hero.qualifier}\n`);
}

const byCategory = new Map<string, typeof findings>();
for (const f of findings) {
  if (!byCategory.has(f.category)) byCategory.set(f.category, []);
  byCategory.get(f.category)!.push(f);
}

for (const [cat, list] of byCategory) {
  console.log(`━━━ ${cat.toUpperCase()} ━━━`);
  for (const f of list) {
    const star = f.spotlight ? '★' : ' ';
    const rate = f.rateStatLabel ? `${f.rateStatLabel}: ${f.rateStatValue}` : '';
    console.log(`  ${star} ${String(f.rank).padStart(2)}. ${f.playerName.padEnd(26)} ${f.team.padEnd(4)} ${f.headline.padEnd(16)} ${rate.padEnd(15)} (${f.qualifier})`);
  }
  console.log();
}

closeDb();
