# Sports Data Analytics Platform — Architecture & Foundation Plan

## Context

John wants to build a US sports data analytics platform that scrapes live statistics, visualizes connections, draws conclusions, and predicts outcomes. The architecture combines three proven patterns:

1. **Karpathy's AutoResearch ratchet loop** — autonomous improvement cycle (hypothesize → modify → execute → evaluate → keep-or-revert) applied to predictions
2. **Yolo-projects** — 6-angle Gemini council, 5-level memory hierarchy, Dark Factory retry loops, evaluation gates at every stage
3. **Roadtripper** — harness.yml council config, expert personas, skills-based workflow, decision logging

A 4-agent council debate (Architect, Designer, Engineer, Researcher) produced strong convergence on key decisions documented below.

## Architecture: Four Layers

```
┌──────────────────────────────────────────────────────────┐
│                   GOVERNANCE LAYER                        │
│  Council (role-tagged) │ Evaluation Gates │ Memory/Logs  │
├──────────────────────────────────────────────────────────┤
│                  ORCHESTRATION LAYER                      │
│  Thin State Machine │ Ratchet Loop │ Pipeline Control    │
├──────────────────────────────────────────────────────────┤
│                    ANALYSIS LAYER                         │
│  Statistical Analysis │ Predictions │ Visualizations     │
├──────────────────────────────────────────────────────────┤
│                      DATA LAYER                           │
│  Scrapers │ Normalizers │ SQLite (ops) │ DuckDB (analytics)│
└──────────────────────────────────────────────────────────┘
```

## Council-Validated Decisions

These decisions emerged from 3-round council debate with convergence:

| Decision | Rationale |
|----------|-----------|
| **SQLite (operational) + DuckDB (analytical read-only) + JSON append logs** | SQLite for live state, DuckDB for columnar cross-sport queries, JSON for audit trail |
| **JSON-over-stdio bridge** between TypeScript and Python | Simple, no dependency hell, schema validation at boundary |
| **Single council with role-tagged prompts** | Not three separate councils — avoids complexity explosion for MVP |
| **Thin state machine orchestration** | Not a framework — simple JSON config driving pipeline state |
| **Semi-autonomous ratchet** | Auto-iterate on analysis params; human-gate scraper modifications |
| **2-source corroboration default, 3 for high-stakes** | ESPN authoritative for scores; injury/line data needs 3 sources |
| **TypeScript interfaces as schema source of truth** | Generate Python dataclasses from TS; single source prevents drift |
| **Dev mode flag** | Log what would be gated but don't block during development |

## Data Sources (Free Tier)

| Source | Type | Data |
|--------|------|------|
| ESPN undocumented API | REST | Scores, schedules, standings, player stats |
| the-odds-api.com | REST (500 req/mo free) | Betting lines, odds |
| sportsdata.io | REST (free trial) | Comprehensive stats |
| Sports Reference | Scraping | Historical data gold standard |

## Directory Structure

```
sportsdata/
├── package.json                    # TypeScript/Node project
├── tsconfig.json
├── harness.yml                     # Council & governance config
├── design.md                       # Visualization design system
├── learnings.md                    # KEEP/IMPROVE/DISCARD/INSIGHT
├── session_state.json              # Phase & pipeline tracking
│
├── src/
│   ├── schema/                     # TypeScript interfaces (source of truth)
│   │   ├── player.ts
│   │   ├── team.ts
│   │   ├── game.ts
│   │   ├── prediction.ts
│   │   └── provenance.ts           # Source, timestamp, staleness score
│   │
│   ├── scrapers/                   # Data Layer
│   │   ├── espn.ts                 # ESPN undocumented API client
│   │   ├── odds-api.ts             # the-odds-api.com client
│   │   ├── sports-reference.ts     # HTML scraper for historical
│   │   └── normalizer.ts           # Raw → unified schema
│   │
│   ├── storage/                    # Repository pattern
│   │   ├── repository.ts           # Interface (swap backends easily)
│   │   ├── sqlite.ts               # Operational store
│   │   ├── duckdb.ts               # Analytical read-only overlay
│   │   └── json-log.ts             # Append-only event log
│   │
│   ├── orchestration/              # Thin state machine
│   │   ├── pipeline.ts             # State machine config
│   │   ├── ratchet.ts              # Hypothesize → execute → evaluate → keep/revert
│   │   └── gates.ts                # Pre-plan, pre-build, post-build evaluation gates
│   │
│   ├── analysis/                   # Analysis Layer
│   │   ├── correlations.ts         # Cross-stat relationship detection
│   │   ├── predictions.ts          # Prediction engine
│   │   └── confidence.ts           # Confidence scoring with provenance
│   │
│   └── bridge/                     # TS ↔ Python boundary
│       ├── stdio-bridge.ts         # JSON-over-stdio caller
│       └── validate.ts             # Schema validation at boundary
│
├── python/                         # Python ML layer
│   ├── models/                     # Training & evaluation
│   ├── analysis/                   # Statistical methods
│   └── bridge.py                   # stdio listener, schema validation
│
├── .harness/                       # Governance Layer
│   ├── council/
│   │   ├── data-quality.md         # Validates scrape completeness, freshness
│   │   ├── statistical-validity.md # Reviews methodology, sample sizes
│   │   ├── prediction-accuracy.md  # Backtests claims, calibration
│   │   ├── domain-expert.md        # Sports knowledge, context
│   │   └── resolver.md             # Synthesizes, breaks ties
│   └── memory/
│       ├── context.md
│       └── decisions.json
│
├── skills/                         # Workflow skills
│   ├── 00-bootstrap.md             # Session init, state recovery
│   ├── 10-scrape.md                # Data collection pipeline
│   ├── 20-analyze.md               # Analysis & prediction pipeline
│   └── 30-review.md                # Council review & evaluation
│
├── data/                           # Local data storage
│   ├── sqlite/                     # Operational database
│   ├── duckdb/                     # Analytical database
│   └── logs/                       # JSON append-only event logs
│       ├── scrape-log.jsonl
│       ├── analysis-log.jsonl
│       └── prediction-log.jsonl
│
└── MEMORY/WORK/                    # PRD & session tracking
```

