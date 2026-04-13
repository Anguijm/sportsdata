/**
 * Vegas closing line baseline — picks the favorite from market odds.
 *
 * Council mandate (Sprint 8 / Researcher):
 * - SHIPS AS INSTRUMENTATION, NOT VERDICT
 * - Show n explicitly
 * - 95% CI displayed
 * - Label "preliminary — insufficient sample for significance" until n >= 500
 * - Frontend MUST NOT render "v2 beats Vegas" headlines from this data
 * - Treat as instrumentation
 */

import { getDb } from '../storage/sqlite.js';
import type { Sport } from '../schema/provenance.js';
import { buildTeamStateUpTo } from './predict-runner.js';
import { v2 as v2Model } from './predict.js';

export interface VegasComparison {
  schemaVersion: 2;
  sport: Sport;
  sampleSize: number;
  significanceThreshold: 500; // council-mandated
  preliminary: boolean; // true if sampleSize < significanceThreshold
  vegas: {
    accuracy: number;
    accuracyCI95: [number, number];
    brier: number;
    brierCI95: [number, number];
  } | null;
  v2: {
    accuracy: number;
    accuracyCI95: [number, number];
    brier: number;
    brierCI95: [number, number];
  } | null;
  /** Note for honest interpretation */
  note: string;
}

interface OddsEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: Array<{
    markets: Array<{
      key: string;
      outcomes: Array<{ name: string; price: number; point?: number }>;
    }>;
  }>;
}

interface MatchedGame {
  game_id: string;
  date: string;
  home_team_id: string;
  away_team_id: string;
  actual_winner: string;
  vegas_pick: 'home' | 'away';
  vegas_prob_home: number;
}

/** Resolve a team name to a canonical sport-prefixed ID via team_mappings */
function resolveTeamId(db: ReturnType<typeof getDb>, sport: Sport, teamName: string): string | null {
  const row = db.prepare(
    'SELECT canonical_id FROM team_mappings WHERE sport = ? AND provider_name = ? COLLATE NOCASE LIMIT 1'
  ).get(sport, teamName) as { canonical_id: string } | undefined;
  return row?.canonical_id ?? null;
}

/** Convert American odds to implied probability */
function americanToImpliedProb(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return -american / (-american + 100);
}

/** Build matched-game dataset from odds_raw + game_results */
function buildMatchedGames(sport: Sport): MatchedGame[] {
  const db = getDb();

  // Pull all odds_raw rows for this sport
  const oddsRows = db.prepare(
    'SELECT id, fetched_at, api_response FROM odds_raw WHERE sport = ?'
  ).all(sport) as Array<{ id: number; fetched_at: string; api_response: string }>;

  const matched: MatchedGame[] = [];

  for (const row of oddsRows) {
    let events: OddsEvent[];
    try {
      events = JSON.parse(row.api_response) as OddsEvent[];
    } catch {
      continue;
    }
    if (!Array.isArray(events)) continue;

    for (const event of events) {
      // Match via team mapping
      const homeId = resolveTeamId(db, sport, event.home_team);
      const awayId = resolveTeamId(db, sport, event.away_team);
      if (!homeId || !awayId) continue;

      // Find the game in our results within ±1 day of commence_time
      const eventDate = event.commence_time.slice(0, 10);
      const gameResult = db.prepare(`
        SELECT gr.game_id, gr.winner, gr.home_score, gr.away_score, gr.home_win
        FROM game_results gr
        JOIN games g ON gr.game_id = g.id
        WHERE gr.sport = ?
          AND g.home_team_id = ?
          AND g.away_team_id = ?
          AND date(gr.date) BETWEEN date(?, '-1 day') AND date(?, '+1 day')
        LIMIT 1
      `).get(sport, homeId, awayId, eventDate, eventDate) as {
        game_id: string; winner: string; home_score: number; away_score: number; home_win: number;
      } | undefined;

      if (!gameResult) continue;

      // Extract Vegas pick from h2h market — use first bookmaker (market consensus is similar)
      const bookmaker = event.bookmakers[0];
      if (!bookmaker) continue;
      const h2h = bookmaker.markets.find(m => m.key === 'h2h');
      if (!h2h || h2h.outcomes.length !== 2) continue;

      const homeOutcome = h2h.outcomes.find(o => o.name === event.home_team);
      const awayOutcome = h2h.outcomes.find(o => o.name === event.away_team);
      if (!homeOutcome || !awayOutcome) continue;

      // Convert to implied probability + remove vig
      const homeImplied = americanToImpliedProb(homeOutcome.price);
      const awayImplied = americanToImpliedProb(awayOutcome.price);
      const total = homeImplied + awayImplied;
      const homeProb = homeImplied / total;

      matched.push({
        game_id: gameResult.game_id,
        date: eventDate,
        home_team_id: homeId,
        away_team_id: awayId,
        actual_winner: gameResult.winner,
        vegas_pick: homeProb >= 0.5 ? 'home' : 'away',
        vegas_prob_home: homeProb,
      });
    }
  }

  // Dedupe by game_id (multiple odds_raw rows may cover same game)
  const seen = new Set<string>();
  return matched.filter(m => {
    if (seen.has(m.game_id)) return false;
    seen.add(m.game_id);
    return true;
  });
}

