/* PintsNow — 🍻 SKÅL! (agent bold, owner OK 2026-11-08, flag bold_bump, migration 0386). window.BOLD_BUMP.
   Two (or more) friends stand together and press SKÅL at the same time → both phones go KLIRR. Counts meetings, never drinks
   ("Vatten räknas också"). The server matches the taps: within 3 s, friends (group or accepted), not blocked, ≤ 30 m (GPS
   good) / ≤ accA + accB (max 80 m) / or the same bar. +2 meriter per new friend per night (max 10), medal progress
   "Skålbroder" brons 3 · silver 10 · guld 25 unique friend-nights.
   Feel: the tap answers at once on the phone (< 100 ms: the glass tilts, a short tick — navigator.vibrate on Android, the
   iOS 18 switch haptic via FX.hapticTrigger on iPhone, sound unlocked by the tap). Then the match (≈ 0.3–1 s): the big clink
   (animation + FX.sound.clink + vibration on Android). The first tapper asks bold_bump_wait every 350 ms for max 4 s.
   "Nära dig nu" (owner decision C): while the Skål! screen is open (every 10 s) and, on a night out, at most once a minute
   from the AUTOCI GPS readings, the phone sends its position to bold_presence_ping (friends only, 3 min life, never in
   spökläge). A calm HUD chip "🍻 Milos ä nära · Skål!" once per friend per night.
   Ways in: the Ikväll chip menu row "Skål!", the HUD chip, the bar sheet button "Skåla med nån här".
   Public: BOLD_BUMP = { open(), close(), _state() }. */
