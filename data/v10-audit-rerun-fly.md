# ESPN ↔ basketball-reference audit

Run timestamp: 2026-04-26T06:07:07.230Z
Ground-truth file: `data/espn-bbref-audit-truth.json`
Sample size N: 50

## Per-game results

### nba:bdl-1037593 — nba:LAL @ nba:DEN (2023-regular)

bbref: https://www.basketball-reference.com/boxscores/202310240DEN.html

raw count failures: 2; derived rate failures: 6; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 12 | 11 | exact | Δ=-1 |
| tov_pct | home | 0.111 | 0.10253542132736763 | 1pct | relErr=7.626% > 1% |
| ortg | home | 123.6 | 124.8488069885682 | 1pct | relErr=1.010% > 1% |
| pace | home | 96.3 | 95.31528804347825 | 1pct | relErr=1.023% > 1% |
| tov | away | 12 | 11 | exact | Δ=-1 |
| tov_pct | away | 0.10800000000000001 | 0.10018214936247724 | 1pct | relErr=7.239% > 1% |
| ortg | away | 111.1 | 112.25901132585544 | 1pct | relErr=1.043% > 1% |
| pace | away | 96.3 | 95.31528804347825 | 1pct | relErr=1.023% > 1% |

### nba:bdl-1037689 — nba:LAL @ nba:MIA (2023-regular)

bbref: https://www.basketball-reference.com/boxscores/202311060MIA.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 18 | 17 | exact | Δ=-1 |
| tov_pct | home | 0.159 | 0.15173152445555158 | 1pct | relErr=4.571% > 1% |

### nba:bdl-1037802 — nba:MIL @ nba:BOS (2023-regular)

bbref: https://www.basketball-reference.com/boxscores/202311220BOS.html

raw count failures: 0; derived rate failures: 0; rates skipped (no bbref ground-truth): 0

All fields within tolerance. ✓

### nba:bdl-1037923 — nba:LAL @ nba:SA (2023-regular)

bbref: https://www.basketball-reference.com/boxscores/202312150SAS.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 9 | 8 | exact | Δ=-1 |
| tov_pct | home | 0.08 | 0.07183908045977011 | 1pct | relErr=10.201% > 1% |

### nba:bdl-1038139 — nba:NO @ nba:DAL (2023-regular)

bbref: https://www.basketball-reference.com/boxscores/202401130DAL.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | away | 11 | 10 | exact | Δ=-1 |
| tov_pct | away | 0.10400000000000001 | 0.09498480243161093 | 1pct | relErr=8.668% > 1% |

### nba:bdl-1038242 — nba:LAL @ nba:GS (2023-regular)

bbref: https://www.basketball-reference.com/boxscores/202401270GSW.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | away | 20 | 19 | exact | Δ=-1 |
| tov_pct | away | 0.14300000000000002 | 0.13676936366253958 | 1pct | relErr=4.357% > 1% |

### nba:bdl-1038347 — nba:IND @ nba:NY (2023-regular)

bbref: https://www.basketball-reference.com/boxscores/202402100NYK.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | away | 16 | 15 | exact | Δ=-1 |
| tov_pct | away | 0.15 | 0.14236902050113895 | 1pct | relErr=5.087% > 1% |

### nba:bdl-1038574 — nba:ATL @ nba:LAC (2023-regular)

bbref: https://www.basketball-reference.com/boxscores/202403170LAC.html

raw count failures: 2; derived rate failures: 6; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 16 | 15 | exact | Δ=-1 |
| tov_pct | home | 0.156 | 0.14740566037735847 | 1pct | relErr=5.509% > 1% |
| ortg | home | 101.1 | 102.78530366640828 | 1pct | relErr=1.667% > 1% |
| pace | home | 92 | 90.4798611111111 | 1pct | relErr=1.652% > 1% |
| tov | away | 16 | 14 | exact | Δ=-2 |
| tov_pct | away | 0.152 | 0.13555383423702555 | 1pct | relErr=10.820% > 1% |
| ortg | away | 119.6 | 121.57401508930012 | 1pct | relErr=1.651% > 1% |
| pace | away | 92 | 90.4798611111111 | 1pct | relErr=1.652% > 1% |

### nba:bdl-1038579 — nba:MIN @ nba:UTAH (2023-regular)

