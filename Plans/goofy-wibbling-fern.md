# Jon Bois-Style Sports Data Visualization Plan (Council-Approved)

## Context

Jon Bois-inspired visualization for the sports data platform. Council reviewed over 3 rounds with unanimous convergence on key modifications. The core insight: Bois makes spreadsheets feel sacred. The aesthetic is anti-polish, not dark-dashboard.

## Design Principles (Council-Validated)

1. **White/light background (#f8f8f8)** — NOT dark theme. Google Sheets sterile energy. Mundane tools revealing extraordinary stories.
2. **Roboto/Arial typography** — deliberately unstyled, default Google Docs feel
3. **Simple charts carrying surprising weight** — scatter plots, timelines, histograms
4. **Outliers are the heroes** — the weird, the absurd, the "what are the odds?"
5. **Scroll-driven narrative** — no tabs, no sidebar, just down
6. **Isolated spotlight moments** — zoom into one data point and just sit there
7. **Pacing as punctuation** — 300px standard, 600px major reveals, empty space between

## Architecture

```
┌──────────────────────────────────────────────────────┐
│          SCROLL-DRIVEN WEB FRONTEND                   │
│  Scrollama │ Observable Plot │ White/Roboto aesthetic  │
├──────────────────────────────────────────────────────┤
│          "INTERESTING THINGS" DETECTOR                 │
│  3 algorithms: Streaks │ Margin Outliers │ Mediocrity │
├──────────────────────────────────────────────────────┤
│       (existing) DATA + ORCHESTRATION                 │
│  SQLite │ Scrapers │ Ratchet │ Gates │ Logging        │
└──────────────────────────────────────────────────────┘
```

## Finding Interface (Council-Enriched)

```typescript
interface Finding {
  id: string;
  type: FindingType;
  headline: string;
  detail: string;
  surpriseScore: number;      // 0-1
  spotlight: boolean;          // "sit with this one moment"
  temporalAnchor: {            // when did this happen
    startDate: string;
    endDate?: string;
    season?: string;
  };
  comparisonBaseline: {        // what's normal
    metric: string;
    leagueAverage: number;
    thisValue: number;
  };
  narrativeHint: string;       // how to frame this in scroll text
  data: unknown;
  chartType: ChartType;
  sport: Sport;
}
```

## 3 Detector Algorithms (Council-Approved Scope)

| # | Detector | What It Finds | Ready Now? |
|---|----------|--------------|------------|
| 1 | **Streak Finder** | Win/loss streaks of 8+ games, alternating W-L patterns of 10+ | Yes — 3,883 NBA games |
| 4 | **Margin Outlier** | Games beyond 2.5σ in margin distribution (blowouts + nail-biters) | Yes — needs pace adjustment in sessions 6-7 |
| 6 | **Mediocrity Detector** | Most .500 teams, alternating records, cursed consistency | Yes — 3 seasons of data |

**Deferred:** Spread Buster (#2), Over/Under Pattern (#5) — odds data too thin. Home Court Anomaly (#3) — needs post-bubble baseline correction. Convergence Finder (#7) — needs null distribution.

## 5 Visualizations (Council-Modified)

### Viz 1: "What Does a Blowout Look Like?" Margin Histogram
- **Start with the simplest shape** (council reordered — histogram first, not scatter)
- Bins of 3 points, bars build from center outward
- Camera zooms into tails, annotations on extremes

### Viz 2: "The Home Court Question" Accumulative Timeline
- Cumulative (home wins - away wins) over season
- Annotate the flat spots and dips

### Viz 3: "Who Is The Most .500 Team?" Streak Chart
- 30 team rows, W/L colored segments
- Alternating-pattern team highlighted last with probability callout

### Viz 4: "Every NBA Game" Scatter Plot (THE CLIMAX)
- Spread vs actual margin, 3,883 dots
- Builds in chronologically, outlier annotations reveal one by one
- **This is the Bois moment** — the accumulative build to revelation

### Viz 5: Single-Team Deep Drill-Down (REPLACED cross-sport)
- One team's entire season as a scrollable timeline
- Every game as a dot on a line, wins above / losses below
- Obsessive depth on one subject — more Bois than shallow breadth

## Scroll Narrative Structure

```
[SECTION 1: The Landscape]
  "This season, 1,230 NBA games were played."
  → Margin histogram builds in (Viz 1)

[SECTION 2: The Shape of Normal]
  "The average game was decided by 9.3 points."
  → Median line appears, distribution labeled

[SECTION 3: The Home Court]
  → Accumulative timeline draws left to right (Viz 2)
  → Pauses at interesting inflection points

[SECTION 4-N: Findings by Surprise Score]
  → Each finding: 300px standard, 600px for spotlight moments
  → Chart zooms/highlights per finding
  → Isolated single-dot moments with just text

[CLIMAX: Every Game at Once]
  → Scatter plot builds (Viz 4), 3,883 dots
  → All highlighted findings visible simultaneously

[CLOSE: One Team's Story]
  → Deep drill-down (Viz 5), the human scale
  → "This was their season."
```

## Tech Stack (Council-Trimmed)

| Library | Purpose |
|---------|---------|
| **Observable Plot** | Charts (bundles D3 internally) |
| **Scrollama** | Scroll-driven narrative triggers |
| **Vite** | Dev server + bundling |

**Dropped:** d3-scale, d3-transition (redundant with Observable Plot). No React, no Three.js, no Chart.js.

## File Structure

```
src/analysis/
  interesting.ts          # 3 detector algorithms → Finding[]

src/viz/
  server.ts               # Vite dev server + data API
  narrative.ts             # Finding[] → ScrollStep[] with pacing rules
  data-api.ts              # HTTP JSON endpoints for chart data
  manifest.ts              # Auto-generated Finding→scroll segment mapping

web/
  index.html               # Single scroll page, white background
  main.ts                  # Scrollama setup, chart orchestration
  style.css                # White theme, Roboto, sterile grid
  charts/
    histogram.ts           # Viz 1: margin distribution
    timeline.ts            # Viz 2: accumulative home court
    streaks.ts             # Viz 3: streak chart
    scatter.ts             # Viz 4: every game (climax)
    drilldown.ts           # Viz 5: single-team season
  scroll.ts                # Scrollama integration
```

## Session Breakdown (7 Sessions)

| Session | Work | Gate |
|---------|------|------|
| **1-2** | Pipeline + Algorithm 1 (streaks) + white aesthetic scaffold. Validate against known historical streaks. ONE detector end-to-end before anything else. | Council reviews detector output |
| **3** | Algorithms 4 + 6 (margins, mediocrity). Finding interface stabilized. | Council reviews findings quality |
| **4-5** | Scroll engine, viz components, manifest-driven segments | Council reviews implementation |
| **6-7** | Polish, spotlight animations, pacing, pace-adjusted margin normalization | Council reviews final experience |

## Open Risk

**Pace-adjusted margin:** A 140-130 game and a 95-85 game both register as 10-point margins but represent different phenomena. Must normalize by game pace in sessions 6-7, or the margin detector surfaces false positives.

## Verification

- `npm run findings nba` produces ranked findings from 3 detectors
- `npm run viz` launches Vite, renders white-background scroll page
- Scroll drives chart transitions with correct pacing
- At least 3 spotlight moments where the page pauses on a single data point
- Charts look like Google Sheets, not Bloomberg terminal

## Parking Lot (Future Consideration)

| Idea | When to Revisit | Notes |
|------|----------------|-------|
| **Figma** | If we build a full UI system beyond scroll narrative | Good for component libraries, design tokens, handoff — overkill for anti-design aesthetic but valuable if platform grows into a multi-page app |
| **Observable Notebooks** | Session 1 prototyping | Prototype charts live with real data, export to Observable Plot code. The chart IS the mockup. |
| **Storybook** | If reusable chart components emerge | Preview chart components in isolation |
| **Excalidraw** | Scroll layout wireframing | Hand-drawn-looking wireframes match anti-polish vibe |
| **Programmatic design tools (Penpot, Plasmic)** | If we need collaborative design with non-devs | Open-source Figma alternatives with code export |
