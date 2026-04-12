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

| League | Source | Teams | Games | Spread Model |
|--------|--------|-------|-------|-------------|
| NFL | ESPN | 32 | Live (offseason) | v4-spread (team diff) |
| NBA | ESPN + BallDontLie | 30 | 4,100+ (3 seasons) | v4-spread (team diff) |
| MLB | ESPN | 30 | Live | v4-spread (team diff + pitcher ERA) |
| NHL | ESPN | 32 | Live | v4-spread (team diff) |
| MLS | ESPN | 30 | Live | v4-spread (team diff) |
| EPL | ESPN | 20 | Live | v4-spread (team diff) |

All 6 leagues are selectable from the global sport selector on the frontend.

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

  analysis/         Analysis + prediction models
    interesting.ts  3 algorithms: streaks, margin outliers, mediocrity
    predict.ts      Prediction model ladder (v0-v3 winner, v4-spread margin)
    predict-runner.ts  v2 winner prediction runner
    spread-runner.ts   v4-spread margin prediction runner (ATS picks)
    resolve-predictions.ts  Resolver (winner + spread-aware) + track record queries
    vegas-baseline.ts  Vegas implied probability comparison

  viz/              Visualization backend
    data-api.ts     HTTP JSON endpoints for chart data (port 3001)

  cli/              Terminal interface
    status.ts       Database overview and scrape health
    inspect.ts      Data inspection (mappings, results, home-rate)
    findings.ts     Ranked interesting findings output
    tables.ts       Formatted terminal table rendering

web/                Jon Bois-style scroll narrative (Vite, port 4000)
  index.html        Single scroll page with global sport selector
  main.ts           Observable Plot charts + sport switching + spread picks
  style.css         White/Roboto aesthetic (council-approved)
  team-colors.ts    Per-sport team color lookup

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

Auto-deploys on push to `main`:
- `deploy-pages.yml` — frontend to Cloudflare Pages (web/ changes)
- `deploy-fly.yml` — API to Fly.io (src/, Dockerfile, fly.toml, package* changes)

Daily cron (`predict-cron.yml`, 05:00 + 22:00 UTC):
1. `POST /api/trigger/scrape?sport=all` — scrapes all 6 leagues + writes odds to games
2. `POST /api/trigger/predict` — generates v2 winner + v4-spread predictions, resolves outcomes

## Current Stats (as of Sprint 10.6)

- **6 leagues**: NFL, NBA, MLB, NHL, MLS, EPL — all selectable from the frontend
- **174 teams** normalized across providers
- **4,100+ games** in DB · outcomes resolved automatically via cron
- **5,000+ player stats** (all 6 sports via ESPN core API)
- **v2 predictions** (winner): 2,500+ backfilled · 61.4% accuracy · 0.249 Brier
- **v4-spread predictions** (ATS): accumulating live — track record displays at N≥30
- **MLB pitcher data**: probable starters + ERA extracted from ESPN scoreboard

## Live URLs

- **Frontend**: https://sportsdata.pages.dev
- **API**: https://sportsdata-api.fly.dev
- **Health**: https://sportsdata-api.fly.dev/api/health

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/health` | GET | No | Health check with `last_scrape_at` staleness field |
| `/api/stats` | GET | No | Per-sport aggregate stats |
| `/api/games` | GET | No | All games with scores and odds |
| `/api/margins` | GET | No | Margin distribution data |
| `/api/home-timeline` | GET | No | Home win rate over time |
| `/api/extreme-games` | GET | No | Top 5 blowouts + closest games |
| `/api/team-sequences` | GET | No | Per-team win/loss sequences by season |
| `/api/findings` | GET | No | Interesting patterns ranked by surprise |
| `/api/predictions/upcoming` | GET | No | v2 upcoming winner predictions |
| `/api/predictions/recent` | GET | No | v2 recently resolved predictions |
| `/api/predictions/track-record` | GET | No | v2 accuracy + Brier by cohort |
| `/api/predictions/calibration` | GET | No | v2 calibration bins + ECE |
| `/api/spread-picks/upcoming` | GET | No | v4-spread ATS picks with edge/tier |
| `/api/spread-picks/track-record` | GET | No | v4-spread ATS record + ROI |
| `/api/ratchet` | GET | No | Ratchet iteration artifact |
| `/api/players` | GET | No | Player findings |
| `/api/sport-data` | GET | No | Per-sport hero + findings |
| `/api/player-counts` | GET | No | Player counts across all sports |
| `/api/trigger/scrape` | POST | Bearer | Scrape ESPN + odds, resolve outcomes |
| `/api/trigger/predict` | POST | Bearer | Generate v2 + v4-spread predictions |

All GET endpoints accept `?sport=nba|nfl|mlb|nhl|mls|epl`. Trigger endpoints accept `?sport=all` for multi-league scraping.

## Models

### v2 Ratchet (Winner Prediction)

Built via a Karpathy-style ratchet loop. Predicts which team wins.

| Version | Description | Test Brier | Δ |
|---------|-------------|------------|---|
| v0 | Always pick home team | 0.4529 | — |
| v1 | + Flip if visitor has 10+ more wins | 0.3233 | −0.1296 |
| **v2** | **+ Flip on 3+ point differential** | **0.2486** | **−0.0745** |
| v3 | + Cold streak penalty | 0.2510 | +0.0022 (rejected) |

45% Brier improvement over baseline. Validated on 2,500 held-out games.

### v4-spread (Against the Spread)

Predicts expected margin and compares against the bookmaker's spread line. Experimental — no backtesting, accumulating live track record.

| Feature | Source |
|---------|--------|
| Team point differential per game | ESPN game results |
| Home advantage (per-sport) | NBA +3.0, NFL +2.5, MLB +0.5, NHL +0.3, soccer +0.4 |
| Cold/hot streak adjustment | Last 3 games |
| **MLB pitcher ERA differential** | ESPN probable pitchers (±0.3 runs per 1.0 ERA gap) |
| Odds spread line | The Odds API |

Picks classified as **Strong** (edge ≥ threshold), **Lean**, or **Skip**. Only Strong + Lean shown to users. Track record gated at N≥30 resolved picks. Break-even at -110 vig: 52.4%.

### Known Limitations (Council Debt)

- No backtesting (needs historical odds data — accumulating)
- Streak adjustments not empirically calibrated
- MLB: no bullpen or park factor modeling
- NHL: no goalie matchup data
- MLS/EPL: draw probability not modeled (affects Asian handicap spreads)
- Pseudo-probabilities (0.58/0.54/0.51) are starting priors, not calibrated
