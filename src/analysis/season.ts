/**
 * Shared season-year utilities — single source of truth for sport calendar boundaries.
 *
 * Council mandate (P0-5 review): nbaSeasonYear was copy-pasted into 4 modules
 * with slightly different month boundaries. This module centralizes the logic.
 */

import type { Sport } from '../schema/provenance.js';

/** Return the season start date for a sport given a target date.
 *  Each sport has a different calendar:
 *  - NBA/NHL: October–June (fall-spring)
 *  - NFL: September–February (fall-winter)
 *  - MLB/MLS: March–November (spring-fall, calendar year)
 *  - EPL: August–May (fall-spring) */
export function getSeasonStart(sport: Sport, targetDate: string): string {
  const d = new Date(targetDate);
  const month = d.getUTCMonth(); // 0-indexed
  const year = d.getUTCFullYear();

  switch (sport) {
    case 'mlb':
      return `${year}-03-01`;
    case 'mls':
      return `${year}-03-01`;
    case 'nfl':
      return `${month >= 8 ? year : year - 1}-09-01`;
    case 'epl':
      return `${month >= 7 ? year : year - 1}-08-01`;
    case 'nhl':
      return `${month >= 9 ? year : year - 1}-10-01`;
    case 'nba':
    default:
      return `${month >= 9 ? year : year - 1}-10-01`;
  }
}

/** Return the season year integer for a sport given a date.
 *  For fall-spring sports, this is the year the season started.
 *  For calendar-year sports (MLB, MLS), this is the calendar year. */
export function getSeasonYear(sport: Sport, date: string): number {
  const d = new Date(date);
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();

  switch (sport) {
    case 'mlb':
    case 'mls':
      return year;
    case 'nfl':
      return month >= 8 ? year : year - 1;
    case 'epl':
      return month >= 7 ? year : year - 1;
    case 'nhl':
    case 'nba':
    default:
      return month >= 9 ? year : year - 1;
  }
}

/** Format season label for display: "2025-26" for fall-spring, "2026" for calendar-year. */
export function formatSeasonLabel(sport: Sport, seasonYear: number): string {
  if (sport === 'mlb' || sport === 'mls') {
    return String(seasonYear);
  }
  return `${seasonYear}-${String(seasonYear + 1).slice(-2)}`;
}
