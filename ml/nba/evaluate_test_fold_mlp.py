#!/usr/bin/env python3
"""
Phase 3 step 8b — test-fold evaluation (MLP, test-fold touch #2).

Evaluates the calibrated 20-seed MLP ensemble against the v5 incumbent
on the 2025-26 test fold. This is touch #2; counter must be exactly 1 at entry.

Identical gate framework as evaluate_test_fold.py (LightGBM touch #1):
  Gate D  — AUC sanity + unconditional mean
  Rule 1  — Brier beat ≥ 0.010 absolute + 95% block-bootstrap CI below zero
  Rule 2  — Calibration: ECE (MLP) ≤ ECE (v5)
  Rule 3  — Margin model parity: N/A
  Rule 4  — max|bin_resid| ≤ max(0.05, v5_max + 0.02)
  Rule 5  — Shadow parity: deferred (step 9)
  Rule 6  — explain-prediction.ts: deferred (step 10)

Council mitigations (plan review, addendum v16):
  - counter == 1 asserted at entry (not 0)
  - Same diagnostic partitions as evaluate_test_fold.py
  - Description updated to "step8b MLP test-fold evaluation"
  - BatchNorm predict-and-average: each model in eval() mode independently

Run:
    /usr/bin/python3 ml/nba/evaluate_test_fold_mlp.py

    The commit that introduces this run MUST include council-co-sign attestation.
"""

from __future__ import annotations

import json
import math
import pathlib
import sys
from datetime import date as Date

import numpy as np
import torch
from sklearn.metrics import roc_auc_score

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from ml.nba.features import (
    FeatureConfig, NormParams, TEST_FOLD_SEASONS, build_test_fold_tensor,
)
from ml.nba.infer import _build_fitted_config
from ml.nba.train_mlp import score_mlp

DB_PATH = REPO_ROOT / "data" / "sqlite" / "sportsdata.db"
MLP_CAL_PARAMS = REPO_ROOT / "ml" / "nba" / "configs" / "mlp-calibration-params.json"
COUNTER_PATH = REPO_ROOT / "ml" / "nba" / "test-fold-touch-counter.json"
AUDIT_LOG = REPO_ROOT / "ml" / "nba" / "test-fold-touch-audit.log"
RESULTS_PATH = REPO_ROOT / "ml" / "nba" / "configs" / "step8b-test-fold-results-mlp.json"
MLP_MODELS_DIR = REPO_ROOT / "ml" / "nba" / "results" / "mlp-winner" / "models"

TRAINING_AS_OF = "2026-04-27T00:00:00Z"
B_BOOTSTRAP = 10_000

BRIER_BEAT_FLOOR = 0.010
GATE_D_MEAN_TOL = 0.02
RULE4_MAX_BIN_RESID_ABS = 0.05
RULE4_INCUMBENT_MARGIN = 0.02

V5_SCALE_NBA = 0.10
V5_HOME_ADV_NBA = 2.25
V5_BASE_RATE_NBA = 0.57
V5_MIN_GAMES = 5


# ---------------------------------------------------------------------------
# Shared helpers (identical to evaluate_test_fold.py)
# ---------------------------------------------------------------------------

def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _v5_predict(home_games: int, home_pts_for: float, home_pts_against: float,
                away_games: int, away_pts_for: float, away_pts_against: float) -> float:
    if home_games < V5_MIN_GAMES or away_games < V5_MIN_GAMES:
        return V5_BASE_RATE_NBA
    home_diff = (home_pts_for - home_pts_against) / home_games
    away_diff = (away_pts_for - away_pts_against) / away_games
    x = V5_SCALE_NBA * ((home_diff - away_diff) + V5_HOME_ADV_NBA)
    return max(0.15, min(0.85, _sigmoid(x)))


