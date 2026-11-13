/* PintsNow — Skåla med telefonen (lane bump, 13 Nov 2026; scratch BUMP-PLAN.md; migration 0509). Owner design 13 Nov 01:15–01:18.
   Shake → a glass opens by itself and fills. Knock phones with a friend → the server MATCHES the two knocks. Each person tilts
   the phone like a glass and drinks it empty (the beer drains with the tilt angle; foam stays at the rim). When BOTH glasses are
   empty within 60 s of the match → one ÖL! each (post_beer_v2: same 10-min rule, undo, spökläge), then the normal ÖL! confirmation
   (hook A.beerFromBump from app-beer.js; else a toast with Ångra). A shake alone NEVER logs. No knock within ~8 s: the glass fades.
   One person does not finish in time: nothing is logged, "Skålen rann ut". No buttons to log, no fallbacks (owner 01:18).
   - On: localStorage olnu.bump = "1" (set by ?bump=1, cleared by ?bump=0) or PN_CFG.bump === true or the server flag
     bold_flags.pn_bump; never in a store build (OLNU_STORE). The server refuses with feature_off while pn_bump is off.
   - Battery: the devicemotion listener is attached only while on + page visible; detached on hide.
   - False shakes: ignored while a text field has focus, a sheet with a form is open, Följ mig hem (body.hf-on) or a live ride
     (RIDE.live()) runs, OLGLAS is open, or no account. Open = 5 strong peaks (> 14 m/s²) within 1 s: walking (in the hand or a
     pocket) and a dropped phone stay below that. Knock = one sharp spike (> 18) after 300 ms calm, calm after, no free fall before.
     Full glass (8 peaks) + 700 ms still = ready for the knock.
   - Drink: tilt = angle between "up" and the phone's top. The glass holds all ≤ 60° (the normal way to look at a phone), nothing
     ≥ 120° (past flat = towards the mouth); between, the beer runs out (faster with more excess). Flat on a table (90°) = half
     stays: no finish. The level only goes down.
     iPhone reports gravity with the opposite sign (same rule as olglas.js).
   - While on, this listener runs first (capture) and stops the event, so delight.js's shake toy does not open as well.
   - iPhone: DeviceMotionEvent.requestPermission() needs a tap. Asked ONCE with a small calm card after the first ÖL! press
     while the feature is on (olnu.bump.asked); the answer is stored like delight.js (olnu.og.perm). Android: no prompt.
   - Debug: ?bumpdebug=1 shows phase, |a|, tilt on the glass screen.
   Public: PN.bump = { open, close, sync, makeMotion, makeDrain, CFG, _state }. Styles: bump.css (x-lazy-css, first open). */
