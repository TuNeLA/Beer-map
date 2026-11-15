#!/bin/bash
# Check on your machine that the LIVE BUILD works like the plain docs/ (the same thing CI does in the `gate` shards and the
# deploy does before it goes live). ci1: it now uses scripts/build-site.mjs, the deploy's own build.
# usage: bash scripts/bundle-check.sh <repo root> [bundled port=8875] [plain port=8871] [run-all.sh regex]
#   1. builds the site into a NEW temp dir (build-site.mjs --bundle on: bundle groups, stamp, checks, build.json)
#   2. serves the built copy (tests/e2e/serve.py, PN_TARGET=staging); uses the server on the plain port (starts one if none)
#   3. tests/e2e/run-all.sh on the built site: bundle-smoke (modules, styles, lazy files, part errors, unbundle fallback,
#      service worker offline) + ci1 (start requests, cheap update, PN_BUILD, artifact) + the regex you give
#      (default: the deploy gate of tests/e2e/shards.txt)
# Needs: npm ci (playwright, esbuild, acorn), npx playwright install chromium.
# Never deletes anything (the temp dir stays in $TMPDIR). The servers it started are stopped at the end. Exit 0 = all pass.
set -u
R=$(cd "${1:?usage: bundle-check.sh <repo root> [bundled port] [plain port] [regex]}" && pwd); BP=${2:-8875}; PP=${3:-8871}
RX=${4:-$(node -e 'import(process.argv[1]+"/scripts/ci/plan.mjs").then((m)=>{const g=m.parseShards(require("fs").readFileSync(process.argv[1]+"/tests/e2e/shards.txt","utf8")).filter((s)=>s.gate);console.log("^("+g.map((s)=>s.filter.replace(/^\^\(|\)\$$/g,"")).join("|")+")$")})' "$R")}
T=$(mktemp -d "${TMPDIR:-/tmp}/pn-bundle.XXXXXX")
node "$R/scripts/build-site.mjs" --repo "$R" --out "$T/site" --bundle on || { echo "FAIL build-site.mjs did not build"; exit 1; }
echo "PASS the site builds ($T/site/docs)"
PIDS=""
PN_TARGET=staging python3 "$R/tests/e2e/serve.py" "$BP" "$T/site/docs" > "$T/serve-$BP.log" 2>&1 & PIDS="$PIDS $!"
if ! curl -s -o /dev/null -m 5 "http://127.0.0.1:$PP/index.html"; then
  PN_TARGET=staging python3 "$R/tests/e2e/serve.py" "$PP" "$R/docs" > "$T/serve-$PP.log" 2>&1 & PIDS="$PIDS $!"
fi
for p in $BP $PP; do for i in $(seq 1 30); do curl -sf -o /dev/null "http://127.0.0.1:$p/index.html" && break; sleep 1; done; done
rc=0
PLAIN_PORT=$PP TEST_OUT="${TEST_OUT:-$R/tests/e2e/out}/bundle/" bash "$R/tests/e2e/run-all.sh" "$BP" "$BP" "$RX" || rc=1
[ -n "$PIDS" ] && kill $PIDS 2>/dev/null
exit $rc
