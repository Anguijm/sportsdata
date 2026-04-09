/**
 * Main entry — fetches data, renders dark-mode visualizations.
 */

import * as Plot from '@observablehq/plot';
import { getTeamColor } from './team-colors.js';

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
// Council mandate: top 5 + bottom 5 by point diff per season,
// middle teams in nested <details>, older seasons collapsed.

function renderStreakRow(team: TeamSequence, season: SeasonRow): string {
  const segments = season.sequence.map(won =>
    `<div class="streak-segment ${won ? 'win' : 'loss'}"></div>`
  ).join('');

  const diffSign = season.diffPg >= 0 ? '+' : '';
  const diffClass = season.diffPg >= 0 ? 'wins' : 'losses';

  return `
    <div class="streak-row season-row">
      <div class="streak-team">${team.abbr}</div>
      <div class="streak-bar">${segments}</div>
      <div class="streak-record">
        <span class="wins">${season.wins}</span>–<span class="losses">${season.losses}</span>
      </div>
      <div class="streak-diff ${diffClass}">
        ${diffSign}${season.diffPg.toFixed(1)}
      </div>
    </div>
  `;
}

function renderStreaks(container: HTMLElement, sequences: TeamSequence[]) {
  // Find all unique seasons
  const allSeasons = new Set<number>();
  sequences.forEach(t => t.seasons.forEach(s => allSeasons.add(s.year)));
  const seasonList = Array.from(allSeasons).sort((a, b) => b - a);

  const html = seasonList.map((year, seasonIdx) => {
    const label = `${year}-${String(year + 1).slice(2)}`;
    // Council mandate (Researcher): sort by point differential, not winPct
    const teamsInSeason = sequences
      .map(t => ({ team: t, season: t.seasons.find(s => s.year === year)! }))
      .filter(x => x.season && x.season.sequence.length >= 50)
      .sort((a, b) => b.season.diffPg - a.season.diffPg);

    const total = teamsInSeason.length;
    const top = teamsInSeason.slice(0, 5);
    const bottom = teamsInSeason.slice(-5);
    const middle = total > 10 ? teamsInSeason.slice(5, total - 5) : [];

    const topRows = top.map(({ team, season }) => renderStreakRow(team, season)).join('');
    const bottomRows = bottom.map(({ team, season }) => renderStreakRow(team, season)).join('');
    const middleRows = middle.map(({ team, season }) => renderStreakRow(team, season)).join('');

    const middleBlock = middle.length > 0 ? `
      <details class="streak-middle">
        <summary>show ${middle.length} middle teams</summary>
        <div class="streak-grid">${middleRows}</div>
      </details>
    ` : '';

    const innerBlock = `
      <div class="season-header">
        <div class="season-label">${label}</div>
        <div class="season-meta">best and worst 5 of ${total} · by point differential</div>
      </div>
      <div class="streak-grid">${topRows}</div>
      ${middleBlock}
      <div class="streak-divider">— bottom 5 —</div>
      <div class="streak-grid">${bottomRows}</div>
    `;

    // Current (most recent) season open by default; older seasons collapsed
    if (seasonIdx === 0) {
      return `<div class="season-block">${innerBlock}</div>`;
    }
    return `
      <details class="season-block season-collapsed">
        <summary class="season-summary">${label} <span class="season-summary-meta">— ${total} teams</span></summary>
        ${innerBlock}
      </details>
    `;
  }).join('');

  container.innerHTML = html;
}

// --- Live predictions ---

interface PredictionRow {
  id: string;
  game_id: string;
  sport: string;
  model_version: string;
  predicted_winner: string;
  predicted_prob: number;
  reasoning_text: string;
  made_at: string;
  resolved_at: string | null;
  actual_winner: string | null;
  was_correct: number | null;
  brier_score: number | null;
  low_confidence: number;
  game_date: string;
  home_team_id: string;
  away_team_id: string;
  game_status: string;
}

interface TrackRecordCohort {
  source: 'live' | 'backfill';
  resolved: number;
  correct: number;
  accuracy: number;
  avgBrier: number;
  lowConfidenceResolved: number;
  lowConfidenceCorrect: number;
}

interface TrackRecordRow {
  modelVersion: string;
  sport: string;
  // Council mandate (UX): NEVER merge live and backfill
  live?: TrackRecordCohort;
  backfill?: TrackRecordCohort;
  // Backwards-compat top-level (live cohort)
  resolved: number;
  correct: number;
  accuracy: number;
  avgBrier: number;
  lowConfidenceResolved: number;
  lowConfidenceCorrect: number;
}

function formatGameDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000);
  if (diffDays === 0) return 'TONIGHT';
  if (diffDays === 1) return 'TOMORROW';
  if (diffDays === -1) return 'YESTERDAY';
  if (diffDays > 1 && diffDays < 7) return `IN ${diffDays} DAYS`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

function renderPredictions(
  container: HTMLElement,
  upcoming: PredictionRow[],
  recent: PredictionRow[],
  trackRecord: TrackRecordRow,
) {
  // Council mandate (UX): two distinct cohorts, NEVER merged
  const live = trackRecord.live ?? {
    source: 'live' as const,
    resolved: trackRecord.resolved,
    correct: trackRecord.correct,
    accuracy: trackRecord.accuracy,
    avgBrier: trackRecord.avgBrier,
    lowConfidenceResolved: trackRecord.lowConfidenceResolved,
    lowConfidenceCorrect: trackRecord.lowConfidenceCorrect,
  };
  const backfill = trackRecord.backfill;

  const renderCohort = (
    label: string,
    sublabel: string,
    cohort: TrackRecordCohort,
    isLive: boolean
  ): string => {
    const acc = cohort.resolved > 0 ? (cohort.accuracy * 100).toFixed(1) + '%' : '—';
    const brier = cohort.resolved > 0 ? cohort.avgBrier.toFixed(3) : '—';
    return `
      <div class="track-cohort ${isLive ? 'cohort-live' : 'cohort-backfill'}">
        <div class="track-cohort-header">
          <div class="track-cohort-label">${label}</div>
          <div class="track-cohort-sub">${sublabel}</div>
        </div>
        <div class="track-cohort-stats">
          <div class="track-stat">
            <div class="track-stat-value">${cohort.correct}<span class="track-stat-sep">–</span>${cohort.resolved - cohort.correct}</div>
            <div class="track-stat-label">RECORD</div>
          </div>
          <div class="track-stat">
            <div class="track-stat-value">${acc}</div>
            <div class="track-stat-label">ACCURACY</div>
          </div>
          <div class="track-stat">
            <div class="track-stat-value">${brier}</div>
            <div class="track-stat-label">BRIER</div>
          </div>
        </div>
      </div>
    `;
  };

  const trackHtml = `
    <div class="track-record">
      <div class="track-record-eyebrow">v2 model · track record</div>
      <div class="track-cohorts">
        ${renderCohort(
          'LIVE',
          live.resolved === 0
            ? 'No live games resolved yet — accumulating'
            : `${live.resolved} predictions made under live conditions`,
          live,
          true
        )}
        ${backfill && backfill.resolved > 0
          ? renderCohort(
              'BACKTEST',
              `${backfill.resolved} held-out games · point-in-time state · NOT live`,
              backfill,
              false
            )
          : ''}
      </div>
      ${live.resolved < 30 && live.resolved > 0
        ? `<div class="track-disclaimer">Live sample size: ${live.resolved}. Track record will stabilize as more games resolve.</div>`
        : ''}
      ${backfill && backfill.resolved > 0
        ? `<div class="track-disclaimer">Backtest is the v2 model run retrospectively on held-out 2024-25 + 2025-26 games using only data available before each game. It is the model's calibration baseline, not a live record.</div>`
        : ''}
    </div>
  `;

  const upcomingHtml = upcoming.length === 0
    ? '<div class="empty-state">No upcoming NBA games scheduled.</div>'
    : upcoming.map(p => {
        const homeAbbr = p.home_team_id.split(':')[1] ?? p.home_team_id;
        const awayAbbr = p.away_team_id.split(':')[1] ?? p.away_team_id;
        const winnerAbbr = p.predicted_winner.split(':')[1] ?? p.predicted_winner;
        const confidence = (p.predicted_prob * 100).toFixed(0);
        const dateLabel = formatGameDate(p.game_date);
        return `
          <div class="prediction-card ${p.low_confidence ? 'low-confidence' : ''}">
            <div class="prediction-header">
              <div class="prediction-date">${dateLabel}</div>
              ${p.low_confidence ? '<div class="prediction-pill">thin data</div>' : ''}
            </div>
            <div class="prediction-matchup">
              <div class="matchup-team ${winnerAbbr === awayAbbr ? 'pick' : ''}">${awayAbbr}</div>
              <div class="matchup-at">@</div>
              <div class="matchup-team ${winnerAbbr === homeAbbr ? 'pick' : ''}">${homeAbbr}</div>
            </div>
            <div class="prediction-pick">
              <div class="pick-text">Model pick: <strong>${winnerAbbr}</strong></div>
              <div class="pick-confidence">${confidence}%</div>
            </div>
            <div class="prediction-reasoning">${p.reasoning_text}</div>
          </div>
        `;
      }).join('');

  const recentHtml = recent.length === 0
    ? ''
    : `
      <div class="recent-predictions">
        <h3 class="recent-title">Recently Resolved</h3>
        ${recent.map(p => {
          const homeAbbr = p.home_team_id.split(':')[1] ?? p.home_team_id;
          const awayAbbr = p.away_team_id.split(':')[1] ?? p.away_team_id;
          const winnerAbbr = p.predicted_winner.split(':')[1] ?? p.predicted_winner;
          const actualAbbr = p.actual_winner?.split(':')[1] ?? '';
          const correct = p.was_correct === 1;
          return `
            <div class="recent-row ${correct ? 'correct' : 'wrong'}">
              <div class="recent-icon">${correct ? '✓' : '✗'}</div>
              <div class="recent-matchup">${awayAbbr} @ ${homeAbbr}</div>
              <div class="recent-pick">picked ${winnerAbbr}</div>
              <div class="recent-actual">actual: ${actualAbbr}</div>
              <div class="recent-conf">${(p.predicted_prob * 100).toFixed(0)}%</div>
            </div>
          `;
        }).join('')}
      </div>
    `;

  container.innerHTML = `
    ${trackHtml}
    <div class="upcoming-predictions">
      <h3 class="upcoming-title">${upcoming.length > 0 ? `${upcoming.length} upcoming games` : 'No upcoming games'}</h3>
      <div class="upcoming-grid">${upcomingHtml}</div>
    </div>
    ${recentHtml}
  `;
}

async function loadPredictions(sport = 'nba'): Promise<{ upcoming: PredictionRow[]; recent: PredictionRow[]; trackRecord: TrackRecordRow }> {
  const [upcoming, recent, trackRecord] = await Promise.all([
    fetch(`${API_BASE}/api/predictions/upcoming?sport=${sport}`).then(r => r.json() as Promise<PredictionRow[]>),
    fetch(`${API_BASE}/api/predictions/recent?sport=${sport}`).then(r => r.json() as Promise<PredictionRow[]>),
    fetch(`${API_BASE}/api/predictions/track-record?sport=${sport}`).then(r => r.json() as Promise<TrackRecordRow>),
  ]);
  return { upcoming, recent, trackRecord };
}

// --- Ratchet loop results ---

interface RatchetArtifact {
  sport: string;
  runAt: string;
  trainCutoffSeason: number;
  iterations: Array<{
    iterationId: string;
    version: string;
    description: string;
    train: RatchetScore;
    test: RatchetScore;
    deltaVsPrevious?: { brier: number; accuracy: number };
  }>;
  summary: {
    bestIteration: string;
    baselineBrier: number;
    bestBrier: number;
    improvement: number;
    beatBaseline: boolean;
    significanceNote: string;
  };
}

interface RatchetScore {
  sampleSize: number;
  brier: number;
  brierCI95: [number, number];
  accuracy: number;
  accuracyCI95: [number, number];
  homeWinRate: number;
}

function renderRatchet(container: HTMLElement, data: RatchetArtifact) {
  const { iterations, summary } = data;
  const best = iterations.find(i => i.iterationId === summary.bestIteration);
  if (!best) return;

  // Chart: iteration brier on train vs test, with CI bands
  const chartWidth = 760;
  const chartHeight = 260;
  const margin = { top: 20, right: 60, bottom: 40, left: 60 };
  const plotW = chartWidth - margin.left - margin.right;
  const plotH = chartHeight - margin.top - margin.bottom;

  const allBriers = iterations.flatMap(i => [i.train.brier, i.test.brier, i.train.brierCI95[0], i.train.brierCI95[1], i.test.brierCI95[0], i.test.brierCI95[1]]);
  const maxBrier = Math.max(...allBriers) * 1.05;
  const minBrier = Math.max(0, Math.min(...allBriers) * 0.95);

  const xScale = (i: number) => margin.left + (i / Math.max(1, iterations.length - 1)) * plotW;
  const yScale = (brier: number) => margin.top + plotH - ((brier - minBrier) / (maxBrier - minBrier)) * plotH;

  // Build points/lines
  const testLine = iterations.map((it, i) => `${xScale(i)},${yScale(it.test.brier)}`).join(' ');
  const trainLine = iterations.map((it, i) => `${xScale(i)},${yScale(it.train.brier)}`).join(' ');

  // Test CI band
  const ciTop = iterations.map((it, i) => `${xScale(i)},${yScale(it.test.brierCI95[0])}`);
  const ciBot = iterations.map((it, i) => `${xScale(i)},${yScale(it.test.brierCI95[1])}`).reverse();
  const ciBand = [...ciTop, ...ciBot].join(' ');

  const iterationRows = iterations.map((it, i) => {
    const delta = it.deltaVsPrevious
      ? `${it.deltaVsPrevious.brier > 0 ? '+' : ''}${it.deltaVsPrevious.brier.toFixed(4)}`
      : '—';
    const deltaClass = it.deltaVsPrevious
      ? it.deltaVsPrevious.brier < 0 ? 'delta-down' : 'delta-up'
      : '';
    const isBest = it.iterationId === summary.bestIteration;
    return `
      <div class="iter-row ${isBest ? 'best' : ''}">
        <div class="iter-id">${it.iterationId}</div>
        <div class="iter-desc">${it.description}</div>
        <div class="iter-brier">${it.test.brier.toFixed(4)}</div>
        <div class="iter-acc">${(it.test.accuracy * 100).toFixed(1)}%</div>
        <div class="iter-delta ${deltaClass}">${delta}</div>
        ${isBest ? '<div class="iter-winner">★ KEPT</div>' : ''}
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="ratchet-summary">
      <div class="ratchet-summary-item">
        <div class="ratchet-label">BASELINE BRIER</div>
        <div class="ratchet-value">${summary.baselineBrier.toFixed(4)}</div>
        <div class="ratchet-sub">v0: pick home team</div>
      </div>
      <div class="ratchet-arrow">→</div>
      <div class="ratchet-summary-item best">
        <div class="ratchet-label">BEST BRIER</div>
        <div class="ratchet-value">${summary.bestBrier.toFixed(4)}</div>
        <div class="ratchet-sub">${summary.bestIteration}: ${best.description}</div>
      </div>
      <div class="ratchet-arrow">=</div>
      <div class="ratchet-summary-item improvement">
        <div class="ratchet-label">IMPROVEMENT</div>
        <div class="ratchet-value">−${summary.improvement.toFixed(4)}</div>
        <div class="ratchet-sub">${((summary.improvement / summary.baselineBrier) * 100).toFixed(0)}% better than baseline</div>
      </div>
    </div>

    <div class="chart">
      <svg viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="xMidYMid meet">
        <!-- CI band -->
        <polygon points="${ciBand}" fill="#64d2ff" fill-opacity="0.15" />
        <!-- Train line -->
        <polyline points="${trainLine}" fill="none" stroke="#666" stroke-width="2" stroke-dasharray="4,4" />
        <!-- Test line -->
        <polyline points="${testLine}" fill="none" stroke="#64d2ff" stroke-width="3" />
        <!-- Points -->
        ${iterations.map((it, i) => `
          <circle cx="${xScale(i)}" cy="${yScale(it.test.brier)}" r="6"
            fill="${it.iterationId === summary.bestIteration ? '#ff9f0a' : '#64d2ff'}"
            stroke="#0a0a0a" stroke-width="2" />
          <text x="${xScale(i)}" y="${chartHeight - 15}"
            text-anchor="middle" font-size="12" fill="#a3a3a3" font-family="JetBrains Mono">
            ${it.iterationId}
          </text>
          <text x="${xScale(i)}" y="${yScale(it.test.brier) - 14}"
            text-anchor="middle" font-size="11" fill="#e5e5e5" font-family="JetBrains Mono">
            ${it.test.brier.toFixed(3)}
          </text>
        `).join('')}
        <!-- Y-axis label -->
        <text x="15" y="${chartHeight / 2}" text-anchor="middle" font-size="11"
          fill="#a3a3a3" font-family="JetBrains Mono" transform="rotate(-90 15 ${chartHeight / 2})">
          Brier (lower = better)
        </text>
      </svg>
      <div class="chart-legend">
        <span class="legend-item"><span class="legend-line test"></span> Test set (2024-25+)</span>
        <span class="legend-item"><span class="legend-line train"></span> Train set (pre-2024)</span>
        <span class="legend-item"><span class="legend-band"></span> 95% bootstrap CI</span>
      </div>
    </div>

    <div class="iterations-table">
      <div class="iter-header">
        <div class="iter-id">ID</div>
        <div class="iter-desc">Description</div>
        <div class="iter-brier">Brier</div>
        <div class="iter-acc">Acc</div>
        <div class="iter-delta">Δ vs prev</div>
      </div>
      ${iterationRows}
    </div>

    <div class="ratchet-footer">
      <strong>${summary.beatBaseline ? '✓ Beats baseline' : '✗ Did not beat baseline'}.</strong>
      ${summary.significanceNote}
    </div>
  `;
}

// --- Calibration (Sprint 10) ---

interface CalibrationBin {
  binLow: number;
  binHigh: number;
  n: number;
  empty: boolean;
  predictedAvg: number;
  actualRate: number;
  ciLow: number;
  ciHigh: number;
}

interface CalibrationCohort {
  source: 'live' | 'backfill';
  n: number;
  bins: CalibrationBin[];
  populatedBins: number;
  ece: number | null;
  eceHighConfOnly: number | null;
  signedResidual: number | null;
  verdict: 'HONEST' | 'OVERCONFIDENT' | 'SHY' | 'DISCRETE' | null;
}

interface Calibration {
  modelVersion: string;
  sport: string;
  binCount: number;
  live: CalibrationCohort;
  backfill: CalibrationCohort;
}

const LIVE_THRESHOLD = 20;

function renderCalibration(container: HTMLElement, data: Calibration) {
  const { live, backfill } = data;

  if (backfill.n === 0 && live.n === 0) {
    container.innerHTML = '<div class="empty-state">No resolved predictions yet.</div>';
    return;
  }

  // Square chart — diagonal integrity (Designer mandate).
  const size = 300;
  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const plotW = size - margin.left - margin.right;
  const plotH = size - margin.top - margin.bottom;

  // Domain: x = predicted (0.5 → 1.0), y = actual (0.5 → 1.0). Symmetric square.
  const xScale = (p: number) => margin.left + ((p - 0.5) / 0.5) * plotW;
  const yScale = (p: number) => margin.top + plotH - ((p - 0.5) / 0.5) * plotH;
  const radius = (n: number) => Math.min(16, Math.max(3, Math.sqrt(n) * 0.6));

  // Diagonal: (0.5, 0.5) → (1, 1)
  const diagonal = `
    <line x1="${xScale(0.5)}" y1="${yScale(0.5)}"
          x2="${xScale(1.0)}" y2="${yScale(1.0)}"
          stroke="var(--accent-dim)" stroke-width="1" stroke-dasharray="4 4" />
  `;

  // Tick marks every 10%
  const ticks = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const xTicks = ticks.map(t => `
    <line x1="${xScale(t)}" y1="${margin.top + plotH}" x2="${xScale(t)}" y2="${margin.top + plotH + 4}" stroke="#444" />
    <text x="${xScale(t)}" y="${margin.top + plotH + 16}" text-anchor="middle" font-size="9" fill="#666" font-family="JetBrains Mono">${(t * 100).toFixed(0)}</text>
  `).join('');
  const yTicks = ticks.map(t => `
    <line x1="${margin.left - 4}" y1="${yScale(t)}" x2="${margin.left}" y2="${yScale(t)}" stroke="#444" />
    <text x="${margin.left - 8}" y="${yScale(t) + 3}" text-anchor="end" font-size="9" fill="#666" font-family="JetBrains Mono">${(t * 100).toFixed(0)}</text>
  `).join('');

  const renderCohortMarks = (cohort: CalibrationCohort, color: string): string => {
    if (cohort.n === 0) return '';
    return cohort.bins.filter(b => !b.empty).map(b => {
      const x = xScale(b.predictedAvg);
      const yPoint = yScale(b.actualRate);
      const yLow = yScale(b.ciLow);
      const yHigh = yScale(b.ciHigh);
      const r = radius(b.n);
      const ghosted = b.n < 5;
      const opacity = ghosted ? 0.35 : 1;
      const ciBar = ghosted ? '' : `
        <line x1="${x}" y1="${yLow}" x2="${x}" y2="${yHigh}" stroke="${color}" stroke-width="1" opacity="0.6" />
        <line x1="${x - 3}" y1="${yLow}" x2="${x + 3}" y2="${yLow}" stroke="${color}" stroke-width="1" opacity="0.6" />
        <line x1="${x - 3}" y1="${yHigh}" x2="${x + 3}" y2="${yHigh}" stroke="${color}" stroke-width="1" opacity="0.6" />
      `;
      return `
        ${ciBar}
        <circle cx="${x}" cy="${yPoint}" r="${r}" fill="${color}" fill-opacity="${0.3 * opacity}" stroke="${color}" stroke-width="2" stroke-opacity="${opacity}" />
        <text x="${x}" y="${yPoint - r - 4}" text-anchor="middle" font-size="9" fill="#a3a3a3" font-family="JetBrains Mono">n=${b.n}</text>
      `;
    }).join('');
  };

  const backfillMarks = renderCohortMarks(backfill, '#64d2ff'); // --accent
  const liveMarks = live.n >= LIVE_THRESHOLD ? renderCohortMarks(live, '#ff9f0a') : ''; // --spotlight

  const verdictClass = (v: string | null): string => {
    if (v === 'HONEST') return 'verdict-honest';
    if (v === 'OVERCONFIDENT') return 'verdict-over';
    if (v === 'SHY') return 'verdict-shy';
    if (v === 'DISCRETE') return 'verdict-discrete';
    return '';
  };

  const primary = backfill.n > 0 ? backfill : live;
  const primaryLabel = backfill.n > 0 ? 'BACKTEST' : 'LIVE';
  const eceText = primary.ece !== null ? primary.ece.toFixed(4) : '—';
  const verdictText = primary.verdict ?? '—';
  const eceHCText = primary.eceHighConfOnly !== null && primary.eceHighConfOnly !== primary.ece
    ? primary.eceHighConfOnly.toFixed(4)
    : null;
  const totalBins = primary.bins.length;
  const populatedText = `${primary.populatedBins} of ${totalBins} bins populated`;

  const summaryHtml = `
    <div class="calibration-summary">
      <div class="calibration-hero">
        <div class="calibration-ece-label">EXPECTED CALIBRATION ERROR</div>
        <div class="calibration-ece-value">${eceText}</div>
        <div class="calibration-verdict ${verdictClass(verdictText)}">${verdictText}</div>
        <div class="calibration-cohort-label">${primaryLabel} · n=${primary.n} · ${populatedText}</div>
      </div>
      ${eceHCText ? `<div class="calibration-secondary">High-confidence-only ECE: <strong>${eceHCText}</strong></div>` : ''}
    </div>
  `;

  // Council mandate (Designer + Researcher impl review): if the primary cohort
  // is discrete (only a few bins populated), explain the chart's apparent
  // sparseness — that IS the finding.
  const discreteFootnote = primary.populatedBins > 0 && primary.populatedBins <= 3
    ? `<div class="calibration-footnote">v2 model emits ${primary.populatedBins} discrete confidence value${primary.populatedBins === 1 ? '' : 's'} — ${totalBins - primary.populatedBins} of ${totalBins} bins empty by design.</div>`
    : '';

  const liveFootnote = live.n > 0 && live.n < LIVE_THRESHOLD
    ? `<div class="calibration-footnote">Live cohort: ${live.n} resolved prediction${live.n === 1 ? '' : 's'}. Shown when n ≥ ${LIVE_THRESHOLD}.</div>`
    : '';

  const legendLive = live.n >= LIVE_THRESHOLD
    ? '<span class="legend-item"><span class="legend-dot" style="background:#ff9f0a"></span> Live</span>'
    : '';

  container.innerHTML = `
    ${summaryHtml}
    <div class="chart calibration-chart">
      <svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet">
        <!-- diagonal first so dots overlay -->
        ${diagonal}
        <!-- axes -->
        <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="#444" />
        <line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="#444" />
        ${xTicks}
        ${yTicks}
        <!-- labels -->
        <text x="${margin.left + plotW / 2}" y="${size - 5}" text-anchor="middle" font-size="10" fill="#a3a3a3" font-family="JetBrains Mono">predicted % →</text>
        <text x="12" y="${margin.top + plotH / 2}" text-anchor="middle" font-size="10" fill="#a3a3a3" font-family="JetBrains Mono" transform="rotate(-90 12 ${margin.top + plotH / 2})">↑ actual %</text>
        <!-- data -->
        ${backfillMarks}
        ${liveMarks}
      </svg>
      <div class="chart-legend">
        <span class="legend-item"><span class="legend-line" style="background:transparent;border-top:1px dashed var(--text-muted);width:20px"></span> Perfect calibration</span>
        <span class="legend-item"><span class="legend-dot" style="background:#64d2ff"></span> Backtest</span>
        ${legendLive}
      </div>
      ${discreteFootnote}
      ${liveFootnote}
    </div>
  `;
}

async function loadCalibration(sport = 'nba'): Promise<Calibration | null> {
  try {
    const res = await fetch(`${API_BASE}/api/predictions/calibration?sport=${sport}`);
    if (!res.ok) return null;
    return await res.json() as Calibration;
  } catch {
    return null;
  }
}

async function loadRatchet(sport = 'nba'): Promise<RatchetArtifact | null> {
  try {
    const res = await fetch(`${API_BASE}/api/ratchet?sport=${sport}`);
    const data = await res.json();
    if ('error' in data) return null;
    return data as RatchetArtifact;
  } catch {
    return null;
  }
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

function renderHeroCard(hero: PlayerHero, totalQualified: number): string {
  const contextHtml = hero.contextStats.map(s => `
    <div class="hero-context-stat">
      <div class="hero-context-label">${s.label}</div>
      <div class="hero-context-value">${s.value}</div>
    </div>
  `).join('');

  // Council mandate: per-team accent colors with sport fallback
  const colors = getTeamColor(hero.sport, hero.team);

  // Council mandate: ranking badge with explicit denominator
  // Council mandate: large team abbr bg >40% card height
  return `
    <div class="hero-card" style="--team-primary: ${colors.primary}; --team-secondary: ${colors.secondary};">
      <div class="hero-card-bg-abbr">${hero.team}</div>
      <div class="hero-card-content">
        <div class="hero-card-eyebrow">${hero.category}</div>
        <div class="hero-card-name">${hero.name}</div>
        <div class="hero-card-meta">${hero.team} · ${hero.position}</div>
        <div class="hero-card-primary">
          <div class="hero-primary-value">${hero.primaryStat.value}</div>
          <div class="hero-primary-label">${hero.primaryStat.label}</div>
        </div>
        <div class="hero-card-context">${contextHtml}</div>
        <div class="hero-card-badge" title="Top of ${totalQualified} qualified players in this category. ${hero.qualifier}.">
          <span class="badge-rank">#1</span>
          <span class="badge-of">of ${totalQualified}</span>
          <span class="badge-qualifier">${hero.qualifier}</span>
        </div>
      </div>
    </div>
  `;
}

function renderSportBlock(sport: string, data: SportData, totalCount: number): string {
  const { hero, findings } = data;

  // Group by category
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
      ${hero ? renderHeroCard(hero, totalCount) : ''}
      <div class="leaderboards">${categoryBlocks}</div>
    </div>
  `;
}

