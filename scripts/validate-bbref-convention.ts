/**
 * Stratified bbref-convention validation harness.
 *
 * For each entry in data/bbref-convention-manifest.json:
 *  - Queries our stored tov + team_tov from nba_game_box_stats
 *  - Scrapes basketball-reference Tm TOV (Playwright, HTML-cached)
 *  - Reports match / mismatch per (game_id, team_id, stratum)
 *
 * Also re-probes the 4 sentinel game_ids via ESPN API to check if
 * ESPN now reports valid totalTurnovers for those games.
 *
 * Plan: Plans/nba-learned-model.md addendum v11 §"Pre-flight tooling" #1.
 * MUST run before any Phase 3 model-affecting backfill or feature change.
 *
 * Run:
 *   npx tsx scripts/validate-bbref-convention.ts
 *   npx tsx scripts/validate-bbref-convention.ts --parse-only     # cache only, no browser
 *   npx tsx scripts/validate-bbref-convention.ts --sentinel-only  # re-probe sentinel games only
 *   npx tsx scripts/validate-bbref-convention.ts --manifest path/to/manifest.json
 *
 * Output:
 *   data/bbref-convention-report.json
 *   docs/bbref-convention-report.md
 */

import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../src/storage/sqlite.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');

const CACHE_DIR = join(REPO_ROOT, 'data/.bbref-cache');
const THROTTLE_MS = 30_000;
const ESPN_BOX_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';

// --- Types ---

interface ManifestEntry {
  game_id: string | null;
  bbref_url: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  note?: string;
}

interface Manifest {
  strata: Record<string, ManifestEntry[]>;
  sentinel_game_ids: string[];
}

interface DbBoxRow {
  tov: number;
  team_tov: number | null;
}

interface GameResult {
  game_id: string;
  stratum: string;
  home_team_id: string;
  away_team_id: string;
  bbref_url: string;
  home: TeamResult;
  away: TeamResult;
  error?: string;
}

interface TeamResult {
  team_id: string;
  db_tov: number | null;
  db_team_tov: number | null;
  bbref_tov: number | null;
  convention_match: boolean | null;
  db_missing: boolean;
  parse_error?: string;
}

interface SentinelResult {
  game_id: string;
  espn_event_id: string | null;
  espn_event_id_missing: boolean;
  teams: SentinelTeamResult[];
  fetch_error?: string;
}

interface SentinelTeamResult {
  team_id: string;
  db_tov: number | null;
  db_team_tov: number | null;
  espn_total_turnovers: number | null;
  espn_team_turnovers: number | null;
  sentinel_active: boolean;
  espn_resolved: boolean;
}

interface StratumSummary {
  stratum: string;
  total_entries: number;
  todo_skipped: number;
  db_missing: number;
  matched: number;
  mismatched: number;
  errors: number;
  games: GameResult[];
}

interface Report {
  generated_at: string;
  manifest_path: string;
  strata_summary: StratumSummary[];
  sentinel_results: SentinelResult[];
  overall: {
    strata_with_min_2_matches: number;
    strata_total: number;
    strata_with_insufficient_data: string[];
    sentinel_active_count: number;
    sentinel_resolved_count: number;
  };
}

// --- bbref abbr mapping (mirrors scrape-bbref-audit-truth.ts) ---
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

function cachePathFor(gameId: string): string {
  return join(CACHE_DIR, `conv_${gameId.replace(/[:/]/g, '_')}.html`);
}

// --- bbref HTML parsing (mirrors scrape-bbref-audit-truth.ts) ---

function decomment(html: string): string {
  return html.replace(/<!--/g, '').replace(/-->/g, '');
}

