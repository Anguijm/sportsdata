#!/usr/bin/env python3
"""
MLP trainer for Phase 3 step 5.

Architecture (pinned per addendum v13):
  [42 → 128 → ReLU → BatchNorm → Dropout(p) → 64 → ReLU → BatchNorm → Dropout(p) → 1 → Sigmoid]

Provides fit_mlp() and score_mlp() used by cv_runner.py.

Plan: Plans/nba-learned-model.md addendum v13.
"""

import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))

INPUT_DIM = 42

MLP_MAX_EPOCHS = 200
MLP_EARLY_STOP_PATIENCE = 20
MLP_BATCH_SIZE = 256


class _NBANet(nn.Module):
    def __init__(self, dropout: float = 0.0) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(INPUT_DIM, 128),
            nn.ReLU(),
            nn.BatchNorm1d(128),
            nn.Dropout(p=dropout),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.BatchNorm1d(64),
            nn.Dropout(p=dropout),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(1)


def fit_mlp(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    params: dict,
) -> _NBANet:
    """Train MLP with early stopping on val Brier. Returns best model."""
    lr = params.get("learning_rate", 0.001)
    dropout = params.get("dropout", 0.0)
    weight_decay = params.get("weight_decay", 0.0)
    seed = params.get("seed", 0)

    torch.manual_seed(seed)
    device = torch.device("cpu")

    X_tr = torch.tensor(X_train, dtype=torch.float32, device=device)
    y_tr = torch.tensor(y_train, dtype=torch.float32, device=device)
    X_v = torch.tensor(X_val, dtype=torch.float32, device=device)
    y_v = torch.tensor(y_val, dtype=torch.float32, device=device)

    dataset = TensorDataset(X_tr, y_tr)
    loader = DataLoader(dataset, batch_size=MLP_BATCH_SIZE, shuffle=True)

    model = _NBANet(dropout=dropout).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    criterion = nn.BCELoss()

    best_val_brier = float("inf")
    best_state = None
    patience_counter = 0

    for epoch in range(MLP_MAX_EPOCHS):
        model.train()
        for xb, yb in loader:
            optimizer.zero_grad()
            pred = model(xb)
            loss = criterion(pred, yb)
            loss.backward()
            optimizer.step()

        model.eval()
        with torch.no_grad():
            val_pred = model(X_v).cpu().numpy()
        val_brier = float(np.mean((val_pred - y_val) ** 2))

        if val_brier < best_val_brier:
            best_val_brier = val_brier
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
            patience_counter = 0
        else:
            patience_counter += 1
            if patience_counter >= MLP_EARLY_STOP_PATIENCE:
                break

    if best_state is not None:
        model.load_state_dict(best_state)
    return model


def score_mlp(model: _NBANet, X: np.ndarray) -> np.ndarray:
    """Return predicted probabilities (home win)."""
    model.eval()
    device = next(model.parameters()).device
    with torch.no_grad():
        preds = model(torch.tensor(X, dtype=torch.float32, device=device))
    return preds.cpu().numpy()
