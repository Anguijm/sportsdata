/**
 * Main entry — fetches data, renders dark-mode visualizations.
 */

import * as Plot from '@observablehq/plot';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const SPORT = 'nba';

interface Stats {
  total_games: number;
  home_wins: number;
  avg_margin: number;
  min_margin: number;
  max_margin: number;
}

interface Finding {
  id: string;
  type: string;
  headline: string;
  detail: string;
  surpriseScore: number;
  spotlight: boolean;
  narrativeHint: string;
}

interface SeasonRow {
  year: number;
  label: string;
  sequence: boolean[];
  wins: number;
  losses: number;
  winPct: number;
  ptsForPg: number;
  ptsAgainstPg: number;
  diffPg: number;
}

interface TeamSequence {
  teamId: string;
  abbr: string;
  seasons: SeasonRow[];
}

interface Game {
  game_id: string;
  date: string;
  winner: string;
  loser: string;
  home_score: number;
  away_score: number;
  margin: number;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}?sport=${SPORT}`);
  return res.json() as Promise<T>;
}

// --- Histogram ---

function renderHistogram(container: HTMLElement, margins: { margin: number; count: number }[], avgMargin: number) {
  const values: { margin: number }[] = [];
  for (const row of margins) {
    for (let i = 0; i < row.count; i++) values.push({ margin: row.margin });
  }

  const chart = Plot.plot({
    width: 856,
    height: 360,
    marginLeft: 60,
    marginBottom: 50,
    style: {
      background: 'transparent',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '11px',
      color: '#a3a3a3',
    },
    x: {
      label: 'Margin of victory →',
      labelAnchor: 'center',
      labelOffset: 38,
      domain: [0, Math.min(70, Math.max(...margins.map(m => m.margin)) + 5)],
      ticks: 14,
    },
    y: {
      label: '↑ Games',
      labelAnchor: 'center',
      labelOffset: 45,
      grid: true,
    },
    marks: [
      Plot.rectY(values, Plot.binX({ y: 'count' }, {
        x: 'margin',
        fill: '#64d2ff',
        thresholds: 35,
      })),
      Plot.ruleX([avgMargin], { stroke: '#ff9f0a', strokeWidth: 2, strokeDasharray: '4,4' }),
      Plot.text([{ x: avgMargin, label: `avg: ${avgMargin.toFixed(1)}` }], {
        x: 'x',
        text: 'label',
        dy: -10,
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace',
        fill: '#ff9f0a',
      }),
      Plot.ruleY([0], { stroke: '#262626' }),
    ],
  });

  // Override default text colors
  chart.querySelectorAll('text').forEach(t => {
    if (!t.getAttribute('fill') || t.getAttribute('fill') === 'currentColor') {
      t.setAttribute('fill', '#a3a3a3');
    }
  });

  container.innerHTML = '';
  container.appendChild(chart);
}

// --- Extreme games callouts ---

function renderExtremes(container: HTMLElement, data: { blowouts: Game[]; nailBiters: Game[] }) {
  const cards: string[] = [];

  // Biggest blowout (spotlight)
  const biggest = data.blowouts[0];
  if (biggest) {
    const w = biggest.winner.split(':')[1];
    const l = biggest.loser.split(':')[1];
    cards.push(`
      <div class="callout spotlight">
        <div class="callout-label">★ Biggest blowout</div>
        <div class="callout-headline">${w} ${biggest.home_score}, ${l} ${biggest.away_score}</div>
        <div class="callout-detail">${biggest.date.slice(0, 10)} · ${w} won by <strong>${biggest.margin}</strong> points. The biggest margin in three seasons.</div>
      </div>
    `);
  }

  // Closest game
  const closest = data.nailBiters[0];
  if (closest) {
    const w = closest.winner.split(':')[1];
    const l = closest.loser.split(':')[1];
    cards.push(`
      <div class="callout">
        <div class="callout-label">Closest game</div>
        <div class="callout-headline">${w} ${closest.home_score}, ${l} ${closest.away_score}</div>
        <div class="callout-detail">${closest.date.slice(0, 10)} · One point. One possession. One moment.</div>
      </div>
    `);
  }

  // Other blowouts
  for (const b of data.blowouts.slice(1, 4)) {
    const w = b.winner.split(':')[1];
    const l = b.loser.split(':')[1];
    cards.push(`
      <div class="callout">
        <div class="callout-label">Big blowout</div>
        <div class="callout-headline">${w} +${b.margin}</div>
        <div class="callout-detail">${b.date.slice(0, 10)} · over ${l} (${b.home_score}–${b.away_score})</div>
      </div>
    `);
  }

  container.innerHTML = cards.join('');
}

// --- Streak grid (per-season with diff) ---

function renderStreaks(container: HTMLElement, sequences: TeamSequence[]) {
  // Find all unique seasons
  const allSeasons = new Set<number>();
  sequences.forEach(t => t.seasons.forEach(s => allSeasons.add(s.year)));
  const seasonList = Array.from(allSeasons).sort((a, b) => b - a);

  const html = seasonList.map(year => {
    const label = `${year}-${String(year + 1).slice(2)}`;
    const teamsInSeason = sequences
      .map(t => ({ team: t, season: t.seasons.find(s => s.year === year) }))
      .filter(x => x.season && x.season.sequence.length >= 50)
      .sort((a, b) => (b.season!.winPct ?? 0) - (a.season!.winPct ?? 0));

    const rows = teamsInSeason.map(({ team, season }) => {
      const s = season!;
      const segments = s.sequence.map(won =>
        `<div class="streak-segment ${won ? 'win' : 'loss'}"></div>`
      ).join('');

      const diffSign = s.diffPg >= 0 ? '+' : '';
      const diffClass = s.diffPg >= 0 ? 'wins' : 'losses';

      return `
        <div class="streak-row season-row">
          <div class="streak-team">${team.abbr}</div>
          <div class="streak-bar">${segments}</div>
          <div class="streak-record">
            <span class="wins">${s.wins}</span>–<span class="losses">${s.losses}</span>
          </div>
          <div class="streak-diff ${diffClass}">
            ${diffSign}${s.diffPg.toFixed(1)}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="season-block">
        <div class="season-header">
          <div class="season-label">${label}</div>
          <div class="season-meta">${teamsInSeason.length} teams · sorted by win rate · ppg differential on the right</div>
        </div>
        <div class="streak-grid">${rows}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// --- Player findings (per sport, council-approved hero card pattern) ---

