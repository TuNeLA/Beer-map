/* PintsNow — ✨ ALIVE2 (lane alive2, owner 13 Nov 2026 I-77: "the app must feel alive"). window.ALIVE2 + flags window.PN_ALIVE2.
   The top 5 of <scratch>/alive2-patches/EFFECTS-PROPOSAL.md. Styles: docs/alive2.css.
   1. friendRipple  a friend's new ÖL! pin sends 2 soft rings out over the map (onPoll: a new friend pin, ≤ 15 min old, in view)
   2. holPulse      holiday ÖL!: the holiday colour (Fredag 13 = purple) breathes around the ÖL! ring (body.af-hol)
      holBob        holiday badge / Fredag 13 cat scene bobs up and down again (the old app's af-bob, 3.2 s)
   3. skalGlow      my group's Skåltimmen runs: a slow amber glow just above the dock (SKAL.data(), only for me)
   4. myFoam        my own ÖL! is accepted: a foam ring + 3 bubbles at my pin on the map (onBeerAccepted; not in ghost mode)
   5. weekendDusk   Fri / Sat evening after sunset: a slow warm-violet light drifts in the map corners (no data at all)
   Flags: PN_ALIVE2 = { key: true/false }. Default ON on the web. Store builds (OLNU_STORE): every effect that is about drinking
   (friendRipple, holPulse, skalGlow, myFoam) is OFF and cannot be turned on. A page may set window.PN_ALIVE2 = { key: false }
   before this file loads to turn one off. The "Levande karta" switch (alive.js, pn_alive_off) turns all of them off.
   Rules: CSS transform / opacity only, no per-frame JS. Max 12 animated elements on screen (BUDGET). Paused while the map
   moves (map movestart / html.map-moving / pn:mapmove) and while the tab is hidden (no new effect starts then).
   prefers-reduced-motion = still: no animation (a static ring / glow, or nothing). Data Saver = still. No text, no counts,
   no sound, no push: nothing here asks anyone to drink more. Any error = all off + one console.warn. */