function extractTeamTotalsRow(html: string, abbr: string): string {
  const tableRe = new RegExp(`<table[^>]*id="box-${abbr}-game-basic"[\\s\\S]*?</table>`, 'i');
  const tableMatch = html.match(tableRe);
  if (!tableMatch) throw new Error(`Basic-stats table not found for ${abbr}`);
  const tfootRe = /<tfoot[\s\S]*?<tr[\s\S]*?<\/tr>[\s\S]*?<\/tfoot>/i;
  const tfootMatch = tableMatch[0].match(tfootRe);
  if (!tfootMatch) throw new Error(`tfoot not found for ${abbr}`);
  return tfootMatch[0];
}

function parseDataStats(rowHtml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<t[dh][^>]*data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml)) !== null) {
    out[m[1]] = m[2].replace(/<[^>]+>/g, '').trim();
  }
  return out;
}

function parseBbrefTov(html: string, homeAbbr: string, awayAbbr: string): { homeTov: number; awayTov: number } {
  const decomm = decomment(html);
  const homeRow = extractTeamTotalsRow(decomm, homeAbbr);
  const awayRow = extractTeamTotalsRow(decomm, awayAbbr);
  const homeStats = parseDataStats(homeRow);
  const awayStats = parseDataStats(awayRow);
  const toInt = (s: string | undefined, label: string) => {
    if (s === undefined || s === '') throw new Error(`Missing ${label}`);
    const n = Number(s);
    if (!Number.isInteger(n)) throw new Error(`Non-integer ${label}: "${s}"`);
    return n;
  };
  return {
    homeTov: toInt(homeStats['tov'], `home tov (${homeAbbr})`),
    awayTov: toInt(awayStats['tov'], `away tov (${awayAbbr})`),
  };
}

// --- DB queries ---

function queryBoxRow(gameId: string, teamId: string): DbBoxRow | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT tov, team_tov FROM nba_game_box_stats WHERE game_id = ? AND team_id = ?'
  ).get(gameId, teamId) as { tov: number; team_tov: number | null } | undefined;
  return row ?? null;
}

function queryEspnEventId(gameId: string): string | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT espn_event_id FROM nba_espn_event_ids WHERE game_id = ?'
  ).get(gameId) as { espn_event_id: string } | undefined;
  return row?.espn_event_id ?? null;
}

// --- ESPN sentinel re-probe ---

interface EspnStatItem {
  name: string;
  displayValue: string;
}

interface EspnTeamBoxEntry {
  team: { abbreviation: string };
  statistics: EspnStatItem[];
}

function parseTovFromEspnStats(stats: EspnStatItem[], fieldName: string): number | null {
  const stat = stats.find(s => s.name === fieldName);
  if (!stat) return null;
  const n = parseInt(stat.displayValue, 10);
  return Number.isInteger(n) ? n : null;
}