bbref: https://www.basketball-reference.com/boxscores/202403180UTA.html

raw count failures: 0; derived rate failures: 0; rates skipped (no bbref ground-truth): 0

All fields within tolerance. ✓

### nba:bdl-1038646 — nba:IND @ nba:CHI (2023-regular)

bbref: https://www.basketball-reference.com/boxscores/202403270CHI.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 8 | 7 | exact | Δ=-1 |
| tov_pct | home | 0.07 | 0.061990789939780376 | 1pct | relErr=11.442% > 1% |

### nba:bdl-15882375 — nba:LAL @ nba:DEN (2023-postseason)

bbref: https://www.basketball-reference.com/boxscores/202404200DEN.html

raw count failures: 1; derived rate failures: 5; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 6 | 4 | exact | Δ=-2 |
| tov_pct | home | 0.054000000000000006 | 0.036818851251840944 | 1pct | relErr=31.817% > 1% |
| ortg | home | 123.5 | 124.88723594767077 | 1pct | relErr=1.123% > 1% |
| pace | home | 92.3 | 91.2823469387755 | 1pct | relErr=1.103% > 1% |
| ortg | away | 111.6 | 112.83671318079027 | 1pct | relErr=1.108% > 1% |
| pace | away | 92.3 | 91.2823469387755 | 1pct | relErr=1.103% > 1% |

### nba:bdl-15881959 — nba:ORL @ nba:CLE (2023-postseason)

bbref: https://www.basketball-reference.com/boxscores/202404200CLE.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 18 | 17 | exact | Δ=-1 |
| tov_pct | home | 0.166 | 0.1585229392017904 | 1pct | relErr=4.504% > 1% |

### nba:bdl-15881961 — nba:IND @ nba:MIL (2023-postseason)

bbref: https://www.basketball-reference.com/boxscores/202404210MIL.html

raw count failures: 2; derived rate failures: 6; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 12 | 10 | exact | Δ=-2 |
| tov_pct | home | 0.115 | 0.09735202492211838 | 1pct | relErr=15.346% > 1% |
| ortg | home | 111.3 | 113.02067609454006 | 1pct | relErr=1.546% > 1% |
| pace | home | 97.9 | 96.44253048780486 | 1pct | relErr=1.489% > 1% |
| tov | away | 13 | 12 | exact | Δ=-1 |
| tov_pct | away | 0.115 | 0.10691375623663578 | 1pct | relErr=7.032% > 1% |
| ortg | away | 96 | 97.46737204483271 | 1pct | relErr=1.529% > 1% |
| pace | away | 97.9 | 96.44253048780486 | 1pct | relErr=1.489% > 1% |

### nba:bdl-15882411 — nba:LAC @ nba:DAL (2023-postseason)

bbref: https://www.basketball-reference.com/boxscores/202404260DAL.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 9 | 8 | exact | Δ=-1 |
| tov_pct | home | 0.087 | 0.07815552950371239 | 1pct | relErr=10.166% > 1% |

### nba:bdl-15885394 — nba:OKC @ nba:NO (2023-postseason)

bbref: https://www.basketball-reference.com/boxscores/202404270NOP.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 21 | 20 | exact | Δ=-1 |
| tov_pct | home | 0.18899999999999997 | 0.18155410312273057 | 1pct | relErr=3.940% > 1% |

### nba:bdl-15882422 — nba:MIL @ nba:IND (2023-postseason)

bbref: https://www.basketball-reference.com/boxscores/202405020IND.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 11 | 10 | exact | Δ=-1 |
| tov_pct | home | 0.106 | 0.0975800156128025 | 1pct | relErr=7.943% > 1% |

### nba:bdl-15896341 — nba:IND @ nba:NY (2023-postseason)

bbref: https://www.basketball-reference.com/boxscores/202405060NYK.html

raw count failures: 2; derived rate failures: 4; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 15 | 14 | exact | Δ=-1 |
| tov_pct | home | 0.138 | 0.1303052866716307 | 1pct | relErr=5.576% > 1% |
| ortg | home | 125.3 | 126.65059450802579 | 1pct | relErr=1.078% > 1% |
| tov | away | 8 | 7 | exact | Δ=-1 |
| tov_pct | away | 0.077 | 0.06772445820433437 | 1pct | relErr=12.046% > 1% |
| ortg | away | 121.2 | 122.46379799536379 | 1pct | relErr=1.043% > 1% |

