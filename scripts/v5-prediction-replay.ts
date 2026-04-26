/**
 * v5 prediction-replay regression harness.
 *
 * Reads a fixed set of input fixtures from data/v5-replay-fixtures.json,
 * runs the v5 prediction code path, and asserts byte-for-byte output match
 * against committed expected outputs in data/v5-replay-expected.json.
 *
 * Byte-for-byte tolerance is intentional: v5 is a deterministic sigmoid in
 * TypeScript. Any non-zero diff triggers root-cause investigation, not
 * threshold-relaxation. See Plans/nba-learned-model.md addendum v11
 * §"Pre-flight tooling" #2.
 *
 * Run:
 *   npx tsx scripts/v5-prediction-replay.ts             # verify (requires expected.json)
 *   npx tsx scripts/v5-prediction-replay.ts --capture   # generate expected.json from current code
 *   npx tsx scripts/v5-prediction-replay.ts --fixtures path/to/fixtures.json
 *   npx tsx scripts/v5-prediction-replay.ts --expected path/to/expected.json
 *
 * --capture mode: run once on initial setup (Phase 3 step 2), then commit
 * data/v5-replay-expected.json. Subsequent runs verify against those values.
 * Never run --capture after Phase 3 model-affecting commits — that defeats
 * the purpose.
 *
 * Exits 0 on PASS, 1 on FAIL.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v5, predictWithInjuries } from '../src/analysis/predict.js';
import type { GameForPrediction, PredictionContext, InjuryImpact } from '../src/analysis/predict.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');

const DEFAULT_FIXTURES_PATH = join(REPO_ROOT, 'data/v5-replay-fixtures.json');
const DEFAULT_EXPECTED_PATH = join(REPO_ROOT, 'data/v5-replay-expected.json');

// --- Types ---

interface Fixture {
  id: string;
  description: string;
  game: GameForPrediction;
  ctx: PredictionContext;
  injuries: InjuryImpact | null;
}

interface ExpectedEntry {
  id: string;
  prob: number;
}

type ExpectedMap = Record<string, number>;

// --- Run a single fixture ---

function runFixture(fixture: Fixture): number {
  if (fixture.injuries) {
    return predictWithInjuries(fixture.game, fixture.ctx, fixture.injuries);
  }
  return v5.predict(fixture.game, fixture.ctx);
}

// --- Main ---

function main(): void {
  const argv = process.argv.slice(2);
  let fixturesPath = DEFAULT_FIXTURES_PATH;
  let expectedPath = DEFAULT_EXPECTED_PATH;
  let captureMode = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--capture') captureMode = true;
    else if (argv[i] === '--fixtures') fixturesPath = argv[++i];
    else if (argv[i] === '--expected') expectedPath = argv[++i];
  }

  if (!existsSync(fixturesPath)) {
    console.error(`Fixtures file not found: ${fixturesPath}`);
    process.exit(1);
  }

  const fixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, 'utf8'));

  if (captureMode) {
    // Generate expected.json from current code
    const entries: ExpectedEntry[] = fixtures.map(f => ({
      id: f.id,
      prob: runFixture(f),
    }));
    const output = JSON.stringify(entries, null, 2) + '\n';
    writeFileSync(expectedPath, output);
    console.log(`[capture] wrote ${entries.length} expected outputs to ${expectedPath}`);
    for (const e of entries) {
      console.log(`  ${e.id}: ${e.prob}`);
    }
    process.exit(0);
  }

  // Verify mode
  if (!existsSync(expectedPath)) {
    console.error(`Expected file not found: ${expectedPath}`);
    console.error('Run with --capture first to generate it, then commit data/v5-replay-expected.json');
    process.exit(1);
  }

  const expectedEntries: ExpectedEntry[] = JSON.parse(readFileSync(expectedPath, 'utf8'));
  const expected: ExpectedMap = {};
  for (const e of expectedEntries) {
    expected[e.id] = e.prob;
  }

  let pass = 0;
  let fail = 0;
  const failures: string[] = [];

  for (const fixture of fixtures) {
    if (!(fixture.id in expected)) {
      console.warn(`  WARN  ${fixture.id}: not in expected.json (run --capture to add)`);
      continue;
    }

    const actual = runFixture(fixture);
    const expectedProb = expected[fixture.id];

    if (actual === expectedProb) {
      console.log(`  PASS  ${fixture.id}: ${actual}`);
      pass++;
    } else {
      console.error(`  FAIL  ${fixture.id}: expected ${expectedProb}, got ${actual}`);
      console.error(`        diff: ${actual - expectedProb}`);
      console.error(`        description: ${fixture.description}`);
      failures.push(fixture.id);
      fail++;
    }
  }

  // Check for expected entries with no matching fixture (fixture was deleted)
  for (const id of Object.keys(expected)) {
    if (!fixtures.find(f => f.id === id)) {
      console.warn(`  WARN  ${id}: in expected.json but not in fixtures (fixture deleted?)`);
    }
  }

  console.log(`\nResult: ${pass} PASS, ${fail} FAIL`);
  if (fail > 0) {
    console.error('FAIL — v5 prediction code path has changed. Investigate before proceeding with Phase 3.');
    console.error('Failing fixtures: ' + failures.join(', '));
    process.exit(1);
  } else {
    console.log('PASS — v5 prediction replay verified byte-for-byte.');
    process.exit(0);
  }
}

main();
