/**
 * Main entry — fetches data, renders dark-mode visualizations.
 */

import * as Plot from '@observablehq/plot';
import { getTeamColor } from './team-colors.js';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

/**
 * P1-1: Escape HTML entities in API-sourced strings before innerHTML interpolation.
 * Prevents XSS if any upstream data contains <script> or HTML entities.
 * WARNING: Do NOT use escaped strings in unquoted HTML attributes.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Global sport state ---

const SPORT_ORDER = ['nba', 'nfl', 'mlb', 'nhl', 'epl', 'mls'];

const SPORT_LABELS: Record<string, string> = {
  nba: 'NBA · Basketball',
  nfl: 'NFL · Football',
  mlb: 'MLB · Baseball',
  nhl: 'NHL · Hockey',
  mls: 'MLS · Soccer',
  epl: 'Premier League',
};

const SPORT_TERMINOLOGY: Record<string, {
  unit: string;
  unitSingular: string;
  gameNoun: string;
  leagueName: string;
  minGamesFilter: number;
  teamCount: string;
  diffLabel: string;
}> = {
  nba: { unit: 'points', unitSingular: 'point', gameNoun: 'games', leagueName: 'NBA', minGamesFilter: 50, teamCount: '30 teams', diffLabel: 'point diff' },
  nfl: { unit: 'points', unitSingular: 'point', gameNoun: 'games', leagueName: 'NFL', minGamesFilter: 12, teamCount: '32 teams', diffLabel: 'point diff' },
  mlb: { unit: 'runs', unitSingular: 'run', gameNoun: 'games', leagueName: 'MLB', minGamesFilter: 100, teamCount: '30 teams', diffLabel: 'run diff' },
  nhl: { unit: 'goals', unitSingular: 'goal', gameNoun: 'games', leagueName: 'NHL', minGamesFilter: 50, teamCount: '32 teams', diffLabel: 'goal diff' },
  mls: { unit: 'goals', unitSingular: 'goal', gameNoun: 'matches', leagueName: 'MLS', minGamesFilter: 20, teamCount: '30 teams', diffLabel: 'goal diff' },
  epl: { unit: 'goals', unitSingular: 'goal', gameNoun: 'matches', leagueName: 'Premier League', minGamesFilter: 25, teamCount: '20 teams', diffLabel: 'goal diff' },
};

const GLOBAL_SPORT_KEY = 'sportsdata.activeSport';

function readGlobalSport(): string {
  try {
    const saved = localStorage.getItem(GLOBAL_SPORT_KEY);
    if (saved && SPORT_ORDER.includes(saved)) return saved;
  } catch { /* private mode fallback */ }
  return 'nba';
}

function persistGlobalSport(sport: string): void {
  try {
    localStorage.setItem(GLOBAL_SPORT_KEY, sport);
  } catch { /* ignore */ }
}

let currentSport: string = readGlobalSport();

