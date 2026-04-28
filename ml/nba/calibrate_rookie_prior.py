#!/usr/bin/env python3
"""
Rookie BPM prior calibration — Plans/nba-cold-start-prior.md §Rookie prior calibration.

Reads:
  data/bbref-player-bpm/{year}.json   — per-player BPM + MP by season
  data/bbref-draft/{year}.json        — draft order by year

Computes median BPM and median MPG per draft bin, calibrated on draft classes
2010–2021, validated on 2022–2024.

Minimum-minutes filter: ≥500 MP in the rookie season (per plan).

Prints a table of values to commit to Plans/nba-cold-start-prior.md.

Run: /usr/bin/python3 ml/nba/calibrate_rookie_prior.py
"""

import json
import pathlib
import statistics

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BPM_DIR = REPO_ROOT / "data" / "bbref-player-bpm"
DRAFT_DIR = REPO_ROOT / "data" / "bbref-draft"

MIN_MP = 500  # minimum rookie-season minutes to include in calibration

# Draft bins as defined in the plan.
BINS = [
    ("Picks 1–5",    range(1, 6)),
    ("Picks 6–14",   range(6, 15)),
    ("Picks 15–30",  range(15, 31)),
    ("Second round", range(31, 100)),
    ("Undrafted",    None),          # None = players with no draft entry
]

CALIBRATION_DRAFT_YEARS = list(range(2010, 2022))   # draft classes 2010-2021
VALIDATION_DRAFT_YEARS  = list(range(2022, 2025))   # draft classes 2022-2024


def load_bpm(year: int) -> dict[str, dict]:
    """Load player BPM data for a given bbref year. Returns {bbref_id: row}."""
    path = BPM_DIR / f"{year}.json"
    if not path.exists():
        return {}
    with open(path) as f:
        rows = json.load(f)
    return {r["bbref_id"]: r for r in rows}


def load_draft(year: int) -> dict[str, dict]:
    """Load draft data for a given year. Returns {bbref_id: pick_info}."""
    path = DRAFT_DIR / f"{year}.json"
    if not path.exists():
        return {}
    with open(path) as f:
        picks = json.load(f)
    return {p["bbref_id"]: p for p in picks}


def bin_for_pick(pick: int) -> str:
    for label, rng in BINS:
        if rng is None:
            continue
        if pick in rng:
            return label
    return "Second round" if pick >= 31 else "Unknown"