(function () {
  "use strict";
  var PN = window.PN = window.PN || {};
  var U = window.U;
  var CFG = { gAlpha: 0.94, freeFall: 4, openPeak: 14, openPeaks: 5, openMs: 1000, shakePeak: 12, shakeGap: 100, fillPeaks: 8,
    readyCalmMs: 700, knockPeak: 18, calm: 7, calmMs: 300, settleFrom: 60, settleMs: 160, knockGap: 800,
    tAlpha: 0.85, holdDeg: 60, emptyDeg: 120, pour: 0.35, pourK: 1.2, emptyAt: 0.02,
    fadeMs: 8000, drinkMs: 60000, skalMs: 1100, pollMs: 350, pollMax: 12, matePollMs: 800, askDelay: 1500 };
  var A = null, ov = null, st = null, attached = false, eng = null;

  /* ---------- shake + knock detector (pure) ---------- */
  // feed(t ms, x, y, z, lin) → events: { type: "open" } | { type: "peak", fill } | { type: "ready" } | { type: "knock", t, peak }.
  // lin = true: x/y/z are without gravity (event.acceleration). Phases: idle → fill → ready → sent.
  function makeMotion(cfg) {
    var c = {}, k; for (k in CFG) c[k] = cfg && cfg[k] != null ? cfg[k] : CFG[k];
    var g = null, buf = [], hits = [], peaks = 0, lastPeak = -1e9, phase = "idle", cand = null, lastKnock = -1e9;
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
    function magnitude(x, y, z, lin) {
      if (lin) return { m: Math.sqrt(x * x + y * y + z * z), raw: null };
      if (!g) g = { x: x, y: y, z: z };
      g.x = c.gAlpha * g.x + (1 - c.gAlpha) * x; g.y = c.gAlpha * g.y + (1 - c.gAlpha) * y; g.z = c.gAlpha * g.z + (1 - c.gAlpha) * z;
      return { m: Math.sqrt((x - g.x) * (x - g.x) + (y - g.y) * (y - g.y) + (z - g.z) * (z - g.z)), raw: Math.sqrt(x * x + y * y + z * z) };
    }
    function feed(t, x, y, z, lin) {
      var out = [];
      if (x == null || y == null || z == null || !isFinite(x + y + z)) return out;
      var a = magnitude(x, y, z, lin), m = a.m;
      buf.push({ t: t, m: m, raw: a.raw });
      while (buf.length && buf[0].t < t - c.calmMs - c.settleMs - 100) buf.shift();
      if (cand && t >= cand.t + c.settleMs) {   // a knock candidate waits for the calm after it
        var after = mean(cand.t + c.settleFrom, t);
        if (after !== null && after < c.calm) { out.push({ type: "knock", t: cand.t, peak: cand.m }); lastKnock = cand.t; phase = "sent"; }
        cand = null;
      }
      if (phase === "ready" && !cand && m >= c.knockPeak && t - lastKnock > c.knockGap && t - lastPeak > c.readyCalmMs) {
        var before = mean(t - c.calmMs, t - 40);
        if (before !== null && before < c.calm && !fell(t - c.calmMs, t - 20)) cand = { t: t, m: m };
      }
      if (!cand && t - lastPeak >= c.shakeGap) {
        if (phase === "idle" && m >= c.openPeak) {
          lastPeak = t; hits.push(t);
          while (hits.length && hits[0] < t - c.openMs) hits.shift();
          if (hits.length >= c.openPeaks) { phase = "fill"; peaks = hits.length; hits = []; out.push({ type: "open" }, { type: "peak", fill: Math.min(1, peaks / c.fillPeaks) }); }
        } else if (phase !== "idle" && m >= c.shakePeak) {
          lastPeak = t;
          if (phase === "fill") { peaks++; out.push({ type: "peak", fill: Math.min(1, peaks / c.fillPeaks) }); }
        }
      }
      if (phase === "fill" && peaks >= c.fillPeaks && t - lastPeak >= c.readyCalmMs) { phase = "ready"; out.push({ type: "ready" }); }
      return out;
    }
    return {
      feed: feed,
      phase: function () { return phase; },
      fill: function () { return phase === "idle" ? 0 : Math.min(1, peaks / c.fillPeaks); },
      rearm: function () { phase = peaks >= c.fillPeaks ? "ready" : "fill"; cand = null; },
      reset: function () { peaks = 0; hits = []; phase = "idle"; cand = null; }
    };
  }

  /* ---------- tilt-to-drink (pure) ---------- */
  // feed(t ms, x, y, z) with accelerationIncludingGravity → { level 0..1, tilt deg, roll deg, empty (true once) }.
  function makeDrain(cfg) {
    var c = {}, k; for (k in CFG) c[k] = cfg && cfg[k] != null ? cfg[k] : CFG[k];
    var s = cfg && cfg.ios ? -1 : 1, g = null, lastT = null, level = 1, tilt = 0, roll = 0, fired = false;
    function cap(d) { return d <= c.holdDeg ? 1 : d >= c.emptyDeg ? 0 : 1 - (d - c.holdDeg) / (c.emptyDeg - c.holdDeg); }
    function feed(t, x, y, z) {
      var out = { level: level, tilt: tilt, roll: roll };
      if (x == null || y == null || z == null || !isFinite(x + y + z)) return out;
      x *= s; y *= s; z *= s;
      if (!g) g = { x: x, y: y, z: z };
      g.x = c.tAlpha * g.x + (1 - c.tAlpha) * x; g.y = c.tAlpha * g.y + (1 - c.tAlpha) * y; g.z = c.tAlpha * g.z + (1 - c.tAlpha) * z;
      var n = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z), dt = lastT === null ? 0 : Math.min(0.1, Math.max(0, (t - lastT) / 1000));
      lastT = t;
      if (n < 3) return out;   // free fall / junk: no new angle
      tilt = Math.acos(Math.max(-1, Math.min(1, g.y / n))) * 180 / Math.PI;
      if (Math.sqrt(g.x * g.x + g.y * g.y) / n > 0.3) roll = Math.max(-75, Math.min(75, Math.atan2(g.x, Math.abs(g.y)) * 180 / Math.PI));
      var cp = cap(tilt);
      if (level > cp) level = Math.max(cp, level - (c.pour + c.pourK * (level - cp)) * dt);
      out = { level: level, tilt: tilt, roll: roll };
      if (!fired && level <= c.emptyAt) { fired = true; level = 0; out.level = 0; out.empty = true; }
      return out;
    }
    return { feed: feed, level: function () { return level; }, cap: cap };
  }

  /* ---------- helpers ---------- */
  function W(n) { return window[n] || null; }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  (function urlSwitch() {   // per-phone test switch for the owner: ?bump=1 / ?bump=0
    try { var m = /[?&]bump=([01])\b/.exec(location.search || ""); if (m) ls("olnu.bump", m[1] === "1" ? "1" : null); } catch (e) {}
  })();
  function on() {
    if (window.OLNU_STORE) return false;
    if (ls("olnu.bump") === "1" || (window.PN_CFG || {}).bump === true) return true;
    try { return !!(W("BOLD") && W("BOLD").on("pn_bump")); } catch (e) { return false; }
  }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function q(s) { return ov ? ov.querySelector(s) : null; }
  function vib(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function fx() { return W("FX"); }
  function ios() { try { return !!(U && U.isIOS && U.isIOS()); } catch (e) { return false; } }
  function log(n, p) { try { if (W("PNLOG") && W("PNLOG").event) W("PNLOG").event("bump." + n, p || {}); } catch (e) {} }
  function ghost() { try { return !!(W("EXTRAS") && W("EXTRAS").ghostOn && W("EXTRAS").ghostOn()); } catch (e) { return false; } }
  function needPerm() { var DM = window.DeviceMotionEvent; return !!(DM && typeof DM.requestPermission === "function"); }
  function debugOn() { try { return /[?&]bumpdebug=1\b/.test(location.search || ""); } catch (e) { return false; } }
  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function toast(t, o) { try { if (A && A.toast) A.toast(t, o || {}); } catch (e) {} }
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
  // false-shake guards (checked before the glass opens)
  function blocked() {
    var a = document.activeElement, sh = document.getElementById("sheet");
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return "input";
    if (sh && !sh.hidden && sh.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea, select')) return "form";
    if (document.body.classList.contains("hf-on")) return "hemfolj";
    try { if (W("RIDE") && W("RIDE").live && W("RIDE").live()) return "ride"; } catch (e) {}
    try { if (W("OLGLAS") && W("OLGLAS").isOpen()) return "olglas"; } catch (e) {}
    try { if (!A || (A.authed && !A.authed())) return "account"; } catch (e) {}
    return "";
  }

  /* ---------- listener (only while on + visible) ---------- */
  function sync() {
    var want = on() && document.visibilityState === "visible" && "DeviceMotionEvent" in window;
    if (want && !attached) { eng = makeMotion(); window.addEventListener("devicemotion", onMotion, { capture: true, passive: true }); attached = true; }
    else if (!want && attached) { window.removeEventListener("devicemotion", onMotion, { capture: true }); attached = false; close(); eng = null; }
  }
  function onMotion(e) {
    if (!eng) return;
    try { if (W("OLGLAS") && W("OLGLAS").isOpen()) return; } catch (x) {}
    try { e.stopImmediatePropagation(); } catch (x) {}   // one shake = one feature (delight.js shake toy stays quiet while bump is on)
    var t = e.timeStamp || performance.now(), gi = e.accelerationIncludingGravity;
    if (st && st.drain) { if (gi && gi.x != null) drink(st.drain.feed(t, gi.x, gi.y, gi.z)); return; }
    var lin = e.acceleration && e.acceleration.x != null, a = lin ? e.acceleration : gi;
    if (!a || a.x == null) return;
    if (!ov && eng.phase() === "idle" && blocked()) return;
    var evs = eng.feed(t, a.x, a.y, a.z, lin);
    if (ov && debugOn()) { var d = q(".pnb-dbg"); if (d) d.textContent = eng.phase() + " " + Math.round(Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)); }
    for (var i = 0; i < evs.length; i++) {
      var v = evs[i];
      if (v.type === "open") { if (!open()) eng.reset(); }
      else if (!ov) continue;
      else if (v.type === "peak") { vib(12); fadeLater(); pour(eng.fill(), 0); }
      else if (v.type === "ready") { vib([30, 40, 30]); say("Redo! Knacka telefonen mot en kompis telefon.", "pnb-ok"); ov.setAttribute("data-state", "ready"); }
      else if (v.type === "knock") send(Math.max(0, Math.round(performance.now() - v.t)));
    }
  }

  /* ---------- the glass ---------- */
  function say(t, cls) { var m = q(".pnb-msg"); if (m) { m.textContent = t; m.className = "pnb-msg" + (cls ? " " + cls : ""); } }
  function pour(level, roll) {
    if (!ov) return;
    var liq = q(".pnb-liq"), lv = Math.max(0, Math.min(1, level));
    liq.style.top = ((1 - lv) * 100).toFixed(1) + "%";
    liq.style.transform = reduced() ? "" : "rotate(" + (roll || 0).toFixed(1) + "deg)";
    q(".pnb-glass").classList.toggle("pnb-full", lv >= 0.99);
    q(".pnb-glass").classList.toggle("pnb-empty", lv <= 0.001);
  }
  function fadeLater() {
    if (!st || st.drain) return;
    clearTimeout(st.fade);
    st.fade = setTimeout(function () { if (st && !st.busy && !st.drain) close(true); }, CFG.fadeMs);
  }
  function open() {
    if (!on() || !A || !eng) return false;
    if (ov) return true;
    cssOnce();
    st = { busy: false, fade: 0, drain: null, row: null, who: "", polls: 0, timers: [] };
    ov = el("div", "pnb-ov");
    ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Skåla med telefonen");
    ov.setAttribute("data-state", "fill");
    ov.innerHTML = '<button type="button" class="pnb-x" aria-label="Stäng">×</button>' +
      '<h2 class="pnb-t">Skål!</h2>' +
      '<div class="pnb-glass" aria-hidden="true"><div class="pnb-liq"><i class="pnb-b"></i><i class="pnb-b"></i><i class="pnb-b"></i></div><div class="pnb-lace"></div></div>' +
      '<p class="pnb-msg" role="status" aria-live="polite">Skaka tills glaset är fullt.</p>' +
      '<p class="pnb-foot">Knacka ihop telefonerna med en vän och töm glasen. Då loggas en öl för er båda, med samma 10-minutersregel.</p>' +
      (debugOn() ? '<p class="pnb-dbg"></p>' : "");
    document.body.appendChild(ov); document.body.classList.add("pnb-on");
    q(".pnb-x").addEventListener("click", function () { close(); });
    document.addEventListener("keydown", onKey);
    pour(eng.fill(), 0); fadeLater();
    log("open");
    return true;
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  function close(fade) {
    if (!ov) return;
    document.removeEventListener("keydown", onKey);
    if (st) { clearTimeout(st.fade); st.timers.forEach(clearTimeout); }
    if (eng) eng.reset();
    var o = ov; ov = null; st = null; document.body.classList.remove("pnb-on");
    if (fade) { o.classList.add("pnb-fade"); setTimeout(function () { o.remove(); }, 600); log("fade"); } else o.remove();
  }
  function later(fn, ms) { var s = st; if (s) s.timers.push(setTimeout(function () { if (st === s) fn(); }, ms)); }

  /* ---------- server: knock → match ---------- */
  function spot() {
    var ci = null; try { ci = A.myCheckin && A.myCheckin(); } catch (e) {}
    if (ci && isFinite(+ci.lat)) return { lat: +ci.lat, lng: +ci.lng, acc: 10, precise: true };
    try { var l = A.lastLoc && A.lastLoc(); if (l && isFinite(l.lat)) return { lat: l.lat, lng: l.lng, acc: 50, precise: false }; } catch (e) {}
    return null;
  }
  function data(r) { return r && !r.error ? A.parseData(r.data) || {} : null; }
  function send(ago) {
    if (!st || st.busy) return;
    st.busy = true; clearTimeout(st.fade);
    var s = spot(), mine = st;
    st.spot = s; st.ghost = ghost();
    vib(20); try { if (fx()) fx().unlock(); } catch (e) {}
    say("Väntar på kompisen…", "pnb-wait");
    var p = { p_lat: s ? s.lat : null, p_lng: s ? s.lng : null, p_ago_ms: ago | 0, p_acc: s ? s.acc : null, p_precise: !!(s && s.precise), p_hidden: st.ghost, p_kind: "bump" };
    A.rpc("bump_ready", p).then(function (r) {
      if (st !== mine) return;
      if (r && r.error) { miss(errText(r.error)); return; }
      var d = data(r) || {}, tries = 0;
      if (d.pair) { matched(d); return; }
      (function wait() {
        later(function () {
          A.rpc("bump_wait", { p_id: d.id }).then(function (x) {
            if (st !== mine) return;
            var w = data(x) || {};
            if (w.pair) matched(w);
            else if (w.done || ++tries >= CFG.pollMax) miss();
            else wait();
          }, function () { if (++tries >= CFG.pollMax) miss(); else wait(); });
        }, CFG.pollMs);
      })();
    }, function () { miss("Ingen täckning. Prova igen."); });
  }
  function miss(text) {
    if (!st) return;
    st.busy = false; if (eng) eng.rearm();
    say(text || "Ingen knackade tillbaka. Försök igen, samtidigt.", "pnb-err");
    fadeLater();
    log("miss");
  }

  /* ---------- match → drink → both empty → ÖL! ---------- */
  function matched(d) {
    st.row = d.id; st.who = (d.matched && d.matched[0] && d.matched[0].name) || "kompisen";
    st.drain = makeDrain({ ios: ios() }); clearTimeout(st.fade);
    try { if (fx()) fx().sound.clink(); } catch (e) {}
    vib([40, 40, 80]);
    ov.setAttribute("data-state", "drink"); q(".pnb-glass").classList.add("pnb-clink");
    pour(1, 0);
    say("Skål med " + st.who + "! Luta telefonen mot munnen som ett glas.", "pnb-ok");
    var left = isFinite(d.left_s) && d.left_s > 0 ? d.left_s * 1000 : CFG.drinkMs;
    later(function () { if (!st.drained) ranOut(); }, left);
    log("match");
  }
  function drink(r) {
    if (!st || st.drained) return;
    pour(r.level, r.roll);
    if (debugOn()) { var d = q(".pnb-dbg"); if (d) d.textContent = "drink " + Math.round(r.tilt) + "° " + Math.round(r.level * 100) + "%"; }
    if (r.level < 0.97 && !st.sipped) { st.sipped = true; vib(15); }
    if (r.empty) { st.drained = true; vib([20, 30, 20]); say("Tomt! Väntar på " + st.who + "…", "pnb-wait"); finish(); }
  }
  function finish() {
    var mine = st;
    A.rpc("bump_finish", { p_id: st.row }).then(function (r) { if (st === mine) mate(data(r), mine); }, function () { if (st === mine) mate(null, mine); });
  }
  function mate(d, mine) {
    if (d && d.both) { skal(d.beer || {}); return; }
    if ((d && d.expired) || ++mine.polls > 100) { ranOut(); return; }
    later(function () {
      A.rpc("bump_wait", { p_id: mine.row }).then(function (r) { if (st === mine) mate(data(r) || (r && r.error ? { expired: true } : null), mine); },
        function () { if (st === mine) mate(null, mine); });
    }, CFG.matePollMs);
  }
  function ranOut() {
    if (!st) return;
    say("Skålen rann ut. Ingen öl loggad.", "pnb-err");
    st.drained = true; log("ranout");
    later(function () { close(true); }, 2500);
  }
  function skal(b) {
    var who = st.who, s = st.spot, gh = st.ghost;
    try { if (fx()) fx().sound.clink(); } catch (e) {}
    vib([40, 40, 80]);
    ov.setAttribute("data-state", "skal");
    say("Skål! Ni tömde glasen.", "pnb-ok");
    log("skal", { beer: b.accepted === true });
    later(function () { close(); confirm(b, s, gh, who); }, CFG.skalMs);
  }
  function confirm(b, s, gh, who) {
    if (b.accepted === true) {
      if (A.beerFromBump) { try { A.beerFromBump(b, { lat: +b.lat, lng: +b.lng, precise: !!(s && s.precise) }, gh); return; } catch (e) {} }
      try { A.refresh(); A.updateCounts(); } catch (e) {}
      toast("Skål med " + who + "! Loggad som öl.", b.undo_until ? { ms: 12000, action: { label: "Ångra", fn: undo } } : { ms: 6000 });
    } else if (b.accepted === false && (b.wait_seconds | 0) > 0) {
      toast("Skål med " + who + "! Du har paus i " + U.mmss((b.wait_seconds | 0) * 1000) + ". Ingen ny öl loggad.", { ms: 7000 });
    } else toast("Skål med " + who + "! Ölen kunde inte loggas.", { err: true, ms: 6000 });
  }
  function undo() {
    A.rpc("undo_beer").then(function (r) { toast(r && !r.error ? "Ölen är ångrad." : errText(r && r.error)); try { A.refresh(); A.updateCounts(); } catch (e) {} });
  }

  /* ---------- iPhone: ask the motion permission once (after the first ÖL! press while on) ---------- */
  function maybeAsk() {
    if (!on() || !needPerm() || ls("olnu.bump.asked") === "1" || ls("olnu.og.perm") === "1" || document.querySelector(".pnb-ask")) return;
    var c = el("div", "pnb-ask"); c.setAttribute("role", "dialog"); c.setAttribute("aria-label", "Skåla med telefonen");
    c.innerHTML = '<p>Nytt: skaka telefonen, knacka ihop den med en väns telefon och töm glasen, så loggas ölen för er båda. Telefonen behöver få känna rörelse.</p>' +
      '<div class="pnb-ask-row"><button type="button" class="btn btn-amber pnb-ask-ok">Tillåt rörelse</button><button type="button" class="btn pnb-ask-no">Inte nu</button></div>';
    cssOnce(); document.body.appendChild(c);
    var fin = function () { ls("olnu.bump.asked", "1"); c.remove(); };
    c.querySelector(".pnb-ask-no").addEventListener("click", fin);
    c.querySelector(".pnb-ask-ok").addEventListener("click", function () {
      fin();
      Promise.resolve().then(function () { return window.DeviceMotionEvent.requestPermission(); })
        .then(function (r) { ls("olnu.og.perm", r === "granted" ? "1" : "0"); sync(); }, function () { ls("olnu.og.perm", "0"); });
    });
    log("ask");
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("#btn-beer");
    if (b && on() && needPerm() && ls("olnu.bump.asked") !== "1") setTimeout(maybeAsk, CFG.askDelay);
  }, true);
  document.addEventListener("visibilitychange", sync);

  /* ---------- hooks (BOLD: flags) ---------- */
  var feat = {
    init: function (api) { A = api; sync(); },
    onFlags: function () { sync(); },
    onAuthed: function () { sync(); }
  };
  PN.bump = { open: open, close: close, sync: sync, makeMotion: makeMotion, makeDrain: makeDrain, CFG: CFG,
    _state: function () {
      return { on: on(), listening: attached, open: !!ov, phase: eng ? eng.phase() : null, fill: eng ? eng.fill() : 0, blocked: blocked(),
        view: ov ? ov.getAttribute("data-state") : null, level: st && st.drain ? st.drain.level() : null, drained: !!(st && st.drained) };
    } };
  if (W("BOLD")) W("BOLD").add(feat);
})();