(function () {
  "use strict";
  var W = window, D = W.document, PN = W.PN;
  var DRINK = { friendRipple: 1, holPulse: 1, skalGlow: 1, myFoam: 1 }, KEYS = ["friendRipple", "holPulse", "holBob", "skalGlow", "myFoam", "weekendDusk"];
  var BUDGET = 12, COST = { ripple: 2, foam: 4, holring: 1, bob: 1, skal: 1, dusk: 2 }, RIPPLE_MAX = 3, FRIEND_AGE = 15 * 60e3, BOOT_AGE = 3 * 60e3;
  var A = null, map = null, pane = null, seen = null, moving = false, dead = false, tick = 0, clock = null;
  var stats = { ripples: 0, foams: 0, skip: "" };

  function isStore() {
    try { if (W.OLNU_STORE != null) return !!W.OLNU_STORE; } catch (e) {}
    try { return D.documentElement.classList.contains("olnu-store"); } catch (e) { return false; }
  }
  // the flag object: the page's own value wins on the web; a store build always has the drink effects off
  var pre = W.PN_ALIVE2 && typeof W.PN_ALIVE2 === "object" ? W.PN_ALIVE2 : {};
  var F = {};
  KEYS.forEach(function (k) { F[k] = isStore() && DRINK[k] ? false : (typeof pre[k] === "boolean" ? pre[k] : true); });
  W.PN_ALIVE2 = F;

  function on(k) { if (dead || !F[k]) return false; if (isStore() && DRINK[k]) return false; return !aliveOff(); }
  function aliveOff() { try { return W.localStorage.getItem("pn_alive_off") === "1"; } catch (e) { return false; } }
  function mq(q) { try { return W.matchMedia(q).matches; } catch (e) { return false; } }
  function still() { return mq("(prefers-reduced-motion: reduce)") || saveData(); }
  function saveData() { try { return !!(W.navigator.connection && W.navigator.connection.saveData); } catch (e) { return false; } }
  function hidden() { return D.hidden || D.visibilityState === "hidden"; }
  function now() { return clock != null ? clock : Date.now(); }
  function fail(e) { if (dead) return; dead = true; try { console.warn("alive2 off", e); } catch (x) {} try { clearAll(); } catch (x) {} }

  /* ---------- budget: animated elements on screen ---------- */
  function used() {
    var n = 0; D.querySelectorAll(".a2-fx").forEach(function (e) { if (e.isConnected) n += +e.getAttribute("data-a2n") || 1; });
    return n + D.querySelectorAll("[data-a2bob]").length;
  }
  function room(c) { return used() + c <= BUDGET; }

  /* ---------- time helpers (Europe/Stockholm) ---------- */
  function sthlm(ms) {
    try {
      var o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23", weekday: "short" })
        .formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
      return { h: (+o.hour) % 24, dow: { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[o.weekday] || 1 };
    } catch (e) { var d = new Date(ms); return { h: d.getHours(), dow: d.getDay() || 7 }; }
  }
  // Fri / Sat evening (17–24) and the night after (00–02 Sat / Sun), and the sun is down at the map centre (alive.js formula)
  function weekendEvening(ms, lat, lng) {
    var s = sthlm(ms), eve = (s.dow === 5 || s.dow === 6) && s.h >= 17, late = (s.dow === 6 || s.dow === 7) && s.h < 2;
    if (!eve && !late) return false;
    try { if (W.ALIVE && W.ALIVE._isNight && isFinite(lat)) return W.ALIVE._isNight(ms, lat, lng); } catch (e) {}
    return s.h >= 18 || late;
  }
  function groupSkal() {
    try { var t = now(); return !!(W.SKAL && W.SKAL.data && W.SKAL.data().some(function (h) { return Date.parse(h.ends_at) > t; })); } catch (e) { return false; }
  }

  /* ---------- 1. friend ÖL! ripple + 4. my foam (map markers in an own pane) ---------- */
  function mark(lat, lng, cls, html, cost, life) {
    if (!map || !W.L || !isFinite(lat) || !isFinite(lng)) return null;
    var st = still();
    var m = W.L.marker([lat, lng], { pane: "alive2", interactive: false, keyboard: false, bubblingMouseEvents: false,
      icon: W.L.divIcon({ className: "a2-fx " + cls + (st ? " a2-still" : ""), html: html, iconSize: [0, 0], iconAnchor: [0, 0] }) }).addTo(map);
    var el = m.getElement && m.getElement();
    if (el) el.setAttribute("data-a2n", String(cost));
    var done = function () { try { map.removeLayer(m); } catch (e) {} };
    if (st) setTimeout(done, 2400);   // reduced motion: a still mark for a moment, then gone
    else if (el) {
      var last = el.querySelector(".a2-last") || el;
      last.addEventListener("animationend", done);
      setTimeout(done, life);         // fallback (paused time included)
    } else setTimeout(done, 3000);
    return m;
  }
  function inView(lat, lng) { try { return map.getBounds().pad(-0.02).contains([lat, lng]); } catch (e) { return false; } }
  function ripple(lat, lng) {
    if (!on("friendRipple") || hidden() || !room(COST.ripple)) return false;
    if (D.querySelectorAll(".a2-ripple").length >= RIPPLE_MAX) return false;
    var m = mark(+lat, +lng, "a2-ripple", "<i></i><i class=\"a2-last\"></i>", COST.ripple, 30e3);
    if (m) stats.ripples++;
    return !!m;
  }
  function onPoll(beers) {
    if (!Array.isArray(beers)) return;
    var first = !seen, t = now(), fresh = [];
    seen = seen || {};
    beers.forEach(function (b) {
      if (!b || b.id == null || seen[b.id]) return;
      seen[b.id] = 1;
      if (!b.friend_name || b.is_mine) return;
      var age = t - (Date.parse(b.created_at) || 0);
      if (age < -60e3 || age > (first ? BOOT_AGE : FRIEND_AGE)) return;
      if (map && inView(+b.lat, +b.lng)) fresh.push(b);
    });
    if (!fresh.length || !on("friendRipple") || hidden()) return;
    var c = map.getCenter();
    fresh.sort(function (a, b) { return map.distance(c, [a.lat, a.lng]) - map.distance(c, [b.lat, b.lng]); });
    fresh.slice(0, RIPPLE_MAX).forEach(function (b, i) { setTimeout(function () { ripple(b.lat, b.lng); }, i * 450); });
  }
  function foam(lat, lng) {
    if (!on("myFoam") || hidden() || still() || !room(COST.foam)) return false;   // reduced motion: none (like FX.splash)
    var m = mark(+lat, +lng, "a2-foam", "<i class=\"a2-ring\"></i><b style=\"--x:-9px\"></b><b style=\"--x:2px\"></b><b class=\"a2-last\" style=\"--x:10px\"></b>", COST.foam, 8e3);
    if (m) stats.foams++;
    return !!m;
  }
  function onBeer(d, info) {
    if (!d || (info && info.ghost)) return;
    var lat = +d.lat, lng = +d.lng;
    if (!isFinite(lat) || !isFinite(lng)) { var mb = A && A.myBeer ? A.myBeer() : null; if (mb) { lat = +mb.lat; lng = +mb.lng; } }
    if (isFinite(lat) && isFinite(lng) && map && inView(lat, lng)) foam(lat, lng);
  }

  /* ---------- 2. holiday ÖL! pulse + bob, 3. Skåltimmen glow, 5. weekend dusk (screen layers) ---------- */
  function holRing(want) {
    var wrap = D.querySelector(".beer-wrap"), btn = D.getElementById("btn-beer"), r = D.getElementById("a2-holring");
    if (!want || !wrap || !btn) { if (r) r.remove(); return; }
    if (!r) {
      if (!room(COST.holring)) return;
      r = D.createElement("span"); r.id = "a2-holring"; r.className = "a2-fx a2-holring"; r.setAttribute("aria-hidden", "true"); r.setAttribute("data-a2n", "1");
      wrap.insertBefore(r, wrap.firstChild);
    }
    r.classList.toggle("a2-still", still());
    var s = r.style, L = btn.offsetLeft + "px", T = btn.offsetTop + "px", WI = btn.offsetWidth + "px", H = btn.offsetHeight + "px";
    if (s.left !== L) s.left = L; if (s.top !== T) s.top = T; if (s.width !== WI) s.width = WI; if (s.height !== H) s.height = H;
  }
  function holBob(want) {
    var b = D.getElementById("af-hol-e");
    // an attribute, not a class: after.js / f13 keep their exact className on the badge
    D.querySelectorAll("[data-a2bob]").forEach(function (e) { if (e !== b || !want) e.removeAttribute("data-a2bob"); });
    if (!want || !b || b.hasAttribute("data-a2bob")) return;
    if (!room(COST.bob)) return;
    b.setAttribute("data-a2bob", "1");
  }
  function layer(id, cls, want, cost, html) {
    var e = D.getElementById(id);
    if (!want) { if (e) e.remove(); return null; }
    if (!e) {
      if (!room(cost)) return null;
      e = D.createElement("div"); e.id = id; e.className = "a2-fx " + cls; e.setAttribute("aria-hidden", "true"); e.setAttribute("data-a2n", String(cost));
      if (html) e.innerHTML = html;
      D.body.appendChild(e);
    }
    e.classList.toggle("a2-still", still());
    return e;
  }
  function sync() {
    if (dead) return;
    try {
      var hol = D.body && D.body.classList.contains("af-hol"), c = map ? map.getCenter() : { lat: 60.15, lng: 15.19 };
      holBob(hol && on("holBob"));
      holRing(hol && on("holPulse"));
      layer("a2-skal", "a2-skal", on("skalGlow") && groupSkal(), COST.skal);
      layer("a2-dusk", "a2-dusk", on("weekendDusk") && weekendEvening(now(), c.lat, c.lng), COST.dusk, "<i></i><i></i>");
      stats.skip = aliveOff() ? "off" : still() ? "still" : "";
    } catch (e) { fail(e); }
  }
  function clearAll() {
    ["a2-holring", "a2-skal", "a2-dusk"].forEach(function (id) { var e = D.getElementById(id); if (e) e.remove(); });
    D.querySelectorAll("[data-a2bob]").forEach(function (e) { e.removeAttribute("data-a2bob"); });
    if (pane) pane.innerHTML = "";
  }

  /* ---------- pause: map moves / tab hidden ---------- */
  // CSS (html.a2-move / a2-hidden) pauses what starts while paused; running loops are paused with WAAPI too, because once the
  // app's own map-move pause (app-map.js pauseLoops / playLoops) has touched an animation, CSS animation-play-state no longer applies.
  var held = [], endT = 0;
  function hold(on) {
    if (!D.getAnimations) return;
    if (on) D.getAnimations().forEach(function (a) { var t = a.effect && a.effect.target; if (a.playState === "running" && t && t.closest && t.closest(".a2-fx,[data-a2bob]")) { a.pause(); held.push(a); } });
    else { var l = held; held = []; l.forEach(function (a) { try { var t = a.effect && a.effect.target; if (a.playState === "paused" && t && t.isConnected) a.play(); } catch (e) {} }); }
  }
  function pauseState() {
    var de = D.documentElement; de.classList.toggle("a2-move", moving); de.classList.toggle("a2-hidden", hidden());
    try { hold(moving || hidden()); } catch (e) {}
  }
  function setMoving(v) { clearTimeout(endT); moving = !!v; pauseState(); }
  function moveEnd() {   // app-map.js clears html.map-moving 150 ms after the last moveend (pn:mapmove); without it: 400 ms
    clearTimeout(endT); endT = setTimeout(function () { if (!D.documentElement.classList.contains("map-moving")) { moving = false; pauseState(); sync(); } }, 400);
  }
  function setHidden() { pauseState(); if (!hidden()) sync(); }

  function start(api) {
    A = api; map = api && api.map;
    if (map && W.L && map.createPane) {
      pane = map.getPane("alive2") || map.createPane("alive2"); pane.style.zIndex = 576; pane.style.pointerEvents = "none";
      map.on("movestart zoomstart", function () { setMoving(true); });
      map.on("moveend", moveEnd);
    }
    D.addEventListener("pn:mapmove", function (e) { var m = !!(e && e.detail && e.detail.moving); setMoving(m); if (!m) sync(); });
    D.addEventListener("visibilitychange", setHidden);
    try { W.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", sync); } catch (e) {}
    try { new MutationObserver(sync).observe(D.body, { attributes: true, attributeFilter: ["class"] }); } catch (e) {}
    W.addEventListener("resize", sync);
    tick = setInterval(function () { if (!hidden()) sync(); }, 10e3);   // Skåltimmen starts / ends, dusk falls, the holiday badge comes
    setTimeout(sync, 800); setTimeout(sync, 4000);
  }

  var api = {
    init: function (a) { try { start(a); } catch (e) { fail(e); } },
    onPoll: function (beers) { try { onPoll(beers); } catch (e) { fail(e); } },
    onBeerAccepted: function (d, info) { try { onBeer(d, info); } catch (e) { fail(e); } },
    flags: F, store: isStore, refresh: function () { sync(); },
    ripple: function (lat, lng) { try { return ripple(lat, lng); } catch (e) { fail(e); return false; } },
    foam: function (lat, lng) { try { return foam(lat, lng); } catch (e) { fail(e); return false; } },
    stats: stats,
    _budget: function () { return { used: used(), max: BUDGET, cost: COST }; },
    _weekendEvening: weekendEvening, _clock: function (ms) { clock = ms == null ? null : +ms; sync(); },
    _state: function () { return { moving: moving, hidden: hidden(), still: still(), store: isStore(), flags: F, used: used(), dead: dead }; }
  };
  W.ALIVE2 = api;
  if (PN && PN.mod) PN.mod("ALIVE2");
})();
