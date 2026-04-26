# Phase-3 Game-Type Handling Decision Matrix

Generated: 2026-04-26T21:30:22.576Z
Convention report: 2026-04-26T21:29:59.882Z

## pm.6 evidence bar

- **≥2 validated games per stratum**: required per pm.6(a)
- **≥5 total validated games**: required per pm.6(b)
- **Adversarial selection**: ≥1 per stratum chosen by dissenting expert, not proponent — required per pm.6(c)
- **Named falsification test**: required per pm.5/pm.6(d) for any stratum with mismatches

Total validated across all strata: **22** (need ≥5: ✓ MET)

## Decision matrix

| Stratum | Validated | Matched | Mismatch | pm.6(a) | Disposition |
|---|---|---|---|---|---|
| regular | 4 | 4 | 0 | ✓ | ✓ accept-as-is |
| postseason | 4 | 4 | 0 | ✓ | ✓ accept-as-is |
| nba_finals | 2 | 2 | 0 | ✓ | ✓ accept-as-is |
| conference_finals | 2 | 2 | 0 | ✓ | ✓ accept-as-is |
| play_in | 2 | 2 | 0 | ✓ | ✓ accept-as-is |
| cup_pool | 2 | 2 | 0 | ✓ | ✓ accept-as-is |
| cup_knockout | 2 | 1 | 1 | ✓ | ✗ MISMATCH — requires falsification test |
| marquee_broadcast | 2 | 2 | 0 | ✓ | ✓ accept-as-is |
| rescheduled_2022_23 | 0 | 0 | 0 | ✗ | — NO DATA |
| ot | 2 | 2 | 0 | ✓ | ✓ accept-as-is |

## Per-stratum details

### regular

**Disposition**: ✓ accept-as-is

- All 4 validated games match (bbref Tm TOV == ESPN tov).
- Adversarial selection: populate bbref-convention-manifest.json with at least 1 per-stratum entry chosen adversarially (not just confirming games).

### postseason

**Disposition**: ✓ accept-as-is

- All 4 validated games match (bbref Tm TOV == ESPN tov).
- Adversarial selection: populate bbref-convention-manifest.json with at least 1 per-stratum entry chosen adversarially (not just confirming games).

### nba_finals

**Disposition**: ✓ accept-as-is

- All 2 validated games match (bbref Tm TOV == ESPN tov).
- Adversarial selection: populate bbref-convention-manifest.json with at least 1 per-stratum entry chosen adversarially (not just confirming games).

### conference_finals

**Disposition**: ✓ accept-as-is

- All 2 validated games match (bbref Tm TOV == ESPN tov).
- Adversarial selection: populate bbref-convention-manifest.json with at least 1 per-stratum entry chosen adversarially (not just confirming games).

### play_in

**Disposition**: ✓ accept-as-is

- All 2 validated games match (bbref Tm TOV == ESPN tov).
- Adversarial selection: populate bbref-convention-manifest.json with at least 1 per-stratum entry chosen adversarially (not just confirming games).

### cup_pool

**Disposition**: ✓ accept-as-is

- All 2 validated games match (bbref Tm TOV == ESPN tov).
- Adversarial selection: populate bbref-convention-manifest.json with at least 1 per-stratum entry chosen adversarially (not just confirming games).

### cup_knockout

**Disposition**: ✗ MISMATCH — requires falsification test

- 1 games show bbref TOV ≠ ESPN tov. Requires falsification test before finalizing disposition.
- Named falsification test on record (see below).

**Named falsification test (pm.5):**

> v5-on-Cup-KO vs v5-on-regular-season-same-month Brier comparison; reject (b) drop if Δ Brier > 0.02. Run scripts/falsify-cup-knockout-disposition.ts; cite docs/cup-knockout-disposition-evidence.md.

### marquee_broadcast

**Disposition**: ✓ accept-as-is

- All 2 validated games match (bbref Tm TOV == ESPN tov).
- Adversarial selection: populate bbref-convention-manifest.json with at least 1 per-stratum entry chosen adversarially (not just confirming games).

### rescheduled_2022_23

**Disposition**: — NO DATA

- All entries are TODO — populate manifest before deciding.

### ot

**Disposition**: ✓ accept-as-is

- All 2 validated games match (bbref Tm TOV == ESPN tov).
- Adversarial selection: populate bbref-convention-manifest.json with at least 1 per-stratum entry chosen adversarially (not just confirming games).

## Action items before Phase 3 model code

- Run falsification test for **cup_knockout** (mismatch detected). See named test above.
- Populate manifest for **rescheduled_2022_23** (no data at all — all entries are TODO).

## Cross-references

- Convention report: `data/bbref-convention-report.json`
- Manifest: `data/bbref-convention-manifest.json`
- Cup-KO falsification evidence: `docs/cup-knockout-disposition-evidence.md`
- Plan: Plans/nba-learned-model.md addendum v11 §"Pre-flight tooling" #5