function sportTerm() {
  return SPORT_TERMINOLOGY[currentSport] ?? SPORT_TERMINOLOGY['nba'];
}

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
  const res = await fetch(`${API_BASE}${path}?sport=${currentSport}`);
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
    const w = esc(biggest.winner.split(':')[1] ?? biggest.winner);
    const l = esc(biggest.loser.split(':')[1] ?? biggest.loser);
    cards.push(`
      <div class="callout spotlight">
        <div class="callout-label">★ Biggest blowout</div>
        <div class="callout-headline">${w} ${biggest.home_score}, ${l} ${biggest.away_score}</div>
        <div class="callout-detail">${biggest.date.slice(0, 10)} · ${w} won by <strong>${biggest.margin}</strong> ${sportTerm().unit}. The biggest margin in the dataset.</div>
      </div>
    `);
  }

  // Closest game
  const closest = data.nailBiters[0];
  if (closest) {
    const w = esc(closest.winner.split(':')[1] ?? closest.winner);
    const l = esc(closest.loser.split(':')[1] ?? closest.loser);
    cards.push(`
      <div class="callout">
        <div class="callout-label">Closest game</div>
        <div class="callout-headline">${w} ${closest.home_score}, ${l} ${closest.away_score}</div>
        <div class="callout-detail">${closest.date.slice(0, 10)} · ${
          currentSport === 'mlb' ? 'One run. That\'s all that separated them.'
          : currentSport === 'nfl' ? 'Decided by a single point — rarer than you\'d think.'
          : currentSport === 'mls' || currentSport === 'epl' ? 'One goal. The most common winning margin in the sport.'
          : 'One point. One possession. One moment.'
        }</div>
      </div>
    `);
  }

  // Other blowouts
  for (const b of data.blowouts.slice(1, 4)) {
    const w = esc(b.winner.split(':')[1] ?? b.winner);
    const l = esc(b.loser.split(':')[1] ?? b.loser);
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
      .filter(x => x.season && x.season.sequence.length >= sportTerm().minGamesFilter)
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
  pitchers_json?: string | null;
  odds_json?: string | null;
  game_updated_at?: string | null;
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
  // P2-6: Compare date-only strings to avoid timezone off-by-one
  const gameDate = iso.slice(0, 10);
  const todayDate = new Date().toISOString().slice(0, 10);
  const diffDays = Math.round((new Date(gameDate + 'T12:00:00').getTime() - new Date(todayDate + 'T12:00:00').getTime()) / 86400000);
  if (diffDays === 0) return 'TONIGHT';
  if (diffDays === 1) return 'TOMORROW';
  if (diffDays === -1) return 'YESTERDAY';
  if (diffDays > 1 && diffDays < 7) return `IN ${diffDays} DAYS`;
  // Codex fix: format directly from YYYY-MM-DD without UTC Date parsing
  // (new Date('2026-04-13') parses as UTC midnight, toLocaleDateString shifts backward in US TZ)
  const [, month, day] = gameDate.split('-');
  const MONTHS = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${MONTHS[parseInt(month, 10)]} ${parseInt(day, 10)}`;
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
    const drawNote = (currentSport === 'mls' || currentSport === 'epl') ? ' (excl. draws)' : '';
    return `
      <div class="track-cohort ${isLive ? 'cohort-live' : 'cohort-backfill'}">
        <div class="track-cohort-header">
          <div class="track-cohort-label">${label}</div>
          <div class="track-cohort-sub">${sublabel}</div>
        </div>
        <div class="track-cohort-stats">
          <div class="track-stat">
            <div class="track-stat-value">${cohort.correct}<span class="track-stat-sep">–</span>${cohort.resolved - cohort.correct}</div>
            <div class="track-stat-label">RECORD${drawNote}</div>
          </div>
          <div class="track-stat">
            <div class="track-stat-value">${acc}</div>
            <div class="track-stat-label">ACCURACY${drawNote}</div>
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
      <div class="track-record-eyebrow">v5 model · track record</div>
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
        ? `<div class="track-disclaimer">Backtest is the model run retrospectively on held-out games using only data available before each game. It is the model's calibration baseline, not a live record.</div>`
        : ''}
    </div>
  `;

  const upcomingHtml = upcoming.length === 0
    ? `<div class="empty-state">No upcoming ${sportTerm().leagueName} ${sportTerm().gameNoun} scheduled.</div>`
    : upcoming.map(p => {
        const homeAbbr = p.home_team_id.split(':')[1] ?? p.home_team_id;
        const awayAbbr = p.away_team_id.split(':')[1] ?? p.away_team_id;
        const winnerAbbr = p.predicted_winner.split(':')[1] ?? p.predicted_winner;
        const confidence = (p.predicted_prob * 100).toFixed(0);
        const dateLabel = formatGameDate(p.game_date);
        // MLB pitcher display
        let pitcherHtml = '';
        if (currentSport === 'mlb' && p.pitchers_json) {
          try {
            const pitchers = JSON.parse(p.pitchers_json) as {
              home?: { name: string; era: number; record?: string };
              away?: { name: string; era: number; record?: string };
            };
            const hp = pitchers.home;
            const ap = pitchers.away;
            if (hp || ap) {
              pitcherHtml = `<div class="prediction-pitchers">
                ${ap ? `<span class="pitcher">${esc(ap.name)} (${ap.era.toFixed(2)} ERA)</span>` : ''}
                <span class="pitcher-vs">vs</span>
                ${hp ? `<span class="pitcher">${esc(hp.name)} (${hp.era.toFixed(2)} ERA)</span>` : ''}
              </div>`;
            }
          } catch { /* ignore */ }
        }

        // Vegas odds display (debt #4)
        let oddsHtml = '';
        if (p.odds_json) {
          try {
            const raw = JSON.parse(p.odds_json);
            // Runtime shape validation — skip silently if malformed
            const odds = (raw && typeof raw === 'object') ? raw as {
              spread?: { favorite: string; line: number };
              moneyline?: { home: number; away: number };
              overUnder?: number;
            } : null;
            if (odds) {
              const parts: string[] = [];
              if (odds.spread && typeof odds.spread.favorite === 'string' && typeof odds.spread.line === 'number') {
                const favAbbr = odds.spread.favorite.split(':')[1] ?? odds.spread.favorite;
                parts.push(`${esc(favAbbr)} ${odds.spread.line > 0 ? '+' : ''}${odds.spread.line.toFixed(1)}`);
              }
              if (odds.moneyline && typeof odds.moneyline.home === 'number' && typeof odds.moneyline.away === 'number') {
                const ml = odds.moneyline;
                const homeML = ml.home > 0 ? `+${ml.home}` : `${ml.home}`;
                const awayML = ml.away > 0 ? `+${ml.away}` : `${ml.away}`;
                parts.push(`${homeAbbr} ${homeML} / ${awayAbbr} ${awayML}`);
              }
              if (typeof odds.overUnder === 'number') {
                parts.push(`o/u ${odds.overUnder.toFixed(1)}`);
              }
              if (parts.length > 0) {
                const updatedAt = p.game_updated_at ? new Date(p.game_updated_at) : null;
                const ageHours = updatedAt ? (Date.now() - updatedAt.getTime()) / 3600000 : null;
                const stale = ageHours !== null && ageHours > 4;
                const ageLabel = updatedAt
                  ? `as of ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : '';
                oddsHtml = `<div class="prediction-odds${stale ? ' odds-stale' : ''}">
                  Vegas: ${parts.join(' · ')}${ageLabel ? ` <span class="odds-age">(${esc(ageLabel)}${stale ? ' — may be stale' : ''})</span>` : ''}
                </div>`;
              }
            }
          } catch { /* ignore */ }
        }

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
            ${pitcherHtml}
            ${oddsHtml}
            <div class="prediction-pick">
              <div class="pick-text">Model pick: <strong>${winnerAbbr}</strong></div>
              <div class="pick-confidence">${confidence}%</div>
            </div>
            <div class="prediction-reasoning">${esc(p.reasoning_text)}</div>
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

