/**
 * Seed NBA team mappings across providers.
 * Maps ESPN IDs (our canonical) to Odds API names and BallDontLie names.
 */

import { upsertTeamMapping, closeDb, getDb } from './sqlite.js';

// NBA team mappings: canonical (ESPN format) → provider-specific identifiers
const NBA_MAPPINGS: Array<{
  canonical: string;
  abbr: string;
  espnName: string;
  oddsApiName: string;
  bdlName: string;
}> = [
  { canonical: 'nba:ATL', abbr: 'ATL', espnName: 'Atlanta Hawks', oddsApiName: 'Atlanta Hawks', bdlName: 'Atlanta Hawks' },
  { canonical: 'nba:BOS', abbr: 'BOS', espnName: 'Boston Celtics', oddsApiName: 'Boston Celtics', bdlName: 'Boston Celtics' },
  { canonical: 'nba:BKN', abbr: 'BKN', espnName: 'Brooklyn Nets', oddsApiName: 'Brooklyn Nets', bdlName: 'Brooklyn Nets' },
  { canonical: 'nba:CHA', abbr: 'CHA', espnName: 'Charlotte Hornets', oddsApiName: 'Charlotte Hornets', bdlName: 'Charlotte Hornets' },
  { canonical: 'nba:CHI', abbr: 'CHI', espnName: 'Chicago Bulls', oddsApiName: 'Chicago Bulls', bdlName: 'Chicago Bulls' },
  { canonical: 'nba:CLE', abbr: 'CLE', espnName: 'Cleveland Cavaliers', oddsApiName: 'Cleveland Cavaliers', bdlName: 'Cleveland Cavaliers' },
  { canonical: 'nba:DAL', abbr: 'DAL', espnName: 'Dallas Mavericks', oddsApiName: 'Dallas Mavericks', bdlName: 'Dallas Mavericks' },
  { canonical: 'nba:DEN', abbr: 'DEN', espnName: 'Denver Nuggets', oddsApiName: 'Denver Nuggets', bdlName: 'Denver Nuggets' },
  { canonical: 'nba:DET', abbr: 'DET', espnName: 'Detroit Pistons', oddsApiName: 'Detroit Pistons', bdlName: 'Detroit Pistons' },
  { canonical: 'nba:GS', abbr: 'GS', espnName: 'Golden State Warriors', oddsApiName: 'Golden State Warriors', bdlName: 'Golden State Warriors' },
  { canonical: 'nba:HOU', abbr: 'HOU', espnName: 'Houston Rockets', oddsApiName: 'Houston Rockets', bdlName: 'Houston Rockets' },
  { canonical: 'nba:IND', abbr: 'IND', espnName: 'Indiana Pacers', oddsApiName: 'Indiana Pacers', bdlName: 'Indiana Pacers' },
  { canonical: 'nba:LAC', abbr: 'LAC', espnName: 'LA Clippers', oddsApiName: 'Los Angeles Clippers', bdlName: 'LA Clippers' },
  { canonical: 'nba:LAL', abbr: 'LAL', espnName: 'Los Angeles Lakers', oddsApiName: 'Los Angeles Lakers', bdlName: 'Los Angeles Lakers' },
  { canonical: 'nba:MEM', abbr: 'MEM', espnName: 'Memphis Grizzlies', oddsApiName: 'Memphis Grizzlies', bdlName: 'Memphis Grizzlies' },
  { canonical: 'nba:MIA', abbr: 'MIA', espnName: 'Miami Heat', oddsApiName: 'Miami Heat', bdlName: 'Miami Heat' },
  { canonical: 'nba:MIL', abbr: 'MIL', espnName: 'Milwaukee Bucks', oddsApiName: 'Milwaukee Bucks', bdlName: 'Milwaukee Bucks' },
  { canonical: 'nba:MIN', abbr: 'MIN', espnName: 'Minnesota Timberwolves', oddsApiName: 'Minnesota Timberwolves', bdlName: 'Minnesota Timberwolves' },
  { canonical: 'nba:NO', abbr: 'NO', espnName: 'New Orleans Pelicans', oddsApiName: 'New Orleans Pelicans', bdlName: 'New Orleans Pelicans' },
  { canonical: 'nba:NY', abbr: 'NY', espnName: 'New York Knicks', oddsApiName: 'New York Knicks', bdlName: 'New York Knicks' },
  { canonical: 'nba:OKC', abbr: 'OKC', espnName: 'Oklahoma City Thunder', oddsApiName: 'Oklahoma City Thunder', bdlName: 'Oklahoma City Thunder' },
  { canonical: 'nba:ORL', abbr: 'ORL', espnName: 'Orlando Magic', oddsApiName: 'Orlando Magic', bdlName: 'Orlando Magic' },
  { canonical: 'nba:PHI', abbr: 'PHI', espnName: 'Philadelphia 76ers', oddsApiName: 'Philadelphia 76ers', bdlName: 'Philadelphia 76ers' },
  { canonical: 'nba:PHX', abbr: 'PHX', espnName: 'Phoenix Suns', oddsApiName: 'Phoenix Suns', bdlName: 'Phoenix Suns' },
  { canonical: 'nba:POR', abbr: 'POR', espnName: 'Portland Trail Blazers', oddsApiName: 'Portland Trail Blazers', bdlName: 'Portland Trail Blazers' },
  { canonical: 'nba:SAC', abbr: 'SAC', espnName: 'Sacramento Kings', oddsApiName: 'Sacramento Kings', bdlName: 'Sacramento Kings' },
  { canonical: 'nba:SA', abbr: 'SA', espnName: 'San Antonio Spurs', oddsApiName: 'San Antonio Spurs', bdlName: 'San Antonio Spurs' },
  { canonical: 'nba:TOR', abbr: 'TOR', espnName: 'Toronto Raptors', oddsApiName: 'Toronto Raptors', bdlName: 'Toronto Raptors' },
  { canonical: 'nba:UTAH', abbr: 'UTAH', espnName: 'Utah Jazz', oddsApiName: 'Utah Jazz', bdlName: 'Utah Jazz' },
  { canonical: 'nba:WSH', abbr: 'WSH', espnName: 'Washington Wizards', oddsApiName: 'Washington Wizards', bdlName: 'Washington Wizards' },
];

export function seedNbaMappings(): number {
  const seedAll = getDb().transaction(() => {
    let count = 0;
    for (const team of NBA_MAPPINGS) {
      upsertTeamMapping({
        canonical_id: team.canonical,
        provider: 'espn',
        provider_id: team.abbr,
        provider_name: team.espnName,
        sport: 'nba',
        confidence: 1.0,
      });
      upsertTeamMapping({
        canonical_id: team.canonical,
        provider: 'odds-api',
        provider_id: team.oddsApiName,
        provider_name: team.oddsApiName,
        sport: 'nba',
        confidence: 1.0,
      });
      upsertTeamMapping({
        canonical_id: team.canonical,
        provider: 'balldontlie',
        provider_id: team.bdlName,
        provider_name: team.bdlName,
        sport: 'nba',
        confidence: 1.0,
      });
      count++;
    }
    return count;
  });
  return seedAll();
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const count = seedNbaMappings();
  console.log(`Seeded ${count} NBA teams × 3 providers = ${count * 3} mappings`);
  closeDb();
}