(function () {
  "use strict";
  var U = window.U;
  var KEY = "bold_bump", A = null, ov = null, fix = null, near = [], chipFor = null, pingAt = 0, pingBusy = false, busy = false, off = false;
  var SEEN = "olnu.bbNear", PING_OPEN = 10e3, PING_BG = 60e3;
  function W(n) { return window[n] || null; }
  function on() { try { return !!(W("BOLD") && W("BOLD").on(KEY)); } catch (e) { return false; } }
  function esc(s) { return U && U.esc ? U.esc(s) : String(s == null ? "" : s); }
  function ic(n, c) { try { return W("PNI") ? W("PNI").svg(n, c || "") : ""; } catch (e) { return ""; } }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function log(n, p) { try { if (W("PNLOG") && W("PNLOG").event) W("PNLOG").event("bb." + n, p || {}); } catch (e) {} }
  function FX() { return W("FX"); }
  function vib(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function evening() { return new Date(Date.now() - 6 * 3600e3).toDateString(); }
  function ghost() { try { return !!(W("EXTRAS") && W("EXTRAS").ghostOn && W("EXTRAS").ghostOn()); } catch (e) { return false; } }
  function out() { try { return !!((A.myBeer && A.myBeer()) || (A.myCheckin && A.myCheckin())); } catch (e) { return false; } }
  function myBar() { try { var c = A.myCheckin && A.myCheckin(); return c ? String(c.id) : null; } catch (e) { return null; } }
  function errText(e) {
    var m = String((e && (e.message || e.details)) || "");
    if (/slow_down/.test(m)) return "Lugn! Ett skål i taget.";
    if (/bump_limit/.test(m)) return "40 skål ikväll. Glasen behöver vila.";
    if (/feature_off/.test(m)) return "Skål! ä int' på än.";
    return "Det gick int'. Prova igen.";
  }

  /* ---------- position ---------- */
  function warmFix() {
    if (!navigator.geolocation) return;
    try {
      navigator.geolocation.getCurrentPosition(function (p) { fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() }; if (ov) ping(true); },
        function () {}, { enableHighAccuracy: true, maximumAge: 20000, timeout: 6000 });
    } catch (e) {}
  }
  function curFix() {
    if (fix && Date.now() - fix.at < 2 * 60e3) return fix;
    try { var c = A.lastLoc && A.lastLoc(); if (c && isFinite(c.lat)) return { lat: c.lat, lng: c.lng, acc: 60, at: Date.now() }; } catch (e) {}
    return null;
  }
  function onFix(type, x) {
    if (type !== "fix" || !x || !isFinite(x.lat)) return;
    fix = { lat: x.lat, lng: x.lng, acc: x.acc || 50, at: Date.now() };
    if (on() && out() && !ghost()) ping(false);
  }

  /* ---------- Nära dig nu ---------- */
  function ping(force) {
    if (off || pingBusy || !A || !A.LIVE || !on()) return;
    var gap = ov ? PING_OPEN : PING_BG; if (!force && Date.now() - pingAt < gap) return;
    var f = curFix(); if (!f) return;
    pingBusy = true; pingAt = Date.now();
    A.rpc("bold_presence_ping", { p_lat: f.lat, p_lng: f.lng, p_acc: f.acc }).then(function (r) {
      pingBusy = false;
      if (r && r.error) { if (U.missing && U.missing(r.error)) off = true; return; }
      var d = A.parseData(r && r.data) || {}; near = Array.isArray(d.near) ? d.near : [];
      paintNear();
      var seen = {}; try { seen = JSON.parse(localStorage.getItem(SEEN) || "{}"); } catch (e) {}
      if (seen.ev !== evening()) seen = { ev: evening(), n: {} };
      var nw = near.filter(function (x) { return !seen.n[x.name]; })[0];
      if (nw && !ov) { chipFor = nw.name; seen.n[nw.name] = 1; try { localStorage.setItem(SEEN, JSON.stringify(seen)); } catch (e) {} try { A.updateCounts(); } catch (e) {} }
    }, function () { pingBusy = false; });
  }

  /* ---------- the screen ---------- */
  function paintNear() {
    if (!ov) return;
    var box = ov.querySelector(".bb-near"); if (!box) return;
    box.innerHTML = '<p class="bb-near-h">Nära dig nu</p>' + (near.length ? near.map(function (x) {
      return '<div class="bb-near-r"><span>' + ic("users", "bb-ni") + esc(x.name) + "</span><small>" + esc(x.d || "nära") + "</small></div>";
    }).join("") : '<p class="bb-near-e">' + (ghost() ? "Spökläge: du syns int' och ser ingen här." : "Ingen kompis med appen öppen här just nu. Skåla ändå – det funkar om ni trycker samtidigt.") + "</p>");
  }
  function stats(s) {
    if (!ov || !s) return;
    var t = ov.querySelector(".bb-stats"), name = s.tier === "guld" ? "Skålbroder guld" : s.tier === "silver" ? "Skålbroder silver" : s.tier === "brons" ? "Skålbroder brons" : "Skålbroder";
    t.textContent = name + (s.next ? " · " + (s.total | 0) + "/" + s.next : " · " + (s.total | 0) + " skål");
  }
  function open() {
    if (!on() || !A) return false;
    try { if (A.sheetOpen && A.sheetOpen()) A.closeSheet(); } catch (e) {}
    if (ov) return true;
    chipFor = null; try { A.updateCounts(); } catch (e) {}
    ov = el("div", "bb-ov"); ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Skål!");
    ov.innerHTML = '<div class="bb-top"><span class="bb-stats">Skålbroder</span></div>' +
      '<div class="bb-head"><h2 class="bb-t">Skål!</h2><p class="bb-s">Ställ er nära. Tryck samtidigt.</p></div>' +
      '<div class="bb-stage"><div class="bb-ring"></div><div class="bb-ring bb-ring2"></div>' +
      '<button type="button" class="bb-btn" aria-label="Skål! Tryck samtidigt som din kompis"><span class="bb-glass" aria-hidden="true">' + ic("cheers", "") + '</span><b>SKÅL</b></button></div>' +
      '<p class="bb-msg" role="status" aria-live="polite"></p><div class="bb-near"></div><p class="bb-foot">Vatten räknas också. Räknar möten, aldrig öl.</p>';
    var x = el("button", "bb-x", ic("x", "")); x.type = "button"; x.setAttribute("aria-label", "Stäng"); ov.appendChild(x);
    document.body.appendChild(ov); document.body.classList.add("bb-on");
    var b = ov.querySelector(".bb-btn");
    try { if (FX() && FX().hapticTrigger) FX().hapticTrigger(b); } catch (e) {}
    b.addEventListener("click", tap);
    x.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    paintNear(); warmFix(); ping(true);
    A.rpc("bold_bump_stats").then(function (r) { if (r && !r.error) stats(A.parseData(r.data)); });
    ov.__iv = setInterval(function () { ping(false); }, PING_OPEN);
    log("open");
    return true;
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  function close() {
    if (!ov) return;
    clearInterval(ov.__iv); document.removeEventListener("keydown", onKey);
    var o = ov; ov = null; o.remove(); document.body.classList.remove("bb-on");
  }
  function msg(t, cls) { if (!ov) return; var m = ov.querySelector(".bb-msg"); m.textContent = t; m.className = "bb-msg" + (cls ? " " + cls : ""); }
  function tap() {
    if (!ov || busy) return;
    var b = ov.querySelector(".bb-btn"), t0 = performance.now();
    // 1. local feedback at once
    b.classList.remove("bb-hit", "bb-yes", "bb-no"); void b.offsetWidth; b.classList.add("bb-tilt");
    vib(20); try { if (FX()) FX().unlock(); } catch (e) {}
    msg("Väntar på skålen…", "bb-wait");
    ov.__local = Math.round(performance.now() - t0);
    busy = true;
    var f = curFix();
    A.rpc("bold_bump", { p_lat: f ? f.lat : null, p_lng: f ? f.lng : null, p_acc: f ? f.acc : null, p_bar_id: myBar() }).then(function (r) {
      if (r && r.error) { busy = false; b.classList.remove("bb-tilt"); msg(errText(r.error), "bb-err"); return; }
      var d = A.parseData(r && r.data) || {};
      if (d.matched && d.matched.length) { done(d, t0); return; }
      var tries = 0;
      (function wait() {
        if (!ov) { busy = false; return; }
        setTimeout(function () {
          A.rpc("bold_bump_wait", { p_id: d.id }).then(function (q) {
            var w = q && !q.error ? A.parseData(q.data) || {} : {};
            if (w.matched && w.matched.length) { done(w, t0); return; }
            if (w.done || ++tries >= 12) { busy = false; nope(); return; }
            wait();
          }, function () { if (++tries >= 12) { busy = false; nope(); } else wait(); });
        }, 350);
      })();
    }, function () { busy = false; b.classList.remove("bb-tilt"); msg("Ingen täckning. Prova igen.", "bb-err"); });
  }
  function nope() {
    if (!ov) return;
    var b = ov.querySelector(".bb-btn"); b.classList.remove("bb-tilt"); b.classList.add("bb-no");
    msg("Ingen skålade tillbaka. Tryck samtidigt!", "bb-err");
    log("miss");
  }
  function done(d, t0) {
    busy = false;
    if (!ov) return;
    var b = ov.querySelector(".bb-btn"), names = (d.matched || []).map(function (x) { return x.name; });
    b.classList.remove("bb-tilt"); b.classList.add("bb-yes");
    try { if (FX()) FX().sound.clink(); } catch (e) {}
    vib([40, 40, 80]);
    var who = names.length > 1 ? names.slice(0, -1).join(", ") + " och " + names[names.length - 1] : names[0] || "kompisen";
    msg("SKÅL med " + who + "!" + ((d.pts | 0) > 0 ? " +" + d.pts + " meriter" : (d.new_pairs | 0) === 0 ? " Redan skålat ikväll – räknas en gång per natt." : ""), "bb-ok");
    stats(d.stats);
    ov.__match = Math.round(performance.now() - t0);
    log("match", { n: names.length, ms: ov.__match, pts: d.pts | 0 });
  }

  /* ---------- hooks ---------- */
  var feat = {
    key: KEY,
    init: function (api) {
      A = api;
      try { if (W("AUTOCI") && W("AUTOCI").listen) W("AUTOCI").listen(onFix); } catch (e) {}
      document.addEventListener("click", function (e) { var t = e.target && e.target.closest && e.target.closest("[data-bold-bump]"); if (t) { e.preventDefault(); open(); } });
    },
    onPoll: function () { if (out() && !ghost()) ping(false); },
    onFlags: function () { if (!on()) { close(); chipFor = null; } },
    hudChipsHTML: function () { return chipFor && !ov ? '<button type="button" class="hx-chip bb-chip" data-hx="bold-bump">🍻 ' + esc(chipFor) + " ä nära · Skål!</button>" : ""; },
    hudClick: function (a) { if (a === "bold-bump") open(); },
    barPopupHTML: function (bar) { return bar && myBar() === String(bar.id) ? '<button type="button" class="btn btn-block bb-bar" data-bold-bump="1">' + ic("cheers", "") + '<span>Skåla med nån här</span></button>' : ""; },
    menuRow: function (rowFn, closeMenu) { return rowFn("cheers", "Skål!", "Tryck samtidigt med en kompis", function () { try { closeMenu(); } catch (e) {} open(); }); }
  };
  window.BOLD_BUMP = { open: open, close: close, _state: function () { return { open: !!ov, near: near, chip: chipFor, local: ov && ov.__local, match: ov && ov.__match, fix: fix }; } };
  if (W("BOLD")) W("BOLD").add(feat);
})();
