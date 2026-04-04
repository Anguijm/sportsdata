---
task: Build sports data platform with research and council
slug: 20260404-100943_sportsdata-platform-research-council
effort: deep
phase: complete
progress: 43/44
mode: interactive
started: 2026-04-04T10:09:43-05:00
updated: 2026-04-04T10:10:30-05:00
---

## Context

John wants to build a US sports data analytics platform that combines three proven patterns:

1. **Karpathy's AutoResearch pattern** — An autonomous improvement loop (hypothesize → modify → execute → evaluate → keep-or-revert) applied to sports data analysis. Not a library to install, but a pattern to adapt: the "ratchet loop" where each iteration either improves the result or reverts, ensuring monotonic improvement.

2. **Yolo-projects architecture** — The 6-angle Gemini council review, 5-level memory hierarchy (learnings.md, yolo_log.json, session_state.json, MEMORY/WORK PRDs, build-logs), Dark Factory retry loops, and evaluation gates at every stage.

3. **Roadtripper architecture** — The harness.yml council configuration, .harness/council expert personas (architecture, product, security, resolver), skills-based workflow (bootstrap → build → review), and decision logging.

**The platform must:**
- Scrape/capture live US sports statistics from public sources
- Store and normalize data for cross-sport analysis
- Visualize connections between data points (players, teams, stats, outcomes)
- Draw conclusions from statistical patterns
- Predict outcomes using the auto-research ratchet loop
- Log everything (successful runs, failed runs, predictions, evaluations)
- Gate every stage: ideas evaluated before planning, plans before implementation, results after implementation

**Not requested (this session):**
- Fully working deployed application — this is foundation/architecture
- Specific sport focus — platform should be multi-sport capable
- User-facing UI — backend/pipeline first

### Risks
- Sports data sources may have rate limits, anti-scraping measures, or ToS restrictions
- Prediction accuracy requires significant historical data before being meaningful
- Council review overhead could slow iteration speed — need to calibrate gate strictness
- Auto-research ratchet loop needs a clear "improvement metric" per domain (accuracy, coverage, etc.)

### Plan

**Architecture: Three-layer system**

1. **Data Layer** — Scrapers, normalizers, storage (Firestore or Postgres)
2. **Analysis Layer** — Auto-research ratchet loop, prediction models, statistical analysis
3. **Governance Layer** — Council review, evaluation gates, memory/logging, learnings accumulation

