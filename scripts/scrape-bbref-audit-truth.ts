/**
 * Scrape basketball-reference team-totals + Four Factors for the
 * Pass-B audit ground-truth file.
 *
 * Plan: `Plans/nba-phase2-backfill.md` §Component 5. Manual curation was
 * deferred because bbref blocks WebFetch (User-Agent based 403). Playwright
 * with real Chromium passes the UA gate; throttled to 1 req per 30s
 * (~2/min, well under bbref's published 20/min cap).
 *
 * Discipline:
 *  - HTML cache to `data/.bbref-cache/`. Re-running the parser on a cache
 *    hit makes ZERO network requests. Safe to iterate the extractor.
 *  - Throttle is post-fetch only; cache hits do not sleep.
 *  - Incremental write to `data/espn-bbref-audit-truth.json` after each
 *    game so a mid-run failure leaves partial-but-valid output.
 *  - Single-shot. Not wired to cron. ToS: personal/research use, no
 *    redistribution.
 *
 * Run:
 *   npx tsx scripts/scrape-bbref-audit-truth.ts            # full 50
 *   npx tsx scripts/scrape-bbref-audit-truth.ts --limit 5  # Pass-A2 only
 *   npx tsx scripts/scrape-bbref-audit-truth.ts --parse-only  # use cache, no browser
 */

import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CACHE_DIR = 'data/.bbref-cache';
const TRUTH_PATH = 'data/espn-bbref-audit-truth.json';
const THROTTLE_MS = 30_000;

interface QueueEntry {
  game_id: string;
  bbref_url: string;
  season_label: string;
  home_team_id: string;
  away_team_id: string;
  home_bbref: string;
  away_bbref: string;
}

interface RawCounts {
  fgm: number; fga: number; fg3m: number; fg3a: number;
  ftm: number; fta: number;
  oreb: number; dreb: number; reb: number;
  ast: number; stl: number; blk: number; tov: number; pf: number; pts: number;
}

interface PublishedRates {
  efg_pct: number | null;
  tov_pct: number | null;
  ortg: number | null;
  pace: number | null;
}

interface GroundTruthEntry {
  game_id: string;
  bbref_url: string;
  season_label: string;
  home_team_id: string;
  away_team_id: string;
  home_raw_counts: RawCounts;
  away_raw_counts: RawCounts;
  home_published_rates: PublishedRates;
  away_published_rates: PublishedRates;
}

// our_id (sans "nba:") → bbref abbr in URL/table id
const BBREF_ABBR: Record<string, string> = {
  ATL: 'ATL', BOS: 'BOS', BKN: 'BRK', CHA: 'CHO', CHI: 'CHI', CLE: 'CLE',
  DAL: 'DAL', DEN: 'DEN', DET: 'DET', GS: 'GSW', HOU: 'HOU', IND: 'IND',
  LAC: 'LAC', LAL: 'LAL', MEM: 'MEM', MIA: 'MIA', MIL: 'MIL', MIN: 'MIN',
  NO: 'NOP', NY: 'NYK', OKC: 'OKC', ORL: 'ORL', PHI: 'PHI', PHX: 'PHO',
  POR: 'POR', SA: 'SAS', SAC: 'SAC', TOR: 'TOR', UTAH: 'UTA', WSH: 'WAS',
};

function bbrefAbbr(teamId: string): string {
  const code = teamId.replace(/^nba:/, '');
  const abbr = BBREF_ABBR[code];
  if (!abbr) throw new Error(`No bbref abbr mapping for ${teamId}`);
  return abbr;
}

function bbrefUrl(date: string, homeBbref: string): string {
  const ymd = date.slice(0, 10).replace(/-/g, '');
  return `https://www.basketball-reference.com/boxscores/${ymd}0${homeBbref}.html`;
}