const SPORT_TAB_STORAGE_KEY = 'sportsdata.activeSport';

function readActiveSport(available: string[]): string {
  // Council mandate (Designer): localStorage persistence, default in-season
  try {
    const saved = localStorage.getItem(SPORT_TAB_STORAGE_KEY);
    if (saved && available.includes(saved)) return saved;
  } catch {
    /* localStorage unavailable (private mode) — fall through */
  }
  // Default: NBA (in-season), or first available
  return available.includes('nba') ? 'nba' : available[0]!;
}

function persistActiveSport(sport: string): void {
  try {
    localStorage.setItem(SPORT_TAB_STORAGE_KEY, sport);
  } catch {
    /* ignore */
  }
}

function renderPlayerSection(container: HTMLElement, allPlayers: Map<string, SportData>, counts: Record<string, number>) {
  const sports = SPORT_ORDER.filter(s => allPlayers.has(s));
  if (sports.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted)">No player data yet.</p>';
    return;
  }

  let activeSport = readActiveSport(sports);

  const renderTabs = (active: string): string => sports.map(sport => {
    const count = counts[sport] ?? 0;
    const label = (SPORT_LABELS[sport] ?? sport).split(' · ')[0];
    return `
      <button class="sport-tab ${sport === active ? 'active' : ''}" data-sport="${sport}">
        <span class="sport-tab-label">${label}</span>
        <span class="sport-tab-count">${count}</span>
      </button>
    `;
  }).join('');

  const renderActive = (sport: string): string => {
    const data = allPlayers.get(sport)!;
    return renderSportBlock(sport, data, counts[sport] ?? 0);
  };

  const update = () => {
    const tabsEl = container.querySelector('.sport-tabs')!;
    const contentEl = container.querySelector('.sport-tab-content')!;
    tabsEl.innerHTML = renderTabs(activeSport);
    contentEl.innerHTML = renderActive(activeSport);
    bindTabs();
  };

  const bindTabs = () => {
    container.querySelectorAll<HTMLButtonElement>('.sport-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.sport;
        if (next && next !== activeSport) {
          activeSport = next;
          persistActiveSport(activeSport);
          update();
        }
      });
    });
  };

  container.innerHTML = `
    <div class="sport-tabs">${renderTabs(activeSport)}</div>
    <div class="sport-tab-content">${renderActive(activeSport)}</div>
  `;
  bindTabs();
}

