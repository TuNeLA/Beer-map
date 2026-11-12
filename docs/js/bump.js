/* PintsNow — Skåla med telefonen (lane bump, 13 Nov 2026; scratch BUMP-PLAN.md; migration 0509). PROTOTYPE, flag OFF.
   Owner idea: shake the phone → the glass fills → "Redo" → knock the phone against a friend's phone → it counts as ÖL! for both.
   - Flag: on only when (PN_CFG.bump === true or the server flag bold_flags.pn_bump) and not a store build (OLNU_STORE).
     The server refuses with feature_off while pn_bump is off. Entry: the Ikväll menu row (BOLD.menuRows).
   - Detectors (pure, unit tested with synthetic samples): linear acceleration = accelerationIncludingGravity minus a low-pass
     gravity (or event.acceleration when the phone gives it). Shake peak > 12 m/s², one per 120 ms; 8 peaks = full glass.
     Full + 700 ms still = READY. Knock = one sharp spike (> 18 m/s²) after 300 ms calm (mean < 7) and calm again 60–160 ms after,
     and no free fall before it (a dropped phone).
   - Server: bump_ready (p_ago_ms = ms since the knock, never the phone clock) then bump_wait every 350 ms (max 12). On a match the
     server logs the beer with post_beer_v2 in each user's own session: same 10-min rule, undo, spökläge. No reward of any kind.
   - Tap fallback: the "Skål" button is always there (both tap within 3 s). No sensor events in 1.5 s = the tap is the main way.
   - iPhone: DeviceMotionEvent.requestPermission() from the Starta tap (stored like delight.js: olnu.og.perm).
   - While open, this listener runs first (capture) and stops the event, so delight.js's shake glass does not open below it.
   - Debug: ?bumpdebug=1 shows the live peak value (to tune the numbers on real phones).
   Public: PN.bump = { open, close, makeMotion, CFG, _state }. Styles: bump.css (x-lazy-css, loaded on the first open). */
