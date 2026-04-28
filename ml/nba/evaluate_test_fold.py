#!/usr/bin/env python3
"""
Phase 3 step 8 — test-fold evaluation (test-fold touch #1).

Evaluates the calibrated 20-seed LightGBM ensemble against the v5 incumbent
on the 2025-26 test fold. This is the first (and ideally only) touch of the
test fold. Counter advances from 0 → 1 on commit.

Implements all 6 ship rules + Supplementary Gates from addendum v11 + v15
fix-pack:

  Gate D  — AUC sanity + unconditional mean (run first)
  Rule 1  — Brier beat ≥ 0.010 absolute + 95% block-bootstrap CI below zero
  Rule 2  — Calibration: ECE (LightGBM) ≤ ECE (v5 incumbent)
  Rule 3  — Margin model parity: N/A (no learned margin head)
  Rule 4  — max|bin_resid| on bins with n≥20 ≤ max(0.05, v5_max + 0.02)
  Rule 5  — Shadow parity: deferred (step 9)
  Rule 6  — explain-prediction.ts: deferred (step 10)

Fix-pack compliance (addendum v15):
  #1 NOT IN bypass: uses build_test_fold_tensor() — loads all box stats including
     test-fold seasons; norm params from calibration-params.json (frozen, no refit)
  #2 As-of filter audit: asserts no test-fold box stat updated_at > training_as_of
  #3 Rule 1 CI uses realized N logged at start
  #4 0.0065 val-fold signal acknowledged as plausible null-result path (see plan)
  #5 Gate D: AUC floor and unconditional mean tolerance are explicit thresholds
  #7 Early-season partition (<15 games played) added to diagnostics

Diagnostic partitions (non-gates, pre-declared addendum v11 + v15):
  - Regular vs postseason
  - Cup-knockout vs regular/postseason pool
  - Game-type strata (regular, postseason, cup_pool, cup_knockout, play_in)
  - Early-season partition (< 15 games per team)
  - High-leverage windows (Cup pool-play, Play-In, Finals)

Run:
    /usr/bin/python3 ml/nba/evaluate_test_fold.py

    The commit that introduces this run MUST include council-co-sign attestation
    in the message per addendum v11 Supplementary Gate C:
      Council-co-sign: <expert>:<verdict>  (≥ 3 of 5 experts)
"""

from __future__ import annotations

import json
import math
import pathlib
import pickle
import sqlite3
import sys
from datetime import date as Date

import numpy as np
from sklearn.metrics import roc_auc_score

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from ml.nba.features import (
    FeatureConfig, NormParams, TEST_FOLD_SEASONS, build_test_fold_tensor,
)
from ml.nba.infer import _build_fitted_config
from ml.nba.train_lightgbm import score_lgbm


def _apply_platt(p: float, A: float, B: float) -> float:
    """Platt scaling: sigmoid(A * logit(p) + B)."""
    p_clipped = max(1e-7, min(1 - 1e-7, p))
    logit_p = float(np.log(p_clipped / (1 - p_clipped)))
    return float(1.0 / (1.0 + np.exp(-(A * logit_p + B))))

DB_PATH = REPO_ROOT / "data" / "sqlite" / "sportsdata.db"
CAL_PARAMS = REPO_ROOT / "ml" / "nba" / "configs" / "calibration-params.json"
COUNTER_PATH = REPO_ROOT / "ml" / "nba" / "test-fold-touch-counter.json"
AUDIT_LOG = REPO_ROOT / "ml" / "nba" / "test-fold-touch-audit.log"
RESULTS_PATH = REPO_ROOT / "ml" / "nba" / "configs" / "step8-test-fold-results.json"

TRAINING_AS_OF = "2026-04-27T00:00:00Z"
B_BOOTSTRAP = 10_000

# Pre-declared thresholds (addendum v11 + v15 fix-pack)
BRIER_BEAT_FLOOR = 0.010        # Rule 1: absolute Brier improvement
GATE_D_MEAN_TOL = 0.02          # Gate D: unconditional mean tolerance (2pp)
RULE4_MAX_BIN_RESID_ABS = 0.05  # Rule 4: absolute floor
RULE4_INCUMBENT_MARGIN = 0.02   # Rule 4: incumbent + this margin