### nba:bdl-15896618 — nba:IND @ nba:NY (2023-postseason)

bbref: https://www.basketball-reference.com/boxscores/202405140NYK.html

raw count failures: 0; derived rate failures: 0; rates skipped (no bbref ground-truth): 0

All fields within tolerance. ✓

### nba:bdl-15897605 — nba:CLE @ nba:BOS (2023-postseason)

bbref: https://www.basketball-reference.com/boxscores/202405150BOS.html

raw count failures: 1; derived rate failures: 5; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 14 | 12 | exact | Δ=-2 |
| tov_pct | home | 0.141 | 0.12335526315789473 | 1pct | relErr=12.514% > 1% |
| ortg | home | 131.3 | 132.84753883485635 | 1pct | relErr=1.179% > 1% |
| pace | home | 86.1 | 85.05991228070175 | 1pct | relErr=1.208% > 1% |
| ortg | away | 113.9 | 115.21290978598161 | 1pct | relErr=1.153% > 1% |
| pace | away | 86.1 | 85.05991228070175 | 1pct | relErr=1.208% > 1% |

### nba:bdl-15895046 — nba:DEN @ nba:MIN (2023-postseason)

bbref: https://www.basketball-reference.com/boxscores/202405160MIN.html

raw count failures: 0; derived rate failures: 0; rates skipped (no bbref ground-truth): 0

All fields within tolerance. ✓

### nba:bdl-15907488 — nba:LAL @ nba:PHX (2024-regular)

bbref: https://www.basketball-reference.com/boxscores/202410280PHO.html

raw count failures: 2; derived rate failures: 4; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 11 | 10 | exact | Δ=-1 |
| tov_pct | home | 0.10300000000000001 | 0.0945179584120983 | 1pct | relErr=8.235% > 1% |
| pace | home | 97.7 | 96.71347537878789 | 1pct | relErr=1.010% > 1% |
| tov | away | 12 | 11 | exact | Δ=-1 |
| tov_pct | away | 0.105 | 0.09741409847679773 | 1pct | relErr=7.225% > 1% |
| pace | away | 97.7 | 96.71347537878789 | 1pct | relErr=1.010% > 1% |

### nba:bdl-15907727 — nba:PHI @ nba:DET (2024-regular)

bbref: https://www.basketball-reference.com/boxscores/202411300DET.html

raw count failures: 2; derived rate failures: 6; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 17 | 16 | exact | Δ=-1 |
| tov_pct | home | 0.147 | 0.1392272885485555 | 1pct | relErr=5.288% > 1% |
| ortg | home | 95.5 | 97.4775229386027 | 1pct | relErr=2.071% > 1% |
| pace | home | 100.5 | 98.48424242424242 | 1pct | relErr=2.006% > 1% |
| tov | away | 17 | 14 | exact | Δ=-3 |
| tov_pct | away | 0.152 | 0.12881854987118144 | 1pct | relErr=15.251% > 1% |
| ortg | away | 110.5 | 112.70838589775937 | 1pct | relErr=1.999% > 1% |
| pace | away | 100.5 | 98.48424242424242 | 1pct | relErr=2.006% > 1% |

### nba:bdl-15907735 — nba:MIA @ nba:TOR (2024-regular)

bbref: https://www.basketball-reference.com/boxscores/202412010TOR.html

raw count failures: 1; derived rate failures: 4; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 16 | 14 | exact | Δ=-2 |
| tov_pct | home | 0.142 | 0.1263537906137184 | 1pct | relErr=11.018% > 1% |
| ortg | home | 117.7 | 118.90625762480278 | 1pct | relErr=1.025% > 1% |
| pace | home | 101.1 | 100.07883720930232 | 1pct | relErr=1.010% > 1% |
| pace | away | 101.1 | 100.07883720930232 | 1pct | relErr=1.010% > 1% |

### nba:bdl-17195500 — nba:MIL @ nba:OKC (2024-regular)

bbref: https://www.basketball-reference.com/boxscores/202412170OKC.html

