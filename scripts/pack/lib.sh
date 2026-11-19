# pack (A6): shared by data-overlay.sh and data-push.sh. Sourced, not run.
#   PN_DATA_REMOTE (default origin), PN_DATA_BRANCH (default data), PN_DATA_RETRY_SLEEP (seconds x try, default 5; tests: 0)
PACK_REMOTE=${PN_DATA_REMOTE:-origin}
PACK_BRANCH=${PN_DATA_BRANCH:-data}
PACK_REF=refs/pack/data
PACK_LIST=scripts/pack/data-paths.txt
# the paths of data-paths.txt (comments and blanks out); refuses a path that could leave the repo
pack_paths() {
  sed 's/[[:space:]]*#.*//; s/[[:space:]]*$//' "$PACK_LIST" | while read -r p; do
    [ -z "$p" ] && continue
    case "$p" in /*|*..*|*' '*) echo "pack: bad path in $PACK_LIST: $p" >&2; return 1 ;; esac
    echo "$p"
  done
}
# fetch branch `data` into $PACK_REF. Exit 1 = the branch does not exist (yet).
pack_fetch() {
  git fetch -q --no-tags --depth 1 "$PACK_REMOTE" "+refs/heads/$PACK_BRANCH:$PACK_REF" 2>/dev/null
}
