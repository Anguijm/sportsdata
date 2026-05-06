/**
 * Predict-runner — applies the v2 ratchet model to upcoming scheduled games.
 *
 * Council mandates honored:
 * - reasoning_json (re-renderable) + reasoning_text (display)
 * - team_state_as_of (snapshot timestamp, not insert time)
 * - low_confidence flag for <5 games of state
 * - "Model pick:" framing in text output
 * - Idempotent UPSERT on (game_id, model_version)
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../storage/sqlite.js';
import type { Sport } from '../schema/provenance.js';
import { predictWithInjuries } from './predict.js';
import type { TeamState, InjuryImpact } from './predict.js';
import { getTeamInjuries } from '../scrapers/injuries.js';
import { getSeasonStart, getSeasonYear } from './season.js';

export interface PredictionRecord {
  id: string;
  game_id: string;
  sport: Sport;
  model_version: string;
  predicted_winner: string;
  predicted_prob: number;
  reasoning_json: string;
  reasoning_text: string;
  made_at: string;
  team_state_as_of: string;
  low_confidence: 0 | 1;
}

interface ScheduledGame {
  id: string;
  date: string;
  sport: Sport;
  home_team_id: string;
  away_team_id: string;
}

interface ReasoningJson {
  model: string;
  features: {
    home_wins: number;
    home_losses: number;
    home_diff_per_game: number;
    away_wins: number;
    away_losses: number;
    away_diff_per_game: number;
    win_gap: number;
    diff_gap: number;
    low_confidence: boolean;
  };
  pick: 'home' | 'away';
  prob_home_wins: number;
  /** Debt #14: true on shadow rows (model_version='v5-naive'), absent on adjusted rows. */
  shadow?: boolean;
  /** Injury impact logged for future backtesting of the noise-threshold model. */
  injury?: { homeOutImpact: number; awayOutImpact: number; netImpact: number; ramp: number };
}

/** @deprecated Use getSeasonYear from './season.js' instead. Kept for backwards compat. */
export function nbaSeasonYear(date: string): number {
  return getSeasonYear('nba', date);
}

/** Build CURRENT-SEASON team state for the sport up to (and not including) a target date.
 *  Council mandate: we don't carry stale records across seasons. */
export function buildTeamStateUpTo(sport: Sport, targetDate: string): Map<string, TeamState> {
  const db = getDb();

  const seasonStart = getSeasonStart(sport, targetDate);

  const rows = db.prepare(`
    SELECT date, winner, loser, home_score, away_score, home_win, is_draw
    FROM game_results
    WHERE sport = ? AND date >= ? AND date < ?
    ORDER BY date
  `).all(sport, seasonStart, targetDate) as Array<{
    date: string; winner: string; loser: string;
    home_score: number; away_score: number; home_win: number; is_draw: number;
  }>;

  const states = new Map<string, TeamState>();
  const init = (id: string): TeamState => {
    if (!states.has(id)) {
      states.set(id, {
        games: 0, wins: 0, losses: 0,
        pointsFor: 0, pointsAgainst: 0,
        lastNResults: [],
      });
    }
    return states.get(id)!;
  };

  for (const r of rows) {
    // For draws, winner=home by convention (P0-2). Derive team IDs from
    // the winner/loser fields since home_win=0 for both draws and away wins.
    const isDraw = r.is_draw === 1;
    const homeId = (r.home_win === 1 || isDraw) ? r.winner : r.loser;
    const awayId = (r.home_win === 1 || isDraw) ? r.loser : r.winner;
    const homeState = init(homeId);
    const awayState = init(awayId);

    homeState.games++;
    awayState.games++;
    homeState.pointsFor += r.home_score;
    homeState.pointsAgainst += r.away_score;
    awayState.pointsFor += r.away_score;
    awayState.pointsAgainst += r.home_score;

    // Draws: increment games (already done above) but NOT wins or losses.
    // Council mandate (P0-2): without this, draws counted as away wins,
    // corrupting team state for MLS/EPL where ~25-30% of games draw.
    if (!isDraw) {
      const homeWon = r.home_win === 1;
      if (homeWon) {
        homeState.wins++;
        awayState.losses++;
      } else {
        homeState.losses++;
        awayState.wins++;
      }
      homeState.lastNResults = [...homeState.lastNResults, r.home_win === 1].slice(-5);
      awayState.lastNResults = [...awayState.lastNResults, r.home_win !== 1].slice(-5);
    } else {
      // Draw: treat as neither win nor loss in streak tracking
      homeState.lastNResults = [...homeState.lastNResults].slice(-5);
      awayState.lastNResults = [...awayState.lastNResults].slice(-5);
    }
  }

  return states;
}

