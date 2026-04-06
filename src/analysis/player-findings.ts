/**
 * Player findings — sport-specific top performers with COUNCIL-MANDATED qualifiers.
 *
 * Council mandate (Sprint 5 review):
 * 1. No leaderboard without minimum-games filter (prevents IL samples)
 * 2. Every counting stat MUST be paired with a rate stat
 * 3. ONE hero card per sport + collapsed leaderboards (not 24-tile wall)
 * 4. MLS and EPL hard-separated (quality gap forbids shared rankings)
 * 5. Qualifier label visible on every output
 */

import { getDb } from '../storage/sqlite.js';
import type { Sport } from '../schema/provenance.js';
import type { PlayerStatsRow } from '../storage/sqlite.js';
import { QUALIFIERS, qualifierLabel } from './qualifiers.js';

export interface PlayerFinding {
  id: string;
  sport: Sport;
  category: string;
  rank: number;
  playerName: string;
  team: string;
  position: string;
  /** Primary stat headline (e.g., "32.7 PPG", ".342 BA") */
  headline: string;
  /** Numerical stat value for sorting */
  statValue: number;
  /** Stat label (e.g., "PPG", "AVG") */
  statLabel: string;
  /** Rate stat that contextualizes the counting stat (e.g., "63.7% TS", "1.024 OPS") */
  rateStatLabel?: string;
  rateStatValue?: string;
  /** Sample qualifier (e.g., "76 GP · min 20 GP") */
  qualifier: string;
  /** Spotlight = the #1 hero finding for this category */
  spotlight: boolean;
}

export interface PlayerHero {
  sport: Sport;
  name: string;
  team: string;
  position: string;
  category: string;
  headline: string;
  primaryStat: { label: string; value: string };
  contextStats: Array<{ label: string; value: string }>;
  qualifier: string;
}

interface ParsedPlayer {
  player_id: string;
  full_name: string;
  team_abbr: string;
  position: string;
  games_played: number;
  stats: Record<string, number>;
}

function loadPlayers(sport: Sport, season = '2025'): ParsedPlayer[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT player_id, full_name, team_abbr, position, games_played, stats_json FROM player_stats WHERE sport = ? AND season = ?'
  ).all(sport, season) as Array<Pick<PlayerStatsRow, 'player_id' | 'full_name' | 'team_abbr' | 'position' | 'games_played' | 'stats_json'>>;
  return rows.map(r => ({
    player_id: r.player_id,
    full_name: r.full_name,
    team_abbr: r.team_abbr ?? '',
    position: r.position ?? '',
    games_played: r.games_played,
    stats: JSON.parse(r.stats_json) as Record<string, number>,
  }));
}

function topN<T>(items: T[], scoreFn: (x: T) => number, n: number): T[] {
  return [...items].sort((a, b) => scoreFn(b) - scoreFn(a)).slice(0, n);
}

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

// --- NBA ---

