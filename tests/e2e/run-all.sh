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
# w1-tests flake ledger: tests/e2e/flakes.json (name: date, count, cause, status). A test that passes only on the rerun prints a FLAKY line and
# goes in $LOG/flaky-now.txt. FLAKE_GATE=1 (CI): flaky in this run AND in the last run (FLAKE_PREV file, restored by CI) = FAIL.
FLAKE_PREV=${FLAKE_PREV:-$OUT/flaky-prev/flaky-now.txt}; : > $LOG/flaky-now.txt
flake_known() {   # ledger text for suite $1, or nothing
  [ -f $D/flakes.json ] && node -e 'const f=require(process.argv[1]),n=process.argv[2],k=Object.keys(f).filter(x=>x.split(":")[0]===n);if(k.length)console.log(" | ledger: "+k.map(x=>x+" ["+f[x].status+", "+f[x].count+"x]").join("; "))' $D/flakes.json $1 2>/dev/null
}
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
  if [ "$st" = flaky ]; then   # w1-tests: passed only on the rerun
    echo "FLAKY $n: failed try 1, passed try 2. First failure: $(grep -E '^FAIL' $LOG/$n.1.log | head -1 | cut -c1-200)$(flake_known $n)" | tee -a $LOG/summary.txt
    echo "$n" >> $LOG/flaky-now.txt
    if [ "${FLAKE_GATE:-0}" = 1 ] && [ -f "$FLAKE_PREV" ] && grep -qxF "$n" "$FLAKE_PREV"; then
      st="FAIL"; note="flaky 2 runs in a row"; TOTALFAIL=$((TOTALFAIL+1)); echo "FLAKE-GATE $n was flaky in the last run too: FAIL" | tee -a $LOG/summary.txt
    fi
  fi
  RES+=("$(printf '%-16s %5s %5s  %-6s %s' $n $p $fl $st "$note")")
}
echo "=== suite start $(date '+%F %T')  HEAD $HEAD  ports $A/$B  supabase $TARGET" | tee -a $LOG/summary.txt
# --- map (Mapbox GL, mocked Supabase). OPTIONAL: need MAPBOX_TEST_TOKEN, else skipped ---
run c1menus     $A c1menus-pw.js
NEEDS_MAPBOX=1 run glmap      $A glmap-pw.js mbx
NEEDS_MAPBOX=1 run tiers2     $A tiers2-pw.js mbx
NEEDS_MAPBOX=1 run tiers3     $A tiers3-pw.js mbx
NEEDS_MAPBOX=1 run map4       $A map4-pw.js mbx
NEEDS_MAPBOX=1 run barzoom    $A barzoom-pw.js   # ds44: no glow circle over a lit house, no dashed house outlines, no heat at z18
NEEDS_MAPBOX=1 run glfix-avpins $A glfix-avpins-pw.js mbx
NEEDS_MAPBOX=1 run zones      $A zones-pw.js mbx
NEEDS_MAPBOX=1 run mbx        $A mbx-pw.js mbx
run map        $A map-pw.js t '^(b9|sh|m2|br1|r1)$'      # map lane part 1: B9 icon size, shots, M2 fade, BR1 bar types, R1 (stub Mapbox without a token)
run map-b      $A map-pw.js t '^(tz|b8|m1|m3|m3sw|m4)$'  # map lane part 2: town zoom, B8 tap, M1 kommun lines, M3 UI-safe, M4 no demo. c4fix: split, one run was ~830-1000 s on CI (TO 900)
NEEDS_MAPBOX=1 run ownerfix-map $A ownerfix-map-pw.js   # lane ownerfix 3: food icons +20 % on the real map, no overlap, tap box, shots z15-17
run c2speed    $A c2speed-pw.js    # lane c2speed: I-45 locate-me < 1 s, I-56 food list at once, I-50 food icons from z14, I-51 bars at city zoom
run alive      $A alive-pw.js      # lane alive: Levande karta (clink, event pulse, sparks, night glow; cap 12, pause on move, reduced motion, raster fallback)
run mapzoom    $A mapzoom-pw.js    # lane a1map: I-08 icons stay while there is room, I-27 no blink on zoom, I-28 my dot under the bars, I-09 cluster >= pin, I-20 popup ✕ clear, I-10 arena disc, I-06 Hemzon navy, I-11 country chip (stub Mapbox without a token)
run systemet  $A systemet-pw.js   # lane b3system I-18: Systembolaget pins (GL + Leaflet fallback), z12 floor, bars first, filter, card text, holiday hook (stub Mapbox without a token)
run c5extras  $A c5extras-pw.js   # lane c5extras: photo viewer X pinned (I-49), camera torch (I-54), ticker height (I-32), delight caption waits (I-31), dialekt pack ?v= (I-29)
run hotfix1   $A hotfix1-pw.js    # lane hotfix1 (owner 13 Nov, after the release): I-63 my-dot ring only when a bar / food icon covers the dot (stub Mapbox without a token), I-64 avatar labels Ansiktsform + Tröja & jacka, tab row at 360 px
run f13       $B f13-pw.js        # lane f13 (owner 13 Nov): Fredag 13 badge = SVG cat + crystal ball (no emoji), tap = hop/flick + fredag13 toast (5 s), ÖL! not covered, idle blink only when visible + map still, reduced motion static, 14 Nov none, other holidays unchanged
run alive2    $B alive2-pw.js     # lane alive2 (I-77): friend ÖL! ripple, holiday ÖL! pulse + bob, Skåltimmen glow, my ÖL! foam, weekend dusk; pause on move/hidden, reduced motion still, budget 12, store = no drink FX
run menufix   $B menufix-pw.js    # lane menufix (owner phone test 13 Nov): I-60 one inset divider rule + no nested boxes in ds list cards (Settings, Om appen, Mer på kartan, Vänner), I-61 Välj gäng = ds list, I-62 chat list ≥ 55 % height, gear in the header, photo ≤ 40 %
run tickerfix $A tickerfix-pw.js  # lane tickerfix (finalcheck 13 Nov): names hint = others out + no gang + once per loop, 'Du' lines 2nd person, no blank items / '/// ///', no empty-map line (any hour) while the header says N ute
run uifix     $A uifix-pw.js      # lane uifix (final check 13 Nov): 1st ÖL! calm 60 s (toast + strip only; Ny grad + Befordrad = 1 card; medals + Hjälp till? wait), settings row icons, Om appen text card + PNI lock, ÅNGRA chip PNI undo + solid
run polishB   $B polishB-pw.js    # lane polishB (blind test 13 Nov): P2-5 the group chat shows the cached / preview lines at once and merges the server answer (no dups, no jump), P3-1 plain Swedish age / rules / safety copy + year list ends at (year - 18)
run polishA   $B polishA-pw.js    # lane polishA (13 Nov release polish): rail words tappable (P2-2), personal actions only in the Ikväll chip menu (move 4), push help wraps + PNI lock (P2-4), Inställningar → Konto → Radera mitt konto
run d2group   $B d2group-pw.js    # lane d2group: calm group page (no Spel / kamera / Chatt dup, Kod only on the top card), kamera first in Ikväll, Gänget in Spel, I-42 chat preview 5 msgs + photo thumbs
run uxfix     $A uxfix-pw.js      # lane uxfix (blind test 13 Nov): P1-1 age sheet once, P1-2 solid age card, P1-5 one count source, P1-6 join → map, P1-4 Systembolaget row + chip, P2-4 push sub-switches, P1-3 first-beer calm + strip closes
run calm2     $B calm2-pw.js      # lane calm2 (owner 13 Nov): I-79/I-84 calm toasts (13 medals + merit + mission = 1 line, 1 toast per Skål, none over a sheet / typing), I-82 Ingen data once per night, I-80 chat input above the keyboard, I-87 no lines under the input, icon send, mic + camera fold while typing
run d3smooth  $B d3smooth-pw.js   # lane d3smooth: sheet slides first then fills (skeleton, not an empty box), pull down from content + snap points + spring, ticker on the compositor, no infinite box-shadow animation, press feedback, bold fonts, reduced motion
run d4map     $A d4map-pw.js      # lane d4map: SMOOTH fix 2 bar tap ring < 100 ms then sheet, fix 3 moveend slices + html.map-moving / pn:mapmove + endless map animations paused while moving, fix 9 pin press (stub Mapbox without a token)
run consent   $A consent-pw.js    # lane consent: real app (live site / store) sends no diagnostics before "Ja"; beta + test builds keep them; errors without device fields
NEEDS_MAPBOX=1 run ui1-map    $A ui1-map-pw.js   # ui1 B5 Ölpasset map style + B10 real zone pill at 360 px
# --- UI (mocked Supabase). GATING in CI ---
run ux3        $B ux3-pw.js
run social2    $B social2-pw.js
run placecard  $B placecard-pw.js   # lane placesdata: place card (cuisine, hours, $ level, chips, links, OSM source; data + RPC mocked)
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
run juice      $B juice-pw.js      # lane juice: ÖL! sound engine + Ljud switch, haptics Android-only, foam burst cap / reduced motion, no long task, CC0 voice clips
run pf         $B pf-pw.js         # pin follow (pinfolj.js) + people count / "Folk här" night totals
run lg         $B lg-pw.js         # PNLOG usage + position log, consent, owner panel (stats.html), lx part (lgx-part.js)
run cln        $B cln-pw.js        # clean-up: vitals only with the log on, Nytt dates, rpc_bundle2, not_member, medals throttle
run dm         $B dm-pw.js         # dm B1: DM from Vänner → Meddelanden loads, sends, no not_member toast; not_member cache levels
run s1speed    $B s1speed-pw.js    # s1speed: CHATLIVE nudge reads the chat at once, optimistic bubble, dm_seen 4 s -> 30 s, flag off = old
run dialekt    $B dialekt-pw.js    # dialect-core D2: DIALEKT lookup order, B→A, off, vars, variant per night, 290 kommuner, settings row
run games2     $B games2-pw.js     # games lane: GM1 host handover, GM2 host-only switch, GM3 close confirm, GM5 list, GM6 hidden games
run txtfit     $B txtfit-pw.js     # every rank / KAOS / LIVE text fits at 390 px
run ds-motion  $B ds-motion-pw.js  # ds10 motion rules
run gw         $B gw-pw.js         # competitor-research build (gw.js): Ute ikväll?, previews, honest crowd, Följ mig hem timer
run inst       $B inst-pw.js       # screens show at once (no layout shift / late inserts) with slow RPCs (inst-mocks.js)
run social-b   $B social-b-pw.js   # social-b: S3 Betaversion, S4 e-mail login in beta, Dialekt row, S1 avatar focus, R1-06/07/08/15/21/25/28/41/47
run ui1        $B ui1-pw.js       # ui1 Wave 1: B3 day headers, B4 chip fades, B6 close jumps, B7 bar card, B10 pill, B11 tabs, B12 bubble
run social-a   $B social-a-pw.js  # social-a Wave 3: G1 Vänner actions, G2 Profil one list style, G3 titles/icons, G4 group tiles + colour, G5 pen badge, Gängkamp, R1-04/09/22/23/24, DM header
run after2     $B after2-pw.js     # lane after: A2 Kvällsrapporten (cards, awards, share card), R1-11 MEDEVAC chip only, R1-39 Mina kvällar chip
run moments    $B moments-pw.js    # lane after: GM7 moments (vad, Halvtid, bordet, Hemlig agent) + GM4 room card + moments in the report
run a4rel      $B a4rel-pw.js      # lane a4rel: I-25 idle-only reload, I-24 moments push-link race
run misc       $B misc-pw.js       # misc: X4 delete with 7 days to undo, F4 Grundare badge + owner cutoff, X5 film block + reportMenu, F3 film reports in the owner queue
run ride       $B ride-pw.js       # lane ride F1 (0420): request, offer card, first-accept race, live driver card, 5/10 min, cancel/Tack, drink rule, flag off / old server, R1-30
run ride3      $B ride3-pw.js      # lane ride3 (0495): destination, fast polls (fake clock: each step on the other phone <= 3 s), steps in order, role chats + read-aloud, Ring consent, LÄSK soda, ANNAT hidden while driving, flag re-ask
run placesearch $B placesearch-pw.js   # lane a3search I-07: shared address search (Hemzon; mocked geocoder): near town first, list, Enter, no jump, mapbox flag
run main       $B main-pw.js       # lane main: S5 install guide first, R1-03 beta note caption, S2 Synlighet quick rows + R1-12, rail labels (first nights)
run eggs       $B eggs-pw.js       # lane s3eggs: 7 hidden Easter eggs (once a day, off in ride / Folj mig hem, reduced motion)
run d1settings  $B d1settings-pw.js  # lane d1settings: Inställningar = 8 rows -> pages with back, one Hem row, Konto page
run icons      $B icons-pw.js      # lane icons: 25 new PNI icons (unique, live area, labels), emoji → icon map (chrome pass, toasts), one meaning per icon
run a2ui       $B a2ui-pw.js       # lane a2ui: toast system, one row + divider, bottom bar CLS, Ikväll choice at first paint, drink icons
run c3chat     $B c3chat-pw.js     # lane c3chat: DM list fills the sheet, voice bubble edge, DM header avatar, avatar tap = profile card, Truppen plain time field + fixed sheet height
run b1people   $B b1people-pw.js   # lane b1people: Blockerade row, one fold style, unblock opens the DM, mute bell state, profile card, group top card + chat card
run sec        $B sec-pw.js        # lane sec: Spöke also ends the check-in and the pin (H2)
run x8         $B x8-pw.js         # lane x8: weak signal: ÖL! outbox (offline / slow 3G / lost answer, no double log), 'Senast uppdaterad' + poll back-off, LÄSK!/spökläge
run perfchat   $B perf-pw.js --part chat   # lane fixP: sign-in burst ≤ 12 / 15 s, chat tick = 1 request (7 → 15 → 30 s), hidden 0, old server (no 0466), flag cache
run perf       $B perf-pw.js       # lane perf (load X10): ≤ 3 requests/min open, cold start ≤ 12, reopen, game 2.5 s + 0 while hidden, busy back-off, old server (no 0465)
run left       $B left-pw.js       # lane left (11 Nov): T-05b Regler before every post RPC (photo, voice, invite, event, wish …), Z1 zone_counts in the poll bundle
run fixm       $B fixm-pw.js       # lane fixM (test teams 11 Nov): T-10 fallback map tap rule + clusters, T-14 ticker one snapshot, T-15 top bar pill + Ute nu, T-24 crowd word
run heat       $B heat-pw.js       # lane heat (0485/0486): client draws the server heat; no double glow on my / my mate's pin; no glow near a village home
run fixmo      $B fixmo-pw.js      # lane fixMo (test teams round 2): N-05 host reveal + Förfest members, N-06 test-kit clock vs login, N-07 all moments, N-08/N-10 distinct crowd, N-09 checked-in mates, N-11 crowd line, N-12 takeover news nearby, N-13 GL-failed cluster tap, N-14 report to the group chat, N-19 copy
run followups  $B followups-pw.js  # lane followups: ride award (0453), Dagens order icon, Helgstreak empty, safety/legend icons, R1-26/29/38/40/42/45/48/49, R1-43 token swaps
run unlocks    $B unlocks-pw.js    # lane unlocks: achievements unlock avatar clothes (0508/0509): unlock sheet, Använd nu, Garderob, no drink counting, reduced motion
run fixs       $B fixs-pw.js       # lane fixS (test teams): T-01 full block DM + friend row, T-05 send after Regler, T-09/T-18 Synlighet, T-12 chat menu, T-13 Gängkamp in Inkorg, T-16 counts, T-17 Dialekt, T-23
run fixc       $B fixc-pw.js       # lane fixC (test teams round 2): N-03 chat menu in a short chat, N-04/N-18 Mina vänner live, N-15 join count, N-16 invite GPS, N-17 group row, N-20 Anta, N-19/T-22 copy
run fixj       $B fixj-pw.js       # lane fixJ (test-team fixes): T-03 year once, T-04 first tap, T-06 no old morning card, T-07 beer moves check-in, T-20 lead, T-21 Barkungen week, T-22 copy
run ownerfix   $B ownerfix-pw.js   # lane ownerfix (owner live test 11 Nov): Event sheet after Visa, Göm min pin = hide only, food icons, ticker gaps / one speed controller / reduced motion, price confirm + 1 rapport, Kontakt form
run kpi        $B kpi-pw.js        # lane kpi: X9 Nyckeltal owner panel (owner_kpi 0460, "<3" masks, wrong key) + no emoji in safety.js UI chrome (ds12)
run popfix     $B popfix-pw.js     # lane popfix: the bar popup on a PC: one card width (320-380 px) at every map position, no word broken mid-word, one-line buttons, the close button inside the card, no overflow (fallback + GL path, 360-2560 px)
run hooks-order $B hooks-order-pw.js   # lane w1-hooks: PN.hookList() order = the old app.js mods() list (85 names), every hooked module reached
run polish3    $B polish3-pw.js    # lane polish3: I-65 film photo tap = big view / hold = react (no emoji row), I-66 toast exit without the amber border, I-68 Grupper button = Grupper tab, I-69 Mina förslag + owner badge
run bump       $B bump-pw.js       # lane bump: Skåla med telefonen (flag pn_bump): shake fills, knock on 2 phones = ÖL! for both, tap fallback, pause text, iPhone permission
# --- WebKit (iPhone engine). Needs: npx playwright install webkit. CI shard "webkit" ---
run ds-motion-wk $B ds-motion-pw.js wk
run ds-layout-wk $B ds-layout-pw.js wk
run c4drinks    $B c4drinks-pw.js   # lane c4drinks: PNI.kind drink icons, beer-style picker >= 44 px, undo chip over Annat, Swish link per platform
run tickerfix2 $A tickerfix2-pw.js # lane tickerfix2 (owner 13 Nov): I-70 no '///' between ticker items, I-71 max one quiet/empty-map line per 30 min + fun lines + Systembolaget countdown, I-72 event lines only near the real position
run evsearch   $B evsearch-pw.js   # lane evsearch: I-73 event search (town / name, Går from a result), I-74/I-76 På plats + Köp biljett in the TV match window, I-75a one row per game
# --- unit (no browser) ---
[[ notif-sw =~ $FILTER ]] && { (cd $D && timeout 120 node notif-sw-test.js $REPO > $LOG/notif-sw.1.log 2>&1); rc=$?
  p=$(grep -c '^PASS' $LOG/notif-sw.1.log); fl=$(grep -cE '^FAIL( |$)' $LOG/notif-sw.1.log); [ $rc != 0 ] && [ $fl = 0 ] && fl=1
  [ $fl != 0 ] && TOTALFAIL=$((TOTALFAIL+1)); RES+=("$(printf '%-16s %5s %5s  %-6s' notif-sw $p $fl $([ $fl = 0 ] && echo ok || echo FAIL))"); }
