# bbref Convention Report

Generated: 2026-04-26T21:29:59.882Z

## Strata summary

| Stratum | Matched | Mismatch | DB missing | TODO skipped | Errors |
|---|---|---|---|---|---|
| regular | 4 | 0 | 0 | 0 | 0 |
| postseason | 4 | 0 | 0 | 0 | 0 |
| nba_finals | 2 | 0 | 0 | 0 | 0 |
| conference_finals | 2 | 0 | 0 | 0 | 0 |
| play_in | 2 | 0 | 0 | 0 | 0 |
| cup_pool | 2 | 0 | 0 | 0 | 0 |
| cup_knockout | 1 | 1 | 0 | 0 | 0 |
| marquee_broadcast | 2 | 0 | 0 | 0 | 0 |
| rescheduled_2022_23 ⚠️ | 0 | 0 | 0 | 2 | 0 |
| ot | 2 | 0 | 0 | 0 | 0 |

## Game-level results

- `nba:bdl-1038347` (regular) home=✓ db:9 bbref:9 | away=✓ db:16 bbref:16
- `nba:bdl-15907488` (regular) home=✓ db:11 bbref:11 | away=✓ db:12 bbref:12
- `nba:bdl-15907727` (regular) home=✓ db:17 bbref:17 | away=✓ db:17 bbref:17
- `nba:bdl-18447026` (regular) home=✓ db:14 bbref:14 | away=✓ db:18 bbref:18
- `nba:bdl-15882375` (postseason) home=✓ db:6 bbref:6 | away=✓ db:12 bbref:12
- `nba:bdl-15881959` (postseason) home=✓ db:18 bbref:18 | away=✓ db:12 bbref:12
- `nba:bdl-18421937` (postseason) home=✓ db:11 bbref:11 | away=✓ db:21 bbref:21
- `nba:bdl-18436463` (postseason) home=✓ db:9 bbref:9 | away=✓ db:21 bbref:21
- `nba:bdl-18444561` (nba_finals) home=✓ db:16 bbref:16 | away=✓ db:16 bbref:16
- `nba:bdl-15905067` (nba_finals) home=✓ db:9 bbref:9 | away=✓ db:13 bbref:13
- `nba:bdl-18441484` (conference_finals) home=✓ db:13 bbref:13 | away=✓ db:18 bbref:18
- `nba:bdl-18441830` (conference_finals) home=✓ db:15 bbref:15 | away=✓ db:19 bbref:19
- `nba:bdl-18421910` (play_in) home=✓ db:10 bbref:10 | away=✓ db:20 bbref:20
- `nba:bdl-18421229` (play_in) home=✓ db:10 bbref:10 | away=✓ db:8 bbref:8
- `nba:bdl-15907534` (cup_pool) home=✓ db:20 bbref:20 | away=✓ db:13 bbref:13
- `nba:bdl-15907531` (cup_pool) home=✓ db:10 bbref:10 | away=✓ db:15 bbref:15
- `nba:bdl-17195500` (cup_knockout) home=✓ db:10 bbref:10 | away=✓ db:19 bbref:19
- `nba:bdl-8258317` (cup_knockout) home=✗ db:20 bbref:18 | away=✓ db:9 bbref:9
- `nba:bdl-1037593` (marquee_broadcast) home=✓ db:12 bbref:12 | away=✓ db:12 bbref:12
- `nba:bdl-18447232` (marquee_broadcast) home=✓ db:13 bbref:13 | away=✓ db:14 bbref:14
- `nba:bdl-1037615` (ot) home=✓ db:18 bbref:18 | away=✓ db:18 bbref:18
- `nba:bdl-15908920` (ot) home=✓ db:22 bbref:22 | away=✓ db:13 bbref:13

## Sentinel re-probe

| game_id | team_id | sentinel_active | espn_resolved | db_tov | espn_totalTov | espn_teamTov |
|---|---|---|---|---|---|---|
| nba:bdl-18447432 | nba:CHI | true | false | 0 | 0 | -12 |
| nba:bdl-18447432 | nba:LAC | true | false | 0 | 0 | -16 |
| nba:bdl-15907929 | nba:GS | true | false | 0 | 0 | -22 |
| nba:bdl-15907929 | nba:SAC | false | true | 16 | 16 | 1 |
| nba:bdl-18446826 | nba:BOS | false | true | 9 | 9 | -2 |
| nba:bdl-18446826 | nba:PHI | false | true | 14 | 14 | 0 |
| nba:bdl-15907808 | nba:DEN | true | false | 0 | 0 | -11 |
| nba:bdl-15907808 | nba:POR | false | true | 10 | 10 | 0 |

## Overall

- Strata with ≥2 validated games: **8 / 10**
- Strata needing more entries: `rescheduled_2022_23`
- Sentinel rows still active (db_tov=0): **4**
- Sentinel rows now resolved in ESPN: **4**
