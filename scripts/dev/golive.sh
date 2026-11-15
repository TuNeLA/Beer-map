#!/bin/bash
# golive.sh: send the release commit to the work branch and to main (fast-forward). Coordinator only (CLAUDE.md hard rule).
# usage: bash scripts/dev/golive.sh [--wt <worktree>] [--repo <main clone>] [--branch big-update] [--remote origin]
#                                   [--mode auto|artifact|stamp-bot] [--dry-run]
#   --wt      the worktree whose HEAD is the release commit (default: the current folder). Its work must be committed.
#   --repo    a clone that has <branch> checked out and is fast-forwarded too (default: none; skip that step)
#   --mode    auto (default): reads sw.js on <remote>/main. VERSION "dev" = artifact, else stamp-bot.
#     artifact   after the switch (PAGES_DEPLOY = actions): main holds no stamps. If a data bot has put commits on main
#                (bars / hours / buildings, data files only), they are merged in (no conflict: only the bots write those files).
#                No "unstamp" commit. Most days main is already an ancestor and nothing is merged.
#     stamp-bot  the old path: main holds the stamp bot's commits. Merge main (-X ours), then put docs/index.html and
#                docs/sw.js back to the release state (one "unstamp" commit), so the work branch stays clean.
#   --dry-run   do everything except the two pushes (prints them). A merge of main, if one is needed, IS made in the worktree.
#   GOLIVE_TRAILER   extra lines for the merge commit messages (for example a Co-Authored-By line)
# After it: the deploy starts by itself (artifact mode: Actions → "Deploy live (Pages)"; stamp-bot mode: the stamp bot + Pages).
set -euo pipefail
WT=$(pwd); REPO=""; BR=big-update; REMOTE=origin; MODE=auto; DRY=0
while [ $# -gt 0 ]; do case "$1" in
  --wt) WT=$2; shift 2 ;; --repo) REPO=$2; shift 2 ;; --branch) BR=$2; shift 2 ;; --remote) REMOTE=$2; shift 2 ;;
  --mode) MODE=$2; shift 2 ;; --dry-run) DRY=1; shift ;;
  *) echo "unknown option $1 (see the top of $0)" >&2; exit 2 ;; esac; done
TR=${GOLIVE_TRAILER:-}
msg() { if [ -n "$TR" ]; then printf '%s\n\n%s\n' "$1" "$TR"; else printf '%s\n' "$1"; fi; }
cd "$WT"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "golive: $WT has uncommitted changes. Commit first." >&2; exit 1; }
git fetch -q "$REMOTE" main
if [ "$MODE" = auto ]; then
  sw=$(git show "$REMOTE/main:docs/sw.js")   # no pipe into grep -q here: with pipefail a closed pipe reads as "not found"
  case "$sw" in *'var VERSION = "dev";'*) MODE=artifact ;; *) MODE=stamp-bot ;; esac
fi
case "$MODE" in artifact|stamp-bot) ;; *) echo "golive: --mode must be auto, artifact or stamp-bot" >&2; exit 2 ;; esac
pre=$(git rev-parse HEAD)
if ! git merge-base --is-ancestor "$REMOTE/main" HEAD; then
  if [ "$MODE" = artifact ]; then
    # only data bot commits can be here; -X ours: if a lane changed the same data file, the release state wins until the next bot run
    git merge -q -X ours --no-edit "$REMOTE/main" -m "$(msg "merge main (data bots) into $BR")"
  else
    git merge -q -X ours --no-edit "$REMOTE/main" -m "$(msg "merge main (stamp bot) into $BR")"
    git checkout "$pre" -- docs/index.html docs/sw.js
    git diff --cached --quiet || git commit -q -m "$(msg "unstamp docs/index.html + docs/sw.js on $BR")"
  fi
fi
# the release must be clean in both modes: no ?v= and VERSION "dev" in the work branch (scripts/ci/stamp-guard.mjs checks more)
if grep -qE '\?v=[0-9a-f]{10}' docs/index.html || ! grep -q '^var VERSION = "dev";' docs/sw.js; then
  echo "golive: docs/index.html or docs/sw.js is stamped in the release commit. Run: node scripts/stamp.mjs docs --strip" >&2; exit 1
fi
h=$(git rev-parse --short=7 HEAD)
if [ -n "$REPO" ]; then
  git -C "$REPO" fetch -q "$REMOTE" "+refs/heads/$BR:refs/remotes/$REMOTE/$BR"
  git -C "$REPO" merge -q --ff-only "$h"
fi
if [ "$DRY" = 1 ]; then
  echo "dry run ($MODE): would push  $h -> $REMOTE/$BR  and  $h -> $REMOTE/main"
  git log --oneline "$REMOTE/main..$h" | head -20
  exit 0
fi
git -c push.negotiate=true push -q "$REMOTE" "$h:refs/heads/$BR"
git -c push.negotiate=true push -q "$REMOTE" "$h:refs/heads/main"
git fetch -q "$REMOTE" "+refs/heads/$BR:refs/remotes/$REMOTE/$BR"
echo "golive $h ($MODE) $(date +%H:%M:%S)"