async function loadPredictions(sport = currentSport): Promise<{ upcoming: PredictionRow[]; recent: PredictionRow[]; trackRecord: TrackRecordRow }> {
  const [upcoming, recent, trackRecord] = await Promise.all([
    fetch(`${API_BASE}/api/predictions/upcoming?sport=${sport}`).then(r => r.json() as Promise<PredictionRow[]>),
    fetch(`${API_BASE}/api/predictions/recent?sport=${sport}`).then(r => r.json() as Promise<PredictionRow[]>),
    fetch(`${API_BASE}/api/predictions/track-record?sport=${sport}`).then(r => r.json() as Promise<TrackRecordRow>),
  ]);
  return { upcoming, recent, trackRecord };
}

// --- Spread picks ---

interface SpreadPickRow {
  id: string;
  game_id: string;
  sport: string;
  predicted_winner: string;
  reasoning_text: string;
  reasoning_json: string;
  resolved_at: string | null;
  was_correct: number | null;
  low_confidence: number;
  game_date: string;
  home_team_id: string;
  away_team_id: string;
  game_status: string;
}

interface SpreadTrackRecord {
  sport: string;
  totalPicks: number;
  correct: number;
  accuracy: number;
  roi: number;
  strongPicks: { total: number; correct: number; accuracy: number };
  leanPicks: { total: number; correct: number; accuracy: number };
}

