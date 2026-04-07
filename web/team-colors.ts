/**
 * Team accent colors lookup.
 *
 * Council mandate (Sprint 8):
 * - Structured Record<sport, Record<teamAbbr, {primary, secondary}>> from day one
 * - So MLB/NFL slot in without a refactor
 *
 * Currently populated for NBA only — other sports get sport-default fallback.
 */

interface TeamColor {
  primary: string;
  secondary: string;
}

const SPORT_DEFAULTS: Record<string, TeamColor> = {
  nba: { primary: '#1d428a', secondary: '#c8102e' },
  nfl: { primary: '#013369', secondary: '#d50a0a' },
  mlb: { primary: '#002d72', secondary: '#cd1141' },
  nhl: { primary: '#2a2a2a', secondary: '#a2aaad' },
  mls: { primary: '#80a83b', secondary: '#252f3e' },
  epl: { primary: '#3d195b', secondary: '#00a398' },
};

const TEAM_COLORS: Record<string, Record<string, TeamColor>> = {
  nba: {
    ATL: { primary: '#e03a3e', secondary: '#c1d32f' },
    BOS: { primary: '#007a33', secondary: '#ba9653' },
    BKN: { primary: '#000000', secondary: '#ffffff' },
    CHA: { primary: '#1d1160', secondary: '#00788c' },
    CHI: { primary: '#ce1141', secondary: '#000000' },
    CLE: { primary: '#860038', secondary: '#fdbb30' },
    DAL: { primary: '#00538c', secondary: '#002b5e' },
    DEN: { primary: '#0e2240', secondary: '#fec524' },
    DET: { primary: '#c8102e', secondary: '#1d42ba' },
    GS:  { primary: '#1d428a', secondary: '#ffc72c' },
    HOU: { primary: '#ce1141', secondary: '#000000' },
    IND: { primary: '#002d62', secondary: '#fdbb30' },
    LAC: { primary: '#c8102e', secondary: '#1d428a' },
    LAL: { primary: '#552583', secondary: '#fdb927' },
    MEM: { primary: '#5d76a9', secondary: '#12173f' },
    MIA: { primary: '#98002e', secondary: '#f9a01b' },
    MIL: { primary: '#00471b', secondary: '#eee1c6' },
    MIN: { primary: '#0c2340', secondary: '#236192' },
    NO:  { primary: '#0c2340', secondary: '#c8102e' },
    NY:  { primary: '#006bb6', secondary: '#f58426' },
    OKC: { primary: '#007ac1', secondary: '#ef3b24' },
    ORL: { primary: '#0077c0', secondary: '#c4ced4' },
    PHI: { primary: '#006bb6', secondary: '#ed174c' },
    PHX: { primary: '#1d1160', secondary: '#e56020' },
    POR: { primary: '#e03a3e', secondary: '#000000' },
    SAC: { primary: '#5a2d81', secondary: '#63727a' },
    SA:  { primary: '#c4ced4', secondary: '#000000' },
    TOR: { primary: '#ce1141', secondary: '#000000' },
    UTAH: { primary: '#002b5c', secondary: '#00471b' },
    WSH: { primary: '#002b5c', secondary: '#e31837' },
  },
  nfl: {},
  mlb: {},
  nhl: {},
  mls: {},
  epl: {},
};

export function getTeamColor(sport: string, teamAbbr: string): TeamColor {
  const sportTeams = TEAM_COLORS[sport];
  if (sportTeams && sportTeams[teamAbbr]) return sportTeams[teamAbbr];
  return SPORT_DEFAULTS[sport] ?? { primary: '#64d2ff', secondary: '#ff9f0a' };
}
