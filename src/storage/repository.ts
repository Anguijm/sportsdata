import type { Game, Player, Team, Prediction, Hypothesis } from '../schema/index.js';

/** Repository interface — swap backends by implementing this */
export interface Repository {
  // Teams
  upsertTeam(team: Team): Promise<void>;
  getTeam(id: string): Promise<Team | null>;
  getTeamsBySport(sport: string): Promise<Team[]>;

  // Players
  upsertPlayer(player: Player): Promise<void>;
  getPlayer(id: string): Promise<Player | null>;
  getPlayersByTeam(teamId: string): Promise<Player[]>;

  // Games
  upsertGame(game: Game): Promise<void>;
  getGame(id: string): Promise<Game | null>;
  getGamesByDate(date: string): Promise<Game[]>;
  getGamesBySport(sport: string, season: string): Promise<Game[]>;

  // Predictions
  upsertPrediction(prediction: Prediction): Promise<void>;
  getPrediction(id: string): Promise<Prediction | null>;
  getPendingPredictions(): Promise<Prediction[]>;
  resolvePrediction(id: string, outcome: Prediction['outcome']): Promise<void>;

  // Hypotheses
  upsertHypothesis(hypothesis: Hypothesis): Promise<void>;
  getHypothesis(id: string): Promise<Hypothesis | null>;
  getActiveHypotheses(): Promise<Hypothesis[]>;
}