function findNbaPlayers(): { hero: PlayerHero | null; findings: PlayerFinding[] } {
  const minGP = QUALIFIERS.nba.minGamesPlayed;
  const players = loadPlayers('nba').filter(p => p.games_played >= minGP);
  if (players.length === 0) return { hero: null, findings: [] };
  const findings: PlayerFinding[] = [];
  const qLabel = (gp: number) => `${gp} GP · ${qualifierLabel('nba', gp)}`;

  // Top scorers (paired with TS%)
  const scorers = topN(players, p => p.stats['offensive.avgPoints'] ?? 0, 5);
  scorers.forEach((p, i) => {
    const ppg = p.stats['offensive.avgPoints'] ?? 0;
    const ts = p.stats['general.trueShootingPct'] ?? p.stats['offensive.fieldGoalPct'] ?? 0;
    findings.push({
      id: `nba-scoring-${i}`, sport: 'nba', category: 'scoring', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position,
      headline: `${fmt(ppg)} PPG`,
      statValue: ppg, statLabel: 'PPG',
      rateStatLabel: 'TS%', rateStatValue: `${fmt(ts, 1)}%`,
      qualifier: qLabel(p.games_played),
      spotlight: i === 0,
    });
  });

  // Efficiency (PER) — paired with usage rate
  const perLeaders = topN(players.filter(p => (p.stats['general.PER'] ?? 0) > 0), p => p.stats['general.PER'] ?? 0, 5);
  perLeaders.forEach((p, i) => {
    const per = p.stats['general.PER'] ?? 0;
    const min = p.stats['general.avgMinutes'] ?? 0;
    findings.push({
      id: `nba-per-${i}`, sport: 'nba', category: 'efficiency', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position,
      headline: `${fmt(per)} PER`,
      statValue: per, statLabel: 'PER',
      rateStatLabel: 'MPG', rateStatValue: fmt(min, 1),
      qualifier: qLabel(p.games_played),
      spotlight: i === 0,
    });
  });

  // Plus-minus (paired with minutes/game for context)
  const pmLeaders = topN(players, p => p.stats['general.plusMinus'] ?? -999, 5);
  pmLeaders.forEach((p, i) => {
    const pm = p.stats['general.plusMinus'] ?? 0;
    const mpg = p.stats['general.avgMinutes'] ?? 0;
    findings.push({
      id: `nba-pm-${i}`, sport: 'nba', category: 'plus-minus', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position,
      headline: `${pm > 0 ? '+' : ''}${fmt(pm, 0)}`,
      statValue: pm, statLabel: '+/-',
      rateStatLabel: 'MPG', rateStatValue: fmt(mpg, 1),
      qualifier: qLabel(p.games_played),
      spotlight: i === 0,
    });
  });

  // Hero: top scorer (PPG king)
  const heroP = scorers[0];
  let hero: PlayerHero | null = null;
  if (heroP) {
    hero = {
      sport: 'nba',
      name: heroP.full_name,
      team: heroP.team_abbr,
      position: heroP.position,
      category: 'scoring leader',
      headline: `${fmt(heroP.stats['offensive.avgPoints'] ?? 0)} PPG`,
      primaryStat: { label: 'POINTS PER GAME', value: fmt(heroP.stats['offensive.avgPoints'] ?? 0) },
      contextStats: [
        { label: 'FG%', value: `${fmt(heroP.stats['offensive.fieldGoalPct'] ?? 0)}%` },
        { label: '3PT%', value: `${fmt(heroP.stats['offensive.threePointFieldGoalPct'] ?? 0)}%` },
        { label: 'PER', value: fmt(heroP.stats['general.PER'] ?? 0) },
      ],
      qualifier: qLabel(heroP.games_played),
    };
  }

  return { hero, findings };
}

// --- NFL ---