// --- Findings ranked list ---

function renderFindingCard(f: Finding, i: number): string {
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
}

function renderFindings(container: HTMLElement, findings: Finding[]) {
  // Council mandate: top 10 visible, rest in <details>.
  // Findings come pre-sorted by surpriseScore from API.
  const top = findings.slice(0, 10);
  const rest = findings.slice(10);

  const topHtml = top.map((f, i) => renderFindingCard(f, i)).join('');
  const restHtml = rest.length > 0 ? `
    <details class="findings-more">
      <summary>show ${rest.length} more findings</summary>
      <div class="findings-grid findings-grid-rest">
        ${rest.map((f, i) => renderFindingCard(f, i + 10)).join('')}
      </div>
    </details>
  ` : '';

  container.innerHTML = topHtml + restHtml;
}

// --- Boot ---

async function main() {
  try {
    const [stats, margins, findings, sequences, extremes, allSportData, playerCounts, ratchet, predictions, calibration] = await Promise.all([
      fetchJson<Stats>('/api/stats'),
      fetchJson<{ margin: number; count: number }[]>('/api/margins'),
      fetchJson<Finding[]>('/api/findings'),
      fetchJson<TeamSequence[]>('/api/team-sequences'),
      fetchJson<{ blowouts: Game[]; nailBiters: Game[] }>('/api/extreme-games'),
      loadAllSportData(),
      fetch(`${API_BASE}/api/player-counts`).then(r => r.json() as Promise<Record<string, number>>),
      loadRatchet('nba'),
      loadPredictions('nba'),
      loadCalibration('nba'),
    ]);

    const totalGames = stats.total_games;
    const homeWinPct = ((stats.home_wins / totalGames) * 100).toFixed(1);

    // Derive season range from sequences (SeasonRow.year is the starting year,
    // e.g. 2023 → "2023-24"). Used by the hero and the footer.
    const allSeasons = new Set<number>();
    sequences.forEach(t => t.seasons.forEach(s => allSeasons.add(s.year)));
    const sortedSeasons = Array.from(allSeasons).sort((a, b) => a - b);
    const firstSeason = sortedSeasons[0];
    const lastSeason = sortedSeasons[sortedSeasons.length - 1];
    const seasonCount = sortedSeasons.length;
    const seasonRangeLabel = firstSeason === lastSeason
      ? `${firstSeason}-${String(firstSeason + 1).slice(-2)} season`
      : `${firstSeason}-${String(firstSeason + 1).slice(-2)} through ${lastSeason}-${String(lastSeason + 1).slice(-2)}`;

    // Hero
    document.getElementById('hero-title')!.innerHTML =
      `${totalGames.toLocaleString()}<br>NBA games.`;

    // Footer (dynamic — was hardcoded and drifted stale)
    document.getElementById('footer-stats')!.textContent =
      `${totalGames.toLocaleString()} NBA games · ${seasonRangeLabel}`;

    const seasonWord = seasonCount === 1 ? 'One season' :
      seasonCount === 2 ? 'Two seasons' :
      seasonCount === 3 ? 'Three seasons' :
      `${seasonCount} seasons`;
    document.getElementById('hero-text')!.innerHTML = `
      ${seasonWord}. Every game scraped, every result resolved.
      <span class="number">${findings.filter(f => f.spotlight).length}</span> spotlight findings,
      including a <span class="highlight">${stats.max_margin}-point blowout</span>
      and a <span class="highlight">28-game losing streak</span>.
    `;

    // Big stats
    document.getElementById('big-stats')!.innerHTML = `
      <div class="big-stat">
        <div class="big-stat-label">Total games</div>
        <div class="big-stat-value">${totalGames.toLocaleString()}</div>
        <div class="big-stat-detail">${seasonCount} seasons · 30 teams</div>
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
    renderPredictions(
      document.getElementById('predictions-section')!,
      predictions.upcoming, predictions.recent, predictions.trackRecord
    );
    if (ratchet) {
      renderRatchet(document.getElementById('ratchet-section')!, ratchet);
    } else {
      document.getElementById('ratchet-section')!.innerHTML =
        '<p style="color: var(--text-muted)">Ratchet run not available. Run `npm run ratchet` to generate.</p>';
    }
    if (calibration) {
      renderCalibration(document.getElementById('calibration-section')!, calibration);
    } else {
      document.getElementById('calibration-section')!.innerHTML =
        '<p style="color: var(--text-muted)">Calibration unavailable.</p>';
    }
    renderPlayerSection(document.getElementById('players-section')!, allSportData, playerCounts);

  } catch (err) {
    document.getElementById('hero-title')!.textContent = 'Failed to load data';
    document.getElementById('hero-text')!.textContent = err instanceof Error ? err.message : String(err);
  }
}

main();
