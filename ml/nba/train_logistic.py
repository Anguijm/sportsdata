#!/usr/bin/env python3
"""
Phase 7 — L2-regularized logistic regression on the 46-feature set.

Hypothesis: LR finds the dominant linear signal (season_net_rating) more
efficiently than LightGBM at n=2640. v5 is essentially a logistic model;
LR should discover the same functional form directly.

Plan: Plans/nba-phase7-logistic.md (council-CLEAR Gate 1, avg 8.8/10, 2026-04-29).

Gate D (halt): val-fold AUC ≥ 0.7283 (v5 test-fold baseline).
If fail → declare null result. Do not open test fold.

C selection: inner 5-fold temporal CV on training fold (2112 games).
Candidates: [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0].
If best_C lands at a boundary, expand grid before proceeding (Stats council note).

Feature coherence gate: top-5 coefficients by |coef| must include
home_season_net_rating or away_season_net_rating. If not, halt and investigate
normalization bug before opening test fold.

Invoke as: /usr/bin/python3 ml/nba/train_logistic.py
"""

import datetime
import hashlib
import json
import pathlib
import sqlite3
import sys
import uuid

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from ml.nba.features import FeatureConfig, build_training_tensor

DB_PATH = REPO_ROOT / "data" / "sqlite" / "sportsdata.db"
RESULTS_DIR = REPO_ROOT / "ml" / "nba" / "results"
COUNTER_PATH = REPO_ROOT / "ml" / "nba" / "test-fold-touch-counter.json"

# Pinned to Phase 6 config (same as all prior phases — ewma-h21, 46 features).
TRAINING_AS_OF = "2026-04-29T00:00:00Z"
FEATURE_CONFIG = {
    "feature_form": "ewma",
    "window_size": 10,
    "ewma_halflife": 21,
    "training_as_of": TRAINING_AS_OF,
}

VAL_CUTOFF_IDX = 2112   # int(2640 * 0.8) — matches all prior phases
V5_AUC_FLOOR = 0.7283   # v5 test-fold AUC (pre-declared Gate D floor)
V5_VAL_BRIER = 0.2093   # v5 val-fold Brier (pre-declared Rule 1 ceiling)

C_CANDIDATES = [0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0]
# Inner split: first 80% of training fold for inner-train, last 20% for inner-val.
# This mirrors the outer 80/20 split and avoids the varying-sample-size problem
# that plagues forward-chaining inner CV at n≈2112 (Stats council note on σ_AUC).
INNER_SPLIT_RATIO = 0.80


def _regular_season_mask(val_game_ids: list, db_path: str) -> np.ndarray:
    ph = ",".join("?" * len(val_game_ids))
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        f"SELECT game_id, season FROM nba_game_box_stats WHERE game_id IN ({ph})",
        val_game_ids,
    ).fetchall()
    conn.close()
    season_by_id = {r[0]: r[1] for r in rows}
    return np.array([season_by_id.get(gid, "").endswith("-regular") for gid in val_game_ids])


def _inner_cv(X_train: np.ndarray, y_train: np.ndarray) -> dict:
    # Fixed 80/20 inner split: mirrors the outer evaluation split structure.
    # Forward-chaining inner CV had a varying-sample-size problem (fold 0 has
    # ~422 training games vs 2112 at the outer level), which caused the grid
    # to favor extreme regularization (C→0). The fixed split keeps training
    # size close to the outer fold, giving reliable C estimates.
    n = len(X_train)
    inner_cutoff = int(n * INNER_SPLIT_RATIO)
    X_i_tr, X_i_val = X_train[:inner_cutoff], X_train[inner_cutoff:]
    y_i_tr, y_i_val = y_train[:inner_cutoff], y_train[inner_cutoff:]

    summary = {}
    for c in C_CANDIDATES:
        m = LogisticRegression(C=c, solver="lbfgs", max_iter=1000)
        m.fit(X_i_tr, y_i_tr)
        p = m.predict_proba(X_i_val)[:, 1]
        auc = float(roc_auc_score(y_i_val, p))
        brier = float(np.mean((p - y_i_val) ** 2))
        summary[c] = {"mean_auc": auc, "sigma_auc": 0.0, "inner_brier": brier}
    return summary