interface SpreadReasoning {
  spread?: {
    predicted_margin: number;
    spread_line: number;
    edge: number;
    abs_edge: number;
    confidence_tier: string;
    pick_side: string;
  };
  features?: {
    home_out_impact?: number;
    away_out_impact?: number;
  };
}

function renderSpreadPicks(
  container: HTMLElement,
  picks: SpreadPickRow[],
  trackRecord: SpreadTrackRecord,
) {
  const term = sportTerm();

  // Disclaimer — council mandate: no "safe to bet" language, unbacktested.
  // Injury-adjusted availability varies by league: ESPN feed covers NA leagues;
  // MLS/EPL are NOT injury-adjusted (council Domain Expert mandate — soccer
  // lineups release <1h before kickoff; no public feed).
  const soccerBlind = term.leagueName === 'MLS' || term.leagueName === 'Premier League';
  const disclaimerHtml = `
    <div class="spread-disclaimer">
      Experimental model (v4-spread, launched 2026-04-12) — no backtesting, no proven edge.
      Break-even at -110 vig is 52.4%. Track record accumulates live and may not be statistically
      meaningful until 100+ picks resolve. All picks prior to this version are invalidated.
      ${term.leagueName === 'MLB' ? 'Uses starting pitcher ERA (conservative 0.3 runs/ERA gap). Does not model bullpen or park factors. Injury-adjusted for position players. '
        : term.leagueName === 'NHL' ? 'Does not account for goalie matchups. Injury-adjusted for skaters. '
        : soccerBlind ? 'Draw probability is not modeled. <strong>Injury-adjusted: no</strong> (no public lineup feed for this league). '
        : term.leagueName === 'NBA' || term.leagueName === 'NFL' ? 'Injury-adjusted (ESPN feed). '
        : ''}This is not financial advice.
    </div>
  `;

  // Track record summary — gated at N >= 30 per council statistical validity mandate
  const trackHtml = trackRecord.totalPicks >= 30
    ? `<div class="spread-track-record">
         <div class="spread-track-title">Spread Track Record (${trackRecord.totalPicks} picks resolved)</div>
         <div class="spread-track-stats">
           <div class="spread-stat">
             <div class="spread-stat-value">${trackRecord.correct}-${trackRecord.totalPicks - trackRecord.correct}</div>
             <div class="spread-stat-label">ATS Record</div>
           </div>
           <div class="spread-stat">
             <div class="spread-stat-value">${(trackRecord.accuracy * 100).toFixed(1)}%</div>
             <div class="spread-stat-label">Accuracy</div>
           </div>
           <div class="spread-stat">
             <div class="spread-stat-value ${trackRecord.roi >= 0 ? 'positive' : 'negative'}">${trackRecord.roi >= 0 ? '+' : ''}${(trackRecord.roi * 100).toFixed(1)}%</div>
             <div class="spread-stat-label">ROI at -110</div>
           </div>
           ${trackRecord.strongPicks.total > 0 ? `
           <div class="spread-stat">
             <div class="spread-stat-value">${(trackRecord.strongPicks.accuracy * 100).toFixed(0)}%</div>
             <div class="spread-stat-label">Strong picks (${trackRecord.strongPicks.total})</div>
           </div>` : ''}
         </div>
       </div>`
    : '';

  // Filter to strong + lean only (skip 'skip' tier)
  const actionablePicks = picks.filter(p => {
    try {
      const rj = JSON.parse(p.reasoning_json) as SpreadReasoning;
      return rj.spread?.confidence_tier !== 'skip';
    } catch { return true; }
  });

  const picksHtml = actionablePicks.length === 0
    ? `<div class="empty-state">No actionable spread picks for upcoming ${term.leagueName} ${term.gameNoun}. Picks require odds data and a meaningful edge vs the line.</div>`
    : actionablePicks.map(p => {
        const homeAbbr = p.home_team_id.split(':')[1] ?? p.home_team_id;
        const awayAbbr = p.away_team_id.split(':')[1] ?? p.away_team_id;
        const dateLabel = formatGameDate(p.game_date);

        let reasoning: SpreadReasoning | undefined;
        try {
          reasoning = JSON.parse(p.reasoning_json) as SpreadReasoning;
        } catch { /* ignore */ }
        const spread = reasoning?.spread;

        const tier = spread?.confidence_tier ?? 'skip';
        const pickAbbr = spread?.pick_side === 'home' ? homeAbbr : awayAbbr;
        const marginStr = spread
          ? (spread.predicted_margin >= 0
              ? `${homeAbbr} by ${spread.predicted_margin.toFixed(1)}`
              : `${awayAbbr} by ${(-spread.predicted_margin).toFixed(1)}`)
          : '';
        const lineStr = spread
          ? (spread.spread_line < 0
              ? `${homeAbbr} ${spread.spread_line.toFixed(1)}`
              : `${awayAbbr} ${(-spread.spread_line).toFixed(1)}`)
          : '';
        const edgeStr = spread ? Math.abs(spread.edge).toFixed(1) : '?';

        // Injury adjustment display (council Prediction Accuracy mandate):
        // When injury signal shifted the margin, surface it so users understand
        // tonight's pick differs from what a pure team-differential model would say.
        const homeOut = reasoning?.features?.home_out_impact ?? 0;
        const awayOut = reasoning?.features?.away_out_impact ?? 0;
        const hasInjuryAdj = homeOut > 0 || awayOut > 0;
        const injuryRowHtml = hasInjuryAdj ? `
              <div class="spread-detail-row spread-injury-row">
                <span class="spread-label">Injuries</span>
                <span class="spread-value spread-injury-value">
                  ${homeOut > 0 ? `${homeAbbr} −${homeOut.toFixed(1)}` : ''}${homeOut > 0 && awayOut > 0 ? ' · ' : ''}${awayOut > 0 ? `${awayAbbr} −${awayOut.toFixed(1)}` : ''}
                  <span class="spread-injury-hint">${term.unit} of missing player impact</span>
                </span>
              </div>` : '';

        return `
          <div class="spread-card tier-${tier}">
            <div class="spread-card-header">
              <div class="prediction-date">${dateLabel}</div>
              <div class="edge-badge tier-${tier}">${tier === 'strong' ? 'STRONG' : 'LEAN'}</div>
            </div>
            <div class="prediction-matchup">
              <div class="matchup-team ${spread?.pick_side === 'away' ? 'pick' : ''}">${awayAbbr}</div>
              <div class="matchup-at">@</div>
              <div class="matchup-team ${spread?.pick_side === 'home' ? 'pick' : ''}">${homeAbbr}</div>
            </div>
            <div class="spread-details">
              <div class="spread-detail-row">
                <span class="spread-label">Pick</span>
                <span class="spread-value"><strong>${pickAbbr}</strong> to cover</span>
              </div>
              <div class="spread-detail-row">
                <span class="spread-label">Line</span>
                <span class="spread-value">${lineStr}</span>
              </div>
              <div class="spread-detail-row">
                <span class="spread-label">Model</span>
                <span class="spread-value">${marginStr}</span>
              </div>
              <div class="spread-detail-row">
                <span class="spread-label">Edge</span>
                <span class="spread-value edge-value">${edgeStr} ${term.unit}</span>
              </div>${injuryRowHtml}
            </div>
          </div>
        `;
      }).join('');

  container.innerHTML = `
    ${disclaimerHtml}
    ${trackHtml}
    <div class="spread-picks-grid">${picksHtml}</div>
  `;
}