function findNflPlayers(): { hero: PlayerHero | null; findings: PlayerFinding[] } {
  const minGP = QUALIFIERS.nfl.minGamesPlayed;
  const players = loadPlayers('nfl').filter(p => p.games_played >= minGP);
  if (players.length === 0) return { hero: null, findings: [] };
  const findings: PlayerFinding[] = [];
  const qLabel = (gp: number) => `${gp} G · ${qualifierLabel('nfl', gp)}`;

  // Passing yards (paired with completion %)
  const passers = topN(
    players.filter(p => (p.stats['passing.passingYards'] ?? 0) > 800),
    p => p.stats['passing.passingYards'] ?? 0,
    5
  );
  passers.forEach((p, i) => {
    const yds = p.stats['passing.passingYards'] ?? 0;
    const tds = p.stats['passing.passingTouchdowns'] ?? 0;
    const compPct = p.stats['passing.completionPct'] ?? 0;
    findings.push({
      id: `nfl-passing-${i}`, sport: 'nfl', category: 'passing', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position,
      headline: `${yds.toLocaleString()} pass yds`,
      statValue: yds, statLabel: 'PASS YDS',
      rateStatLabel: 'CMP%', rateStatValue: `${fmt(compPct, 1)}%`,
      qualifier: `${qLabel(p.games_played)} · ${tds} TD`,
      spotlight: i === 0,
    });
  });

  // Rushing yards (paired with YPC — the rate stat)
  const rushers = topN(
    players.filter(p => (p.stats['rushing.rushingYards'] ?? 0) > 200),
    p => p.stats['rushing.rushingYards'] ?? 0,
    5
  );
  rushers.forEach((p, i) => {
    const yds = p.stats['rushing.rushingYards'] ?? 0;
    const ypc = p.stats['rushing.yardsPerRushAttempt'] ?? 0;
    const tds = p.stats['rushing.rushingTouchdowns'] ?? 0;
    findings.push({
      id: `nfl-rushing-${i}`, sport: 'nfl', category: 'rushing', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position,
      headline: `${yds.toLocaleString()} rush yds`,
      statValue: yds, statLabel: 'RUSH YDS',
      rateStatLabel: 'YPC', rateStatValue: fmt(ypc, 1),
      qualifier: `${qLabel(p.games_played)} · ${tds} TD`,
      spotlight: i === 0,
    });
  });

  // Receiving yards (paired with YPR — yards per reception)
  const receivers = topN(
    players.filter(p => (p.stats['receiving.receivingYards'] ?? 0) > 200),
    p => p.stats['receiving.receivingYards'] ?? 0,
    5
  );
  receivers.forEach((p, i) => {
    const yds = p.stats['receiving.receivingYards'] ?? 0;
    const recs = p.stats['receiving.receptions'] ?? 0;
    const ypr = recs > 0 ? yds / recs : 0;
    const tds = p.stats['receiving.receivingTouchdowns'] ?? 0;
    findings.push({
      id: `nfl-receiving-${i}`, sport: 'nfl', category: 'receiving', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position,
      headline: `${yds.toLocaleString()} rec yds`,
      statValue: yds, statLabel: 'REC YDS',
      rateStatLabel: 'YPR', rateStatValue: fmt(ypr, 1),
      qualifier: `${qLabel(p.games_played)} · ${recs} rec · ${tds} TD`,
      spotlight: i === 0,
    });
  });

  // Hero: top passer
  const heroP = passers[0];
  let hero: PlayerHero | null = null;
  if (heroP) {
    hero = {
      sport: 'nfl',
      name: heroP.full_name,
      team: heroP.team_abbr,
      position: heroP.position,
      category: 'passing leader',
      headline: `${(heroP.stats['passing.passingYards'] ?? 0).toLocaleString()} pass yds`,
      primaryStat: { label: 'PASSING YARDS', value: (heroP.stats['passing.passingYards'] ?? 0).toLocaleString() },
      contextStats: [
        { label: 'TD', value: fmt(heroP.stats['passing.passingTouchdowns'] ?? 0, 0) },
        { label: 'INT', value: fmt(heroP.stats['passing.interceptions'] ?? 0, 0) },
        { label: 'CMP%', value: `${fmt(heroP.stats['passing.completionPct'] ?? 0, 1)}%` },
      ],
      qualifier: qLabel(heroP.games_played),
    };
  }

  return { hero, findings };
}

// --- MLB ---