/** Bootstrap CI helper */
function bootstrapCI(values: number[], iterations = 1000): [number, number] {
  if (values.length === 0) return [0, 0];
  const results: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const resample: number[] = [];
    for (let j = 0; j < values.length; j++) {
      resample.push(values[Math.floor(Math.random() * values.length)]);
    }
    const mean = resample.reduce((a, b) => a + b, 0) / resample.length;
    results.push(mean);
  }
  results.sort((a, b) => a - b);
  return [results[Math.floor(iterations * 0.025)], results[Math.floor(iterations * 0.975)]];
}

/** Compute Vegas baseline + v2 on the matched subset */
export function computeVegasComparison(sport: Sport): VegasComparison {
  const matched = buildMatchedGames(sport);
  const sampleSize = matched.length;

  if (sampleSize === 0) {
    return {
      schemaVersion: 2,
      sport,
      sampleSize: 0,
      significanceThreshold: 500,
      preliminary: true,
      vegas: null,
      v2: null,
      note: 'No matched games yet — odds_raw and game_results not yet joinable. Vegas baseline pending data accumulation.',
    };
  }

  // Vegas accuracy: did the favorite win?
  const vegasCorrect: number[] = matched.map(m => {
    const homeWon = m.actual_winner === m.home_team_id;
    const vegasPickedHome = m.vegas_pick === 'home';
    return vegasPickedHome === homeWon ? 1 : 0;
  });
  const vegasAcc = vegasCorrect.reduce((a: number, b: number) => a + b, 0) / sampleSize;
  const vegasBriers = matched.map(m => {
    const homeWon = m.actual_winner === m.home_team_id ? 1 : 0;
    return (m.vegas_prob_home - homeWon) ** 2;
  });
  const vegasBrier = vegasBriers.reduce((a, b) => a + b, 0) / sampleSize;

  // P2-12: v2 predictor on the matched subset
  let v2Acc: number | null = null;
  let v2Brier: number | null = null;
  let v2Correct: number[] | null = null;
  let v2Briers: number[] | null = null;
  if (sampleSize > 0) {
    try {
      // Codex fix: build team state per game date, not once at earliest.
      // Process chronologically so each game gets point-in-time state.
      const sortedByDate = [...matched].sort((a, b) => a.date.localeCompare(b.date));

      v2Correct = [];
      v2Briers = [];
      for (const m of sortedByDate) {
        const states = buildTeamStateUpTo(sport, m.date);
        const homeState = states.get(m.home_team_id);
        const awayState = states.get(m.away_team_id);
        if (!homeState || !awayState) {
          // Skip games where we don't have state
          continue;
        }
        const probHome = v2Model.predict(
          { game_id: m.game_id, date: m.date, sport, home_team_id: m.home_team_id, away_team_id: m.away_team_id, home_win: 0 },
          { home: homeState, away: awayState, asOfDate: m.date },
        );
        const homeWon = m.actual_winner === m.home_team_id ? 1 : 0;
        const v2PickedHome = probHome >= 0.5;
        v2Correct.push(v2PickedHome === (homeWon === 1) ? 1 : 0);
        v2Briers.push((probHome - homeWon) ** 2);
      }
      if (v2Correct.length > 0) {
        v2Acc = v2Correct.reduce((a, b) => a + b, 0) / v2Correct.length;
        v2Brier = v2Briers.reduce((a, b) => a + b, 0) / v2Briers.length;
      }
    } catch (err) {
      console.warn('Vegas baseline: v2 comparison failed:', err);
    }
  }

  return {
    schemaVersion: 2,
    sport,
    sampleSize,
    significanceThreshold: 500,
    preliminary: sampleSize < 500,
    vegas: {
      accuracy: vegasAcc,
      accuracyCI95: bootstrapCI(vegasCorrect),
      brier: vegasBrier,
      brierCI95: bootstrapCI(vegasBriers),
    },
    // P2-12: Run v2 predictor on the matched subset for comparison.
    // Council mandate: "SHIPS AS INSTRUMENTATION" — frontend must not promote
    // "v2 beats Vegas" headlines. The `preliminary` flag + note handle this.
    v2: v2Acc !== null ? {
      accuracy: v2Acc,
      accuracyCI95: bootstrapCI(v2Correct!),
      brier: v2Brier!,
      brierCI95: bootstrapCI(v2Briers!),
    } : null,
    note: sampleSize < 500
      ? `PRELIMINARY: n=${sampleSize}, well below significance threshold of 500. Treat as instrumentation, not verdict. Revisit when n >= 500.`
      : `n=${sampleSize}. Sample size adequate for comparison.`,
  };
}