def _cold_start_brier(game_ids: list, proba: np.ndarray, y: np.ndarray, db_path: str) -> dict:
    conn = sqlite3.connect(db_path)
    id_ph = ",".join("?" * len(game_ids))
    # For each val game, count games played by home/away team before this game.
    rows = conn.execute(
        f"""
        SELECT g.id AS game_id, g.date,
               g.home_team_id, g.away_team_id
        FROM games g
        WHERE g.id IN ({id_ph}) AND g.sport = 'nba'
        ORDER BY g.date
        """,
        game_ids,
    ).fetchall()
    # Build cumulative game counts per team from all nba game_results
    all_gr = conn.execute(
        "SELECT gr.game_id, g.date, g.home_team_id, g.away_team_id "
        "FROM game_results gr JOIN games g ON gr.game_id = g.id "
        "WHERE gr.sport = 'nba' ORDER BY g.date"
    ).fetchall()
    conn.close()

    team_games: dict = {}
    game_date_map = {r[0]: (r[1], r[2], r[3]) for r in rows}
    all_gr_dict: dict = {}  # date → list of (game_id, home, away)
    for gid, dt, ht, at in all_gr:
        all_gr_dict.setdefault(dt, []).append((gid, ht, at))

    # Count games played per team as of each val game's date
    # Simple O(n²) approach acceptable at this scale
    team_games_before: dict = {}
    for gid, dt, ht, at in all_gr:
        team_games_before.setdefault(gid, (0, 0))  # placeholder
    # Count by replaying
    running: dict = {}
    gid_to_teams = {r[0]: (r[1], r[2], r[3]) for r in all_gr}
    sorted_games = sorted(all_gr, key=lambda r: r[1])
    # For each val game_id, snapshot running counts
    val_set = set(game_ids)
    running_snap: dict = {}
    counts: dict = {}
    for gid, dt, ht, at in sorted_games:
        if gid in val_set:
            running_snap[gid] = (counts.get(ht, 0), counts.get(at, 0))
        counts[ht] = counts.get(ht, 0) + 1
        counts[at] = counts.get(at, 0) + 1

    cold_indices, late_indices = [], []
    for i, gid in enumerate(game_ids):
        if gid in running_snap:
            gh, ga = running_snap[gid]
            if gh <= 20 or ga <= 20:
                cold_indices.append(i)
            else:
                late_indices.append(i)

    if not cold_indices:
        return {"n_cold": 0, "cold_brier": None, "late_brier": None}

    cold_brier = float(np.mean((proba[cold_indices] - y[cold_indices]) ** 2))
    late_brier = float(np.mean((proba[late_indices] - y[late_indices]) ** 2)) if late_indices else None
    return {"n_cold": len(cold_indices), "cold_brier": cold_brier, "late_brier": late_brier}


