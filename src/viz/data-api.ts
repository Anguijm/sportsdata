/**
 * Data API — HTTP JSON endpoints wrapping SQLite queries.
 * Used by the web frontend to fetch chart data.
 */

import { createServer } from 'node:http';
import { getDb, closeDb } from '../storage/sqlite.js';
import { scanForFindings, getMarginDistribution, getHomeWinTimeline } from '../analysis/interesting.js';
import { findPlayerFindings, getSportPlayerData } from '../analysis/player-findings.js';
import { getPlayerCount } from '../storage/sqlite.js';
import { getTrackRecord, getUpcomingPredictions, getRecentResolvedPredictions, resolvePredictions, getCalibration, getUpcomingSpreadPicks, getSpreadTrackRecord } from '../analysis/resolve-predictions.js';
import { predictUpcoming } from '../analysis/predict-runner.js';
import { predictUpcomingSpreads } from '../analysis/spread-runner.js';
import { getLastScrapeTime } from '../storage/sqlite.js';
import { runCycle } from '../orchestration/scheduler.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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
  const server = createServer(async (req, res) => {
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

    // P1-4: Validate sport param instead of blindly casting
    const VALID_SPORTS = new Set(['nba', 'nfl', 'mlb', 'nhl', 'mls', 'epl']);
    const rawSportParam = url.searchParams.get('sport');
    if (rawSportParam && rawSportParam !== 'all' && !VALID_SPORTS.has(rawSportParam)) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: `Invalid sport: ${rawSportParam}. Valid: nba, nfl, mlb, nhl, mls, epl` }));
      return;
    }
    const sport = (rawSportParam ?? 'nba') as Sport;

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
          const gamesLimit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 1000);
          const gamesOffset = parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;
          const games = db.prepare(`
            SELECT gr.*, g.home_team_id, g.away_team_id, g.odds_json
            FROM game_results gr
            JOIN games g ON gr.game_id = g.id
            WHERE gr.sport = ?
            ORDER BY gr.date, gr.game_id
            LIMIT ? OFFSET ?
          `).all(sport, gamesLimit, gamesOffset);
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

        case '/api/trigger/predict': {
          // Council mandate: idempotent, twice-daily
          // Auth check: simple bearer token, fail-closed
          const auth = req.headers['authorization'];
          const expected = process.env.PREDICT_TRIGGER_TOKEN;
          if (!expected || auth !== `Bearer ${expected}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }
          // Support sport=all to generate predictions for every league,
          // matching how /api/trigger/scrape works. The cron should call
          // with sport=all so all sports get predictions, not just NBA.
          const rawPredictSport = url.searchParams.get('sport');
          const allSports: Sport[] = ['nfl', 'nba', 'mlb', 'nhl', 'mls', 'epl'];
          const predictSports: Sport[] = (!rawPredictSport || rawPredictSport === 'all')
            ? allSports
            : [rawPredictSport as Sport];

          const perSport: Array<{
            sport: Sport;
            resolved: number;
            correct: number;
            generated: number;
            skipped: number;
            spreadGenerated: number;
            spreadSkipped: number;
          }> = [];

          // P1-12: Track completed sports individually. If one sport throws,
          // the others still have their results recorded. Prevents partial
          // computation from corrupting downstream state.
          const errors: Array<{ sport: Sport; error: string }> = [];
          for (const s of predictSports) {
            try {
              const resolved = resolvePredictions(s);
              const generated = predictUpcoming(s);
              const spreadGenerated = predictUpcomingSpreads(s);
              perSport.push({
                sport: s,
                resolved: resolved.resolved,
                correct: resolved.correct,
                generated: generated.predictions.length,
                skipped: generated.skipped,
                spreadGenerated: spreadGenerated.predictions.length,
                spreadSkipped: spreadGenerated.skipped,
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`Predict failed for ${s}:`, msg);
              errors.push({ sport: s, error: msg });
            }
          }

          const predictBody = {
            sports: predictSports,
            results: perSport,
            errors: errors.length > 0 ? errors : undefined,
            triggeredAt: new Date().toISOString(),
          };
          // Return 502 when any sport failed so cron's curl -f catches it
          if (errors.length > 0) {
            res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(predictBody));
            return;
          }
          response = jsonResponse(predictBody);
          break;
        }

        case '/api/trigger/scrape': {
          // Sprint 10.6: unblock stale NBA predictions.
          // Runs an ESPN scrape + resolver sweep over a rolling window so the
          // system self-heals after a missed cron. Same bearer-token auth as
          // /api/trigger/predict.
          const auth = req.headers['authorization'];
          const expected = process.env.PREDICT_TRIGGER_TOKEN;
          if (!expected || auth !== `Bearer ${expected}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }
          // Sport selection: explicit `?sport=<code>` scrapes just that
          // league; missing or `?sport=all` scrapes every league in
          // DEFAULT_CONFIG.sports. All-sports is the intended cron mode
          // (replaces the deleted scrape-cron.yml which was supposed to
          // cover every league but had been hitting a dead route).
          // NOTE: this endpoint deliberately does NOT use the handler-level
          // `sport` default (which coerces missing → nba) because that
          // default is wrong for a multi-league scrape trigger.
          const rawSport = url.searchParams.get('sport');
          const allSports: Sport[] = ['nfl', 'nba', 'mlb', 'nhl', 'mls', 'epl'];
          const targetSports: Sport[] = (!rawSport || rawSport === 'all')
            ? allSports
            : [rawSport as Sport];

          // backfillDays default = 3: today + 3 prior days. Covers a missed
          // cron run without hammering ESPN. Callers may override via
          // `?backfillDays=N`.
          const backfillParam = url.searchParams.get('backfillDays');
          const backfillDays = backfillParam !== null
            ? Math.max(0, Math.min(14, parseInt(backfillParam, 10) || 0))
            : 3;
          const { results, failures } = await runCycle({ sports: targetSports, backfillDays });
          const body = {
            sports: targetSports,
            backfillDays,
            results,
            failures,
            triggeredAt: new Date().toISOString(),
          };
          // Fail-closed surfacing: scrapedFetch returns [] on ESPN schema
          // drift / outage rather than throwing (council mandate), so the
          // only signal that upstream broke is in `failures`. Return 502
          // when any failures are present so predict-cron fails loudly
          // instead of masking stale data.
          if (failures.length > 0) {
            res.writeHead(502, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(JSON.stringify(body));
            return;
          }
          response = jsonResponse(body);
          break;
        }

        case '/api/predictions/upcoming': {
          const preds = getUpcomingPredictions(sport);
          response = jsonResponse(preds);
          break;
        }

        case '/api/predictions/recent': {
          const preds = getRecentResolvedPredictions(sport);
          response = jsonResponse(preds);
          break;
        }

        case '/api/predictions/track-record': {
          const record = getTrackRecord(sport);
          response = jsonResponse(record);
          break;
        }

        case '/api/predictions/calibration': {
          const calibration = getCalibration(sport);
          response = jsonResponse(calibration);
          break;
        }

        case '/api/spread-picks/upcoming': {
          const picks = getUpcomingSpreadPicks(sport);
          response = jsonResponse(picks);
          break;
        }

        case '/api/spread-picks/track-record': {
          const record = getSpreadTrackRecord(sport);
          response = jsonResponse(record);
          break;
        }

        case '/api/ratchet': {
          const ratchetDir = process.env.SQLITE_PATH ? '/app/data/ratchet' : 'data/ratchet';
          const artifactPath = join(ratchetDir, `${sport}-ratchet.json`);
          if (!existsSync(artifactPath)) {
            response = jsonResponse({ error: 'No ratchet artifact for this sport' });
          } else {
            const data = JSON.parse(readFileSync(artifactPath, 'utf-8')) as unknown;
            response = jsonResponse(data);
          }
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
          // last_scrape_at: MAX(games.updated_at). If this stops advancing for
          // >24h while crons are green, the scrape→resolve pipeline is broken
          // (see Sprint 10.6 / DEPLOY.md staleness check).
          const lastScrapeAt = getLastScrapeTime();
          response = jsonResponse({
            status: 'ok',
            timestamp: new Date().toISOString(),
            games: gameCount,
            results: resultCount,
            last_scrape_at: lastScrapeAt,
          });
          break;
        }

        default:
          response = jsonResponse({ error: 'Not found', endpoints: [
            '/api/health', '/api/stats', '/api/games', '/api/margins', '/api/home-timeline',
            '/api/extreme-games', '/api/team-sequences', '/api/findings', '/api/players',
            '/api/player-counts', '/api/sport-data', '/api/ratchet',
            '/api/predictions/upcoming', '/api/predictions/recent',
            '/api/predictions/track-record', '/api/predictions/calibration',
            '/api/spread-picks/upcoming', '/api/spread-picks/track-record',
            '/api/trigger/scrape', '/api/trigger/predict',
          ] });
          res.writeHead(404, response.headers);
          res.end(response.body);
          return;
      }

      res.writeHead(200, response.headers);
      res.end(response.body);
    } catch (err) {
      // P1-10: Don't expose internal error details to clients
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`API error on ${path}:`, msg);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
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
