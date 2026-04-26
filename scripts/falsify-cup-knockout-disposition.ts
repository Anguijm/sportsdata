/**
 * pm.5 named falsification test — Cup-knockout game disposition.
 *
 * Computes v5 Brier score on historical Cup-knockout games vs regular-season
 * games played in the same calendar months. Reports Δ Brier with bootstrap
 * 95% CI and evaluates the falsification criterion.
 *
 * Falsification criterion (addendum v11 §Cup-knockout disposition):
 *   Δ Brier (Cup-KO − regular-season-same-month) > 0.02 → REJECT option (b) drop.
 *   Δ Brier ≤ 0.02 → (b) drop is acceptable; neutral-site shift is below noise.
 *
 * Cup-knockout windows (NBA In-Season Tournament schedule):
 *   2023-24: 2023-12-04 – 2023-12-09 (quarterfinals through final)
 *   2024-25: 2024-12-16 – 2024-12-22 (quarterfinals through final)
 *
 * Output: docs/cup-knockout-disposition-evidence.md
 *
 * Run:
 *   npx tsx scripts/falsify-cup-knockout-disposition.ts
 *   npx tsx scripts/falsify-cup-knockout-disposition.ts --game-ids data/cup-knockout-game-ids.json
 *   npx tsx scripts/falsify-cup-knockout-disposition.ts --bootstrap-samples 5000
 *
 * Plan: Plans/nba-learned-model.md addendum v11 §"Pre-flight tooling" #4 (pm.5).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../src/storage/sqlite.js';
import { buildTeamStateUpTo } from '../src/analysis/predict-runner.js';
import { v5 } from '../src/analysis/predict.js';
import type { GameForPrediction, PredictionContext } from '../src/analysis/predict.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');

const FALSIFICATION_THRESHOLD = 0.02;
const DEFAULT_BOOTSTRAP_SAMPLES = 2000;

// Default fixture file with confirmed Cup-KO game IDs.
const DEFAULT_GAME_IDS_PATH = join(REPO_ROOT, 'data/cup-knockout-game-ids.json');

// Specific Cup-KO game dates (used by --derive when no fixture file exists).
// Based on NBA In-Season Tournament schedule:
//   2023-24: QF Dec 4-5, SF Dec 7, Final Dec 9 (7 games)
//   2024-25: QF Dec 10, SF Dec 14, Final Dec 17 (5 confirmed games)
const CUP_KNOCKOUT_SPECIFIC_DATES: Array<{ date: string; season: string }> = [
  { date: '2023-12-04', season: '2023-regular' },
  { date: '2023-12-05', season: '2023-regular' },
  { date: '2023-12-07', season: '2023-regular' },
  { date: '2023-12-09', season: '2023-regular' },
  { date: '2024-12-10', season: '2024-regular' },
  { date: '2024-12-11', season: '2024-regular' },
  { date: '2024-12-14', season: '2024-regular' },
  { date: '2024-12-17', season: '2024-regular' },
];

// Calendar months to draw regular-season comparison games from.
const COMPARISON_MONTH_PREFIXES = ['2023-12-', '2024-12-'];

interface GameRow {
  game_id: string;
  date: string;
  home_team_id: string;
  away_team_id: string;
  home_win: number;
}

interface ScoredGame {
  game_id: string;
  date: string;
  home_team_id: string;
  away_team_id: string;
  home_win: number;
  prob: number;
  brier: number;
  group: 'cup_knockout' | 'regular_season';
}

interface GameIdFixture {
  _note?: string;
  game_ids: string[];
}

function loadCupKnockoutGameIds(path: string): string[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as GameIdFixture | string[];
  if (Array.isArray(raw)) return raw;
  return raw.game_ids;
}

function deriveCupKnockoutGames(): GameRow[] {
  const db = getDb();
  // NOTE: Dec 10, Dec 11, and Dec 14 2024 had BOTH Cup-KO and regular-season games
  // on the same date. This derive query pulls ALL games on those dates, which will
  // include non-Cup games. Prefer the fixture file (data/cup-knockout-game-ids.json)
  // for accurate Cup-KO identification; --derive is a fallback only.
  const conditions = CUP_KNOCKOUT_SPECIFIC_DATES.map(
    d => `(g.date = '${d.date}' AND g.season = '${d.season}')`
  ).join(' OR ');

  const rows = db.prepare(`
    SELECT g.id AS game_id, g.date, g.home_team_id, g.away_team_id, gr.home_win
    FROM games g
    JOIN game_results gr ON gr.game_id = g.id
    WHERE g.sport = 'nba' AND g.status = 'final'
      AND (${conditions})
    ORDER BY g.date
  `).all() as GameRow[];

  return rows;
}

function loadCupKnockoutGamesByIds(ids: string[]): GameRow[] {
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT g.id AS game_id, g.date, g.home_team_id, g.away_team_id, gr.home_win
    FROM games g
    JOIN game_results gr ON gr.game_id = g.id
    WHERE g.id IN (${placeholders})
    ORDER BY g.date
  `).all(...ids) as GameRow[];
  return rows;
}

function loadComparisonGames(excludeIds: Set<string>): GameRow[] {
  const db = getDb();
  const likeClauses = COMPARISON_MONTH_PREFIXES.map(p => `g.date LIKE '${p}%'`).join(' OR ');
  const rows = db.prepare(`
    SELECT g.id AS game_id, g.date, g.home_team_id, g.away_team_id, gr.home_win
    FROM games g
    JOIN game_results gr ON gr.game_id = g.id
    WHERE g.sport = 'nba' AND g.status = 'final'
      AND (${likeClauses})
    ORDER BY g.date
  `).all() as GameRow[];

  return rows.filter(r => !excludeIds.has(r.game_id));
}

function scoreGame(game: GameRow): { prob: number; brier: number } {
  const stateMap = buildTeamStateUpTo('nba', game.date);
  const home = stateMap.get(game.home_team_id) ?? {
    games: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, lastNResults: [],
  };
  const away = stateMap.get(game.away_team_id) ?? {
    games: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, lastNResults: [],
  };
  const gfp: GameForPrediction = {
    game_id: game.game_id,
    date: game.date,
    sport: 'nba',
    home_team_id: game.home_team_id,
    away_team_id: game.away_team_id,
    home_win: game.home_win,
  };
  const ctx: PredictionContext = { home, away, asOfDate: game.date };
  const prob = v5.predict(gfp, ctx);
  const brier = Math.pow(prob - game.home_win, 2);
  return { prob, brier };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Deterministic LCG PRNG for reproducible bootstrap.
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
}

function bootstrapDeltaCI(
  cupBriers: number[],
  rsBriers: number[],
  B: number,
): { ci95: [number, number]; deltaMean: number } {
  const prng = makePrng(42);
  const deltas: number[] = [];
  for (let i = 0; i < B; i++) {
    const cupResample = Array.from({ length: cupBriers.length }, () =>
      cupBriers[Math.floor(prng() * cupBriers.length)]
    );
    const rsResample = Array.from({ length: rsBriers.length }, () =>
      rsBriers[Math.floor(prng() * rsBriers.length)]
    );
    deltas.push(mean(cupResample) - mean(rsResample));
  }
  deltas.sort((a, b) => a - b);
  return {
    ci95: [deltas[Math.floor(B * 0.025)], deltas[Math.floor(B * 0.975)]],
    deltaMean: mean(cupBriers) - mean(rsBriers),
  };
}

function buildMarkdown(
  cupGames: ScoredGame[],
  rsGames: ScoredGame[],
  cupMeanBrier: number,
  rsMeanBrier: number,
  delta: number,
  ci95: [number, number],
  bootstrapSamples: number,
): string {
  const falsified = delta > FALSIFICATION_THRESHOLD;
  const verdict = falsified
    ? `**FALSIFIED** — Δ Brier ${delta.toFixed(4)} > ${FALSIFICATION_THRESHOLD}. Option (b) drop REJECTED.`
    : `**PASSES** — Δ Brier ${delta.toFixed(4)} ≤ ${FALSIFICATION_THRESHOLD}. Option (b) drop is acceptable.`;

  const lines: string[] = [
    '# Cup-Knockout Disposition Evidence',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Falsification criterion',
    '',
    `Δ Brier (Cup-KO − regular-season-same-month) > ${FALSIFICATION_THRESHOLD} → REJECT option (b) drop.`,
    `Δ Brier ≤ ${FALSIFICATION_THRESHOLD} → option (b) drop is acceptable.`,
    '',
    `## Result: ${verdict}`,
    '',
    '## Summary statistics',
    '',
    `| Metric | Cup-KO (n=${cupGames.length}) | Regular-season (n=${rsGames.length}) |`,
    '|---|---|---|',
    `| Mean Brier | ${cupMeanBrier.toFixed(4)} | ${rsMeanBrier.toFixed(4)} |`,
    `| Δ Brier (Cup-KO − RS) | **${delta.toFixed(4)}** | — |`,
    `| Bootstrap 95% CI | [${ci95[0].toFixed(4)}, ${ci95[1].toFixed(4)}] | B=${bootstrapSamples} |`,
    `| Falsification threshold | ${FALSIFICATION_THRESHOLD} | — |`,
    '',
    '## Per-game scores (Cup-KO)',
    '',
    '| game_id | date | home | away | home_win | v5_prob | brier |',
    '|---|---|---|---|---|---|---|',
    ...cupGames.map(g =>
      `| ${g.game_id} | ${g.date} | ${g.home_team_id} | ${g.away_team_id} | ${g.home_win} | ${g.prob.toFixed(4)} | ${g.brier.toFixed(4)} |`
    ),
    '',
    '## Per-game scores (regular-season sample, same months)',
    '',
    '| game_id | date | home | away | home_win | v5_prob | brier |',
    '|---|---|---|---|---|---|---|',
    ...rsGames.map(g =>
      `| ${g.game_id} | ${g.date} | ${g.home_team_id} | ${g.away_team_id} | ${g.home_win} | ${g.prob.toFixed(4)} | ${g.brier.toFixed(4)} |`
    ),
    '',
    '## Chosen disposition',
    '',
    falsified
      ? '**Option (a) accept-as-is** — falsification test rejected (b) drop. Preserve Cup-KO games in training tensor.'
      : '**Option (b) drop** — falsification test passed. Cup-KO games may be dropped from training tensor without material Brier degradation.',
    '',
    '## Evidence chain',
    '',
    '- Rule source: Plans/nba-learned-model.md addendum v11 §Cup-knockout disposition',
    `- Cup-KO dates: ${CUP_KNOCKOUT_SPECIFIC_DATES.map(d => `${d.date} (${d.season})`).join(', ')}`,
    `- Bootstrap: B=${bootstrapSamples}, seed=42 (deterministic)`,
    '- Falsification test named by: Domain expert, council R1 (addendum v11)',
  ];

  return lines.join('\n') + '\n';
}

function main(): void {
  const argv = process.argv.slice(2);
  let gameIdsPath: string | null = null;
  let bootstrapSamples = DEFAULT_BOOTSTRAP_SAMPLES;
  let useDeriveMode = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--game-ids') gameIdsPath = argv[++i];
    else if (argv[i] === '--bootstrap-samples') bootstrapSamples = parseInt(argv[++i], 10);
    else if (argv[i] === '--derive') useDeriveMode = true;
  }

  mkdirSync(join(REPO_ROOT, 'docs'), { recursive: true });

  // Resolve game ID source: explicit flag > default fixture file > date-derive
  const resolvedPath = gameIdsPath ?? (existsSync(DEFAULT_GAME_IDS_PATH) ? DEFAULT_GAME_IDS_PATH : null);

  // Load Cup-KO games
  let cupRows: GameRow[];
  if (resolvedPath && !useDeriveMode) {
    const ids = loadCupKnockoutGameIds(resolvedPath);
    console.log(`Loading ${ids.length} Cup-KO game IDs from ${resolvedPath}`);
    cupRows = loadCupKnockoutGamesByIds(ids);
  } else {
    console.log('Deriving Cup-KO games from specific Cup-KO dates...');
    cupRows = deriveCupKnockoutGames();
  }

  if (cupRows.length === 0) {
    console.error('ERROR: No Cup-knockout games found in DB.');
    console.error('Check that data/cup-knockout-game-ids.json is populated and the DB is current.');
    console.error('Expected game IDs: see data/cup-knockout-game-ids.json');
    process.exit(1);
  }

  if (cupRows.length < 5) {
    console.warn(`WARN: Only ${cupRows.length} Cup-KO games found (expected ~14). Power will be low.`);
  }

  console.log(`Found ${cupRows.length} Cup-KO games.`);

  // Load regular-season comparison games
  const cupIds = new Set(cupRows.map(r => r.game_id));
  const rsRows = loadComparisonGames(cupIds);
  console.log(`Found ${rsRows.length} regular-season comparison games (December, same seasons).`);

  if (rsRows.length < 10) {
    console.error(`ERROR: Only ${rsRows.length} regular-season comparison games. Need ≥10 for meaningful comparison.`);
    process.exit(1);
  }

  // Score Cup-KO games
  console.log('\nScoring Cup-KO games...');
  const cupGames: ScoredGame[] = [];
  for (const row of cupRows) {
    const { prob, brier } = scoreGame(row);
    cupGames.push({ ...row, prob, brier, group: 'cup_knockout' });
    console.log(`  ${row.game_id} ${row.date}: prob=${prob.toFixed(4)} brier=${brier.toFixed(4)}`);
  }

  // Score regular-season comparison games
  console.log('\nScoring regular-season comparison games...');
  const rsGames: ScoredGame[] = [];
  for (const row of rsRows) {
    const { prob, brier } = scoreGame(row);
    rsGames.push({ ...row, prob, brier, group: 'regular_season' });
  }
  console.log(`  Scored ${rsGames.length} games.`);

  // Compute Brier means
  const cupMeanBrier = mean(cupGames.map(g => g.brier));
  const rsMeanBrier = mean(rsGames.map(g => g.brier));

  // Bootstrap Δ Brier CI
  console.log(`\nBootstrapping Δ Brier CI (B=${bootstrapSamples})...`);
  const { deltaMean, ci95 } = bootstrapDeltaCI(
    cupGames.map(g => g.brier),
    rsGames.map(g => g.brier),
    bootstrapSamples,
  );

  const falsified = deltaMean > FALSIFICATION_THRESHOLD;

  console.log('\n--- Falsification Test Result ---');
  console.log(`Cup-KO mean Brier:  ${cupMeanBrier.toFixed(4)} (n=${cupGames.length})`);
  console.log(`RS mean Brier:      ${rsMeanBrier.toFixed(4)} (n=${rsGames.length})`);
  console.log(`Δ Brier:            ${deltaMean.toFixed(4)}`);
  console.log(`Bootstrap 95% CI:   [${ci95[0].toFixed(4)}, ${ci95[1].toFixed(4)}]`);
  console.log(`Threshold:          ${FALSIFICATION_THRESHOLD}`);
  console.log(`Verdict:            ${falsified ? 'FALSIFIED — option (b) drop REJECTED' : 'PASSES — option (b) drop acceptable'}`);

  const md = buildMarkdown(cupGames, rsGames, cupMeanBrier, rsMeanBrier, deltaMean, ci95, bootstrapSamples);
  const mdPath = join(REPO_ROOT, 'docs/cup-knockout-disposition-evidence.md');
  writeFileSync(mdPath, md);
  console.log(`\nWrote ${mdPath}`);

  if (falsified) {
    console.error('\nFAIL — Δ Brier exceeds falsification threshold. Do NOT drop Cup-knockout games from training tensor.');
    process.exit(1);
  } else {
    console.log('\nPASS — Δ Brier within threshold. Chosen disposition: option (b) drop.');
    process.exit(0);
  }
}

main();
