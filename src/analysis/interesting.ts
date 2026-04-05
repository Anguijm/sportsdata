/**
 * "Interesting Things" Detector — finds Bois-worthy stories in sports data.
 * Scans for outliers, streaks, absurdities, and patterns that make
 * people who don't care about sports suddenly care deeply.
 */

import { getDb } from '../storage/sqlite.js';
import type { Sport } from '../schema/provenance.js';

// --- Finding Interface (Council-Enriched) ---

export type FindingType =
  | 'streak'
  | 'blowout'
  | 'nail_biter'
  | 'mediocrity'
  | 'alternating';

export type ChartType = 'scatter' | 'histogram' | 'timeline' | 'streaks' | 'drilldown';

export interface Finding {
  id: string;
  type: FindingType;
  headline: string;
  detail: string;
  surpriseScore: number;
  spotlight: boolean;
  temporalAnchor: {
    startDate: string;
    endDate?: string;
    season?: string;
  };
  comparisonBaseline: {
    metric: string;
    leagueAverage: number;
    thisValue: number;
  };
  narrativeHint: string;
  data: unknown;
  chartType: ChartType;
  sport: Sport;
}

// --- Algorithm 1: Streak Finder ---

interface StreakRun {
  teamId: string;
  type: 'win' | 'loss';
  length: number;
  startDate: string;
  endDate: string;
  games: string[];
}

export function findStreaks(sport: Sport, minLength = 7): Finding[] {
  const db = getDb();
  const results = db.prepare(`
    SELECT game_id, date, winner, loser FROM game_results
    WHERE sport = ? ORDER BY date
  `).all(sport) as { game_id: string; date: string; winner: string; loser: string }[];

  // Build per-team game sequences
  const teamGames = new Map<string, { date: string; won: boolean; gameId: string }[]>();
  for (const r of results) {
    for (const teamId of [r.winner, r.loser]) {
      if (!teamGames.has(teamId)) teamGames.set(teamId, []);
      teamGames.get(teamId)!.push({
        date: r.date,
        won: teamId === r.winner,
        gameId: r.game_id,
      });
    }
  }

  const streaks: StreakRun[] = [];

  for (const [teamId, games] of teamGames) {
    let currentType: 'win' | 'loss' = games[0]?.won ? 'win' : 'loss';
    let currentStart = 0;

    for (let i = 1; i <= games.length; i++) {
      const thisType = i < games.length ? (games[i].won ? 'win' : 'loss') : null;
      if (thisType !== currentType || i === games.length) {
        const length = i - currentStart;
        if (length >= minLength) {
          streaks.push({
            teamId,
            type: currentType,
            length,
            startDate: games[currentStart].date,
            endDate: games[i - 1].date,
            games: games.slice(currentStart, i).map(g => g.gameId),
          });
        }
        if (i < games.length) {
          currentType = thisType!;
          currentStart = i;
        }
      }
    }
  }

  // Sort by length descending
  streaks.sort((a, b) => b.length - a.length);

  // Compute league average win rate for surprise score
  const avgWinRate = 0.5; // by definition in head-to-head sports

  return streaks.slice(0, 20).map((s, i) => {
    // P(streak of length N) ≈ p^N where p = team's win rate (approx 0.5)
    const pStreak = Math.pow(avgWinRate, s.length);
    const surpriseScore = Math.min(1, 1 - pStreak * 100); // normalize

    const teamAbbr = s.teamId.split(':')[1] ?? s.teamId;

    return {
      id: `streak-${sport}-${i}`,
      type: 'streak' as FindingType,
      headline: `${teamAbbr} ${s.type === 'win' ? 'won' : 'lost'} ${s.length} straight games`,
      detail: `From ${s.startDate.slice(0, 10)} to ${s.endDate.slice(0, 10)}, the ${teamAbbr} ${s.type === 'win' ? 'won' : 'lost'} ${s.length} consecutive games.`,
      surpriseScore,
      spotlight: s.length >= 10,
      temporalAnchor: {
        startDate: s.startDate,
        endDate: s.endDate,
      },
      comparisonBaseline: {
        metric: `${s.type} streak length`,
        leagueAverage: 3, // typical streak
        thisValue: s.length,
      },
      narrativeHint: s.length >= 12
        ? `This is the kind of streak that changes how a city feels about its team.`
        : `A ${s.length}-game ${s.type} streak. Not legendary, but definitely noticeable.`,
      data: s,
      chartType: 'streaks' as ChartType,
      sport,
    };
  });
}

