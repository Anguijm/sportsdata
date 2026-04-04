import type { Provenance, Sport } from './provenance.js';

export interface Player {
  id: string; // normalized: "nfl:P.Mahomes" format
  sport: Sport;
  name: string;
  teamId: string;
  position: string;
  number?: number;
  status: 'active' | 'injured' | 'suspended' | 'inactive';
  injuryDetails?: {
    type: string;
    expectedReturn?: string; // ISO date
  };
  provenance: Provenance;
}

export interface PlayerStats {
  playerId: string;
  season: string; // "2025-regular"
  gamesPlayed: number;
  gamesStarted: number;
  coreStats: Record<string, number>; // sport/position-specific
  advancedStats?: Record<string, number>;
  provenance: Provenance;
}

export interface PlayerGameLog {
  playerId: string;
  gameId: string;
  date: string; // ISO date
  opponent: string;
  homeAway: 'home' | 'away';
  stats: Record<string, number>;
  provenance: Provenance;
}
