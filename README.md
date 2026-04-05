# sportsdata

US sports data analytics platform with automated scraping, council-governed analysis, and Jon Bois-inspired visualization.

## Architecture

```
GOVERNANCE    Council (role-tagged) | Evaluation Gates | Memory/Logs
ORCHESTRATION Thin State Machine | Ratchet Loop | Pipeline Control
ANALYSIS      Statistical Analysis | Predictions | Visualizations
DATA          Scrapers | Normalizers | SQLite (ops) | JSONL (audit)
```

Four-layer system combining Karpathy's auto-research ratchet loop, Yolo-projects evaluation gates, and Roadtripper council governance.

## Sports Covered

| League | Source | Teams | Games |
|--------|--------|-------|-------|
| NFL | ESPN | 32 | Live (offseason) |
| NBA | ESPN + BallDontLie | 30 | 3,883 (3 seasons historical) |
| MLB | ESPN | 30 | Live |
| NHL | ESPN | 32 | Live |
| MLS | ESPN | 30 | Live |
| EPL | ESPN | 20 | Live |

## Data Sources

| Source | Type | Status | Free Tier |
|--------|------|--------|-----------|
| ESPN undocumented API | Scores, teams, schedules | Active | Unlimited |
| The Odds API | Betting lines, spreads, O/U | Active | 500 req/month |
| BallDontLie | NBA historical games | Active | 5 req/min |
| SportsData.io | Comprehensive stats | Planned | Trial |
| API-Football | EPL depth | Planned | 100 req/day |

## Setup

```bash
# Install dependencies
npm install

# Set API keys (optional — ESPN works without keys)
cp .env.example .env
# Edit .env with your keys:
#   THE_ODDS_API_KEY=your_key
#   BALLDONTLIE_API_KEY=your_key
```

## CLI Commands

```bash
# Scrape current data
npm run scrape          # Single sport (default: NFL)
npm run scrape:all      # All 6 leagues
npm run cycle           # Full cycle: all leagues + odds + outcome resolution

# View data
npm run status          # Database overview + recent scrapes
npm run status nba      # Sport-specific with team/game tables
npm run inspect mappings nba    # Team name mappings across providers
npm run inspect results nba     # Recent game results with margins
npm run inspect home-rate nba   # Home win rate statistics

# Data collection
npm run odds            # Fetch current odds (needs THE_ODDS_API_KEY)
npm run historical      # Load historical NBA data (needs BALLDONTLIE_API_KEY)
npm run seed:nba        # Seed NBA team mappings across providers

# Development
npm run type-check      # TypeScript type checking
npm run build           # Compile TypeScript
```

## Project Structure

```
src/
  schema/           TypeScript interfaces (source of truth)
    game.ts         Game, GameScore, GameOdds, GameResult
    team.ts         Team, TeamStats, TeamStanding
    player.ts       Player, PlayerStats, PlayerGameLog
    prediction.ts   Prediction, Hypothesis, RatchetIteration
    provenance.ts   Provenance, DataSource, Sport

  scrapers/         Data collection
    espn.ts         ESPN undocumented API (6 leagues)
    odds-api.ts     The Odds API (betting lines)
    balldontlie.ts  BallDontLie (NBA historical)
    normalizer.ts   Raw data -> unified schema

  storage/          Persistence
    sqlite.ts       SQLite with teams, games, results, mappings tables
    json-log.ts     JSONL append-only audit logging
    repository.ts   Repository interface (backend-swappable)

  orchestration/    Pipeline control
    scheduler.ts    Cron-like scheduler with retry logic
    pipeline.ts     State machine for pipeline phases
    ratchet.ts      Karpathy ratchet loop (hypothesize/evaluate/keep/revert)
    gates.ts        Evaluation gates (idea, plan, build, prediction, data quality)

  cli/              Terminal interface
    status.ts       Database overview and scrape health
    inspect.ts      Data inspection (mappings, results, home-rate)
    tables.ts       Formatted terminal table rendering

.harness/           Governance
  council/          Expert review personas (data quality, stats, prediction, domain)
  memory/           Decision log and project context

skills/             Workflow definitions (bootstrap, scrape, analyze, review)
data/               Local storage (sqlite/, duckdb/, logs/)
```

## Council Governance

Every plan, implementation, and test is reviewed by a 4-expert council:

| Expert | Focus |
|--------|-------|
| Data Quality | Completeness, freshness, schema conformance |
| Statistical Validity | Methodology, sample sizes, confounders |
| Prediction Accuracy | Calibration, backtesting, base rate comparison |
| Domain Expert | Sport context, situational factors, schedule effects |

Verdicts: FAIL (blocks) / WARN (address concerns) / CLEAR (proceed).

## Ratchet Loop (Prediction Engine)

```
HYPOTHESIZE -> MODIFY -> EXECUTE -> EVALUATE -> KEEP or REVERT
```

Monotonic improvement: each iteration either improves the metric or reverts. Metrics: Brier score (game outcomes), MAE (spreads), RMSE (player stats), Pearson r (trends).

## Current Stats

- 174 teams across 6 leagues
- 3,946 games in database
- 3,814 game results resolved with outcomes
- 90 NBA team mappings (30 teams x 3 providers)
- ~2,300 lines of TypeScript
