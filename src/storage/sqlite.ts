import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Repository } from './repository.js';
import type { Game, Team, Prediction, Hypothesis, Player } from '../schema/index.js';

const DB_PATH = process.env.SQLITE_PATH
  ?? join(import.meta.dirname, '../../data/sqlite/sportsdata.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    mkdirSync(dirname(DB_PATH), { recursive: true });
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

    CREATE TABLE IF NOT EXISTS game_results (
      game_id TEXT PRIMARY KEY,
      sport TEXT NOT NULL,
      date TEXT NOT NULL,
      winner TEXT NOT NULL,
      loser TEXT NOT NULL,
      home_score INTEGER NOT NULL,
      away_score INTEGER NOT NULL,
      margin INTEGER NOT NULL,
      home_win INTEGER NOT NULL,
      spread_result TEXT,
      over_under_result TEXT,
      resolved_at TEXT NOT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id)
    );

    CREATE TABLE IF NOT EXISTS team_mappings (
      canonical_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      sport TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (canonical_id, provider)
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      sport TEXT NOT NULL,
      model_version TEXT NOT NULL,
      prediction_source TEXT NOT NULL DEFAULT 'live',
      predicted_winner TEXT NOT NULL,
      predicted_prob REAL NOT NULL,
      reasoning_json TEXT NOT NULL,
      reasoning_text TEXT NOT NULL,
      made_at TEXT NOT NULL,
      team_state_as_of TEXT NOT NULL,
      low_confidence INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT,
      actual_winner TEXT,
      was_correct INTEGER,
      brier_score REAL,
      -- Sprint 8.5 council mandate (Architect): composite key separates live from backfill
      UNIQUE (game_id, model_version, prediction_source)
    );

    CREATE INDEX IF NOT EXISTS idx_predictions_sport_resolved ON predictions(sport, resolved_at);
    CREATE INDEX IF NOT EXISTS idx_predictions_game ON predictions(game_id);
    CREATE INDEX IF NOT EXISTS idx_predictions_state_time ON predictions(team_state_as_of);
  `);

  // Sprint 8.5 migration: add prediction_source column to existing predictions table.
  // Must run BEFORE the source-aware index can be created.
  // Idempotent — fresh DBs already have the column from CREATE TABLE; this no-ops.
  try {
    db.exec("ALTER TABLE predictions ADD COLUMN prediction_source TEXT NOT NULL DEFAULT 'live'");
  } catch {
    // Column already exists, ignore
  }

  // Sprint 10.6 migration: add pitchers_json column for MLB probable starters.
  try {
    db.exec('ALTER TABLE games ADD COLUMN pitchers_json TEXT');
  } catch {
    // Column already exists, ignore
  }

  // P0-2 migration: add is_draw column for MLS/EPL draw handling.
  try {
    db.exec('ALTER TABLE game_results ADD COLUMN is_draw INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists, ignore
  }

  // P1-3 migration: migrate predictions UNIQUE constraint from 2-column
  // (game_id, model_version) to 3-column (game_id, model_version, prediction_source).
  // Fresh DBs already have the 3-column constraint from CREATE TABLE, but
  // the Fly production DB was created with the old 2-column constraint.
  // SQLite doesn't support ALTER TABLE ... DROP CONSTRAINT, so we need to
  // recreate the table. This is idempotent — checks if migration is needed first.
  try {
    // Test if the 3-column conflict works. If it throws, we need to migrate.
    db.exec(`
      INSERT INTO predictions (id, game_id, sport, model_version, prediction_source,
        predicted_winner, predicted_prob, reasoning_json, reasoning_text,
        made_at, team_state_as_of, low_confidence)
      VALUES ('__constraint_test__', '__test__', 'nba', '__test__', 'live',
        '', 0, '{}', '', '', '', 0)
      ON CONFLICT (game_id, model_version, prediction_source) DO NOTHING
    `);
    // Clean up test row
    db.exec("DELETE FROM predictions WHERE id = '__constraint_test__'");
  } catch {
    // Migration needed: recreate table with 3-column UNIQUE constraint
    console.log('Migrating predictions table: 2-column → 3-column UNIQUE constraint...');
    db.exec(`
      CREATE TABLE predictions_new (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        sport TEXT NOT NULL,
        model_version TEXT NOT NULL,
        prediction_source TEXT NOT NULL DEFAULT 'live',
        predicted_winner TEXT NOT NULL,
        predicted_prob REAL NOT NULL,
        reasoning_json TEXT NOT NULL,
        reasoning_text TEXT NOT NULL,
        made_at TEXT NOT NULL,
        team_state_as_of TEXT NOT NULL,
        low_confidence INTEGER NOT NULL DEFAULT 0,
        resolved_at TEXT,
        actual_winner TEXT,
        was_correct INTEGER,
        brier_score REAL,
        UNIQUE (game_id, model_version, prediction_source)
      );
      INSERT INTO predictions_new (
        id, game_id, sport, model_version, prediction_source,
        predicted_winner, predicted_prob, reasoning_json, reasoning_text,
        made_at, team_state_as_of, low_confidence,
        resolved_at, actual_winner, was_correct, brier_score
      ) SELECT
        id, game_id, sport, model_version, prediction_source,
        predicted_winner, predicted_prob, reasoning_json, reasoning_text,
        made_at, team_state_as_of, low_confidence,
        resolved_at, actual_winner, was_correct, brier_score
      FROM predictions;
      DROP TABLE predictions;
      ALTER TABLE predictions_new RENAME TO predictions;
      CREATE INDEX IF NOT EXISTS idx_predictions_sport_resolved ON predictions(sport, resolved_at);
      CREATE INDEX IF NOT EXISTS idx_predictions_game ON predictions(game_id);
      CREATE INDEX IF NOT EXISTS idx_predictions_state_time ON predictions(team_state_as_of);
      CREATE INDEX IF NOT EXISTS idx_predictions_source_model ON predictions(prediction_source, model_version);
    `);
    console.log('Migration complete.');
  }

  db.exec(`
    -- Sprint 8.5 council mandate (Architect): filtered queries by source
    CREATE INDEX IF NOT EXISTS idx_predictions_source_model ON predictions(prediction_source, model_version);


    CREATE TABLE IF NOT EXISTS player_stats (
      player_id TEXT NOT NULL,
      sport TEXT NOT NULL,
      season TEXT NOT NULL,
      full_name TEXT NOT NULL,
      position TEXT,
      jersey TEXT,
      age INTEGER,
      team_id TEXT,
      team_abbr TEXT,
      games_played INTEGER NOT NULL DEFAULT 0,
      stats_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (player_id, sport, season)
    );

    CREATE INDEX IF NOT EXISTS idx_games_sport ON games(sport);
    CREATE INDEX IF NOT EXISTS idx_games_date ON games(date);
    CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
    -- Sprint 8.5: composite index for cross-namespace prediction resolver match
    CREATE INDEX IF NOT EXISTS idx_games_natural_key ON games(sport, date, home_team_id, away_team_id);
    CREATE INDEX IF NOT EXISTS idx_teams_sport ON teams(sport);
    CREATE INDEX IF NOT EXISTS idx_results_sport ON game_results(sport);
    CREATE INDEX IF NOT EXISTS idx_results_date ON game_results(date);
    CREATE INDEX IF NOT EXISTS idx_mappings_provider ON team_mappings(provider, provider_id);
    CREATE INDEX IF NOT EXISTS idx_player_stats_sport ON player_stats(sport, season);
    CREATE INDEX IF NOT EXISTS idx_player_stats_team ON player_stats(team_abbr, sport);
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
    pitchers_json: game.probablePitchers ? JSON.stringify(game.probablePitchers) : null,
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
    probablePitchers: row.pitchers_json ? JSON.parse(row.pitchers_json as string) : undefined,
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
      INSERT INTO games (id, sport, season, date, home_team_id, away_team_id, venue, status, score_json, odds_json, weather_json, pitchers_json, provenance_json, updated_at)
      VALUES (@id, @sport, @season, @date, @home_team_id, @away_team_id, @venue, @status, @score_json, @odds_json, @weather_json, @pitchers_json, @provenance_json, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        status=@status, score_json=@score_json, odds_json=@odds_json, weather_json=@weather_json,
        pitchers_json=COALESCE(@pitchers_json, pitchers_json),
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

/**
 * Sprint 10.6: Write odds data back to games.odds_json by matching team names.
 *
 * The odds API returns full team names ("Boston Celtics") while games use
 * canonical IDs ("nba:BOS"). This function builds a name→id lookup from the
 * teams table and matches odds events to scheduled games by team names + date.
 * Called by the scheduler after odds are scraped.
 */
export function writeOddsToGames(sport: string, oddsEvents: Array<{
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  odds: unknown | null;
}>): number {
  const db = getDb();

  // Build name → id lookup. Match on full name, city+name variants, and abbreviation.
  const teams = db.prepare(
    'SELECT id, name, abbreviation, city FROM teams WHERE sport = ?'
  ).all(sport) as { id: string; name: string; abbreviation: string; city: string }[];

  // P2-4: Removed city-only mapping (caused false matches: "Los Angeles" → random LA team).
  // Only map by full name, abbreviation, and city+name composite.
  const nameToId = new Map<string, string>();
  for (const t of teams) {
    nameToId.set(t.name.toLowerCase(), t.id);
    nameToId.set(t.abbreviation.toLowerCase(), t.id);
    if (t.city) {
      nameToId.set(`${t.city} ${t.name}`.toLowerCase(), t.id);
    }
  }

  function resolveTeamId(name: string): string | null {
    const lower = name.toLowerCase();
    if (nameToId.has(lower)) return nameToId.get(lower)!;
    // Fuzzy: substring match with min-length 4 guard to avoid short-string collisions
    for (const [key, id] of nameToId) {
      if (key.length >= 4 && lower.length >= 4 && (lower.includes(key) || key.includes(lower))) return id;
    }
    return null;
  }

  // Use julianday for date comparison so full ISO timestamps (e.g.,
  // '2026-04-13T01:00:00Z') are correctly matched against the ±1 day
  // window. Plain string comparison fails because 'T' > end-of-string.
  const updateStmt = db.prepare(`
    UPDATE games SET odds_json = ?, updated_at = ?
    WHERE sport = ? AND home_team_id = ? AND away_team_id = ?
      AND julianday(date) >= julianday(?)
      AND julianday(date) <= julianday(?)
      AND odds_json IS NULL
  `);

  let matched = 0;
  const now = new Date().toISOString();

  for (const event of oddsEvents) {
    if (!event.odds) continue;
    const homeId = resolveTeamId(event.homeTeam);
    const awayId = resolveTeamId(event.awayTeam);
    if (!homeId || !awayId) continue;

    // Match within ±1 day of commence time — full ISO timestamps for julianday()
    const commence = new Date(event.commenceTime);
    const dayBefore = new Date(commence.getTime() - 86400000).toISOString();
    const dayAfter = new Date(commence.getTime() + 86400000).toISOString();

    // Also remap the favorite field from full name to canonical ID
    const oddsObj = event.odds as Record<string, unknown>;
    const spread = oddsObj.spread as { favorite: string; line: number } | undefined;
    if (spread?.favorite) {
      const favId = resolveTeamId(spread.favorite);
      if (favId) spread.favorite = favId;
    }

    const result = updateStmt.run(
      JSON.stringify(event.odds), now,
      sport, homeId, awayId,
      dayBefore, dayAfter,
    );
    if (result.changes > 0) matched++;
  }

  return matched;
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

// --- Game Results ---

export interface GameResultRow {
  game_id: string;
  sport: string;
  date: string;
  winner: string;
  loser: string;
  home_score: number;
  away_score: number;
  margin: number;
  home_win: number;
  spread_result: string | null;
  over_under_result: string | null;
  resolved_at: string;
}

/** Auto-resolve outcomes for all final games that don't have results yet */
export function resolveGameOutcomes(): number {
  const db = getDb();
  const unresolvedGames = db.prepare(`
    SELECT g.* FROM games g
    LEFT JOIN game_results gr ON g.id = gr.game_id
    WHERE g.status = 'final' AND g.score_json IS NOT NULL AND gr.game_id IS NULL
  `).all() as Record<string, unknown>[];

  if (unresolvedGames.length === 0) return 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO game_results (game_id, sport, date, winner, loser, home_score, away_score, margin, home_win, is_draw, spread_result, over_under_result, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const resolveAll = db.transaction(() => {
    let resolved = 0;
    const now = new Date().toISOString();

    for (const row of unresolvedGames) {
      const game = rowToGame(row);
      if (!game.score) continue;

      const homeScore = game.score.home;
      const awayScore = game.score.away;
      const isDraw = homeScore === awayScore;
      // For draws: home listed as "winner" by convention (column is NOT NULL).
      // Downstream code MUST check is_draw before using winner/loser fields.
      const homeWin = homeScore > awayScore;
      const winner = homeWin || isDraw ? game.homeTeamId : game.awayTeamId;
      const loser = homeWin || isDraw ? game.awayTeamId : game.homeTeamId;
      const margin = Math.abs(homeScore - awayScore);

      let spreadResult: string | null = null;
      let overUnderResult: string | null = null;

      if (game.odds) {
        const totalPoints = homeScore + awayScore;
        if (totalPoints > game.odds.overUnder) overUnderResult = 'over';
        else if (totalPoints < game.odds.overUnder) overUnderResult = 'under';
        else overUnderResult = 'push';

        const homeMargin = homeScore - awayScore;
        const spreadLine = game.odds.spread.favorite === game.homeTeamId
          ? -game.odds.spread.line
          : game.odds.spread.line;
        const adjustedMargin = homeMargin + spreadLine;
        if (adjustedMargin > 0) spreadResult = 'cover';
        else if (adjustedMargin < 0) spreadResult = 'miss';
        else spreadResult = 'push';
      }

      insertStmt.run(game.id, game.sport, game.date, winner, loser, homeScore, awayScore, margin, homeWin ? 1 : 0, isDraw ? 1 : 0, spreadResult, overUnderResult, now);
      resolved++;
    }
    return resolved;
  });

  const resolved = resolveAll();
  if (resolved > 0) {
    console.log(`  ✓ Resolved ${resolved} game outcomes`);
  }
  return resolved;
}

export function getResultCount(sport?: string): number {
  if (sport) {
    return (getDb().prepare('SELECT COUNT(*) as count FROM game_results WHERE sport = ?').get(sport) as { count: number }).count;
  }
  return (getDb().prepare('SELECT COUNT(*) as count FROM game_results').get() as { count: number }).count;
}

export function getResultsBySport(sport: string, limit = 20): GameResultRow[] {
  return getDb().prepare('SELECT * FROM game_results WHERE sport = ? ORDER BY date DESC LIMIT ?').all(sport, limit) as GameResultRow[];
}

export function getHomeWinRate(sport: string): { total: number; homeWins: number; rate: number } {
  const row = getDb().prepare(`
    SELECT COUNT(*) as total, SUM(home_win) as home_wins FROM game_results WHERE sport = ?
  `).get(sport) as { total: number; home_wins: number };
  return {
    total: row.total,
    homeWins: row.home_wins ?? 0,
    rate: row.total > 0 ? (row.home_wins ?? 0) / row.total : 0,
  };
}

// --- Team Mappings ---

export interface TeamMappingRow {
  canonical_id: string;
  provider: string;
  provider_id: string;
  provider_name: string;
  sport: string;
  confidence: number;
}

export function upsertTeamMapping(mapping: TeamMappingRow): void {
  getDb().prepare(`
    INSERT INTO team_mappings (canonical_id, provider, provider_id, provider_name, sport, confidence)
    VALUES (@canonical_id, @provider, @provider_id, @provider_name, @sport, @confidence)
    ON CONFLICT(canonical_id, provider) DO UPDATE SET
      provider_id=@provider_id, provider_name=@provider_name, confidence=@confidence
  `).run(mapping);
}

export function resolveCanonicalId(provider: string, providerId: string): string | null {
  const row = getDb().prepare(
    'SELECT canonical_id FROM team_mappings WHERE provider = ? AND provider_id = ?'
  ).get(provider, providerId) as { canonical_id: string } | undefined;
  return row?.canonical_id ?? null;
}

export function resolveByProviderName(provider: string, providerName: string): string | null {
  const row = getDb().prepare(
    'SELECT canonical_id FROM team_mappings WHERE provider = ? AND provider_name = ? COLLATE NOCASE'
  ).get(provider, providerName) as { canonical_id: string } | undefined;
  return row?.canonical_id ?? null;
}

export function getMappingsForSport(sport: string): TeamMappingRow[] {
  return getDb().prepare('SELECT * FROM team_mappings WHERE sport = ? ORDER BY canonical_id, provider').all(sport) as TeamMappingRow[];
}

export function getMappingGaps(sport: string): { canonical_id: string; missing_providers: string[] }[] {
  const allProviders = ['espn', 'odds-api', 'balldontlie'];
  const mappings = getMappingsForSport(sport);

  const byTeam = new Map<string, Set<string>>();
  for (const m of mappings) {
    if (!byTeam.has(m.canonical_id)) byTeam.set(m.canonical_id, new Set());
    byTeam.get(m.canonical_id)!.add(m.provider);
  }

  const gaps: { canonical_id: string; missing_providers: string[] }[] = [];
  for (const [id, providers] of byTeam) {
    const missing = allProviders.filter(p => !providers.has(p));
    if (missing.length > 0) gaps.push({ canonical_id: id, missing_providers: missing });
  }
  return gaps;
}

// --- Player Stats ---

export interface PlayerStatsRow {
  player_id: string;
  sport: string;
  season: string;
  full_name: string;
  position: string | null;
  jersey: string | null;
  age: number | null;
  team_id: string | null;
  team_abbr: string | null;
  games_played: number;
  stats_json: string;
  updated_at: string;
}

export interface PlayerStatsInput {
  playerId: string;
  sport: string;
  season: string;
  fullName: string;
  position?: string;
  jersey?: string;
  age?: number | null;
  teamId?: string;
  teamAbbr?: string;
  gamesPlayed: number;
  stats: Record<string, number>;
}

export function upsertPlayerStats(rows: PlayerStatsInput[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO player_stats (player_id, sport, season, full_name, position, jersey, age, team_id, team_abbr, games_played, stats_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id, sport, season) DO UPDATE SET
      full_name=excluded.full_name,
      position=excluded.position,
      jersey=excluded.jersey,
      age=excluded.age,
      team_id=excluded.team_id,
      team_abbr=excluded.team_abbr,
      games_played=excluded.games_played,
      stats_json=excluded.stats_json,
      updated_at=excluded.updated_at
  `);

  const insertAll = db.transaction((items: PlayerStatsInput[]) => {
    const now = new Date().toISOString();
    let count = 0;
    for (const r of items) {
      stmt.run(
        r.playerId,
        r.sport,
        r.season,
        r.fullName,
        r.position ?? null,
        r.jersey ?? null,
        r.age ?? null,
        r.teamId ?? null,
        r.teamAbbr ?? null,
        r.gamesPlayed,
        JSON.stringify(r.stats),
        now,
      );
      count++;
    }
    return count;
  });

  return insertAll(rows);
}

export function getPlayerStats(sport: string, season?: string): PlayerStatsRow[] {
  const db = getDb();
  if (season) {
    return db.prepare('SELECT * FROM player_stats WHERE sport = ? AND season = ?').all(sport, season) as PlayerStatsRow[];
  }
  return db.prepare('SELECT * FROM player_stats WHERE sport = ?').all(sport) as PlayerStatsRow[];
}

export function getPlayerCount(sport?: string): number {
  const db = getDb();
  if (sport) {
    return (db.prepare('SELECT COUNT(*) as c FROM player_stats WHERE sport = ?').get(sport) as { c: number }).c;
  }
  return (db.prepare('SELECT COUNT(*) as c FROM player_stats').get() as { c: number }).c;
}
