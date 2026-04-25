/**
 * Resolve BDL → ESPN event IDs for NBA games.
 *
 * Phase 2 backfill discovery (debt #33): NBA games in `games` table use
 * BDL IDs (`nba:bdl-N`) for historical data. ESPN's per-game box-score
 * endpoint requires the pure ESPN event ID. This script bridges the gap
 * by querying ESPN's scoreboard endpoint by date and matching events to
 * our games via `(date, home_abbr, away_abbr)`.
 *
 * Plan: `Plans/nba-phase2-backfill.md` §Component 1.
 *
 * Run:
 *   npx tsx scripts/resolve-nba-espn-event-ids.ts [--dry-run] [--limit N]
 *
 * Idempotent: subsequent runs are no-ops on already-resolved games.
 */

import { getDb, recordScrapeWarnings, closeDb, type ScrapeWarningInput } from '../src/storage/sqlite.js';

interface Args {
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--limit') args.limit = Number.parseInt(argv[++i], 10);
  }
  return args;
}

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const RATE_LIMIT_MS = 500; // 2 req/s
const RETRY_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2000, 4000, 8000];

let lastFetchAt = 0;
async function rateLimitedFetch(url: string): Promise<Response> {
  const elapsed = Date.now() - lastFetchAt;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastFetchAt = Date.now();
  return fetch(url);
}

interface ScoreboardEvent {
  id: string;
  date: string;
  competitions: Array<{
    competitors: Array<{
      team: { abbreviation: string };
      homeAway: 'home' | 'away';
    }>;
  }>;
}

async function fetchScoreboardForDate(yyyymmdd: string): Promise<ScoreboardEvent[]> {
  const url = `${ESPN_BASE}/scoreboard?dates=${yyyymmdd}`;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const resp = await rateLimitedFetch(url);
      if (!resp.ok) {
        if (attempt < RETRY_ATTEMPTS - 1) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        throw new Error(`HTTP ${resp.status} for ${url}`);
      }
      const json = await resp.json() as { events?: ScoreboardEvent[] };
      return json.events ?? [];
    } catch (err) {
      if (attempt < RETRY_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      } else {
        throw err;
      }
    }
  }
  return [];
}

interface UnresolvedGame {
  game_id: string;
  date: string;       // ISO 8601 UTC
  home_team_id: string;
  away_team_id: string;
}

interface InsertMapping {
  game_id: string;
  espn_event_id: string;
  resolved_at: string;
  match_method: 'date+abbrs' | 'native' | 'manual';
}