raw count failures: 1; derived rate failures: 4; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| pace | home | 96.7 | 95.7017 | 1pct | relErr=1.032% > 1% |
| tov | away | 19 | 17 | exact | Δ=-2 |
| tov_pct | away | 0.17600000000000002 | 0.16049848942598188 | 1pct | relErr=8.808% > 1% |
| ortg | away | 100.3 | 101.35661122007238 | 1pct | relErr=1.053% > 1% |
| pace | away | 96.7 | 95.7017 | 1pct | relErr=1.032% > 1% |

### nba:bdl-15907998 — nba:NY @ nba:PHI (2024-regular)

bbref: https://www.basketball-reference.com/boxscores/202501150PHI.html

raw count failures: 1; derived rate failures: 5; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| ortg | home | 124.3 | 126.23778288661728 | 1pct | relErr=1.559% > 1% |
| pace | home | 86.7 | 85.37347729123154 | 1pct | relErr=1.530% > 1% |
| tov | away | 16 | 13 | exact | Δ=-3 |
| tov_pct | away | 0.142 | 0.11865644395764878 | 1pct | relErr=16.439% > 1% |
| ortg | away | 130.5 | 132.60271311619462 | 1pct | relErr=1.611% > 1% |
| pace | away | 86.7 | 85.37347729123154 | 1pct | relErr=1.530% > 1% |

### nba:bdl-15908774 — nba:MIL @ nba:PHX (2024-regular)

bbref: https://www.basketball-reference.com/boxscores/202503240PHO.html

raw count failures: 0; derived rate failures: 0; rates skipped (no bbref ground-truth): 0

All fields within tolerance. ✓

### nba:bdl-15908821 — nba:SAC @ nba:IND (2024-regular)

bbref: https://www.basketball-reference.com/boxscores/202503310IND.html

raw count failures: 2; derived rate failures: 3; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 13 | 12 | exact | Δ=-1 |
| tov_pct | home | 0.12 | 0.11139992573338285 | 1pct | relErr=7.167% > 1% |
| tov | away | 12 | 11 | exact | Δ=-1 |
| tov_pct | away | 0.10800000000000001 | 0.09956553222302679 | 1pct | relErr=7.810% > 1% |
| ortg | away | 106.7 | 107.76741024531917 | 1pct | relErr=1.000% > 1% |

### nba:bdl-15908848 — nba:GS @ nba:LAL (2024-regular)

bbref: https://www.basketball-reference.com/boxscores/202504030LAL.html

raw count failures: 1; derived rate failures: 5; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 10 | 8 | exact | Δ=-2 |
| tov_pct | home | 0.094 | 0.07683442182097579 | 1pct | relErr=18.261% > 1% |
| ortg | home | 128.3 | 129.76992751668845 | 1pct | relErr=1.146% > 1% |
| pace | home | 90.4 | 89.38896878483835 | 1pct | relErr=1.118% > 1% |
| ortg | away | 136.1 | 137.60087141855757 | 1pct | relErr=1.103% > 1% |
| pace | away | 90.4 | 89.38896878483835 | 1pct | relErr=1.118% > 1% |

### nba:bdl-15908886 — nba:SA @ nba:LAC (2024-regular)

bbref: https://www.basketball-reference.com/boxscores/202504080LAC.html

raw count failures: 2; derived rate failures: 6; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 17 | 15 | exact | Δ=-2 |
| tov_pct | home | 0.145 | 0.1303894297635605 | 1pct | relErr=10.076% > 1% |
| ortg | home | 121.9 | 123.75378805780555 | 1pct | relErr=1.521% > 1% |
| pace | home | 100.1 | 98.58284090909092 | 1pct | relErr=1.516% > 1% |
| tov | away | 17 | 16 | exact | Δ=-1 |
| tov_pct | away | 0.156 | 0.14809329877823027 | 1pct | relErr=5.068% > 1% |
| ortg | away | 116.9 | 118.68191149805942 | 1pct | relErr=1.524% > 1% |
| pace | away | 100.1 | 98.58284090909092 | 1pct | relErr=1.516% > 1% |

### nba:bdl-15908907 — nba:WSH @ nba:CHI (2024-regular)

bbref: https://www.basketball-reference.com/boxscores/202504110CHI.html

