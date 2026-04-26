/**
 * Game-type asymmetry decision matrix.
 *
 * Reads data/bbref-convention-report.json (from validate-bbref-convention.ts)
 * and emits docs/phase-3-game-type-handling.md — the Phase-3-feature-engineering
 * decision matrix that every future TOV-related plan addendum must cite.
 *
 * Per addendum v11 §"Pre-flight tooling" #5: every disposition must cite
 *   (a) sample-N from the convention report
 *   (b) pm.6 evidence threshold met (≥2/stratum + ≥5 total + adversarial selection)
 *   (c) the dissenter's named falsification test (if any)
 * Without all three citations the disposition CANNOT be picked.
 *
 * Disposition logic (auto-applied when evidence is sufficient):
 *   - All validated games in stratum MATCH + ≥2 validated → accept-as-is
 *   - Any validated game MISMATCH → MISMATCH: requires named falsification test
 *   - Validated < 2 in stratum → UNDERPOPULATED: cannot decide
 *
 * pm.6 total-data check: ≥5 validated games ACROSS all strata is required
 * before any disposition can be finalized. Exits 1 if this bar is not met.
 *
 * Output: docs/phase-3-game-type-handling.md
 *
 * Run:
 *   npx tsx scripts/check-game-type-asymmetries.ts
 *   npx tsx scripts/check-game-type-asymmetries.ts --report data/bbref-convention-report.json
 *
 * Plan: Plans/nba-learned-model.md addendum v11 §"Pre-flight tooling" #5 (pm.2).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');

const PM6_MIN_PER_STRATUM = 2;
const PM6_MIN_TOTAL = 5;

// Known falsification tests per stratum (from addendum v11 council record).
// Strata not listed here have no named falsification test on record.
const NAMED_FALSIFICATION_TESTS: Record<string, string> = {
  cup_knockout:
    'v5-on-Cup-KO vs v5-on-regular-season-same-month Brier comparison; ' +
    'reject (b) drop if Δ Brier > 0.02. ' +
    'Run scripts/falsify-cup-knockout-disposition.ts; cite docs/cup-knockout-disposition-evidence.md.',
};

// --- Types (mirrors validate-bbref-convention.ts output) ---

interface StratumSummary {
  stratum: string;
  total_entries: number;
  matched: number;
  mismatched: number;
  db_missing: number;
  todo_skipped: number;
  errors: number;
}

interface Report {
  generated_at: string;
  strata_summary: StratumSummary[];
  overall: {
    strata_with_min_2_matches: number;
    strata_total: number;
    strata_with_insufficient_data: string[];
  };
}

type Disposition = 'accept-as-is' | 'mismatch-detected' | 'underpopulated' | 'no-data';

interface StratumDecision {
  stratum: string;
  validated: number;
  matched: number;
  mismatched: number;
  pm6_stratum_met: boolean;
  disposition: Disposition;
  falsification_test: string | null;
  notes: string[];
}

function decide(s: StratumSummary): StratumDecision {
  const validated = s.matched + s.mismatched;
  const pm6_stratum_met = validated >= PM6_MIN_PER_STRATUM;
  const notes: string[] = [];

  let disposition: Disposition;

  if (validated === 0 && s.todo_skipped === s.total_entries) {
    disposition = 'no-data';
    notes.push('All entries are TODO — populate manifest before deciding.');
  } else if (!pm6_stratum_met) {
    disposition = 'underpopulated';
    notes.push(`Validated games: ${validated} (need ≥${PM6_MIN_PER_STRATUM} per pm.6).`);
    if (s.todo_skipped > 0) {
      notes.push(`${s.todo_skipped} manifest entries still TODO — run DB queries in manifest note field.`);
    }
    if (s.db_missing > 0) {
      notes.push(`${s.db_missing} games not in DB — may indicate coverage gap.`);
    }
  } else if (s.mismatched > 0) {
    disposition = 'mismatch-detected';
    notes.push(`${s.mismatched} games show bbref TOV ≠ ESPN tov. Requires falsification test before finalizing disposition.`);
    if (NAMED_FALSIFICATION_TESTS[s.stratum]) {
      notes.push(`Named falsification test on record (see below).`);
    } else {
      notes.push('No named falsification test on record — must name one before R2 reversal.');
    }
  } else {
    disposition = 'accept-as-is';
    notes.push(`All ${validated} validated games match (bbref Tm TOV == ESPN tov).`);
    notes.push(`Adversarial selection: populate bbref-convention-manifest.json with at least 1 per-stratum entry chosen adversarially (not just confirming games).`);
  }

  return {
    stratum: s.stratum,
    validated,
    matched: s.matched,
    mismatched: s.mismatched,
    pm6_stratum_met,
    disposition,
    falsification_test: NAMED_FALSIFICATION_TESTS[s.stratum] ?? null,
    notes,
  };
}

function dispositionLabel(d: Disposition): string {
  switch (d) {
    case 'accept-as-is': return '✓ accept-as-is';
    case 'mismatch-detected': return '✗ MISMATCH — requires falsification test';
    case 'underpopulated': return '⚠ UNDERPOPULATED — cannot decide';
    case 'no-data': return '— NO DATA';
  }
}

function buildMarkdown(
  report: Report,
  decisions: StratumDecision[],
  totalValidated: number,
  pm6TotalMet: boolean,
): string {
  const lines: string[] = [
    '# Phase-3 Game-Type Handling Decision Matrix',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Convention report: ${report.generated_at}`,
    '',
    '## pm.6 evidence bar',
    '',
    `- **≥${PM6_MIN_PER_STRATUM} validated games per stratum**: required per pm.6(a)`,
    `- **≥${PM6_MIN_TOTAL} total validated games**: required per pm.6(b)`,
    `- **Adversarial selection**: ≥1 per stratum chosen by dissenting expert, not proponent — required per pm.6(c)`,
    `- **Named falsification test**: required per pm.5/pm.6(d) for any stratum with mismatches`,
    '',
    `Total validated across all strata: **${totalValidated}** (need ≥${PM6_MIN_TOTAL}: ${pm6TotalMet ? '✓ MET' : '✗ NOT MET'})`,
    '',
    '## Decision matrix',
    '',
    '| Stratum | Validated | Matched | Mismatch | pm.6(a) | Disposition |',
    '|---|---|---|---|---|---|',
    ...decisions.map(d =>
      `| ${d.stratum} | ${d.validated} | ${d.matched} | ${d.mismatched} | ${d.pm6_stratum_met ? '✓' : '✗'} | ${dispositionLabel(d.disposition)} |`
    ),
    '',
    '## Per-stratum details',
    '',
  ];

  for (const d of decisions) {
    lines.push(`### ${d.stratum}`);
    lines.push('');
    lines.push(`**Disposition**: ${dispositionLabel(d.disposition)}`);
    lines.push('');
    for (const note of d.notes) {
      lines.push(`- ${note}`);
    }
    if (d.falsification_test) {
      lines.push('');
      lines.push('**Named falsification test (pm.5):**');
      lines.push('');
      lines.push(`> ${d.falsification_test}`);
    }
    lines.push('');
  }

  lines.push('## Action items before Phase 3 model code', '');

  const actionItems: string[] = [];

  if (!pm6TotalMet) {
    actionItems.push(
      `**BLOCKING**: total validated games = ${totalValidated} < ${PM6_MIN_TOTAL} (pm.6(b)). ` +
      'Populate manifest entries and re-run validate-bbref-convention.ts.'
    );
  }

  for (const d of decisions) {
    if (d.disposition === 'underpopulated') {
      actionItems.push(
        `Populate manifest for **${d.stratum}** (currently ${d.validated} validated, need ≥${PM6_MIN_PER_STRATUM}).`
      );
    } else if (d.disposition === 'mismatch-detected') {
      actionItems.push(
        `Run falsification test for **${d.stratum}** (mismatch detected). See named test above.`
      );
    } else if (d.disposition === 'no-data') {
      actionItems.push(
        `Populate manifest for **${d.stratum}** (no data at all — all entries are TODO).`
      );
    }
  }

  if (actionItems.length === 0) {
    lines.push('All strata are decided. Decision matrix is complete.');
  } else {
    for (const item of actionItems) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('');
  lines.push('## Cross-references');
  lines.push('');
  lines.push('- Convention report: `data/bbref-convention-report.json`');
  lines.push('- Manifest: `data/bbref-convention-manifest.json`');
  lines.push('- Cup-KO falsification evidence: `docs/cup-knockout-disposition-evidence.md`');
  lines.push('- Plan: Plans/nba-learned-model.md addendum v11 §"Pre-flight tooling" #5');

  return lines.join('\n') + '\n';
}

function main(): void {
  const argv = process.argv.slice(2);
  let reportPath = join(REPO_ROOT, 'data/bbref-convention-report.json');

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--report') reportPath = argv[++i];
  }

  if (!existsSync(reportPath)) {
    console.error(`Convention report not found: ${reportPath}`);
    console.error('Run validate-bbref-convention.ts first to generate it.');
    process.exit(1);
  }

  const report: Report = JSON.parse(readFileSync(reportPath, 'utf8'));

  console.log(`Loaded convention report from ${reportPath} (generated ${report.generated_at})`);

  const decisions = report.strata_summary.map(s => decide(s));
  const totalValidated = decisions.reduce((n, d) => n + d.validated, 0);
  const pm6TotalMet = totalValidated >= PM6_MIN_TOTAL;

  console.log(`\nTotal validated games across all strata: ${totalValidated}`);
  console.log(`pm.6(b) total bar (≥${PM6_MIN_TOTAL}): ${pm6TotalMet ? 'MET' : 'NOT MET'}`);

  for (const d of decisions) {
    const icon = d.disposition === 'accept-as-is' ? '✓' :
                 d.disposition === 'underpopulated' ? '⚠' :
                 d.disposition === 'no-data' ? '—' : '✗';
    console.log(`  [${icon}] ${d.stratum}: ${d.validated} validated, disposition=${d.disposition}`);
  }

  mkdirSync(join(REPO_ROOT, 'docs'), { recursive: true });
  const md = buildMarkdown(report, decisions, totalValidated, pm6TotalMet);
  const mdPath = join(REPO_ROOT, 'docs/phase-3-game-type-handling.md');
  writeFileSync(mdPath, md);
  console.log(`\nWrote ${mdPath}`);

  const actionRequired = decisions.some(
    d => d.disposition === 'underpopulated' || d.disposition === 'mismatch-detected' || d.disposition === 'no-data'
  );

  if (!pm6TotalMet) {
    console.error(`\nFAIL — pm.6(b) not met: total validated ${totalValidated} < ${PM6_MIN_TOTAL}.`);
    console.error('Populate manifest entries and re-run validate-bbref-convention.ts.');
    process.exit(1);
  }

  if (actionRequired) {
    console.warn('\nWARN — some strata require action before Phase 3 model code can proceed.');
    console.warn('See docs/phase-3-game-type-handling.md for details.');
    process.exit(1);
  }

  console.log('\nAll strata decided. Decision matrix is complete and ready for council impl-review.');
  process.exit(0);
}

main();