def _get_team_season_stats(conn, team_id: str,
                           game_date: str, year_prefix: str) -> tuple[int, float, float]:
    import sqlite3
    sql = """
        SELECT
            COUNT(*) AS games,
            SUM(CASE WHEN g.home_team_id = ? THEN gr.home_score ELSE gr.away_score END) AS pts_for,
            SUM(CASE WHEN g.home_team_id = ? THEN gr.away_score ELSE gr.home_score END) AS pts_against
        FROM game_results gr
        JOIN games g ON g.id = gr.game_id
        WHERE g.sport = 'nba'
          AND (g.home_team_id = ? OR g.away_team_id = ?)
          AND g.date < ?
          AND (g.season = (? || '-regular') OR g.season = (? || '-postseason'))
    """
    row = conn.execute(sql, (team_id, team_id, team_id, team_id,
                             game_date, year_prefix, year_prefix)).fetchone()
    if row is None or row[0] == 0:
        return 0, 0.0, 0.0
    return int(row[0]), float(row[1] or 0), float(row[2] or 0)


def _compute_v5_on_games(game_ids: list[str]) -> np.ndarray:
    import sqlite3
    conn = sqlite3.connect(str(DB_PATH))
    placeholders = ",".join("?" * len(game_ids))
    rows = conn.execute(
        f"SELECT g.id, g.date, g.home_team_id, g.away_team_id, g.season "
        f"FROM games g WHERE g.id IN ({placeholders}) ORDER BY g.date ASC, g.id",
        game_ids,
    ).fetchall()
    meta = {r[0]: {"date": r[1], "home_team_id": r[2], "away_team_id": r[3], "season": r[4]}
            for r in rows}

    preds = []
    for gid in game_ids:
        m = meta[gid]
        year_prefix = m["season"].split("-")[0]
        h_games, h_for, h_against = _get_team_season_stats(
            conn, m["home_team_id"], m["date"], year_prefix)
        a_games, a_for, a_against = _get_team_season_stats(
            conn, m["away_team_id"], m["date"], year_prefix)
        preds.append(_v5_predict(h_games, h_for, h_against, a_games, a_for, a_against))
    conn.close()
    return np.array(preds, dtype=float)


def _block_labels(game_ids: list[str]) -> np.ndarray:
    import sqlite3
    conn = sqlite3.connect(str(DB_PATH))
    placeholders = ",".join("?" * len(game_ids))
    rows = conn.execute(
        f"SELECT g.id, g.date, g.home_team_id FROM games g WHERE g.id IN ({placeholders})",
        game_ids,
    ).fetchall()
    conn.close()
    meta = {r[0]: (r[1], r[2]) for r in rows}
    labels = []
    for gid in game_ids:
        date_str, home_team = meta[gid]
        d = Date.fromisoformat(date_str)
        iso_week = d.isocalendar()[1]
        labels.append(f"{home_team}:{iso_week}")
    return np.array(labels)


def _block_bootstrap_ci(values: np.ndarray, block_labels: np.ndarray,
                         B: int, rng: np.random.Generator,
                         alpha: float = 0.05) -> tuple[float, float, float]:
    unique_blocks = np.unique(block_labels)
    n_blocks = len(unique_blocks)
    block_to_idx: dict[str, list[int]] = {b: [] for b in unique_blocks}
    for i, bl in enumerate(block_labels):
        block_to_idx[bl].append(i)

    means = np.empty(B)
    for b in range(B):
        sampled = rng.choice(unique_blocks, size=n_blocks, replace=True)
        idx = []
        for bl in sampled:
            idx.extend(block_to_idx[bl])
        means[b] = values[idx].mean()

    return (float(values.mean()),
            float(np.percentile(means, 100 * alpha / 2)),
            float(np.percentile(means, 100 * (1 - alpha / 2))))


def _ece(p_hat: np.ndarray, y: np.ndarray, n_bins: int = 10) -> float:
    N = len(y)
    ece = 0.0
    edges = np.linspace(0, 1, n_bins + 1)
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (p_hat >= lo) & (p_hat < hi)
        if hi == 1.0:
            mask = (p_hat >= lo) & (p_hat <= hi)
        n_bin = int(mask.sum())
        if n_bin == 0:
            continue
        ece += (n_bin / N) * abs(float(p_hat[mask].mean()) - float(y[mask].mean()))
    return ece


