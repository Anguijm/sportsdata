/**
 * CLI findings command — display ranked interesting findings.
 * Usage: npx tsx src/cli/findings.ts [sport]
 */

import type { Sport } from '../schema/provenance.js';
import { scanForFindings } from '../analysis/interesting.js';
import { closeDb } from '../storage/sqlite.js';
import { pad } from './tables.js';

const sport: Sport = (process.argv[2] as Sport) ?? 'nba';

function main(): void {
  console.log(`\nScanning ${sport.toUpperCase()} data for interesting findings...\n`);
  const findings = scanForFindings(sport);

  if (findings.length === 0) {
    console.log('No findings. Need more data.');
    closeDb();
    return;
  }

  console.log(`Found ${findings.length} interesting things:\n`);

  for (const [i, f] of findings.entries()) {
    const rank = String(i + 1).padStart(2);
    const surprise = (f.surpriseScore * 100).toFixed(0).padStart(3);
    const spot = f.spotlight ? ' *' : '  ';
    const type = pad(f.type, 14);

    console.log(`${rank}.${spot} [${surprise}%] ${type} ${f.headline}`);
    if (f.spotlight) {
      console.log(`        "${f.narrativeHint}"`);
    }
  }

  // Summary stats
  const spotlights = findings.filter(f => f.spotlight);
  console.log(`\n━━━ Summary ━━━`);
  console.log(`  Total findings: ${findings.length}`);
  console.log(`  Spotlight moments: ${spotlights.length}`);
  console.log(`  Types: ${[...new Set(findings.map(f => f.type))].join(', ')}`);

  closeDb();
}

main();