## Ratchet Loop Design

```
┌─────────────┐
│ HYPOTHESIZE │ ← "NFL home teams with <3 days rest lose at higher rate"
└──────┬──────┘
       ▼
┌─────────────┐
│   MODIFY    │ ← Adjust model weights / add feature / change threshold
└──────┬──────┘
       ▼
┌─────────────┐
│   EXECUTE   │ ← Run prediction against historical data
└──────┬──────┘
       ▼
┌─────────────┐
│  EVALUATE   │ ← Did accuracy improve? (metric: Brier score, log-loss, etc.)
└──────┬──────┘
       ▼
   ┌───┴───┐
   │Better?│
   └───┬───┘
  YES  │  NO
   ▼      ▼
 KEEP   REVERT
```

**Improvement metrics per domain:**
- Game outcome predictions: Brier score
- Point spread predictions: Mean absolute error
- Player stat predictions: RMSE against actuals
- Trend detection: Correlation strength (Pearson r)

## Evaluation Gates

| Gate | When | What's Evaluated | Blocks On |
|------|------|-------------------|-----------|
| **Idea Gate** | Before planning analysis | Feasibility, data availability, novelty | Duplicate analysis, impossible queries |
| **Plan Gate** | Before implementation | Methodology, sample size, data sources | Bad methodology, insufficient data |
| **Build Gate** | After implementation | Results vs criteria, statistical significance | Failed assertions, p-hacking |
| **Prediction Gate** | Before publishing | Confidence threshold, source corroboration | Below threshold, single source |
| **Data Quality Gate** | After every scrape | Completeness, freshness, schema conformance | Missing fields, stale data, schema drift |

## Memory & Logging System

Adapted from Yolo's 5-level hierarchy:

| Level | File | Content |
|-------|------|---------|
| 1 | `learnings.md` | KEEP/IMPROVE/DISCARD/INSIGHT per analysis run |
| 2 | `data/logs/scrape-log.jsonl` | Every scrape: timestamp, source, records, errors |
| 3 | `data/logs/analysis-log.jsonl` | Every analysis: hypothesis, method, result, confidence |
| 4 | `data/logs/prediction-log.jsonl` | Every prediction: claim, confidence, sources, outcome (backfilled) |
| 5 | `session_state.json` | Pipeline phase, active scrapes, pending analyses |
| 6 | `.harness/memory/decisions.json` | Architectural & analytical decision log |
| 7 | `MEMORY/WORK/*/PRD.md` | Per-session PRDs |

## This Session: What We'll Build

**Sprint 1 deliverables (this session):**
1. Project init (package.json, tsconfig, directory structure)
2. TypeScript schema interfaces (player, team, game, prediction, provenance)
3. harness.yml + council persona files
4. Skills files (bootstrap, scrape, analyze, review)
5. Session state + learnings.md initialization
6. Repository pattern interface + JSON log implementation
7. ESPN scraper stub with rate limiting
8. Ratchet loop config and state machine definition
9. Evaluation gate definitions
10. Design doc for visualization system

## Verification

- `npm run type-check` passes with zero errors
- All directories exist per structure above
- harness.yml parses as valid YAML
- Council persona files contain role definitions with FAIL/WARN/CLEAR verdicts
- Schema interfaces define all core types
- Event log format is valid JSONL
- Ratchet loop config defines all 4 phases with metric definitions
