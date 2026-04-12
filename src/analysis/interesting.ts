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
  | 'alternating'
  | 'dominance'
  | 'collapse'
  | 'differential';

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
  seasonYear: number;
  seasonGameStart: number; // game number within the season when streak started
  totalSeasonGames: number;
  seasonRecordBefore: { wins: number; losses: number };
  seasonRecordAfter: { wins: number; losses: number };
  seasonFinalRecord: { wins: number; losses: number };
}

function formatStreakNarrative(s: StreakRun, teamAbbr: string): string {
  const seasonLabel = `${s.seasonYear}-${String(s.seasonYear + 1).slice(2)}`;
  const seasonProgress = (s.seasonGameStart / s.totalSeasonGames * 100).toFixed(0);
  const finalRec = s.seasonFinalRecord;
  const finalPct = finalRec.wins / (finalRec.wins + finalRec.losses);

  if (s.type === 'loss') {
    if (s.length >= 20) {
      return `Historic. ${teamAbbr} finished ${seasonLabel} ${finalRec.wins}-${finalRec.losses}. This streak alone was ${(s.length / (finalRec.wins + finalRec.losses) * 100).toFixed(0)}% of their losses for the year.`;
    }
    if (finalPct < 0.3) {
      return `Part of a brutal ${seasonLabel} season. ${teamAbbr} finished ${finalRec.wins}-${finalRec.losses}, and this ${s.length}-game stretch came ${seasonProgress}% of the way through.`;
    }
    if (finalPct > 0.55) {
      return `Surprising. ${teamAbbr} finished ${seasonLabel} ${finalRec.wins}-${finalRec.losses} — over .500 — but lost ${s.length} in a row at one point. Started game ${s.seasonGameStart} of the season.`;
    }
    return `${seasonLabel} season. ${teamAbbr} finished ${finalRec.wins}-${finalRec.losses}. The streak hit ${seasonProgress}% of the way through.`;
  }

  // Win streaks
  if (s.length >= 16) {
    return `Dominant. ${teamAbbr} won ${s.length} in a row and finished ${seasonLabel} at ${finalRec.wins}-${finalRec.losses}. The streak made up ${(s.length / finalRec.wins * 100).toFixed(0)}% of their wins.`;
  }
  if (finalPct > 0.65) {
    return `Part of a championship-caliber ${seasonLabel}. ${teamAbbr} finished ${finalRec.wins}-${finalRec.losses}, and this run came at game ${s.seasonGameStart}.`;
  }
  if (finalPct < 0.45) {
    return `An unlikely hot streak in a losing season. ${teamAbbr} finished ${seasonLabel} at ${finalRec.wins}-${finalRec.losses} but ripped off ${s.length} straight wins ${seasonProgress}% of the way through.`;
  }
  return `${seasonLabel} season. ${teamAbbr} finished ${finalRec.wins}-${finalRec.losses}. The win streak hit at game ${s.seasonGameStart} of ${s.totalSeasonGames}.`;
}

