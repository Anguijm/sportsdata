# Learnings — sportsdata

Append-only log of compounding institutional knowledge. Entries are organized by session/sprint with KEEP / IMPROVE / INSIGHT / COUNCIL blocks. Past entries are immutable; new lessons append, never edit prior ones.

## Format

```
## YYYY-MM-DD — <session label>

### KEEP
- <pattern that worked, worth preserving>

### IMPROVE
- <pattern that didn't, with the proposed change>

### INSIGHT
- <new understanding about the codebase, the domain, or the harness>

### COUNCIL
- <verdict received, key remediation, lesson for the next round>
```

## Entries

<!-- New entries below this line. Do not edit entries above. -->

## 2026-05-01 — Sprint 10.23 — Phase 7 plan + debt sweep council close-out

### KEEP
- Sourcing SE for bootstrap CI from Phase 3's empirical block-bootstrap SE (scaled by √(N_old/N_new)) rather than deriving from marginal Brier σ. Paired-diff σ (~0.114) is much smaller than marginal Brier σ (~0.20); using the marginal value overstates CI width by ~75% and triggers unnecessary Math WARNs. See PR #67 rev2 fix, commit eb07240.
- Pre-declaring CI as the binding constraint (not the point-estimate floor) when power analysis shows the MDE > ship floor. For Phase 7: 80%-power MDE ≈ 0.009 > ship floor 0.005; pre-declaring this avoids post-hoc ambiguity.
- Merging `origin/main` into a branch immediately on PR open when the branch predates Phase C rollout. This is now a session-start checklist item for any branch opened from the pre-#66 era.

### IMPROVE
- Check whether a branch has `council.yml` *before* opening a PR, not after. A branch without the file will open, get no council reaction, and waste a trigger attempt. Fast check: `git show origin/<branch>:.github/workflows/council.yml 2>/dev/null || echo "MISSING"`. If missing, merge main first, then open the PR.
- Don't use `git commit --allow-empty` to trigger council on a branch that lacks the workflow files — the empty commit pushes but nothing fires. The fix is a main merge, not a trigger nudge.

### INSIGHT
- For same-repo `pull_request` events (non-fork), GitHub Actions uses the workflow files from the **HEAD branch**, not the base branch. Branches predating Phase C rollout have no `council.yml`, `ci.yml`, etc., so zero workflows fire on PR open/synchronize/reopen — even after empty commits. The fix is merging main into the branch. (Observed: PR #68, 2026-05-01.)
- SE for bootstrap CI on paired Brier diffs uses σ of the *differences*, not σ of the individual scores. Because the two models are scored on the same games, the paired σ (~0.114 for Phase 7 estimated from Phase 3) is far smaller than the marginal Brier σ (~0.20). The correct SE scaling: SE_new = SE_old × √(N_old / N_new). At N=1,237 this gives SE ≈ 0.0032, CI half-width ≈ 0.0063, 80%-power MDE ≈ 0.0090.
- Postseason games are a materially different prediction regime from regular season (shortened rotations, series-level adjustments, injury management). A model trained on regular-season data must NOT be evaluated on postseason games without a separate plan + council sign-off. Phase 7 domain expert FAIL (PR #67 round 1) codified this as a hard constraint.

### COUNCIL
- **PR #67 R1 → WARN (5/10):** Domain Expert FAIL — 2025-postseason test fold inappropriate for regular-season-trained model. Fix: shift to 2024-regular test fold; training trimmed to 2021–2022-regular; val fold 2023-regular; postseason explicitly de-scoped; Rule 4 upgraded from directional-only to CI-powered. Commits 43acbbe → ec00c3c.
- **PR #67 R2 → WARN (9/10):** Math Expert flagged (a) SE inconsistency (0.0033 in rule body vs 0.0057 in rationale — marginal vs paired-diff confusion) and (b) logit edge case (p=0/p=1 undefined). Fix: replaced rationale with Phase-3-scaled empirical SE derivation; added ε=1e-6 clipping spec for all percentage features. Commit eb07240.
- **PR #67 R3 → CLEAR (unanimous):** All 5 experts CLEAR. Domain Expert 10/10 (reversed from FAIL), Math Expert 10/10 (reversed from WARN). Plan locked on main at 635e826.
