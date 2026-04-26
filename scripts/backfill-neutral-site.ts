/**
 * Populate nba_neutral_site_games lookup table (Phase 3 step 3).
 *
 * Inserts the 6 Cup SF/Final game IDs played at T-Mobile Arena, Las Vegas
 * (neutral site) into nba_neutral_site_games. Source of truth:
 * data/cup-knockout-game-ids.json + Cup schedule notes embedded there.
 *
 * Cup QF games (home arenas: nba:bdl-7045521–7045524, 16968270–16968273)
 * are NOT neutral-site and are excluded from this table.
 *
 * Plan: Plans/nba-learned-model.md addendum v11 §"Phase 3 step 3".
 * Supplementary Gate B: run scripts/snapshot-prebackfill-db.sh before
 * this script. Cite the snapshot path in the commit message.
 *
 * Run:
 *   bash scripts/snapshot-prebackfill-db.sh --local
 *   npx tsx scripts/backfill-neutral-site.ts [--dry-run]
 */

import { getDb, closeDb } from '../src/storage/sqlite.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');

// Cup SF/Final game IDs at T-Mobile Arena, Las Vegas (neutral site).
// Source: data/cup-knockout-game-ids.json _2023_24_note + _2024_25_note.
// 2023-24: SF Dec 7 2023 (2 games), Final Dec 9 2023 (1 game)
// 2024-25: SF Dec 14 2024 (2 games), Final Dec 17 2024 (1 game)
const NEUTRAL_SITE_GAME_IDS = [
  'nba:bdl-7981414',   // 2023-24 Cup SF game 1 (Las Vegas, Dec 7 2023)
  'nba:bdl-7996352',   // 2023-24 Cup SF game 2 (Las Vegas, Dec 7 2023)
  'nba:bdl-8258317',   // 2023-24 Cup Final (Las Vegas, Dec 9 2023)
  'nba:bdl-17136012',  // 2024-25 Cup SF game 1 (Las Vegas, Dec 14 2024)
  'nba:bdl-17136013',  // 2024-25 Cup SF game 2 (Las Vegas, Dec 14 2024)
  'nba:bdl-17195500',  // 2024-25 Cup Final (Las Vegas, Dec 17 2024)
];

const dryRun = process.argv.includes('--dry-run');

function verifyCupKnockoutJson(): void {
  const raw = JSON.parse(
    readFileSync(join(REPO_ROOT, 'data/cup-knockout-game-ids.json'), 'utf-8')
  ) as { game_ids: string[] };
  const allCupIds = new Set(raw.game_ids);
  for (const id of NEUTRAL_SITE_GAME_IDS) {
    if (!allCupIds.has(id)) {
      throw new Error(`Neutral-site game ID ${id} not in cup-knockout-game-ids.json`);
    }
  }
}

function main(): void {
  verifyCupKnockoutJson();

  const db = getDb();

  const existing = (
    db.prepare('SELECT COUNT(*) AS n FROM nba_neutral_site_games').get() as { n: number }
  ).n;

  if (existing === NEUTRAL_SITE_GAME_IDS.length) {
    console.log(`nba_neutral_site_games already has ${existing} rows — idempotent, nothing to do.`);
    console.log('Rows:');
    const rows = db.prepare('SELECT game_id FROM nba_neutral_site_games ORDER BY game_id').all();
    for (const r of rows) console.log(' ', (r as { game_id: string }).game_id);
    closeDb();
    return;
  }

  console.log(`Inserting ${NEUTRAL_SITE_GAME_IDS.length} neutral-site game IDs...`);
  if (dryRun) console.log('[DRY RUN — no writes]');

  for (const gameId of NEUTRAL_SITE_GAME_IDS) {
    const row = db.prepare('SELECT id FROM games WHERE id = ?').get(gameId) as { id: string } | undefined;
    if (!row) {
      console.warn(`  WARN: game ${gameId} not found in games table — inserting anyway`);
    }
    if (!dryRun) {
      db.prepare(
        'INSERT OR IGNORE INTO nba_neutral_site_games (game_id) VALUES (?)'
      ).run(gameId);
    }
    console.log(`  ${dryRun ? '[dry]' : 'INSERTED'} ${gameId}`);
  }

  if (!dryRun) {
    const finalCount = (
      db.prepare('SELECT COUNT(*) AS n FROM nba_neutral_site_games').get() as { n: number }
    ).n;
    console.log(`\nnba_neutral_site_games: ${finalCount} rows`);

    const sample = db.prepare(`
      SELECT eg.game_id, eg.date, eg.home_team_id, eg.away_team_id, eg.neutral_site
      FROM nba_eligible_games eg
      WHERE eg.neutral_site = 1
      ORDER BY eg.date
    `).all() as Array<{ game_id: string; date: string; home_team_id: string; away_team_id: string; neutral_site: number }>;
    console.log('\nnba_eligible_games neutral_site=1 rows:');
    for (const r of sample) {
      console.log(`  ${r.game_id}  ${r.date}  ${r.home_team_id} vs ${r.away_team_id}`);
    }
    if (sample.length !== NEUTRAL_SITE_GAME_IDS.length) {
      console.error(`ERROR: expected ${NEUTRAL_SITE_GAME_IDS.length} neutral_site=1 rows, got ${sample.length}`);
      process.exit(1);
    }
    console.log(`\nPASS — ${sample.length} neutral_site=1 rows confirmed in nba_eligible_games`);
  }

  closeDb();
}

main();