interface PlayerFinding {
  id: string;
  sport: string;
  category: string;
  rank: number;
  playerName: string;
  team: string;
  position: string;
  headline: string;
  statValue: number;
  statLabel: string;
  rateStatLabel?: string;
  rateStatValue?: string;
  qualifier: string;
  spotlight: boolean;
}

interface PlayerHero {
  sport: string;
  name: string;
  team: string;
  position: string;
  category: string;
  headline: string;
  primaryStat: { label: string; value: string };
  contextStats: Array<{ label: string; value: string }>;
  qualifier: string;
}

interface SportData {
  hero: PlayerHero | null;
  findings: PlayerFinding[];
}

const SPORT_LABELS: Record<string, string> = {
  nba: 'NBA · Basketball',
  nfl: 'NFL · Football',
  mlb: 'MLB · Baseball',
  nhl: 'NHL · Hockey',
  mls: 'MLS · Soccer',
  epl: 'Premier League',
};

const SPORT_ORDER = ['nba', 'nfl', 'mlb', 'nhl', 'epl', 'mls'];

async function loadAllSportData(): Promise<Map<string, SportData>> {
  const map = new Map<string, SportData>();
  await Promise.all(SPORT_ORDER.map(async s => {
    try {
      const res = await fetch(`${API_BASE}/api/sport-data?sport=${s}`);
      const data = await res.json() as SportData;
      if (data.findings.length > 0) map.set(s, data);
    } catch {
      /* skip */
    }
  }));
  return map;
}

function renderHeroCard(hero: PlayerHero): string {
  const contextHtml = hero.contextStats.map(s => `
    <div class="hero-context-stat">
      <div class="hero-context-label">${s.label}</div>
      <div class="hero-context-value">${s.value}</div>
    </div>
  `).join('');

  return `
    <div class="hero-card">
      <div class="hero-card-eyebrow">${hero.category} · ${hero.qualifier}</div>
      <div class="hero-card-name">${hero.name}</div>
      <div class="hero-card-meta">${hero.team} · ${hero.position}</div>
      <div class="hero-card-primary">
        <div class="hero-primary-value">${hero.primaryStat.value}</div>
        <div class="hero-primary-label">${hero.primaryStat.label}</div>
      </div>
      <div class="hero-card-context">${contextHtml}</div>
    </div>
  `;
}