async function loadSpreadPicks(sport = currentSport): Promise<{ picks: SpreadPickRow[]; trackRecord: SpreadTrackRecord }> {
  const [picks, trackRecord] = await Promise.all([
    fetch(`${API_BASE}/api/spread-picks/upcoming?sport=${sport}`).then(r => r.json() as Promise<SpreadPickRow[]>),
    fetch(`${API_BASE}/api/spread-picks/track-record?sport=${sport}`).then(r => r.json() as Promise<SpreadTrackRecord>),
  ]);
  return { picks, trackRecord };
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
    ? `<div class="calibration-footnote">Model emits ${primary.populatedBins} confidence value${primary.populatedBins === 1 ? '' : 's'} — ${totalBins - primary.populatedBins} of ${totalBins} bins empty.</div>`
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

async function loadCalibration(sport = currentSport): Promise<Calibration | null> {
  try {
    const res = await fetch(`${API_BASE}/api/predictions/calibration?sport=${sport}`);
    if (!res.ok) return null;
    return await res.json() as Calibration;
  } catch {
    return null;
  }
}

async function loadRatchet(sport = currentSport): Promise<RatchetArtifact | null> {
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
          <span class="name">${esc(f.playerName)}</span>
          <span class="meta">${f.team} · ${f.position || '—'}</span>
        </div>
        <div class="player-stat">
          <div class="stat-value">${esc(f.headline)}</div>
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

function renderPlayerSection(container: HTMLElement, allPlayers: Map<string, SportData>, counts: Record<string, number>) {
  const sports = SPORT_ORDER.filter(s => allPlayers.has(s));
  if (sports.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted)">No player data yet.</p>';
    return;
  }

  // If the globally selected sport has no player data, show an empty state
  // for that sport rather than silently displaying another sport's data.
  if (!sports.includes(currentSport)) {
    const term = sportTerm();
    container.innerHTML = `<p style="color: var(--text-muted)">No player data for ${term.leagueName} yet. Data accumulates as games are scraped.</p>`;
    return;
  }

  let activeSport = currentSport;

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
        <div class="finding-headline">${esc(f.headline)}</div>
        <div class="finding-detail">${esc(f.detail)}</div>
        ${f.spotlight ? `<div class="finding-hint">${esc(f.narrativeHint)}</div>` : ''}
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

// --- Global sport selector ---

function renderGlobalSportSelector(): void {
  const hero = document.querySelector('.hero')!;
  const selectorDiv = document.createElement('div');
  selectorDiv.className = 'global-sport-selector';
  selectorDiv.id = 'global-sport-selector';
  hero.parentElement!.insertBefore(selectorDiv, hero);
  updateGlobalSportSelector();
}

function updateGlobalSportSelector(): void {
  const container = document.getElementById('global-sport-selector')!;
  const tabs = SPORT_ORDER.map(sport => {
    const label = (SPORT_LABELS[sport] ?? sport).split(' · ')[0];
    return `
      <button class="sport-tab ${sport === currentSport ? 'active' : ''}" data-sport="${sport}">
        <span class="sport-tab-label">${label}</span>
      </button>
    `;
  }).join('');

  container.innerHTML = `<div class="sport-tabs global-tabs">${tabs}</div>`;

  container.querySelectorAll<HTMLButtonElement>('.sport-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.sport;
      if (next && next !== currentSport) {
        currentSport = next;
        persistGlobalSport(currentSport);
        updateGlobalSportSelector();
        loadAndRenderAll();
      }
    });
  });
}