export function findStreaks(sport: Sport, minLength = 7): Finding[] {
  const db = getDb();
  const results = db.prepare(`
    SELECT game_id, date, winner, loser FROM game_results
    WHERE sport = ? ORDER BY date
  `).all(sport) as { game_id: string; date: string; winner: string; loser: string }[];

  // Build per-team game sequences grouped by season
  // Map<teamId, Map<seasonYear, games[]>>
  const teamSeasonGames = new Map<string, Map<number, { date: string; won: boolean; gameId: string }[]>>();

  for (const r of results) {
    const season = sportSeasonYear(sport, r.date);
    for (const teamId of [r.winner, r.loser]) {
      if (!teamSeasonGames.has(teamId)) teamSeasonGames.set(teamId, new Map());
      const seasons = teamSeasonGames.get(teamId)!;
      if (!seasons.has(season)) seasons.set(season, []);
      seasons.get(season)!.push({
        date: r.date,
        won: teamId === r.winner,
        gameId: r.game_id,
      });
    }
  }

  const streaks: StreakRun[] = [];

  for (const [teamId, seasons] of teamSeasonGames) {
    for (const [seasonYear, games] of seasons) {
      const totalSeasonGames = games.length;
      const seasonWins = games.filter(g => g.won).length;
      const seasonFinalRecord = { wins: seasonWins, losses: totalSeasonGames - seasonWins };

      let currentType: 'win' | 'loss' = games[0]?.won ? 'win' : 'loss';
      let currentStart = 0;

      for (let i = 1; i <= games.length; i++) {
        const thisType = i < games.length ? (games[i].won ? 'win' : 'loss') : null;
        if (thisType !== currentType || i === games.length) {
          const length = i - currentStart;
          if (length >= minLength) {
            // Compute records before and after the streak within this season
            const before = games.slice(0, currentStart);
            const after = games.slice(i);
            const beforeWins = before.filter(g => g.won).length;
            const afterWins = after.filter(g => g.won).length;

            streaks.push({
              teamId,
              type: currentType,
              length,
              startDate: games[currentStart].date,
              endDate: games[i - 1].date,
              games: games.slice(currentStart, i).map(g => g.gameId),
              seasonYear,
              seasonGameStart: currentStart + 1,
              totalSeasonGames,
              seasonRecordBefore: { wins: beforeWins, losses: before.length - beforeWins },
              seasonRecordAfter: { wins: afterWins, losses: after.length - afterWins },
              seasonFinalRecord,
            });
          }
          if (i < games.length) {
            currentType = thisType!;
            currentStart = i;
          }
        }
      }
    }
  }

  // DEDUPE: Keep only the longest win streak and longest loss streak per team per season
  const seen = new Map<string, StreakRun>();
  for (const s of streaks) {
    const key = `${s.teamId}-${s.seasonYear}-${s.type}`;
    const existing = seen.get(key);
    if (!existing || s.length > existing.length) {
      seen.set(key, s);
    }
  }

  const deduped = Array.from(seen.values()).sort((a, b) => b.length - a.length);

  return deduped.slice(0, 15).map((s, i) => {
    // Calibrated surprise: probability against ANY team having a streak of length N
    // Across 30 teams × 82 games × 3 seasons, longer streaks become rarer
    const expectedFreq = 30 * 82 * 3 * Math.pow(0.5, s.length);
    const surpriseScore = Math.max(0, Math.min(1, 1 - expectedFreq));

    const teamAbbr = s.teamId.split(':')[1] ?? s.teamId;
    const seasonLabel = `${s.seasonYear}-${String(s.seasonYear + 1).slice(2)}`;
    const verb = s.type === 'win' ? 'won' : 'lost';

    return {
      id: `streak-${sport}-${s.teamId}-${s.seasonYear}-${s.type}`,
      type: 'streak' as FindingType,
      headline: `${teamAbbr} ${verb} ${s.length} straight in ${seasonLabel}`,
      detail: `${s.startDate.slice(0, 10)} → ${s.endDate.slice(0, 10)}. Started game ${s.seasonGameStart} of ${s.totalSeasonGames}. Final season record: ${s.seasonFinalRecord.wins}-${s.seasonFinalRecord.losses}.`,
      surpriseScore,
      spotlight: s.length >= 12 || (s.length >= 8 && i < 5),
      temporalAnchor: {
        startDate: s.startDate,
        endDate: s.endDate,
        season: seasonLabel,
      },
      comparisonBaseline: {
        metric: `${s.type} streak length`,
        leagueAverage: 3,
        thisValue: s.length,
      },
      narrativeHint: formatStreakNarrative(s, teamAbbr),
      data: s,
      chartType: 'streaks' as ChartType,
      sport,
    };
  });
}

// --- Algorithm 4: Margin Outlier Detector ---

interface SeasonRecord {
  wins: number;
  losses: number;
}

function computeSeasonRecords(sport: Sport): Map<string, SeasonRecord> {
  // teamId+seasonYear -> record
  const db = getDb();
  const rows = db.prepare(`
    SELECT date, winner, loser FROM game_results WHERE sport = ?
  `).all(sport) as { date: string; winner: string; loser: string }[];

  const records = new Map<string, SeasonRecord>();
  for (const r of rows) {
    const season = sportSeasonYear(sport, r.date);
    const winnerKey = `${r.winner}-${season}`;
    const loserKey = `${r.loser}-${season}`;
    if (!records.has(winnerKey)) records.set(winnerKey, { wins: 0, losses: 0 });
    if (!records.has(loserKey)) records.set(loserKey, { wins: 0, losses: 0 });
    records.get(winnerKey)!.wins++;
    records.get(loserKey)!.losses++;
  }
  return records;
}

