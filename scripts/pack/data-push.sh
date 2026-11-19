#!/bin/bash
# pack (A6): commit a data bot's output to branch `data` (NOT main) and push it. After the switch (PAGES_DEPLOY = actions).
# usage: bash scripts/pack/data-push.sh "<commit message>" <path>...     (paths: a subset of scripts/pack/data-paths.txt)
#   Copies each given path from this checkout into a temporary worktree of `data` (first run: a new branch with no history
#   from main), commits only when something changed, pushes. Another bot pushed first: start again from the new `data`
#   (each bot writes its own paths, so nothing is lost). A path the bot did not make this time keeps its last copy.
#   Pushing `data` starts no workflow (no workflow listens to it); the deploy starts from the bot's end (workflow_run).
set -euo pipefail
MSG=${1:?usage: data-push.sh "<message>" <path>...}; shift
[ $# -gt 0 ] || { echo "data-push: no paths" >&2; exit 2; }
cd "$(git rev-parse --show-toplevel)"
. scripts/pack/lib.sh
allowed=" $(pack_paths | tr '\n' ' ') "
for p in "$@"; do
  case "$allowed" in *" $p "*) ;; *) echo "data-push: $p is not in $PACK_LIST (the deploy would not use it)" >&2; exit 2 ;; esac
done
NAME=$(git config user.name || echo "github-actions[bot]")
MAIL=$(git config user.email || echo "41898282+github-actions[bot]@users.noreply.github.com")
for try in 1 2 3 4; do
  W=$(mktemp -d)
  if pack_fetch; then
    git worktree add -q --detach "$W" "$PACK_REF"
  else
    git worktree add -q --detach "$W" HEAD
    git -C "$W" checkout -q --orphan pack-data-new
    git -C "$W" rm -rqf .
  fi
  for p in "$@"; do
    [ -e "$p" ] || { echo "data-push: $p was not made this run: the last copy on $PACK_BRANCH stays"; continue; }
    rm -rf -- "${W:?}/$p"; mkdir -p "$W/$(dirname "$p")"; cp -a -- "$p" "$W/$p"
  done
  git -C "$W" add -A .
  if git -C "$W" diff --cached --quiet; then
    echo "data-push: no change on $PACK_BRANCH"; git worktree remove --force "$W"; exit 0
  fi
  git -C "$W" -c user.name="$NAME" -c user.email="$MAIL" commit -q -m "$MSG"
  if git -C "$W" push -q "$PACK_REMOTE" "HEAD:refs/heads/$PACK_BRANCH"; then
    echo "data-push: $PACK_BRANCH $(git -C "$W" rev-parse --short HEAD): $(git -C "$W" show --stat --format= HEAD | tail -1)"
    git worktree remove --force "$W"; exit 0
  fi
  git worktree remove --force "$W"; echo "data-push: push refused (another bot was first?), try $try"; sleep $((try * ${PN_DATA_RETRY_SLEEP:-5}))
done
echo "data-push: could not push $PACK_BRANCH" >&2; exit 1
