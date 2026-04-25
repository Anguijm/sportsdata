/**
 * Recheck box scores for NBA games in the last 7 days.
 *
 * Catches ESPN retroactive corrections (official-scorer revisions to
 * REB/TO/AST attribution that typically settle within a few days).
 * Uses upsertNbaBoxStats change-detection — only writes audit rows when
 * MUST-HAVE fields actually changed.
 *
 * Plan: `Plans/nba-phase2-backfill.md` §Component 4.
 *
 * Run:
 *   npx tsx scripts/recheck-recent-box-stats.ts
 *
 * Cron-friendly: idempotent, no args. Cron config deferred per addendum
 * v7 §12 (Phase-3 task to pin nightly ordering after prediction writes).
 */

import {
  getDb, closeDb, upsertNbaBoxStats, recordScrapeWarnings,
  type ScrapeWarningInput,
} from '../src/storage/sqlite.js';
import { fetchNbaBoxScore } from '../src/scrapers/espn.js';

interface RecentGame {
  game_id: string;
  season: string;
  home_team_id: string;
  away_team_id: string;
  espn_event_id: string;
}

async function main(): Promise<void> {
  const db = getDb();
  const runStartedAt = new Date().toISOString();

  // Eligible games in the last 7 days that have a mapping
  const games = db.prepare(`
    SELECT eg.game_id, eg.season, eg.home_team_id, eg.away_team_id, m.espn_event_id
    FROM nba_eligible_games eg
    JOIN nba_espn_event_ids m ON m.game_id = eg.game_id
    WHERE eg.date >= datetime('now', '-7 days')
    ORDER BY eg.date
  `).all() as RecentGame[];

  console.log(`[recheck] ${games.length} recent games to recheck`);
  if (games.length === 0) {
    closeDb();
    return;
  }

  let okCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let failCount = 0;
  const allWarnings: ScrapeWarningInput[] = [];

  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const result = await fetchNbaBoxScore(
      g.game_id, g.espn_event_id, g.home_team_id, g.away_team_id, g.season,
    );
    if (!result.ok) {
      failCount++;
      const reason = result.reason ?? 'unknown';
      allWarnings.push({
        sport: 'nba', source: 'espn-box-stats-recheck', game_id: g.game_id,
        warning_type: reason.includes('schema') ? 'schema_error' : 'missing_field',
        detail: reason, scraped_at: runStartedAt,
      });
      continue;
    }
    const tx = db.transaction(() => {
      const h = upsertNbaBoxStats(result.data!.home, runStartedAt);
      const a = upsertNbaBoxStats(result.data!.away, runStartedAt);
      return { h, a };
    });
    const r = tx();
    okCount++;
    if (r.h.status === 'updated' || r.a.status === 'updated') updatedCount++;
    else if (r.h.status === 'unchanged' && r.a.status === 'unchanged') unchangedCount++;

    for (const w of result.warnings) {
      allWarnings.push({
        sport: 'nba', source: 'espn-box-stats-recheck', game_id: g.game_id,
        warning_type: w.warning_type, detail: w.detail, scraped_at: runStartedAt,
      });
    }
  }

  if (allWarnings.length > 0) recordScrapeWarnings(allWarnings);

  console.log(`[recheck] ok=${okCount} (updated=${updatedCount}, unchanged=${unchangedCount}) fail=${failCount}`);

  // If any updates fired, log audit-row count so retroactive corrections are visible
  if (updatedCount > 0) {
    const auditN = (db.prepare(`SELECT COUNT(*) AS n FROM nba_box_stats_audit WHERE changed_at >= ?`).get(runStartedAt) as { n: number }).n;
    console.log(`[recheck] ${auditN} audit rows written (MUST-HAVE field corrections from ESPN)`);
  }

  closeDb();
}

await main();
