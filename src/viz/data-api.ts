/**
 * Data API — HTTP JSON endpoints wrapping SQLite queries.
 * Used by the web frontend to fetch chart data.
 */

import { createServer } from 'node:http';
import { getDb, closeDb } from '../storage/sqlite.js';
import { scanForFindings, getMarginDistribution, getHomeWinTimeline } from '../analysis/interesting.js';
import type { Sport } from '../schema/provenance.js';

const PORT = 3001;

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

        default:
          response = jsonResponse({ error: 'Not found', endpoints: ['/api/findings', '/api/margins', '/api/home-timeline', '/api/games', '/api/stats'] });
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

  server.listen(PORT, () => {
    console.log(`Data API running on http://localhost:${PORT}`);
  });

  process.on('SIGINT', () => { closeDb(); process.exit(0); });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startDataApi();
}