/** Compute per-season league pace (average total points per game) */
/** Determine season year. NBA/NHL/MLS/EPL: Oct-Jun. MLB: Apr-Oct. NFL: Sep-Feb. */
function sportSeasonYear(sport: Sport, date: string): number {
  const d = new Date(date);
  const month = d.getUTCMonth(); // 0-indexed
  const year = d.getUTCFullYear();
  if (sport === 'mlb') {
    // MLB: April-October, season = calendar year
    return year;
  }
  // All others: season starts in fall, spans two calendar years
  return month >= 8 ? year : year - 1; // Sep+ = this year's season
}

function computeSeasonPace(sport: Sport): Map<number, number> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT date, home_score, away_score FROM game_results WHERE sport = ?
  `).all(sport) as { date: string; home_score: number; away_score: number }[];

  const totals = new Map<number, { sum: number; count: number }>();
  for (const r of rows) {
    const season = sportSeasonYear(sport, r.date);
    if (!totals.has(season)) totals.set(season, { sum: 0, count: 0 });
    const t = totals.get(season)!;
    t.sum += r.home_score + r.away_score;
    t.count++;
  }

  const pace = new Map<number, number>();
  for (const [season, t] of totals) {
    pace.set(season, t.sum / t.count);
  }
  return pace;
}

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

  const mean = margins.reduce((s, m) => s + m.margin, 0) / margins.length;
  const variance = margins.reduce((s, m) => s + Math.pow(m.margin - mean, 2), 0) / margins.length;
  const stddev = Math.sqrt(variance);
  const threshold = mean + sigmaThreshold * stddev;

  const seasonRecords = computeSeasonRecords(sport);
  const seasonPace = computeSeasonPace(sport);
  const findings: Finding[] = [];

  // Pace-adjusted re-ranking: compute margin as fraction of the game's actual total score.
  // Council mandate: a 62-point margin in a 216-total-point game is different than in a 160-total game.
  // Using the ACTUAL game total (not season average) for the ratio — season pace is used
  // only as a fallback denominator when actual total is zero.
  const SPORT_AVG_TOTAL: Record<string, number> = {
    nba: 220, nfl: 46, mlb: 9, nhl: 6, mls: 3, epl: 3,
  };
  const defaultTotal = SPORT_AVG_TOTAL[sport] ?? 220;

  const marginsWithPct = margins.map(m => {
    const season = sportSeasonYear(sport, m.date);
    const avgTotal = seasonPace.get(season) ?? defaultTotal;
    const actualTotal = m.home_score + m.away_score;
    const denom = actualTotal > 0 ? actualTotal : avgTotal;
    const marginPct = m.margin / denom;
    return { ...m, season, avgTotal, actualTotal, marginPct };
  }).sort((a, b) => b.marginPct - a.marginPct);

  // Blowouts — now ranked by pace-adjusted margin (marginPct)
  const blowouts = marginsWithPct.filter(m => m.margin >= threshold);
  for (const [i, b] of blowouts.slice(0, 8).entries()) {
    const winnerAbbr = b.winner.split(':')[1] ?? b.winner;
    const loserAbbr = b.loser.split(':')[1] ?? b.loser;
    const zScore = (b.margin - mean) / stddev;
    const totalPoints = b.actualTotal;
    // home_win=1 means home team won. Map winner/loser to actual scores.
    const winnerScore = b.home_win === 1 ? b.home_score : b.away_score;
    const loserScore = b.home_win === 1 ? b.away_score : b.home_score;
    const pacePct = (b.marginPct * 100).toFixed(1);
    // Winner scored this fraction of all points in the game
    const winnerSharePct = totalPoints > 0 ? ((winnerScore / totalPoints) * 100).toFixed(1) : '?';
    const seasonYear = sportSeasonYear(sport, b.date);
    const winnerRec = seasonRecords.get(`${b.winner}-${seasonYear}`);
    const loserRec = seasonRecords.get(`${b.loser}-${seasonYear}`);

    // Narrative: express dominance using the margin-to-total ratio (marginPct).
    // marginPct = margin / actualTotal — "what fraction of total scoring was the gap."
    // A 62-point margin in a 248-total game = 25%, meaning the gap alone was a quarter
    // of all scoring. This is sport-neutral (works for runs, goals, points).
    let narrative: string;
    if (b.marginPct >= 0.25) {
      narrative = `Dominant. ${winnerAbbr} won by ${b.margin} in a ${totalPoints}-total game. The margin alone was ${pacePct}% of all scoring — ${winnerAbbr} took ${winnerSharePct}% of every point on the board.`;
    } else if (winnerRec && loserRec && winnerRec.wins / (winnerRec.wins + winnerRec.losses) < 0.5) {
      narrative = `${winnerAbbr} finished the season ${winnerRec.wins}-${winnerRec.losses} — under .500 — but on this night they did THIS. Against a ${loserRec.wins}-${loserRec.losses} ${loserAbbr} team. Margin was ${pacePct}% of total scoring.`;
    } else if (loserRec && loserRec.wins / (loserRec.wins + loserRec.losses) > 0.55) {
      narrative = `Worth noting: ${loserAbbr} was a winning team that season (${loserRec.wins}-${loserRec.losses}). They still lost by ${b.margin} — ${pacePct}% of the game's total scoring.`;
    } else {
      narrative = `${zScore.toFixed(1)}σ above average. The ${b.margin}-point margin was ${pacePct}% of the game's ${totalPoints} total — a true blowout regardless of tempo.`;
    }

    findings.push({
      id: `blowout-${sport}-${b.game_id}`,
      type: 'blowout',
      headline: `${winnerAbbr} ${winnerScore}, ${loserAbbr} ${loserScore} (margin: ${b.margin})`,
      detail: `${b.date.slice(0, 10)} · ${(seasonYear)}-${String(seasonYear + 1).slice(2)} season · ${winnerAbbr} won by ${b.margin}, ${zScore.toFixed(1)}σ above the ${mean.toFixed(1)}-point league average.`,
      surpriseScore: Math.min(1, zScore / 5),
      spotlight: b.margin >= 55 || i < 2,
      temporalAnchor: { startDate: b.date, season: `${seasonYear}-${String(seasonYear + 1).slice(2)}` },
      comparisonBaseline: { metric: 'victory margin', leagueAverage: mean, thisValue: b.margin },
      narrativeHint: narrative,
      data: b,
      chartType: 'histogram',
      sport,
    });
  }

  // Nail-biters
  const nailBiters = margins.filter(m => m.margin === 1);
  for (const [i, n] of nailBiters.slice(0, 4).entries()) {
    const winnerAbbr = n.winner.split(':')[1] ?? n.winner;
    const loserAbbr = n.loser.split(':')[1] ?? n.loser;
    const totalPoints = n.home_score + n.away_score;
    const winnerScore = n.home_win === 1 ? n.home_score : n.away_score;
    const loserScore = n.home_win === 1 ? n.away_score : n.home_score;
    const seasonYear = sportSeasonYear(sport, n.date);
    const winnerRec = seasonRecords.get(`${n.winner}-${seasonYear}`);
    const loserRec = seasonRecords.get(`${n.loser}-${seasonYear}`);

    let narrative: string;
    if (totalPoints >= 240) {
      narrative = `${totalPoints} points in regulation, decided by one. Both teams shot the lights out and someone happened to make one more.`;
    } else if (winnerRec && loserRec && Math.abs(winnerRec.wins - loserRec.wins) > 30) {
      narrative = `${winnerAbbr} (${winnerRec.wins}-${winnerRec.losses}) vs ${loserAbbr} (${loserRec.wins}-${loserRec.losses}). On paper, this should not have been close. It came down to one possession.`;
    } else if (winnerRec && loserRec) {
      narrative = `${winnerAbbr} (${winnerRec.wins}-${winnerRec.losses}) and ${loserAbbr} (${loserRec.wins}-${loserRec.losses}) were evenly matched on the year. They proved it on this night by separating themselves by exactly one point.`;
    } else {
      narrative = `One point. The whole game came down to a single possession.`;
    }

    findings.push({
      id: `nailbiter-${sport}-${n.game_id}`,
      type: 'nail_biter',
      headline: `${winnerAbbr} ${winnerScore}, ${loserAbbr} ${loserScore}`,
      detail: `${n.date.slice(0, 10)} · ${seasonYear}-${String(seasonYear + 1).slice(2)} · One-point game · ${totalPoints} total points`,
      surpriseScore: 0.55 + i * 0.02,
      spotlight: i === 0,
      temporalAnchor: { startDate: n.date, season: `${seasonYear}-${String(seasonYear + 1).slice(2)}` },
      comparisonBaseline: { metric: 'victory margin', leagueAverage: mean, thisValue: n.margin },
      narrativeHint: narrative,
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

  // Build per-team-per-season records
  // Map<teamId, Map<seasonYear, sequence[]>>
  const teamSeasons = new Map<string, Map<number, boolean[]>>();
  for (const r of results) {
    const season = sportSeasonYear(sport, r.date);
    for (const teamId of [r.winner, r.loser]) {
      if (!teamSeasons.has(teamId)) teamSeasons.set(teamId, new Map());
      const seasons = teamSeasons.get(teamId)!;
      if (!seasons.has(season)) seasons.set(season, []);
      seasons.get(season)!.push(teamId === r.winner);
    }
  }

  const findings: Finding[] = [];

  for (const [teamId, seasons] of teamSeasons) {
    const teamAbbr = teamId.split(':')[1] ?? teamId;

    for (const [seasonYear, sequence] of seasons) {
      if (sequence.length < 50) continue; // need a meaningful season

      const wins = sequence.filter(Boolean).length;
      const losses = sequence.length - wins;
      const total = wins + losses;
      const winPct = wins / total;
      const distFrom500 = Math.abs(winPct - 0.5);

      let alternations = 0;
      for (let i = 1; i < sequence.length; i++) {
        if (sequence[i] !== sequence[i - 1]) alternations++;
      }
      const alternationRate = alternations / (sequence.length - 1);
      const seasonLabel = `${seasonYear}-${String(seasonYear + 1).slice(2)}`;

      // Most mediocre: close to .500 with high alternation
      if (distFrom500 < 0.04 && alternationRate > 0.55) {
        // Find longest run of alternating W-L
        let longestAlt = 0;
        let currentAlt = 1;
        for (let i = 1; i < sequence.length; i++) {
          if (sequence[i] !== sequence[i - 1]) {
            currentAlt++;
            longestAlt = Math.max(longestAlt, currentAlt);
          } else {
            currentAlt = 1;
          }
        }

        findings.push({
          id: `mediocrity-${sport}-${teamAbbr}-${seasonYear}`,
          type: 'mediocrity',
          headline: `${teamAbbr} went ${wins}-${losses} in ${seasonLabel} — and barely strung two together`,
          detail: `Alternated W-L ${alternations} times in ${total} games (${(alternationRate * 100).toFixed(0)}%). Longest alternating run: ${longestAlt} games. Final win pct: ${(winPct * 100).toFixed(1)}%.`,
          surpriseScore: alternationRate * (1 - distFrom500 * 10),
          spotlight: distFrom500 < 0.02 && alternationRate > 0.6,
          temporalAnchor: {
            startDate: `${seasonYear}-10-01`,
            endDate: `${seasonYear + 1}-06-30`,
            season: seasonLabel,
          },
          comparisonBaseline: { metric: 'win percentage', leagueAverage: 0.5, thisValue: winPct },
          narrativeHint: `${teamAbbr} finished ${seasonLabel} at exactly ${(winPct * 100).toFixed(1)}%. The longest run they put together — wins OR losses — was just ${longestAlt} games. They were the most stochastic team in basketball that year.`,
          data: { teamId, seasonYear, wins, losses, winPct, alternationRate, alternations, longestAlt },
          chartType: 'streaks',
          sport,
        });
      }

      // Cursed consistency: extreme alternators (regardless of record)
      if (alternationRate > 0.62 && distFrom500 >= 0.04) {
        findings.push({
          id: `alternating-${sport}-${teamAbbr}-${seasonYear}`,
          type: 'alternating',
          headline: `${teamAbbr} (${wins}-${losses}) alternated wins and losses ${(alternationRate * 100).toFixed(0)}% of ${seasonLabel}`,
          detail: `${alternations} switches in ${total} games. Despite a ${(winPct * 100).toFixed(1)}% win rate, they almost never strung results together.`,
          surpriseScore: Math.min(1, alternationRate * 1.2),
          spotlight: alternationRate > 0.7,
          temporalAnchor: {
            startDate: `${seasonYear}-10-01`,
            endDate: `${seasonYear + 1}-06-30`,
            season: seasonLabel,
          },
          comparisonBaseline: { metric: 'alternation rate', leagueAverage: 0.5, thisValue: alternationRate },
          narrativeHint: `${teamAbbr} won and lost ${winPct > 0.5 ? 'more than half their games' : 'less than half their games'} that season — but they did it without ever building momentum. ${alternations} alternations in ${total} games.`,
          data: { teamId, seasonYear, wins, losses, winPct, alternationRate, alternations },
          chartType: 'streaks',
          sport,
        });
      }
    }
  }

  findings.sort((a, b) => b.surpriseScore - a.surpriseScore);
  return findings.slice(0, 10);
}

// --- Algorithm 7: Point Differential (Pythagorean-style team strength) ---

export function findDifferentialOutliers(sport: Sport): Finding[] {
  const db = getDb();
  const games = db.prepare(`
    SELECT date, winner, loser, home_score, away_score, home_win, margin
    FROM game_results WHERE sport = ?
  `).all(sport) as {
    date: string; winner: string; loser: string;
    home_score: number; away_score: number; home_win: number; margin: number;
  }[];

  // Per team-season: total points scored, allowed, wins, losses
  type TeamSeason = {
    teamId: string;
    seasonYear: number;
    games: number;
    wins: number;
    losses: number;
    pointsFor: number;
    pointsAgainst: number;
  };

  const teamSeasons = new Map<string, TeamSeason>();

  for (const g of games) {
    const seasonYear = sportSeasonYear(sport, g.date);
    const homeIsWinner = g.home_win === 1;
    const homeTeam = homeIsWinner ? g.winner : g.loser;
    const awayTeam = homeIsWinner ? g.loser : g.winner;

    for (const [team, scoreFor, scoreAgainst] of [
      [homeTeam, g.home_score, g.away_score],
      [awayTeam, g.away_score, g.home_score],
    ] as const) {
      const key = `${team}-${seasonYear}`;
      if (!teamSeasons.has(key)) {
        teamSeasons.set(key, {
          teamId: team as string,
          seasonYear,
          games: 0,
          wins: 0,
          losses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        });
      }
      const ts = teamSeasons.get(key)!;
      ts.games++;
      if (team === g.winner) ts.wins++; else ts.losses++;
      ts.pointsFor += scoreFor as number;
      ts.pointsAgainst += scoreAgainst as number;
    }
  }

  // Calculate per-game differential
  const seasonStats = Array.from(teamSeasons.values())
    .filter(ts => ts.games >= 50)
    .map(ts => {
      const diffPerGame = (ts.pointsFor - ts.pointsAgainst) / ts.games;
      const winPct = ts.wins / ts.games;
      // Pythagorean expectation (Daryl Morey's basketball formula uses exponent ~13.91)
      const expectedWinPct = Math.pow(ts.pointsFor, 13.91) /
        (Math.pow(ts.pointsFor, 13.91) + Math.pow(ts.pointsAgainst, 13.91));
      const luckFactor = winPct - expectedWinPct;
      return { ...ts, diffPerGame, winPct, expectedWinPct, luckFactor };
    });

  const findings: Finding[] = [];

  // Most dominant teams (top differential)
  const dominant = [...seasonStats].sort((a, b) => b.diffPerGame - a.diffPerGame).slice(0, 3);
  for (const [i, ts] of dominant.entries()) {
    const teamAbbr = ts.teamId.split(':')[1] ?? ts.teamId;
    const seasonLabel = `${ts.seasonYear}-${String(ts.seasonYear + 1).slice(2)}`;
    const ppg = (ts.pointsFor / ts.games).toFixed(1);
    const oppPpg = (ts.pointsAgainst / ts.games).toFixed(1);

    findings.push({
      id: `dominance-${sport}-${teamAbbr}-${ts.seasonYear}`,
      type: 'dominance',
      headline: `${teamAbbr} outscored opponents by ${ts.diffPerGame.toFixed(1)} per game in ${seasonLabel}`,
      detail: `${ts.wins}-${ts.losses} record · scored ${ppg}, allowed ${oppPpg} · point differential is the strongest single predictor of NBA team quality.`,
      surpriseScore: Math.min(1, ts.diffPerGame / 15),
      spotlight: i === 0,
      temporalAnchor: { startDate: `${ts.seasonYear}-10-01`, season: seasonLabel },
      comparisonBaseline: { metric: 'point differential per game', leagueAverage: 0, thisValue: ts.diffPerGame },
      narrativeHint: `Point differential is to basketball what run differential is to baseball: it predicts the future better than win-loss record does. ${teamAbbr}'s +${ts.diffPerGame.toFixed(1)} in ${seasonLabel} suggests they were even better than their ${ts.wins}-${ts.losses} record showed.`,
      data: ts,
      chartType: 'streaks',
      sport,
    });
  }

  // Worst differentials (collapse / tank)
  const worst = [...seasonStats].sort((a, b) => a.diffPerGame - b.diffPerGame).slice(0, 3);
  for (const [i, ts] of worst.entries()) {
    const teamAbbr = ts.teamId.split(':')[1] ?? ts.teamId;
    const seasonLabel = `${ts.seasonYear}-${String(ts.seasonYear + 1).slice(2)}`;
    const ppg = (ts.pointsFor / ts.games).toFixed(1);
    const oppPpg = (ts.pointsAgainst / ts.games).toFixed(1);

    findings.push({
      id: `collapse-${sport}-${teamAbbr}-${ts.seasonYear}`,
      type: 'collapse',
      headline: `${teamAbbr} got outscored by ${Math.abs(ts.diffPerGame).toFixed(1)} per game in ${seasonLabel}`,
      detail: `${ts.wins}-${ts.losses} record · scored ${ppg}, allowed ${oppPpg} · the inverse of dominance.`,
      surpriseScore: Math.min(1, Math.abs(ts.diffPerGame) / 15),
      spotlight: i === 0,
      temporalAnchor: { startDate: `${ts.seasonYear}-10-01`, season: seasonLabel },
      comparisonBaseline: { metric: 'point differential per game', leagueAverage: 0, thisValue: ts.diffPerGame },
      narrativeHint: `${ts.diffPerGame.toFixed(1)} points per game is a Pythagorean expectation of ${(ts.expectedWinPct * 100).toFixed(0)}% — meaning ${teamAbbr} should have won about ${Math.round(ts.expectedWinPct * ts.games)} games. They actually won ${ts.wins}.`,
      data: ts,
      chartType: 'streaks',
      sport,
    });
  }

  // Biggest luck factor: teams that significantly over/underperformed Pythagorean expectation
  const lucky = [...seasonStats].sort((a, b) => Math.abs(b.luckFactor) - Math.abs(a.luckFactor)).slice(0, 3);
  for (const ts of lucky) {
    if (Math.abs(ts.luckFactor) < 0.05) continue;
    const teamAbbr = ts.teamId.split(':')[1] ?? ts.teamId;
    const seasonLabel = `${ts.seasonYear}-${String(ts.seasonYear + 1).slice(2)}`;
    const expectedWins = Math.round(ts.expectedWinPct * ts.games);
    const overUnder = ts.wins - expectedWins;
    const direction = overUnder > 0 ? 'over' : 'under';

    findings.push({
      id: `differential-${sport}-${teamAbbr}-${ts.seasonYear}`,
      type: 'differential',
      headline: `${teamAbbr} ${direction}performed by ${Math.abs(overUnder)} wins in ${seasonLabel}`,
      detail: `Pythagorean expectation: ${expectedWins} wins. Actual: ${ts.wins}. Point differential: ${ts.diffPerGame.toFixed(1)}/game.`,
      surpriseScore: Math.min(1, Math.abs(ts.luckFactor) * 4),
      spotlight: Math.abs(overUnder) >= 6,
      temporalAnchor: { startDate: `${ts.seasonYear}-10-01`, season: seasonLabel },
      comparisonBaseline: { metric: 'wins above Pythagorean', leagueAverage: 0, thisValue: overUnder },
      narrativeHint: overUnder > 0
        ? `${teamAbbr} won ${overUnder} more games than their point differential predicted. In sabermetrics terms: lucky in close games. Regression usually follows.`
        : `${teamAbbr}'s point differential said they should have won ${expectedWins} games. They won ${ts.wins}. They were better than their record — bad luck in close games.`,
      data: ts,
      chartType: 'streaks',
      sport,
    });
  }

  return findings;
}

// --- Algorithm 8: Clutch Performance (close-game record) ---

export function findClutchOutliers(sport: Sport): Finding[] {
  const db = getDb();
  // Close games = decided by 5 or fewer points (one-possession game in NBA terms = 3 or fewer)
  const games = db.prepare(`
    SELECT date, winner, loser, margin FROM game_results
    WHERE sport = ? AND margin <= 5
  `).all(sport) as { date: string; winner: string; loser: string; margin: number }[];

  type ClutchRecord = { teamId: string; seasonYear: number; closeWins: number; closeLosses: number };
  const records = new Map<string, ClutchRecord>();

  for (const g of games) {
    const seasonYear = sportSeasonYear(sport, g.date);
    for (const [teamId, won] of [[g.winner, true], [g.loser, false]] as const) {
      const key = `${teamId}-${seasonYear}`;
      if (!records.has(key)) {
        records.set(key, { teamId, seasonYear, closeWins: 0, closeLosses: 0 });
      }
      const r = records.get(key)!;
      if (won) r.closeWins++; else r.closeLosses++;
    }
  }

  const stats = Array.from(records.values())
    .filter(r => r.closeWins + r.closeLosses >= 15)
    .map(r => {
      const total = r.closeWins + r.closeLosses;
      return { ...r, total, closeWinPct: r.closeWins / total };
    });

  const findings: Finding[] = [];

  // Best clutch teams
  const best = [...stats].sort((a, b) => b.closeWinPct - a.closeWinPct).slice(0, 3);
  for (const [i, r] of best.entries()) {
    if (r.closeWinPct < 0.65) continue;
    const teamAbbr = r.teamId.split(':')[1] ?? r.teamId;
    const seasonLabel = `${r.seasonYear}-${String(r.seasonYear + 1).slice(2)}`;
    findings.push({
      id: `clutch-best-${sport}-${teamAbbr}-${r.seasonYear}`,
      type: 'differential',
      headline: `${teamAbbr} went ${r.closeWins}-${r.closeLosses} in close games in ${seasonLabel}`,
      detail: `${(r.closeWinPct * 100).toFixed(0)}% win rate in games decided by 5 or fewer points. Sample size: ${r.total} games.`,
      surpriseScore: Math.min(1, r.closeWinPct * 1.2),
      spotlight: i === 0,
      temporalAnchor: { startDate: `${r.seasonYear}-10-01`, season: seasonLabel },
      comparisonBaseline: { metric: 'close-game win rate', leagueAverage: 0.5, thisValue: r.closeWinPct },
      narrativeHint: `In the NBA, clutch performance is mostly noise — close games are essentially coin flips in the long run. ${teamAbbr} winning ${(r.closeWinPct * 100).toFixed(0)}% of theirs is either incredible execution down the stretch or a season's worth of good luck. Either way, regression is likely the next year.`,
      data: r,
      chartType: 'streaks',
      sport,
    });
  }

  // Worst clutch teams
  const worst = [...stats].sort((a, b) => a.closeWinPct - b.closeWinPct).slice(0, 3);
  for (const [i, r] of worst.entries()) {
    if (r.closeWinPct > 0.35) continue;
    const teamAbbr = r.teamId.split(':')[1] ?? r.teamId;
    const seasonLabel = `${r.seasonYear}-${String(r.seasonYear + 1).slice(2)}`;
    findings.push({
      id: `clutch-worst-${sport}-${teamAbbr}-${r.seasonYear}`,
      type: 'differential',
      headline: `${teamAbbr} went ${r.closeWins}-${r.closeLosses} in close games in ${seasonLabel}`,
      detail: `${(r.closeWinPct * 100).toFixed(0)}% win rate in games decided by 5 or fewer points. Sample size: ${r.total} games.`,
      surpriseScore: Math.min(1, (1 - r.closeWinPct) * 1.2),
      spotlight: i === 0,
      temporalAnchor: { startDate: `${r.seasonYear}-10-01`, season: seasonLabel },
      comparisonBaseline: { metric: 'close-game win rate', leagueAverage: 0.5, thisValue: r.closeWinPct },
      narrativeHint: `${teamAbbr} lost ${r.closeLosses} of their ${r.total} close games that season. Sometimes the late-game execution just isn't there. Sometimes it's bad luck on the bounces. The numbers can't tell you which.`,
      data: r,
      chartType: 'streaks',
      sport,
    });
  }

  return findings;
}

// --- Aggregator ---

export function scanForFindings(sport: Sport): Finding[] {
  const all: Finding[] = [
    ...findStreaks(sport),
    ...findMarginOutliers(sport),
    ...findMediocrity(sport),
    ...findDifferentialOutliers(sport),
    ...findClutchOutliers(sport),
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
