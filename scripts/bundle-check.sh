#!/bin/bash
# left T-25: check that the bundled Pages build (scripts/bundle.mjs, .github/workflows/pages-bundle.yml) works like the plain docs/.
# usage: bash scripts/bundle-check.sh <repo root> [bundled port=8875] [plain port=8871] [run-all.sh regex]
#   1. builds the bundle into a NEW temp dir (bundle.mjs --stamp; it stops when a file cannot be joined safely)
#   2. node --check on every bundle and every minified lazy file
#   3. serves the bundled copy (tests/e2e/serve.py, PN_TARGET=staging); uses the server on the plain port (starts one if none)
#   4. tests/e2e/bundle-smoke-pw.js <bundled> <plain>: modules, styles, lazy files, part errors, unbundle fallback, service worker
#   5. optional regex: the same e2e tests (tests/e2e/run-all.sh, same mocks) on the bundled site
# Needs: npm ci, npx playwright install chromium, esbuild@0.24.0 (+ acorn@8 for the exact check) resolvable from scripts/:
#   npm install --no-save esbuild@0.24.0 acorn@8.12.1
# Never deletes anything (the temp dir stays in $TMPDIR). The servers it started are stopped at the end. Exit 0 = all pass.
set -u
R=$(cd "${1:?usage: bundle-check.sh <repo root> [bundled port] [plain port] [regex]}" && pwd); BP=${2:-8875}; PP=${3:-8871}; RX=${4:-}
T=$(mktemp -d "${TMPDIR:-/tmp}/pn-bundle.XXXXXX")
cp -r "$R/docs" "$T/docs"
node "$R/scripts/bundle.mjs" "$T/docs" --stamp || { echo "FAIL bundle.mjs did not build"; exit 1; }
for f in "$T"/docs/js/app.bundle*.js $(grep -oE '<script type="text/x-lazy"[^>]*src="\./[^"?]+' "$T/docs/index.html" | sed -E 's#.*src="\./##'); do
  case "$f" in /*) ;; *) f="$T/docs/$f" ;; esac
  node --check "$f" || { echo "FAIL syntax: $f"; exit 1; }
done
echo "PASS bundle builds; every bundle and lazy file parses ($T/docs)"
PIDS=""
PN_TARGET=staging python3 "$R/tests/e2e/serve.py" "$BP" "$T/docs" > "$T/serve-$BP.log" 2>&1 & PIDS="$PIDS $!"
if ! curl -s -o /dev/null -m 5 "http://127.0.0.1:$PP/index.html"; then
  PN_TARGET=staging python3 "$R/tests/e2e/serve.py" "$PP" "$R/docs" > "$T/serve-$PP.log" 2>&1 & PIDS="$PIDS $!"
fi
for p in $BP $PP; do for i in $(seq 1 30); do curl -sf -o /dev/null "http://127.0.0.1:$p/index.html" && break; sleep 1; done; done
rc=0
(cd "$R/tests/e2e" && node bundle-smoke-pw.js "$BP" "$PP") || rc=1
if [ -n "$RX" ]; then TEST_OUT="${TEST_OUT:-$R/tests/e2e/out}/bundle/" bash "$R/tests/e2e/run-all.sh" "$BP" "$BP" "$RX" || rc=1; fi
[ -n "$PIDS" ] && kill $PIDS 2>/dev/null
exit $rc