function findMlbPlayers(): { hero: PlayerHero | null; findings: PlayerFinding[] } {
  const players = loadPlayers('mlb');
  const findings: PlayerFinding[] = [];
  const minAB = QUALIFIERS.mlb.hitterMinAB ?? 100;
  const minIP = QUALIFIERS.mlb.pitcherMinIP ?? 50;

  // Batting average (qualified hitters only — paired with OPS)
  const hitters = topN(
    players.filter(p => (p.stats['batting.atBats'] ?? 0) >= minAB),
    p => p.stats['batting.avg'] ?? 0,
    5
  );
  hitters.forEach((p, i) => {
    const avg = p.stats['batting.avg'] ?? 0;
    const ops = p.stats['batting.OPS'] ?? 0;
    const ab = p.stats['batting.atBats'] ?? 0;
    findings.push({
      id: `mlb-avg-${i}`, sport: 'mlb', category: 'batting average', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position,
      headline: `.${avg.toFixed(3).slice(2)}`,
      statValue: avg, statLabel: 'AVG',
      rateStatLabel: 'OPS', rateStatValue: fmt(ops, 3),
      qualifier: `${ab} AB · min ${minAB} AB`,
      spotlight: i === 0,
    });
  });

  // Home runs (paired with SLG — the rate stat)
  const sluggers = topN(
    players.filter(p => (p.stats['batting.atBats'] ?? 0) >= minAB),
    p => p.stats['batting.homeRuns'] ?? 0,
    5
  );
  sluggers.forEach((p, i) => {
    const hr = p.stats['batting.homeRuns'] ?? 0;
    if (hr === 0) return;
    const slg = p.stats['batting.slugAvg'] ?? 0;
    const ab = p.stats['batting.atBats'] ?? 0;
    const ops = p.stats['batting.OPS'] ?? 0;
    findings.push({
      id: `mlb-hr-${i}`, sport: 'mlb', category: 'power', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position,
      headline: `${hr} HR`,
      statValue: hr, statLabel: 'HR',
      rateStatLabel: 'SLG', rateStatValue: fmt(slg, 3),
      qualifier: `${ab} AB · ${fmt(ops, 3)} OPS`,
      spotlight: i === 0,
    });
  });

  // ERA leaders — qualified pitchers only — paired with WHIP
  const aces = topN(
    players.filter(p => (p.stats['pitching.inningsPitched'] ?? 0) >= minIP),
    p => -1 * (p.stats['pitching.ERA'] ?? 99),
    5
  );
  aces.forEach((p, i) => {
    const era = p.stats['pitching.ERA'] ?? 0;
    const whip = p.stats['pitching.WHIP'] ?? 0;
    const ip = p.stats['pitching.inningsPitched'] ?? 0;
    const k = p.stats['pitching.strikeouts'] ?? 0;
    findings.push({
      id: `mlb-era-${i}`, sport: 'mlb', category: 'pitching', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position,
      headline: `${fmt(era, 2)} ERA`,
      statValue: era, statLabel: 'ERA',
      rateStatLabel: 'WHIP', rateStatValue: fmt(whip, 2),
      qualifier: `${fmt(ip, 1)} IP · min ${minIP} IP · ${k} K`,
      spotlight: i === 0,
    });
  });

  // Hero: best hitter by OPS (more meaningful than BA)
  const opsLeader = topN(
    players.filter(p => (p.stats['batting.atBats'] ?? 0) >= minAB),
    p => p.stats['batting.OPS'] ?? 0,
    1
  )[0];
  let hero: PlayerHero | null = null;
  if (opsLeader) {
    hero = {
      sport: 'mlb',
      name: opsLeader.full_name,
      team: opsLeader.team_abbr,
      position: opsLeader.position,
      category: 'best hitter',
      headline: `${fmt(opsLeader.stats['batting.OPS'] ?? 0, 3)} OPS`,
      primaryStat: { label: 'OPS', value: fmt(opsLeader.stats['batting.OPS'] ?? 0, 3) },
      contextStats: [
        { label: 'AVG', value: `.${(opsLeader.stats['batting.avg'] ?? 0).toFixed(3).slice(2)}` },
        { label: 'HR', value: fmt(opsLeader.stats['batting.homeRuns'] ?? 0, 0) },
        { label: 'RBI', value: fmt(opsLeader.stats['batting.RBIs'] ?? 0, 0) },
      ],
      qualifier: `${opsLeader.stats['batting.atBats'] ?? 0} AB · min ${minAB} AB`,
    };
  }

  return { hero, findings };
}

// --- NHL ---

