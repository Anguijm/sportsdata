/**
 * Qualifier thresholds for player findings.
 * Council mandate: no leaderboard renders without minimum-games filter.
 * These prevent 2-game IL samples from beating real season leaders.
 */

import type { Sport } from '../schema/provenance.js';

export interface QualifierConfig {
  /** Minimum games played for general findings */
  minGamesPlayed: number;
  /** Sport-specific subqualifiers (e.g., MLB pitchers need IP, hitters need AB) */
  pitcherMinIP?: number;
  hitterMinAB?: number;
  goalieMinStarts?: number;
}

/** Council-mandated thresholds — sourced from Researcher (Ava) in player-impl council debate */
export const QUALIFIERS: Record<Sport, QualifierConfig> = {
  nba: {
    minGamesPlayed: 20,
  },
  nfl: {
    minGamesPlayed: 6,
  },
  mlb: {
    minGamesPlayed: 30,        // baseline
    pitcherMinIP: 50,           // qualified pitcher threshold
    hitterMinAB: 100,           // qualified hitter threshold
  },
  nhl: {
    minGamesPlayed: 20,
    goalieMinStarts: 15,        // qualified goalie threshold
  },
  mls: {
    minGamesPlayed: 8,          // shorter season
  },
  epl: {
    minGamesPlayed: 8,          // shorter season
  },
};

/** Returns qualifier label showing the THRESHOLD used (not the player's GP) */
export function qualifierLabel(sport: Sport, _gamesPlayed: number, statType?: 'pitcher' | 'hitter' | 'goalie'): string {
  const q = QUALIFIERS[sport];
  if (statType === 'pitcher' && q.pitcherMinIP) return `min ${q.pitcherMinIP} IP`;
  if (statType === 'hitter' && q.hitterMinAB) return `min ${q.hitterMinAB} AB`;
  if (statType === 'goalie' && q.goalieMinStarts) return `min ${q.goalieMinStarts} starts`;
  return `min ${q.minGamesPlayed} GP`;
}