function renderPlayerSection(container: HTMLElement, allPlayers: Map<string, SportData>, counts: Record<string, number>) {
  const sports = SPORT_ORDER.filter(s => allPlayers.has(s));
  if (sports.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted)">No player data yet.</p>';
    return;
  }

  const html = sports.map(sport => {
    const { hero, findings } = allPlayers.get(sport)!;
    const totalCount = counts[sport] ?? 0;

    // Group by category, drop hero category from leaderboards (it's already shown above)
    const byCategory = new Map<string, PlayerFinding[]>();
    for (const f of findings) {
      if (!byCategory.has(f.category)) byCategory.set(f.category, []);
      byCategory.get(f.category)!.push(f);
    }

    const categoryBlocks = Array.from(byCategory.entries()).map(([cat, list]) => {
      const rows = list.map(f => `
        <div class="player-row ${f.spotlight ? 'spotlight' : ''}">
          <div class="player-rank">${f.rank}</div>
          <div class="player-name">
            <span class="name">${f.playerName}</span>
            <span class="meta">${f.team} · ${f.position || '—'}</span>
          </div>
          <div class="player-stat">
            <div class="stat-value">${f.headline}</div>
            ${f.rateStatLabel ? `<div class="stat-rate"><span class="rate-label">${f.rateStatLabel}</span> ${f.rateStatValue}</div>` : ''}
          </div>
        </div>
      `).join('');

      return `
        <details class="player-category" ${cat === Array.from(byCategory.keys())[0] ? 'open' : ''}>
          <summary class="player-category-label">${cat}</summary>
          <div class="player-rows">${rows}</div>
        </details>
      `;
    }).join('');

    return `
      <div class="sport-block">
        <div class="sport-header">
          <div class="sport-title">${SPORT_LABELS[sport] ?? sport.toUpperCase()}</div>
          <div class="sport-meta">${totalCount} players · qualified leaders only</div>
        </div>
        ${hero ? renderHeroCard(hero) : ''}
        <div class="leaderboards">${categoryBlocks}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// --- Findings ranked list ---

function renderFindings(container: HTMLElement, findings: Finding[]) {
  const html = findings.map((f, i) => {
    const rank = String(i + 1).padStart(2, '0');
    const surprise = (f.surpriseScore * 100).toFixed(0);
    const typeLabel = f.type.replace('_', ' ');

    return `
      <div class="finding ${f.spotlight ? 'spotlight' : ''}">
        <div class="finding-rank">${rank}</div>
        <div class="finding-body">
          <div class="finding-headline">${f.headline}</div>
          <div class="finding-detail">${f.detail}</div>
          ${f.spotlight ? `<div class="finding-hint">${f.narrativeHint}</div>` : ''}
        </div>
        <div class="finding-meta">
          <div class="finding-type">${typeLabel}</div>
          <div class="finding-surprise">${surprise}<span style="font-size: 12px">%</span></div>
          <div class="finding-surprise-label">surprise</div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// --- Boot ---

async function main() {
  try {
    const [stats, margins, findings, sequences, extremes, allSportData, playerCounts] = await Promise.all([
      fetchJson<Stats>('/api/stats'),
      fetchJson<{ margin: number; count: number }[]>('/api/margins'),
      fetchJson<Finding[]>('/api/findings'),
      fetchJson<TeamSequence[]>('/api/team-sequences'),
      fetchJson<{ blowouts: Game[]; nailBiters: Game[] }>('/api/extreme-games'),
      loadAllSportData(),
      fetch(`${API_BASE}/api/player-counts`).then(r => r.json() as Promise<Record<string, number>>),
    ]);

    const totalGames = stats.total_games;
    const homeWinPct = ((stats.home_wins / totalGames) * 100).toFixed(1);

    // Hero
    document.getElementById('hero-title')!.innerHTML =
      `${totalGames.toLocaleString()}<br>NBA games.`;

    document.getElementById('hero-text')!.innerHTML = `
      Three seasons. Every game scraped, every result resolved.
      <span class="number">${findings.filter(f => f.spotlight).length}</span> spotlight findings,
      including a <span class="highlight">${stats.max_margin}-point blowout</span>
      and a <span class="highlight">28-game losing streak</span>.
    `;

    // Big stats
    document.getElementById('big-stats')!.innerHTML = `
      <div class="big-stat">
        <div class="big-stat-label">Total games</div>
        <div class="big-stat-value">${totalGames.toLocaleString()}</div>
        <div class="big-stat-detail">3 seasons · 30 teams</div>
      </div>
      <div class="big-stat">
        <div class="big-stat-label">Avg margin</div>
        <div class="big-stat-value">${stats.avg_margin.toFixed(1)}</div>
        <div class="big-stat-detail">points</div>
      </div>
      <div class="big-stat">
        <div class="big-stat-label">Home wins</div>
        <div class="big-stat-value">${homeWinPct}<span style="font-size: 24px">%</span></div>
        <div class="big-stat-detail">${stats.home_wins.toLocaleString()} of ${totalGames.toLocaleString()}</div>
      </div>
      <div class="big-stat">
        <div class="big-stat-label">Biggest blowout</div>
        <div class="big-stat-value">${stats.max_margin}</div>
        <div class="big-stat-detail">points · OKC vs POR</div>
      </div>
    `;

    // Charts
    renderHistogram(document.getElementById('histogram-chart')!, margins, stats.avg_margin);
    renderExtremes(document.getElementById('extremes-grid')!, extremes);
    renderStreaks(document.getElementById('streak-grid')!, sequences);
    renderFindings(document.getElementById('findings-grid')!, findings);
    renderPlayerSection(document.getElementById('players-section')!, allSportData, playerCounts);

  } catch (err) {
    document.getElementById('hero-title')!.textContent = 'Failed to load data';
    document.getElementById('hero-text')!.textContent = err instanceof Error ? err.message : String(err);
  }
}

main();
