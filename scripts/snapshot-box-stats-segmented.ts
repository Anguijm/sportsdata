/**
 * Segmented snapshot of nba_game_box_stats — addendum v10 Ship Rule 8.
 *
 * Captures per-season AVG(tov), AVG(possessions), P05/P50/P95 of per-game
 * possessions, COUNT(*), AVG(team_tov) (NULL-aware), and per-segment NULL
 * rate of team_tov. Intended to run pre- and post-backfill; the diff between
 * the two snapshots is the empirical record of the addendum-v10 convention
 * switch. Era-skewed coverage drift (e.g., 2022-23 historical games
 * systematically under-reporting team_tov) shows up here.
 *
 * Run:
 *   npx tsx scripts/snapshot-box-stats-segmented.ts --out path/to/file.json [--label pre|post]
 *
 * Output: JSON written to --out with this shape:
 *   {
 *     captured_at: ISO timestamp,
 *     label: string,
 *     overall: { count, avg_tov, avg_possessions, p05, p50, p95,
 *                team_tov_count, team_tov_null_count, avg_team_tov_nonnull },
 *     segments: [
 *       { season, count, avg_tov, avg_possessions, p05, p50, p95,
 *         team_tov_count, team_tov_null_count, avg_team_tov_nonnull }, ...
 *     ]
 *   }
 *
 * P05/P50/P95 are computed via SQL: ORDER BY possessions LIMIT 1 OFFSET ...
 * SQLite has no PERCENTILE_CONT; we offset by floor(N * p) and round up.
 */

import { writeFileSync } from 'node:fs';
import { getDb, closeDb } from '../src/storage/sqlite.js';

interface Args {
  out: string | null;
  label: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { out: null, label: 'snapshot' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--label') args.label = argv[++i];
  }
  return args;
}

interface SegmentMeans {
  count: number;
  avg_tov: number | null;
  avg_possessions: number | null;
  team_tov_count: number;
  team_tov_null_count: number;
  avg_team_tov_nonnull: number | null;
}

interface Segment extends SegmentMeans {
  season: string;
  p05: number | null;
  p50: number | null;
  p95: number | null;
}

interface Overall extends SegmentMeans {
  p05: number | null;
  p50: number | null;
  p95: number | null;
}

function percentile(db: ReturnType<typeof getDb>, season: string | null, p: number): number | null {
  // Query (season-scoped or overall) ORDER BY possessions, take row at index floor(N*p)
  const where = season ? "WHERE season = ?" : '';
  const params = season ? [season] : [];
  const countRow = db.prepare(`SELECT COUNT(*) AS n FROM nba_game_box_stats ${where}`).get(...params) as { n: number };
  if (countRow.n === 0) return null;
  const offset = Math.min(countRow.n - 1, Math.floor(countRow.n * p));
  const row = db.prepare(`SELECT possessions FROM nba_game_box_stats ${where} ORDER BY possessions LIMIT 1 OFFSET ?`).get(...params, offset) as { possessions: number } | undefined;
  return row ? row.possessions : null;
}

function meansForScope(db: ReturnType<typeof getDb>, season: string | null): SegmentMeans {
  const where = season ? "WHERE season = ?" : '';
  const params = season ? [season] : [];
  const m = db.prepare(`
    SELECT
      COUNT(*) AS count,
      AVG(tov) AS avg_tov,
      AVG(possessions) AS avg_possessions,
      SUM(CASE WHEN team_tov IS NOT NULL THEN 1 ELSE 0 END) AS team_tov_count,
      SUM(CASE WHEN team_tov IS NULL THEN 1 ELSE 0 END) AS team_tov_null_count,
      AVG(team_tov) AS avg_team_tov_nonnull
    FROM nba_game_box_stats ${where}
  `).get(...params) as SegmentMeans;
  return m;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    console.error('--out PATH is required');
    process.exit(2);
  }
  const db = getDb();

  const seasons = (db.prepare(`SELECT DISTINCT season FROM nba_game_box_stats ORDER BY season`).all() as Array<{ season: string }>).map(r => r.season);

  const segments: Segment[] = seasons.map(season => ({
    season,
    ...meansForScope(db, season),
    p05: percentile(db, season, 0.05),
    p50: percentile(db, season, 0.50),
    p95: percentile(db, season, 0.95),
  }));

  const overall: Overall = {
    ...meansForScope(db, null),
    p05: percentile(db, null, 0.05),
    p50: percentile(db, null, 0.50),
    p95: percentile(db, null, 0.95),
  };

  const out = {
    captured_at: new Date().toISOString(),
    label: args.label,
    overall,
    segments,
  };

  writeFileSync(args.out, JSON.stringify(out, null, 2));
  console.log(`[snapshot] wrote ${args.out} (label=${args.label}, overall_count=${overall.count}, segments=${segments.length})`);
  for (const s of segments) {
    const nullRate = s.count > 0 ? (s.team_tov_null_count / s.count * 100).toFixed(1) : 'n/a';
    console.log(`  ${s.season.padEnd(20)} N=${String(s.count).padStart(5)}  avg_tov=${(s.avg_tov ?? 0).toFixed(2)}  avg_poss=${(s.avg_possessions ?? 0).toFixed(2)}  team_tov_NULL=${nullRate}%`);
  }
  closeDb();
}

await main();