// --- Algorithm 4: Margin Outlier Detector ---

export function findMarginOutliers(sport: Sport, sigmaThreshold = 2.5): Finding[] {
  const db = getDb();
  const margins = db.prepare(`
    SELECT game_id, date, winner, loser, home_score, away_score, margin, home_win
    FROM game_results WHERE sport = ? ORDER BY margin DESC
  `).all(sport) as {
    game_id: string; date: string; winner: string; loser: string;
    home_score: number; away_score: number; margin: number; home_win: number;
  }[];

  if (margins.length < 10) return [];

  // Compute mean and stddev
  const mean = margins.reduce((s, m) => s + m.margin, 0) / margins.length;
  const variance = margins.reduce((s, m) => s + Math.pow(m.margin - mean, 2), 0) / margins.length;
  const stddev = Math.sqrt(variance);
  const threshold = mean + sigmaThreshold * stddev;

  const findings: Finding[] = [];

  // Blowouts (high margin)
  const blowouts = margins.filter(m => m.margin >= threshold);
  for (const [i, b] of blowouts.slice(0, 10).entries()) {
    const winnerAbbr = b.winner.split(':')[1] ?? b.winner;
    const loserAbbr = b.loser.split(':')[1] ?? b.loser;
    const zScore = (b.margin - mean) / stddev;

    findings.push({
      id: `blowout-${sport}-${i}`,
      type: 'blowout',
      headline: `${winnerAbbr} beat ${loserAbbr} by ${b.margin} points`,
      detail: `On ${b.date.slice(0, 10)}, the final score was ${b.home_score}-${b.away_score}. That's ${zScore.toFixed(1)} standard deviations from the average margin of ${mean.toFixed(1)}.`,
      surpriseScore: Math.min(1, zScore / 5),
      spotlight: b.margin >= threshold * 1.5,
      temporalAnchor: { startDate: b.date },
      comparisonBaseline: {
        metric: 'victory margin',
        leagueAverage: mean,
        thisValue: b.margin,
      },
      narrativeHint: `The average ${sport.toUpperCase()} game is decided by ${mean.toFixed(1)} points. This one was decided by ${b.margin}.`,
      data: b,
      chartType: 'histogram',
      sport,
    });
  }

  // Nail-biters (margin = 1)
  const nailBiters = margins.filter(m => m.margin <= 2).reverse();
  for (const [i, n] of nailBiters.slice(0, 5).entries()) {
    const winnerAbbr = n.winner.split(':')[1] ?? n.winner;
    const loserAbbr = n.loser.split(':')[1] ?? n.loser;

    findings.push({
      id: `nailbiter-${sport}-${i}`,
      type: 'nail_biter',
      headline: `${winnerAbbr} edged ${loserAbbr} by ${n.margin} point${n.margin === 1 ? '' : 's'}`,
      detail: `On ${n.date.slice(0, 10)}, the final was ${n.home_score}-${n.away_score}. ${n.margin === 1 ? 'One point. One possession. One moment.' : 'As close as it gets.'}`,
      surpriseScore: 0.6,
      spotlight: n.margin === 1,
      temporalAnchor: { startDate: n.date },
      comparisonBaseline: {
        metric: 'victory margin',
        leagueAverage: mean,
        thisValue: n.margin,
      },
      narrativeHint: `Most games have a comfortable winner. This was not most games.`,
      data: n,
      chartType: 'histogram',
      sport,
    });
  }

  return findings;
}

// --- Algorithm 6: Mediocrity Detector ---

