#!/usr/bin/env bash
# PreToolUse hook for Bash commands. Blocks `git push` on a branch whose
# contents are already merged into origin/main — the exact failure mode from
# learnings.md "session-handoff-discipline" (pushing to a branch that had
# already been squash-merged).
#
# Scope: `git push` only, NOT `git commit`. Commits are local and recoverable
# (cherry-pick to a fresh branch); pushes are the risky op. Checking at commit
# time also misfires on the first commit of a new branch created from main,
# when HEAD..origin/main is empty until after the commit lands (Codex P1).
#
# Detection heuristic: if the current branch is not main/master AND the
# directory diff between origin/main and HEAD is empty, the branch's content
# is already in main — it was squash-merged or rebase-merged.
#
# Input: JSON from stdin (Claude Code hook contract), with .tool_input.command.
# Output: on block, stdout JSON with hookSpecificOutput.permissionDecision=deny.
#         on allow, exit 0 with no output.
#
# Never blocks unrelated bash commands, never blocks pushes on main/master,
# and never blocks if origin/main is unreachable (fail-open on infra errors).

set -u

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# Only intercept `git push`. Match with word boundary so `git pushd` doesn't
# false-positive. `git commit` is explicitly NOT matched — see header comment.
if ! echo "$cmd" | grep -qE '(^|[[:space:]])git[[:space:]]+push([[:space:]]|$)'; then
  exit 0
fi

# debt #30: false-positive guard — if the command also contains `git commit`,
# the commit runs before the push (shell && semantics), so new content will
# exist by the time push executes. Allow the chain unconditionally.
if echo "$cmd" | grep -qE '(^|[[:space:]])git[[:space:]]+commit([[:space:]]|$|[[:space:]]-)'; then
  exit 0
fi

# Must be inside a git repo; silently allow if not.
toplevel=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$toplevel" ]; then
  exit 0
fi
cd "$toplevel"

branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
if [ -z "$branch" ] || [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  exit 0
fi

# Try to fetch origin/main. Fail-open on network/auth errors.
git fetch origin main --quiet 2>/dev/null || true
if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
  exit 0
fi

# Empty content-diff between branch and origin/main => already merged.
diff_files=$(git diff origin/main..HEAD --name-only 2>/dev/null || true)
if [ -n "$diff_files" ]; then
  exit 0
fi

# Block with an actionable message.
reason="BLOCKED: current branch '$branch' has no content-difference from origin/main."
reason="$reason This typically means the branch was already merged (squash/rebase)."
reason="$reason Any new commits here will be orphaned. Create a fresh branch from main:"
reason="$reason   git fetch origin main && git checkout -b <new-branch> origin/main"
reason="$reason If you genuinely intend to add more commits to this merged branch,"
reason="$reason disable the hook for this invocation or override in settings.json."

# Emit the permission-decision JSON. jq produces well-formed output.
jq -nc \
  --arg reason "$reason" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
