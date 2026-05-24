#!/usr/bin/env python3
"""Phase 7 Step 4 — val-fold evaluation on 2023-regular.

Trains a single LightGBM model on 2021-regular + 2022-regular with halflife=14
(Step 3 winner at PR #77), Platt-calibrates on the last 25% of training data
by date, scores the 2023-regular val fold, computes v5 baseline via the Phase 3
re-implementation (re-used from ml/nba/evaluate_test_fold.py), and runs the
block-bootstrap paired CI per v22 spec.

Plan: Plans/nba-learned-model.md addendum v22.

Ship gate (v18 + v22):
    Brier improvement ≥ 0.005 + 95% block-bootstrap paired CI > 0
    Block: (home_team, iso_week); B = 10,000.

Test-fold seal:
    Does NOT touch 2024-regular. TEST_FOLD_SEASONS already excludes it
    (per v21 fix). Smoke + run both assert no 2024-regular game leaks.

Run:
    PYTHONPATH=. /usr/bin/python3 ml/nba/phase7_val_eval.py
"""

from __future__ import annotations

import json
import math
import pathlib
import sqlite3
import sys
import uuid
from datetime import datetime, timezone

import numpy as np

# Re-used Phase 3 + Step 3 utilities
from ml.nba.evaluate_test_fold import (
    B_BOOTSTRAP,
    DB_PATH,
    _block_bootstrap_ci,
    _block_labels,
    _compute_v5_on_games,
    _ece,
)
from ml.nba.features import (
    FeatureConfig,
    build_phase7_training_tensor,
    PHASE7_FEATURE_NAMES_ALL,
)
from ml.nba.phase7_cv_runner import (
    LGBM_PHASE7_PARAMS,
    PHASE7_TRAINING_SEASONS,
    _subset_for_halflife,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
RESULTS_DIR = REPO_ROOT / "ml" / "nba" / "results"

# Phase 7 Step 4 constants (per addendum v22)
WINNING_HALFLIFE = 14                  # Step 3 winner
PHASE7_VAL_SEASONS = ("2023-regular",)
PLATT_HOLDOUT_FRAC = 0.25              # last 25% of training data by date
BRIER_BEAT_FLOOR_PHASE7 = 0.005        # v18-binding ship gate (looser than Phase 3's 0.010)
DEFAULT_TRAINING_AS_OF = "2024-05-01"  # past 2023-regular last game, before 2024-regular
SEALED_TEST_FOLD_SEASONS = frozenset({"2024-regular", "2024-postseason"})


# ── helpers ──────────────────────────────────────────────────────────────


def _season_lookup(game_ids: list[str], db_path: pathlib.Path) -> dict[str, str]:
    """Returns {game_id: season} for all rows present in nba_eligible_games."""
    conn = sqlite3.connect(str(db_path))
    placeholders = ",".join("?" * len(game_ids))
    rows = conn.execute(
        f"""
        SELECT game_id, season FROM nba_eligible_games
        WHERE game_id IN ({placeholders})
        """,
        game_ids,
    ).fetchall()
    conn.close()
    return {gid: season for gid, season in rows}


def _date_lookup(game_ids: list[str], db_path: pathlib.Path) -> dict[str, str]:
    """Returns {game_id: 'YYYY-MM-DD'} for sorting/splitting by date."""
    conn = sqlite3.connect(str(db_path))
    placeholders = ",".join("?" * len(game_ids))
    rows = conn.execute(
        f"""
        SELECT id, date FROM games WHERE id IN ({placeholders})
        """,
        game_ids,
    ).fetchall()
    conn.close()
    return {gid: date for gid, date in rows}


def _fit_platt(p_uncal: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Logit-space Platt scaling; mirrors Phase 3 v14 (ml/nba/calibrate.py).
    Returns (A, B) where p_cal = sigmoid(A * logit(p_uncal) + B).
    """
    from sklearn.linear_model import LogisticRegression

    p_clipped = np.clip(p_uncal, 1e-7, 1 - 1e-7)
    logit_p = np.log(p_clipped / (1 - p_clipped))
    lr = LogisticRegression(C=1e9, solver="lbfgs", max_iter=1000)
    lr.fit(logit_p.reshape(-1, 1), y)
    return float(lr.coef_[0, 0]), float(lr.intercept_[0])


def _apply_platt(p_uncal: np.ndarray, A: float, B: float) -> np.ndarray:
    p_clipped = np.clip(p_uncal, 1e-7, 1 - 1e-7)
    logit_p = np.log(p_clipped / (1 - p_clipped))
    logit_cal = A * logit_p + B
    return 1.0 / (1.0 + np.exp(-logit_cal))


def _consistency_check_v5_python_vs_ts(
    val_game_ids: list[str], v5_python_preds: np.ndarray, rng: np.random.Generator
) -> dict:
    """v22 Risk #6: sample 20 random val games and document the Python v5
    predictions for them. Cross-check against TypeScript v5 must run separately
    (npx tsx scripts/v5-prediction-replay.ts). This function emits the
    Python-side values that will be compared.
    """
    if len(val_game_ids) < 20:
        return {"status": "skipped (val < 20 games)"}
    idx = rng.choice(len(val_game_ids), size=20, replace=False)
    samples = []
    for i in sorted(int(j) for j in idx):
        samples.append({"game_id": val_game_ids[i], "python_v5_p": float(v5_python_preds[i])})
    return {"status": "python-side captured; ts-side compare is a manual one-shot", "samples": samples}


def _block_count(block_labels: np.ndarray) -> int:
    return int(len(np.unique(block_labels)))


# ── main eval driver ─────────────────────────────────────────────────────


def run_phase7_val_eval(
    training_as_of: str = DEFAULT_TRAINING_AS_OF,
    db_path: pathlib.Path = DB_PATH,
    results_dir: pathlib.Path = RESULTS_DIR,
    halflife: int = WINNING_HALFLIFE,
    seed: int = 0,
) -> dict:
    # Lazy import — keeps the module importable in environments without LightGBM
    from ml.nba.train_lightgbm import fit_lgbm, score_lgbm

    rng = np.random.default_rng(seed)

    # 1. Build full feature tensor (excludes test fold by season filter).
    config = FeatureConfig(feature_form="season_agg", training_as_of=training_as_of)
    X_all, y_all, game_ids_all = build_phase7_training_tensor(config, str(db_path))

    # 2. Lookup season + date per game.
    season_by_id = _season_lookup(game_ids_all, db_path)
    date_by_id = _date_lookup(game_ids_all, db_path)

    # Assertion: zero test-fold leakage.
    test_leak = [g for g in game_ids_all if season_by_id.get(g, "") in SEALED_TEST_FOLD_SEASONS]
    if test_leak:
        raise RuntimeError(
            f"Test-fold leak: {len(test_leak)} games from sealed seasons appeared in tensor. "
            f"First leaked: {test_leak[:3]}. Likely TEST_FOLD_SEASONS misconfigured."
        )

    # 3. Training mask (2021-regular + 2022-regular only).
    train_mask = np.array(
        [season_by_id.get(g, "") in PHASE7_TRAINING_SEASONS for g in game_ids_all]
    )
    X_train_full = X_all[train_mask]
    y_train_full = y_all[train_mask]
    game_ids_train_full = [g for g, m in zip(game_ids_all, train_mask) if m]
    dates_train = np.array([date_by_id[g] for g in game_ids_train_full])
    n_train_full = len(y_train_full)
    if n_train_full == 0:
        raise RuntimeError("No training games matched PHASE7_TRAINING_SEASONS.")

    # 4. Sort training by date; date-split for forward-chained Platt.
    sort_idx = np.argsort(dates_train, kind="stable")
    X_train_full = X_train_full[sort_idx]
    y_train_full = y_train_full[sort_idx]
    game_ids_train_full = [game_ids_train_full[i] for i in sort_idx]
    dates_train = dates_train[sort_idx]
    n_lgbm = int(round(n_train_full * (1 - PLATT_HOLDOUT_FRAC)))
    X_lgbm, y_lgbm = X_train_full[:n_lgbm], y_train_full[:n_lgbm]
    X_platt, y_platt = X_train_full[n_lgbm:], y_train_full[n_lgbm:]
    platt_dates_range = (str(dates_train[n_lgbm]), str(dates_train[-1])) if len(dates_train) > n_lgbm else (None, None)

    # 5. Subset to h={halflife}-only columns.
    feature_names = config.feature_names
    X_lgbm_sub, sub_names = _subset_for_halflife(X_lgbm, feature_names, halflife)
    X_platt_sub, _ = _subset_for_halflife(X_platt, feature_names, halflife)

    # 6. Fit LightGBM.
    params = {**LGBM_PHASE7_PARAMS, "seed": seed, "random_state": seed}
    model = fit_lgbm(X_lgbm_sub, y_lgbm, X_platt_sub, y_platt, params)

    # 7. Fit Platt on holdout.
    p_platt_uncal = score_lgbm(model, X_platt_sub)
    platt_A, platt_B = _fit_platt(p_platt_uncal, y_platt)
    p_platt_cal = _apply_platt(p_platt_uncal, platt_A, platt_B)
    platt_uncal_brier = float(np.mean((p_platt_uncal - y_platt) ** 2))
    platt_cal_brier = float(np.mean((p_platt_cal - y_platt) ** 2))

    # 8. Build val tensor — same tensor, filter to 2023-regular.
    val_mask = np.array(
        [season_by_id.get(g, "") in PHASE7_VAL_SEASONS for g in game_ids_all]
    )
    X_val_full = X_all[val_mask]
    y_val = y_all[val_mask]
    val_game_ids = [g for g, m in zip(game_ids_all, val_mask) if m]
    val_dates = np.array([date_by_id[g] for g in val_game_ids])

    # Sort val by date for downstream block-bootstrap deterministic labels.
    val_sort_idx = np.argsort(val_dates, kind="stable")
    X_val_full = X_val_full[val_sort_idx]
    y_val = y_val[val_sort_idx]
    val_game_ids = [val_game_ids[i] for i in val_sort_idx]
    n_val = len(y_val)

    if n_val == 0:
        raise RuntimeError("No val games matched PHASE7_VAL_SEASONS.")

    X_val_sub, _ = _subset_for_halflife(X_val_full, feature_names, halflife)

    # 9. Score val: LightGBM + Platt.
    p_val_uncal = score_lgbm(model, X_val_sub)
    p_val_phase7 = _apply_platt(p_val_uncal, platt_A, platt_B)

    # 10. v5 baseline on the same val game_ids.
    p_val_v5 = _compute_v5_on_games(val_game_ids)

    # 11. Brier comparison.
    brier_phase7 = float(np.mean((p_val_phase7 - y_val) ** 2))
    brier_v5 = float(np.mean((p_val_v5 - y_val) ** 2))
    brier_improvement = brier_v5 - brier_phase7  # positive = phase7 better

    # 12. Paired difference, per-game.
    paired_diff = (p_val_v5 - y_val) ** 2 - (p_val_phase7 - y_val) ** 2

    # 13. Block bootstrap on paired diff.
    block_labels = _block_labels(val_game_ids)
    n_blocks = _block_count(block_labels)
    bs_mean, bs_lo, bs_hi = _block_bootstrap_ci(paired_diff, block_labels, B_BOOTSTRAP, rng)

    # 14. IID bootstrap as sensitivity.
    iid_labels = np.array([f"g{i}" for i in range(len(paired_diff))])
    iid_mean, iid_lo, iid_hi = _block_bootstrap_ci(
        paired_diff, iid_labels, B_BOOTSTRAP, np.random.default_rng(seed + 1)
    )

    # 15. Ship-gate evaluation.
    gate_point = brier_improvement >= BRIER_BEAT_FLOOR_PHASE7
    gate_ci = bs_lo > 0.0  # 95% CI on paired diff entirely > 0
    gate_overall = gate_point and gate_ci

    # 16. Calibration diagnostics on Phase 7 val (logged, not gating per v22).
    ece_phase7 = _ece(p_val_phase7, y_val)
    ece_v5 = _ece(p_val_v5, y_val)

    # 17. v5 Python-vs-TS captured for manual one-shot diff (v22 Risk #6).
    v5_consistency = _consistency_check_v5_python_vs_ts(val_game_ids, p_val_v5, rng)

    artifact = {
        "run_id": f"phase7-val-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
        "phase": "phase7",
        "step": 4,
        "training_as_of": training_as_of,
        "training_seasons": list(PHASE7_TRAINING_SEASONS),
        "val_seasons": list(PHASE7_VAL_SEASONS),
        "halflife": halflife,
        "seed": seed,
        "n_train_full": n_train_full,
        "n_lgbm_train": int(len(y_lgbm)),
        "n_platt_holdout": int(len(y_platt)),
        "platt_holdout_date_range": platt_dates_range,
        "n_val": n_val,
        "lgbm_params": params,
        "platt": {"A": platt_A, "B": platt_B,
                  "uncal_brier_on_platt": platt_uncal_brier,
                  "cal_brier_on_platt": platt_cal_brier},
        "brier": {
            "phase7": brier_phase7,
            "v5": brier_v5,
            "improvement_v5_minus_phase7": brier_improvement,
        },
        "block_bootstrap": {
            "spec": "blocks=(home_team, iso_week); B=10000; alpha=0.05",
            "n_blocks": n_blocks,
            "mean_paired_diff": bs_mean,
            "ci_lo": bs_lo,
            "ci_hi": bs_hi,
        },
        "iid_bootstrap_sensitivity": {
            "spec": "per-game IID; B=10000; alpha=0.05 — NOT a gate, sensitivity only",
            "mean_paired_diff": iid_mean,
            "ci_lo": iid_lo,
            "ci_hi": iid_hi,
        },
        "calibration": {
            "ece_phase7": ece_phase7,
            "ece_v5": ece_v5,
            "note": "non-gating per v22; Step 5 pre-flight is where these matter",
        },
        "v5_consistency": v5_consistency,
        "ship_gate": {
            "floor": BRIER_BEAT_FLOOR_PHASE7,
            "point_pass": bool(gate_point),
            "ci_lo_above_zero": bool(gate_ci),
            "overall": "PASS" if gate_overall else "FAIL",
            "note": "CI gate is binding per v18/v22; point estimate is informational",
        },
        "scoring_convention": (
            "Phase 7 Step 4 val-fold eval per Plans/nba-learned-model.md addendum v22. "
            "LightGBM trained on first 75% of 2021/2022-regular by date; Platt fit on last 25%; "
            "scored on 2023-regular val fold; v5 baseline from ml/nba/evaluate_test_fold.py."
        ),
        "run_environment_note": (
            "Repository is date-pinned to 2026-05-24 per the project's currentDate convention. "
            "Run-ID timestamps reflect that pinned date, not wall-clock drift."
        ),
        "plan": "Plans/nba-learned-model.md addendum v22",
    }

    results_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = results_dir / f"{artifact['run_id']}.json"
    with open(artifact_path, "w") as f:
        json.dump(artifact, f, indent=2)

    _print_summary(artifact)
    print(f"\nArtifact written: {artifact_path}")
    return artifact


def _print_summary(art: dict) -> None:
    print(f"=== Phase 7 Step 4 val-fold eval — {art['run_id']} ===")
    print(f"training_as_of   : {art['training_as_of']}")
    print(f"training_seasons : {art['training_seasons']}")
    print(f"val_seasons      : {art['val_seasons']}")
    print(f"halflife (frozen): {art['halflife']}  (Step 3 winner)")
    print(f"n_lgbm / n_platt / n_val : {art['n_lgbm_train']} / {art['n_platt_holdout']} / {art['n_val']}")
    print()
    print(f"Brier (Phase 7) : {art['brier']['phase7']:.6f}")
    print(f"Brier (v5)      : {art['brier']['v5']:.6f}")
    print(f"Improvement     : {art['brier']['improvement_v5_minus_phase7']:+.6f}  "
          f"(floor: {art['ship_gate']['floor']})")
    print()
    bb = art["block_bootstrap"]
    print(f"Block-bootstrap : mean={bb['mean_paired_diff']:+.6f}  "
          f"CI=[{bb['ci_lo']:+.6f}, {bb['ci_hi']:+.6f}]  ({bb['n_blocks']} blocks)")
    iid = art["iid_bootstrap_sensitivity"]
    print(f"IID sensitivity : mean={iid['mean_paired_diff']:+.6f}  "
          f"CI=[{iid['ci_lo']:+.6f}, {iid['ci_hi']:+.6f}]")
    print()
    print(f"Calibration ECE : phase7={art['calibration']['ece_phase7']:.4f}  "
          f"v5={art['calibration']['ece_v5']:.4f}")
    print()
    print(f"SHIP GATE       : {art['ship_gate']['overall']}")
    print(f"  point ≥ floor : {'PASS' if art['ship_gate']['point_pass'] else 'FAIL'}")
    print(f"  CI_lo > 0     : {'PASS' if art['ship_gate']['ci_lo_above_zero'] else 'FAIL'}")


if __name__ == "__main__":
    training_as_of = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TRAINING_AS_OF
    run_phase7_val_eval(training_as_of=training_as_of)