function findNhlPlayers(): { hero: PlayerHero | null; findings: PlayerFinding[] } {
  const minGP = QUALIFIERS.nhl.minGamesPlayed;
  const minStarts = QUALIFIERS.nhl.goalieMinStarts ?? 15;
  const players = loadPlayers('nhl').filter(p => p.games_played >= minGP);
  if (players.length === 0) return { hero: null, findings: [] };
  const findings: PlayerFinding[] = [];

  // Goals (paired with goals/game)
  const scorers = topN(players, p => p.stats['offensive.goals'] ?? 0, 5);
  scorers.forEach((p, i) => {
    const g = p.stats['offensive.goals'] ?? 0;
    if (g === 0) return;
    const a = p.stats['offensive.assists'] ?? 0;
    const gpg = g / Math.max(1, p.games_played);
    findings.push({
      id: `nhl-goals-${i}`, sport: 'nhl', category: 'goal scoring', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position,
      headline: `${g} G`,
      statValue: g, statLabel: 'GOALS',
      rateStatLabel: 'G/GP', rateStatValue: fmt(gpg, 2),
      qualifier: `${p.games_played} GP · ${a} A`,
      spotlight: i === 0,
    });
  });

  // Points (paired with points/game)
  const playmakers = topN(players, p => p.stats['offensive.points'] ?? 0, 5);
  playmakers.forEach((p, i) => {
    const pts = p.stats['offensive.points'] ?? 0;
    if (pts === 0) return;
    const ppg = pts / Math.max(1, p.games_played);
    const g = p.stats['offensive.goals'] ?? 0;
    const a = p.stats['offensive.assists'] ?? 0;
    findings.push({
      id: `nhl-points-${i}`, sport: 'nhl', category: 'point production', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position,
      headline: `${pts} PTS`,
      statValue: pts, statLabel: 'POINTS',
      rateStatLabel: 'P/GP', rateStatValue: fmt(ppg, 2),
      qualifier: `${p.games_played} GP · ${g} G · ${a} A`,
      spotlight: i === 0,
    });
  });

  // Goalies — qualified goalies only, paired with save %
  const goalies = topN(
    loadPlayers('nhl').filter(p => (p.stats['goalKeeping.gamesStarted'] ?? p.stats['general.gamesStarted'] ?? 0) >= minStarts),
    p => -1 * (p.stats['defensive.goalsAgainstAverage'] ?? 99),
    5
  );
  goalies.forEach((p, i) => {
    const gaa = p.stats['defensive.goalsAgainstAverage'] ?? 0;
    if (gaa === 0) return;
    const sv = p.stats['defensive.savePct'] ?? 0;
    const w = p.stats['general.wins'] ?? 0;
    const starts = p.stats['goalKeeping.gamesStarted'] ?? p.stats['general.gamesStarted'] ?? 0;
    findings.push({
      id: `nhl-gaa-${i}`, sport: 'nhl', category: 'goaltending', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position || 'G',
      headline: `${fmt(gaa, 2)} GAA`,
      statValue: gaa, statLabel: 'GAA',
      rateStatLabel: 'SV%', rateStatValue: `${fmt(sv * 100, 1)}%`,
      qualifier: `${starts} starts · min ${minStarts} · ${w} W`,
      spotlight: i === 0,
    });
  });

  // Hero: top points + per-game
  const heroP = playmakers[0];
  let hero: PlayerHero | null = null;
  if (heroP) {
    const pts = heroP.stats['offensive.points'] ?? 0;
    const ppg = pts / Math.max(1, heroP.games_played);
    hero = {
      sport: 'nhl',
      name: heroP.full_name,
      team: heroP.team_abbr,
      position: heroP.position,
      category: 'points leader',
      headline: `${pts} points`,
      primaryStat: { label: 'POINTS', value: String(pts) },
      contextStats: [
        { label: 'G', value: fmt(heroP.stats['offensive.goals'] ?? 0, 0) },
        { label: 'A', value: fmt(heroP.stats['offensive.assists'] ?? 0, 0) },
        { label: 'P/GP', value: fmt(ppg, 2) },
      ],
      qualifier: `${heroP.games_played} GP · min ${minGP} GP`,
    };
  }

  return { hero, findings };
}

// --- Soccer (per-league, NEVER shared) ---

