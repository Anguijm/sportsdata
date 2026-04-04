# Sports Data Platform Context

## Project Purpose
US sports data analytics platform that scrapes live statistics, visualizes connections, draws conclusions, and predicts outcomes.

## Architecture
Four-layer system: Data → Orchestration → Analysis → Governance.
Council-validated via 3-round debate (2026-04-04).

## Key Decisions
- SQLite (operational) + DuckDB (analytical) + JSON append logs
- JSON-over-stdio bridge between TypeScript and Python
- Single council with role-tagged prompts
- Semi-autonomous ratchet with human-gated scraper modifications
- 2-source corroboration default, 3 for high-stakes data (injury, line movements)
- TypeScript interfaces as schema source of truth

## Data Sources
ESPN (undocumented API), the-odds-api.com, sportsdata.io, Sports Reference (scraping)
