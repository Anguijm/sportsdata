/**
 * CLI: compute per-sport reliability diagrams from the baseline replay.
 *
 * Usage:
 *   npx tsx src/cli/reliability.ts
 *   npm run reliability
 *
 * Outputs:
 *   - stdout: human-readable per-sport blocks
 *   - data/reliability/reliability-<YYYY-MM-DD>.json: machine-readable artifact
 *   - data/reliability/reliability-<YYYY-MM-DD>.txt: frozen copy of the text
 *
 * Runs the inline self-check first (ship rule 3): if the hand-computed
 * ECE / weightedMAE values don't match, aborts without writing the artifact.
 *
 * See Plans/reliability-diagrams.md for the council-validated spec.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDb } from '../storage/sqlite.js';
import {
  computeReliabilityReport,
  renderReliabilityReport,
  __selfCheck,
} from '../analysis/reliability.js';

async function main(): Promise<void> {
  // Ship rule 3: hand-computed example must match before writing.
  const check = __selfCheck();
  if (!check.pass) {
    console.error(`[reliability] self-check FAILED: ${check.reason}`);
    process.exitCode = 1;
    closeDb();
    return;
  }

  const report = await computeReliabilityReport();
  const text = renderReliabilityReport(report);
  console.log(text);

  const outDir = process.env.RELIABILITY_OUT_DIR ?? 'data/reliability';
  mkdirSync(outDir, { recursive: true });
  const date = report.generatedAt.slice(0, 10);
  const jsonPath = join(outDir, `reliability-${date}.json`);
  const txtPath = join(outDir, `reliability-${date}.txt`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(txtPath, text);
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${txtPath}`);

  closeDb();
}

void main();