// --- Boot ---

/** Generation counter — prevents stale fetches from overwriting fresh renders
 *  when the user switches sports rapidly. */
let renderGeneration = 0;

async function loadAndRenderAll() {
  const gen = ++renderGeneration;
  const term = sportTerm();

  // Update dynamic text that doesn't depend on fetched data
  document.title = `sportsdata — ${term.leagueName}`;
  document.getElementById('hero-eyebrow')!.textContent = `sportsdata · ${term.leagueName}`;
  document.getElementById('hero-title')!.innerHTML = 'Loading...';
  document.getElementById('hero-text')!.textContent = '';

  // Update section lead text
  const histLead = document.getElementById('histogram-lead');
  if (histLead) histLead.textContent =
    `The shape of normal. Most ${term.leagueName} ${term.gameNoun} are decided by single digits. A handful are decided by much more. Here's the histogram.`;
  const streakLead = document.getElementById('streak-lead');
  if (streakLead) streakLead.textContent =
    `The cleanest signal in ${term.leagueName}: ${term.diffLabel} per ${term.gameNoun === 'matches' ? 'match' : 'game'}. Top 5 and bottom 5 each season — the rest hidden by default. Wins green, losses red, read left-to-right. Older seasons collapsed.`;
  const predLead = document.getElementById('predictions-lead');
  if (predLead) predLead.textContent =
    `The v5 model uses a continuous sigmoid on team differential to produce unique probabilities per game. Applied to upcoming ${term.leagueName} ${term.gameNoun}. Track record updates as ${term.gameNoun} complete. Picks are reasoned, not vibes.`;
  const spreadLead = document.getElementById('spread-lead');
  if (spreadLead) spreadLead.textContent =
    `The v4-spread model predicts expected margin and compares it against the bookmaker's line. When the model disagrees with the spread by a meaningful amount, that's an edge signal. This is experimental — no backtesting, no proven edge. Track record accumulates live.`;

  try {
    const [stats, margins, findings, sequences, extremes, allSportData, playerCounts, ratchet, predictions, calibration, spreadData] = await Promise.all([
      fetchJson<Stats>('/api/stats'),
      fetchJson<{ margin: number; count: number }[]>('/api/margins'),
      fetchJson<Finding[]>('/api/findings'),
      fetchJson<TeamSequence[]>('/api/team-sequences'),
      fetchJson<{ blowouts: Game[]; nailBiters: Game[] }>('/api/extreme-games'),
      loadAllSportData(),
      fetch(`${API_BASE}/api/player-counts`).then(r => r.json() as Promise<Record<string, number>>),
      loadRatchet(),
      loadPredictions(),
      loadCalibration(),
      loadSpreadPicks(),
    ]);

    // Bail if the user switched sport while we were fetching
    if (gen !== renderGeneration) return;

    const totalGames = stats.total_games;
    const homeWinPct = totalGames > 0
      ? ((stats.home_wins / totalGames) * 100).toFixed(1)
      : '0.0';

    // Derive season range from sequences
    const allSeasons = new Set<number>();
    sequences.forEach(t => t.seasons.forEach(s => allSeasons.add(s.year)));
    const sortedSeasons = Array.from(allSeasons).sort((a, b) => a - b);
    const firstSeason = sortedSeasons[0];
    const lastSeason = sortedSeasons[sortedSeasons.length - 1];
    const seasonCount = sortedSeasons.length;
    const seasonRangeLabel = seasonCount === 0
      ? 'no season data'
      : firstSeason === lastSeason
        ? `${firstSeason}-${String(firstSeason! + 1).slice(-2)} season`
        : `${firstSeason}-${String(firstSeason! + 1).slice(-2)} through ${lastSeason}-${String(lastSeason! + 1).slice(-2)}`;

    // Hero
    if (totalGames === 0) {
      document.getElementById('hero-title')!.innerHTML = `No ${term.leagueName} data yet.`;
      document.getElementById('hero-text')!.textContent = 'Run a scrape cycle to populate this sport.';
    } else {
      document.getElementById('hero-title')!.innerHTML =
        `${totalGames.toLocaleString()}<br>${term.leagueName} ${term.gameNoun}.`;

      const seasonWord = seasonCount === 1 ? 'One season' :
        seasonCount === 2 ? 'Two seasons' :
        seasonCount === 3 ? 'Three seasons' :
        `${seasonCount} seasons`;
      const spotlightCount = findings.filter(f => f.spotlight).length;
      document.getElementById('hero-text')!.innerHTML = `
        ${seasonWord}. Every ${term.gameNoun === 'matches' ? 'match' : 'game'} scraped, every result resolved.
        ${spotlightCount > 0
          ? `<span class="number">${spotlightCount}</span> spotlight findings, including a <span class="highlight">${stats.max_margin}-${term.unitSingular} blowout</span>.`
          : ''}
      `;
    }

    // Footer
    document.getElementById('footer-stats')!.textContent =
      `${totalGames.toLocaleString()} ${term.leagueName} ${term.gameNoun} · ${seasonRangeLabel}`;

    // Big stats
    if (totalGames > 0) {
      const biggest = extremes.blowouts[0];
      const biggestDetail = biggest
        ? `${term.unit} · ${biggest.winner.split(':')[1]} vs ${biggest.loser.split(':')[1]}`
        : term.unit;
      document.getElementById('big-stats')!.innerHTML = `
        <div class="big-stat">
          <div class="big-stat-label">Total ${term.gameNoun}</div>
          <div class="big-stat-value">${totalGames.toLocaleString()}</div>
          <div class="big-stat-detail">${seasonCount} seasons · ${term.teamCount}</div>
        </div>
        <div class="big-stat">
          <div class="big-stat-label">Avg margin</div>
          <div class="big-stat-value">${stats.avg_margin.toFixed(1)}</div>
          <div class="big-stat-detail">${term.unit}</div>
        </div>
        <div class="big-stat">
          <div class="big-stat-label">Home wins</div>
          <div class="big-stat-value">${homeWinPct}<span style="font-size: 24px">%</span></div>
          <div class="big-stat-detail">${stats.home_wins.toLocaleString()} of ${totalGames.toLocaleString()}</div>
        </div>
        <div class="big-stat">
          <div class="big-stat-label">Biggest blowout</div>
          <div class="big-stat-value">${stats.max_margin}</div>
          <div class="big-stat-detail">${biggestDetail}</div>
        </div>
      `;
    } else {
      document.getElementById('big-stats')!.innerHTML = '';
    }

    // Charts — with empty-state guards
    if (margins.length > 0) {
      renderHistogram(document.getElementById('histogram-chart')!, margins, stats.avg_margin);
    } else {
      document.getElementById('histogram-chart')!.innerHTML =
        `<div class="empty-state">No margin data for ${term.leagueName} yet.</div>`;
    }

    if (extremes.blowouts.length > 0 || extremes.nailBiters.length > 0) {
      renderExtremes(document.getElementById('extremes-grid')!, extremes);
    } else {
      document.getElementById('extremes-grid')!.innerHTML =
        `<div class="empty-state">No extreme ${term.gameNoun} found for ${term.leagueName}.</div>`;
    }

    if (sequences.length > 0) {
      renderStreaks(document.getElementById('streak-grid')!, sequences);
    } else {
      document.getElementById('streak-grid')!.innerHTML =
        `<div class="empty-state">No team sequence data for ${term.leagueName}.</div>`;
    }

    if (findings.length > 0) {
      renderFindings(document.getElementById('findings-grid')!, findings);
    } else {
      document.getElementById('findings-grid')!.innerHTML =
        `<div class="empty-state">No findings available for ${term.leagueName} yet.</div>`;
    }

    renderPredictions(
      document.getElementById('predictions-section')!,
      predictions.upcoming, predictions.recent, predictions.trackRecord
    );

    renderSpreadPicks(
      document.getElementById('spread-section')!,
      spreadData.picks, spreadData.trackRecord
    );

    if (ratchet) {
      renderRatchet(document.getElementById('ratchet-section')!, ratchet);
    } else {
      document.getElementById('ratchet-section')!.innerHTML =
        `<p style="color: var(--text-muted)">Ratchet run not available for ${term.leagueName}.</p>`;
    }

    if (calibration) {
      renderCalibration(document.getElementById('calibration-section')!, calibration);
    } else {
      document.getElementById('calibration-section')!.innerHTML =
        `<p style="color: var(--text-muted)">Calibration unavailable for ${term.leagueName}.</p>`;
    }

    renderPlayerSection(document.getElementById('players-section')!, allSportData, playerCounts);

  } catch (err) {
    if (gen !== renderGeneration) return;
    document.getElementById('hero-title')!.textContent = 'Failed to load data';
    document.getElementById('hero-text')!.textContent = err instanceof Error ? err.message : String(err);
  }
}

async function main() {
  renderGlobalSportSelector();
  await loadAndRenderAll();
}

main();
