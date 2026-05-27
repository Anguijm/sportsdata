/**
 * Regression test for the injury-scraper PK bug fix
 * (`src/scrapers/injuries.ts`, debt #19, 2026-05-28).
 *
 * The bug: ESPN's injuries endpoint stopped populating `athlete.id` and
 * `athlete.uid` on/before 2026-04-13. The scraper's `String(inj.athlete.id ?? '')`
 * fallback produced `player_id = ''` for every injury, so the
 * `(player_id, sport)` primary key collapsed every scrape to exactly 1
 * row per sport. Discovered via debt #18 prereq evaluation on
 * 2026-05-28: production DB had 1 row per sport with first_seen_at
 * frozen at 2026-04-13 despite daily scrapes (fetched_at = today).
 *
 * The fix:
 *   - `extractEspnPlayerId(athlete)` parses the ID from
 *     `athlete.headshot.href` or `athlete.links[*].href`.
 *   - If both URL sources miss, fall back to `displayName + '|' + teamAbbr`.
 *   - If EVERY scraped injury hits the fallback, emit a single
 *     `schema_error` to `scrape_warnings` so the next drift is visible.
 *
 * Run:
 *   npx tsx scripts/test-injury-scraper-pk-fix.ts
 */

import { extractEspnPlayerId } from '../src/scrapers/injuries.js';

let failures = 0;
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
    failures++;
  } else {
    console.log(`PASS: ${label}`);
  }
}

// ── Realistic ESPN athlete shape (verified against live API 2026-05-28) ──

const liveShape = {
  displayName: 'Keshon Gilbert',
  firstName: 'Keshon',
  lastName: 'Gilbert',
  position: { abbreviation: 'G' },
  headshot: {
    href: 'https://a.espncdn.com/i/headshots/nba/players/full/4585618.png',
    alt: 'Keshon Gilbert',
  },
  links: [
    { rel: ['playercard'], href: 'https://www.espn.com/nba/player/_/id/4585618/keshon-gilbert' },
  ],
  team: { abbreviation: 'ATL' },
  // id and uid intentionally absent — this is the broken-since-2026-04-13 shape
};

assertEq(extractEspnPlayerId(liveShape), '4585618',
  'live shape — parses from headshot.href when athlete.id is missing');

// ── Headshot URL alone is enough ──

assertEq(extractEspnPlayerId({
  displayName: 'X',
  headshot: { href: 'https://a.espncdn.com/i/headshots/nfl/players/full/12345.png' },
}), '12345', 'headshot.href parse — sport-agnostic');

// ── Links URL alone is enough (headshot absent) ──

assertEq(extractEspnPlayerId({
  displayName: 'Y',
  links: [
    { href: 'https://example.com/no/match' },
    { href: 'https://www.espn.com/nba/player/_/id/9876543/jane-doe' },
  ],
}), '9876543', 'links.href parse — picks first link whose URL matches /id/<N>');

// ── Future-proofing: if ESPN restores athlete.id, prefer it ──

assertEq(extractEspnPlayerId({
  displayName: 'Z',
  id: '7777777',
  headshot: { href: 'https://a.espncdn.com/i/headshots/nba/players/full/1111111.png' },
}), '7777777', 'athlete.id (string) is preferred when present');

assertEq(extractEspnPlayerId({
  displayName: 'Z2',
  id: 8888888,
  headshot: { href: 'https://a.espncdn.com/i/headshots/nba/players/full/2222222.png' },
}), '8888888', 'athlete.id (number) coerced to string and preferred');

assertEq(extractEspnPlayerId({
  displayName: 'Z3',
  uid: 'uid-abc',
  headshot: { href: 'https://a.espncdn.com/i/headshots/nba/players/full/3333333.png' },
}), 'uid-abc', 'athlete.uid is preferred over headshot when present');

// ── All sources empty/missing → null (caller will use composite fallback) ──

assertEq(extractEspnPlayerId({ displayName: 'No URLs' }), null,
  'returns null when no ID source available — caller falls back to name|team composite');

assertEq(extractEspnPlayerId({
  displayName: 'Broken headshot',
  headshot: { href: 'https://example.com/not/an/espn/url' },
  links: [],
}), null, 'returns null when URLs do not match the expected patterns');

assertEq(extractEspnPlayerId(null), null, 'null athlete → null');
assertEq(extractEspnPlayerId(undefined), null, 'undefined athlete → null');
assertEq(extractEspnPlayerId('string'), null, 'non-object athlete → null');

// ── headshot present but href empty ──

assertEq(extractEspnPlayerId({
  displayName: 'Empty href',
  headshot: { href: '' },
}), null, 'empty headshot.href → null');

// ── End-to-end smoke against live ESPN (pm.8 — exercise real data path) ──
// Skipped offline (ESPN unreachable). On success, confirms 1) ESPN still
// returns ≥20 NBA injuries, 2) our fix extracts a distinct ID for ≥90% of
// them, 3) at most a handful fall back to the name|team composite.

console.log('\n--- live ESPN smoke ---');

try {
  const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries');
  if (!res.ok) {
    console.log(`SKIP live smoke: HTTP ${res.status}`);
  } else {
    const data = await res.json() as { injuries?: Array<{ injuries?: Array<{ athlete?: unknown }> }> };
    const allAthletes = (data.injuries ?? []).flatMap(t => t.injuries ?? []).map(i => i.athlete);
    const total = allAthletes.length;
    const withId = allAthletes.filter(a => extractEspnPlayerId(a) !== null).length;
    const ids = new Set<string>();
    for (const a of allAthletes) {
      const id = extractEspnPlayerId(a);
      if (id) ids.add(id);
    }
    console.log(`  athletes returned: ${total}`);
    console.log(`  parsed-ID rate:    ${withId}/${total} (${(100 * withId / total).toFixed(1)}%)`);
    console.log(`  distinct ids:      ${ids.size}`);

    if (total < 20) {
      console.error(`FAIL: ESPN returned ${total} NBA injuries — far below typical (~100). Schema may have drifted again.`);
      failures++;
    } else {
      console.log(`PASS: ESPN returned ${total} ≥ 20 NBA injuries (typical range).`);
    }
    if (total > 0 && withId / total < 0.9) {
      console.error(`FAIL: only ${withId}/${total} (${(100 * withId / total).toFixed(1)}%) athletes parsed an ID — < 90% threshold.`);
      failures++;
    } else if (total > 0) {
      console.log(`PASS: parse rate ${(100 * withId / total).toFixed(1)}% ≥ 90%.`);
    }
    if (ids.size < 20) {
      console.error(`FAIL: only ${ids.size} distinct IDs across ${total} injuries — possible duplicate-ID bug.`);
      failures++;
    } else {
      console.log(`PASS: ${ids.size} distinct IDs (well above the 1-per-sport collapse the bug caused).`);
    }
  }
} catch (e) {
  console.log(`SKIP live smoke: ${(e as Error).message}`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log(`\nAll assertions passed`);