[[ local-lines =~ $FILTER ]] && { (cd $D && timeout 300 node local-lines-test.js "$REPO/docs/js" > $LOG/local-lines.1.log 2>&1); rc=$?
  p=$(grep -c '^PASS' $LOG/local-lines.1.log); fl=$(grep -cE '^FAIL( |$)' $LOG/local-lines.1.log); [ $rc != 0 ] && [ $fl = 0 ] && fl=1
  [ $fl != 0 ] && TOTALFAIL=$((TOTALFAIL+1)); RES+=("$(printf '%-16s %5s %5s  %-6s' local-lines $p $fl $([ $fl = 0 ] && echo ok || echo FAIL))"); }
[[ dialekt-packs =~ $FILTER ]] && { (cd $D && timeout 120 node dialekt-packs-test.js $REPO > $LOG/dialekt-packs.1.log 2>&1); rc=$?
  p=$(grep -c '^PASS' $LOG/dialekt-packs.1.log); fl=$(grep -cE '^FAIL( |$)' $LOG/dialekt-packs.1.log); [ $rc != 0 ] && [ $fl = 0 ] && fl=1
  [ $fl != 0 ] && TOTALFAIL=$((TOTALFAIL+1)); RES+=("$(printf '%-16s %5s %5s  %-6s' dialekt-packs $p $fl $([ $fl = 0 ] && echo ok || echo FAIL))"); }   # dialect lane: region packs (keys, vars, length, banned words)
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
