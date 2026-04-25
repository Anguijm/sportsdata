/**
 * Backfill per-game NBA box scores from ESPN's summary endpoint.
 *
 * Phase 2 backfill (debt #33). Iterates eligible games that have an
 * ESPN event-id mapping but lack box-stats rows for one or both teams.
 * For each: fetch + validate via fetchNbaBoxScore, atomically upsert
 * both team-rows in a single transaction, persist scrape warnings.
 *
 * Plan: `Plans/nba-phase2-backfill.md` §Component 3.
 *
 * Run:
 *   npx tsx scripts/backfill-nba-box-stats.ts [--season SEASON] [--limit N] [--dry-run]
 *
 * Idempotent: re-running picks up where it left off.
 *
 * Exits 2 if any `schema_error` warnings emitted (per DQ #7 triage gate).
 */

import {
  getDb, closeDb, upsertNbaBoxStats, recordScrapeWarnings,
  type ScrapeWarningInput,
} from '../src/storage/sqlite.js';
import { fetchNbaBoxScore } from '../src/scrapers/espn.js';

interface Args {
  season: string | null;
  limit: number | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { season: null, limit: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--season') args.season = argv[++i];
    else if (argv[i] === '--limit') args.limit = Number.parseInt(argv[++i], 10);
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

interface PendingGame {
  game_id: string;
  season: string;
  home_team_id: string;
  away_team_id: string;
  espn_event_id: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  const runStartedAt = new Date().toISOString();

  // Load eligible-and-unresolved games joined with mapping
  const seasonClause = args.season ? `AND eg.season = '${args.season.replace(/'/g, "''")}'` : '';
  const limitClause = args.limit ? `LIMIT ${args.limit}` : '';
  const pending = db.prepare(`
    SELECT eg.game_id, eg.season, eg.home_team_id, eg.away_team_id, m.espn_event_id
    FROM nba_eligible_games eg
    JOIN nba_espn_event_ids m ON m.game_id = eg.game_id
    LEFT JOIN nba_game_box_stats h ON h.game_id = eg.game_id AND h.team_id = eg.home_team_id
    LEFT JOIN nba_game_box_stats a ON a.game_id = eg.game_id AND a.team_id = eg.away_team_id
    WHERE (h.game_id IS NULL OR a.game_id IS NULL)
    ${seasonClause}
    ORDER BY eg.date
    ${limitClause}
  `).all() as PendingGame[];

  console.log(`[backfill] ${pending.length} games pending box-stats backfill`);
  if (pending.length === 0) {
    console.log('[backfill] nothing to do');
    closeDb();
    return;
  }

  let okCount = 0;
  let failCount = 0;
  const allWarnings: ScrapeWarningInput[] = [];
  const failedGames: Array<{ game_id: string; reason: string }> = [];

  for (let i = 0; i < pending.length; i++) {
    const g = pending[i];
    const result = await fetchNbaBoxScore(
      g.game_id,
      g.espn_event_id,
      g.home_team_id,
      g.away_team_id,
      g.season,
    );

    if (!result.ok) {
      failCount++;
      const reason = result.reason ?? 'unknown';
      failedGames.push({ game_id: g.game_id, reason });
      allWarnings.push({
        sport: 'nba', source: 'espn-box-stats', game_id: g.game_id,
        warning_type: reason.includes('schema') ? 'schema_error' : 'missing_field',
        detail: reason,
        scraped_at: runStartedAt,
      });
      // Still persist any warnings the validator returned before failing
      for (const w of result.warnings) {
        allWarnings.push({
          sport: 'nba', source: 'espn-box-stats', game_id: g.game_id,
          warning_type: w.warning_type, detail: w.detail, scraped_at: runStartedAt,
        });
      }
    } else {
      // Atomic per-game: both team upserts in one transaction
      if (!args.dryRun) {
        const tx = db.transaction(() => {
          upsertNbaBoxStats(result.data!.home, runStartedAt);
          upsertNbaBoxStats(result.data!.away, runStartedAt);
        });
        tx();
      }
      // Validator-emitted warnings are fail-open notes, not errors
      for (const w of result.warnings) {
        allWarnings.push({
          sport: 'nba', source: 'espn-box-stats', game_id: g.game_id,
          warning_type: w.warning_type, detail: w.detail, scraped_at: runStartedAt,
        });
      }
      okCount++;
    }

    if ((i + 1) % 100 === 0 || i + 1 === pending.length) {
      console.log(`[backfill] ${i + 1}/${pending.length}  ok=${okCount} fail=${failCount}  last=${g.season} ${g.game_id}`);
    }
  }

  if (!args.dryRun && allWarnings.length > 0) {
    recordScrapeWarnings(allWarnings);
  }

  // Coverage summary
  console.log('\n[backfill] coverage summary:');
  const agg = db.prepare(`SELECT eligible_games, covered, coverage_pct FROM box_stats_coverage_aggregate`).get() as { eligible_games: number; covered: number; coverage_pct: number } | undefined;
  if (agg) {
    console.log(`  aggregate (Rule 1, ≥98%): ${agg.covered} / ${agg.eligible_games} = ${agg.coverage_pct}%`);
  }
  const perSeason = db.prepare(`SELECT season, eligible_games, covered, coverage_pct FROM box_stats_coverage_per_season ORDER BY season`).all() as Array<{ season: string; eligible_games: number; covered: number; coverage_pct: number }>;
  for (const r of perSeason) {
    console.log(`  per-season (Rule 2, ≥95%): ${r.season} ${r.covered}/${r.eligible_games} = ${r.coverage_pct}%`);
  }
  const minCell = db.prepare(`SELECT season, team_id, eligible_games, games_with_full_must_have, coverage_pct FROM box_stats_coverage ORDER BY coverage_pct ASC LIMIT 5`).all() as Array<{ season: string; team_id: string; eligible_games: number; games_with_full_must_have: number; coverage_pct: number }>;
  console.log('  worst per-(team, season) cells (Rule 3, ≥94%):');
  for (const r of minCell) {
    console.log(`    ${r.season} ${r.team_id} ${r.games_with_full_must_have}/${r.eligible_games} = ${r.coverage_pct}%`);
  }

  // Unrounded gate evaluation (per Math #1).
  // Note: per-season + aggregate views alias the numerator as `covered`;
  // per-(team, season) view uses `games_with_full_must_have`.
  const rule1 = (db.prepare(`SELECT (1.0 * covered / eligible_games) >= 0.98 AS pass FROM box_stats_coverage_aggregate`).get() as { pass: number }).pass;
  const rule2 = (db.prepare(`SELECT MIN(1.0 * covered / eligible_games) >= 0.95 AS pass FROM box_stats_coverage_per_season`).get() as { pass: number }).pass;
  const rule3 = (db.prepare(`SELECT MIN(1.0 * games_with_full_must_have / eligible_games) >= 0.94 AS pass FROM box_stats_coverage`).get() as { pass: number }).pass;
  console.log(`\n[backfill] ship-rule gates (unrounded): R1=${rule1 ? 'PASS' : 'FAIL'} R2=${rule2 ? 'PASS' : 'FAIL'} R3=${rule3 ? 'PASS' : 'FAIL'}`);

  // Warnings triage gate (DQ #7)
  console.log('\n[backfill] warnings this run by source × type:');
  const warnAgg = db.prepare(`
    SELECT source, warning_type, COUNT(*) AS n
    FROM scrape_warnings
    WHERE scraped_at >= ?
    GROUP BY source, warning_type
    ORDER BY n DESC
  `).all(runStartedAt) as Array<{ source: string; warning_type: string; n: number }>;
  if (warnAgg.length === 0) {
    console.log('  (none)');
  } else {
    for (const r of warnAgg) console.log(`  ${r.source} ${r.warning_type}: ${r.n}`);
  }

  // Skip diagnostic (per Pred #2)
  if (failCount > 0) {
    console.log('\n[backfill] failed-game diagnostic (top 20 by frequency):');
    const skipDiag = db.prepare(`
      SELECT
        g.season,
        strftime('%w', g.date) AS dow,
        CAST(strftime('%H', g.date) AS INT) AS utc_hour,
        COUNT(*) AS skipped
      FROM games g
      JOIN scrape_warnings sw ON sw.game_id = g.id
      WHERE sw.source = 'espn-box-stats' AND sw.scraped_at >= ? AND sw.warning_type IN ('missing_field', 'schema_error')
      GROUP BY g.season, dow, utc_hour
      ORDER BY skipped DESC LIMIT 20
    `).all(runStartedAt) as Array<{ season: string; dow: string; utc_hour: number; skipped: number }>;
    for (const r of skipDiag) {
      console.log(`  ${r.season.padEnd(15)} dow=${r.dow} utc_h=${String(r.utc_hour).padStart(2, '0')} skipped=${r.skipped}`);
    }
  }

  // Triage exit code
  const schemaErrCount = warnAgg.find(r => r.warning_type === 'schema_error')?.n ?? 0;
  closeDb();
  if (schemaErrCount > 0) {
    console.error(`\n[backfill] REVIEW REQUIRED: ${schemaErrCount} schema-error warnings present, investigate before declaring backfill complete.`);
    process.exit(2);
  }
  process.exit(0);
}

await main();
