/**
 * Scrape bbref league-season advanced stats and draft pages for player BPM data.
 *
 * Produces two sets of JSON files:
 *   data/bbref-player-bpm/{year}.json  — all players who played in that season
 *   data/bbref-draft/{year}.json       — draft order for that class
 *
 * Used by ml/nba/calibrate_rookie_prior.py and ml/nba/calibrate_k.py.
 *
 * Pages fetched (at 30s throttle, ~15 min total):
 *   Advanced stats: https://www.basketball-reference.com/leagues/NBA_{year}_advanced.html
 *   Draft:          https://www.basketball-reference.com/draft/NBA_{year}.html
 *
 * Cache: data/.bbref-cache/bpm-{year}.html and draft-{year}.html.
 * --parse-only flag replays cached HTML with no network requests.
 *
 * Run:
 *   npx tsx scripts/scrape-bbref-player-bpm.ts               # years 2018-2024
 *   npx tsx scripts/scrape-bbref-player-bpm.ts 2023 2024     # specific range
 *   npx tsx scripts/scrape-bbref-player-bpm.ts --parse-only  # cache only
 */

import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CACHE_DIR = 'data/.bbref-cache';
const BPM_OUT_DIR = 'data/bbref-player-bpm';
const DRAFT_OUT_DIR = 'data/bbref-draft';
const THROTTLE_MS = 30_000;

const args = process.argv.slice(2);
const parseOnly = args.includes('--parse-only');
const yearArgs = args.filter(a => /^\d{4}$/.test(a));

// Default: 2018-2024. Advanced stats for year Y = the Y-1/Y season (e.g. 2023 = 2022-23).
// We need prior-season BPM: to build priors for seasons 2019-2025, we need years 2018-2024.
const DEFAULT_START = 2018;
const DEFAULT_END = 2024;
const startYear = yearArgs[0] ? parseInt(yearArgs[0]) : DEFAULT_START;
const endYear = yearArgs[1] ? parseInt(yearArgs[1]) : DEFAULT_END;
const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);

// Draft years: players drafted in year Y are rookies in year Y+1 (bbref convention).
// To calibrate rookies entering seasons 2019-2025, we need draft years 2018-2024.
const draftYears = years; // same range

export interface PlayerBpmRow {
  bbref_id: string;   // e.g. 'jamesle01'
  name: string;
  team: string;       // 'TOT' for traded players (total season)
  mp: number;
  bpm: number;
}

export interface DraftPick {
  pick: number;
  bbref_id: string;
  name: string;
  team: string;       // drafting team
}

// Strip HTML comments so commented-out bbref tables parse normally.
function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, (match) => {
    // Keep only the inner content of comments that contain table tags.
    if (/<table/i.test(match)) return match.slice(4, -3);
    return '';
  });
}

// Extract the text of a data-stat cell from a row's HTML.
function dataStat(rowHtml: string, stat: string): string {
  const re = new RegExp(`data-stat="${stat}"[^>]*>([^<]*)<`, 'i');
  const m = rowHtml.match(re);
  return m ? m[1].trim() : '';
}

// Extract href slug from a data-stat cell containing an <a> tag.
function dataStatHref(rowHtml: string, stat: string): string {
  const re = new RegExp(`data-stat="${stat}"[^>]*>\\s*<a[^>]*href="([^"]+)"`, 'i');
  const m = rowHtml.match(re);
  if (!m) return '';
  // e.g. /players/j/jamesle01.html → jamesle01
  const parts = m[1].split('/');
  return parts[parts.length - 1].replace('.html', '');
}

function parseAdvancedStats(html: string): PlayerBpmRow[] {
  const clean = stripComments(html);

  const tableRe = /<table[^>]*id="advanced_stats"[\s\S]*?<\/table>/i;
  const tableMatch = clean.match(tableRe);
  if (!tableMatch) throw new Error('advanced_stats table not found');

  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  const rows = tableMatch[0].match(rowRe) ?? [];

  const players: PlayerBpmRow[] = [];
  for (const row of rows) {
    // Skip header/separator rows (they have <th> ranker cells with non-numeric content).
    const ranker = dataStat(row, 'ranker');
    if (!ranker || !/^\d+$/.test(ranker)) continue;

    const name = dataStat(row, 'player');
    const bbref_id = dataStatHref(row, 'player');
    const team = dataStat(row, 'team_id');
    const mpStr = dataStat(row, 'mp');
    const bpmStr = dataStat(row, 'bpm');

    if (!name || !bbref_id || !team) continue;
    const mp = parseInt(mpStr, 10);
    const bpm = parseFloat(bpmStr);
    if (!Number.isFinite(mp) || !Number.isFinite(bpm)) continue;

    players.push({ bbref_id, name, team, mp, bpm });
  }

  // For traded players, bbref shows one row per team + a "TOT" (totals) row.
  // Keep TOT if present; otherwise keep the single row.
  const byId = new Map<string, PlayerBpmRow[]>();
  for (const p of players) {
    const rows = byId.get(p.bbref_id) ?? [];
    rows.push(p);
    byId.set(p.bbref_id, rows);
  }

  const result: PlayerBpmRow[] = [];
  for (const [, rows] of byId) {
    const tot = rows.find(r => r.team === 'TOT');
    result.push(tot ?? rows[0]!);
  }

  return result;
}