/** Generate human-readable reasoning text from reasoning JSON */
function generateReasoningText(
  reasoning: ReasoningJson,
  homeAbbr: string,
  awayAbbr: string,
): string {
  const f = reasoning.features;
  const pickedAbbr = reasoning.pick === 'home' ? homeAbbr : awayAbbr;
  const otherAbbr = reasoning.pick === 'home' ? awayAbbr : homeAbbr;
  const confidence = reasoning.pick === 'home' ? reasoning.prob_home_wins : 1 - reasoning.prob_home_wins;

  if (f.low_confidence) {
    return `Model pick: ${pickedAbbr}. Low confidence — both teams have fewer than 5 games of season state. Defaulting to slight home edge. Confidence: ${(confidence * 100).toFixed(0)}%.`;
  }

  const parts: string[] = [`Model pick: ${pickedAbbr} over ${otherAbbr}.`];

  if (Math.abs(f.win_gap) >= 10) {
    const aheadAbbr = f.win_gap > 0 ? awayAbbr : homeAbbr;
    parts.push(`${aheadAbbr} has ${Math.abs(f.win_gap)} more wins (${f.win_gap > 0 ? f.away_wins : f.home_wins} vs ${f.win_gap > 0 ? f.home_wins : f.away_wins}).`);
  }

  if (Math.abs(f.diff_gap) >= 3) {
    const home_diff_str = f.home_diff_per_game >= 0 ? `+${f.home_diff_per_game.toFixed(1)}` : f.home_diff_per_game.toFixed(1);
    const away_diff_str = f.away_diff_per_game >= 0 ? `+${f.away_diff_per_game.toFixed(1)}` : f.away_diff_per_game.toFixed(1);
    parts.push(`Point differential: ${homeAbbr} ${home_diff_str}, ${awayAbbr} ${away_diff_str}.`);
  }

  if (parts.length === 1) {
    parts.push(`Records and point differentials are close — slight home court edge.`);
  }

  parts.push(`Confidence: ${(confidence * 100).toFixed(0)}%.`);
  return parts.join(' ');
}

/** Run v2 prediction on a single scheduled game */
/** Compute injury impact for a team by looking up injured players' season stats.
 *  Returns the total PPG/goals-per-game of effectively-out players.
 *
 *  Council mandates (injury signal review):
 *  - Only count RECENT injuries (reported within last 7 days) to avoid
 *    double-counting with teamDiff (chronic absences already reflected)
 *  - Use sport-appropriate impact metrics (not NFL touchdowns)
 *  - Log unmatched players so silent degradation is visible
 */
