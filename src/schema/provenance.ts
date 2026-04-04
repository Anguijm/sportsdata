/** Tracks where data came from, when, and how fresh it is */
export interface Provenance {
  source: DataSource;
  retrievedAt: string; // ISO 8601
  stalenessSeconds: number;
  url?: string;
  rawResponseHash?: string;
}

export interface CorroborationResult {
  sources: Provenance[];
  agreementLevel: 'full' | 'partial' | 'conflict';
  confidenceWeight: number; // 0-1, higher when more sources agree
}

export type DataSource =
  | 'espn'
  | 'odds-api'
  | 'sportsdata-io'
  | 'sports-reference'
  | 'manual';

export type Sport = 'nfl' | 'nba' | 'mlb' | 'nhl' | 'mls';

export type Season = {
  sport: Sport;
  year: number;
  type: 'preseason' | 'regular' | 'postseason';
};
