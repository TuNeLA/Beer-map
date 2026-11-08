/* PintsNow — 📍 SMART INCHECKNING + AUTO-UTCHECKNING (owner 2026-11-08). Phone only, no new server data, no migration.
   Web limit: GPS only while the app is open and visible. A sampler (one getCurrentPosition per minute, no permanent
   watchPosition — see startWatch) runs only while visible AND the location permission is already "granted" (never a
   prompt). Hidden page = it stops. One reading per ≥ 45 s is used (throttle).
   CHECK IN (nothing checked in): readings with accuracy ≤ 25 m only. Spots = the map's own data (MBX.nearbyPlaces: bars.json +
   bars-extra + restaurant tiles; cafés / fast food left out).
     clear  = nearest spot ≤ 30 m AND the 2nd spot is farther by ≥ max(2 × accuracy, 15 m)
     reach  = spots within 30 m + accuracy (max 55 m) = where you could be
     After ≥ 5 min and ≥ 3 readings on the same spot:
       every reading clear + "Checka in automatiskt" on + "Exakt plats" + a bar-like place (pub / bar / nightclub /
       biergarten, or "bar"/"pub" in the name; not a restaurant, not an arena) → auto check-in (+ Ångra);
       else ≥ 2 spots in reach → "La Parma eller Lobbybaren?" (one tap each); else → "Är du på X? ✓ Checka in".
     Never: ghost mode (spökläge), inside the home zone, location not allowed, a bar you checked out of by hand tonight (3 h).
     "Bara område" never auto check-ins: suggestions only.
   CHECK OUT (checked in at X): readings with accuracy ≤ 50 m.
     far = distance to X > max(60 m, 2 × accuracy). 2 far readings ≥ 2 min apart (30 s after a resume from ≥ 5 min hidden)
     → quiet check_out + toast "Utcheckad från X".
     clearly at another bar Y (the clear rule, 2 readings ≥ 2 min apart) → "Bytt till Y? ✓ Checka in" first; the quiet
     check-out waits 3 min for that answer.
     X closed (hours.json via OPPET: open at check-in time, closed now) → quiet check-out. 05:00: myCheckin() ends it (app.js).
     App resume: one reading at once (+ the closing check). While a sheet is open nothing is asked and nothing checks out
     (the user is busy): the next reading after it closes does it.
   Stored: only the setting olnu.autoCi ("1" = on) on this phone. Hooks: init, onAuthed, onPoll, settingsSheet.
   Public: AUTOCI = { state(), on(), setOn(b), _tick(), _skew(ms) (tests) }. */