function shiftDate(yyyymmdd: string, days: number): string {
  const y = Number.parseInt(yyyymmdd.slice(0, 4), 10);
  const m = Number.parseInt(yyyymmdd.slice(4, 6), 10);
  const d = Number.parseInt(yyyymmdd.slice(6, 8), 10);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  // Find unresolved eligible games
  const unresolved = db.prepare(`
    SELECT eg.game_id, eg.date, eg.home_team_id, eg.away_team_id
    FROM nba_eligible_games eg
    LEFT JOIN nba_espn_event_ids m ON m.game_id = eg.game_id
    WHERE m.game_id IS NULL
    ORDER BY eg.date
    ${args.limit ? `LIMIT ${args.limit}` : ''}
  `).all() as UnresolvedGame[];

  console.log(`[resolver] ${unresolved.length} unresolved eligible games`);
  if (unresolved.length === 0) {
    console.log('[resolver] nothing to do');
    closeDb();
    return;
  }

  const runStartedAt = new Date().toISOString();

  // 1. Native ESPN game IDs (nba:4018*) — no fetch needed
  const native: InsertMapping[] = [];
  const bdlGames: UnresolvedGame[] = [];
  for (const g of unresolved) {
    if (g.game_id.startsWith('nba:4018')) {
      native.push({
        game_id: g.game_id,
        espn_event_id: g.game_id.replace(/^nba:/, ''),
        resolved_at: runStartedAt,
        match_method: 'native',
      });
    } else {
      bdlGames.push(g);
    }
  }
  console.log(`[resolver] ${native.length} native ESPN ids, ${bdlGames.length} BDL games to resolve`);

  // 2. Group BDL games by ET date.
  // BDL stores `g.date` as a date-only string (e.g. '2023-10-31') representing
  // the ET tipoff calendar date — verified by cross-checking against ESPN
  // event dates (e.g. BDL '2023-10-31' = ESPN ET date 20231031 for the same
  // matchup). Use it directly. Full ISO timestamps (ESPN-native) shouldn't
  // appear here (those branch to native), but if they do we strip to date
  // portion which is UTC-date — close enough for the 3-day window.
  function deriveEtDate(rawDate: string): string {
    const datePart = rawDate.length >= 10 ? rawDate.slice(0, 10) : rawDate;
    return datePart.replace(/-/g, '');
  }
  const byEtDate = new Map<string, UnresolvedGame[]>();
  for (const g of bdlGames) {
    const etDate = deriveEtDate(g.date);
    if (!byEtDate.has(etDate)) byEtDate.set(etDate, []);
    byEtDate.get(etDate)!.push(g);
  }
  console.log(`[resolver] ${byEtDate.size} unique ET dates`);

  // 3. For each ET date, fetch [D-1, D, D+1]; cache by FETCHED-date so each
  // game only matches against events in its own date window (NOT against
  // the global event set — same matchup recurs across the 3-season span).
  const eventsByFetchedDate = new Map<string, ScoreboardEvent[]>();
  const dateBatches = [...byEtDate.keys()].sort();
  const matched: InsertMapping[] = [];
  const warnings: ScrapeWarningInput[] = [];

  let processed = 0;
  for (const etDate of dateBatches) {
    // Fetch boundary days
    for (const offset of [-1, 0, 1]) {
      const d = shiftDate(etDate, offset);
      if (eventsByFetchedDate.has(d)) continue;
      try {
        const events = await fetchScoreboardForDate(d);
        eventsByFetchedDate.set(d, events);
      } catch (err) {
        eventsByFetchedDate.set(d, []);
        warnings.push({
          sport: 'nba', source: 'espn-scoreboard', game_id: null,
          warning_type: 'schema_error',
          detail: `fetch failed for date=${d}: ${err instanceof Error ? err.message : String(err)}`,
          scraped_at: runStartedAt,
        });
      }
    }

    // Match unresolved games for this etDate. Use ONLY events from this
    // game's date window [D-1, D, D+1]. Track each event's fetched-date so
    // we can prefer exact-date matches over adjacent-date matches when the
    // same matchup recurs in the window (e.g. NBA "donut" home-and-home
    // back-to-back games 2 days apart).
    const games = byEtDate.get(etDate)!;
    interface WindowEvent { ev: ScoreboardEvent; fetchedDate: string }
    const windowEventsList: WindowEvent[] = [];
    for (const offset of [-1, 0, 1]) {
      const d = shiftDate(etDate, offset);
      for (const ev of eventsByFetchedDate.get(d) ?? []) {
        windowEventsList.push({ ev, fetchedDate: d });
      }
    }
    // Dedupe by event.id, preferring the exact-fetched-date entry
    const dedupedById = new Map<string, WindowEvent>();
    for (const we of windowEventsList) {
      const existing = dedupedById.get(we.ev.id);
      if (!existing) {
        dedupedById.set(we.ev.id, we);
      } else if (we.fetchedDate === etDate && existing.fetchedDate !== etDate) {
        dedupedById.set(we.ev.id, we);
      }
    }

    for (const g of games) {
      const homeAbbr = g.home_team_id.replace(/^nba:/, '');
      const awayAbbr = g.away_team_id.replace(/^nba:/, '');
      const allMatches: WindowEvent[] = [];
      for (const we of dedupedById.values()) {
        const comp = we.ev.competitions[0];
        if (!comp) continue;
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');
        if (home?.team.abbreviation === homeAbbr && away?.team.abbreviation === awayAbbr) {
          allMatches.push(we);
        }
      }
      // Tiebreak: prefer events whose fetched-date matches this game's etDate
      const exactDateMatches = allMatches.filter(we => we.fetchedDate === etDate);
      const matches: ScoreboardEvent[] = (exactDateMatches.length > 0 ? exactDateMatches : allMatches).map(we => we.ev);

      if (matches.length === 0) {
        warnings.push({
          sport: 'nba', source: 'espn-scoreboard', game_id: g.game_id,
          warning_type: 'missing_field',
          detail: `et_date=${etDate} home=${homeAbbr} away=${awayAbbr}; no ESPN event matched in [${shiftDate(etDate, -1)}, ${etDate}, ${shiftDate(etDate, 1)}]`,
          scraped_at: runStartedAt,
        });
      } else if (matches.length > 1) {
        warnings.push({
          sport: 'nba', source: 'espn-scoreboard', game_id: g.game_id,
          warning_type: 'schema_error',
          detail: `et_date=${etDate} home=${homeAbbr} away=${awayAbbr}; ${matches.length} ambiguous ESPN matches: ${matches.map(m => m.id).join(',')}`,
          scraped_at: runStartedAt,
        });
      } else {
        matched.push({
          game_id: g.game_id,
          espn_event_id: matches[0].id,
          resolved_at: runStartedAt,
          match_method: 'date+abbrs',
        });
      }
    }

    processed += games.length;
    if (processed % 100 === 0 || processed === bdlGames.length) {
      console.log(`[resolver] processed ${processed}/${bdlGames.length} BDL games`);
    }
  }

  // 4. Write mappings
  const allMappings = [...native, ...matched];
  console.log(`[resolver] ${allMappings.length} mappings to insert (${native.length} native + ${matched.length} matched)`);
  console.log(`[resolver] ${warnings.length} warnings to record`);

  if (args.dryRun) {
    console.log('[resolver] dry-run: skipping inserts');
  } else {
    const insertStmt = db.prepare(`
      INSERT INTO nba_espn_event_ids (game_id, espn_event_id, resolved_at, match_method)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (game_id) DO NOTHING
    `);
    const tx = db.transaction((ms: InsertMapping[]) => {
      for (const m of ms) insertStmt.run(m.game_id, m.espn_event_id, m.resolved_at, m.match_method);
    });
    tx(allMappings);
    if (warnings.length > 0) recordScrapeWarnings(warnings);
  }

  // 5. Post-run skip diagnostic (per Pred #2)
  console.log('\n[resolver] skip diagnostic (top 20 by skip count):');
  const skipDiag = db.prepare(`
    SELECT
      g.season,
      strftime('%w', g.date) AS dow,
      CAST(strftime('%H', g.date) AS INT) AS utc_hour,
      COUNT(*) AS skipped
    FROM games g
    JOIN scrape_warnings sw ON sw.game_id = g.id
    WHERE sw.source = 'espn-scoreboard' AND sw.scraped_at >= ?
    GROUP BY g.season, dow, utc_hour
    ORDER BY skipped DESC LIMIT 20
  `).all(runStartedAt) as Array<{ season: string; dow: string; utc_hour: number; skipped: number }>;
  if (skipDiag.length === 0) {
    console.log('  (none)');
  } else {
    console.log('  season       dow utc_hr  skipped');
    for (const r of skipDiag) {
      console.log(`  ${r.season.padEnd(15)} ${r.dow}  ${String(r.utc_hour).padStart(2, '0')}     ${r.skipped}`);
    }
  }

  // Final coverage of mapping table
  const totalEligible = (db.prepare('SELECT COUNT(*) AS n FROM nba_eligible_games').get() as { n: number }).n;
  const totalMapped = (db.prepare('SELECT COUNT(*) AS n FROM nba_espn_event_ids').get() as { n: number }).n;
  console.log(`\n[resolver] mapping coverage: ${totalMapped} / ${totalEligible} eligible games (${((100 * totalMapped) / totalEligible).toFixed(2)}%)`);

  closeDb();
}

await main();
