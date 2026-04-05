/**
 * Main entry — fetches data from API, renders charts, drives scroll narrative.
 */

import * as Plot from '@observablehq/plot';

const API_BASE = 'http://localhost:3001';
const SPORT = 'nba';

interface Finding {
  id: string;
  type: string;
  headline: string;
  detail: string;
  surpriseScore: number;
  spotlight: boolean;
  narrativeHint: string;
  chartType: string;
  data: Record<string, unknown>;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}?sport=${SPORT}`);
  return res.json() as Promise<T>;
}

// --- Histogram: Margin Distribution ---

function renderHistogram(
  container: HTMLElement,
  margins: { margin: number; count: number }[],
  avgMargin: number
) {
  // Expand grouped data into individual values for Plot
  const values: { margin: number }[] = [];
  for (const row of margins) {
    for (let i = 0; i < row.count; i++) {
      values.push({ margin: row.margin });
    }
  }

  const chart = Plot.plot({
    width: 680,
    height: 340,
    style: {
      background: '#ffffff',
      fontFamily: 'Roboto, Arial, sans-serif',
      fontSize: '12px',
      color: '#333',
    },
    x: {
      label: 'Victory margin (points)',
      domain: [0, Math.min(60, Math.max(...margins.map(m => m.margin)) + 5)],
    },
    y: { label: 'Games', grid: true },
    marks: [
      Plot.rectY(values, Plot.binX({ y: 'count' }, { x: 'margin', fill: '#adb5bd', thresholds: 20 })),
      Plot.ruleX([avgMargin], { stroke: '#e63946', strokeWidth: 2, strokeDasharray: '4,4' }),
      Plot.text([{ x: avgMargin, label: `avg: ${avgMargin.toFixed(1)}` }], {
        x: 'x',
        text: 'label',
        dy: -10,
        fontSize: 11,
        fontFamily: 'Roboto Mono, monospace',
        fill: '#e63946',
      }),
    ],
  });

  container.innerHTML = '';
  container.appendChild(chart);
}

// --- Render findings as scroll sections ---

function renderFindings(container: HTMLElement, findings: Finding[]) {
  // Take top 15 findings
  const top = findings.slice(0, 15);

  for (const f of top) {
    const section = document.createElement('div');
    section.className = `finding ${f.spotlight ? 'spotlight' : ''}`;
    section.innerHTML = `
      <div class="finding-headline">${f.headline}</div>
      <div class="finding-detail">${f.detail}</div>
      ${f.spotlight ? `<div class="finding-narrative">${f.narrativeHint}</div>` : ''}
    `;
    container.appendChild(section);
  }
}

// --- Boot ---

async function main() {
  // Fetch all data in parallel
  const [stats, margins, findings] = await Promise.all([
    fetchJson<{ total_games: number; home_wins: number; avg_margin: number; max_margin: number }>('/api/stats'),
    fetchJson<{ margin: number; count: number }[]>('/api/margins'),
    fetchJson<Finding[]>('/api/findings'),
  ]);

  // Intro
  const introText = document.getElementById('intro-text')!;
  const totalGames = stats.total_games;
  const homeWinPct = ((stats.home_wins / totalGames) * 100).toFixed(1);
  introText.innerHTML = `
    This is <span class="number">${totalGames.toLocaleString()}</span> NBA games.<br><br>
    Home teams won <span class="number">${homeWinPct}%</span> of them.
    The biggest blowout was <span class="highlight">${stats.max_margin} points</span>.
  `;

  // Avg margin stat
  document.getElementById('avg-margin')!.textContent = stats.avg_margin.toFixed(1);

  // Histogram
  const histContainer = document.getElementById('histogram-chart')!;
  renderHistogram(histContainer, margins, stats.avg_margin);

  // Findings
  const findingsContainer = document.getElementById('findings-container')!;
  renderFindings(findingsContainer, findings);

  // Outro
  const spotlights = findings.filter(f => f.spotlight);
  document.getElementById('outro-text')!.innerHTML = `
    ${findings.length} interesting things found in ${totalGames.toLocaleString()} games.<br>
    ${spotlights.length} of them were spotlight moments.<br><br>
    That was the NBA.
  `;
}

main().catch(err => {
  document.getElementById('intro-text')!.textContent =
    `Failed to load data. Is the data API running? (npm run api)\n\n${err.message}`;
});