const RAW: QueueRaw[] = [
  // [game_id, date, home_team_id, away_team_id, season_label]
  // Per addendum v9.2 path-(i): nba:bdl-8258317 (LAL/IND Cup final) dropped due
  // to TOV scraper-convention divergence with bbref (debt #35); replaced with
  // deterministic alternate nba:bdl-1037593 (lowest bdl-N in 2023-regular not
  // already in sample).
  ['nba:bdl-1037593',  '2023-10-24', 'nba:DEN', 'nba:LAL', '2023-regular'],
  ['nba:bdl-1037689',  '2023-11-06', 'nba:MIA', 'nba:LAL', '2023-regular'],
  ['nba:bdl-1037802',  '2023-11-22', 'nba:BOS', 'nba:MIL', '2023-regular'],
  ['nba:bdl-1037923',  '2023-12-15', 'nba:SA',  'nba:LAL', '2023-regular'],
  ['nba:bdl-1038139',  '2024-01-13', 'nba:DAL', 'nba:NO',  '2023-regular'],
  ['nba:bdl-1038242',  '2024-01-27', 'nba:GS',  'nba:LAL', '2023-regular'],
  ['nba:bdl-1038347',  '2024-02-10', 'nba:NY',  'nba:IND', '2023-regular'],
  ['nba:bdl-1038574',  '2024-03-17', 'nba:LAC', 'nba:ATL', '2023-regular'],
  ['nba:bdl-1038579',  '2024-03-18', 'nba:UTAH','nba:MIN', '2023-regular'],
  ['nba:bdl-1038646',  '2024-03-27', 'nba:CHI', 'nba:IND', '2023-regular'],
  ['nba:bdl-15882375', '2024-04-20', 'nba:DEN', 'nba:LAL', '2023-postseason'],
  ['nba:bdl-15881959', '2024-04-20', 'nba:CLE', 'nba:ORL', '2023-postseason'],
  ['nba:bdl-15881961', '2024-04-21', 'nba:MIL', 'nba:IND', '2023-postseason'],
  ['nba:bdl-15882411', '2024-04-26', 'nba:DAL', 'nba:LAC', '2023-postseason'],
  ['nba:bdl-15885394', '2024-04-27', 'nba:NO',  'nba:OKC', '2023-postseason'],
  ['nba:bdl-15882422', '2024-05-02', 'nba:IND', 'nba:MIL', '2023-postseason'],
  ['nba:bdl-15896341', '2024-05-06', 'nba:NY',  'nba:IND', '2023-postseason'],
  ['nba:bdl-15896618', '2024-05-14', 'nba:NY',  'nba:IND', '2023-postseason'],
  ['nba:bdl-15897605', '2024-05-15', 'nba:BOS', 'nba:CLE', '2023-postseason'],
  ['nba:bdl-15895046', '2024-05-16', 'nba:MIN', 'nba:DEN', '2023-postseason'],
  ['nba:bdl-15907488', '2024-10-28', 'nba:PHX', 'nba:LAL', '2024-regular'],
  ['nba:bdl-15907727', '2024-11-30', 'nba:DET', 'nba:PHI', '2024-regular'],
  ['nba:bdl-15907735', '2024-12-01', 'nba:TOR', 'nba:MIA', '2024-regular'],
  ['nba:bdl-17195500', '2024-12-17', 'nba:OKC', 'nba:MIL', '2024-regular'],
  ['nba:bdl-15907998', '2025-01-15', 'nba:PHI', 'nba:NY',  '2024-regular'],
  ['nba:bdl-15908774', '2025-03-24', 'nba:PHX', 'nba:MIL', '2024-regular'],
  ['nba:bdl-15908821', '2025-03-31', 'nba:IND', 'nba:SAC', '2024-regular'],
  ['nba:bdl-15908848', '2025-04-03', 'nba:LAL', 'nba:GS',  '2024-regular'],
  ['nba:bdl-15908886', '2025-04-08', 'nba:LAC', 'nba:SA',  '2024-regular'],
  ['nba:bdl-15908907', '2025-04-11', 'nba:CHI', 'nba:WSH', '2024-regular'],
  ['nba:bdl-15908904', '2025-04-11', 'nba:PHI', 'nba:ATL', '2024-regular'],
  ['nba:bdl-18421940', '2025-04-19', 'nba:DEN', 'nba:LAC', '2024-postseason'],
  ['nba:bdl-18422292', '2025-04-21', 'nba:DEN', 'nba:LAC', '2024-postseason'],
  ['nba:bdl-18425162', '2025-04-26', 'nba:MIA', 'nba:CLE', '2024-postseason'],
  ['nba:bdl-18436463', '2025-05-07', 'nba:OKC', 'nba:DEN', '2024-postseason'],
  ['nba:bdl-18436465', '2025-05-09', 'nba:DEN', 'nba:OKC', '2024-postseason'],
  ['nba:bdl-18435672', '2025-05-10', 'nba:NY',  'nba:BOS', '2024-postseason'],
  // Per addendum v9.2 path-(i): nba:bdl-18436952 (DEN/OKC playoff) dropped due
  // to bbref-vs-ESPN fg3a single-source disagreement (bbref 45 vs ESPN 44,
  // ESPN public summary API confirms 44); replaced with deterministic
  // alternate nba:bdl-18421937 (lowest bdl-N in 2024-postseason not in sample).
  ['nba:bdl-18421937', '2025-04-19', 'nba:NY',  'nba:DET', '2024-postseason'],
  ['nba:bdl-18441484', '2025-05-31', 'nba:IND', 'nba:NY',  '2024-postseason'],
  ['nba:bdl-18444561', '2025-06-13', 'nba:IND', 'nba:OKC', '2024-postseason'],
  ['nba:bdl-18447026', '2025-11-18', 'nba:ORL', 'nba:GS',  '2025-regular'],
  ['nba:bdl-18447136', '2025-12-03', 'nba:ATL', 'nba:LAC', '2025-regular'],
  ['nba:bdl-20054974', '2025-12-14', 'nba:POR', 'nba:GS',  '2025-regular'],
  ['nba:bdl-18447244', '2025-12-26', 'nba:UTAH','nba:DET', '2025-regular'],
  ['nba:bdl-18447434', '2026-01-20', 'nba:UTAH','nba:MIN', '2025-regular'],
  ['nba:bdl-18447444', '2026-01-21', 'nba:SAC', 'nba:TOR', '2025-regular'],
  ['nba:bdl-18447725', '2026-03-05', 'nba:SAC', 'nba:NO',  '2025-regular'],
  ['nba:bdl-18447749', '2026-03-09', 'nba:CLE', 'nba:PHI', '2025-regular'],
  ['nba:bdl-18447807', '2026-03-16', 'nba:HOU', 'nba:LAL', '2025-regular'],
  ['nba:bdl-18447469', '2026-03-18', 'nba:MEM', 'nba:DEN', '2025-regular'],
];
type QueueRaw = [string, string, string, string, string];