function parseDraft(html: string): DraftPick[] {
  const clean = stripComments(html);

  // Draft table ID varies: 'stats' inside 'div_stats'
  const tableRe = /<table[^>]*id="stats"[\s\S]*?<\/table>/i;
  const tableMatch = clean.match(tableRe);
  if (!tableMatch) throw new Error('draft stats table not found');

  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  const rows = tableMatch[0].match(rowRe) ?? [];

  const picks: DraftPick[] = [];
  for (const row of rows) {
    const pickStr = dataStat(row, 'pick_overall');
    if (!pickStr || !/^\d+$/.test(pickStr)) continue;

    const name = dataStat(row, 'player');
    const bbref_id = dataStatHref(row, 'player');
    const team = dataStat(row, 'team_id');
    if (!name || !bbref_id) continue;

    picks.push({ pick: parseInt(pickStr, 10), bbref_id, name, team });
  }

  return picks;
}

async function fetchWithCache(page: Page | null, url: string, cacheFile: string): Promise<string> {
  if (existsSync(cacheFile)) {
    return readFileSync(cacheFile, 'utf8');
  }
  if (parseOnly) throw new Error(`Cache miss in --parse-only mode: ${cacheFile}`);
  if (!page) throw new Error('No browser page available');

  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (!resp || !resp.ok()) {
    const preview = (await page.content()).slice(0, 300);
    throw new Error(`HTTP ${resp?.status()} from ${url}\n${preview}`);
  }
  const html = await page.content();
  writeFileSync(cacheFile, html);
  return html;
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(BPM_OUT_DIR, { recursive: true });
  mkdirSync(DRAFT_OUT_DIR, { recursive: true });

  let browser: Browser | null = null;
  let page: Page | null = null;
  let lastFetch = 0;

  if (!parseOnly) {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  }

  try {
    // --- Advanced stats pages ---
    for (const year of years) {
      const url = `https://www.basketball-reference.com/leagues/NBA_${year}_advanced.html`;
      const cacheFile = join(CACHE_DIR, `bpm-${year}.html`);
      const outFile = join(BPM_OUT_DIR, `${year}.json`);

      console.log(`\n[advanced ${year}] ${existsSync(cacheFile) ? '(cached)' : url}`);

      if (!existsSync(cacheFile) && !parseOnly) {
        const wait = THROTTLE_MS - (Date.now() - lastFetch);
        if (lastFetch > 0 && wait > 0) {
          console.log(`  sleeping ${Math.round(wait / 1000)}s...`);
          await new Promise(r => setTimeout(r, wait));
        }
      }

      const html = await fetchWithCache(page, url, cacheFile);
      if (!existsSync(cacheFile)) lastFetch = Date.now();

      const players = parseAdvancedStats(html);
      writeFileSync(outFile, JSON.stringify(players, null, 2) + '\n');
      console.log(`  → ${players.length} players written to ${outFile}`);
    }

    // --- Draft pages ---
    for (const year of draftYears) {
      const url = `https://www.basketball-reference.com/draft/NBA_${year}.html`;
      const cacheFile = join(CACHE_DIR, `draft-${year}.html`);
      const outFile = join(DRAFT_OUT_DIR, `${year}.json`);

      console.log(`\n[draft ${year}] ${existsSync(cacheFile) ? '(cached)' : url}`);

      if (!existsSync(cacheFile) && !parseOnly) {
        const wait = THROTTLE_MS - (Date.now() - lastFetch);
        if (lastFetch > 0 && wait > 0) {
          console.log(`  sleeping ${Math.round(wait / 1000)}s...`);
          await new Promise(r => setTimeout(r, wait));
        }
      }

      const html = await fetchWithCache(page, url, cacheFile);
      if (!existsSync(cacheFile)) lastFetch = Date.now();

      const picks = parseDraft(html);
      writeFileSync(outFile, JSON.stringify(picks, null, 2) + '\n');
      console.log(`  → ${picks.length} picks written to ${outFile}`);
    }
  } finally {
    await browser?.close();
  }

  console.log('\nDone. Next: run ml/nba/calibrate_rookie_prior.py');
}

main().catch(err => { console.error(err); process.exit(1); });