(function () {
  "use strict";
  var PN = window.PN = window.PN || {};
  var U = window.U;
  var CFG = { gAlpha: 0.94, freeFall: 4, shakePeak: 12, shakeGap: 120, fillPeaks: 8, readyCalmMs: 700, knockPeak: 18, calm: 7, calmMs: 300,
    settleFrom: 60, settleMs: 160, knockGap: 800, noSensorMs: 1500, pollMs: 350, pollMax: 12, idleMs: 90e3 };
  var A = null, ov = null, st = null;

  /* ---------- detectors (pure) ---------- */
  // feed(t ms, x, y, z, lin) → array of events: { type: "peak", fill } | { type: "ready" } | { type: "knock", t, peak }.
  // lin = true: x/y/z are already without gravity (event.acceleration).
  function makeMotion(cfg) {
    var c = {}, k; for (k in CFG) c[k] = cfg && cfg[k] != null ? cfg[k] : CFG[k];
    var g = null, buf = [], peaks = 0, lastPeak = -1e9, phase = "fill", cand = null, lastKnock = -1e9;
    function mean(from, to) {
      var s = 0, n = 0;
      for (var i = 0; i < buf.length; i++) if (buf[i].t >= from && buf[i].t <= to) { s += buf[i].m; n++; }
      return n ? s / n : null;
    }
    // free fall (raw |a| near 0, only known with gravity) before the spike = a dropped phone, not a knock
    function fell(from, to) {
      for (var i = 0; i < buf.length; i++) if (buf[i].t >= from && buf[i].t <= to && buf[i].raw !== null && buf[i].raw < c.freeFall) return true;
      return false;
    }
    function feed(t, x, y, z, lin) {
      var out = [], m, raw = null;
      if (x == null || y == null || z == null || !isFinite(x + y + z)) return out;
      if (lin) m = Math.sqrt(x * x + y * y + z * z);
      else {
        raw = Math.sqrt(x * x + y * y + z * z);
        if (!g) g = { x: x, y: y, z: z };
        g.x = c.gAlpha * g.x + (1 - c.gAlpha) * x; g.y = c.gAlpha * g.y + (1 - c.gAlpha) * y; g.z = c.gAlpha * g.z + (1 - c.gAlpha) * z;
        m = Math.sqrt((x - g.x) * (x - g.x) + (y - g.y) * (y - g.y) + (z - g.z) * (z - g.z));
      }
      buf.push({ t: t, m: m, raw: raw });
      while (buf.length && buf[0].t < t - c.calmMs - c.settleMs - 100) buf.shift();
      // a knock candidate waits for the calm after it
      if (cand && t >= cand.t + c.settleMs) {
        var after = mean(cand.t + c.settleFrom, t);
        if (after !== null && after < c.calm) { out.push({ type: "knock", t: cand.t, peak: cand.m }); lastKnock = cand.t; phase = "sent"; }
        cand = null;
      }
      if (phase === "ready" && !cand && m >= c.knockPeak && t - lastKnock > c.knockGap && t - lastPeak > c.readyCalmMs) {
        var before = mean(t - c.calmMs, t - 40);
        if (before !== null && before < c.calm && !fell(t - c.calmMs, t - 20)) cand = { t: t, m: m };
      }
      if (m >= c.shakePeak && t - lastPeak >= c.shakeGap && !cand) {
        lastPeak = t;
        if (phase === "fill") { peaks++; out.push({ type: "peak", fill: Math.min(1, peaks / c.fillPeaks) }); }
      }
      if (phase === "fill" && peaks >= c.fillPeaks && t - lastPeak >= c.readyCalmMs) { phase = "ready"; out.push({ type: "ready" }); }
      return out;
    }
    return {
      feed: feed,
      phase: function () { return phase; },
      fill: function () { return Math.min(1, peaks / c.fillPeaks); },
      rearm: function () { phase = peaks >= c.fillPeaks ? "ready" : "fill"; cand = null; },
      reset: function () { peaks = 0; phase = "fill"; cand = null; lastPeak = -1e9; }
    };
  }

  /* ---------- small helpers ---------- */
  function W(n) { return window[n] || null; }
  function on() {
    if (window.OLNU_STORE) return false;
    var cfg = window.PN_CFG || {};
    try { return cfg.bump === true || !!(W("BOLD") && W("BOLD").on("pn_bump")); } catch (e) { return false; }
  }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function q(s) { return ov ? ov.querySelector(s) : null; }
  function vib(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function fx() { return W("FX"); }
  function log(n, p) { try { if (W("PNLOG") && W("PNLOG").event) W("PNLOG").event("bump." + n, p || {}); } catch (e) {} }
  function ghost() { try { return !!(W("EXTRAS") && W("EXTRAS").ghostOn && W("EXTRAS").ghostOn()); } catch (e) { return false; } }
  function needPerm() { var DM = window.DeviceMotionEvent; return !!(DM && typeof DM.requestPermission === "function"); }
  function permOk() { try { return localStorage.getItem("olnu.og.perm") === "1"; } catch (e) { return false; } }
  function debugOn() { try { return /[?&]bumpdebug=1\b/.test(location.search || ""); } catch (e) { return false; } }
  function errText(e) {
    var m = String((e && (e.message || e.details)) || "");
    if (/slow_down/.test(m)) return "Lugnt! En skål i taget.";
    if (/bump_limit/.test(m)) return "Nog med skålar för ikväll.";
    if (/feature_off/.test(m)) return "Skåla med telefonen är inte på än.";
    return "Det gick inte. Prova igen.";
  }
  function cssOnce() {
    var l = [].filter.call(document.querySelectorAll('link[rel="x-lazy-css"]'), function (x) { return /bump\.css/.test(x.getAttribute("href") || ""); })[0];
    var href = l ? l.getAttribute("href") : "./bump.css";
    if (document.querySelector('link[rel="stylesheet"][href="' + href + '"]')) return;
    var s = document.createElement("link"); s.rel = "stylesheet"; s.href = href; document.head.appendChild(s);
  }

  /* ---------- position (for the match only) ---------- */
  function spot() {
    var ci = null; try { ci = A.myCheckin && A.myCheckin(); } catch (e) {}
    if (ci && isFinite(+ci.lat)) return { lat: +ci.lat, lng: +ci.lng, acc: 10, precise: true };
    if (st && st.fix && Date.now() - st.fix.at < 120e3) return st.fix;
    try { var l = A.lastLoc && A.lastLoc(); if (l && isFinite(l.lat)) return { lat: l.lat, lng: l.lng, acc: 80, precise: false }; } catch (e) {}
    return null;
  }
  function warmFix() {
    if (!navigator.geolocation) return;
    try {
      navigator.geolocation.getCurrentPosition(function (p) {
        if (st) st.fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, precise: p.coords.accuracy <= 50, at: Date.now() };
      }, function () {}, { enableHighAccuracy: true, maximumAge: 20000, timeout: 8000 });
    } catch (e) {}
  }

  /* ---------- the screen ---------- */
  function say(t, cls) { var m = q(".pnb-msg"); if (m) { m.textContent = t; m.className = "pnb-msg" + (cls ? " " + cls : ""); } }
  function paint() {
    if (!ov || !st) return;
    var f = st.motion.fill(), ph = st.view;
    q(".pnb-beer").style.height = Math.round(f * 100) + "%";
    ov.setAttribute("data-state", ph);
    q(".pnb-start").hidden = ph !== "perm";
    q(".pnb-glass").classList.toggle("pnb-full", f >= 1);
  }
  function setView(v, text, cls) { if (!st) return; st.view = v; paint(); if (text) say(text, cls); }
  function open() {
    if (!on() || !A) return false;
    if (ov) return true;
    try { if (A.sheetOpen && A.sheetOpen()) A.closeSheet(); } catch (e) {}
    cssOnce();
    st = { motion: makeMotion(), view: "fill", busy: false, seen: false, fix: null, idle: 0, opened: Date.now(), rec: [] };
    ov = el("div", "pnb-ov");
    ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Skåla med telefonen");
    ov.innerHTML = '<button type="button" class="pnb-x" aria-label="Stäng">×</button>' +
      '<div class="pnb-head"><h2 class="pnb-t">Skåla med telefonen</h2><p class="pnb-s">Skaka telefonen så fylls glaset. Knacka sedan telefonerna mot varandra.</p></div>' +
      '<div class="pnb-glass" aria-hidden="true"><div class="pnb-beer"><div class="pnb-foam"></div></div></div>' +
      '<p class="pnb-msg" role="status" aria-live="polite"></p>' +
      '<div class="pnb-row"><button type="button" class="pnb-start btn btn-amber" hidden>Starta</button>' +
      '<button type="button" class="pnb-tap btn">Skål</button></div>' +
      '<p class="pnb-foot">Loggas som en vanlig öl, med samma 10-minutersregel. Bara med vänner och gängmedlemmar.</p>' +
      (debugOn() ? '<p class="pnb-dbg"></p>' : "");
    document.body.appendChild(ov); document.body.classList.add("pnb-on");
    q(".pnb-x").addEventListener("click", close);
    q(".pnb-tap").addEventListener("click", function () { send("tap", 0); });
    q(".pnb-start").addEventListener("click", askPerm);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVis);
    warmFix();
    if (needPerm() && !permOk()) setView("perm", "Tryck Starta så kan telefonen känna skakningar.");
    else listen();
    st.idle = setTimeout(close, CFG.idleMs);
    log("open");
    return true;
  }
  function askPerm() {
    var DM = window.DeviceMotionEvent;
    Promise.resolve().then(function () { return DM.requestPermission(); }).then(function (r) {
      var ok = r === "granted"; try { localStorage.setItem("olnu.og.perm", ok ? "1" : "0"); } catch (e) {}
      if (ok) listen(); else setView("nosensor", "Rörelse är avstängd. Tryck Skål samtidigt som kompisen.");
    }, function () { setView("nosensor", "Rörelse är avstängd. Tryck Skål samtidigt som kompisen."); });
  }
  function listen() {
    if (!st) return;
    setView("fill", "Skaka telefonen!");
    window.addEventListener("devicemotion", onMotion, { capture: true, passive: true });
    st.noSensor = setTimeout(function () { if (st && !st.seen) setView("nosensor", "Ingen rörelsesensor här. Tryck Skål samtidigt som kompisen."); }, CFG.noSensorMs);
  }
  function onMotion(e) {
    if (!st) return;
    try { e.stopImmediatePropagation(); } catch (x) {}   // delight.js shake glass: not while this screen is open
    var lin = e.acceleration && e.acceleration.x != null, a = lin ? e.acceleration : e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    if (!st.seen) { st.seen = true; if (st.view === "nosensor") setView("fill", "Skaka telefonen!"); }
    var t = e.timeStamp || performance.now(), evs = st.motion.feed(t, a.x, a.y, a.z, lin);
    if (debugOn()) { var d = q(".pnb-dbg"); if (d) d.textContent = st.motion.phase() + " " + Math.round(Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)); }
    for (var i = 0; i < evs.length; i++) {
      var v = evs[i];
      if (v.type === "peak") { vib(12); paint(); if (v.fill >= 1) say("Fullt! Håll still…"); }
      else if (v.type === "ready") { vib([30, 40, 30]); setView("ready", "Redo! Knacka telefonerna mot varandra.", "pnb-ok"); }
      else if (v.type === "knock") send("bump", Math.max(0, Math.round(performance.now() - v.t)));
    }
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  function onVis() { if (document.hidden) close(); }
  function close() {
    if (!ov) return;
    window.removeEventListener("devicemotion", onMotion, { capture: true });
    document.removeEventListener("keydown", onKey); document.removeEventListener("visibilitychange", onVis);
    if (st) { clearTimeout(st.idle); clearTimeout(st.noSensor); }
    var o = ov; ov = null; st = null; o.remove(); document.body.classList.remove("pnb-on");
  }

  /* ---------- server ---------- */
  function send(kind, ago) {
    if (!st || st.busy) return;
    st.busy = true; clearTimeout(st.idle); st.idle = setTimeout(close, CFG.idleMs);
    var s = spot(), gh = ghost();
    vib(20); try { if (fx()) fx().unlock(); } catch (e) {}
    setView("wait", "Väntar på kompisen…", "pnb-wait");
    var p = { p_lat: s ? s.lat : null, p_lng: s ? s.lng : null, p_ago_ms: ago | 0, p_acc: s ? s.acc : null, p_precise: !!(s && s.precise), p_hidden: gh, p_kind: kind };
    A.rpc("bump_ready", p).then(function (r) {
      if (r && r.error) { miss(errText(r.error)); return; }
      var d = A.parseData(r && r.data) || {};
      if (d.pair) { done(d, s, gh); return; }
      var tries = 0;
      (function wait() {
        setTimeout(function () {
          if (!st) return;
          A.rpc("bump_wait", { p_id: d.id }).then(function (x) {
            var w = x && !x.error ? A.parseData(x.data) || {} : {};
            if (w.pair) done(w, s, gh);
            else if (w.done || ++tries >= CFG.pollMax) miss();
            else wait();
          }, function () { if (++tries >= CFG.pollMax) miss(); else wait(); });
        }, CFG.pollMs);
      })();
    }, function () { miss("Ingen täckning. Prova igen."); });
  }
  function miss(text) {
    if (!st) return;
    st.busy = false; st.motion.rearm();
    setView(st.motion.phase() === "ready" ? "ready" : st.seen ? "fill" : "nosensor", text || "Ingen knackade tillbaka. Försök igen, samtidigt.", "pnb-err");
    log("miss");
  }
  function done(d, s, gh) {
    if (!st) return;
    st.busy = false;
    var who = (d.matched && d.matched[0] && d.matched[0].name) || "kompisen", b = d.beer || {};
    try { if (fx()) fx().sound.clink(); } catch (e) {}
    vib([40, 40, 80]);
    q(".pnb-glass").classList.add("pnb-clink");
    var text = "Skål med " + who + "!";
    if (b.accepted === true) text += " Loggad som öl.";
    else if (b.accepted === false && (b.wait_seconds | 0) > 0) text += " Du har paus i " + U.mmss((b.wait_seconds | 0) * 1000) + ". Ingen ny öl loggad.";
    else text += " Ölen kunde inte loggas.";
    setView("done", text, "pnb-ok");
    st.motion.reset(); paint();
    if (b.accepted === true) apply(b, s, gh);
    log("match", { kind: d.kind, beer: b.accepted === true });
  }
  // The normal ÖL! after-beer UI (undo, push after the undo window, counts, map). Hook from app-beer.js (A.beerFromBump);
  // without it: a refresh + an Ångra button here (undo_beer, the same 2-minute rule on the server).
  function apply(b, s, gh) {
    var sp = { lat: +b.lat, lng: +b.lng, precise: !!(s && s.precise) };
    if (A.beerFromBump) { try { A.beerFromBump(b, sp, gh); return; } catch (e) {} }
    try { A.refresh(); A.updateCounts(); } catch (e) {}
    if (!b.undo_until || !q(".pnb-row")) return;
    var u = el("button", "pnb-undo btn", "Ångra ölen"); u.type = "button";
    u.addEventListener("click", function () {
      u.disabled = true;
      A.rpc("undo_beer").then(function (r) { say(r && !r.error ? "Ölen är ångrad." : errText(r && r.error)); u.remove(); try { A.refresh(); A.updateCounts(); } catch (e) {} });
    });
    q(".pnb-row").appendChild(u);
  }

  /* ---------- hooks (BOLD: flag + Ikväll menu) ---------- */
  var feat = {
    init: function (api) { A = api; },
    onFlags: function () { if (!on()) close(); },
    menuRow: function (rowFn, closeMenu) {
      if (!on()) return null;
      return rowFn("cheers", "Skåla med telefonen", "Skaka, knacka, skål", function () { try { closeMenu(); } catch (e) {} open(); });
    }
  };
  PN.bump = { open: open, close: close, makeMotion: makeMotion, CFG: CFG,
    _state: function () { return { open: !!ov, view: st && st.view, fill: st ? st.motion.fill() : 0, phase: st ? st.motion.phase() : null, seen: !!(st && st.seen) }; } };
  if (W("BOLD")) W("BOLD").add(feat);
})();