export function computeInjuryImpact(sport: Sport, teamId: string): number {
  const injuries = getTeamInjuries(sport, teamId);
  if (injuries.length === 0) return 0;

  // Recency filter: only count injuries first observed within last 7 days.
  // Older injuries are already reflected in the team's point differential.
  // Uses firstSeenAt (persisted across scrape cycles) instead of fetchedAt
  // (which resets every cycle, making chronic injuries always look "recent").
  const recentCutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const recentInjuries = injuries.filter(inj => (inj.firstSeenAt || inj.fetchedAt) >= recentCutoff);
  if (recentInjuries.length === 0) return 0;

  const db = getDb();

  // Sport-appropriate impact metrics (council Domain Expert fixes):
  // NBA: avgPoints (per-game, direct)
  // NFL: games_played as proxy for starter importance (TDs was rejected)
  // MLB: batting.OPS (better than RBIs per sabermetrics)
  // NHL: offensive.points / games (goals + assists per game)
  //
  // MAX_INDIVIDUAL: per-player clamp (council Math Expert mandate).
  // If ESPN returns a schema-drifted value (e.g. 250 PPG from a missing
  // decimal), one player's impact can't overwhelm the model. Values set
  // above any realistic all-time leader:
  //   NBA: 40 PPG (>Wilt's 50.4 season avg but protects against drift)
  //   NFL: 17 games started (full season starter)
  //   MLB: 1.5 OPS (Babe Ruth's peak was ~1.38)
  //   NHL: 2.0 pts/game (Gretzky's peak)
  //   Soccer: 1.5 goals/game (>Messi's 2011-12 peak of ~1.0)
  const IMPACT_CONFIG: Record<string, {
    stat: string;
    isPerGame: boolean;
    fallbackPerGame: number;
    maxIndividual: number;
    maxTeam: number;
  }> = {
    nba: { stat: 'offensive.avgPoints',    isPerGame: true,  fallbackPerGame: 10,  maxIndividual: 40,  maxTeam: 80  },
    nfl: { stat: 'general.gamesStarted',   isPerGame: false, fallbackPerGame: 3,   maxIndividual: 17,  maxTeam: 34  },
    mlb: { stat: 'batting.OPS',            isPerGame: true,  fallbackPerGame: 0.3, maxIndividual: 1.5, maxTeam: 3.0 },
    nhl: { stat: 'offensive.points',       isPerGame: false, fallbackPerGame: 0.5, maxIndividual: 2.0, maxTeam: 4.0 },
    mls: { stat: 'offensive.totalGoals',   isPerGame: false, fallbackPerGame: 0.2, maxIndividual: 1.5, maxTeam: 3.0 },
    epl: { stat: 'offensive.totalGoals',   isPerGame: false, fallbackPerGame: 0.2, maxIndividual: 1.5, maxTeam: 3.0 },
  };
  const config = IMPACT_CONFIG[sport] ?? IMPACT_CONFIG['nba'];

  // Position multiplier: amplifies high-leverage positions (QB, MLB SP) and
  // discounts low-leverage ones (kickers, relievers). For sports where position
  // doesn't predict impact (NBA G/F/C), use stats-based threshold instead.
  // debt #16: INJURY_COMPENSATION may need recalibration after this change.
  function positionMultiplier(position: string | null, perGame: number): number {
    const pos = position?.toUpperCase() ?? '';
    if (sport === 'nfl') {
      if (pos === 'QB') return 3.0;
      if (pos === 'RB' || pos === 'WR' || pos === 'TE') return 1.5;
      if (pos === 'PK' || pos === 'P' || pos === 'LS') return 0.5;
      return 1.0;
    }
    if (sport === 'mlb') {
      if (pos === 'SP') return 1.5;
      if (pos === 'RP') return 0.5;
      return 1.0;
    }
    // NBA/NHL/Soccer: position doesn't reliably indicate leverage; use stats threshold.
    // Continuous piecewise-linear over [0.5, 1.5]: anchors at 0.1·maxPG → 0.5×,
    // 0.5·maxPG → 1.5× (midpoint 0.3·maxPG → 1.0×, matching prior step-function default).
    // Avoids the cliff effect where a player just under maxPG·0.5 got 1.0× and
    // one just over got 1.5×.
    const ratio = perGame / config.maxIndividual;
    if (ratio <= 0.1) return 0.5;
    if (ratio >= 0.5) return 1.5;
    return 0.5 + (ratio - 0.1) * 2.5;
  }

  let totalImpact = 0;
  for (const inj of recentInjuries) {
    // Look up player's season stats — try exact name first, then fuzzy
    let row = db.prepare(`
      SELECT stats_json, games_played, position FROM player_stats
      WHERE team_abbr = ? AND sport = ? AND full_name = ?
      ORDER BY season DESC LIMIT 1
    `).get(inj.teamAbbr, sport, inj.playerName) as { stats_json: string; games_played: number; position: string | null } | undefined;

    // Fuzzy fallback: LIKE match on last name
    if (!row) {
      const lastName = inj.playerName.split(' ').pop() ?? inj.playerName;
      row = db.prepare(`
        SELECT stats_json, games_played, position FROM player_stats
        WHERE team_abbr = ? AND sport = ? AND full_name LIKE ?
        ORDER BY season DESC LIMIT 1
      `).get(inj.teamAbbr, sport, `%${lastName}%`) as typeof row;
    }

    if (!row) {
      console.warn(`  ⚠ Injury: ${inj.playerName} (${inj.teamAbbr}) not found in player_stats`);
      continue;
    }
    if (row.games_played < 5) continue;

    try {
      const stats = JSON.parse(row.stats_json) as Record<string, number>;
      const value = stats[config.stat] ?? config.fallbackPerGame;
      const perGame = config.isPerGame ? value : value / row.games_played;
      // Clamp per-player contribution to protect against ESPN schema drift
      const clampedPerGame = Math.min(Math.max(perGame, 0), config.maxIndividual);
      if (perGame > config.maxIndividual) {
        console.warn(`  ⚠ Injury impact clamped for ${inj.playerName}: ${perGame.toFixed(2)} → ${config.maxIndividual}`);
      }
      totalImpact += clampedPerGame * positionMultiplier(row.position, perGame);
    } catch { /* skip */ }
  }
  // Team-level cap: prevents multiple high-multiplier injuries from overwhelming the model.
  return Math.min(totalImpact, config.maxTeam);
}

