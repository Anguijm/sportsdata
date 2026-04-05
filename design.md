# Sports Data Platform — Design System

## Two Contexts

This platform has two visual contexts with different aesthetics:

### CLI (Terminal) — Dark Theme
The CLI tools (status, inspect, scrape output) use the terminal's dark background with Unicode box-drawing tables.

### Web Visualization — Jon Bois Aesthetic (Council-Approved)
The scroll-driven data visualization uses a **white/light background** inspired by Jon Bois' Google Sheets energy. The council unanimously rejected the dark theme for web viz — the power comes from mundane tools revealing extraordinary stories.

## Web Visualization Color Palette

### Base (Jon Bois Aesthetic)
| Token | Value | Usage |
|-------|-------|-------|
| `--bg-page` | `#f8f8f8` | Page background — sterile, Google Sheets white |
| `--bg-surface` | `#ffffff` | Chart backgrounds |
| `--bg-elevated` | `#f0f0f0` | Annotation backgrounds |
| `--text-primary` | `#1a1a1a` | Body text, narrative |
| `--text-secondary` | `#666666` | Axis labels, metadata |
| `--text-data` | `#333333` | Data point annotations |
| `--border` | `#e0e0e0` | Minimal grid lines (use sparingly) |
| `--highlight` | `#e63946` | Outlier highlights — the surprising dots |

### Sport Accents
| Sport | Color | Token |
|-------|-------|-------|
| NFL | `#013369` | `--sport-nfl` |
| NBA | `#1d428a` | `--sport-nba` |
| MLB | `#002d72` | `--sport-mlb` |
| NHL | `#2a2a2a` | `--sport-nhl` |
| MLS | `#80a83b` | `--sport-mls` |
| EPL | `#3d195b` | `--sport-epl` |

### Semantic
| Token | Value | Usage |
|-------|-------|-------|
| `--win` | `#2d6a4f` | Win streaks, positive outcomes |
| `--loss` | `#e63946` | Loss streaks, negative outcomes |
| `--neutral` | `#adb5bd` | Average, expected, unremarkable |
| `--spotlight` | `#e63946` | THE outlier dot — the hero of the story |

## Typography (Web)

| Context | Font | Why |
|---------|------|-----|
| **Narrative text** | `Roboto, Arial, sans-serif` | Deliberately unstyled, Google Docs energy |
| **Data labels** | `Roboto Mono, monospace` | Monospace for alignment in charts |
| **Headlines** | `Roboto, Arial, sans-serif` | Same as body — no typographic hierarchy drama |

**Scale**: 14px body, 13px data labels, 18px section headers, 24px page title. Deliberately understated.

## Chart Design Principles

1. **Google Sheets energy** — charts should look like they were made in a spreadsheet
2. **Minimal grid** — prefer no grid lines; if needed, light #e0e0e0 only on Y-axis
3. **Outlier annotations** — every highlighted dot gets a human-readable text callout
4. **Accumulative builds** — charts build over scroll time, not all-at-once
5. **Spotlight moments** — zoom into one data point and sit there. The isolation IS the story.
6. **No tooltips** — if data needs to be seen, put it directly on the chart as text

## Scroll Pacing

| Context | Scroll Distance | Usage |
|---------|----------------|-------|
| Standard transition | 300px | Between findings |
| Major reveal | 600px | Spotlight moments, climactic charts |
| Breathing room | 200px empty | Between sections — silence as punctuation |

## Confidence Visualization (Predictions Layer)
- **Gradient bar**: Horizontal, filled proportionally (0-100%)
  - Color: neutral (0-40%) → amber (40-70%) → win-green (70-100%)
- **Provenance dots**: Up to 3 dots (empty/filled/X for unchecked/confirmed/conflict)

## Research Trail (Ratchet Iterations)
- Collapsible panel per prediction
- Kept iterations: green checkmark, reverted: red arrow
- Max 3 visible by default

## Anti-Patterns (never do)
- No border-radius > 4px
- No box-shadows
- No background gradients (gradient bars for data only)
- No skeleton loaders
- No modals (use inline expansion)
- No tooltips (annotate directly)
- No dark background on web visualizations
- No "polished dashboard" energy — this should feel like a spreadsheet that found something incredible
