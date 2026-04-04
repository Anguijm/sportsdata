import Database from 'better-sqlite3';
import { join } from 'node:path';
import type { Repository } from './repository.js';
import type { Game, Team, Prediction, Hypothesis, Player } from '../schema/index.js';

const DB_PATH = join(import.meta.dirname, '../../data/sqlite/sportsdata.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initTables(_db);
  }
  return _db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}

function initTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      sport TEXT NOT NULL,
      name TEXT NOT NULL,
      abbreviation TEXT NOT NULL,
      city TEXT NOT NULL,
      conference TEXT,
      division TEXT,
      provenance_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      sport TEXT NOT NULL,
      season TEXT NOT NULL,
      date TEXT NOT NULL,
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      venue TEXT,
      status TEXT NOT NULL,
      score_json TEXT,
      odds_json TEXT,
      weather_json TEXT,
      provenance_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS odds_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sport TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      api_response TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_games_sport ON games(sport);
    CREATE INDEX IF NOT EXISTS idx_games_date ON games(date);
    CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
    CREATE INDEX IF NOT EXISTS idx_teams_sport ON teams(sport);
  `);
}

// --- Team serialization helpers ---

function teamToRow(team: Team) {
  return {
    id: team.id,
    sport: team.sport,
    name: team.name,
    abbreviation: team.abbreviation,
    city: team.city,
    conference: team.conference ?? null,
    division: team.division ?? null,
    provenance_json: JSON.stringify(team.provenance),
    updated_at: new Date().toISOString(),
  };
}

function rowToTeam(row: Record<string, unknown>): Team {
  return {
    id: row.id as string,
    sport: row.sport as Team['sport'],
    name: row.name as string,
    abbreviation: row.abbreviation as string,
    city: row.city as string,
    conference: (row.conference as string) || undefined,
    division: (row.division as string) || undefined,
    provenance: JSON.parse(row.provenance_json as string),
  };
}

// --- Game serialization helpers ---

function gameToRow(game: Game) {
  return {
    id: game.id,
    sport: game.sport,
    season: game.season,
    date: game.date,
    home_team_id: game.homeTeamId,
    away_team_id: game.awayTeamId,
    venue: game.venue ?? null,
    status: game.status,
    score_json: game.score ? JSON.stringify(game.score) : null,
    odds_json: game.odds ? JSON.stringify(game.odds) : null,
    weather_json: game.weather ? JSON.stringify(game.weather) : null,
    provenance_json: JSON.stringify(game.provenance),
    updated_at: new Date().toISOString(),
  };
}

function rowToGame(row: Record<string, unknown>): Game {
  return {
    id: row.id as string,
    sport: row.sport as Game['sport'],
    season: row.season as string,
    date: row.date as string,
    homeTeamId: row.home_team_id as string,
    awayTeamId: row.away_team_id as string,
    venue: (row.venue as string) || undefined,
    status: row.status as Game['status'],
    score: row.score_json ? JSON.parse(row.score_json as string) : undefined,
    odds: row.odds_json ? JSON.parse(row.odds_json as string) : undefined,
    weather: row.weather_json ? JSON.parse(row.weather_json as string) : undefined,
    provenance: JSON.parse(row.provenance_json as string),
  };
}

// --- Repository implementation ---

export const sqliteRepository: Repository = {
  // Teams
  async upsertTeam(team: Team): Promise<void> {
    const row = teamToRow(team);
    getDb().prepare(`
      INSERT INTO teams (id, sport, name, abbreviation, city, conference, division, provenance_json, updated_at)
      VALUES (@id, @sport, @name, @abbreviation, @city, @conference, @division, @provenance_json, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name=@name, abbreviation=@abbreviation, city=@city, conference=@conference,
        division=@division, provenance_json=@provenance_json, updated_at=@updated_at
    `).run(row);
  },

  async getTeam(id: string): Promise<Team | null> {
    const row = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToTeam(row) : null;
  },

  async getTeamsBySport(sport: string): Promise<Team[]> {
    const rows = getDb().prepare('SELECT * FROM teams WHERE sport = ? ORDER BY name').all(sport) as Record<string, unknown>[];
    return rows.map(rowToTeam);
  },

  // Games
  async upsertGame(game: Game): Promise<void> {
    const row = gameToRow(game);
    getDb().prepare(`
      INSERT INTO games (id, sport, season, date, home_team_id, away_team_id, venue, status, score_json, odds_json, weather_json, provenance_json, updated_at)
      VALUES (@id, @sport, @season, @date, @home_team_id, @away_team_id, @venue, @status, @score_json, @odds_json, @weather_json, @provenance_json, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        status=@status, score_json=@score_json, odds_json=@odds_json, weather_json=@weather_json,
        provenance_json=@provenance_json, updated_at=@updated_at
    `).run(row);
  },

  async getGame(id: string): Promise<Game | null> {
    const row = getDb().prepare('SELECT * FROM games WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToGame(row) : null;
  },

  async getGamesByDate(date: string): Promise<Game[]> {
    const rows = getDb().prepare('SELECT * FROM games WHERE date LIKE ? ORDER BY date').all(`${date}%`) as Record<string, unknown>[];
    return rows.map(rowToGame);
  },

  async getGamesBySport(sport: string, season: string): Promise<Game[]> {
    const rows = getDb().prepare('SELECT * FROM games WHERE sport = ? AND season = ? ORDER BY date').all(sport, season) as Record<string, unknown>[];
    return rows.map(rowToGame);
  },

  // Predictions (stub — Sprint 3)
  async upsertPrediction(_prediction: Prediction): Promise<void> { /* Sprint 3 */ },
  async getPrediction(_id: string): Promise<Prediction | null> { return null; },
  async getPendingPredictions(): Promise<Prediction[]> { return []; },
  async resolvePrediction(_id: string, _outcome: Prediction['outcome']): Promise<void> { /* Sprint 3 */ },

  // Hypotheses (stub — Sprint 3)
  async upsertHypothesis(_hypothesis: Hypothesis): Promise<void> { /* Sprint 3 */ },
  async getHypothesis(_id: string): Promise<Hypothesis | null> { return null; },
  async getActiveHypotheses(): Promise<Hypothesis[]> { return []; },

  // Players (stub — future)
  async upsertPlayer(_player: Player): Promise<void> { /* future */ },
  async getPlayer(_id: string): Promise<Player | null> { return null; },
  async getPlayersByTeam(_teamId: string): Promise<Player[]> { return []; },
};

// --- Raw odds storage ---

export function storeRawOdds(sport: string, response: string): void {
  getDb().prepare(`
    INSERT INTO odds_raw (sport, fetched_at, api_response) VALUES (?, ?, ?)
  `).run(sport, new Date().toISOString(), response);
}

// --- Query helpers ---

export function getTeamCount(sport?: string): number {
  if (sport) {
    return (getDb().prepare('SELECT COUNT(*) as count FROM teams WHERE sport = ?').get(sport) as { count: number }).count;
  }
  return (getDb().prepare('SELECT COUNT(*) as count FROM teams').get() as { count: number }).count;
}

export function getGameCount(sport?: string): number {
  if (sport) {
    return (getDb().prepare('SELECT COUNT(*) as count FROM games WHERE sport = ?').get(sport) as { count: number }).count;
  }
  return (getDb().prepare('SELECT COUNT(*) as count FROM games').get() as { count: number }).count;
}

export function getLastScrapeTime(): string | null {
  const row = getDb().prepare('SELECT MAX(updated_at) as last FROM games').get() as { last: string | null };
  return row.last;
}
