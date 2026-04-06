/**
 * Data API — HTTP JSON endpoints wrapping SQLite queries.
 * Used by the web frontend to fetch chart data.
 */

import { createServer } from 'node:http';
import { getDb, closeDb } from '../storage/sqlite.js';
import { scanForFindings, getMarginDistribution, getHomeWinTimeline } from '../analysis/interesting.js';
import { findPlayerFindings, getSportPlayerData } from '../analysis/player-findings.js';
import { getPlayerCount } from '../storage/sqlite.js';
import type { Sport } from '../schema/provenance.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

function jsonResponse(data: unknown): { body: string; headers: Record<string, string> } {
  return {
    body: JSON.stringify(data),
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  };
}

export function startDataApi(): void {
  const server = createServer((req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const path = url.pathname;
    const sport = (url.searchParams.get('sport') ?? 'nba') as Sport;

    try {
      let response: { body: string; headers: Record<string, string> };

      switch (path) {
        case '/api/findings':
          response = jsonResponse(scanForFindings(sport));
          break;

        case '/api/margins':
          response = jsonResponse(getMarginDistribution(sport));
          break;

        case '/api/home-timeline':
          response = jsonResponse(getHomeWinTimeline(sport));
          break;

        case '/api/games': {
          const db = getDb();
          const games = db.prepare(`
            SELECT gr.*, g.home_team_id, g.away_team_id, g.odds_json
            FROM game_results gr
            JOIN games g ON gr.game_id = g.id
            WHERE gr.sport = ?
            ORDER BY gr.date
          `).all(sport);
          response = jsonResponse(games);
          break;
        }

        case '/api/stats': {
          const db = getDb();
          const stats = db.prepare(`
            SELECT sport,
              COUNT(*) as total_games,
              SUM(home_win) as home_wins,
              AVG(margin) as avg_margin,
              MIN(margin) as min_margin,
              MAX(margin) as max_margin
            FROM game_results
            WHERE sport = ?
          `).get(sport);
          response = jsonResponse(stats);
          break;
        }

        case '/api/team-sequences': {
          // Per team per season: sequence + record + point differential
          const db = getDb();
          const rows = db.prepare(`
            SELECT date, winner, loser, home_score, away_score, home_win FROM game_results
            WHERE sport = ? ORDER BY date
          `).all(sport) as {
            date: string; winner: string; loser: string;
            home_score: number; away_score: number; home_win: number;
          }[];

          // Map<teamId, Map<seasonYear, { sequence, pointsFor, pointsAgainst }>>
          const teamSeasonData = new Map<string, Map<number, {
            sequence: boolean[];
            pointsFor: number;
            pointsAgainst: number;
          }>>();

          for (const r of rows) {
            const d = new Date(r.date);
            const month = d.getUTCMonth();
            const year = d.getUTCFullYear();
            const seasonYear = month >= 9 ? year : year - 1;

            const homeIsWinner = r.home_win === 1;
            const homeTeam = homeIsWinner ? r.winner : r.loser;
            const awayTeam = homeIsWinner ? r.loser : r.winner;

            for (const [teamId, scoreFor, scoreAgainst, won] of [
              [homeTeam, r.home_score, r.away_score, homeIsWinner],
              [awayTeam, r.away_score, r.home_score, !homeIsWinner],
            ] as const) {
              if (!teamSeasonData.has(teamId as string)) {
                teamSeasonData.set(teamId as string, new Map());
              }
              const seasons = teamSeasonData.get(teamId as string)!;
              if (!seasons.has(seasonYear)) {
                seasons.set(seasonYear, { sequence: [], pointsFor: 0, pointsAgainst: 0 });
              }
              const s = seasons.get(seasonYear)!;
              s.sequence.push(won as boolean);
              s.pointsFor += scoreFor as number;
              s.pointsAgainst += scoreAgainst as number;
            }
          }

          const result: Array<{
            teamId: string;
            abbr: string;
            seasons: Array<{
              year: number;
              label: string;
              sequence: boolean[];
              wins: number;
              losses: number;
              winPct: number;
              ptsForPg: number;
              ptsAgainstPg: number;
              diffPg: number;
            }>;
          }> = [];

          for (const [teamId, seasons] of teamSeasonData) {
            const seasonList = Array.from(seasons.entries())
              .map(([year, s]) => {
                const games = s.sequence.length;
                const wins = s.sequence.filter(Boolean).length;
                return {
                  year,
                  label: `${year}-${String(year + 1).slice(2)}`,
                  sequence: s.sequence,
                  wins,
                  losses: games - wins,
                  winPct: wins / games,
                  ptsForPg: s.pointsFor / games,
                  ptsAgainstPg: s.pointsAgainst / games,
                  diffPg: (s.pointsFor - s.pointsAgainst) / games,
                };
              })
              .sort((a, b) => b.year - a.year);

            result.push({
              teamId,
              abbr: teamId.split(':')[1] ?? teamId,
              seasons: seasonList,
            });
          }

          // Sort by most recent season win pct
          result.sort((a, b) => (b.seasons[0]?.winPct ?? 0) - (a.seasons[0]?.winPct ?? 0));

          response = jsonResponse(result);
          break;
        }

        case '/api/extreme-games': {
          // Top 5 biggest blowouts and 5 closest games
          const db = getDb();
          const blowouts = db.prepare(`
            SELECT game_id, date, winner, loser, home_score, away_score, margin
            FROM game_results WHERE sport = ? ORDER BY margin DESC LIMIT 5
          `).all(sport);
          const nailBiters = db.prepare(`
            SELECT game_id, date, winner, loser, home_score, away_score, margin
            FROM game_results WHERE sport = ? AND margin > 0 ORDER BY margin ASC LIMIT 5
          `).all(sport);
          response = jsonResponse({ blowouts, nailBiters });
          break;
        }

        case '/api/players': {
          const findings = findPlayerFindings(sport);
          response = jsonResponse(findings);
          break;
        }

        case '/api/sport-data': {
          // Returns hero + findings for a single sport (council-mandated card structure)
          const data = getSportPlayerData(sport);
          response = jsonResponse(data);
          break;
        }

        case '/api/player-counts': {
          const counts: Record<string, number> = {};
          for (const s of ['nfl', 'nba', 'mlb', 'nhl', 'mls', 'epl']) {
            counts[s] = getPlayerCount(s);
          }
          response = jsonResponse(counts);
          break;
        }

        case '/api/health': {
          const db = getDb();
          const gameCount = (db.prepare('SELECT COUNT(*) as c FROM games').get() as { c: number }).c;
          const resultCount = (db.prepare('SELECT COUNT(*) as c FROM game_results').get() as { c: number }).c;
          response = jsonResponse({
            status: 'ok',
            timestamp: new Date().toISOString(),
            games: gameCount,
            results: resultCount,
          });
          break;
        }

        default:
          response = jsonResponse({ error: 'Not found', endpoints: ['/api/findings', '/api/margins', '/api/home-timeline', '/api/games', '/api/stats', '/api/health'] });
          res.writeHead(404, response.headers);
          res.end(response.body);
          return;
      }

      res.writeHead(200, response.headers);
      res.end(response.body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Data API running on http://${HOST}:${PORT}`);
  });

  process.on('SIGINT', () => { closeDb(); process.exit(0); });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startDataApi();
}