export function findMediocrity(sport: Sport): Finding[] {
  const db = getDb();
  const results = db.prepare(`
    SELECT game_id, date, winner, loser FROM game_results
    WHERE sport = ? ORDER BY date
  `).all(sport) as { game_id: string; date: string; winner: string; loser: string }[];

  // Build per-team records
  const teamRecords = new Map<string, { wins: number; losses: number; sequence: boolean[] }>();
  for (const r of results) {
    for (const teamId of [r.winner, r.loser]) {
      if (!teamRecords.has(teamId)) teamRecords.set(teamId, { wins: 0, losses: 0, sequence: [] });
      const rec = teamRecords.get(teamId)!;
      const won = teamId === r.winner;
      if (won) rec.wins++; else rec.losses++;
      rec.sequence.push(won);
    }
  }

  const findings: Finding[] = [];

  for (const [teamId, rec] of teamRecords) {
    if (rec.wins + rec.losses < 20) continue; // need enough games
    const teamAbbr = teamId.split(':')[1] ?? teamId;
    const total = rec.wins + rec.losses;
    const winPct = rec.wins / total;

    // Find teams closest to .500
    const distFrom500 = Math.abs(winPct - 0.5);

    // Count alternating W-L runs
    let alternations = 0;
    for (let i = 1; i < rec.sequence.length; i++) {
      if (rec.sequence[i] !== rec.sequence[i - 1]) alternations++;
    }
    const alternationRate = alternations / (rec.sequence.length - 1);

    // A truly mediocre team is close to .500 AND alternates frequently
    if (distFrom500 < 0.05 && alternationRate > 0.55) {
      findings.push({
        id: `mediocrity-${sport}-${teamAbbr}`,
        type: 'mediocrity',
        headline: `${teamAbbr} went ${rec.wins}-${rec.losses} — the most .500 team`,
        detail: `Win rate: ${(winPct * 100).toFixed(1)}%. They alternated W-L ${alternations} times in ${total} games (${(alternationRate * 100).toFixed(0)}% alternation rate).`,
        surpriseScore: alternationRate * (1 - distFrom500 * 10),
        spotlight: distFrom500 < 0.02,
        temporalAnchor: {
          startDate: results[0].date,
          endDate: results[results.length - 1].date,
        },
        comparisonBaseline: {
          metric: 'win percentage',
          leagueAverage: 0.5,
          thisValue: winPct,
        },
        narrativeHint: `Not good enough to be exciting. Not bad enough to be interesting. Just... there. Winning, then losing, then winning, then losing.`,
        data: { teamId, ...rec, winPct, alternationRate, alternations },
        chartType: 'streaks',
        sport,
      });
    }

    // Also flag extreme alternators even if not .500
    if (alternationRate > 0.65) {
      findings.push({
        id: `alternating-${sport}-${teamAbbr}`,
        type: 'alternating',
        headline: `${teamAbbr} alternated W-L ${(alternationRate * 100).toFixed(0)}% of the time`,
        detail: `Out of ${total} games, they switched between winning and losing ${alternations} times. The probability of this by chance is ${(Math.pow(0.5, alternations) * 100).toFixed(6)}%.`,
        surpriseScore: Math.min(1, alternationRate * 1.3),
        spotlight: alternationRate > 0.7,
        temporalAnchor: {
          startDate: results[0].date,
          endDate: results[results.length - 1].date,
        },
        comparisonBaseline: {
          metric: 'alternation rate',
          leagueAverage: 0.5,
          thisValue: alternationRate,
        },
        narrativeHint: `Imagine flipping a coin before every game. That's basically what happened here, except somehow more consistent than a coin.`,
        data: { teamId, ...rec, winPct, alternationRate, alternations },
        chartType: 'streaks',
        sport,
      });
    }
  }

  // Sort by surprise score
  findings.sort((a, b) => b.surpriseScore - a.surpriseScore);
  return findings.slice(0, 10);
}

// --- Aggregator ---

export function scanForFindings(sport: Sport): Finding[] {
  const all: Finding[] = [
    ...findStreaks(sport),
    ...findMarginOutliers(sport),
    ...findMediocrity(sport),
  ];

  // Deduplicate by id, sort by surprise score
  const seen = new Set<string>();
  const unique = all.filter(f => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });

  unique.sort((a, b) => b.surpriseScore - a.surpriseScore);
  return unique;
}

// --- Distribution data for histograms ---

export function getMarginDistribution(sport: Sport): { margin: number; count: number }[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT margin, COUNT(*) as count FROM game_results
    WHERE sport = ? GROUP BY margin ORDER BY margin
  `).all(sport) as { margin: number; count: number }[];
  return rows;
}

export function getHomeWinTimeline(sport: Sport): { date: string; cumulativeHomeAdvantage: number }[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT date, home_win FROM game_results WHERE sport = ? ORDER BY date
  `).all(sport) as { date: string; home_win: number }[];

  let cumulative = 0;
  return rows.map(r => {
    cumulative += r.home_win ? 1 : -1;
    return { date: r.date, cumulativeHomeAdvantage: cumulative };
  });
}
