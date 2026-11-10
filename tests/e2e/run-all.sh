#!/bin/bash
# PintsNow canonical regression suite. Runs every test ONE AT A TIME (shared machine). Server calls are mocked; anything
# not mocked goes to the STAGING project (PN_TARGET=staging, default), never to live.
# usage: bash run-all.sh <port-A, e.g. 8793> <port-B, e.g. 8871> [name-filter-regex]
#   port A: map tests (map3-lib: page served as tunela.github.io/Beer-map/, real Mapbox tiles, mocked Supabase)
#   port B: UI tests (d2-helpers / ds-helpers: mocked Supabase)
# Both ports must serve <repo>/docs with tests/e2e/serve.py (PN_TARGET=staging python3 tests/e2e/serve.py <port> docs).
# PN_TARGET=staging (default) | live: which Supabase project the served config.js points at. run-all.sh checks it.
# A test that fails is run once more; the 2nd run decides. "flaky" = failed once, passed on the rerun.
# Logs: tests/e2e/out/logs/<name>.<try>.log (or $TEST_OUT/logs)   Summary: .../logs/summary.txt   Exit code: 0 = all pass, 1 = any fail.
# Map tests need a Mapbox token in env MAPBOX_TEST_TOKEN. Without it they are SKIPPED (status "skip", not a fail).
# Setup once: npm ci && npx playwright install chromium   (from the repo root)
# STATUS: ok | flaky (failed once, passed on rerun) | FAIL (counts) | spec (target test for unmerged work, does not count) | skip (no Mapbox token).
# Live-server tests are NOT in this list on purpose (they create real users): beta-pw.js, games3, move-pw, zones-live.
D=$(cd "$(dirname "$0")" && pwd)
A=${1:-8793}; B=${2:-8871}; FILTER=${3:-.}; REPO=${REPO:-$(cd "$D/../.." && pwd)}; TO=${TO:-900}
OUT=${TEST_OUT:-$D/out}; LOG=$OUT/logs; mkdir -p $LOG
for p in $A $B; do
  curl -s -o /dev/null -m 10 http://127.0.0.1:$p/index.html || { echo "server on port $p is down"; exit 2; }
done
# Supabase target (one switch): PN_TARGET=staging (default) | live. tests/e2e/serve.py serves config.js for that target.
# The served config.js must point at the same project, else stop (a plain http.server serves the live config).
TARGET=${PN_TARGET:-staging}
case $TARGET in staging) REF=vdtmzsxajpvzwwbhnfmr;; live) REF=wcdskpcevbhouvbytkhv;; *) echo "PN_TARGET must be staging or live"; exit 2;; esac
for p in $A $B; do
  curl -s -m 10 http://127.0.0.1:$p/config.js | grep -q "SUPABASE_URL: *\"https://$REF\.supabase\.co\"" || {
    echo "port $p does not serve config.js for PN_TARGET=$TARGET ($REF). Serve docs with: PN_TARGET=$TARGET python3 tests/e2e/serve.py $p docs"; exit 2; }
