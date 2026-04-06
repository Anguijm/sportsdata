/**
 * Data API — HTTP JSON endpoints wrapping SQLite queries.
 * Used by the web frontend to fetch chart data.
 */

import { createServer } from 'node:http';
import { getDb, closeDb } from '../storage/sqlite.js';
import { scanForFindings, getMarginDistribution, getHomeWinTimeline } from '../analysis/interesting.js';
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
          // Returns each team's win/loss sequence ordered by date — for streak chart
          const db = getDb();
          const rows = db.prepare(`
            SELECT date, winner, loser FROM game_results
            WHERE sport = ? ORDER BY date
          `).all(sport) as { date: string; winner: string; loser: string }[];

          const teamSequences = new Map<string, boolean[]>();
          for (const r of rows) {
            for (const teamId of [r.winner, r.loser]) {
              if (!teamSequences.has(teamId)) teamSequences.set(teamId, []);
              teamSequences.get(teamId)!.push(teamId === r.winner);
            }
          }

          const result = Array.from(teamSequences.entries()).map(([teamId, seq]) => {
            const wins = seq.filter(Boolean).length;
            const losses = seq.length - wins;
            return {
              teamId,
              abbr: teamId.split(':')[1] ?? teamId,
              sequence: seq,
              wins,
              losses,
              winPct: wins / seq.length,
            };
          }).sort((a, b) => b.winPct - a.winPct);

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
