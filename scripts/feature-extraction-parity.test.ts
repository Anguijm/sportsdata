/**
 * Python ↔ TypeScript feature-extraction parity test.
 *
 * Materializes a fixed fixture set of training rows
 * (data/feature-parity-fixtures.json), runs Python feature extraction
 * (ml/nba/features.py) and TS feature extraction (src/ml/features.ts) on
 * the same fixtures, and asserts bit-identical output tensors.
 *
 * Catches train/serve skew BEFORE it reaches the test fold. A formula
 * divergence between Python training and TS inference silently degrades
 * test-fold predictions; this harness catches it pre-shadow.
 *
 * Per addendum v11 §"Pre-flight tooling" #6 (Stats R1 fix-pack #3).
 *
 * Prerequisites (Phase 3 step 4 — not yet met):
 *   - ml/nba/features.py  — Python training feature extractor
 *       Interface: python ml/nba/features.py --fixtures <path> --output <path>
 *       Output: JSON object mapping fixture id → number[] (feature vector)
 *   - src/ml/features.ts  — TS inference feature extractor
 *       Interface: export function extractFeatures(fixture: FeatureFixture): FeatureVector
 *   - data/feature-parity-fixtures.json with populated fixtures array
 *
 * Run:
 *   npx tsx scripts/feature-extraction-parity.test.ts             # parity check
 *   npx tsx scripts/feature-extraction-parity.test.ts --capture   # generate expected from TS path
 *   npx tsx scripts/feature-extraction-parity.test.ts --list-interface  # print expected Python API
 *
 * Exits 0 on PASS, 1 on FAIL or prerequisites missing.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');

const FIXTURES_PATH = join(REPO_ROOT, 'data/feature-parity-fixtures.json');
const EXPECTED_PATH = join(REPO_ROOT, 'data/feature-parity-expected.json');
const PYTHON_FEATURES = join(REPO_ROOT, 'ml/nba/features.py');
const TS_FEATURES = join(REPO_ROOT, 'src/ml/features.ts');
const TS_FEATURES_JS = join(REPO_ROOT, 'src/ml/features.js');

// --- Types ---

interface BoxStatRow {
  game_id: string;
  team_id: string;
  date: string;
  fga: number;
  fgm: number;
  fg3a: number;
  fg3m: number;
  fta: number;
  ftm: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  pts: number;
  possessions: number;
  team_tov: number | null;
}

export interface FeatureFixture {
  id: string;
  description?: string;
  inputs: {
    game_id: string;
    date: string;
    home_team_id: string;
    away_team_id: string;
    home_win: number;
    season: string;
    as_of_date: string;
    home_rolling_games: BoxStatRow[];
    away_rolling_games: BoxStatRow[];
  };
}

export type FeatureVector = number[];

type ExpectedMap = Record<string, FeatureVector>;

interface FixtureFile {
  _note?: string;
  _phase?: string;
  fixtures: FeatureFixture[];
}

// --- List interface mode ---

function listInterface(): void {
  console.log('=== Feature extraction parity test — required interface ===');
  console.log('');
  console.log('Python (ml/nba/features.py):');
  console.log('  python ml/nba/features.py --fixtures <path> --output <path>');
  console.log('  Input:  JSON file conforming to data/feature-parity-fixtures.json schema');
  console.log('  Output: JSON object { "<fixture_id>": [<f1>, <f2>, ...], ... }');
  console.log('  Exit 0 on success, non-zero on error.');
  console.log('');
  console.log('TypeScript (src/ml/features.ts):');
  console.log('  export function extractFeatures(fixture: FeatureFixture): FeatureVector;');
  console.log('  where FeatureFixture is imported from scripts/feature-extraction-parity.test.ts');
  console.log('  and FeatureVector = number[]');
  console.log('');
  console.log('Both paths must produce bit-identical number[] for the same fixture inputs.');
  console.log('Tolerance: exact equality (no epsilon). Floating-point divergence = formula divergence.');
  console.log('');
  console.log('Fixture file: data/feature-parity-fixtures.json');
  console.log('See _schema_version, _input_schema, _box_stat_row_schema keys for field docs.');
}

// --- Run Python extraction ---

function runPython(fixturesPath: string): ExpectedMap {
  const tmpOut = join(REPO_ROOT, 'data/.feature-parity-python-tmp.json');
  const result = spawnSync(
    'python',
    [PYTHON_FEATURES, '--fixtures', fixturesPath, '--output', tmpOut],
    { encoding: 'utf8', cwd: REPO_ROOT }
  );
  if (result.status !== 0) {
    console.error('Python feature extraction failed:');
    console.error(result.stderr);
    process.exit(1);
  }
  const output: ExpectedMap = JSON.parse(readFileSync(tmpOut, 'utf8'));
  return output;
}

// --- Main ---

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let captureMode = false;
  let listInterfaceMode = false;

  for (const arg of argv) {
    if (arg === '--capture') captureMode = true;
    if (arg === '--list-interface') listInterfaceMode = true;
  }

  if (listInterfaceMode) {
    listInterface();
    process.exit(0);
  }

  // Load fixtures
  if (!existsSync(FIXTURES_PATH)) {
    console.error(`Fixtures file not found: ${FIXTURES_PATH}`);
    process.exit(1);
  }

  const fixtureFile: FixtureFile = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8'));
  const fixtures = fixtureFile.fixtures;

  if (fixtures.length === 0) {
    console.error('PHASE 3 NOT YET IMPLEMENTED — data/feature-parity-fixtures.json has no fixtures.');
    console.error('');
    console.error('This test becomes runnable in Phase 3 step 4 (feature engineering pipeline).');
    console.error('Steps to activate:');
    console.error('  1. Implement ml/nba/features.py (python feature extractor)');
    console.error('  2. Implement src/ml/features.ts (TS feature extractor)');
    console.error('  3. Populate data/feature-parity-fixtures.json with real game fixtures');
    console.error('  4. Run with --capture to generate data/feature-parity-expected.json');
    console.error('  5. Commit both files; subsequent runs verify parity without --capture');
    console.error('');
    console.error('Run with --list-interface to see the required API contract.');
    process.exit(1);
  }

  // Check Python prerequisite
  if (!existsSync(PYTHON_FEATURES)) {
    console.error(`Python feature extractor not found: ${PYTHON_FEATURES}`);
    console.error('Phase 3 step 4 prerequisite. Run --list-interface for required API.');
    process.exit(1);
  }

  // Check TS prerequisite
  if (!existsSync(TS_FEATURES) && !existsSync(TS_FEATURES_JS)) {
    console.error(`TS feature extractor not found: ${TS_FEATURES}`);
    console.error('Phase 3 step 4 prerequisite. Run --list-interface for required API.');
    process.exit(1);
  }

  // Dynamically import TS extractor
  const tsModule = await import('../src/ml/features.js') as { extractFeatures: (f: FeatureFixture) => FeatureVector };
  const { extractFeatures } = tsModule;

  if (captureMode) {
    // Run Python extraction as ground truth and TS extraction, commit both to expected
    const pythonOutputs = runPython(FIXTURES_PATH);
    const expected: ExpectedMap = {};
    let ok = true;

    for (const fixture of fixtures) {
      const tsVec = extractFeatures(fixture);
      const pyVec = pythonOutputs[fixture.id];
      if (!pyVec) {
        console.error(`  MISSING ${fixture.id}: Python output has no entry for this fixture`);
        ok = false;
        continue;
      }
      if (tsVec.length !== pyVec.length) {
        console.error(`  MISMATCH ${fixture.id}: TS length ${tsVec.length} vs Python ${pyVec.length}`);
        ok = false;
        continue;
      }
      const identical = tsVec.every((v, i) => v === pyVec[i]);
      if (!identical) {
        console.error(`  MISMATCH ${fixture.id}: vectors are not bit-identical`);
        const diffs = tsVec.map((v, i) => ({ i, ts: v, py: pyVec[i], diff: v - pyVec[i] })).filter(x => x.diff !== 0);
        for (const d of diffs.slice(0, 5)) {
          console.error(`    feature[${d.i}]: TS=${d.ts} Python=${d.py} diff=${d.diff}`);
        }
        ok = false;
        continue;
      }
      expected[fixture.id] = tsVec;
      console.log(`  CAPTURED ${fixture.id}: ${tsVec.length} features`);
    }

    if (!ok) {
      console.error('\nCapture aborted — Python and TS vectors diverge. Fix before capturing.');
      process.exit(1);
    }

    writeFileSync(EXPECTED_PATH, JSON.stringify(expected, null, 2) + '\n');
    console.log(`\n[capture] wrote ${Object.keys(expected).length} expected vectors to ${EXPECTED_PATH}`);
    process.exit(0);
  }

  // Verify mode
  if (!existsSync(EXPECTED_PATH)) {
    console.error(`Expected file not found: ${EXPECTED_PATH}`);
    console.error('Run with --capture first after implementing ml/nba/features.py and src/ml/features.ts.');
    process.exit(1);
  }

  const expected: ExpectedMap = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'));
  const pythonOutputs = runPython(FIXTURES_PATH);

  let pass = 0;
  let fail = 0;
  const failures: string[] = [];

  for (const fixture of fixtures) {
    const expectedVec = expected[fixture.id];
    const tsVec = extractFeatures(fixture);
    const pyVec = pythonOutputs[fixture.id];

    if (!expectedVec) {
      console.warn(`  WARN  ${fixture.id}: not in expected.json (run --capture to add)`);
      continue;
    }
    if (!pyVec) {
      console.warn(`  WARN  ${fixture.id}: not in Python output`);
      continue;
    }

    const tsMatch = tsVec.length === expectedVec.length && tsVec.every((v, i) => v === expectedVec[i]);
    const pyMatch = pyVec.length === expectedVec.length && pyVec.every((v, i) => v === expectedVec[i]);

    if (tsMatch && pyMatch) {
      console.log(`  PASS  ${fixture.id}`);
      pass++;
    } else {
      if (!tsMatch) console.error(`  FAIL  ${fixture.id}: TS diverges from expected`);
      if (!pyMatch) console.error(`  FAIL  ${fixture.id}: Python diverges from expected`);
      failures.push(fixture.id);
      fail++;
    }
  }

  console.log(`\nResult: ${pass} PASS, ${fail} FAIL`);
  if (fail > 0) {
    console.error('FAIL — feature extraction parity broken. Investigate before Phase 3 model commit.');
    console.error('Failing fixtures: ' + failures.join(', '));
    process.exit(1);
  } else {
    console.log('PASS — Python ↔ TS feature extraction parity verified.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
