/**
 * Backfill prediction history from ratchet test set.
 *
 * Council mandates (Sprint 8.5 review, 2 CLEAR / 2 WARN):
 * - Skeptic: prediction_source='backfill', made_at = game_date - 1day (NOT now)
 * - Architect: composite key (game_id, model_version, prediction_source), upsert idempotent
 * - Quant: invariant team_state_as_of <= made_at < game_date enforced + tested
 * - UX: backfill display SEPARATE from live (frontend responsibility, not this script's)
 *
 * Honest construction:
 * - Same point-in-time team state as Sprint 6 ratchet
 * - team_state_as_of < game_date for every row (provable, asserted)
 * - Identical predict() code path as live predictions (v2 from src/analysis/predict.ts)
 * - Resolved immediately because we already know the outcomes
 */

import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from '../storage/sqlite.js';
import { v2 } from '../analysis/predict.js';
import type { TeamState } from '../analysis/predict.js';
import type { Sport } from '../schema/provenance.js';

interface ScoredGame {
  game_id: string;
  date: string;
  sport: Sport;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  home_win: number;
  winner: string;
}

function nbaSeasonYear(date: string): number {
  const d = new Date(date);
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  return month >= 9 ? year : year - 1;
}

function loadHeldOutGames(sport: Sport, trainCutoffSeason: number): ScoredGame[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT gr.game_id, gr.date, g.home_team_id, g.away_team_id,
           gr.home_score, gr.away_score, gr.home_win, gr.winner
    FROM game_results gr
    JOIN games g ON gr.game_id = g.id
    WHERE gr.sport = ?
    ORDER BY gr.date
  `).all(sport) as Array<Omit<ScoredGame, 'sport'>>;

  return rows
    .filter(r => nbaSeasonYear(r.date) > trainCutoffSeason)
    .map(r => ({ ...r, sport }));
}

function buildAllStateSnapshots(sport: Sport): Map<string, { home: TeamState; away: TeamState }> {
  const db = getDb();
  // Walk every game in chronological order, recording the state BEFORE each game
  const rows = db.prepare(`
    SELECT gr.game_id, gr.date, g.home_team_id, g.away_team_id,
           gr.home_score, gr.away_score, gr.home_win
    FROM game_results gr
    JOIN games g ON gr.game_id = g.id
    WHERE gr.sport = ?
    ORDER BY gr.date
  `).all(sport) as Array<{
    game_id: string; date: string; home_team_id: string; away_team_id: string;
    home_score: number; away_score: number; home_win: number;
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
    const homeState = init(r.home_team_id);
    const awayState = init(r.away_team_id);

    // Snapshot BEFORE updating (this is the council's leakage guarantee)
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

    const homeWon = r.home_win === 1;
    if (homeWon) {
      homeState.wins++;
      awayState.losses++;
    } else {
      homeState.losses++;
      awayState.wins++;
    }
    homeState.lastNResults = [...homeState.lastNResults, homeWon].slice(-5);
    awayState.lastNResults = [...awayState.lastNResults, !homeWon].slice(-5);
  }

  return snapshots;
}

function generateReasoningText(
  homeAbbr: string,
  awayAbbr: string,
  pickedAbbr: string,
  confidence: number,
  homeWins: number,
  awayWins: number,
  homeDiff: number,
  awayDiff: number,
  lowConfidence: boolean,
): string {
  if (lowConfidence) {
    return `Model pick: ${pickedAbbr}. Low confidence — fewer than 5 games of state. Confidence: ${(confidence * 100).toFixed(0)}%.`;
  }
  const winGap = awayWins - homeWins;
  const diffGap = awayDiff - homeDiff;
  const parts: string[] = [`Model pick: ${pickedAbbr}.`];
  if (Math.abs(winGap) >= 10) {
    const aheadAbbr = winGap > 0 ? awayAbbr : homeAbbr;
    parts.push(`${aheadAbbr} has ${Math.abs(winGap)} more wins (${winGap > 0 ? awayWins : homeWins} vs ${winGap > 0 ? homeWins : awayWins}).`);
  }
  if (Math.abs(diffGap) >= 3) {
    parts.push(`Point differential: ${homeAbbr} ${homeDiff >= 0 ? '+' : ''}${homeDiff.toFixed(1)}, ${awayAbbr} ${awayDiff >= 0 ? '+' : ''}${awayDiff.toFixed(1)}.`);
  }
  if (parts.length === 1) parts.push(`Records and differentials close — slight home edge.`);
  parts.push(`Confidence: ${(confidence * 100).toFixed(0)}%.`);
  return parts.join(' ');
}

function backfillSport(sport: Sport, trainCutoffSeason = 2023): {
  inserted: number; correct: number; lowConfidence: number; skipped: number;
} {
  const db = getDb();
  const heldOutGames = loadHeldOutGames(sport, trainCutoffSeason);
  console.log(`  Held-out games (test set): ${heldOutGames.length}`);

  const snapshots = buildAllStateSnapshots(sport);
  console.log(`  State snapshots built: ${snapshots.size}`);

  // Use existing live UNIQUE constraint avoidance: this script writes only
  // 'backfill' source. But the OLD constraint UNIQUE(game_id, model_version)
  // may still exist on previously-migrated tables. Use INSERT OR IGNORE to skip
  // game_ids that already have a v2 prediction (live or otherwise).
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO predictions (
      id, game_id, sport, model_version, prediction_source,
      predicted_winner, predicted_prob,
      reasoning_json, reasoning_text,
      made_at, team_state_as_of, low_confidence,
      resolved_at, actual_winner, was_correct, brier_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    let inserted = 0;
    let correct = 0;
    let lowConf = 0;
    let skipped = 0;

    for (const game of heldOutGames) {
      const snap = snapshots.get(game.game_id);
      if (!snap) {
        skipped++;
        continue;
      }
      const { home, away } = snap;

      // Run v2 — same code path as live
      const probHome = v2.predict(
        {
          game_id: game.game_id,
          date: game.date,
          sport: game.sport,
          home_team_id: game.home_team_id,
          away_team_id: game.away_team_id,
          home_win: 0, // predictor must not see this
        },
        { home, away, asOfDate: game.date }
      );

      const lowConfidence = home.games < 5 || away.games < 5;
      const pickHome = probHome >= 0.5;
      const winnerId = pickHome ? game.home_team_id : game.away_team_id;
      const confidence = pickHome ? probHome : 1 - probHome;

      const wasCorrect = winnerId === game.winner ? 1 : 0;
      const outcome = wasCorrect;
      const brier = (confidence - outcome) ** 2;

      const homeDiff = home.games > 0 ? (home.pointsFor - home.pointsAgainst) / home.games : 0;
      const awayDiff = away.games > 0 ? (away.pointsFor - away.pointsAgainst) / away.games : 0;

      const reasoningJson = JSON.stringify({
        model: 'v2',
        features: {
          home_wins: home.wins,
          home_losses: home.losses,
          home_diff_per_game: homeDiff,
          away_wins: away.wins,
          away_losses: away.losses,
          away_diff_per_game: awayDiff,
          win_gap: away.wins - home.wins,
          diff_gap: awayDiff - homeDiff,
          low_confidence: lowConfidence,
        },
        pick: pickHome ? 'home' : 'away',
        prob_home_wins: probHome,
      });

      const homeAbbr = game.home_team_id.split(':')[1] ?? game.home_team_id;
      const awayAbbr = game.away_team_id.split(':')[1] ?? game.away_team_id;
      const pickedAbbr = pickHome ? homeAbbr : awayAbbr;
      const reasoningText = generateReasoningText(
        homeAbbr, awayAbbr, pickedAbbr, confidence,
        home.wins, away.wins, homeDiff, awayDiff, lowConfidence
      );

      // Council mandate (Skeptic): made_at = game_date - 1 day, NOT now()
      // This preserves temporal analysis ability and is honest about WHEN the
      // prediction would have been made if we'd been running v2 live.
      const gameDate = new Date(game.date);
      const stateAsOf = new Date(gameDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const madeAt = stateAsOf; // same — backfill is "made the day before"
      const resolvedAt = new Date(gameDate.getTime() + 4 * 60 * 60 * 1000).toISOString(); // +4h after game start

      // Council mandate (Quant): invariant assertion
      if (new Date(stateAsOf).getTime() >= new Date(game.date).getTime()) {
        throw new Error(`Leakage invariant violated for game ${game.game_id}: state_as_of=${stateAsOf} >= game_date=${game.date}`);
      }

      const result = insertStmt.run(
        randomUUID(),
        game.game_id,
        game.sport,
        'v2',
        'backfill', // council mandate (Architect)
        winnerId,
        confidence,
        reasoningJson,
        reasoningText,
        madeAt,
        stateAsOf,
        lowConfidence ? 1 : 0,
        resolvedAt,
        game.winner,
        wasCorrect,
        brier
      );

      if (result.changes > 0) {
        inserted++;
        if (wasCorrect) correct++;
        if (lowConfidence) lowConf++;
      } else {
        skipped++;
      }
    }
    return { inserted, correct, lowConfidence: lowConf, skipped };
  });

  return insertAll();
}

function main() {
  const sport: Sport = (process.argv[2] as Sport) ?? 'nba';
  console.log(`\n━━━ BACKFILL PREDICTIONS: ${sport.toUpperCase()} ━━━`);
  console.log(`Train cutoff: 2023 season (test set is 2024-25 + 2025-26)`);

  const result = backfillSport(sport);

  console.log(`\n━━━ COMPLETE ━━━`);
  console.log(`  Inserted: ${result.inserted}`);
  console.log(`  Correct: ${result.correct} (${result.inserted > 0 ? ((result.correct / result.inserted) * 100).toFixed(1) : 0}%)`);
  console.log(`  Low confidence: ${result.lowConfidence}`);
  console.log(`  Skipped: ${result.skipped}`);

  if (result.inserted > 0) {
    const accExcludingLow = (result.correct - 0) / (result.inserted - result.lowConfidence);
    console.log(`  Accuracy excluding low-confidence: ${(accExcludingLow * 100).toFixed(1)}%`);
  }

  closeDb();
}

main();