done
HEAD=$(git -C $REPO log -1 --format='%h %ci' 2>/dev/null)
RES=(); TOTALFAIL=0; START=$(date +%s)
run() {   # name port file [args…]
  local n=$1 port=$2 f=$3; shift 3
  [[ "$n" =~ $FILTER ]] || return 0
  if [ "${NEEDS_MAPBOX:-0}" = 1 ] && [ -z "$MAPBOX_TEST_TOKEN" ]; then
    echo "$(date +%T) $n SKIP (no MAPBOX_TEST_TOKEN)" | tee -a $LOG/summary.txt
    RES+=("$(printf '%-16s %5s %5s  %-6s %s' $n - - skip 'no MAPBOX_TEST_TOKEN')"); return 0
  fi
  local st="" p=0 fl=0 rc=0 t0 note=""
  for try in 1 2; do
    t0=$(date +%s); note=""
    (cd $D && timeout $TO node $f $port "$@" > $LOG/$n.$try.log 2>&1); rc=$?
    p=$(grep -c '^PASS' $LOG/$n.$try.log); fl=$(grep -cE '^FAIL( |$)' $LOG/$n.$try.log)
    [ $rc = 124 ] && note="TIMEOUT" && fl=$((fl+1))
    [ $rc != 0 ] && [ $fl = 0 ] && fl=1 && note="${note:-exit $rc}"
    [ $p = 0 ] && [ $fl = 0 ] && fl=1 && note="no PASS lines"
    echo "$(date +%T) $n try$try pass=$p fail=$fl rc=$rc $note ($(( $(date +%s)-t0 ))s)" | tee -a $LOG/summary.txt
    if [ $fl = 0 ]; then [ $try = 2 ] && st="flaky" || st="ok"; break; fi
    # show why (CI logs are easier to read than the artifact): FAIL lines + last lines of the log
    { grep -E '^FAIL' $LOG/$n.$try.log | cut -c1-400 | head -20; [ $rc != 0 ] && tail -n 15 $LOG/$n.$try.log; } | sed "s/^/    [$n] /"
    st="FAIL"
  done
  if [ "$st" = FAIL ] && [ "${SPEC:-0}" = 1 ]; then st="spec"; note="${note:-target spec, not gating}"
  elif [ "$st" = FAIL ]; then TOTALFAIL=$((TOTALFAIL+1)); fi
  RES+=("$(printf '%-16s %5s %5s  %-6s %s' $n $p $fl $st "$note")")
}
echo "=== suite start $(date '+%F %T')  HEAD $HEAD  ports $A/$B  supabase $TARGET" | tee -a $LOG/summary.txt
# --- map (Mapbox GL, mocked Supabase). OPTIONAL: need MAPBOX_TEST_TOKEN, else skipped ---
NEEDS_MAPBOX=1 run glmap      $A glmap-pw.js mbx
NEEDS_MAPBOX=1 run tiers2     $A tiers2-pw.js mbx
NEEDS_MAPBOX=1 run tiers3     $A tiers3-pw.js mbx
NEEDS_MAPBOX=1 run map4       $A map4-pw.js mbx
NEEDS_MAPBOX=1 run barzoom    $A barzoom-pw.js   # ds44: no glow circle over a lit house, no dashed house outlines, no heat at z18
NEEDS_MAPBOX=1 run glfix-avpins $A glfix-avpins-pw.js mbx
NEEDS_MAPBOX=1 run zones      $A zones-pw.js mbx
NEEDS_MAPBOX=1 run mbx        $A mbx-pw.js mbx
NEEDS_MAPBOX=1 run ui1-map    $A ui1-map-pw.js   # ui1 B5 Ölpasset map style + B10 real zone pill at 360 px
# --- UI (mocked Supabase). GATING in CI ---
run ux3        $B ux3-pw.js
run social2    $B social2-pw.js
run fxg        $B fxg-pw.js        # ds50–ds60: bar sheet, group page, members, chat, ‹ ✕, warm, icons, join fixes
run strip      $B strip-test.js
run av2-wizard $B feat-av2-pw.js   # replaces av2-pw.js (old 9-chip editor; the wizard came in c317a9b)
run feat       $B feat-pw.js
run nf         $B nf-pw.js
run notif      $B notif-pw.js
run ntf        $B ntf-pw.js
run cam        $B cam-pw.js
run evx        $B evx-pw.js
run safe       $B safe-pw.js
run ds         $B ds-pw.js
run ds-layout  $B ds-layout-pw.js
run ds-sheet   $B ds-sheet-pw.js   # sheet rules (DESIGN.md), newest copy from the design agent; gating since 2026-11-08
run rpc-cover  $B rpc-cover-pw.js  # every RPC the main screens call must be answered by the mock (fixtures/rpc.js)
# auto check-in (js/autoci.js): runs only when that module is in docs/ (branch 01-autoci merged)
if [ -f "$REPO/docs/js/autoci.js" ]; then run autoci $B ac-pw.js; else [[ autoci =~ $FILTER ]] && RES+=("$(printf '%-16s %5s %5s  %-6s %s' autoci - - skip 'docs/js/autoci.js not merged yet')"); fi
# --- ported agent tests (2026-11-09; were only in agent scratchpads). Mocked Supabase, Leaflet fallback (no Mapbox) ---
run fxm        $B fxm-pw.js        # map fixes ds31–ds42: ANNAT, ⓘ, Ikväll chip, auto check-in list, Auto hemma, Synlighet, calm start
run pf         $B pf-pw.js         # pin follow (pinfolj.js) + people count / "Folk här" night totals
run lg         $B lg-pw.js         # PNLOG usage + position log, consent, owner panel (stats.html), lx part (lgx-part.js)
run cln        $B cln-pw.js        # clean-up: vitals only with the log on, Nytt dates, rpc_bundle2, not_member, medals throttle
run dm         $B dm-pw.js         # dm B1: DM from Vänner → Meddelanden loads, sends, no not_member toast; not_member cache levels
run dialekt    $B dialekt-pw.js    # dialect-core D2: DIALEKT lookup order, B→A, off, vars, variant per night, 290 kommuner, settings row
run games2     $B games2-pw.js     # games lane: GM1 host handover, GM2 host-only switch, GM3 close confirm, GM5 list, GM6 hidden games
run txtfit     $B txtfit-pw.js     # every rank / KAOS / LIVE text fits at 390 px
run ds-motion  $B ds-motion-pw.js  # ds10 motion rules
run gw         $B gw-pw.js         # competitor-research build (gw.js): Ute ikväll?, previews, honest crowd, Följ mig hem timer
run inst       $B inst-pw.js       # screens show at once (no layout shift / late inserts) with slow RPCs (inst-mocks.js)
run ui1        $B ui1-pw.js       # ui1 Wave 1: B3 day headers, B4 chip fades, B6 close jumps, B7 bar card, B10 pill, B11 tabs, B12 bubble
run social-a   $B social-a-pw.js  # social-a Wave 3: G1 Vänner actions, G2 Profil one list style, G3 titles/icons, G4 group tiles + colour, G5 pen badge, Gängkamp, R1-04/09/22/23/24, DM header
run misc       $B misc-pw.js       # misc: X4 delete with 7 days to undo, F4 Grundare badge + owner cutoff, X5 film block + reportMenu, F3 film reports in the owner queue
# --- WebKit (iPhone engine). Needs: npx playwright install webkit. CI shard "webkit" ---
run ds-motion-wk $B ds-motion-pw.js wk
run ds-layout-wk $B ds-layout-pw.js wk
# --- unit (no browser) ---
[[ notif-sw =~ $FILTER ]] && { (cd $D && timeout 120 node notif-sw-test.js $REPO > $LOG/notif-sw.1.log 2>&1); rc=$?
  p=$(grep -c '^PASS' $LOG/notif-sw.1.log); fl=$(grep -cE '^FAIL( |$)' $LOG/notif-sw.1.log); [ $rc != 0 ] && [ $fl = 0 ] && fl=1
  [ $fl != 0 ] && TOTALFAIL=$((TOTALFAIL+1)); RES+=("$(printf '%-16s %5s %5s  %-6s' notif-sw $p $fl $([ $fl = 0 ] && echo ok || echo FAIL))"); }