def compute_bin_stats(
    draft_years: list[int],
) -> dict[str, dict]:
    """
    For each draft class in draft_years:
    - Find each player's first NBA season (draft_year → bbref year = draft_year + 1)
    - Apply ≥MIN_MP filter
    - Assign to draft bin
    - Collect BPM and MPG (mp / games approximated as mp / 82 * games is unavailable,
      so we use total_mp / 82 as an approximation for MPG across a full season,
      or total_mp directly divided by games if available)

    bbref advanced stats don't include games per player directly in the JSON
    we collect — we have total MP. We approximate MPG = mp / g where g is
    estimated from mp assuming ~30 MPG average (good enough for bin medians).
    Instead, we just report median total_mp / 82 as the per-game-equivalent.
    """
    bin_bpm: dict[str, list[float]] = {label: [] for label, _ in BINS}
    bin_mp: dict[str, list[float]] = {label: [] for label, _ in BINS}

    all_drafted_ids: set[str] = set()

    for draft_year in draft_years:
        draft = load_draft(draft_year)
        bpm_data = load_bpm(draft_year + 1)  # rookie season = year after draft

        if not draft:
            print(f"  WARNING: no draft data for {draft_year}")
            continue
        if not bpm_data:
            print(f"  WARNING: no BPM data for {draft_year + 1} (rookie season)")
            continue

        for bbref_id, pick_info in draft.items():
            all_drafted_ids.add(bbref_id)
            if bbref_id not in bpm_data:
                continue  # didn't play their rookie year
            row = bpm_data[bbref_id]
            if row["mp"] < MIN_MP:
                continue  # minimum minutes filter

            label = bin_for_pick(pick_info["pick"])
            bin_bpm[label].append(row["bpm"])
            bin_mp[label].append(row["mp"] / 82)  # approx MPG (season-equivalent)

        # Undrafted players: in bpm_data but NOT in draft (and not in any other year's draft).
        # We approximate by checking against all drafted IDs across all calibration years.
        # (Computed after all draft years are processed; handled in a second pass below.)

    # Second pass: undrafted players (in bpm but never appear in any draft file)
    all_draft_ids_union: set[str] = set()
    for y in draft_years:
        d = load_draft(y)
        all_draft_ids_union.update(d.keys())

    for y in draft_years:
        bpm_data = load_bpm(y + 1)
        draft_this_year = load_draft(y)
        for bbref_id, row in bpm_data.items():
            if bbref_id in all_draft_ids_union:
                continue  # was drafted — handled above
            if row["mp"] < MIN_MP:
                continue
            bin_bpm["Undrafted"].append(row["bpm"])
            bin_mp["Undrafted"].append(row["mp"] / 82)

    result = {}
    for label, _ in BINS:
        bpms = bin_bpm[label]
        mps = bin_mp[label]
        result[label] = {
            "n": len(bpms),
            "median_bpm": round(statistics.median(bpms), 2) if bpms else None,
            "p25_bpm": round(sorted(bpms)[len(bpms) // 4], 2) if len(bpms) >= 4 else None,
            "p75_bpm": round(sorted(bpms)[3 * len(bpms) // 4], 2) if len(bpms) >= 4 else None,
            "median_mpg": round(statistics.median(mps), 1) if mps else None,
        }
    return result


def print_table(label: str, stats: dict[str, dict]) -> None:
    print(f"\n{'='*60}")
    print(f"{label}")
    print(f"{'='*60}")
    print(f"{'Bin':<18} {'N':>4}  {'Median BPM':>10}  {'IQR BPM':>14}  {'Median MPG':>10}")
    print("-" * 60)
    for bin_label, s in stats.items():
        if s["n"] == 0:
            print(f"{bin_label:<18} {'0':>4}  {'—':>10}  {'—':>14}  {'—':>10}")
            continue
        iqr = f"[{s['p25_bpm']}, {s['p75_bpm']}]" if s["p25_bpm"] is not None else "—"
        print(
            f"{bin_label:<18} {s['n']:>4}  "
            f"{s['median_bpm']:>10.2f}  "
            f"{iqr:>14}  "
            f"{s['median_mpg']:>10.1f}"
        )


def check_data_available() -> bool:
    missing = []
    for y in CALIBRATION_DRAFT_YEARS + VALIDATION_DRAFT_YEARS:
        if not (BPM_DIR / f"{y + 1}.json").exists():
            missing.append(f"BPM {y + 1}")
        if not (DRAFT_DIR / f"{y}.json").exists():
            missing.append(f"Draft {y}")
    if missing:
        print("MISSING data files (run scripts/scrape-bbref-player-bpm.ts first):")
        for m in missing[:10]:
            print(f"  {m}")
        if len(missing) > 10:
            print(f"  ... and {len(missing) - 10} more")
        return False
    return True


def main() -> None:
    print("=" * 60)
    print("Rookie BPM prior calibration")
    print(f"Minimum MP filter: {MIN_MP}")
    print(f"Calibration draft classes: {CALIBRATION_DRAFT_YEARS[0]}–{CALIBRATION_DRAFT_YEARS[-1]}")
    print(f"Validation draft classes:  {VALIDATION_DRAFT_YEARS[0]}–{VALIDATION_DRAFT_YEARS[-1]}")
    print("=" * 60)

    if not check_data_available():
        print("\nHalting — scrape data first.")
        return

    cal_stats = compute_bin_stats(CALIBRATION_DRAFT_YEARS)
    val_stats = compute_bin_stats(VALIDATION_DRAFT_YEARS)

    print_table("CALIBRATION (draft classes 2010–2021)", cal_stats)
    print_table("VALIDATION  (draft classes 2022–2024)", val_stats)

    print("\n" + "=" * 60)
    print("VALUES TO COMMIT TO Plans/nba-cold-start-prior.md")
    print("(Calibration set — these are the plan values)")
    print("=" * 60)
    print()
    print("| Draft range     | Median BPM | Projected MPG |")
    print("|---|---|---|")
    for bin_label, s in cal_stats.items():
        bpm = f"{s['median_bpm']:.2f}" if s["median_bpm"] is not None else "N/A"
        mpg = f"{s['median_mpg']:.1f}" if s["median_mpg"] is not None else "N/A"
        print(f"| {bin_label:<15} | {bpm:>10} | {mpg:>13} |")

    print()
    print("Commit these values to the plan table before writing any implementation code.")


if __name__ == "__main__":
    main()
