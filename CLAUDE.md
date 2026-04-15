# Claude operating rules — sportsdata

This file loads automatically at the start of every Claude Code session in this
repo. Rules here are durable context the model should follow without
re-explanation.

## Git hygiene (enforced by .claude/settings.json hooks)

1. **Never push to a branch that has already been merged.**
   Before running any `git push`, the harness auto-runs
   `.claude/hooks/check-branch-not-merged.sh`, which fetches `origin/main` and
   refuses the command if the current branch has no content-difference from
   `origin/main` (the signature of a squash-merged branch). `git commit` is
   intentionally NOT intercepted — local commits are recoverable, and pushes
   are the failure mode the hook exists to prevent. Don't work around the
   hook. If it fires: create a fresh branch from `origin/main`:

   ```
   git fetch origin main
   git checkout -b <new-branch-name> origin/main
   ```

   Historical context: Sprint 10.7 logged multiple incidents of pushing commits
   to branches that were already merged, because the session was operating on
   local branch state without fetching origin. The hook exists to make that
   mistake impossible rather than documented.

2. **Check origin state before writing any session handoff, commit message
   that references PR status, or debt-table update.** Specifically:
   `git fetch origin main && git log origin/main..HEAD` should inform any
   "what's shipped" narrative. Don't trust local state alone.

## Pull requests — do not auto-create

**Do NOT create a pull request unless the user explicitly asks for one.**
The `mcp__github__create_pull_request` tool is listed in
`.claude/settings.json` under `permissions.ask`, so Claude Code will prompt
the user every time Claude attempts to call it.

- "Commit and push" ≠ "open a PR". Push to the remote and stop.
- If a PR already exists for the branch, don't open a duplicate. Update the
  existing PR (comments / force-push / re-request review) only if asked.
- When in doubt, ask.

## Council discipline (user mandate, locked protocol)

Every substantive change — plan, implementation, or test results — runs
through the 5-expert council (`.harness/council/*.md`) in this order:

1. **Plan review** → iterate until CLEAR (or WARN with mitigations pre-declared)
2. **Implementation review** → iterate if FAIL
3. **Test / results review**

User should never be the first reviewer. Skipping council = CRITICAL FAILURE
per `feedback_council_discipline.md`. Math expert sits out reviews that have
no calculations (see persona spec).

## Pre-declared ship rules

Any A/B, benchmark, or model comparison must pre-declare its ship rules in a
`Plans/*.md` file before code is written. PR #29 (soccer Poisson null result)
is the canonical example of this discipline in practice — read
`Plans/soccer-poisson.md` and its post-implementation addendum for reference.
No ex-post movement of the ship bar.

## Doc hygiene

- `SESSION_LOG.md` "Next Session Pickup" block is stale after ~48 hours.
  Regenerate it from the Sprint-by-Sprint Log + git history, not from memory.
- `learnings.md` entries are append-only; don't edit past entries, add new
  ones.
- `Plans/*.md` entries are append-only once council-CLEAR. Post-mortems
  append an addendum; don't back-edit the plan-proper.

## Repo-specific

- Primary dev branch convention: `claude/<topic-slug>`. Don't push to `main`
  directly; always go through a feature branch.
- The branch designated by the user in any given session takes precedence
  over the convention above.
- Soccer-specific modeling work has its own in-progress debts (#24 Dixon-Coles
  τ, #25 Dixon-Coles ξ+MLE, #26 pre-2024 scrape). Read
  `Plans/soccer-poisson.md` and the addendum before touching
  `src/analysis/poisson.ts`.
