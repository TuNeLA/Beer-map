#!/bin/bash
# pack (A6): put the newest bot data (branch `data`) over THIS checkout, path by path (scripts/pack/data-paths.txt).
# Used after the switch (PAGES_DEPLOY = actions): by the deploy build (pages-bundle.yml, before build-site.mjs) and by each
# data bot before it runs (so the rolling refresh starts from the last run, not from main's old copy).
# A path that `data` does not have stays as it is. No branch `data` yet = nothing changes (exit 0).
# The changed files are working-tree changes only: never commit them to main (that is the old bot commit).
# usage: bash scripts/pack/data-overlay.sh          (in the repo root of a CI checkout)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
. scripts/pack/lib.sh
if ! pack_fetch; then echo "data-overlay: no branch $PACK_BRANCH on $PACK_REMOTE yet: the data files of this commit are used"; exit 0; fi
paths=$(pack_paths)
n=0
for p in $paths; do
  git cat-file -e "$PACK_REF:$p" 2>/dev/null || continue
  rm -rf -- "$p"
  git archive "$PACK_REF" -- "$p" | tar -x
  n=$((n + 1))
done
echo "data-overlay: $n of $(echo "$paths" | wc -w) data paths from branch $PACK_BRANCH $(git rev-parse --short "$PACK_REF") ($(git log -1 --format=%cs "$PACK_REF"))"