async function probeEspnSentinel(
  gameId: string,
  espnEventId: string,
): Promise<{ teams: Array<{ abbreviation: string; totalTurnovers: number | null; teamTurnovers: number | null }> } | null> {
  const url = `${ESPN_BOX_BASE}?event=${espnEventId}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json() as { boxscore?: { teams?: EspnTeamBoxEntry[] } };
    const teams = data?.boxscore?.teams ?? [];
    return {
      teams: teams.map(t => ({
        abbreviation: t.team.abbreviation,
        totalTurnovers: parseTovFromEspnStats(t.statistics, 'totalTurnovers'),
        teamTurnovers: parseTovFromEspnStats(t.statistics, 'teamTurnovers'),
      })),
    };
  } catch {
    return null;
  }
}

// --- Playwright fetch ---

async function fetchHtmlCached(page: Page, url: string, cachePath: string): Promise<string> {
  if (existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf8');
  }
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (!resp || resp.status() !== 200) {
    throw new Error(`HTTP ${resp?.status() ?? 'no response'} from ${url}`);
  }
  const html = await page.content();
  writeFileSync(cachePath, html);
  return html;
}

// --- Main ---

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let manifestPath = join(REPO_ROOT, 'data/bbref-convention-manifest.json');
  let parseOnly = false;
  let sentinelOnly = false;
  let sentinelOverride: string[] | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--manifest') manifestPath = argv[++i];
    else if (argv[i] === '--parse-only') parseOnly = true;
    else if (argv[i] === '--sentinel-only') sentinelOnly = true;
    else if (argv[i] === '--sentinel-game-ids') {
      sentinelOverride = argv[++i].split(',').map(s => s.trim());
    }
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(join(REPO_ROOT, 'docs'), { recursive: true });

  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const sentinelGameIds = sentinelOverride ?? manifest.sentinel_game_ids ?? [];

  const strataResults: StratumSummary[] = [];

  if (!sentinelOnly) {
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
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      page = await ctx.newPage();
    }

    for (const [stratum, entries] of Object.entries(manifest.strata)) {
      const summary: StratumSummary = {
        stratum,
        total_entries: entries.length,
        todo_skipped: 0,
        db_missing: 0,
        matched: 0,
        mismatched: 0,
        errors: 0,
        games: [],
      };

      let didFetchPrev = false;

      for (const entry of entries) {
        if (!entry.game_id || !entry.bbref_url || !entry.home_team_id || !entry.away_team_id) {
          summary.todo_skipped++;
          continue;
        }

        const { game_id, bbref_url, home_team_id, away_team_id } = entry;
        const homeAbbr = bbrefAbbr(home_team_id);
        const awayAbbr = bbrefAbbr(away_team_id);
        const cachePath = cachePathFor(game_id);

        const gameResult: GameResult = {
          game_id,
          stratum,
          home_team_id,
          away_team_id,
          bbref_url,
          home: { team_id: home_team_id, db_tov: null, db_team_tov: null, bbref_tov: null, convention_match: null, db_missing: false },
          away: { team_id: away_team_id, db_tov: null, db_team_tov: null, bbref_tov: null, convention_match: null, db_missing: false },
        };

        // Query DB
        const homeRow = queryBoxRow(game_id, home_team_id);
        const awayRow = queryBoxRow(game_id, away_team_id);
        if (!homeRow) gameResult.home.db_missing = true;
        if (!awayRow) gameResult.away.db_missing = true;

        if (homeRow) {
          gameResult.home.db_tov = homeRow.tov;
          gameResult.home.db_team_tov = homeRow.team_tov;
        }
        if (awayRow) {
          gameResult.away.db_tov = awayRow.tov;
          gameResult.away.db_team_tov = awayRow.team_tov;
        }

        if (!homeRow && !awayRow) {
          summary.db_missing++;
          summary.games.push(gameResult);
          continue;
        }

        // Scrape bbref
        try {
          const cacheHit = existsSync(cachePath);

          if (!cacheHit && parseOnly) {
            throw new Error(`Cache miss in --parse-only mode: ${game_id}`);
          }

          if (!cacheHit) {
            if (didFetchPrev) {
              console.log(`  sleeping ${THROTTLE_MS / 1000}s before fetch`);
              await new Promise(r => setTimeout(r, THROTTLE_MS));
            }
            console.log(`  FETCH ${bbref_url}`);
          } else {
            console.log(`  CACHED ${game_id}`);
          }

          const html = await fetchHtmlCached(page!, bbref_url, cachePath);
          didFetchPrev = !cacheHit;

          const { homeTov, awayTov } = parseBbrefTov(html, homeAbbr, awayAbbr);
          gameResult.home.bbref_tov = homeTov;
          gameResult.away.bbref_tov = awayTov;

          if (homeRow) {
            gameResult.home.convention_match = homeRow.tov === homeTov;
          }
          if (awayRow) {
            gameResult.away.convention_match = awayRow.tov === awayTov;
          }

          const bothMatch = gameResult.home.convention_match !== false && gameResult.away.convention_match !== false;
          if (bothMatch) summary.matched++;
          else summary.mismatched++;

          const matchStr = bothMatch ? 'MATCH' : 'MISMATCH';
          console.log(`  [${matchStr}] ${game_id} h:${homeRow?.tov ?? 'N/A'}==${homeTov} a:${awayRow?.tov ?? 'N/A'}==${awayTov}`);

        } catch (err) {
          gameResult.error = (err as Error).message;
          summary.errors++;
          console.error(`  ERROR ${game_id}: ${(err as Error).message}`);
        }

        summary.games.push(gameResult);
      }

      strataResults.push(summary);
      console.log(`[${stratum}] matched=${summary.matched} mismatch=${summary.mismatched} db_missing=${summary.db_missing} todo=${summary.todo_skipped} err=${summary.errors}`);
    }

    if (browser) await browser.close();
  }

  // --- Sentinel re-probe ---
  console.log('\n--- Sentinel re-probe ---');
  const sentinelResults: SentinelResult[] = [];

  for (const gameId of sentinelGameIds) {
    const espnEventId = queryEspnEventId(gameId);
    const result: SentinelResult = {
      game_id: gameId,
      espn_event_id: espnEventId,
      espn_event_id_missing: !espnEventId,
      teams: [],
    };

    if (!espnEventId) {
      console.log(`  SENTINEL ${gameId}: ESPN event ID not in DB`);
      sentinelResults.push(result);
      continue;
    }

    // Query DB for current tov/team_tov (we need both home and away)
    const db = getDb();
    const dbRows = db.prepare(
      'SELECT team_id, tov, team_tov FROM nba_game_box_stats WHERE game_id = ?'
    ).all(gameId) as Array<{ team_id: string; tov: number; team_tov: number | null }>;

    // Probe ESPN
    const espnData = await probeEspnSentinel(gameId, espnEventId);

    if (!espnData) {
      result.fetch_error = `ESPN fetch failed for event ${espnEventId}`;
      console.log(`  SENTINEL ${gameId}: ESPN fetch failed`);
      sentinelResults.push(result);
      continue;
    }

    for (const dbRow of dbRows) {
      const espnTeam = espnData.teams.find(t => {
        const abbr = dbRow.team_id.replace(/^nba:/, '');
        return t.abbreviation === abbr || t.abbreviation === BBREF_ABBR[abbr];
      });

      const teamResult: SentinelTeamResult = {
        team_id: dbRow.team_id,
        db_tov: dbRow.tov,
        db_team_tov: dbRow.team_tov,
        espn_total_turnovers: espnTeam?.totalTurnovers ?? null,
        espn_team_turnovers: espnTeam?.teamTurnovers ?? null,
        sentinel_active: dbRow.tov === 0,
        espn_resolved: (espnTeam?.totalTurnovers ?? 0) > 0,
      };

      const status = teamResult.espn_resolved ? 'RESOLVED' : (teamResult.sentinel_active ? 'ACTIVE' : 'OK');
      console.log(`  SENTINEL ${gameId} ${dbRow.team_id}: ${status} db_tov=${dbRow.tov} espn_totalTov=${espnTeam?.totalTurnovers ?? 'N/A'}`);
      result.teams.push(teamResult);
    }

    sentinelResults.push(result);
  }

  // --- Build report ---
  const strataWithInsufficient = strataResults
    .filter(s => (s.matched + s.mismatched) < 2)
    .map(s => s.stratum);

  const report: Report = {
    generated_at: new Date().toISOString(),
    manifest_path: manifestPath,
    strata_summary: strataResults,
    sentinel_results: sentinelResults,
    overall: {
      strata_with_min_2_matches: strataResults.filter(s => s.matched >= 2).length,
      strata_total: strataResults.length,
      strata_with_insufficient_data: strataWithInsufficient,
      sentinel_active_count: sentinelResults.flatMap(r => r.teams).filter(t => t.sentinel_active).length,
      sentinel_resolved_count: sentinelResults.flatMap(r => r.teams).filter(t => t.espn_resolved).length,
    },
  };

  // Write JSON and markdown (skip in --sentinel-only to avoid overwriting a full-run report)
  if (!sentinelOnly) {
    const jsonPath = join(REPO_ROOT, 'data/bbref-convention-report.json');
    writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`\nWrote ${jsonPath}`);

    const md = buildMarkdownReport(report);
    const mdPath = join(REPO_ROOT, 'docs/bbref-convention-report.md');
    writeFileSync(mdPath, md);
    console.log(`Wrote ${mdPath}`);
  }

  // Exit summary
  if (!sentinelOnly) {
    if (strataWithInsufficient.length > 0) {
      console.warn(`\nWARN: ${strataWithInsufficient.length} strata have < 2 validated games: ${strataWithInsufficient.join(', ')}`);
      console.warn('Populate the manifest and re-run before Phase 3 model work.');
      process.exit(1);
    } else {
      console.log('\nAll strata have >= 2 validated games. Convention validation complete.');
    }
  }
  console.log('Sentinel re-probe complete.');
}

function buildMarkdownReport(report: Report): string {
  const lines: string[] = [
    '# bbref Convention Report',
    '',
    `Generated: ${report.generated_at}`,
    '',
    '## Strata summary',
    '',
    '| Stratum | Matched | Mismatch | DB missing | TODO skipped | Errors |',
    '|---|---|---|---|---|---|',
  ];

  for (const s of report.strata_summary) {
    const insufficient = (s.matched + s.mismatched) < 2 ? ' ⚠️' : '';
    lines.push(`| ${s.stratum}${insufficient} | ${s.matched} | ${s.mismatched} | ${s.db_missing} | ${s.todo_skipped} | ${s.errors} |`);
  }

  lines.push('', '## Game-level results', '');

  for (const s of report.strata_summary) {
    for (const g of s.games) {
      if (g.error) {
        lines.push(`- **ERROR** \`${g.game_id}\` (${g.stratum}): ${g.error}`);
        continue;
      }
      const homeMatch = g.home.convention_match === true ? '✓' : g.home.convention_match === false ? '✗' : '?';
      const awayMatch = g.away.convention_match === true ? '✓' : g.away.convention_match === false ? '✗' : '?';
      lines.push(`- \`${g.game_id}\` (${g.stratum}) home=${homeMatch} db:${g.home.db_tov ?? 'N/A'} bbref:${g.home.bbref_tov ?? 'N/A'} | away=${awayMatch} db:${g.away.db_tov ?? 'N/A'} bbref:${g.away.bbref_tov ?? 'N/A'}`);
    }
  }

  lines.push('', '## Sentinel re-probe', '');
  lines.push('| game_id | team_id | sentinel_active | espn_resolved | db_tov | espn_totalTov | espn_teamTov |');
  lines.push('|---|---|---|---|---|---|---|');

  for (const r of report.sentinel_results) {
    if (r.espn_event_id_missing) {
      lines.push(`| ${r.game_id} | — | — | — | ESPN event ID not in DB | — | — |`);
      continue;
    }
    if (r.fetch_error) {
      lines.push(`| ${r.game_id} | — | — | — | ${r.fetch_error} | — | — |`);
      continue;
    }
    for (const t of r.teams) {
      lines.push(`| ${r.game_id} | ${t.team_id} | ${t.sentinel_active} | ${t.espn_resolved} | ${t.db_tov ?? 'N/A'} | ${t.espn_total_turnovers ?? 'N/A'} | ${t.espn_team_turnovers ?? 'N/A'} |`);
    }
  }

  lines.push('', '## Overall', '');
  const o = report.overall;
  lines.push(`- Strata with ≥2 validated games: **${o.strata_with_min_2_matches} / ${o.strata_total}**`);
  if (o.strata_with_insufficient_data.length > 0) {
    lines.push(`- Strata needing more entries: ${o.strata_with_insufficient_data.map(s => `\`${s}\``).join(', ')}`);
  }
  lines.push(`- Sentinel rows still active (db_tov=0): **${o.sentinel_active_count}**`);
  lines.push(`- Sentinel rows now resolved in ESPN: **${o.sentinel_resolved_count}**`);

  return lines.join('\n') + '\n';
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
