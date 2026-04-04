# Sports Data Platform — Design System

## Color Palette

### Base
| Token | Value | Usage |
|-------|-------|-------|
| `--bg-page` | `#0a0a0a` | Page background |
| `--bg-surface` | `#111111` | Cards, panels |
| `--bg-elevated` | `#1a1a1a` | Tooltips, popovers |
| `--text-primary` | `#e5e5e5` | Body text |
| `--text-secondary` | `#a3a3a3` | Labels, metadata |
| `--border` | `#262626` | Dividers, card borders |

### Sport Accents
| Sport | Color | Token |
|-------|-------|-------|
| NFL | `#013369` | `--sport-nfl` |
| NBA | `#1d428a` | `--sport-nba` |
| MLB | `#002d72` | `--sport-mlb` |
| NHL | `#000000` | `--sport-nhl` |
| MLS | `#80a83b` | `--sport-mls` |

### Semantic
| Token | Value | Usage |
|-------|-------|-------|
| `--gate-clear` | `#3fb950` | Gate passed, positive signals |
| `--gate-warn` | `#d29922` | Warnings, approaching thresholds |
| `--gate-fail` | `#f85149` | Gate blocked, errors |
| `--confidence-high` | `#3fb950` | >80% confidence |
| `--confidence-mid` | `#d29922` | 60-80% confidence |
| `--confidence-low` | `#f85149` | <60% confidence |

## Typography
- **UI text**: `system-ui, -apple-system, sans-serif`
- **Stats/metrics**: `SF Mono, Cascadia Code, Fira Code, monospace`
- **Scale**: 12px labels, 14px body, 16px headings, 20px section titles, 24px page titles

## Confidence Visualization
- **Gradient bar**: Horizontal bar filled proportionally (0-100%)
  - Color transitions: red (0-40%) → amber (40-70%) → green (70-100%)
  - Never raw percentages alone — always pair with gradient bar
- **Provenance badge**: Small dots (up to 3) that fill in as sources confirm data
  - Empty circle = source not yet checked
  - Filled circle = source confirms
  - X circle = source conflicts

## Research Trail (Ratchet Iterations)
- Collapsible panel per prediction
- Each iteration: one line showing hypothesis change, metric delta, kept/reverted icon
- Kept iterations: green checkmark
- Reverted iterations: amber revert arrow
- Max 3 levels deep in default view; "Show all N iterations" link for full history

## Dashboard Components
- **Prediction Card**: Sport icon, teams, claim, confidence bar, provenance dots, collapsible trail
- **Scrape Health**: Background indicator, green/amber/red per source, last-updated timestamp
- **Hypothesis Tracker**: List of active hypotheses with iteration count and current best metric
- **Gate Log**: Timeline of recent gate results (CLEAR/WARN/FAIL) with expandable details

## Anti-Patterns (never do)
- No border-radius > 4px
- No box-shadows
- No gradients on backgrounds (gradient bars for data visualization only)
- No skeleton loaders
- No modals for details (use inline expansion)
