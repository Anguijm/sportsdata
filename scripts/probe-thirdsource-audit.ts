/**
 * One-shot third-source verification probe for the 2 raw-count failures
 * surfaced in Phase-2 Pass-B audit (per Plans/nba-learned-model.md addendum
 * v9 path (i)).
 *
 * Cells to verify:
 *   1. nba:bdl-8258317  (2023-12-09 IND @ LAL, NBA Cup final): LAL TOV
 *      - bbref says 18, ESPN says 20
 *   2. nba:bdl-18436952 (2025-05-18 DEN @ OKC, Game 7 W-Conf-semis): DEN fg3a
 *      - bbref says 45, ESPN says 44
 *
 * Strategy:
 *   1. Try nba.com/game/<slug> via Playwright with full stealth init scripts.
 *   2. Fallback to ESPN's web-displayed box score (different surface from the
 *      stats API our scraper uses).
 *   3. Save HTML to data/.thirdsource-cache/ so we can inspect manually if
 *      automated extraction misses.
 *
 * Run: npx tsx scripts/probe-thirdsource-audit.ts
 */

import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CACHE = 'data/.thirdsource-cache';
mkdirSync(CACHE, { recursive: true });

interface Probe {
  label: string;
  urls: string[];
  // textual signals to scan for in the rendered HTML
  needles: string[];
}

const PROBES: Probe[] = [
  {
    label: 'lal-tov-2023-12-09',
    urls: [
      'https://www.nba.com/game/ind-vs-lal-0022300388/box-score',
      'https://www.nba.com/game/ind-vs-lal-0022300388',
      'https://www.espn.com/nba/boxscore/_/gameId/401622469',
    ],
    needles: ['Turnovers', 'TO', 'Lakers', 'LAL'],
  },
  {
    label: 'den-fg3a-2025-05-18',
    urls: [
      'https://www.nba.com/game/den-vs-okc-0042400215/box-score',
      'https://www.nba.com/game/den-vs-okc-0042400215',
      'https://www.espn.com/nba/boxscore/_/gameId/401768356',
    ],
    needles: ['3PA', '3-Point', 'Nuggets', 'DEN'],
  },
];

async function tryUrl(page: Page, url: string): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const status = resp?.status() ?? 0;
    // Wait for any client-side hydration / rendering
    await page.waitForTimeout(3000);
    const body = await page.content();
    return { ok: status === 200, status, body };
  } catch (err) {
    return { ok: false, status: 0, body: `ERROR: ${(err as Error).message}` };
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Linux"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  // Aggressive fingerprint masking — all signals headless Chromium leaks by default.
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin' },
        { name: 'Chrome PDF Viewer' },
        { name: 'Native Client' },
      ],
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    // @ts-ignore
    window.chrome = { runtime: {} };
    const originalQuery = window.navigator.permissions.query;
    // @ts-ignore
    window.navigator.permissions.query = (params: any) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: 'denied' } as any)
        : originalQuery.call(window.navigator.permissions, params);
    // WebGL vendor masquerade
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };
  });

  const page = await ctx.newPage();

  for (const probe of PROBES) {
    console.log(`\n=== ${probe.label} ===`);
    for (const url of probe.urls) {
      console.log(`  → ${url}`);
      const r = await tryUrl(page, url);
      console.log(`    status=${r.status} bytes=${r.body.length}`);
      const sanitized = probe.label + '_' + url.replace(/[^a-z0-9]/gi, '_').slice(-40);
      writeFileSync(join(CACHE, sanitized + '.html'), r.body);
      // Quick signal check
      const matched = probe.needles.filter((n) => r.body.includes(n));
      console.log(`    matches: ${matched.join(', ') || '(none)'}`);
      // Light rate-limiter between urls
      await page.waitForTimeout(2000);
      if (r.ok && matched.length >= 2) {
        console.log(`    ← treating as success`);
        break;
      }
    }
  }

  await browser.close();
  console.log('\n[done] HTMLs written to', CACHE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
