import type { Provenance, Sport } from './provenance.js';

export interface Game {
  id: string; // normalized: "nfl:2025-W12-KC@BUF"
  sport: Sport;
  season: string;
  date: string; // ISO 8601
  homeTeamId: string;
  awayTeamId: string;
  venue?: string;
  status: 'scheduled' | 'in_progress' | 'final' | 'postponed' | 'cancelled';
  score?: GameScore;
  odds?: GameOdds;
  weather?: WeatherConditions;
  /** MLB probable starting pitchers — extracted from ESPN scoreboard. */
  probablePitchers?: {
    home?: ProbablePitcher;
    away?: ProbablePitcher;
    /** ISO timestamp when pitcher data was last fetched. Enables staleness
     *  detection — probables can change up to game time. */
    fetchedAt?: string;
  };
  provenance: Provenance;
}

export interface ProbablePitcher {
  name: string;
  espnId?: number;
  /** Season ERA — 0.00 means unknown or first start */
  era: number;
  /** Season record string, e.g. "5-3, 3.21 ERA" */
  record?: string;
}

export interface GameScore {
  home: number;
  away: number;
  periodScores?: { period: string; home: number; away: number }[];
  overtime: boolean;
}

export interface GameOdds {
  spread: { favorite: string; line: number };
  overUnder: number;
  moneyline: { home: number; away: number };
  source: string;
  asOf: string; // ISO timestamp — odds change
  provenance: Provenance;
}

export interface WeatherConditions {
  temperature?: number; // Fahrenheit
  wind?: number; // mph
  precipitation?: string;
  dome: boolean;
}

export interface GameResult {
  gameId: string;
  winner: string;
  spreadResult: 'cover' | 'push' | 'miss';
  overUnderResult: 'over' | 'push' | 'under';
  provenance: Provenance;
}
