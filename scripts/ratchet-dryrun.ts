/**
 * Council-mandated Day 1 dry-run before building ratchet scaffolding.
 * Load 100 NBA games, run simplest v0 prediction, verify Brier score computes.
 *
 * v0 = pick home team every time (the baseline we must beat)
 */

import { getDb, closeDb } from '../src/storage/sqlite.js';

interface GameRow {
  game_id: string;
  date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  home_win: number;
}

function nbaSeasonYear(date: string): number {
  const d = new Date(date);
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  return month >= 9 ? year : year - 1;
}

function main() {
  const db = getDb();

  // Load all NBA games with full context
  const games = db.prepare(`
    SELECT gr.game_id, gr.date, g.home_team_id, g.away_team_id,
           gr.home_score, gr.away_score, gr.home_win
    FROM game_results gr
    JOIN games g ON gr.game_id = g.id
    WHERE gr.sport = 'nba'
    ORDER BY gr.date
  `).all() as GameRow[];

  console.log(`Total NBA games: ${games.length}`);

  // Season breakdown
  const bySeason = new Map<number, number>();
  for (const g of games) {
    const s = nbaSeasonYear(g.date);
    bySeason.set(s, (bySeason.get(s) ?? 0) + 1);
  }
  console.log('\nBy season:');
  for (const [year, count] of [...bySeason.entries()].sort()) {
    console.log(`  ${year}-${String(year + 1).slice(2)}: ${count}`);
  }

  // Temporal holdout: pre-2024 train, 2024+ test
  // Our data is 2023-2025 seasons, so train = 2023 season (Oct 2023-Jun 2024)
  // test = 2024 season (Oct 2024-Jun 2025) + 2025 season
  const train = games.filter(g => nbaSeasonYear(g.date) <= 2023);
  const test = games.filter(g => nbaSeasonYear(g.date) >= 2024);
  console.log(`\nTrain: ${train.length} (seasons ≤ 2023)`);
  console.log(`Test:  ${test.length} (seasons ≥ 2024)`);

  // ========== v0 baseline: pick home every time ==========
  // probability home wins = 1.0
  const v0 = (_game: GameRow) => 1.0;

  // Brier score: mean squared error between predicted probability and outcome
  // lower = better. 0 = perfect, 0.25 = random, 1.0 = always wrong
  const brier = (prob: (g: GameRow) => number, sample: GameRow[]): number => {
    const sum = sample.reduce((acc, g) => {
      const p = prob(g);
      const outcome = g.home_win;
      return acc + (p - outcome) ** 2;
    }, 0);
    return sum / sample.length;
  };

  // Accuracy: simple hit rate
  const accuracy = (prob: (g: GameRow) => number, sample: GameRow[]): number => {
    const hits = sample.reduce((acc, g) => {
      const pred = prob(g) >= 0.5 ? 1 : 0;
      return acc + (pred === g.home_win ? 1 : 0);
    }, 0);
    return hits / sample.length;
  };

  const v0TrainBrier = brier(v0, train);
  const v0TestBrier = brier(v0, test);
  const v0TrainAcc = accuracy(v0, train);
  const v0TestAcc = accuracy(v0, test);

  console.log('\n═══ v0: Always pick home ═══');
  console.log(`  Train: Brier ${v0TrainBrier.toFixed(4)} | Accuracy ${(v0TrainAcc * 100).toFixed(1)}%`);
  console.log(`  Test:  Brier ${v0TestBrier.toFixed(4)} | Accuracy ${(v0TestAcc * 100).toFixed(1)}%`);

  // ========== v1: Home unless visitor has 10+ more wins ==========
  // Need point-in-time team state: compute each team's record BEFORE each game
  // Per game, look up both teams' record as of (date - 1 day)

  // Build cumulative win tracker
  const teamWinsBefore = new Map<string, number>();
  const teamGamesBefore = new Map<string, number>();
  const stateByGame = new Map<string, { homeWins: number; awayWins: number; homeGames: number; awayGames: number }>();

  for (const g of games) {
    // Record state BEFORE this game
    const homeW = teamWinsBefore.get(g.home_team_id) ?? 0;
    const awayW = teamWinsBefore.get(g.away_team_id) ?? 0;
    const homeG = teamGamesBefore.get(g.home_team_id) ?? 0;
    const awayG = teamGamesBefore.get(g.away_team_id) ?? 0;
    stateByGame.set(g.game_id, { homeWins: homeW, awayWins: awayW, homeGames: homeG, awayGames: awayG });

    // Update counters AFTER recording
    teamGamesBefore.set(g.home_team_id, homeG + 1);
    teamGamesBefore.set(g.away_team_id, awayG + 1);
    if (g.home_win) {
      teamWinsBefore.set(g.home_team_id, homeW + 1);
    } else {
      teamWinsBefore.set(g.away_team_id, awayW + 1);
    }
  }

  const v1 = (g: GameRow): number => {
    const s = stateByGame.get(g.game_id);
    if (!s) return 1.0;
    // Skip if either team has fewer than 5 games (no reliable record)
    if (s.homeGames < 5 || s.awayGames < 5) return 1.0;
    // Visitor has 10+ more wins? Flip to visitor
    const winGap = s.awayWins - s.homeWins;
    if (winGap >= 10) return 0.3; // visitor favored
    return 1.0; // home favored
  };

  const v1TrainBrier = brier(v1, train);
  const v1TestBrier = brier(v1, test);
  const v1TrainAcc = accuracy(v1, train);
  const v1TestAcc = accuracy(v1, test);

  console.log('\n═══ v1: Home unless visitor has 10+ more wins ═══');
  console.log(`  Train: Brier ${v1TrainBrier.toFixed(4)} | Accuracy ${(v1TrainAcc * 100).toFixed(1)}%`);
  console.log(`  Test:  Brier ${v1TestBrier.toFixed(4)} | Accuracy ${(v1TestAcc * 100).toFixed(1)}%`);

  // Delta
  console.log('\n═══ v1 vs v0 (TEST set — the honest comparison) ═══');
  console.log(`  Brier delta: ${(v1TestBrier - v0TestBrier).toFixed(4)} (lower = better)`);
  console.log(`  Accuracy delta: ${((v1TestAcc - v0TestAcc) * 100).toFixed(2)}%`);

  // Sample size sanity
  console.log(`\n═══ Sample diagnostics ═══`);
  console.log(`  Home win rate (all games): ${(games.reduce((a, g) => a + g.home_win, 0) / games.length * 100).toFixed(1)}%`);
  console.log(`  Home win rate (test only):  ${(test.reduce((a, g) => a + g.home_win, 0) / test.length * 100).toFixed(1)}%`);

  closeDb();
}

main();
