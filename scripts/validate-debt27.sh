#!/usr/bin/env bash
# validate-debt27.sh — One-command validation for NBA home-adv recalibration.
#
# Runs baseline + reliability, then checks all 5 pre-declared ship rules
# from Plans/nba-home-adv-recalibration.md.
#
# Prerequisites:
#   - npm install (deps must be installed)
#   - data/sqlite/sportsdata.db must contain the real game data
#     (restore from backup if needed — see step 1 in the instructions)
#
# Usage:
#   bash scripts/validate-debt27.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAILURES=$((FAILURES + 1)); }

FAILURES=0

echo "=== Step 1: Running baseline ==="
npm run baseline 2>&1 | tail -5
echo ""

echo "=== Step 2: Running reliability ==="
npm run reliability 2>&1 | tail -5
echo ""

echo "=== Step 3: Checking ship rules ==="
echo ""

# Find today's artifacts (the scripts write to data/baselines/ and data/reliability/)
BASELINE_JSON=$(ls -t data/baselines/baseline-*.json 2>/dev/null | head -1)
RELIABILITY_JSON=$(ls -t data/reliability/reliability-*.json 2>/dev/null | head -1)

if [ -z "$BASELINE_JSON" ] || [ -z "$RELIABILITY_JSON" ]; then
  echo -e "${RED}ERROR: Could not find baseline or reliability JSON artifacts.${NC}"
  echo "  baseline:    $BASELINE_JSON"
  echo "  reliability: $RELIABILITY_JSON"
  exit 1
fi

echo "Using artifacts:"
echo "  baseline:    $BASELINE_JSON"
echo "  reliability: $RELIABILITY_JSON"
echo ""

# ── Ship rule checks via node ──
node -e "
const b = require('./' + process.argv[1]);
const r = require('./' + process.argv[2]);

// Pre-change reference values
const PRE = {
  nba_margin_wMAE: 0.9565,
  nba_margin_sR: -0.6050,
  nba_winner_ece: 0.0156,
  // Other sports' margin verdicts (must not change)
  other_margin_verdicts: {
    nfl: 'HONEST', mlb: 'HONEST', nhl: 'HONEST',
    mls: 'HONEST', epl: 'HONEST',
  },
};

let failures = 0;
function pass(msg) { console.log('  \x1b[32mPASS\x1b[0m ' + msg); }
function fail(msg) { console.log('  \x1b[31mFAIL\x1b[0m ' + msg); failures++; }

const nbaR = r.bySport.find(s => s.sport === 'nba');
if (!nbaR) { console.error('No NBA in reliability JSON'); process.exit(1); }

const nbaB = b.bySport.find(s => s.sport === 'nba');

// ── Rule 1: NBA v4-spread weightedMAE decreases (was 0.9565) ──
const newWMAE = nbaR.margin.weightedMAE;
if (newWMAE < PRE.nba_margin_wMAE) {
  pass('Rule 1: NBA margin weightedMAE decreased: ' + PRE.nba_margin_wMAE.toFixed(4) + ' → ' + newWMAE.toFixed(4));
} else {
  fail('Rule 1: NBA margin weightedMAE did NOT decrease: ' + PRE.nba_margin_wMAE.toFixed(4) + ' → ' + newWMAE.toFixed(4));
}

// ── Rule 2: NBA v4-spread |signedResid| ≤ 0.10 (was 0.6050) ──
const newSR = nbaR.margin.signedResidual;
if (Math.abs(newSR) <= 0.10) {
  pass('Rule 2: NBA margin |signedResid| ≤ 0.10: ' + newSR.toFixed(4) + ' (|' + Math.abs(newSR).toFixed(4) + '|)');
} else {
  fail('Rule 2: NBA margin |signedResid| > 0.10: ' + newSR.toFixed(4) + ' (|' + Math.abs(newSR).toFixed(4) + '|)');
}

// ── Rule 3: NBA v4-spread verdict == HONEST ──
const newVerdict = nbaR.margin.verdict;
if (newVerdict === 'HONEST') {
  pass('Rule 3: NBA margin verdict = HONEST');
} else {
  fail('Rule 3: NBA margin verdict = ' + newVerdict + ' (expected HONEST)');
}

// ── Rule 4: NBA v5 winner ECE does not regress by more than +0.015 (was 0.0156) ──
const newECE = nbaR.winnerProb.ece;
const eceRegression = newECE - PRE.nba_winner_ece;
if (eceRegression <= 0.015) {
  pass('Rule 4: NBA winner ECE regression = ' + (eceRegression >= 0 ? '+' : '') + eceRegression.toFixed(4) + ' (≤ 0.015). ECE: ' + PRE.nba_winner_ece.toFixed(4) + ' → ' + newECE.toFixed(4) + '. Verdict: ' + nbaR.winnerProb.verdict);
} else {
  fail('Rule 4: NBA winner ECE regression = +' + eceRegression.toFixed(4) + ' (> 0.015). ECE: ' + PRE.nba_winner_ece.toFixed(4) + ' → ' + newECE.toFixed(4) + '. Verdict: ' + nbaR.winnerProb.verdict);
}

// ── Rule 5: No other sport's margin verdict changed ──
let rule5pass = true;
for (const [sport, expectedVerdict] of Object.entries(PRE.other_margin_verdicts)) {
  const sportR = r.bySport.find(s => s.sport === sport);
  if (!sportR) { fail('Rule 5: ' + sport + ' missing from reliability report'); rule5pass = false; continue; }
  const actual = sportR.margin.verdict;
  if (actual !== expectedVerdict) {
    fail('Rule 5: ' + sport + ' margin verdict changed: ' + expectedVerdict + ' → ' + actual);
    rule5pass = false;
  }
}
if (rule5pass) {
  pass('Rule 5: All other sports margin verdicts unchanged (NFL/MLB/NHL/MLS/EPL all HONEST)');
}

// ── Bonus: NBA baseline bias ──
if (nbaB && nbaB.all) {
  const a = nbaB.all;
  console.log('');
  console.log('  Bonus — NBA baseline bias: ' + a.marginBias.estimate.toFixed(4) +
    ' [' + a.marginBias.low.toFixed(4) + ', ' + a.marginBias.high.toFixed(4) + ']' +
    ' (was +0.60 [+0.18, +1.01])');
  console.log('  Bonus — NBA MAE − nv0: ' + a.marginMAE_minus_naiveZero.estimate.toFixed(4) +
    ' (was −1.283)');
}

console.log('');
if (failures === 0) {
  console.log('\x1b[32m✓ ALL 5 SHIP RULES PASS — safe to merge.\x1b[0m');
} else {
  console.log('\x1b[31m✗ ' + failures + ' SHIP RULE(S) FAILED — do NOT merge. See Plans/nba-home-adv-recalibration.md for fallback.\x1b[0m');
}
process.exit(failures);
" "$BASELINE_JSON" "$RELIABILITY_JSON"