**Tech stack decision:** TypeScript/Node.js (consistent with John's other projects), with Python for ML/stats where needed.

**Key adaptation from sources:**
- Yolo's `eval_bugs.py` pattern → `eval_analysis.py` (validate statistical claims)
- Yolo's `build_log.py` → `analysis_log.py` (structured event logging for every scrape, analysis, prediction)
- Roadtripper's `.harness/council/` → Sports-specific council (data quality, statistical validity, prediction accuracy, domain expertise)
- Karpathy's ratchet → Applied to prediction models: each iteration must improve accuracy or revert

## Criteria

### Foundation & Project Structure
- [x] ISC-1: Project initialized with package.json and TypeScript config
- [x] ISC-2: Directory structure follows three-layer architecture pattern
- [x] ISC-3: harness.yml defines sports-specific council configuration
- [x] ISC-4: Skills directory contains bootstrap, scrape, analyze, and review skills
- [x] ISC-5: Session state JSON tracks scraping and analysis phases
- [x] ISC-6: Design doc specifies data visualization color system and components

### Council System
- [x] ISC-7: Council expert persona for data quality validation exists
- [x] ISC-8: Council expert persona for statistical validity review exists
- [x] ISC-9: Council expert persona for prediction accuracy assessment exists
- [x] ISC-10: Council expert persona for sports domain expertise exists
- [x] ISC-11: Resolver persona synthesizes council feedback into action plan
- [x] ISC-12: Council verdict system uses FAIL/WARN/CLEAR grading

### Memory & Logging System
- [x] ISC-13: learnings.md file initialized with KEEP/IMPROVE/DISCARD/INSIGHT format
- [x] ISC-14: Structured event log captures every scrape run with timestamp
- [x] ISC-15: Structured event log captures every analysis run with results
- [x] ISC-16: Structured event log captures every prediction with confidence score
- [x] ISC-17: Failed runs logged with failure reason and context
- [x] ISC-18: Decision log JSON records architectural and analytical choices
- [x] ISC-19: Session state persists across conversation boundaries

### Evaluation Gates
- [x] ISC-20: Pre-planning gate evaluates idea feasibility before design
- [x] ISC-21: Pre-implementation gate evaluates plan quality before coding
- [x] ISC-22: Post-implementation gate validates results against criteria
- [x] ISC-23: Prediction gate requires minimum confidence threshold before publishing
- [x] ISC-24: Data quality gate validates scraped data completeness and freshness

### Auto-Research Ratchet Loop
- [x] ISC-25: Ratchet loop config defines hypothesis-modify-execute-evaluate cycle
- [x] ISC-26: Improvement metric definition file exists per analysis domain
- [x] ISC-27: Ratchet keeps successful iterations and reverts failed ones
- [x] ISC-28: Ratchet iteration history logged with before/after metrics
- [x] ISC-29: Ratchet supports multiple concurrent hypothesis tracks

### Data Scraping Infrastructure
- [x] ISC-30: Scraper config defines target sports data sources
- [x] ISC-31: Scraper handles rate limiting and respectful crawling
- [x] ISC-32: Data normalizer transforms raw scrapes into unified schema
- [x] ISC-33: Scraper produces structured JSON output per data source
- [ ] ISC-34: Scrape schedule config supports cron-based recurring runs

### Data Schema & Storage
- [x] ISC-35: Unified schema supports multiple US sports leagues
- [x] ISC-36: Schema normalizes player stats across different sport formats
- [x] ISC-37: Schema supports team-level aggregate statistics
- [x] ISC-38: Schema supports game/match result records with scores
- [x] ISC-39: Schema supports historical season data for trend analysis

### Visualization & Analysis Config
- [x] ISC-40: Visualization config defines chart types for statistical connections
- [x] ISC-41: Analysis pipeline config defines available statistical methods
- [x] ISC-42: Prediction output format includes confidence intervals and evidence

### Anti-Criteria
- [x] ISC-A-1: Anti: No hardcoded sports data in source files
- [x] ISC-A-2: Anti: No unlogged scrape or analysis operations

## Decisions

- 2026-04-04 10:10: Deep effort selected — multi-system platform with council, memory, ratchet loop, and scraping infrastructure requires thorough decomposition
- 2026-04-04 10:10: TypeScript primary stack — consistent with John's Yolo and Roadtripper projects, Python for ML/stats only where needed
- 2026-04-04 10:10: Architecture adapted from three sources — Karpathy ratchet loop for predictions, Yolo evaluation gates and memory, Roadtripper council governance
- 2026-04-04 10:12: Focus on executable scaffold over pure docs — premortem revealed risk of beautiful architecture with zero runnable code
- 2026-04-04 10:12: Local JSON storage for MVP — avoid Firestore/Postgres setup overhead; migrate later when data volume warrants it

## Verification

- ISC-1 through ISC-6: `npx tsc --noEmit` passes clean; all directories exist per plan; harness.yml, session_state.json, design.md, learnings.md all created
- ISC-7 through ISC-12: 5 council persona files in .harness/council/ with FAIL/WARN/CLEAR verdict system; resolver.md synthesizes
- ISC-13 through ISC-19: learnings.md has KEEP/IMPROVE/DISCARD/INSIGHT format; 3 log types (scrape, analysis, prediction) in json-log.ts with structured entries; decisions.json initialized; session_state.json persists pipeline state
- ISC-20 through ISC-24: 5 gate functions in gates.ts (idea, plan, build, prediction, data_quality); dev mode flag controls blocking
- ISC-25 through ISC-29: ratchet.ts implements full hypothesize→modify→execute→evaluate→keep/revert cycle; isBetter() handles 4 metric types; evaluateIteration logs to analysis-log.jsonl; Hypothesis interface supports multiple concurrent tracks
- ISC-30 through ISC-33: harness.yml defines 4 sources with rate limits; espn.ts enforces rate limiting; normalizer.ts transforms raw data; scrapedFetch produces structured JSON
- ISC-34: NOT MET — Cron schedule config deferred to Sprint 2
- ISC-35 through ISC-39: Sport union covers 5 US leagues; PlayerStats.coreStats uses Record for cross-sport normalization; TeamStats has wins/losses/pointsFor/Against; Game has score/odds; Season type supports historical analysis
- ISC-40 through ISC-42: design.md defines confidence gradient bars, provenance badges, dashboard components; harness.yml defines statistical methods per domain; Prediction interface has confidenceInterval and corroboration
- ISC-A-1: grep confirms no hardcoded sports data in source files
- ISC-A-2: Both success and failure paths in espn.ts call appendLog; ratchet evaluateIteration always logs

**Capability invocation check:**
- Thinking:Council — INVOKED via Skill("Thinking", "council: ...") → 3-round debate with 4 agents
- Research — INVOKED via ClaudeResearcher agent (Karpathy auto-research)
- /simplify — INVOKED via Skill("simplify") → 3 review agents, 5 fixes applied