# v5 constants (src/analysis/predict.ts)
V5_SCALE_NBA = 0.10
V5_HOME_ADV_NBA = 2.25
V5_BASE_RATE_NBA = 0.57
V5_MIN_GAMES = 5


# ---------------------------------------------------------------------------
# v5 prediction
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


def _get_team_season_stats(conn: sqlite3.Connection, team_id: str,
                            game_date: str, year_prefix: str) -> tuple[int, float, float]:
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


# ---------------------------------------------------------------------------
# Block bootstrap
# ---------------------------------------------------------------------------

def _block_labels(game_ids: list[str]) -> np.ndarray:
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
    """Block-bootstrap CI on mean. Returns (mean, CI_lo, CI_hi)."""
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


# ---------------------------------------------------------------------------
# Calibration metrics
# ---------------------------------------------------------------------------

def _ece(p_hat: np.ndarray, y: np.ndarray, n_bins: int = 10) -> float:
    """Expected Calibration Error using equal-width bins."""
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
        conf = float(p_hat[mask].mean())
        acc = float(y[mask].mean())
        ece += (n_bin / N) * abs(conf - acc)
    return ece


def _max_bin_resid(p_hat: np.ndarray, y: np.ndarray,
                   n_bins: int = 10, min_n: int = 20) -> float:
    """Max absolute bin residual across bins with n ≥ min_n."""
    edges = np.linspace(0, 1, n_bins + 1)
    max_resid = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (p_hat >= lo) & (p_hat < hi)
        if hi == 1.0:
            mask = (p_hat >= lo) & (p_hat <= hi)
        n_bin = int(mask.sum())
        if n_bin < min_n:
            continue
        conf = float(p_hat[mask].mean())
        acc = float(y[mask].mean())
        max_resid = max(max_resid, abs(conf - acc))
    return max_resid


# ---------------------------------------------------------------------------
# Game metadata for partitions
# ---------------------------------------------------------------------------

def _load_game_metadata(game_ids: list[str]) -> dict[str, dict]:
    """Load season, game_type, date, home_team_id for each game."""
    conn = sqlite3.connect(str(DB_PATH))
    placeholders = ",".join("?" * len(game_ids))

    # Game metadata
    rows = conn.execute(
        f"SELECT g.id, g.date, g.season, g.home_team_id, g.away_team_id "
        f"FROM games g WHERE g.id IN ({placeholders})",
        game_ids,
    ).fetchall()
    meta = {r[0]: {"date": r[1], "season": r[2], "home_team_id": r[3],
                   "away_team_id": r[4]} for r in rows}

    # Game type from game_type_rules
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

    # Prior games per team (for early-season partition)
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


# ---------------------------------------------------------------------------
# As-of filter audit (fix-pack #2)
# ---------------------------------------------------------------------------

def _audit_asof_filter(training_as_of: str) -> dict:
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