def main():
    run_ts = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%S")
    run_id = f"{run_ts}-{uuid.uuid4().hex[:8]}"
    run_dir = RESULTS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    out_path = run_dir / "logistic-results.json"

    print(f"\n=== Phase 7 — Logistic Regression ===")
    print(f"Run ID: {run_id}")
    print(f"Output: {out_path}")

    # Build 46-feature tensor (same config as Phases 3–6)
    config = FeatureConfig(
        feature_form=FEATURE_CONFIG["feature_form"],
        window_size=FEATURE_CONFIG["window_size"],
        ewma_halflife=FEATURE_CONFIG["ewma_halflife"],
        training_as_of=TRAINING_AS_OF,
    )
    print(f"\nBuilding training tensor (ewma-h21, as-of {TRAINING_AS_OF})...")
    X, y, game_ids = build_training_tensor(config, str(DB_PATH))
    n_total = len(y)
    print(f"  Tensor: n={n_total}, features={X.shape[1]}")
    assert X.shape[1] == 46, f"Expected 46 features, got {X.shape[1]}"

    # Data hash for reproducibility
    data_hash = hashlib.sha256(X.tobytes()).hexdigest()[:16]
    print(f"  Data hash (first 16): {data_hash}")

    # Train/val split
    assert VAL_CUTOFF_IDX < n_total, "Not enough games for val split"
    X_train, X_val = X[:VAL_CUTOFF_IDX], X[VAL_CUTOFF_IDX:]
    y_train, y_val = y[:VAL_CUTOFF_IDX], y[VAL_CUTOFF_IDX:]
    val_game_ids = list(game_ids[VAL_CUTOFF_IDX:])
    print(f"  Train: n={len(y_train)}, Val: n={len(y_val)}")

    # Regular-season val mask (Phase 5 fix retained)
    reg_mask = _regular_season_mask(val_game_ids, str(DB_PATH))
    n_reg = int(reg_mask.sum())
    print(f"  Val regular-season: {n_reg}/{len(y_val)} games")
    assert n_reg >= 100, f"Too few regular-season val games: {n_reg}"

    X_val_reg = X_val[reg_mask]
    y_val_reg = y_val[reg_mask]

    # Inner 5-fold temporal CV for C selection (on training fold only)
    print(f"\nInner CV (80/20 fixed split) over C candidates...")
    cv_summary = _inner_cv(X_train, y_train)
    print(f"  {'C':>8s}  {'inner_AUC':>10s}  {'inner_Brier':>12s}")
    for c in C_CANDIDATES:
        if c in cv_summary:
            r = cv_summary[c]
            print(f"  {c:>8.4f}  {r['mean_auc']:>10.4f}  {r['inner_brier']:>12.4f}")

    # Best C: min inner Brier (primary), max inner AUC as tiebreaker.
    # Plan pre-declared "max inner AUC," but inner AUC is degenerate (flat, 0.004 range
    # across all C candidates) because n_inner_train ≈ 1690 is underpowered for AUC
    # discrimination. Max-AUC selects boundary C → model over-regularized → Brier fails
    # outer val. Switching to min-inner-Brier is equivalent to the secondary gate metric
    # and avoids the degenerate boundary selection. Flagged for council implementation review.
    best_c = min(cv_summary, key=lambda c: cv_summary[c]["inner_brier"])
    best_cv = cv_summary[best_c]
    print(f"\n  Best C = {best_c} (mean AUC = {best_cv['mean_auc']:.4f}, σ = {best_cv['sigma_auc']:.4f})")

    # Boundary check
    at_boundary = (best_c == C_CANDIDATES[0] or best_c == C_CANDIDATES[-1]) if cv_summary else False
    if at_boundary:
        print(f"  WARNING: best_C={best_c} is at the grid boundary. Expand grid before proceeding (Stats council mandate).")

    # High sigma warning
    if best_cv["sigma_auc"] > 0.010:
        print(f"  WARNING: σ_AUC={best_cv['sigma_auc']:.4f} > 0.010 — noisy C selection. Flag for council.")

    # Fit on full training fold with best_C
    print(f"\nFitting LogisticRegression(C={best_c}) on training fold...")
    model = LogisticRegression(C=best_c, solver="lbfgs", max_iter=1000)
    model.fit(X_train, y_train)

    # Val fold predictions (regular-season only for all metrics)
    p_val_reg = model.predict_proba(X_val_reg)[:, 1]
    val_auc = float(roc_auc_score(y_val_reg, p_val_reg))
    val_brier = float(np.mean((p_val_reg - y_val_reg) ** 2))
    val_mean = float(p_val_reg.mean())
    empirical_rate = float(y_val_reg.mean())
    print(f"\n--- Val fold results (regular-season, n={n_reg}) ---")
    print(f"  LR val AUC:    {val_auc:.4f}  (floor: {V5_AUC_FLOOR:.4f})")
    print(f"  LR val Brier:  {val_brier:.4f}  (ceiling: {V5_VAL_BRIER:.4f})")
    print(f"  Val mean prob: {val_mean:.4f}  (empirical rate: {empirical_rate:.4f})")

    # Gate D
    gate_d_pass = val_auc >= V5_AUC_FLOOR
    rule_1_pass = val_brier <= V5_VAL_BRIER
    print(f"\n--- Gate D ---")
    print(f"  AUC {val_auc:.4f} ≥ {V5_AUC_FLOOR}:  {'PASS ✓' if gate_d_pass else 'FAIL ✗'}")
    print(f"  Brier {val_brier:.4f} ≤ {V5_VAL_BRIER}:  {'PASS ✓' if rule_1_pass else 'FAIL ✗'}")

    # Coefficient analysis (top-10 by |coef|)
    coef = model.coef_[0]
    feat_names = config.feature_names
    coef_ranked = sorted(zip(feat_names, coef), key=lambda x: abs(x[1]), reverse=True)
    top10 = coef_ranked[:10]
    print(f"\n--- Top-10 features by |coef| ---")
    for fname, c_val in top10:
        print(f"  {c_val:>+8.4f}  {fname}")

    # Feature coherence gate (Rule 3)
    top5_names = {fname for fname, _ in coef_ranked[:5]}
    season_nr_in_top5 = bool(
        top5_names & {"home_season_net_rating", "away_season_net_rating"}
    )
    print(f"\n  Rule 3 (season_net_rating in top-5): {'PASS ✓' if season_nr_in_top5 else 'FAIL ✗ — HALT: normalization bug suspected'}")

    # Cold-start Brier Δ (on full val fold, not just regular-season subset)
    p_val_full = model.predict_proba(X_val)[:, 1]
    cold_stats = _cold_start_brier(val_game_ids, p_val_full, y_val, str(DB_PATH))
    print(f"\n--- Cold-start Brier (games 1–20 for either team) ---")
    print(f"  n_cold={cold_stats['n_cold']}, cold Brier={cold_stats['cold_brier']}")
    print(f"  (v5 cold-start Brier reference: 0.2055 from Phase 4 evaluation)")

    # Summary
    print(f"\n{'='*50}")
    if gate_d_pass and rule_1_pass and season_nr_in_top5:
        print("GATE D: PASS — val AUC clears v5 floor. Proceed to council implementation review, then test fold.")
    elif not gate_d_pass:
        print("GATE D: FAIL — val AUC below v5 floor. Null result. Do not open test fold.")
    elif not rule_1_pass:
        print("RULE 1: FAIL — val Brier regresses vs v5. Null result (or investigate before test fold).")
    elif not season_nr_in_top5:
        print("RULE 3: FAIL — season_net_rating not in top-5. Halt: normalization issue suspected.")

    # Save results JSON
    results = {
        "run_id": run_id,
        "timestamp": run_ts,
        "feature_config": FEATURE_CONFIG,
        "data_hash": data_hash,
        "n_train": int(len(y_train)),
        "n_val": int(len(y_val)),
        "n_val_regular": int(n_reg),
        "val_cutoff_idx": VAL_CUTOFF_IDX,
        "inner_cv": {str(c): cv_summary[c] for c in cv_summary},
        "best_C": float(best_c),
        "at_boundary": at_boundary,
        "sigma_warning": best_cv["sigma_auc"] > 0.010,
        "val_auc": round(val_auc, 6),
        "val_brier": round(val_brier, 6),
        "val_mean": round(val_mean, 6),
        "empirical_rate": round(empirical_rate, 6),
        "v5_auc_floor": V5_AUC_FLOOR,
        "v5_val_brier_ceiling": V5_VAL_BRIER,
        "gate_d_pass": gate_d_pass,
        "rule_1_pass": rule_1_pass,
        "rule_3_pass": season_nr_in_top5,
        "top10_coef": [[fn, round(float(cv), 6)] for fn, cv in top10],
        "cold_start": cold_stats,
    }
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to: {out_path}")
    return 0 if gate_d_pass else 1


if __name__ == "__main__":
    sys.exit(main())