const QUEUE: QueueEntry[] = RAW.map(([game_id, date, home_team_id, away_team_id, season_label]) => {
  const home_bbref = bbrefAbbr(home_team_id);
  const away_bbref = bbrefAbbr(away_team_id);
  return {
    game_id, season_label, home_team_id, away_team_id,
    home_bbref, away_bbref,
    bbref_url: bbrefUrl(date, home_bbref),
  };
});

function cachePathFor(gameId: string): string {
  return join(CACHE_DIR, `${gameId.replace(/[:/]/g, '_')}.html`);
}

async function fetchHtml(page: Page, url: string): Promise<string> {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (!resp) throw new Error(`No response from ${url}`);
  if (resp.status() !== 200) {
    const body = (await page.content()).slice(0, 500);
    throw new Error(`HTTP ${resp.status()} from ${url}\nbody preview: ${body}`);
  }
  return await page.content();
}

// Strip HTML comment markers so commented tables (Four Factors) parse like normal tables.
function decomment(html: string): string {
  return html.replace(/<!--/g, '').replace(/-->/g, '');
}

function extractTeamTotalsRow(html: string, bbrefAbbr: string): string {
  const tableRe = new RegExp(
    `<table[^>]*id="box-${bbrefAbbr}-game-basic"[\\s\\S]*?</table>`,
    'i'
  );
  const tableMatch = html.match(tableRe);
  if (!tableMatch) throw new Error(`Basic-stats table not found for ${bbrefAbbr}`);
  const tfootRe = /<tfoot[\s\S]*?<tr[\s\S]*?<\/tr>[\s\S]*?<\/tfoot>/i;
  const tfootMatch = tableMatch[0].match(tfootRe);
  if (!tfootMatch) throw new Error(`tfoot not found for ${bbrefAbbr}`);
  return tfootMatch[0];
}

function parseDataStats(rowHtml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<t[dh][^>]*data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml)) !== null) {
    // Strip nested HTML (e.g. <strong>) and trim
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    out[m[1]] = text;
  }
  return out;
}

function toInt(s: string | undefined, field: string): number {
  if (s === undefined || s === '') throw new Error(`Missing ${field}`);
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`Non-integer ${field}: "${s}"`);
  return n;
}