raw count failures: 2; derived rate failures: 6; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 13 | 12 | exact | Δ=-1 |
| tov_pct | home | 0.11199999999999999 | 0.10463899546564352 | 1pct | relErr=6.572% > 1% |
| ortg | home | 116.8 | 118.58638395088435 | 1pct | relErr=1.529% > 1% |
| pace | home | 101.8 | 100.34878881987578 | 1pct | relErr=1.426% > 1% |
| tov | away | 18 | 16 | exact | Δ=-2 |
| tov_pct | away | 0.158 | 0.14250089063056645 | 1pct | relErr=9.810% > 1% |
| ortg | away | 87.4 | 88.69065690444292 | 1pct | relErr=1.477% > 1% |
| pace | away | 101.8 | 100.34878881987578 | 1pct | relErr=1.426% > 1% |

### nba:bdl-15908904 — nba:ATL @ nba:PHI (2024-regular)

bbref: https://www.basketball-reference.com/boxscores/202504110PHI.html

raw count failures: 2; derived rate failures: 3; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 15 | 14 | exact | Δ=-1 |
| tov_pct | home | 0.126 | 0.11904761904761905 | 1pct | relErr=5.518% > 1% |
| ortg | home | 109.5 | 110.64649164403444 | 1pct | relErr=1.047% > 1% |
| tov | away | 15 | 14 | exact | Δ=-1 |
| tov_pct | away | 0.125 | 0.11808367071524967 | 1pct | relErr=5.533% > 1% |

### nba:bdl-18421940 — nba:LAC @ nba:DEN (2024-postseason)

bbref: https://www.basketball-reference.com/boxscores/202504190DEN.html

raw count failures: 0; derived rate failures: 0; rates skipped (no bbref ground-truth): 0

All fields within tolerance. ✓

### nba:bdl-18422292 — nba:LAC @ nba:DEN (2024-postseason)

bbref: https://www.basketball-reference.com/boxscores/202504210DEN.html

raw count failures: 0; derived rate failures: 0; rates skipped (no bbref ground-truth): 0

All fields within tolerance. ✓

### nba:bdl-18425162 — nba:CLE @ nba:MIA (2024-postseason)

bbref: https://www.basketball-reference.com/boxscores/202504260MIA.html

raw count failures: 2; derived rate failures: 6; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 17 | 16 | exact | Δ=-1 |
| tov_pct | home | 0.175 | 0.16597510373443983 | 1pct | relErr=5.157% > 1% |
| ortg | home | 96.3 | 97.88069984516346 | 1pct | relErr=1.641% > 1% |
| pace | home | 90.4 | 88.88371266002845 | 1pct | relErr=1.677% > 1% |
| tov | away | 11 | 9 | exact | Δ=-2 |
| tov_pct | away | 0.10400000000000001 | 0.08670520231213873 | 1pct | relErr=16.630% > 1% |
| ortg | away | 137.2 | 139.50812391724446 | 1pct | relErr=1.682% > 1% |
| pace | away | 90.4 | 88.88371266002845 | 1pct | relErr=1.677% > 1% |

### nba:bdl-18436463 — nba:DEN @ nba:OKC (2024-postseason)

bbref: https://www.basketball-reference.com/boxscores/202505070OKC.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | away | 21 | 20 | exact | Δ=-1 |
| tov_pct | away | 0.172 | 0.16518004625041297 | 1pct | relErr=3.965% > 1% |

### nba:bdl-18436465 — nba:OKC @ nba:DEN (2024-postseason)

bbref: https://www.basketball-reference.com/boxscores/202505090DEN.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 16 | 14 | exact | Δ=-2 |
| tov_pct | home | 0.14300000000000002 | 0.12778386272362174 | 1pct | relErr=10.641% > 1% |

### nba:bdl-18435672 — nba:BOS @ nba:NY (2024-postseason)

bbref: https://www.basketball-reference.com/boxscores/202505100NYK.html

raw count failures: 1; derived rate failures: 5; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| ortg | home | 107.1 | 109.60938072263873 | 1pct | relErr=2.343% > 1% |
| pace | home | 86.8 | 84.84675251959686 | 1pct | relErr=2.250% > 1% |
| tov | away | 12 | 8 | exact | Δ=-4 |
| tov_pct | away | 0.11699999999999999 | 0.08123476848090982 | 1pct | relErr=30.569% > 1% |
| ortg | away | 132.4 | 135.53848153874682 | 1pct | relErr=2.370% > 1% |
| pace | away | 86.8 | 84.84675251959686 | 1pct | relErr=2.250% > 1% |

