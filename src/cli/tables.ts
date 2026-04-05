import type { Team, Game } from '../schema/index.js';
import type { Sport } from '../schema/provenance.js';
import { readLog } from '../storage/json-log.js';
import type { ScrapeLogEntry } from '../storage/json-log.js';

export function pad(str: string, len: number): string {
  return str.slice(0, len).padEnd(len);
}

function timeSince(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function formatTeamsTable(sport: Sport, teams: Team[]): void {
  console.log(`\n┌─ ${sport.toUpperCase()} Teams (${teams.length}) ────────────────────────────────────┐`);
  console.log(`│ ${pad('ID', 10)} ${pad('Name', 28)} ${pad('City', 16)} │`);
  console.log(`├────────────────────────────────────────────────────────────┤`);
  for (const t of teams) {
    console.log(`│ ${pad(t.abbreviation, 10)} ${pad(t.name, 28)} ${pad(t.city, 16)} │`);
  }
  console.log(`└────────────────────────────────────────────────────────────┘`);
}

export function formatGamesTable(sport: Sport, games: Game[]): void {
  console.log(`\n┌─ ${sport.toUpperCase()} Games (${games.length}) ────────────────────────────────────────────┐`);
  console.log(`│ ${pad('Away', 10)} ${pad('Home', 10)} ${pad('Score', 10)} ${pad('Status', 12)} ${pad('Venue', 20)} │`);
  console.log(`├──────────────────────────────────────────────────────────────────────┤`);
  for (const g of games) {
    const awayAbbr = g.awayTeamId.split(':')[1] ?? g.awayTeamId;
    const homeAbbr = g.homeTeamId.split(':')[1] ?? g.homeTeamId;
    const score = g.score ? `${g.score.away}-${g.score.home}` : '---';
    console.log(`│ ${pad(awayAbbr, 10)} ${pad(homeAbbr, 10)} ${pad(score, 10)} ${pad(g.status, 12)} ${pad(g.venue ?? '', 20)} │`);
  }
  console.log(`└──────────────────────────────────────────────────────────────────────┘`);
}

export function formatScrapeSummary(results: { sport: Sport; teams: number; games: number }[]): void {
  const recentLogs = readLog<ScrapeLogEntry>('scrape', 20);

  console.log(`\n┌─ Scrape Summary ──────────────────────────────────────────┐`);
  console.log(`│ ${pad('Sport', 8)} ${pad('Teams', 8)} ${pad('Games', 8)} ${pad('Status', 10)} ${pad('Freshness', 14)} │`);
  console.log(`├────────────────────────────────────────────────────────────┤`);
  for (const r of results) {
    const lastLog = recentLogs.filter(l => l.sport === r.sport).pop();
    const gate = lastLog?.gate ?? '?';
    const freshness = lastLog ? timeSince(lastLog.timestamp) : 'unknown';
    console.log(`│ ${pad(r.sport.toUpperCase(), 8)} ${pad(String(r.teams), 8)} ${pad(String(r.games), 8)} ${pad(gate, 10)} ${pad(freshness, 14)} │`);
  }
  console.log(`└────────────────────────────────────────────────────────────┘`);

  // Gate result summary
  const fails = recentLogs.filter(l => l.gate === 'FAIL');
  if (fails.length > 0) {
    console.log(`\n⚠ ${fails.length} failed scrape(s):`);
    for (const f of fails) {
      console.log(`  ${f.sport}/${f.dataType}: ${f.error ?? 'unknown error'}`);
    }
  }
}

export function formatDbStatus(stats: { sport: string; teams: number; games: number }[], lastScrape: string | null): void {
  console.log(`\n┌─ Database Status ─────────────────────────────────────────┐`);
  console.log(`│ ${pad('Sport', 8)} ${pad('Teams', 8)} ${pad('Games', 8)}                              │`);
  console.log(`├────────────────────────────────────────────────────────────┤`);
  for (const s of stats) {
    console.log(`│ ${pad(s.sport.toUpperCase(), 8)} ${pad(String(s.teams), 8)} ${pad(String(s.games), 8)}                              │`);
  }
  console.log(`├────────────────────────────────────────────────────────────┤`);
  const freshness = lastScrape ? timeSince(lastScrape) : 'never';
  console.log(`│ Last scrape: ${pad(freshness, 45)}│`);
  console.log(`└────────────────────────────────────────────────────────────┘`);
}
