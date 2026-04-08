# sportsdata

US sports data analytics platform with automated scraping, council-governed analysis, and Jon Bois-inspired visualization.

## 🌐 Live

- **Site:** https://sportsdata.pages.dev
- **API:** https://sportsdata-api.fly.dev
- **Health:** https://sportsdata-api.fly.dev/api/health
- **Deploy runbook:** [`DEPLOY.md`](./DEPLOY.md)

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

# Analysis & Visualization
npm run findings        # Scan for interesting patterns (streaks, outliers, mediocrity)
npm run findings nba    # Sport-specific findings
npm run api             # Start data API server (port 3001)
npm run dev             # Start Vite dev server (port 4000)
npm run viz             # Start both API + Vite together

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

  analysis/         "Interesting Things" detector
    interesting.ts  3 algorithms: streaks, margin outliers, mediocrity

  viz/              Visualization backend
    data-api.ts     HTTP JSON endpoints for chart data (port 3001)

  cli/              Terminal interface
    status.ts       Database overview and scrape health
    inspect.ts      Data inspection (mappings, results, home-rate)
    findings.ts     Ranked interesting findings output
    tables.ts       Formatted terminal table rendering

web/                Jon Bois-style scroll narrative (Vite, port 4000)
  index.html        Single scroll page
  main.ts           Observable Plot charts + scroll orchestration
  style.css         White/Roboto aesthetic (council-approved)

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

## Visualization (Jon Bois-Inspired)

Scroll-driven data storytelling inspired by Jon Bois (Chart Party, Dorktown, The History of the Seattle Mariners). White background, Roboto typography, Google Sheets energy. The "Interesting Things" detector scans data for:

- **Streaks**: Win/loss streaks of 7+ games (Detroit's 28-game losing streak)
- **Margin Outliers**: Games beyond 2.5σ (OKC's 62-point blowout over Portland)
- **Mediocrity**: Teams closest to .500 with high alternation rates
- **Nail-biters**: 1-point games that could have gone either way

```bash
npm run findings nba    # See what the detector found
npm run viz             # Launch the scroll narrative
```

## Deployment (Council-Approved Split Architecture)

```
Users → Cloudflare Pages (frontend, 300+ edges) + Fly.io (API + SQLite)
        GitHub Actions (backup cron, daily 6am UTC)
```

### Deploy Frontend
```bash
npx wrangler login                    # One-time auth
npx vite build                        # Build static site
npx wrangler pages deploy web/dist --project-name=sportsdata
```

### Deploy API
```bash
flyctl auth login                     # One-time auth
flyctl launch                         # Create app + volume
flyctl secrets set THE_ODDS_API_KEY=xxx BALLDONTLIE_API_KEY=xxx
flyctl deploy                         # Deploy
```

### GitHub Secrets (for CI/CD)
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID
- `FLY_API_TOKEN` — Fly.io deploy token
- `PREDICT_TRIGGER_TOKEN` — Bearer token for `/api/trigger/predict` cron

Auto-deploys: push to `main` triggers Cloudflare Pages build (web/ changes).
Daily crons: scrape backup (6am UTC), predictions (5am + 22:00 UTC).

## Current Stats (as of Sprint 8.5)

- **6 leagues**: NFL, NBA, MLB, NHL, MLS, EPL
- **174 teams** normalized across providers
- **3,946 games** in DB · **3,876 resolved** with outcomes
- **5,049 player stats** (all 6 sports via ESPN core API)
- **2,500 backfilled v2 predictions** · 61.4% accuracy · 0.249 Brier
- **50 live predictions** awaiting game resolution
- **90 NBA team mappings** (30 teams × 3 providers)
- ~4,500 lines of TypeScript across 40+ files

## Live URLs

- **Frontend**: https://sportsdata.pages.dev
- **API**: https://sportsdata-api.fly.dev
- **Health**: https://sportsdata-api.fly.dev/api/health

## Model: v2 Ratchet (NBA)

The predictive model was built via a Karpathy-style ratchet loop:

| Version | Description | Test Brier | Δ |
|---------|-------------|------------|---|
| v0 | Always pick home team | 0.4529 | — |
| v1 | + Flip if visitor has 10+ more wins | 0.3233 | −0.1296 |
| **v2** | **+ Flip on 3+ point differential** | **0.2486** | **−0.0745** |
| v3 | + Cold streak penalty | 0.2510 | +0.0022 (rejected) |

**45% Brier improvement over baseline**, bootstrap 95% CIs non-overlapping (statistically significant). Validated on 2,500 held-out games (2024-25 + 2025-26 seasons) with point-in-time team state (no future leakage).