function findSoccerPlayers(sport: 'mls' | 'epl'): { hero: PlayerHero | null; findings: PlayerFinding[] } {
  const minGP = QUALIFIERS[sport].minGamesPlayed;
  const players = loadPlayers(sport).filter(p => (p.stats['general.appearances'] ?? p.games_played) >= minGP);
  if (players.length === 0) return { hero: null, findings: [] };
  const findings: PlayerFinding[] = [];

  // Goal scorers — paired with goals/appearance (rate stat)
  const scorers = topN(players, p => p.stats['offensive.totalGoals'] ?? p.stats['offensive.goals'] ?? 0, 5);
  scorers.forEach((p, i) => {
    const g = p.stats['offensive.totalGoals'] ?? p.stats['offensive.goals'] ?? 0;
    if (g === 0) return;
    const apps = p.stats['general.appearances'] ?? p.games_played;
    const gpa = g / Math.max(1, apps);
    const a = p.stats['offensive.goalAssists'] ?? p.stats['offensive.assists'] ?? 0;
    findings.push({
      id: `${sport}-goals-${i}`, sport, category: 'goal scoring', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position,
      headline: `${g} goals`,
      statValue: g, statLabel: 'GOALS',
      rateStatLabel: 'G/APP', rateStatValue: fmt(gpa, 2),
      qualifier: `${apps} apps · min ${minGP} apps · ${a} A`,
      spotlight: i === 0,
    });
  });

  // Assist leaders — paired with assists/appearance
  const assistLeaders = topN(players, p => p.stats['offensive.goalAssists'] ?? p.stats['offensive.assists'] ?? 0, 5);
  assistLeaders.forEach((p, i) => {
    const a = p.stats['offensive.goalAssists'] ?? p.stats['offensive.assists'] ?? 0;
    if (a === 0) return;
    const apps = p.stats['general.appearances'] ?? p.games_played;
    const apa = a / Math.max(1, apps);
    findings.push({
      id: `${sport}-assists-${i}`, sport, category: 'creating', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position,
      headline: `${a} assists`,
      statValue: a, statLabel: 'ASSISTS',
      rateStatLabel: 'A/APP', rateStatValue: fmt(apa, 2),
      qualifier: `${apps} apps · min ${minGP} apps`,
      spotlight: i === 0,
    });
  });

  // Keepers — clean sheets paired with saves
  const keepers = topN(
    loadPlayers(sport).filter(p => (p.stats['goalKeeping.cleanSheet'] ?? 0) > 0),
    p => p.stats['goalKeeping.cleanSheet'] ?? 0,
    3
  );
  keepers.forEach((p, i) => {
    const cs = p.stats['goalKeeping.cleanSheet'] ?? 0;
    if (cs === 0) return;
    const saves = p.stats['goalKeeping.saves'] ?? 0;
    const apps = p.stats['general.appearances'] ?? p.games_played;
    const csRate = apps > 0 ? cs / apps : 0;
    findings.push({
      id: `${sport}-keeper-${i}`, sport, category: 'goalkeeping', rank: i + 1,
      playerName: p.full_name, team: p.team_abbr, position: p.position || 'G',
      headline: `${cs} clean sheets`,
      statValue: cs, statLabel: 'CS',
      rateStatLabel: 'CS%', rateStatValue: `${fmt(csRate * 100, 0)}%`,
      qualifier: `${apps} apps · ${saves} saves`,
      spotlight: i === 0,
    });
  });

  // Hero: top scorer
  const heroP = scorers[0];
  let hero: PlayerHero | null = null;
  if (heroP) {
    const g = heroP.stats['offensive.totalGoals'] ?? heroP.stats['offensive.goals'] ?? 0;
    const apps = heroP.stats['general.appearances'] ?? heroP.games_played;
    const a = heroP.stats['offensive.goalAssists'] ?? heroP.stats['offensive.assists'] ?? 0;
    hero = {
      sport,
      name: heroP.full_name,
      team: heroP.team_abbr,
      position: heroP.position,
      category: 'top scorer',
      headline: `${g} goals`,
      primaryStat: { label: 'GOALS', value: String(g) },
      contextStats: [
        { label: 'ASSISTS', value: String(a) },
        { label: 'APPS', value: String(apps) },
        { label: 'G/APP', value: fmt(g / Math.max(1, apps), 2) },
      ],
      qualifier: `${apps} apps · min ${minGP} apps`,
    };
  }

  return { hero, findings };
}

// --- Aggregator ---

export function findPlayerFindings(sport: Sport): PlayerFinding[] {
  return getSportPlayerData(sport).findings;
}

export function getSportPlayerData(sport: Sport): { hero: PlayerHero | null; findings: PlayerFinding[] } {
  switch (sport) {
    case 'nba': return findNbaPlayers();
    case 'nfl': return findNflPlayers();
    case 'mlb': return findMlbPlayers();
    case 'nhl': return findNhlPlayers();
    case 'mls': return findSoccerPlayers('mls');
    case 'epl': return findSoccerPlayers('epl');
  }
}