(function () {
  "use strict";
  var U = window.U;
  var A = null, KEY = "olnu.autoCi", CI_KEY = "olnu.checkin";
  // Tuned thresholds (see the report): metres / ms
  var ACC_IN = 25, ACC_OUT = 50, AT_M = 30, GAP_MIN = 15, REACH_MAX = 55, OUT_M = 60,
    DWELL_MS = 5 * 60e3, N_MIN = 3, THROTTLE_MS = 45e3, OUT_GAP_MS = 2 * 60e3, OUT_GAP_RESUME_MS = 30e3,
    SW_GAP_MS = 2 * 60e3, SW_WAIT_MS = 3 * 60e3, TICK_MS = 60e3, SNOOZE_MS = 30 * 60e3, HAND_OUT_MS = 3 * 3600e3, TWIN_M = 12;
  var BARLIKE = { pub: 1, bar: 1, nightclub: 1, biergarten: 1 };
  var skew = 0;
  function now() { return Date.now() + skew; }

  var st = { watching: false, timer: 0, asking: false, perm: "unknown", last: null, lastUsed: 0, run: null, far: null, sw: null,
    snooze: {}, prevCi: null, selfOut: null, hiddenAt: 0, resumed: false, busy: false, readings: 0 };

  function on() { try { return U.ls.get(KEY, "0") === "1"; } catch (e) { return false; } }
  function setOn(b) { try { if (b) U.ls.set(KEY, "1"); else U.ls.del(KEY); } catch (e) {} if (st.run) st.run.asked = false; }
  function ghost() { try { return !!(window.EXTRAS && window.EXTRAS.ghostOn && window.EXTRAS.ghostOn()); } catch (e) { return false; } }
  function atHome(la, ln) { try { return !!(window.PRIVACY && window.PRIVACY.inHome && window.PRIVACY.inHome(la, ln)); } catch (e) { return false; } }
  function area() { try { return A.prec && A.prec() === "area"; } catch (e) { return false; } }
  function ready() { return !!(A && A.LIVE && A.authed && A.authed() && navigator.geolocation); }
  function myCi() { try { return A.myCheckin ? A.myCheckin() : null; } catch (e) { return null; } }
  function sid(s) { var id = String(s.bar.id); try { return window.BARS && window.BARS.canonId ? String(window.BARS.canonId(id)) : id; } catch (e) { return id; } }
  function dist(a, b, c, d) { return U.haversine(a, b, c, d); }
  function short(n) {
    var s = String(n || "krogen").replace(/\s*\(.*\)\s*$/, "").trim();
    var m = s.match(/^(.{3,}?)\s+(pub|restaurang|grill|bar|&)\b/i);
    return m ? m[1] : s;
  }
  function barLike(bar) {
    if (!bar || bar.arena) return false;
    if (BARLIKE[bar.type] && !bar.place) return true;
    return !bar.place && /\b(bar|pub)\b/i.test(bar.name || "");
  }
  function sheetOpen() { try { return !!(A.sheetOpen && A.sheetOpen()); } catch (e) { return false; } }
  function ic(name) { try { return window.PNI && window.PNI.svg ? window.PNI.svg(name, "pi-lead") : ""; } catch (e) { return ""; } }

  /* ---------- permission + watch (visible only) ---------- */
  function permCheck() {
    if (!navigator.permissions || !navigator.permissions.query) { st.perm = U.ls.get("olnu.locOk", "") === "1" ? "granted" : "unknown"; return Promise.resolve(st.perm); }
    return navigator.permissions.query({ name: "geolocation" }).then(function (p) {
      st.perm = p.state;
      try { p.onchange = function () { st.perm = p.state; sync(); }; } catch (e) {}
      return st.perm;
    }, function () { st.perm = "unknown"; return st.perm; });
  }
  function want() { return ready() && !document.hidden && st.perm === "granted"; }
  // Visible-only sampler: ONE getCurrentPosition per minute (not a permanent watchPosition: in Chromium a running watch makes
  // other getCurrentPosition calls, e.g. the ÖL! tap, wait for the next fix — up to their 12 s timeout). GPS is on only briefly.
  function startWatch() {
    if (st.watching) return;
    st.watching = true;
    st.timer = setInterval(tick, TICK_MS);
  }
  function stopWatch() {
    if (st.timer) clearInterval(st.timer);
    st.timer = 0; st.watching = false;
  }
  function sync() { if (want()) startWatch(); else stopWatch(); }
  function oneShot() {
    if (!want() || st.asking) return;
    st.asking = true;
    try {
      navigator.geolocation.getCurrentPosition(function (p) { st.asking = false; onFix(p, "tick"); }, function () { st.asking = false; },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    } catch (e) { st.asking = false; }
  }
  function tick() {
    if (!want()) { stopWatch(); return; }
    closingCheck();
    oneShot();
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { st.hiddenAt = now(); stopWatch(); return; }
    st.resumed = st.hiddenAt && now() - st.hiddenAt >= 5 * 60e3;
    st.hiddenAt = 0;
    permCheck().then(function () { sync(); if (want()) { closingCheck(); st.lastUsed = 0; oneShot(); } });   // resume: check once
  });

  /* ---------- readings ---------- */
  function onFix(p, src) {
    if (!p || !p.coords || !ready() || document.hidden) return;
    var c = p.coords, r = { lat: +c.latitude, lng: +c.longitude, acc: isFinite(c.accuracy) ? +c.accuracy : 9999, t: now() };
    if (!isFinite(r.lat) || !isFinite(r.lng)) return;
    st.last = r;
    if (r.t - st.lastUsed < THROTTLE_MS) return;
    st.lastUsed = r.t; st.readings++;
    evaluate(r);
  }
  function spots(r) {
    var M = window.MBX, B = window.BARS, o = { maxM: 160, max: 12, maxPlaces: 12, waitMs: 1500 };
    var p = M && M.nearbyPlaces ? M.nearbyPlaces(r.lat, r.lng, o)
      : Promise.resolve(B && B.around ? (function () { var a = B.around(r.lat, r.lng, 160); return a.bars.concat(a.places); })() : []);
    return Promise.resolve(p).then(function (list) {
      var seen = {};
      return (list || []).filter(function (s) {
        if (!s || !s.bar || !s.bar.name || !isFinite(s.d)) return false;
        if (s.place && (s.bar.type === "cafe" || s.bar.type === "fast_food")) return false;
        var k = sid(s); if (seen[k]) return false; seen[k] = 1; return true;
      }).filter(function (s, i, all) {   // a restaurant point ≤ 12 m from a listed bar = the same venue (hotel + its bar)
        return !s.place || !all.some(function (o) { return !o.place && dist(o.bar.lat, o.bar.lng, s.bar.lat, s.bar.lng) <= TWIN_M; });
      }).sort(function (a, b) { return a.d - b.d; });
    }, function () { return []; });
  }
  function classify(r, list) {
    var reach = Math.min(REACH_MAX, AT_M + r.acc), s1 = list[0], s2 = list[1];
    var clear = !!(s1 && s1.d <= AT_M && (!s2 || s2.d - s1.d >= Math.max(2 * r.acc, GAP_MIN)));
    return { C: list.filter(function (s) { return s.d <= reach; }), win: clear ? s1 : null };
  }
  function handOut() {   // a check-in that went away without us (Checka ut by hand, another phone) → no auto for that bar
    var cur = myCi(), prev = st.prevCi;
    if (prev && (!cur || cur.id !== prev.id)) {
      if (st.selfOut === prev.id) st.selfOut = null;
      else if (!cur) st.snooze[prev.id] = now() + HAND_OUT_MS;
    }
    st.prevCi = cur ? { id: cur.id } : null;
    return cur;
  }
  function snoozed(id) { return (st.snooze[id] || 0) > now(); }
  function evaluate(r) {
    if (st.busy) return;
    var me = handOut();
    if (me) { st.run = null; outLogic(r, me); return; }
    st.far = null; st.sw = null;
    if (r.acc > ACC_IN) return;                                          // poor fix: not counted, nothing shown
    if (ghost() || atHome(r.lat, r.lng)) { st.run = null; return; }
    st.busy = true;
    spots(r).then(function (list) { st.busy = false; inLogic(r, list); }, function () { st.busy = false; });
  }

  /* ---------- check in ---------- */
  function inLogic(r, list) {
    if (myCi()) return;
    var v = classify(r, list);
    if (!v.C.length) { st.run = null; return; }
    var run = st.run, has = run && v.C.some(function (s) { return sid(s) === run.id; });
    if (!has) run = st.run = { id: sid(v.C[0]), spot: v.C[0], t0: r.t, n: 0, clear: true, asked: false };
    run.n++;
    run.clear = run.clear && !!v.win && sid(v.win) === run.id;
    if (v.win && sid(v.win) === run.id) run.spot = v.win;
    run.last = v;
    if (run.asked || r.t - run.t0 < DWELL_MS || run.n < N_MIN || snoozed(run.id)) return;
    if (sheetOpen()) return;                                             // wait: the next reading asks
    run.asked = true;
    var bar = run.spot.bar;
    if (run.clear && on() && !area() && barLike(bar) && A.getName && A.getName()) { checkIn(bar, true); return; }
    var C = v.C.filter(function (s) { return !snoozed(sid(s)); });
    if (!run.clear && C.length >= 2) { choose(C[0].bar, C[1].bar); return; }
    suggest(run.clear ? bar : (C[0] || run.spot).bar, false);
  }
  function toastEl(text, id, ms) {
    var t = A.toast(text, { id: id, ms: ms || 20000, cls: "ac-toast", action: { label: "x", fn: function () {} } });
    // the app toast keeps the queue, the look and the tokens; the buttons are ours
    if (t) { var b = t.querySelector("button"); if (b) b.remove(); t.style.flexWrap = "wrap"; }
    return t;
  }
  function addBtn(t, html, cls, fn) {
    if (!t) return null;
    var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-small " + (cls || "");
    b.innerHTML = html;
    b.addEventListener("click", function (e) { e.stopPropagation(); t.remove(); fn(); });
    t.appendChild(b); return b;
  }
  function snoozeOnClose(t, ids) {
    if (!t) return;
    var picked = false, shown = t.isConnected;   // a toast can wait in the queue first: count from when it shows
    t.addEventListener("click", function (e) { if (e.target.closest("button")) picked = true; }, true);
    new MutationObserver(function (ms, mo) {
      if (t.isConnected) { shown = true; return; }
      if (!shown) return;
      mo.disconnect(); if (!picked) ids.forEach(function (id) { st.snooze[id] = now() + SNOOZE_MS; });
    }).observe(document.getElementById("toasts") || document.body, { childList: true });
  }
  function suggest(bar, swap) {
    var n = short(bar.name), t = toastEl(swap ? "Bytt till " + n + "?" : "Är du på " + n + "?", "ac-sug");
    addBtn(t, ic("check") + "Checka in", "btn-amber ac-yes", function () { checkIn(bar, false); });
    snoozeOnClose(t, [String(bar.id)]);
    return t;
  }
  function choose(a, b) {
    var t = toastEl(short(a.name) + " eller " + short(b.name) + "?", "ac-sug");
    addBtn(t, ic("check") + esc(short(a.name)), "btn-amber ac-pick", function () { checkIn(a, false); });
    addBtn(t, ic("check") + esc(short(b.name)), "btn-amber ac-pick", function () { checkIn(b, false); });
    snoozeOnClose(t, [String(a.id), String(b.id)]);
  }
  function esc(s) { return U.esc(s); }
  function checkIn(bar, auto) {
    if (!ready() || ghost()) return;
    var go = function () {
      var name = String(bar.name || "Krogen").replace(/\s+/g, " ").trim().slice(0, 60);
      A.rpc("check_in", { p_bar_id: String(bar.id), p_bar_name: name, p_lat: bar.lat, p_lng: bar.lng }).then(function (r) {
        var d = r && !r.error ? A.parseData(r.data) : null;
        if (!d || d.ok === false) { if (!auto) A.toast(d && d.ok === false ? "Vänta en liten stund och försök igen." : "Kunde int' checka in. Försök igen.", { err: true }); return; }
        U.ls.setJSON(CI_KEY, { id: String(bar.id), name: d.bar_name || name, lat: +bar.lat, lng: +bar.lng, at: Date.now(), until: A.nightEnd() });
        st.prevCi = { id: String(bar.id) }; st.run = null; st.far = null; st.sw = null;
        try { A.toastClear("ac-sug"); } catch (e) {}
        var n = short(d.bar_name || name);
        if (auto) {
          A.toast("Incheckad på " + n + " (automatiskt)", { id: "ac-in", ms: 8000, cls: "skal", action: { label: "Ångra", fn: function () { checkOut({ id: String(bar.id), name: name }, "undo"); } } });
        } else A.toast("Incheckad på " + n + "!", { id: "ac-in", ms: 4000, cls: "skal" });
        try { window.FX.vibrate([18, 40, 18]); } catch (e) {}
        if (A.PUSH_ON && A.invoke) { try { A.invoke("notify-group", { event: "checkin", bar: d.bar_name || name }); } catch (e) {} }   // same as a tap
        try { A.updateCounts(); A.refresh(); } catch (e) {}
      });
    };
    if (A.getName && A.getName()) go(); else if (A.withName) A.withName(function () { try { A.closeSheet(); } catch (e) {} go(); });
  }

  /* ---------- check out ---------- */
  function outLogic(r, me) {
    if (r.acc > ACC_OUT) return;
    var d = dist(r.lat, r.lng, me.lat, me.lng);
    if (d <= Math.max(OUT_M, 2 * r.acc)) { st.far = null; st.sw = null; return; }
    var f = st.far = st.far || { t0: r.t, n: 0 };
    f.n++;
    var finish = function () {
      var gap = st.resumed ? OUT_GAP_RESUME_MS : OUT_GAP_MS;
      var waitSw = st.sw && st.sw.askedAt && r.t - st.sw.askedAt < SW_WAIT_MS;
      if (f.n >= 2 && r.t - f.t0 >= gap && !waitSw && !sheetOpen()) { st.resumed = false; checkOut(me, "far"); }   // a sheet open = busy: next reading
    };
    if (r.acc > ACC_IN || ghost()) { finish(); return; }
    st.busy = true;
    spots(r).then(function (list) {
      st.busy = false;
      var v = classify(r, list), w = v.win;
      if (w && sid(w) !== String(me.id) && !snoozed(sid(w))) {
        var s = st.sw;
        if (!s || s.id !== sid(w)) s = st.sw = { id: sid(w), t0: r.t, n: 0, bar: w.bar };
        s.n++;
        if (!s.askedAt && s.n >= 2 && r.t - s.t0 >= SW_GAP_MS && !sheetOpen()) { s.askedAt = r.t; suggest(w.bar, true); }
      }
      finish();
    }, function () { st.busy = false; finish(); });
  }
  function checkOut(me, why) {
    if (!me || !A.rpc) return;
    st.selfOut = String(me.id); st.far = null; st.sw = null;
    A.rpc("check_out").then(function (r) {
      if (r && r.error) { st.selfOut = null; return; }
      try { U.ls.del(CI_KEY); } catch (e) {}
      st.prevCi = null; st.snooze[String(me.id)] = now() + (why === "undo" ? HAND_OUT_MS : SNOOZE_MS);
      A.toast(why === "undo" ? "Incheckningen ä ångrad." : "Utcheckad från " + short(me.name) + (why === "closed" ? " (stängt)" : ""), { id: "ac-out", ms: 4000 });
      try { A.updateCounts(); A.refresh(); } catch (e) {}
    });
  }
  function closingCheck() {
    var me = myCi(); if (!me || !window.OPPET || !window.OPPET.barStatus || sheetOpen()) return;
    try {
      var bar = (window.BARS && window.BARS.byId(me.id)) || { id: me.id, lat: me.lat, lng: me.lng };
      var s = window.OPPET.barStatus(bar), was = window.OPPET.barStatus(bar, me.at);
      if (s && s.known && !s.open && !s.always && was && was.open) checkOut(me, "closed");
    } catch (e) {}
  }

  /* ---------- ⚙️ one row ---------- */
  function settingsSheet(body) {
    if (!A || !A.LIVE) return;
    var el = A.el;
    body.appendChild(el("h3", { text: "Karta – incheckning" }));
    // ds08 switch row (.pn-swb): a row button with icon + label + switch; the button holds aria-checked (pnds.js keeps the dot in step)
    var b = el("button", { type: "button", class: "btn btn-block pn-swb ac-row", role: "switch", "aria-checked": String(on()) });
    b.innerHTML = ic("pin") + '<span class="pn-sw-l">Checka in automatiskt</span><span class="switch" aria-hidden="true" aria-checked="' + on() + '"></span>';
    b.addEventListener("click", function () {
      var v = b.getAttribute("aria-checked") !== "true";
      setOn(v); b.setAttribute("aria-checked", String(v));
      var dot = b.querySelector(".switch"); if (dot) dot.setAttribute("aria-checked", String(v));
      A.toast(v ? "Auto-incheckning på. Bara när appen ä öppen." : "Auto-incheckning av. Du får en fråga i stället.", { id: "ac-set", ms: 3000 });
    });
    body.appendChild(el("div", { class: "row ac-set" }, [b]));
    body.appendChild(el("p", { class: "muted ac-hint", text: "Efter 5 min på samma krog, när appen ä öppen. Av: du får en fråga." }));
  }

  window.AUTOCI = {
    init: function (api) { A = api; permCheck().then(sync); },
    onAuthed: function () { permCheck().then(function () { sync(); oneShot(); }); },
    onPoll: function () { if (!A) return; handOut(); if (!st.watching) permCheck().then(sync); closingCheck(); },
    settingsSheet: settingsSheet,
    on: on, setOn: setOn,
    state: function () { return { watching: st.watching, perm: st.perm, run: st.run ? { id: st.run.id, n: st.run.n, clear: st.run.clear, asked: st.run.asked } : null,
      far: st.far, sw: st.sw ? { id: st.sw.id, n: st.sw.n, asked: !!st.sw.askedAt } : null, readings: st.readings, last: st.last }; },
    _tick: tick,
    _skew: function (ms) { skew += ms; return skew; }
  };
})();
