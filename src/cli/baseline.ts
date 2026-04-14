/**
 * CLI: compute the per-sport baseline report and write it to disk.
 *
 * Usage:
 *   npx tsx src/cli/baseline.ts
 *
 * Outputs:
 *   - stdout: human-readable table
 *   - data/baselines/baseline-<YYYY-MM-DD>.json: machine-readable artifact
 *   - data/baselines/baseline-<YYYY-MM-DD>.txt: frozen copy of the table
 *
 * Closes council debt #13 (session_state.json). See src/analysis/baseline.ts
 * for methodology and honest-disclosure notes.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDb } from '../storage/sqlite.js';
import { computeBaseline, renderReport } from '../analysis/baseline.js';

function main(): void {
  const report = computeBaseline();
  const text = renderReport(report);
  console.log(text);

  const outDir = process.env.BASELINE_OUT_DIR ?? 'data/baselines';
  mkdirSync(outDir, { recursive: true });
  const date = report.generatedAt.slice(0, 10);
  const jsonPath = join(outDir, `baseline-${date}.json`);
  const txtPath = join(outDir, `baseline-${date}.txt`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(txtPath, text);
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${txtPath}`);

  closeDb();
}

main();
