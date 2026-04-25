/**
 * Cross-source audit: compare our scraped ESPN box-stats vs. manually-
 * curated basketball-reference values. Per Phase 2 §item 6.
 *
 * Plan: `Plans/nba-phase2-backfill.md` §Component 5.
 *
 * Tolerance per Pred #1 + Math #2:
 *  - Raw counts: exact match (0 tolerance).
 *  - Derived rates: compared to bbref's published Four-Factors values
 *    (eFG%, TOV%, ORtg, Pace), tolerance 1%. `expected === 0` requires
 *    `actual === 0` exactly (NaN-prevention guard).
 *
 * Pass-A1 (this PR): script mechanics + empty ground-truth file (`[]`).
 *   bbref blocks programmatic fetch; ground truth requires manual
 *   browser curation. Audit reports N=0 and exits cleanly.
 *
 * Pass-A2 (follow-up): hand-curate 5 seed entries from bbref browser
 *   visits. Validates the cross-source pipeline at a smoke-test level.
 *
 * Pass-B (ship-claim blocker per addendum v7 §10): expand to 50 entries.
 *
 * Run:
 *   npx tsx scripts/audit-espn-box-stats.ts [--out PATH]
 *
 * Default output: `docs/espn-bbref-audit.md`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb, closeDb } from '../src/storage/sqlite.js';

const RAW_FIELDS = ['fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'oreb', 'dreb', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pts'] as const;
type RawField = typeof RAW_FIELDS[number];
const RATE_FIELDS = ['efg_pct', 'tov_pct', 'ortg', 'pace'] as const;
type RateField = typeof RATE_FIELDS[number];

interface GroundTruthEntry {
  game_id: string;
  bbref_url: string;
  season_label: string;
  home_team_id: string;
  away_team_id: string;
  home_raw_counts: Record<RawField, number>;
  away_raw_counts: Record<RawField, number>;
  home_published_rates?: Partial<Record<RateField, number | null>>;
  away_published_rates?: Partial<Record<RateField, number | null>>;
}

interface BoxStatsRow {
  game_id: string;
  team_id: string;
  fga: number; fgm: number; fg3a: number; fg3m: number; fta: number; ftm: number;
  oreb: number; dreb: number; reb: number;
  ast: number; stl: number; blk: number; tov: number; pf: number;
  pts: number; minutes_played: number; possessions: number;
}

interface FieldDiff {
  field: string;
  team: 'home' | 'away';
  expected: number | null;
  actual: number | null;
  tolerance: 'exact' | '1pct';
  pass: boolean;
  detail?: string;
}

function compareRaw(field: RawField, team: 'home' | 'away', expected: number, actual: number): FieldDiff {
  return {
    field, team, expected, actual, tolerance: 'exact',
    pass: actual === expected,
    detail: actual === expected ? undefined : `Δ=${actual - expected}`,
  };
}

function compareRate(field: RateField, team: 'home' | 'away', expected: number | null | undefined, actual: number): FieldDiff {
  if (expected === null || expected === undefined) {
    return { field, team, expected: null, actual, tolerance: '1pct', pass: true, detail: 'expected=null (no bbref ground-truth)' };
  }
  if (expected === 0) {
    return { field, team, expected, actual, tolerance: '1pct', pass: actual === 0, detail: actual === 0 ? undefined : 'expected=0 requires actual=0 exactly' };
  }
  const relErr = Math.abs(actual - expected) / Math.abs(expected);
  return {
    field, team, expected, actual, tolerance: '1pct',
    pass: relErr <= 0.01,
    detail: relErr <= 0.01 ? undefined : `relErr=${(relErr * 100).toFixed(3)}% > 1%`,
  };
}

// bbref glossary verified 2026-04-26 per
// https://www.basketball-reference.com/about/glossary.html
//
//   Pace = 48 * ((Tm Poss + Opp Poss) / (2 * (Tm MP / 5)))
//   Poss = 0.5 * ((Tm FGA + 0.4 * Tm FTA
//                 - 1.07 * (Tm ORB / (Tm ORB + Opp DRB)) * (Tm FGA - Tm FG)
//                 + Tm TOV)
//                + (Opp FGA + 0.4 * Opp FTA
//                 - 1.07 * (Opp ORB / (Opp ORB + Tm DRB)) * (Opp FGA - Opp FGM)
//                 + Opp TOV))
//
// We pin this formula in the audit (not in our schema's possessions column) so
// the audit's ortg/pace comparison matches bbref's published rates without
// coupling our schema to bbref's idiosyncratic estimator. Per Phase 2 plan
// addendum v9 (decision C′).
function bbrefTeamPossContribution(tm: BoxStatsRow, oppDreb: number): number {
  // Edge-case guards per addendum: zero-OREB+DREB → drop the rebound term;
  // zero-FGA → fall back to FT and TOV terms only.
  const orebDenom = tm.oreb + oppDreb;
  const orebRate = orebDenom > 0 ? tm.oreb / orebDenom : 0;
  const missedShots = Math.max(0, tm.fga - tm.fgm);
  if (tm.fga === 0) return 0.4 * tm.fta + tm.tov;
  return tm.fga + 0.4 * tm.fta - 1.07 * orebRate * missedShots + tm.tov;
}

function bbrefPossessions(home: BoxStatsRow, away: BoxStatsRow): number {
  const homeContrib = bbrefTeamPossContribution(home, away.dreb);
  const awayContrib = bbrefTeamPossContribution(away, home.dreb);
  return 0.5 * (homeContrib + awayContrib);
}

// bbref's Pace divisor is canonical team-minutes (5 × game-length: 240 for
// regulation, 240+25·n for n OT periods). ESPN's per-team minutes_played sums
// player minutes from boxscore.statistics and occasionally drifts 1-3 minutes
// for substitution/ejection edge cases. Round avg(home_mp, away_mp) to the
// nearest valid game length so pace matches bbref's convention. Per Phase 2
// addendum v9.1.
function canonicalTeamMinutes(home: BoxStatsRow, away: BoxStatsRow): number {
  const avgMp = (home.minutes_played + away.minutes_played) / 2;
  const otCount = Math.max(0, Math.round((avgMp - 240) / 25));
  const canonical = 240 + 25 * otCount;
  if (canonical < 240 || canonical > 340) return avgMp;
  return canonical;
}

function computeRates(row: BoxStatsRow, gamePoss: number, canonicalMp: number): Record<RateField, number> {
  // eFG% and TOV% use formulas our code shares with bbref; computed from raw
  // counts only, no possessions dependency.
  const efg = row.fga > 0 ? (row.fgm + 0.5 * row.fg3m) / row.fga : 0;
  const denomTov = row.fga + 0.44 * row.fta + row.tov;
  const tovPct = denomTov > 0 ? row.tov / denomTov : 0;
  // ORtg + Pace use bbref's averaged game-level possessions and canonical
  // team-minutes. This matches what bbref publishes for both teams in a game.
  const ortg = gamePoss > 0 ? (100 * row.pts) / gamePoss : 0;
  const minOnFloor = canonicalMp / 5;
  const pace = minOnFloor > 0 ? (48 * gamePoss) / minOnFloor : 0;
  return { efg_pct: efg, tov_pct: tovPct, ortg, pace };
}

function loadGroundTruth(path: string): GroundTruthEntry[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as GroundTruthEntry[];
  return raw;
}

function loadBoxStats(db: ReturnType<typeof getDb>, gameId: string): { home: BoxStatsRow; away: BoxStatsRow } | null {
  const rows = db.prepare(`SELECT * FROM nba_game_box_stats WHERE game_id = ?`).all(gameId) as BoxStatsRow[];
  if (rows.length !== 2) return null;
  return { home: rows[0], away: rows[1] };
}

function pickSide(rows: { home: BoxStatsRow; away: BoxStatsRow }, teamId: string): BoxStatsRow | null {
  if (rows.home.team_id === teamId) return rows.home;
  if (rows.away.team_id === teamId) return rows.away;
  return null;
}

function audit(entry: GroundTruthEntry, rows: { home: BoxStatsRow; away: BoxStatsRow }): { diffs: FieldDiff[]; rawFailures: number; rateFailures: number; rateSkipped: number } {
  const diffs: FieldDiff[] = [];
  // Game-level possessions + canonical team-minutes per bbref convention —
  // one value shared by both teams.
  const gamePoss = bbrefPossessions(rows.home, rows.away);
  const canonicalMp = canonicalTeamMinutes(rows.home, rows.away);
  for (const sideName of ['home', 'away'] as const) {
    const teamId = sideName === 'home' ? entry.home_team_id : entry.away_team_id;
    const expectedRaw = sideName === 'home' ? entry.home_raw_counts : entry.away_raw_counts;
    const expectedRates = sideName === 'home' ? entry.home_published_rates : entry.away_published_rates;
    const actualRow = pickSide(rows, teamId);
    if (!actualRow) {
      diffs.push({ field: 'team_id', team: sideName, expected: null, actual: null, tolerance: 'exact', pass: false, detail: `team ${teamId} missing from nba_game_box_stats` });
      continue;
    }
    for (const f of RAW_FIELDS) {
      const exp = expectedRaw[f];
      const act = actualRow[f as keyof BoxStatsRow] as number;
      diffs.push(compareRaw(f, sideName, exp, act));
    }
    const actualRates = computeRates(actualRow, gamePoss, canonicalMp);
    for (const f of RATE_FIELDS) {
      const exp = expectedRates?.[f];
      diffs.push(compareRate(f, sideName, exp, actualRates[f]));
    }
  }
  const rawFailures = diffs.filter(d => d.tolerance === 'exact' && !d.pass).length;
  const rateFailures = diffs.filter(d => d.tolerance === '1pct' && !d.pass).length;
  const rateSkipped = diffs.filter(d => d.tolerance === '1pct' && d.pass && d.detail?.includes('expected=null')).length;
  return { diffs, rawFailures, rateFailures, rateSkipped };
}

function main(): void {
  const argv = process.argv.slice(2);
  let outPath = 'docs/espn-bbref-audit.md';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') outPath = argv[++i];
  }
  const truthPath = 'data/espn-bbref-audit-truth.json';
  const truth = loadGroundTruth(truthPath);
  const db = getDb();

  const lines: string[] = [];
  lines.push(`# ESPN ↔ basketball-reference audit`);
  lines.push('');
  lines.push(`Run timestamp: ${new Date().toISOString()}`);
  lines.push(`Ground-truth file: \`${truthPath}\``);
  lines.push(`Sample size N: ${truth.length}`);
  lines.push('');

  if (truth.length === 0) {
    lines.push('## No ground-truth entries');
    lines.push('');
    lines.push('Pass-A1 status: script mechanics committed, ground-truth file is empty.');
    lines.push('');
    lines.push('To populate Pass-A2 (5 seed entries):');
    lines.push('1. Visit a basketball-reference box score (e.g. https://www.basketball-reference.com/boxscores/202412170OKC.html for the 2024-25 NBA Cup final).');
    lines.push('2. Copy team-level raw counts (FGM/FGA/3PM/3PA/FTM/FTA/ORB/DRB/TRB/AST/STL/BLK/TOV/PF/PTS) for both teams.');
    lines.push('3. Copy "Four Factors" rates (eFG%, TOV%, ORtg, Pace) for both teams.');
    lines.push(`4. Append to \`${truthPath}\` as a JSON object matching the GroundTruthEntry shape (see scripts/audit-espn-box-stats.ts).`);
    lines.push('5. Re-run this script.');
    lines.push('');
    lines.push('Per addendum v7 §10 + addendum v8: Pass-A2 is informational; Pass-B (N=50) is the ship-claim blocker.');
    writeFileSync(outPath, lines.join('\n') + '\n');
    console.log(`[audit] N=0; wrote stub report to ${outPath}`);
    closeDb();
    return;
  }

  let totalRawFailures = 0;
  let totalRateFailures = 0;
  let totalRateSkipped = 0;
  let entriesWithMissingRows = 0;

  lines.push('## Per-game results');
  lines.push('');

  for (const entry of truth) {
    lines.push(`### ${entry.game_id} — ${entry.away_team_id} @ ${entry.home_team_id} (${entry.season_label})`);
    lines.push('');
    lines.push(`bbref: ${entry.bbref_url}`);
    lines.push('');
    const rows = loadBoxStats(db, entry.game_id);
    if (!rows) {
      lines.push(`**SKIPPED**: ${entry.game_id} not present in \`nba_game_box_stats\` (run backfill first).`);
      lines.push('');
      entriesWithMissingRows++;
      continue;
    }
    const { diffs, rawFailures, rateFailures, rateSkipped } = audit(entry, rows);
    totalRawFailures += rawFailures;
    totalRateFailures += rateFailures;
    totalRateSkipped += rateSkipped;
    lines.push(`raw count failures: ${rawFailures}; derived rate failures: ${rateFailures}; rates skipped (no bbref ground-truth): ${rateSkipped}`);
    lines.push('');
    if (rawFailures + rateFailures === 0) {
      lines.push('All fields within tolerance. ✓');
    } else {
      lines.push('| field | team | expected | actual | tol | detail |');
      lines.push('|-------|------|----------|--------|-----|--------|');
      for (const d of diffs.filter(x => !x.pass)) {
        lines.push(`| ${d.field} | ${d.team} | ${d.expected} | ${d.actual} | ${d.tolerance} | ${d.detail ?? ''} |`);
      }
    }
    lines.push('');
  }

  lines.push('## Aggregate');
  lines.push('');
  lines.push(`Entries audited: ${truth.length - entriesWithMissingRows} / ${truth.length}`);
  lines.push(`Skipped (missing nba_game_box_stats row): ${entriesWithMissingRows}`);
  lines.push(`Total raw count failures: ${totalRawFailures}`);
  lines.push(`Total derived rate failures: ${totalRateFailures}`);
  lines.push(`Total rates skipped (no ground-truth): ${totalRateSkipped}`);
  lines.push('');
  lines.push('## Disposition');
  lines.push('');
  if (truth.length < 50) {
    lines.push(`Pass-A (informational, N=${truth.length}). Phase-2 ship rule 5 requires Pass-B (N≥50). Not yet ship-claim-eligible.`);
  } else {
    // Pass-B requires: full N≥50 ground-truth, every entry actually audited
    // (no missing rows), zero raw-count failures, zero rate failures.
    // Skipped entries are coverage holes — they cannot be silently passed.
    const passB = totalRawFailures === 0 && totalRateFailures === 0 && entriesWithMissingRows === 0;
    const reasons: string[] = [];
    if (entriesWithMissingRows > 0) reasons.push(`${entriesWithMissingRows} entries missing from nba_game_box_stats`);
    if (totalRawFailures > 0) reasons.push(`${totalRawFailures} raw-count failures`);
    if (totalRateFailures > 0) reasons.push(`${totalRateFailures} derived-rate failures`);
    lines.push(`Pass-B candidate (N=${truth.length}). Status: ${passB ? '**PASS**' : `**FAIL** — ${reasons.join('; ')}`}.`);
  }

  writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`[audit] N=${truth.length}; wrote ${outPath}`);
  closeDb();
}

main();