function toFloat(s: string | undefined): number | null {
  if (s === undefined || s === '') return null;
  // bbref shows percentages as decimals like ".610" — leading dot is fine for Number().
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseRawCounts(stats: Record<string, string>): RawCounts {
  return {
    fgm: toInt(stats.fg, 'fg'),
    fga: toInt(stats.fga, 'fga'),
    fg3m: toInt(stats.fg3, 'fg3'),
    fg3a: toInt(stats.fg3a, 'fg3a'),
    ftm: toInt(stats.ft, 'ft'),
    fta: toInt(stats.fta, 'fta'),
    oreb: toInt(stats.orb, 'orb'),
    dreb: toInt(stats.drb, 'drb'),
    reb: toInt(stats.trb, 'trb'),
    ast: toInt(stats.ast, 'ast'),
    stl: toInt(stats.stl, 'stl'),
    blk: toInt(stats.blk, 'blk'),
    tov: toInt(stats.tov, 'tov'),
    pf: toInt(stats.pf, 'pf'),
    pts: toInt(stats.pts, 'pts'),
  };
}

function extractFourFactorsRow(html: string, teamBbref: string): Record<string, string> {
  const tableRe = /<table[^>]*id="four_factors"[\s\S]*?<\/table>/i;
  const tableMatch = html.match(tableRe);
  if (!tableMatch) throw new Error('four_factors table not found');
  // Within the table, each tr's leading th data-stat="team_id" cell carries the team abbr.
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  const rows = tableMatch[0].match(trRe) ?? [];
  for (const row of rows) {
    const stats = parseDataStats(row);
    if (stats.team_id === teamBbref) return stats;
  }
  throw new Error(`four_factors row for ${teamBbref} not found`);
}

function parseRates(stats: Record<string, string>): PublishedRates {
  // bbref renders these inconsistently:
  //   pace    -> raw number (e.g. "99.1")
  //   efg_pct -> decimal (e.g. ".534")
  //   tov_pct -> percent  (e.g. "16.3")  ← divide by 100 to match audit's decimal scale
  //   off_rtg -> raw number (e.g. "108.0")
  const tov = toFloat(stats.tov_pct);
  return {
    pace: toFloat(stats.pace),
    efg_pct: toFloat(stats.efg_pct),
    tov_pct: tov === null ? null : tov / 100,
    ortg: toFloat(stats.off_rtg),
  };
}

function parseGame(html: string, q: QueueEntry): GroundTruthEntry {
  const decomm = decomment(html);
  const homeRow = extractTeamTotalsRow(decomm, q.home_bbref);
  const awayRow = extractTeamTotalsRow(decomm, q.away_bbref);
  const homeStats = parseDataStats(homeRow);
  const awayStats = parseDataStats(awayRow);
  const homeFf = extractFourFactorsRow(decomm, q.home_bbref);
  const awayFf = extractFourFactorsRow(decomm, q.away_bbref);
  return {
    game_id: q.game_id,
    bbref_url: q.bbref_url,
    season_label: q.season_label,
    home_team_id: q.home_team_id,
    away_team_id: q.away_team_id,
    home_raw_counts: parseRawCounts(homeStats),
    away_raw_counts: parseRawCounts(awayStats),
    home_published_rates: parseRates(homeFf),
    away_published_rates: parseRates(awayFf),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let limit = QUEUE.length;
  let parseOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') limit = parseInt(argv[++i], 10);
    else if (argv[i] === '--parse-only') parseOnly = true;
  }
  const queue = QUEUE.slice(0, limit);

  mkdirSync(CACHE_DIR, { recursive: true });

  let browser: Browser | null = null;
  let page: Page | null = null;
  if (!parseOnly) {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    // Mask the most obvious bot signal — webdriver flag.
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    page = await ctx.newPage();
  }

  const results: GroundTruthEntry[] = [];
  let didFetchPrev = false;
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    const cacheFile = cachePathFor(q.game_id);
    let html: string;
    let didFetch = false;
    if (existsSync(cacheFile)) {
      html = readFileSync(cacheFile, 'utf8');
      console.log(`[${i + 1}/${queue.length}] CACHED ${q.game_id}`);
    } else {
      if (parseOnly) {
        console.error(`[${i + 1}/${queue.length}] MISSING cache for ${q.game_id}; --parse-only mode aborts`);
        process.exit(2);
      }
      // Throttle BEFORE this fetch if the previous iteration also fetched.
      if (didFetchPrev) {
        console.log(`[${i + 1}/${queue.length}] sleeping ${THROTTLE_MS / 1000}s before fetch`);
        await new Promise((r) => setTimeout(r, THROTTLE_MS));
      }
      console.log(`[${i + 1}/${queue.length}] FETCH ${q.bbref_url}`);
      html = await fetchHtml(page!, q.bbref_url);
      writeFileSync(cacheFile, html);
      didFetch = true;
    }
    didFetchPrev = didFetch;

    try {
      const entry = parseGame(html, q);
      results.push(entry);
    } catch (err) {
      console.error(`[${i + 1}/${queue.length}] PARSE FAIL ${q.game_id}: ${(err as Error).message}`);
      throw err;
    }

    // Incremental save: every entry committed to disk so a mid-run crash leaves valid output.
    writeFileSync(TRUTH_PATH, JSON.stringify(results, null, 2) + '\n');
  }

  if (browser) await browser.close();
  console.log(`[done] wrote ${results.length} entries to ${TRUTH_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
