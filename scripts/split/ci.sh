#!/usr/bin/env bash
# CI entry for the split guards. Usage: scripts/split/ci.sh [before-sha]   (run from the repo root, needs acorn + full git history)
#  1 ALWAYS: move.mjs --check + verify.mjs --structure  (valid for normal edits: state/writers = plan.json, headers, load order)
#  2 ONLY for a move commit (subject starts with "W2 step", or the commit touches scripts/split/steps/):
#    verify.mjs --base <parent of that commit>  (move-only proof: names/statements/comments byte-equal)
set -euo pipefail
BEFORE="${1:-}"
node scripts/split/move.mjs . --check
node scripts/split/verify.mjs --structure
if [ -n "$BEFORE" ] && [ "$BEFORE" != "0000000000000000000000000000000000000000" ] && git cat-file -e "$BEFORE^{commit}" 2>/dev/null; then
  RANGE=$(git rev-list --reverse "$BEFORE..HEAD")
else
  RANGE=$(git rev-parse HEAD)
fi
for c in $RANGE; do
  subj=$(git log -1 --format=%s "$c")
  if [[ "$subj" == "W2 step"* ]] || git diff-tree --no-commit-id --name-only -r "$c" | grep -q '^scripts/split/steps/'; then
    echo "move commit $c: $subj -> move-only proof against its parent"
    node scripts/split/verify.mjs --base "$c~1" --order d523f17040bca4dddad99abe36a1475bfc607a0a
  fi
done