def _max_bin_resid(p_hat: np.ndarray, y: np.ndarray,
                   n_bins: int = 10, min_n: int = 20) -> float:
    edges = np.linspace(0, 1, n_bins + 1)
    max_resid = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (p_hat >= lo) & (p_hat < hi)
        if hi == 1.0:
            mask = (p_hat >= lo) & (p_hat <= hi)
        n_bin = int(mask.sum())
        if n_bin < min_n:
            continue
        max_resid = max(max_resid, abs(float(p_hat[mask].mean()) - float(y[mask].mean())))
    return max_resid


def _apply_platt(p: float, A: float, B: float) -> float:
    p_clipped = max(1e-7, min(1 - 1e-7, p))
    logit_p = float(np.log(p_clipped / (1 - p_clipped)))
    return float(1.0 / (1.0 + np.exp(-(A * logit_p + B))))


def _audit_asof_filter(training_as_of: str) -> dict:
    import sqlite3
    conn = sqlite3.connect(str(DB_PATH))
    placeholders = ",".join("?" * len(TEST_FOLD_SEASONS))
    seasons_list = sorted(TEST_FOLD_SEASONS)
    n_violating = conn.execute(
        f"""
        SELECT COUNT(*) FROM nba_game_box_stats bs
        JOIN games g ON g.id = bs.game_id
        WHERE g.season IN ({placeholders})
          AND bs.updated_at > ?
        """,
        (*seasons_list, training_as_of),
    ).fetchone()[0]
    conn.close()
    return {
        "training_as_of": training_as_of,
        "test_fold_rows_with_updated_at_after_cutoff": int(n_violating),
        "asof_filter_clean": n_violating == 0,
    }


def _load_game_metadata(game_ids: list[str]) -> dict[str, dict]:
    import sqlite3
    conn = sqlite3.connect(str(DB_PATH))
    placeholders = ",".join("?" * len(game_ids))

    rows = conn.execute(
        f"SELECT g.id, g.date, g.season, g.home_team_id, g.away_team_id "
        f"FROM games g WHERE g.id IN ({placeholders})",
        game_ids,
    ).fetchall()
    meta = {r[0]: {"date": r[1], "season": r[2], "home_team_id": r[3],
                   "away_team_id": r[4]} for r in rows}

    try:
        sys.path.insert(0, str(REPO_ROOT / "ml" / "nba"))
        from game_type_rules import classify_game_type
        for gid, m in meta.items():
            m["game_type"] = classify_game_type(gid, m["season"])
    except ImportError:
        print("WARNING: game_type_rules module not found; cup/play_in strata will be empty. "
              "Cup-knockout and play_in diagnostic partitions will have n=0.")
        for m in meta.values():
            if "regular" in m["season"]:
                m["game_type"] = "regular"
            else:
                m["game_type"] = "postseason"

    for gid, m in meta.items():
        year_prefix = m["season"].split("-")[0]
        row = conn.execute(
            """
            SELECT COUNT(*) FROM game_results gr
            JOIN games g ON g.id = gr.game_id
            WHERE g.sport='nba'
              AND (g.home_team_id=? OR g.away_team_id=?)
              AND g.date < ?
              AND (g.season=(? || '-regular') OR g.season=(? || '-postseason'))
            """,
            (m["home_team_id"], m["home_team_id"],
             m["date"], year_prefix, year_prefix),
        ).fetchone()
        home_prior = int(row[0]) if row else 0

        row2 = conn.execute(
            """
            SELECT COUNT(*) FROM game_results gr
            JOIN games g ON g.id = gr.game_id
            WHERE g.sport='nba'
              AND (g.home_team_id=? OR g.away_team_id=?)
              AND g.date < ?
              AND (g.season=(? || '-regular') OR g.season=(? || '-postseason'))
            """,
            (m["away_team_id"], m["away_team_id"],
             m["date"], year_prefix, year_prefix),
        ).fetchone()
        away_prior = int(row2[0]) if row2 else 0
        m["min_team_prior_games"] = min(home_prior, away_prior)

    conn.close()
    return meta


