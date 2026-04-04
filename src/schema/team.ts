import type { Provenance, Sport } from './provenance.js';

export interface Team {
  id: string; // normalized: "nfl:KC" format
  sport: Sport;
  name: string;
  abbreviation: string;
  city: string;
  conference?: string;
  division?: string;
  provenance: Provenance;
}

export interface TeamStats {
  teamId: string;
  season: string; // "2025-regular"
  wins: number;
  losses: number;
  ties?: number;
  pointsFor: number;
  pointsAgainst: number;
  homeRecord: { wins: number; losses: number };
  awayRecord: { wins: number; losses: number };
  streak: { type: 'win' | 'loss'; count: number };
  customStats: Record<string, number>; // sport-specific stats
  provenance: Provenance;
}

export interface TeamStanding {
  teamId: string;
  rank: number;
  conferenceRank?: number;
  divisionRank?: number;
  clinched?: 'playoff' | 'division' | 'bye' | 'eliminated';
  provenance: Provenance;
}
