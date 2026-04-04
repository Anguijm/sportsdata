# Sprint 3 Plan — Council-Validated

## Context

Sprint 2 delivered SQLite persistence, scheduler, CLI tables, and Odds API client. Council review (WARN, 7.25/10) flagged missing outcomes table, no ingest validation, and team name mapping gap. API research identified BallDontLie (free, multi-sport), API-Football (EPL depth), and 370+ undocumented ESPN endpoints.

Council debated 3 rounds. Unanimous on cutting to 4 items. Resolved all tensions.

## Sprint 3 — 4 Items (Council-Approved)

### P1: Odds API Activation
**Why:** Built in Sprint 2 but never shipped. Every day without it = permanently lost odds data.
- Wire Odds API client into the scheduler cycle
- Verify ingestion, monitor for 48 hours
- Log remaining monthly budget after each fetch
- **Day-one work** — treat as same-session deployment

### P2: Game Outcomes Table + Result Tracking
**Why:** Can't compute Brier scores without outcomes. Critical path to first prediction.
- Add `game_results` table in SQLite (game_id, winner, margin, spread_result, over_under_result)
- Backfill results from existing games in the database
- Schema designed to join with odds data from the start
- Auto-resolve outcomes when game status transitions to 'final'

### P3: Team Name Mapping (NBA-Only)
**Why:** ESPN IDs ≠ Odds API names ≠ BallDontLie IDs. Cross-source joins don't work without this.
- Create `team_mappings` table: canonical_id → provider-specific names
- Seed with NBA teams (30 entries × 3 sources)
- Include basic `inspect` CLI command for reviewing matches (bundled, not separate item)
- Build the pattern; extend to other sports in Sprint 4

### P4: BallDontLie Historical NBA Ingest
**Why:** 10+ seasons of historical NBA data = training data on the critical path. Waiting costs 4 weeks of model dev time.
- NBA game results only (no player stats, no other sports)
- Build with backoff and resumability (can run over multiple days)
- Must land AFTER P3 (team mapping) to avoid corrupted joins
- Bounded integration: ~3,000 games per season × 10 seasons

## Deferred to Sprint 4

| Item | Reason |
|------|--------|
| **Expanded ESPN endpoints** (standings, injuries, player stats) | Research spike needed first — "370+ endpoints" isn't a task |
| **BallDontLie full expansion** (player stats, multi-sport) | Prove NBA pattern works first, then replicate |
| **API-Football for EPL** | Separate soccer pipeline, do after US sports are stable |
| **Full canonical entity model** | Extend NBA mapping pattern to all sports |
| **DuckDB analytical layer** | Deferred since Sprint 2 — wait for data volume |
| **Corroboration engine** | Needs team mapping + multi-source data first |
| **Ratchet scoring MVP** | Needs 50-100+ events with outcomes |
| **Additional inspection tooling** | Beyond the basic `inspect` command in P3 |
| **Ingest validation + staleness alerting** | Council P2/P5 — fold into P1 as lightweight checks |

## Timeline to First Prediction

```
April 5     → Odds API activated, accumulation begins
April 5-12  → Game outcomes table, team mapping, historical ingest
Mid-April   → BallDontLie historical NBA data loaded
April-May   → 60 days of live odds + outcomes accumulating
Early June  → First ratchet predictions (NBA only, Brier score)
```

## Risks

| Risk | Mitigation |
|------|-----------|
| Odds API stays inactive another day | P1 is same-session work, not deferred |
| BallDontLie rate limits slow historical ingest | Build with backoff + resumability, run over multiple days |
| Team mapping must land before BallDontLie ingest | P3 blocks P4 — enforce ordering |
| P4 slips | Predictions proceed on live data alone, weaker training baseline |
| BallDontLie NBA coverage has undocumented gaps | Validate completeness against known NBA schedule counts |

## Council Debate Record

**Round 1 Key Positions:**
- Architect: Team mapping must be first (canonical entity model). BallDontLie 2 leagues max. Need migration strategy.
- Designer: Need inspection tooling for new data types. Fuzzy matching needs visual review.
- Engineer: Cut to 4. Ship what we already built (Odds API). Defer new integrations.
- Researcher: BallDontLie NBA-only (multi-sport unproven). API-Football for EPL. Odds is most urgent. ~June for first predictions.

**Round 2 Convergence:**
- All agree: 4 items, Odds API first, NBA-only scope for new integrations
- Designer's inspect CLI bundled into team mapping work (not separate)
- Architect's entity model scoped to NBA mapping table with migration
- Researcher's historical data argument wins: 10+ seasons is training data on critical path

**Final Verdict:** Approved. 4 items. Ship in priority order.
