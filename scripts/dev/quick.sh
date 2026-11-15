#!/bin/bash
# quick.sh: the merge check in one command. Guards + the named e2e tests, side by side, one PASS/FAIL table at the end.
# usage: bash scripts/dev/quick.sh [options] [test names…]        (run from anywhere; it works on the repo it lives in)
#   test names = suite names of tests/e2e/run-all.sh (main, x8, start1, mycount …). No names = guards only.
#   --ports A B     the two test servers (default 8793 8871). A server that is down is started here (tests/e2e/serve.py,
#                   PN_TARGET=staging) and stopped at the end; a server that is up is used and left alone.
#   --par N         e2e tests at once (default 2 = the machine's limit; one test = one browser job)
#   --queue "cmd"   run every browser job through a queue, e.g. --queue "sh scripts/dev/pwq.sh coord" (env PN_PWQ does the same).
#                   Use it when lanes share the machine: each test then waits for a free slot.
#   --no-guards     only the e2e tests           --bundled   also build the live site and run the tests on it (ports A/B must be free)
#   --keep          keep the logs folder (it is printed; default: kept only when something failed)
# Guards (the same as guards.yml in CI): unit tests, quality gate, split guard, stamp guard, no-anchor-patch, shard guard,
#   rpc bundle names, workflow YAML, every e2e file parses. tests/quality/report.json is put back after the quality gate.
# Exit code: 0 = all PASS, 1 = a guard or a test failed, 2 = cannot start.
set -u
R=$(cd "$(dirname "$0")/../.." && pwd); cd "$R" || exit 2
A=8793; B=8871; PARN=2; GUARDS=1; KEEP=0; BUNDLED=0; Q=${PN_PWQ:-}; TESTS=()
while [ $# -gt 0 ]; do case "$1" in
  --ports) A=$2; B=$3; shift 3 ;; --par) PARN=$2; shift 2 ;; --queue) Q=$2; shift 2 ;; --no-guards) GUARDS=0; shift ;;
  --bundled) BUNDLED=1; shift ;; --keep) KEEP=1; shift ;; -h|--help) sed -n 2,17p "$0"; exit 0 ;;
  -*) echo "unknown option $1" >&2; exit 2 ;; *) TESTS+=("$1"); shift ;; esac; done
OUT=$(mktemp -d "${TMPDIR:-/tmp}/pn-quick.XXXXXX"); T0=$(date +%s); STARTED=""
cleanup() { [ -n "$STARTED" ] && kill $STARTED 2>/dev/null; git checkout -q -- tests/quality/report.json 2>/dev/null; }
trap cleanup EXIT

# every name must be a suite of run-all.sh (a typo would run nothing and look green)
if [ ${#TESTS[@]} -gt 0 ]; then
  KNOWN=$(node -e 'import("./scripts/ci/plan.mjs").then((m)=>console.log(m.suites(require("fs").readFileSync("tests/e2e/run-all.sh","utf8")).map((s)=>s.name).join(" ")))')
  for t in "${TESTS[@]}"; do case " $KNOWN " in *" $t "*) ;; *) echo "quick: no suite '$t' in tests/e2e/run-all.sh" >&2; exit 2 ;; esac; done
fi

# ---- guards: all at once, in the background ----
guard() {   # name command…
  local n=$1; shift
  ( t=$(date +%s); "$@" > "$OUT/guard-$n.log" 2>&1; rc=$?; echo "$rc $(( $(date +%s)-t ))" > "$OUT/guard-$n.rc" ) &
}
if [ $GUARDS = 1 ]; then
  guard unit       node --test "tests/unit/*.test.mjs"
  guard quality    node tests/quality/check.mjs .
  guard split      bash scripts/split/ci.sh
  guard stamp      node scripts/ci/stamp-guard.mjs docs
  guard anchor     node scripts/ci/no-anchor-patch.mjs .
  guard shards     node scripts/ci/shard-guard.mjs .
  guard rpc-names  node scripts/ci/bundle-allow.mjs .
  guard workflows  python3 -c "import glob,yaml; [yaml.safe_load(open(f)) for f in glob.glob('.github/workflows/*.yml')]"
  guard parse      bash -c 'for f in tests/e2e/*.js scripts/ci/*.mjs scripts/*.mjs; do node --check "$f" || exit 1; done'
fi