### nba:bdl-18421937 — nba:DET @ nba:NY (2024-postseason)

bbref: https://www.basketball-reference.com/boxscores/202504190NYK.html

raw count failures: 2; derived rate failures: 6; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 11 | 9 | exact | Δ=-2 |
| tov_pct | home | 0.099 | 0.08220679576178297 | 1pct | relErr=16.963% > 1% |
| ortg | home | 122.3 | 124.78341472662801 | 1pct | relErr=2.031% > 1% |
| pace | home | 100.6 | 98.57079185520361 | 1pct | relErr=2.017% > 1% |
| tov | away | 21 | 19 | exact | Δ=-2 |
| tov_pct | away | 0.18100000000000002 | 0.1669595782073814 | 1pct | relErr=7.757% > 1% |
| ortg | away | 111.4 | 113.62392235270192 | 1pct | relErr=1.996% > 1% |
| pace | away | 100.6 | 98.57079185520361 | 1pct | relErr=2.017% > 1% |

### nba:bdl-18441484 — nba:NY @ nba:IND (2024-postseason)

bbref: https://www.basketball-reference.com/boxscores/202505310IND.html

raw count failures: 2; derived rate failures: 4; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 13 | 12 | exact | Δ=-1 |
| tov_pct | home | 0.122 | 0.11389521640091116 | 1pct | relErr=6.643% > 1% |
| ortg | home | 126.2 | 127.49969162865281 | 1pct | relErr=1.030% > 1% |
| tov | away | 18 | 17 | exact | Δ=-1 |
| tov_pct | away | 0.156 | 0.14854945823138763 | 1pct | relErr=4.776% > 1% |
| ortg | away | 109 | 110.15973356715602 | 1pct | relErr=1.064% > 1% |

### nba:bdl-18444561 — nba:OKC @ nba:IND (2024-postseason)

bbref: https://www.basketball-reference.com/boxscores/202506130IND.html

raw count failures: 2; derived rate failures: 6; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 16 | 15 | exact | Δ=-1 |
| tov_pct | home | 0.145 | 0.13696128560993426 | 1pct | relErr=5.544% > 1% |
| ortg | home | 106.4 | 108.62783148392985 | 1pct | relErr=2.094% > 1% |
| pace | home | 97.7 | 95.73973684210527 | 1pct | relErr=2.006% > 1% |
| tov | away | 16 | 13 | exact | Δ=-3 |
| tov_pct | away | 0.145 | 0.12068325287783141 | 1pct | relErr=16.770% > 1% |
| ortg | away | 113.6 | 115.93932014150205 | 1pct | relErr=2.059% > 1% |
| pace | away | 97.7 | 95.73973684210527 | 1pct | relErr=2.006% > 1% |

### nba:bdl-18447026 — nba:GS @ nba:ORL (2025-regular)

bbref: https://www.basketball-reference.com/boxscores/202511180ORL.html

raw count failures: 0; derived rate failures: 0; rates skipped (no bbref ground-truth): 0

All fields within tolerance. ✓

### nba:bdl-18447136 — nba:LAC @ nba:ATL (2025-regular)

bbref: https://www.basketball-reference.com/boxscores/202512030ATL.html

raw count failures: 0; derived rate failures: 0; rates skipped (no bbref ground-truth): 0

All fields within tolerance. ✓

### nba:bdl-20054974 — nba:GS @ nba:POR (2025-regular)

bbref: https://www.basketball-reference.com/boxscores/202512140POR.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 18 | 17 | exact | Δ=-1 |
| tov_pct | home | 0.15 | 0.1431458403502863 | 1pct | relErr=4.569% > 1% |

### nba:bdl-18447244 — nba:DET @ nba:UTAH (2025-regular)

bbref: https://www.basketball-reference.com/boxscores/202512260UTA.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 18 | 17 | exact | Δ=-1 |
| tov_pct | home | 0.151 | 0.14353259034110097 | 1pct | relErr=4.945% > 1% |

### nba:bdl-18447434 — nba:MIN @ nba:UTAH (2025-regular)

