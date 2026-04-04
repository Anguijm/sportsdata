# Bootstrap Skill

Session initialization and state recovery for the sports data platform.

## Entry Point

Run this at the start of every session to recover state and route to the correct workflow.

## Steps

### 1. Read State
- Read `session_state.json` for pipeline phase, active scrapes, pending analyses
- Read `learnings.md` (first 50 lines) for accumulated patterns
- Read `data/logs/scrape-log.jsonl` (last 10 entries) for recent scrape status
- Read `data/logs/prediction-log.jsonl` (last 5 entries) for recent predictions

### 2. Report Status
Output:
```
Pipeline Phase: [phase]
Last Scrape: [source] at [timestamp] — [records] records
Active Hypotheses: [count] active, [count] validated, [count] rejected
Pending Analyses: [list]
Blockers: [any gates blocking progress]
```

### 3. Route to Skill
Based on state:
- No data → Route to `10-scrape.md`
- Data present, no analyses → Route to `20-analyze.md`
- Analyses complete, needs review → Route to `30-review.md`
- User override → Follow user instruction

### 4. Check Learnings
Before any work, scan learnings.md for relevant patterns:
- Previous failures with the same data source
- Known schema quirks for the target sport
- Evaluation gate failures to avoid repeating
