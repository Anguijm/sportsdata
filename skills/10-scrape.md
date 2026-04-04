# Scrape Skill

Data collection pipeline for sports statistics.

## Prerequisites
- `harness.yml` loaded for rate limits and source configuration
- Target sport and data type identified

## Pipeline

### 1. Select Sources
Based on data type needed:
- Scores/schedules/standings → ESPN API (priority 1)
- Betting lines/odds → the-odds-api.com (priority 2)
- Comprehensive stats → sportsdata.io (priority 3)
- Historical data → Sports Reference scraping (priority 4)

### 2. Rate Limit Check
Before any request:
- Check `data/logs/scrape-log.jsonl` for recent request count
- Respect per-source rate limits from `harness.yml`
- For Sports Reference: enforce 3000ms delay between requests

### 3. Execute Scrape
- Make API request or scrape page
- Log raw response metadata (status, size, timestamp) immediately
- Do NOT modify raw data before logging

### 4. Data Quality Gate
Run after every scrape:
- Schema conformance: does response match expected structure?
- Completeness: are required fields present?
- Freshness: is the data current enough for our use case?

Gate result logged to `data/logs/scrape-log.jsonl`:
```json
{"timestamp": "ISO", "source": "espn", "sport": "nfl", "dataType": "scores", "records": 16, "gate": "CLEAR", "durationMs": 234}
```

If FAIL: log failure reason, do not proceed to normalization.

### 5. Normalize
Transform raw data into unified schema (TypeScript interfaces):
- Assign normalized IDs (e.g., "nfl:KC")
- Attach provenance metadata
- Write to SQLite operational store

### 6. Update Learnings
If anything unexpected happened:
```markdown
### [source]-[sport]-[dataType] (YYYY-MM-DD)
- **KEEP/IMPROVE/DISCARD/INSIGHT**: [what happened]
```

## Dark Factory Retry Loop
If scrape fails:
1. Identify failure (network, rate limit, schema change, auth)
2. Fix or wait (rate limit → backoff, schema → log and skip)
3. Retry (max 3 attempts)
4. If still failing: log as failed, move to next source