export function predictGame(
  game: ScheduledGame,
  states: Map<string, TeamState>,
  asOfDate: string,
): PredictionRecord[] {
  const homeState = states.get(game.home_team_id) ?? {
    games: 0, wins: 0, losses: 0,
    pointsFor: 0, pointsAgainst: 0, lastNResults: [],
  };
  const awayState = states.get(game.away_team_id) ?? {
    games: 0, wins: 0, losses: 0,
    pointsFor: 0, pointsAgainst: 0, lastNResults: [],
  };

  const ctx = {
    home: homeState,
    away: awayState,
    asOfDate,
  };

  // Compute injury impact (orthogonal signal — council mandate)
  const injuryImpact: InjuryImpact = {
    homeOutImpact: computeInjuryImpact(game.sport, game.home_team_id),
    awayOutImpact: computeInjuryImpact(game.sport, game.away_team_id),
  };
  const hasInjuryData = injuryImpact.homeOutImpact > 0 || injuryImpact.awayOutImpact > 0;

  const gameForPred = {
    game_id: game.id,
    date: game.date,
    sport: game.sport,
    home_team_id: game.home_team_id,
    away_team_id: game.away_team_id,
    home_win: 0,
  };

  // Use injury-adjusted prediction when injury data is available.
  // `predictWithInjuries(..., undefined)` is mathematically identical to
  // `v5.predict` (injuryAdj=0 branch); using the former is the single source
  // of truth for the sigmoid math.
  const probHome = hasInjuryData
    ? predictWithInjuries(gameForPred, ctx, injuryImpact)
    : predictWithInjuries(gameForPred, ctx, undefined);

  const lowConfidence = homeState.games < 5 || awayState.games < 5;
  const pick = probHome >= 0.5 ? 'home' : 'away';
  const winnerId = pick === 'home' ? game.home_team_id : game.away_team_id;

  const homeDiff = homeState.games > 0 ? (homeState.pointsFor - homeState.pointsAgainst) / homeState.games : 0;
  const awayDiff = awayState.games > 0 ? (awayState.pointsFor - awayState.pointsAgainst) / awayState.games : 0;

  const baseFeatures = {
    home_wins: homeState.wins,
    home_losses: homeState.losses,
    home_diff_per_game: homeDiff,
    away_wins: awayState.wins,
    away_losses: awayState.losses,
    away_diff_per_game: awayDiff,
    win_gap: awayState.wins - homeState.wins,
    diff_gap: awayDiff - homeDiff,
    low_confidence: lowConfidence,
  };

  const netImpact = injuryImpact.awayOutImpact - injuryImpact.homeOutImpact;
  const injuryRamp = Math.min(1, Math.max(0, (Math.abs(netImpact) - 1) / 2));
  const reasoning: ReasoningJson = {
    model: 'v5',
    features: baseFeatures,
    pick,
    prob_home_wins: probHome,
    ...(hasInjuryData && {
      injury: {
        homeOutImpact: injuryImpact.homeOutImpact,
        awayOutImpact: injuryImpact.awayOutImpact,
        netImpact,
        ramp: injuryRamp,
      },
    }),
  };

  const homeAbbr = game.home_team_id.split(':')[1] ?? game.home_team_id;
  const awayAbbr = game.away_team_id.split(':')[1] ?? game.away_team_id;
  const reasoningText = generateReasoningText(reasoning, homeAbbr, awayAbbr);
  const madeAt = new Date().toISOString();

  const records: PredictionRecord[] = [{
    id: randomUUID(),
    game_id: game.id,
    sport: game.sport,
    model_version: 'v5',
    predicted_winner: winnerId,
    predicted_prob: pick === 'home' ? probHome : 1 - probHome,
    reasoning_json: JSON.stringify(reasoning),
    reasoning_text: reasoningText,
    made_at: madeAt,
    team_state_as_of: asOfDate,
    low_confidence: lowConfidence ? 1 : 0,
  }];

  // Debt #14: shadow row — naive prediction (injury signal disabled) for A/B.
  // Only emitted when injuries would actually shift the prediction; otherwise
  // naive ≡ adjusted and the shadow row would be a wasteful duplicate.
  // Codex #38 P2: low-confidence games (either team <5 games) return baseRate
  // from predictWithInjuries regardless of injuries, so adjusted ≡ naive in
  // that case too. Gate on both conditions to avoid zero-delta pairs.
  if (hasInjuryData && !lowConfidence) {
    const naiveProbHome = predictWithInjuries(gameForPred, ctx, undefined);
    const naivePick = naiveProbHome >= 0.5 ? 'home' : 'away';
    const naiveWinnerId = naivePick === 'home' ? game.home_team_id : game.away_team_id;
    const naiveReasoning: ReasoningJson = {
      model: 'v5-naive',
      features: baseFeatures,
      pick: naivePick,
      prob_home_wins: naiveProbHome,
      shadow: true,
    };
    records.push({
      id: randomUUID(),
      game_id: game.id,
      sport: game.sport,
      model_version: 'v5-naive',
      predicted_winner: naiveWinnerId,
      predicted_prob: naivePick === 'home' ? naiveProbHome : 1 - naiveProbHome,
      reasoning_json: JSON.stringify(naiveReasoning),
      reasoning_text: generateReasoningText(naiveReasoning, homeAbbr, awayAbbr),
      made_at: madeAt,
      team_state_as_of: asOfDate,
      low_confidence: lowConfidence ? 1 : 0,
    });
  }

  return records;
}