bbref: https://www.basketball-reference.com/boxscores/202601200UTA.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 17 | 16 | exact | Δ=-1 |
| tov_pct | home | 0.147 | 0.1398112548060119 | 1pct | relErr=4.890% > 1% |

### nba:bdl-18447444 — nba:TOR @ nba:SAC (2025-regular)

bbref: https://www.basketball-reference.com/boxscores/202601210SAC.html

raw count failures: 2; derived rate failures: 6; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 16 | 14 | exact | Δ=-2 |
| tov_pct | home | 0.141 | 0.12535816618911175 | 1pct | relErr=11.093% > 1% |
| ortg | home | 110.6 | 112.35293721465565 | 1pct | relErr=1.585% > 1% |
| pace | home | 98.5 | 97.01571022727273 | 1pct | relErr=1.507% > 1% |
| tov | away | 11 | 10 | exact | Δ=-1 |
| tov_pct | away | 0.095 | 0.08695652173913043 | 1pct | relErr=8.467% > 1% |
| ortg | away | 123.8 | 125.75282880906413 | 1pct | relErr=1.577% > 1% |
| pace | away | 98.5 | 97.01571022727273 | 1pct | relErr=1.507% > 1% |

### nba:bdl-18447725 — nba:NO @ nba:SAC (2025-regular)

bbref: https://www.basketball-reference.com/boxscores/202603050SAC.html

raw count failures: 1; derived rate failures: 1; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | away | 12 | 11 | exact | Δ=-1 |
| tov_pct | away | 0.098 | 0.09099933818663138 | 1pct | relErr=7.144% > 1% |

### nba:bdl-18447749 — nba:PHI @ nba:CLE (2025-regular)

bbref: https://www.basketball-reference.com/boxscores/202603090CLE.html

raw count failures: 2; derived rate failures: 6; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 10 | 9 | exact | Δ=-1 |
| tov_pct | home | 0.095 | 0.08653846153846154 | 1pct | relErr=8.907% > 1% |
| ortg | home | 121.4 | 123.9662713972647 | 1pct | relErr=2.114% > 1% |
| pace | home | 94.8 | 92.76716860465116 | 1pct | relErr=2.144% > 1% |
| tov | away | 17 | 14 | exact | Δ=-3 |
| tov_pct | away | 0.155 | 0.1309390198279087 | 1pct | relErr=15.523% > 1% |
| ortg | away | 106.6 | 108.87472531411944 | 1pct | relErr=2.134% > 1% |
| pace | away | 94.8 | 92.76716860465116 | 1pct | relErr=2.144% > 1% |

### nba:bdl-18447807 — nba:LAL @ nba:HOU (2025-regular)

bbref: https://www.basketball-reference.com/boxscores/202603160HOU.html

raw count failures: 2; derived rate failures: 6; rates skipped (no bbref ground-truth): 0

| field | team | expected | actual | tol | detail |
|-------|------|----------|--------|-----|--------|
| tov | home | 24 | 22 | exact | Δ=-2 |
| tov_pct | home | 0.21899999999999997 | 0.20446096654275095 | 1pct | relErr=6.639% > 1% |
| ortg | home | 102.1 | 103.7908789107068 | 1pct | relErr=1.656% > 1% |
| pace | home | 90.1 | 88.63977351916374 | 1pct | relErr=1.621% > 1% |
| tov | away | 12 | 11 | exact | Δ=-1 |
| tov_pct | away | 0.114 | 0.10508215513947267 | 1pct | relErr=7.823% > 1% |
| ortg | away | 110.9 | 112.81617272902912 | 1pct | relErr=1.728% > 1% |
| pace | away | 90.1 | 88.63977351916374 | 1pct | relErr=1.621% > 1% |

### nba:bdl-18447469 — nba:DEN @ nba:MEM (2025-regular)

bbref: https://www.basketball-reference.com/boxscores/202603180MEM.html

raw count failures: 0; derived rate failures: 0; rates skipped (no bbref ground-truth): 0

All fields within tolerance. ✓

## Aggregate

Entries audited: 50 / 50
Skipped (missing nba_game_box_stats row): 0
Total raw count failures: 57
Total derived rate failures: 139
Total rates skipped (no ground-truth): 0

## Disposition

Pass-B candidate (N=50). Status: **FAIL** — 57 raw-count failures; 139 derived-rate failures.