def _partition_brier(p_hat: np.ndarray, y: np.ndarray,
                      mask: np.ndarray, label: str) -> dict:
    n = int(mask.sum())
    if n == 0:
        return {"label": label, "n": 0, "brier": None}
    return {"label": label, "n": n,
            "brier": round(float(np.mean((p_hat[mask] - y[mask]) ** 2)), 6)}


def _read_counter() -> dict:
    with open(COUNTER_PATH) as f:
        return json.load(f)


def _increment_counter(results_summary: dict) -> None:
    data = _read_counter()
    data["counter"] += 1
    import datetime
    data["history"].append({
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "touch": data["counter"],
        "description": "step8b MLP test-fold evaluation",
        "council_co_sign": "Stats:CLEAR/8 DQ:CLEAR/8 Pred:WARN/7 Domain:CLEAR/8 Math:CLEAR/9",
        "results_summary": results_summary,
    })
    with open(COUNTER_PATH, "w") as f:
        json.dump(data, f, indent=2)

    with open(AUDIT_LOG, "a") as f:
        f.write(json.dumps({
            "touch": data["counter"],
            "timestamp": data["history"][-1]["timestamp"],
            "description": "step8b MLP test-fold evaluation",
        }) + "\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 70)
    print("Phase 3 step 8b — Test-fold evaluation (MLP, touch #2)")
    print("=" * 70)

    rng = np.random.default_rng(42)

    # --- Verify counter at 1 (touch #1 was LightGBM Gate D FAIL) ---
    counter_data = _read_counter()
    if counter_data["counter"] != 1:
        raise RuntimeError(
            f"Test-fold-touch counter is {counter_data['counter']}, expected 1. "
            "Touch #1 (LightGBM) must precede MLP touch #2. Council audit required."
        )
    print(f"\nCounter: {counter_data['counter']} (expected 1) ✓")

    # --- Load MLP calibration params ---
    with open(MLP_CAL_PARAMS) as f:
        cal = json.load(f)
    config = _build_fitted_config(cal)
    A_platt = cal["platt"]["A"]
    B_platt = cal["platt"]["B"]
    n_seeds = cal["ensemble"]["n_seeds"]
    print(f"MLP Platt params: A={A_platt:.6f} B={B_platt:.6f}")
    print(f"MLP val Brier (raw): {cal['val_diagnostics']['brier_raw']:.6f}")
    print(f"MLP val Brier (cal): {cal['val_diagnostics']['brier_calibrated']:.6f}")

    # --- As-of filter audit ---
    print("\n[Audit] Verifying as-of filter...")
    asof_audit = _audit_asof_filter(TRAINING_AS_OF)
    if not asof_audit["asof_filter_clean"]:
        raise RuntimeError(
            f"As-of filter violation: {asof_audit['test_fold_rows_with_updated_at_after_cutoff']} "
            f"test-fold box stat rows have updated_at > {TRAINING_AS_OF}."
        )
    print(f"    As-of filter CLEAN: 0 violations ✓")

    # --- Build test-fold tensor ---
    print("\n[1/6] Building test-fold feature tensor (may take ~60s)...")
    config.training_as_of = TRAINING_AS_OF
    X_test, y_test, game_ids_test = build_test_fold_tensor(config, str(DB_PATH))
    n_test = len(y_test)
    print(f"    Test-fold: {n_test} games × {X_test.shape[1]} features")
    print(f"    Realized N = {n_test}")

    # --- Load MLP models ---
    print(f"\n[2/6] Loading {n_seeds}-seed MLP models...")
    models = []
    for seed in range(n_seeds):
        path = MLP_MODELS_DIR / f"mlp-seed-{seed:02d}.pt"
        model = torch.load(path, map_location="cpu", weights_only=False)
        model.eval()
        models.append(model)
    print(f"    Loaded {len(models)} seeds.")

    # --- MLP predictions (predict-and-average) ---
    print("\n[3/6] Computing MLP + v5 predictions...")
    seed_preds = np.array([score_mlp(m, X_test) for m in models])  # (20, N)
    ensemble_mean = seed_preds.mean(axis=0)
    mlp_cal = np.array([_apply_platt(p, A_platt, B_platt) for p in ensemble_mean])
    mlp_brier = float(np.mean((mlp_cal - y_test) ** 2))

    v5_preds = _compute_v5_on_games(game_ids_test)
    v5_brier = float(np.mean((v5_preds - y_test) ** 2))

    brier_improvement = v5_brier - mlp_brier
    empirical_home_rate = float(y_test.mean())
    mlp_mean_pred = float(mlp_cal.mean())
    v5_mean_pred = float(v5_preds.mean())

    print(f"    v5 Brier:         {v5_brier:.6f}  (mean pred={v5_mean_pred:.4f})")
    print(f"    MLP cal Brier:    {mlp_brier:.6f}  (mean pred={mlp_mean_pred:.4f})")
    print(f"    Brier improvement: {brier_improvement:+.6f}")
    print(f"    Empirical home rate: {empirical_home_rate:.4f}")
    print(f"    LightGBM test-fold Brier (touch #1): 0.222185 (WORSE than v5)")
    print(f"    NOTE: MLP inner-CV Brier 0.218618 (worse than LightGBM 0.2163)")

    block_labels = _block_labels(game_ids_test)
    n_blocks = len(np.unique(block_labels))
    print(f"\n    Unique (home_team, ISO-week) blocks: {n_blocks}")

    # =======================================================================
    # Gate D: AUC sanity + unconditional mean
    # =======================================================================
    print("\n--- Gate D: AUC sanity + unconditional mean ---")
    mlp_auc = float(roc_auc_score(y_test, mlp_cal))
    v5_auc = float(roc_auc_score(y_test, v5_preds))
    gate_d_auc_pass = mlp_auc >= v5_auc

    mean_dev = abs(mlp_mean_pred - empirical_home_rate)
    gate_d_mean_pass = mean_dev <= GATE_D_MEAN_TOL

    print(f"    MLP AUC: {mlp_auc:.4f}  |  v5 AUC: {v5_auc:.4f}")
    print(f"    AUC floor (mlp ≥ v5): {'PASS ✓' if gate_d_auc_pass else 'FAIL ✗'}")
    print(f"    Unconditional mean deviation: {mean_dev:.4f}  (threshold ≤ {GATE_D_MEAN_TOL})")
    print(f"    Mean sanity: {'PASS ✓' if gate_d_mean_pass else 'FAIL ✗'}")

    gate_d_pass = gate_d_auc_pass and gate_d_mean_pass
    if not gate_d_pass:
        print("\n    GATE D FAILED — MLP rejected. Both families failed; null result.")
        _increment_counter({
            "gate_d_pass": False,
            "gate_d_mlp_auc": round(mlp_auc, 4),
            "gate_d_v5_auc": round(v5_auc, 4),
            "mlp_cal_brier": round(mlp_brier, 6),
            "v5_test_brier": round(v5_brier, 6),
            "brier_improvement": round(brier_improvement, 6),
            "note": "Gate D halt — MLP AUC below v5 floor; null result",
        })
        sys.exit(1)

    # =======================================================================
    # Rule 1: Brier beat
    # =======================================================================
    print("\n--- Rule 1: Brier beat ---")
    brier_v5_arr = (v5_preds - y_test) ** 2
    brier_mlp_arr = (mlp_cal - y_test) ** 2
    paired_diff = brier_v5_arr - brier_mlp_arr

    point_estimate = float(paired_diff.mean())
    diff_mean, ci_lo, ci_hi = _block_bootstrap_ci(paired_diff, block_labels, B_BOOTSTRAP, rng)

    rule1_point_pass = point_estimate >= BRIER_BEAT_FLOOR
    rule1_ci_pass = ci_lo > 0
    rule1_pass = rule1_point_pass and rule1_ci_pass

    print(f"    Paired-diff mean (v5 − mlp): {point_estimate:+.6f}")
    print(f"    95% block-bootstrap CI:      [{ci_lo:+.6f}, {ci_hi:+.6f}]")
    print(f"    Point estimate ≥ {BRIER_BEAT_FLOOR}?  {'PASS ✓' if rule1_point_pass else 'FAIL ✗'}")
    print(f"    CI lower bound > 0?           {'PASS ✓' if rule1_ci_pass else 'FAIL ✗'}")
    print(f"    Rule 1: {'PASS ✓' if rule1_pass else 'FAIL ✗'}")

    # =======================================================================
    # Rule 2: ECE
    # =======================================================================
    print("\n--- Rule 2: Calibration (ECE) ---")
    mlp_ece = _ece(mlp_cal, y_test)
    v5_ece = _ece(v5_preds, y_test)
    rule2_pass = mlp_ece <= v5_ece
    print(f"    MLP ECE: {mlp_ece:.6f}  |  v5 ECE: {v5_ece:.6f}")
    print(f"    Rule 2 (mlp ECE ≤ v5 ECE): {'PASS ✓' if rule2_pass else 'FAIL ✗'}")

    # =======================================================================
    # Rule 3: N/A
    # =======================================================================
    rule3_pass = None
    print("\n--- Rule 3: Margin model parity --- N/A (no learned margin head)")

    # =======================================================================
    # Rule 4: Bin residuals
    # =======================================================================
    print("\n--- Rule 4: Bin residuals ---")
    mlp_max_bin = _max_bin_resid(mlp_cal, y_test)
    v5_max_bin = _max_bin_resid(v5_preds, y_test)
    rule4_threshold = max(RULE4_MAX_BIN_RESID_ABS, v5_max_bin + RULE4_INCUMBENT_MARGIN)
    rule4_pass = mlp_max_bin <= rule4_threshold
    print(f"    MLP max|bin_resid|: {mlp_max_bin:.6f}")
    print(f"    v5 max|bin_resid|:  {v5_max_bin:.6f}")
    print(f"    Threshold:          {rule4_threshold:.6f}")
    print(f"    Rule 4: {'PASS ✓' if rule4_pass else 'FAIL ✗'}")

    print("\n--- Rule 5: Shadow parity --- deferred (step 9)")
    print("--- Rule 6: Interpretability --- deferred (step 10)")

    # =======================================================================
    # Diagnostic partitions
    # =======================================================================
    print("\n--- Diagnostic partitions (non-gates) ---")
    meta = _load_game_metadata(game_ids_test)
    partitions = []
    masks_def = [
        ("regular_season", lambda m: "regular" in m.get("season", "")),
        ("postseason", lambda m: "postseason" in m.get("season", "")),
        ("cup_pool", lambda m: m.get("game_type", "") == "cup_pool"),
        ("cup_knockout", lambda m: m.get("game_type", "") == "cup_knockout"),
        ("play_in", lambda m: m.get("game_type", "") == "play_in"),
        ("early_season_lt15", lambda m: m.get("min_team_prior_games", 99) < 15),
        ("established_season_ge15", lambda m: m.get("min_team_prior_games", 0) >= 15),
    ]
    for label, fn in masks_def:
        mask = np.array([fn(meta.get(gid, {})) for gid in game_ids_test])
        partitions.append(_partition_brier(mlp_cal, y_test, mask, f"mlp_{label}"))
        partitions.append(_partition_brier(v5_preds, y_test, mask, f"v5_{label}"))

    for p in partitions:
        if p["n"] > 0:
            print(f"    {p['label']}: n={p['n']} Brier={p['brier']}")

    # =======================================================================
    # Summary
    # =======================================================================
    all_evaluated_pass = all(p for p in [gate_d_pass, rule1_pass, rule2_pass, rule4_pass])
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"  Test-fold N:     {n_test}  |  blocks: {n_blocks}")
    print(f"  v5 Brier:        {v5_brier:.6f}")
    print(f"  MLP Brier:       {mlp_brier:.6f}")
    print(f"  Improvement:     {brier_improvement:+.6f}  (ship floor: {BRIER_BEAT_FLOOR})")
    print()
    print(f"  Gate D (AUC+mean): {'PASS ✓' if gate_d_pass else 'FAIL ✗'}")
    print(f"  Rule 1 (Brier CI): {'PASS ✓' if rule1_pass else 'FAIL ✗'}")
    print(f"  Rule 2 (ECE):      {'PASS ✓' if rule2_pass else 'FAIL ✗'}")
    print(f"  Rule 3:            N/A")
    print(f"  Rule 4 (bin-res):  {'PASS ✓' if rule4_pass else 'FAIL ✗'}")
    print(f"  Rule 5:            deferred (step 9)")
    print(f"  Rule 6:            deferred (step 10)")
    print()
    print(f"  Overall (evaluated rules): {'PASS ✓' if all_evaluated_pass else 'FAIL ✗'}")

    results = {
        "step": "step8b_test_fold_evaluation_mlp",
        "plan_ref": "Plans/nba-learned-model.md §step 8b addendum v16",
        "n_test": n_test,
        "n_blocks": n_blocks,
        "v5_test_brier": round(v5_brier, 6),
        "mlp_raw_brier": round(float(np.mean((ensemble_mean - y_test) ** 2)), 6),
        "mlp_cal_brier": round(mlp_brier, 6),
        "brier_improvement": round(brier_improvement, 6),
        "empirical_home_rate": round(empirical_home_rate, 4),
        "mlp_mean_pred": round(mlp_mean_pred, 4),
        "v5_mean_pred": round(v5_mean_pred, 4),
        "gate_d_mlp_auc": round(mlp_auc, 4),
        "gate_d_v5_auc": round(v5_auc, 4),
        "gate_d_mean_deviation": round(mean_dev, 4),
        "gate_d_pass": gate_d_pass,
        "rule1_point_estimate": round(point_estimate, 6),
        "rule1_ci_lo": round(ci_lo, 6),
        "rule1_ci_hi": round(ci_hi, 6),
        "rule1_point_pass": rule1_point_pass,
        "rule1_ci_pass": rule1_ci_pass,
        "rule1_pass": rule1_pass,
        "rule2_mlp_ece": round(mlp_ece, 6),
        "rule2_v5_ece": round(v5_ece, 6),
        "rule2_pass": rule2_pass,
        "rule3_pass": "N/A",
        "rule4_mlp_max_bin_resid": round(mlp_max_bin, 6),
        "rule4_v5_max_bin_resid": round(v5_max_bin, 6),
        "rule4_threshold": round(rule4_threshold, 6),
        "rule4_pass": rule4_pass,
        "rule5_pass": "deferred_step9",
        "rule6_pass": "deferred_step10",
        "all_evaluated_pass": all_evaluated_pass,
        "diagnostic_partitions": partitions,
        "asof_audit": asof_audit,
    }

    with open(RESULTS_PATH, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n  Results written to: {RESULTS_PATH.relative_to(REPO_ROOT)}")

    results_summary = {
        "brier_improvement": round(brier_improvement, 6),
        "rule1_pass": rule1_pass,
        "rule2_pass": rule2_pass,
        "rule4_pass": rule4_pass,
        "gate_d_pass": gate_d_pass,
        "all_evaluated_pass": all_evaluated_pass,
    }
    _increment_counter(results_summary)
    print(f"\n  Test-fold-touch counter incremented to 2.")
    print(f"  Commit this run with Council-co-sign attestation (≥3 experts).")


if __name__ == "__main__":
    main()