/** Run predictions for all upcoming scheduled games of a sport */
export function predictUpcoming(sport: Sport): { predictions: PredictionRecord[]; skipped: number } {
  const db = getDb();

  // Find scheduled games (status = 'scheduled' and date >= today)
  const today = new Date().toISOString().slice(0, 10);
  const scheduledGames = db.prepare(`
    SELECT id, date, sport, home_team_id, away_team_id
    FROM games
    WHERE sport = ? AND status = 'scheduled' AND date >= ?
    ORDER BY date
    LIMIT 50
  `).all(sport, today) as ScheduledGame[];

  if (scheduledGames.length === 0) {
    return { predictions: [], skipped: 0 };
  }

  // Build state once at the asOfDate (today midnight UTC)
  const asOfDate = new Date().toISOString();
  const states = buildTeamStateUpTo(sport, asOfDate);

  const predictions: PredictionRecord[] = [];
  let skipped = 0;

  // Idempotent: skip games only if we have BOTH v5 AND v5-naive already (or no
  // shadow is expected). Codex #38 P1: skipping on v5 alone would leave any
  // game already predicted before this PR deployed without a shadow row, since
  // predictGame would never run to produce the v5-naive counterpart. Running
  // predictGame when only v5 exists is safe — the UPSERT on v5 is a no-op and
  // the new v5-naive row inserts cleanly when injury data + high confidence
  // both apply.
  const existingStmt = db.prepare(
    'SELECT 1 FROM predictions WHERE game_id = ? AND model_version = ?'
  );

  for (const game of scheduledGames) {
    const hasV5 = !!existingStmt.get(game.id, 'v5');
    const hasV5Naive = !!existingStmt.get(game.id, 'v5-naive');
    if (hasV5 && hasV5Naive) {
      skipped++;
      continue;
    }
    predictions.push(...predictGame(game, states, asOfDate));
  }

  // Persist via UPSERT (council: idempotent on conflict)
  const insertStmt = db.prepare(`
    INSERT INTO predictions (
      id, game_id, sport, model_version, prediction_source,
      predicted_winner, predicted_prob,
      reasoning_json, reasoning_text,
      made_at, team_state_as_of, low_confidence
    ) VALUES (?, ?, ?, ?, 'live', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (game_id, model_version, prediction_source) DO NOTHING
  `);

  const insertAll = db.transaction((items: PredictionRecord[]) => {
    for (const p of items) {
      insertStmt.run(
        p.id, p.game_id, p.sport, p.model_version,
        p.predicted_winner, p.predicted_prob,
        p.reasoning_json, p.reasoning_text,
        p.made_at, p.team_state_as_of, p.low_confidence
      );
    }
  });

  insertAll(predictions);
  return { predictions, skipped };
}
