/**
 * Historical backfill — scrapes 2-3 seasons of ESPN data for all sports,
 * then generates and resolves backfill predictions.
 *
 * Phase 1: Fetch ESPN scoreboards day-by-day for each sport's historical range.
 *          Upsert games + resolve outcomes. Rate-limited at 55 req/min.
 * Phase 2: Generate v2 + v4-spread backfill predictions using point-in-time
 *          team state, then resolve them immediately (outcomes are known).
 *
 * Usage:
 *   npx tsx src/cli/backfill-historical.ts              # all sports
 *   npx tsx src/cli/backfill-historical.ts nba           # single sport
 *   npx tsx src/cli/backfill-historical.ts mlb scrape    # scrape only (no predictions)
 *   npx tsx src/cli/backfill-historical.ts nba predict   # predictions only (data exists)
 */

import { fetchScoreboard, fetchTeams } from '../scrapers/espn.js';
import { sqliteRepository, closeDb, resolveGameOutcomes, getDb } from '../storage/sqlite.js';
import { getSeasonYear } from '../analysis/season.js';
import { v2, predictMargin, compareToSpread } from '../analysis/predict.js';
import type { TeamState, GameForPrediction } from '../analysis/predict.js';
import type { Sport } from '../schema/provenance.js';
import { randomUUID } from 'node:crypto';

// --- Configuration ---

const ALL_SPORTS: Sport[] = ['nba', 'nfl', 'mlb', 'nhl', 'mls', 'epl'];

/** Global request counter across all sports — prevents inter-sport rate limit bursts. */
let globalRequestCount = 0;

/** How far back to scrape per sport (start date, inclusive). */
function getBackfillStart(sport: Sport): string {
  switch (sport) {
    case 'nba': return '2023-10-01';
    case 'nfl': return '2023-09-01';
    case 'mlb': return '2024-03-20';
    case 'nhl': return '2023-10-01';
    case 'mls': return '2024-03-01';
    case 'epl': return '2024-08-01';
    default: return '2024-01-01';
  }
}

/** Format Date as YYYYMMDD for ESPN ?dates= param. */
function toEspnDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// --- Phase 1: Historical Scrape ---

async function scrapeHistorical(sport: Sport): Promise<{ days: number; games: number }> {
  const start = new Date(getBackfillStart(sport));
  const end = new Date(); // today
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / 86400000);

  const estimatedMinutes = Math.ceil(totalDays / 55); // ~55 requests per minute
  console.log(`\n▸ ${sport.toUpperCase()} — scraping ${totalDays} days (${getBackfillStart(sport)} → today, ~${estimatedMinutes} min)`);

  // First, fetch teams so we have the roster for this sport
  const teams = await fetchTeams(sport);
  for (const t of teams) await sqliteRepository.upsertTeam(t);
  console.log(`  ✓ ${teams.length} teams`);

  let totalGames = 0;
  let daysProcessed = 0;
  const seen = new Set<string>();

  const d = new Date(start);
  while (d <= end) {
    const dateStr = toEspnDate(d);

    // Global rate limit: 55 req/min. Pause is managed by the caller via
    // globalRequestCount to prevent inter-sport bursts.
    if (globalRequestCount > 0 && globalRequestCount % 55 === 0) {
      console.log(`  … rate limit pause (${globalRequestCount} total requests, ${daysProcessed}/${totalDays} days, ${totalGames} games)`);
      await new Promise(r => setTimeout(r, 61000));
    }

    const games = await fetchScoreboard(sport, dateStr);
    globalRequestCount++;

    let dayGames = 0;
    for (const g of games) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      await sqliteRepository.upsertGame(g);
      dayGames++;
    }
    totalGames += dayGames;

    daysProcessed++;
    if (daysProcessed % 30 === 0) {
      console.log(`  … ${daysProcessed}/${totalDays} days, ${totalGames} games so far`);
    }

    d.setUTCDate(d.getUTCDate() + 1);
  }

  // Resolve all final games into game_results
  const resolved = resolveGameOutcomes();
  console.log(`  ✓ ${totalGames} games scraped, ${resolved} outcomes resolved`);

  return { days: daysProcessed, games: totalGames };
}

// --- Phase 2: Backfill Predictions ---

interface ScoredGame {
  game_id: string;
  date: string;
  sport: Sport;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  home_win: number;
  is_draw: number;
  winner: string;
  odds_json: string | null;
}