[[ local-lines =~ $FILTER ]] && { (cd $D && timeout 300 node local-lines-test.js "$REPO/docs/js" > $LOG/local-lines.1.log 2>&1); rc=$?
  p=$(grep -c '^PASS' $LOG/local-lines.1.log); fl=$(grep -cE '^FAIL( |$)' $LOG/local-lines.1.log); [ $rc != 0 ] && [ $fl = 0 ] && fl=1
  [ $fl != 0 ] && TOTALFAIL=$((TOTALFAIL+1)); RES+=("$(printf '%-16s %5s %5s  %-6s' local-lines $p $fl $([ $fl = 0 ] && echo ok || echo FAIL))"); }
echo
echo "SUMMARY  HEAD $HEAD  $(( ($(date +%s)-START)/60 )) min"
printf '%-16s %5s %5s  %-6s %s\n' TEST PASS FAIL STATUS NOTE
printf '%s\n' "${RES[@]}"
echo "tests failing: $TOTALFAIL"
{ echo "SUMMARY HEAD $HEAD"; printf '%s\n' "${RES[@]}"; echo "tests failing: $TOTALFAIL"; } >> $LOG/summary.txt
if [ -n "$GITHUB_STEP_SUMMARY" ]; then
  { echo '```'; printf '%-16s %5s %5s  %-6s %s\n' TEST PASS FAIL STATUS NOTE; printf '%s\n' "${RES[@]}"; echo "tests failing: $TOTALFAIL"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
fi
[ $TOTALFAIL = 0 ]