# ---- e2e: servers, then each test as its own job (PARN at once, through the queue when one is given) ----
serve() {   # port dir
  curl -s -o /dev/null -m 3 "http://127.0.0.1:$1/index.html" && return 0
  PN_TARGET=staging python3 tests/e2e/serve.py "$1" "$2" > "$OUT/serve-$1.log" 2>&1 & STARTED="$STARTED $!"
  for i in $(seq 1 30); do curl -sf -o /dev/null "http://127.0.0.1:$1/index.html" && return 0; sleep 0.5; done
  echo "quick: could not start a server on port $1" >&2; return 1
}
e2e() {   # tag portA portB plain-port names…
  local tag=$1 pa=$2 pb=$3 pp=$4; shift 4
  for t in "$@"; do
    while [ "$(alive)" -ge "$PARN" ]; do sleep 0.5; done   # only the e2e jobs count (the guards run beside them)
    ( PLAIN_PORT=$pp TEST_OUT="$OUT/$tag-$t/" $Q bash tests/e2e/run-all.sh "$pa" "$pb" "^($t)\$" > "$OUT/$tag-$t.log" 2>&1; echo $? > "$OUT/$tag-$t.rc" ) &
    EPIDS="$EPIDS $!"
  done
}
EPIDS=""
alive() { local n=0 p; for p in $EPIDS; do kill -0 "$p" 2>/dev/null && n=$((n+1)); done; echo $n; }
if [ ${#TESTS[@]} -gt 0 ]; then
  serve "$A" docs && serve "$B" docs || exit 2
  e2e plain "$A" "$B" "" "${TESTS[@]}"
  if [ $BUNDLED = 1 ]; then
    while [ "$(alive)" -gt 0 ]; do sleep 0.5; done
    node scripts/build-site.mjs --out "$OUT/site" --bundle on > "$OUT/build-site.log" 2>&1 || { echo "quick: build-site failed"; tail -5 "$OUT/build-site.log"; exit 1; }
    BA=$((A+100)); BB=$((B+100))
    serve "$BA" "$OUT/site/docs" && serve "$BB" "$OUT/site/docs" || exit 2
    e2e bundled "$BA" "$BB" "$B" bundle-smoke "${TESTS[@]}"
  fi
fi
wait

# ---- the table ----
FAIL=0
printf '\n%-22s %-6s %6s  %s\n' CHECK RESULT TIME NOTE
for f in "$OUT"/guard-*.rc; do
  [ -f "$f" ] || continue
  n=$(basename "$f" .rc); n=${n#guard-}; read -r rc secs < "$f"
  note=$(grep -E '^# (tests|pass|fail) |quality|verify OK|stamp-guard ok|shard-guard ok|ok$' "$OUT/guard-$n.log" | tail -3 | tr '\n' ' ' | cut -c1-90)
  if [ "$rc" = 0 ]; then res=PASS; else res=FAIL; FAIL=1; note=$(tail -n 3 "$OUT/guard-$n.log" | tr '\n' ' ' | cut -c1-160); fi
  printf '%-22s %-6s %5ss  %s\n' "guard $n" $res "$secs" "$note"
done
for f in "$OUT"/plain-*.rc "$OUT"/bundled-*.rc; do
  [ -f "$f" ] || continue
  n=$(basename "$f" .rc); rc=$(cat "$f")
  row=$(grep -E "^${n#*-} +[0-9-]+ +[0-9-]+ +(ok|flaky|FAIL|skip|spec)" "$OUT/$n.log" | tail -1)
  p=$(echo "$row" | awk '{print $2}'); fl=$(echo "$row" | awk '{print $3}'); st=$(echo "$row" | awk '{print $4}')
  secs=$(grep -oE '\(([0-9]+)s\)' "$OUT/$n.log" | tail -1 | tr -d '()s')
  if [ "$rc" = 0 ] && [ -n "$row" ]; then res=PASS; else res=FAIL; FAIL=1; fi
  note="pass=$p fail=$fl $st"; [ "$res" = FAIL ] && note="$note $(grep -E '^ +\[.*\] FAIL' "$OUT/$n.log" | head -2 | cut -c1-140 | tr '\n' ' ')$(grep -E 'is down|does not serve' "$OUT/$n.log" | head -1)"
  printf '%-22s %-6s %5ss  %s\n' "e2e $n" $res "${secs:-?}" "$note"
done
echo
if [ $FAIL = 0 ]; then echo "quick: ALL PASS in $(( $(date +%s)-T0 )) s"; [ $KEEP = 1 ] && echo "logs: $OUT"
else echo "quick: FAIL in $(( $(date +%s)-T0 )) s. Logs: $OUT"; fi
exit $FAIL