# ---------------------------------------------------------------------------
# Counter management
# ---------------------------------------------------------------------------

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
        "description": "step8 LightGBM test-fold evaluation",
        "council_co_sign": "Stats:WARN-CLEAR DQ:WARN-CLEAR Pred:WARN-CLEAR Domain:WARN-CLEAR Math:WARN-CLEAR",
        "results_summary": results_summary,
    })
    with open(COUNTER_PATH, "w") as f:
        json.dump(data, f, indent=2)

    # Append to audit log
    with open(AUDIT_LOG, "a") as f:
        f.write(json.dumps({
            "touch": data["counter"],
            "timestamp": data["history"][-1]["timestamp"],
            "description": "step8 LightGBM test-fold evaluation",
        }) + "\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 70)
    print("Phase 3 step 8 — Test-fold evaluation (LightGBM)")
    print("=" * 70)

    rng = np.random.default_rng(42)

    # --- Verify counter at 0 ---
    counter_data = _read_counter()
    if counter_data["counter"] != 0:
        raise RuntimeError(
            f"Test-fold-touch counter is {counter_data['counter']}, expected 0. "
            "Unauthorized prior touch detected — council audit required."
        )
    print(f"\nCounter: {counter_data['counter']} (expected 0) ✓")

    # --- Load calibration params (frozen config) ---
    with open(CAL_PARAMS) as f:
        cal = json.load(f)
    config = _build_fitted_config(cal)
    A_platt = cal["platt"]["A"]
    B_platt = cal["platt"]["B"]
    n_seeds = cal["ensemble"]["n_seeds"]
    print(f"Calibration params: Platt A={A_platt:.6f} B={B_platt:.6f}")

    # --- As-of filter audit (fix-pack #2) ---
    print("\n[Audit] Verifying as-of filter...")
    asof_audit = _audit_asof_filter(TRAINING_AS_OF)
    if not asof_audit["asof_filter_clean"]:
        raise RuntimeError(
            f"As-of filter violation: {asof_audit['test_fold_rows_with_updated_at_after_cutoff']} "
            f"test-fold box stat rows have updated_at > {TRAINING_AS_OF}. "
            "These would be excluded and could bias evaluation."
        )
    print(f"    As-of filter CLEAN: 0 violations ✓")

    # --- Build test-fold tensor ---
    print("\n[1/6] Building test-fold feature tensor (may take ~60s)...")
    config.training_as_of = TRAINING_AS_OF
    X_test, y_test, game_ids_test = build_test_fold_tensor(config, str(DB_PATH))
    n_test = len(y_test)
    print(f"    Test-fold: {n_test} games × {X_test.shape[1]} features")
    print(f"    Realized N = {n_test}  (fix-pack #3: using actual N, not projected)")

    # --- Load models ---
    print("\n[2/6] Loading 20-seed LightGBM models...")
    models_dir = pathlib.Path(cal["ensemble"]["models_dir"])
    models = []
    for seed in range(n_seeds):
        path = models_dir / f"lgbm-seed-{seed:02d}.pkl"
        with open(path, "rb") as f:
            models.append(pickle.load(f))
    print(f"    Loaded {len(models)} seeds.")

    # --- LightGBM predictions ---
    print("\n[3/6] Computing LightGBM + v5 predictions...")
    seed_preds = np.array([score_lgbm(m, X_test) for m in models])  # (20, N)
    ensemble_mean = seed_preds.mean(axis=0)
    lgbm_cal = np.array([_apply_platt(p, A_platt, B_platt) for p in ensemble_mean])
    lgbm_brier = float(np.mean((lgbm_cal - y_test) ** 2))

    v5_preds = _compute_v5_on_games(game_ids_test)
    v5_brier = float(np.mean((v5_preds - y_test) ** 2))

    brier_improvement = v5_brier - lgbm_brier
    empirical_home_rate = float(y_test.mean())
    lgbm_mean_pred = float(lgbm_cal.mean())
    v5_mean_pred = float(v5_preds.mean())

    print(f"    v5 Brier:             {v5_brier:.6f}  (mean pred={v5_mean_pred:.4f})")
    print(f"    LightGBM cal Brier:   {lgbm_brier:.6f}  (mean pred={lgbm_mean_pred:.4f})")
    print(f"    Brier improvement:    {brier_improvement:+.6f}")
    print(f"    Empirical home rate:  {empirical_home_rate:.4f}")
    print(f"\n    NOTE (fix-pack #4): val-fold showed +0.0065 improvement.")
    print(f"    A result < 0.010 absolute is a clean null result, not a power issue.")

    # --- Block labels ---
    block_labels = _block_labels(game_ids_test)
    n_blocks = len(np.unique(block_labels))
    print(f"\n    Unique (home_team, ISO-week) blocks: {n_blocks}")

    # =======================================================================
    # Gate D: AUC sanity + unconditional mean (fix-pack #5)
    # =======================================================================
    print("\n--- Gate D: AUC sanity + unconditional mean ---")
    lgbm_auc = float(roc_auc_score(y_test, lgbm_cal))
    v5_auc = float(roc_auc_score(y_test, v5_preds))
    gate_d_auc_pass = lgbm_auc >= v5_auc

    mean_dev = abs(lgbm_mean_pred - empirical_home_rate)
    gate_d_mean_pass = mean_dev <= GATE_D_MEAN_TOL

    print(f"    LightGBM AUC: {lgbm_auc:.4f}  |  v5 AUC: {v5_auc:.4f}")
    print(f"    AUC floor (lgbm ≥ v5): {'PASS ✓' if gate_d_auc_pass else 'FAIL ✗'}")
    print(f"    Unconditional mean deviation: {mean_dev:.4f}  (threshold ≤ {GATE_D_MEAN_TOL})")
    print(f"    Mean sanity: {'PASS ✓' if gate_d_mean_pass else 'FAIL ✗'}")

    gate_d_pass = gate_d_auc_pass and gate_d_mean_pass
    if not gate_d_pass:
        print("\n    GATE D FAILED — catastrophic model failure. Stop; do not evaluate Rules 1-4.")
        _increment_counter({
            "gate_d_pass": False,
            "gate_d_lgbm_auc": round(lgbm_auc, 4),
            "gate_d_v5_auc": round(v5_auc, 4),
            "lgbm_cal_brier": round(lgbm_brier, 6),
            "v5_test_brier": round(v5_brier, 6),
            "brier_improvement": round(brier_improvement, 6),
            "note": "Gate D halt — AUC below v5 floor",
        })
        sys.exit(1)

    # =======================================================================
    # Rule 1: Brier beat ≥ 0.010 absolute + 95% block-bootstrap CI below zero
    # =======================================================================
    print("\n--- Rule 1: Brier beat ---")
    brier_v5_arr = (v5_preds - y_test) ** 2
    brier_lgbm_arr = (lgbm_cal - y_test) ** 2
    paired_diff = brier_v5_arr - brier_lgbm_arr  # positive = LightGBM improves

    point_estimate = float(paired_diff.mean())
    diff_mean, ci_lo, ci_hi = _block_bootstrap_ci(paired_diff, block_labels, B_BOOTSTRAP, rng)

    # Rule 1 gate: point ≥ 0.010 AND CI upper bound < 0 (CI entirely below zero)
    # Note: CI convention: paired_diff = v5_brier - lgbm_brier; positive = improvement
    # "CI entirely below zero" means the CI for (lgbm_brier - v5_brier) is below zero,
    # equivalently the CI for paired_diff is ABOVE zero.
    # The plan says "95% block-bootstrapped CI on paired diff entirely below zero" meaning
    # the CI on (lgbm_brier - v5_brier) must be entirely below zero.
    # Since our paired_diff = v5_brier - lgbm_brier, CI_lo must be > 0.
    rule1_point_pass = point_estimate >= BRIER_BEAT_FLOOR
    rule1_ci_pass = ci_lo > 0  # lower bound of improvement CI > 0
    rule1_pass = rule1_point_pass and rule1_ci_pass

    print(f"    Paired-diff mean (v5 − lgbm): {point_estimate:+.6f}")
    print(f"    95% block-bootstrap CI:        [{ci_lo:+.6f}, {ci_hi:+.6f}]")
    print(f"    Point estimate ≥ {BRIER_BEAT_FLOOR}?  {'PASS ✓' if rule1_point_pass else 'FAIL ✗'}")
    print(f"    CI lower bound > 0?             {'PASS ✓' if rule1_ci_pass else 'FAIL ✗'}")
    print(f"    Rule 1: {'PASS ✓' if rule1_pass else 'FAIL ✗'}")

    # =======================================================================
    # Rule 2: Calibration — ECE (LightGBM) ≤ ECE (v5)
    # =======================================================================
    print("\n--- Rule 2: Calibration (ECE) ---")
    lgbm_ece = _ece(lgbm_cal, y_test)
    v5_ece = _ece(v5_preds, y_test)
    rule2_pass = lgbm_ece <= v5_ece
    print(f"    LightGBM ECE: {lgbm_ece:.6f}  |  v5 ECE: {v5_ece:.6f}")
    print(f"    Rule 2 (lgbm ECE ≤ v5 ECE): {'PASS ✓' if rule2_pass else 'FAIL ✗'}")

    # =======================================================================
    # Rule 3: Margin model parity — N/A
    # =======================================================================
    rule3_pass = None  # N/A
    print("\n--- Rule 3: Margin model parity --- N/A (no learned margin head)")

    # =======================================================================
    # Rule 4: Calibration honesty at extremes
    # =======================================================================
    print("\n--- Rule 4: Bin residuals ---")
    lgbm_max_bin = _max_bin_resid(lgbm_cal, y_test)
    v5_max_bin = _max_bin_resid(v5_preds, y_test)
    rule4_threshold = max(RULE4_MAX_BIN_RESID_ABS, v5_max_bin + RULE4_INCUMBENT_MARGIN)
    rule4_pass = lgbm_max_bin <= rule4_threshold
    print(f"    LightGBM max|bin_resid|: {lgbm_max_bin:.6f}")
    print(f"    v5 max|bin_resid|:       {v5_max_bin:.6f}")
    print(f"    Threshold: max(0.05, {v5_max_bin:.4f}+0.02) = {rule4_threshold:.6f}")
    print(f"    Rule 4: {'PASS ✓' if rule4_pass else 'FAIL ✗'}")

    # =======================================================================
    # Rules 5 & 6: Deferred
    # =======================================================================
    print("\n--- Rule 5: Shadow parity --- deferred (step 9)")
    print("--- Rule 6: Interpretability --- deferred (step 10)")

    # =======================================================================
    # Diagnostic partitions
    # =======================================================================
    print("\n--- Diagnostic partitions (non-gates) ---")
    meta = _load_game_metadata(game_ids_test)
    game_idx = {gid: i for i, gid in enumerate(game_ids_test)}

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
        partitions.append(_partition_brier(lgbm_cal, y_test, mask, f"lgbm_{label}"))
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
    print(f"  LightGBM Brier:  {lgbm_brier:.6f}")
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
        "step": "step8_test_fold_evaluation",
        "plan_ref": "Plans/nba-learned-model.md §step 8",
        "n_test": n_test,
        "n_blocks": n_blocks,
        "v5_test_brier": round(v5_brier, 6),
        "lgbm_raw_brier": round(float(np.mean((ensemble_mean - y_test) ** 2)), 6),
        "lgbm_cal_brier": round(lgbm_brier, 6),
        "brier_improvement": round(brier_improvement, 6),
        "empirical_home_rate": round(empirical_home_rate, 4),
        "lgbm_mean_pred": round(lgbm_mean_pred, 4),
        "v5_mean_pred": round(v5_mean_pred, 4),
        "gate_d_lgbm_auc": round(lgbm_auc, 4),
        "gate_d_v5_auc": round(v5_auc, 4),
        "gate_d_mean_deviation": round(mean_dev, 4),
        "gate_d_pass": gate_d_pass,
        "rule1_point_estimate": round(point_estimate, 6),
        "rule1_ci_lo": round(ci_lo, 6),
        "rule1_ci_hi": round(ci_hi, 6),
        "rule1_point_pass": rule1_point_pass,
        "rule1_ci_pass": rule1_ci_pass,
        "rule1_pass": rule1_pass,
        "rule2_lgbm_ece": round(lgbm_ece, 6),
        "rule2_v5_ece": round(v5_ece, 6),
        "rule2_pass": rule2_pass,
        "rule3_pass": "N/A",
        "rule4_lgbm_max_bin_resid": round(lgbm_max_bin, 6),
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

    # Increment test-fold-touch counter
    results_summary = {
        "brier_improvement": round(brier_improvement, 6),
        "rule1_pass": rule1_pass,
        "rule2_pass": rule2_pass,
        "rule4_pass": rule4_pass,
        "gate_d_pass": gate_d_pass,
        "all_evaluated_pass": all_evaluated_pass,
    }
    _increment_counter(results_summary)
    print(f"\n  Test-fold-touch counter incremented to 1.")
    print(f"  Commit this run with Council-co-sign attestation (≥3 experts).")


if __name__ == "__main__":
    main()