function buildAllStateSnapshots(sport: Sport): Map<string, { home: TeamState; away: TeamState }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT gr.game_id, gr.date, g.home_team_id, g.away_team_id,
           gr.home_score, gr.away_score, gr.home_win, gr.is_draw
    FROM game_results gr
    JOIN games g ON gr.game_id = g.id
    WHERE gr.sport = ?
    ORDER BY gr.date
  `).all(sport) as Array<{
    game_id: string; date: string; home_team_id: string; away_team_id: string;
    home_score: number; away_score: number; home_win: number; is_draw: number;
  }>;

  const teamStates = new Map<string, TeamState>();
  const snapshots = new Map<string, { home: TeamState; away: TeamState }>();

  const init = (id: string): TeamState => {
    if (!teamStates.has(id)) {
      teamStates.set(id, {
        games: 0, wins: 0, losses: 0,
        pointsFor: 0, pointsAgainst: 0, lastNResults: [],
      });
    }
    return teamStates.get(id)!;
  };

  for (const r of rows) {
    const isDraw = r.is_draw === 1;
    const homeState = init(r.home_team_id);
    const awayState = init(r.away_team_id);

    // Snapshot BEFORE updating (leakage guarantee)
    snapshots.set(r.game_id, {
      home: { ...homeState, lastNResults: [...homeState.lastNResults] },
      away: { ...awayState, lastNResults: [...awayState.lastNResults] },
    });

    // Update AFTER snapshot
    homeState.games++;
    awayState.games++;
    homeState.pointsFor += r.home_score;
    homeState.pointsAgainst += r.away_score;
    awayState.pointsFor += r.away_score;
    awayState.pointsAgainst += r.home_score;

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
    }
  }

  return snapshots;
}

function backfillPredictions(sport: Sport): {
  v2Inserted: number; v2Correct: number;
  spreadInserted: number; spreadCorrect: number;
  noSnapshot: number; draws: number;
} {
  const db = getDb();

  // Load all scored games with their odds
  const games = db.prepare(`
    SELECT gr.game_id, gr.date, gr.home_score, gr.away_score, gr.home_win, gr.is_draw,
           gr.winner, gr.spread_result,
           g.home_team_id, g.away_team_id, g.odds_json
    FROM game_results gr
    JOIN games g ON gr.game_id = g.id
    WHERE gr.sport = ?
    ORDER BY gr.date
  `).all(sport) as (ScoredGame & { spread_result: string | null })[];

  // Use only games from backfill cutoff season onward
  // For NBA this was 2023; for other sports use their first full scraped season
  const cutoffSeason = getSeasonYear(sport, getBackfillStart(sport));
  const testGames = games.filter(g => getSeasonYear(sport, g.date) > cutoffSeason);

  console.log(`  Total games: ${games.length}, test set (season > ${cutoffSeason}): ${testGames.length}`);

  const snapshots = buildAllStateSnapshots(sport);
  console.log(`  State snapshots: ${snapshots.size}`);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO predictions (
      id, game_id, sport, model_version, prediction_source,
      predicted_winner, predicted_prob,
      reasoning_json, reasoning_text,
      made_at, team_state_as_of, low_confidence,
      resolved_at, actual_winner, was_correct, brier_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let v2Inserted = 0, v2Correct = 0;
  let spreadInserted = 0, spreadCorrect = 0;
  let noSnapshot = 0, draws = 0;

  const insertAll = db.transaction(() => {
    for (const game of testGames) {
      const snap = snapshots.get(game.game_id);
      if (!snap) { noSnapshot++; continue; }

      // Skip draws for winner predictions (P0-2 council mandate)
      if (game.is_draw === 1) { draws++; continue; }

      const { home, away } = snap;
      const gameDate = new Date(game.date);
      const stateAsOf = new Date(gameDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const resolvedAt = new Date(gameDate.getTime() + 4 * 60 * 60 * 1000).toISOString();

      const gameForPred: GameForPrediction = {
        game_id: game.game_id,
        date: game.date,
        sport,
        home_team_id: game.home_team_id,
        away_team_id: game.away_team_id,
        home_win: 0,
      };

      // --- v2 winner prediction ---
      const probHome = v2.predict(gameForPred, { home, away, asOfDate: game.date });
      const lowConfidence = home.games < 5 || away.games < 5;
      const pickHome = probHome >= 0.5;
      const winnerId = pickHome ? game.home_team_id : game.away_team_id;
      const confidence = pickHome ? probHome : 1 - probHome;
      const wasCorrect = winnerId === game.winner ? 1 : 0;
      const brier = (confidence - wasCorrect) ** 2;

      const homeAbbr = game.home_team_id.split(':')[1] ?? game.home_team_id;
      const awayAbbr = game.away_team_id.split(':')[1] ?? game.away_team_id;

      const v2Result = insertStmt.run(
        randomUUID(), game.game_id, sport, 'v2', 'backfill',
        winnerId, confidence,
        JSON.stringify({ model: 'v2', pick: pickHome ? 'home' : 'away', prob_home_wins: probHome }),
        `Backfill: ${pickHome ? homeAbbr : awayAbbr} at ${(confidence * 100).toFixed(0)}%`,
        stateAsOf, stateAsOf, lowConfidence ? 1 : 0,
        resolvedAt, game.winner, wasCorrect, brier
      );
      if (v2Result.changes > 0) {
        v2Inserted++;
        if (wasCorrect) v2Correct++;
      }

      // --- v4-spread prediction (only if odds exist) ---
      if (game.odds_json) {
        try {
          const odds = JSON.parse(game.odds_json) as { spread?: { favorite: string; line: number } };
          if (odds.spread?.favorite && odds.spread?.line != null) {
            const margin = predictMargin(gameForPred, { home, away, asOfDate: game.date });
            const comparison = compareToSpread(margin, odds.spread.favorite, odds.spread.line, game.home_team_id, sport);
            const pickTeamId = comparison.pickSide === 'home' ? game.home_team_id : game.away_team_id;
            const tierProb = comparison.confidenceTier === 'strong' ? 0.58 : comparison.confidenceTier === 'lean' ? 0.54 : 0.51;

            let spreadCorrectVal = 0;
            if (game.spread_result === 'cover') {
              spreadCorrectVal = comparison.pickSide === 'home' ? 1 : 0;
            } else if (game.spread_result === 'miss') {
              spreadCorrectVal = comparison.pickSide === 'away' ? 1 : 0;
            }
            const spreadBrier = (tierProb - spreadCorrectVal) ** 2;

            const spreadResult = insertStmt.run(
              randomUUID(), game.game_id, sport, 'v4-spread', 'backfill',
              pickTeamId, tierProb,
              JSON.stringify({
                model: 'v4-spread',
                spread: {
                  predicted_margin: comparison.predictedMargin,
                  spread_line: comparison.spreadLine,
                  edge: comparison.edge,
                  abs_edge: comparison.absEdge,
                  confidence_tier: comparison.confidenceTier,
                  pick_side: comparison.pickSide,
                },
              }),
              `Backfill spread: ${comparison.pickSide === 'home' ? homeAbbr : awayAbbr} to cover (edge ${comparison.absEdge.toFixed(1)})`,
              stateAsOf, stateAsOf, lowConfidence ? 1 : 0,
              resolvedAt, game.winner, spreadCorrectVal, spreadBrier
            );
            if (spreadResult.changes > 0) {
              spreadInserted++;
              if (spreadCorrectVal) spreadCorrect++;
            }
          }
        } catch { /* skip bad odds */ }
      }
    }
  });

  insertAll();
  return { v2Inserted, v2Correct, spreadInserted, spreadCorrect, noSnapshot, draws };
}

// --- Main ---

async function main() {
  const sportArg = process.argv[2];
  const modeArg = process.argv[3] as 'scrape' | 'predict' | undefined;
  const sports: Sport[] = sportArg && sportArg !== 'all' && ALL_SPORTS.includes(sportArg as Sport)
    ? [sportArg as Sport]
    : ALL_SPORTS;

  console.log(`\n━━━ HISTORICAL BACKFILL ━━━`);
  console.log(`Sports: ${sports.join(', ')}`);
  console.log(`Mode: ${modeArg ?? 'full (scrape + predict)'}`);

  // Phase 1: Scrape
  if (!modeArg || modeArg === 'scrape') {
    console.log(`\n═══ PHASE 1: HISTORICAL SCRAPE ═══`);
    for (const sport of sports) {
      try {
        const result = await scrapeHistorical(sport);
        console.log(`  ${sport.toUpperCase()}: ${result.days} days, ${result.games} games`);
      } catch (err) {
        console.error(`  ✗ ${sport.toUpperCase()} scrape failed:`, err instanceof Error ? err.message : err);
      }
    }
  }

  // Phase 2: Backfill Predictions
  if (!modeArg || modeArg === 'predict') {
    console.log(`\n═══ PHASE 2: BACKFILL PREDICTIONS ═══`);
    for (const sport of sports) {
      try {
        console.log(`\n▸ ${sport.toUpperCase()}`);
        const result = backfillPredictions(sport);
        const v2Acc = result.v2Inserted > 0 ? (result.v2Correct / result.v2Inserted * 100).toFixed(1) : 'N/A';
        const spreadAcc = result.spreadInserted > 0 ? (result.spreadCorrect / result.spreadInserted * 100).toFixed(1) : 'N/A';
        console.log(`  v2: ${result.v2Inserted} predictions, ${result.v2Correct} correct (${v2Acc}%)`);
        console.log(`  v4-spread: ${result.spreadInserted} predictions, ${result.spreadCorrect} correct (${spreadAcc}%)`);
        console.log(`  skipped: ${result.noSnapshot} no snapshot, ${result.draws} draws`);
      } catch (err) {
        console.error(`  ✗ ${sport.toUpperCase()} predict failed:`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log(`\n━━━ BACKFILL COMPLETE ━━━\n`);
  closeDb();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  closeDb();
  process.exit(1);
});
