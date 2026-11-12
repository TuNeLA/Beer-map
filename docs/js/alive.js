/* PintsNow — ✨ LEVANDE KARTA (lane alive, owner 13 Nov 2026: "the map feels dead; make it feel alive"). window.ALIVE.
   Small signals on the map from data the app ALREADY has. No new RPC, no new map load, no new style, no sound, no push.
   - Animated (DOM, own Leaflet pane "alive" under the bar panes, CSS transform/opacity only, no per-frame JS):
       🍻 clink  = two glasses that clink at a bar with skål activity: public skål taps (sum of skal_count of the pins at the
                   bar ≥ 2, or a new tap since the last poll) AND ≥ 3 people there (K_MIN, the zone chip rule); or MY bar while
                   one of MY groups runs Skåltimmen now (only I see it, it is my own position). Never a name.
       📅 pulse  = 2 soft rings at an event tonight (running now or starting within 4 h; events EVSHEET / EVENTS already load).
       ✨ lively = 3 small sparks that rise above a bar with ≥ 5 people (never under K_MIN).
     One effect per bar (clink > event > lively). Caps: clink 3, event 5, lively 6, total 12, in view only, zoom ≥ 13.
   - Static (no animation): 🌙 ambient = a soft warm glow at quiet bars (< 3 people) while the sun is down: "the lights are on".
     GL on: one GeoJSON source + one circle layer (pn-alive / pn-alive-glow) under the olnu bar layers, moves with the map for
     free. Raster fallback: ≤ 6 static DOM glows. Hours: OSM opening_hours closed = no glow; unknown = dimmer glow 16–01 (02 the nights after Fri / Sat).
   - Rules: paused (animation-play-state) from movestart / zoomstart to moveend + 150 ms, and while html.is-moving; no
     animated marker at all with prefers-reduced-motion or Data Saver; tab hidden = the browser stops CSS animation.
     Off switch "Levande karta" (default on): localStorage pn_alive_off = "1". settingsRow() for the settings lane; the
     settingsSheet hook adds it at the end only when no row is there yet. Any error = everything off, one console.warn.
   - Theme engine (js/themes.js, lane themes): the glow takes --pn-theme-glow when a theme sets it. No second theme engine.
   Hooks (app.js mods): init, onPoll, onPublicPoll, settingsSheet. Feeds for later server aggregates: ALIVE.feed(kind, rows). */
(function () {
  "use strict";
  var W = window, D = W.document, PN = W.PN;
  var LS = "pn_alive_off", K_MIN = 3, LIVELY_N = 5, SK_MIN = 2, RISE_MS = 90e3, MIN_Z = 13, GLOW_Z = 12.5;
  var CAPS = { skal: 3, event: 5, lively: 6 }, CAP = 12, PRIO = { skal: 3, event: 2, lively: 1 }, GLOW_MAX = 60, DOM_GLOW = 6;
  var SRC = "pn-alive", LAY = "pn-alive-glow", EMPTY = { type: "FeatureCollection", features: [] };
  var A = null, map = null, pane = null, css = null, marks = {}, glows = {}, prevSk = {}, rises = {}, feeds = {}, clock = null;
  var moving = false, timer = 0, glSig = "", glHooked = null, warned = 0, rows = [], dead = false;
  var stats = { runs: 0, anim: 0, glow: 0, gl: false, night: false, skip: "" };

  /* ---------- pure parts (unit tests: tests/unit/alive.test.mjs) ---------- */
  // Sun altitude in degrees (NOAA short form; ± 1° is enough for "is it dark").
  function sunAlt(ms, lat, lng) {
    var r = Math.PI / 180, d = ms / 864e5 - 10957.5, g = (357.529 + 0.98560028 * d) * r, q = 280.459 + 0.98564736 * d;
    var L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r, e = (23.439 - 3.6e-7 * d) * r;
    var ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
    var gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24, ha = gmst * 15 * r + lng * r - ra;
    return Math.asin(Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(ha)) / r;
  }
  function isNight(ms, lat, lng) { return sunAlt(ms, lat, lng) < -3; }
  function sthlm(ms) {   // {h, dow} in Europe/Stockholm (dow 1 = Monday)
    try {
      var o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23", weekday: "short" })
        .formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
      return { h: (+o.hour) % 24, dow: { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[o.weekday] || 1 };
    } catch (e) { var d = new Date(ms); return { h: d.getHours(), dow: d.getDay() || 7 }; }
  }
  // Glow weight of a bar: 1 = open (known hours), .6 = unknown hours but a normal evening, 0 = closed / too late.
  function glowW(bar, ms) {
    var o = null; try { o = bar.opening_hours && W.AFTER && W.AFTER.openNow ? W.AFTER.openNow(bar.opening_hours) : null; } catch (e) {}
    if (o === true) return 1; if (o === false) return 0;
    var s = sthlm(ms), late = s.dow === 6 || s.dow === 7 ? 2 : 1;   // the night after Fri / Sat: until 02
    return s.h >= 16 || s.h < late ? 0.6 : 0;
  }
  // Per-bar input -> signals. bars: [{id, lat, lng, pins, cis, sk}] (pins / cis = counts, sk = sum of skal_count).
  // o: {now, prevSk, rises, myBar, groupSkal, events, feeds}. Mutates o.rises / o.prevSk (the skål memory between polls).
  function signals(bars, o) {
    var out = [], now = o.now;
    bars.forEach(function (b) {
      var n = Math.max(b.pins | 0, b.cis | 0), sk = b.sk | 0, was = o.prevSk[b.id];
      if (was != null && sk > was) o.rises[b.id] = now;
      o.prevSk[b.id] = sk;
      var rose = now - (o.rises[b.id] || 0) < RISE_MS;
      if (n >= K_MIN && (sk >= SK_MIN || rose)) out.push({ k: "skal", id: b.id, lat: b.lat, lng: b.lng, n: n });
      else if (n >= Math.max(LIVELY_N, K_MIN)) out.push({ k: "lively", id: b.id, lat: b.lat, lng: b.lng, n: n });
    });
    if (o.groupSkal && o.myBar) out.push({ k: "skal", id: o.myBar.id, lat: o.myBar.lat, lng: o.myBar.lng, mine: true });
    (o.events || []).forEach(function (e) {
      var t0 = Date.parse(e.starts_at), t1 = e.ends_at ? Date.parse(e.ends_at) : t0 + 3 * 36e5;
      if (!isFinite(t0) || e.pending || !(t0 - now < 4 * 36e5 && t1 > now)) return;
      if (isFinite(+e.lat) && isFinite(+e.lng) && e.lat != null && e.lng != null) out.push({ k: "event", id: e.bar_id || "e" + e.id, lat: +e.lat, lng: +e.lng });
    });
    Object.keys(o.feeds || {}).forEach(function (k) {
      if (!PRIO[k]) return;
      (o.feeds[k] || []).forEach(function (r, i) { if (isFinite(+r.lat) && isFinite(+r.lng)) out.push({ k: k, id: r.bar_id || r.id || k + i, lat: +r.lat, lng: +r.lng }); });
    });
    return out;
  }
  // Choose what to draw: one effect per bar (highest priority), per-kind caps, total cap, nearest to the centre first.
  function pick(list, c, inView, caps, cap) {
    var best = {}, d = function (s) { var y = s.lat - c.lat, x = (s.lng - c.lng) * Math.cos(c.lat * Math.PI / 180); return x * x + y * y; };
    list.forEach(function (s) {
      if (inView && !inView(s)) return;
      var key = String(s.id), b = best[key];
      if (!b || PRIO[s.k] > PRIO[b.k] || (s.mine && PRIO[s.k] === PRIO[b.k])) best[key] = s;
    });
    var all = Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) { return (PRIO[b.k] - PRIO[a.k]) || (d(a) - d(b)); });
    var used = {}, out = [];
    for (var i = 0; i < all.length && out.length < cap; i++) {
      var s = all[i]; if ((used[s.k] | 0) >= (caps[s.k] | 0)) continue;
      used[s.k] = (used[s.k] | 0) + 1; out.push(s);
    }
    return out;
  }

  /* ---------- environment ---------- */
  function now() { return clock != null ? clock : Date.now(); }
  function mq(q) { try { return !!(W.matchMedia && W.matchMedia(q).matches); } catch (e) { return false; } }
  function reduced() { return mq("(prefers-reduced-motion: reduce)"); }
  function saveData() { try { return !!(W.navigator.connection && W.navigator.connection.saveData); } catch (e) { return false; } }
  function isOff() { try { return W.localStorage.getItem(LS) === "1"; } catch (e) { return false; } }
  function en() { return W.I18N && W.I18N.lang === "en"; }
  function gm() { try { var b = W.BASEMAP; return b && b.isMapbox() && b.mapbox() ? b.mapbox().getMapboxMap() : null; } catch (e) { return null; } }
  function glowColor() {
    var v = ""; try { v = W.getComputedStyle(D.documentElement).getPropertyValue("--pn-theme-glow").trim(); } catch (e) {}
    return /^#[0-9a-f]{6}$/i.test(v) ? v : "#ffc24d";
  }

  /* ---------- data the app already has -> per-bar input ---------- */
  function barsIn(bounds) {
    var B = W.BARS, beers = (A && A.beers ? A.beers() : PN && PN.s && PN.s.beers) || [], cis = (A && A.checkins ? A.checkins() : PN && PN.s && PN.s.checkins) || [];
    var per = {}, out = [];
    var get = function (id, bar) { return per[id] || (per[id] = { id: id, lat: +bar.lat, lng: +bar.lng, pins: 0, cis: 0, sk: 0, arena: !!bar.arena }); };
    if (B && B.assign) {
      var a = B.assign(beers).perBar || {};
      Object.keys(a).forEach(function (id) { var x = a[id], g = get(String(id), x.bar); x.beers.forEach(function (b) { g.pins++; g.sk += Math.max(0, b.skal_count | 0); }); });
    }
    cis.forEach(function (c) {
      var id = c.bar_id && B && B.canonId ? B.canonId(c.bar_id) : ""; if (!id) return;
      var bar = (B.byId && B.byId(id)) || c; if (isFinite(+bar.lat) && isFinite(+bar.lng)) get(id, bar).cis++;
    });
    Object.keys(per).forEach(function (id) { var g = per[id]; if (!g.arena && bounds.contains([g.lat, g.lng])) out.push(g); });
    return { list: out, per: per };
  }
  function eventRows() {
    var r = []; try { r = (W.EVSHEET && W.EVSHEET._cache && W.EVSHEET._cache().rows) || []; } catch (e) {}
    if (!r.length) try { r = (W.EVENTS && W.EVENTS._cache && W.EVENTS._cache().rows) || []; } catch (e) {}
    return r.map(function (e) {   // an event at a bar without its own position: the bar's position
      if ((e.lat == null || !isFinite(+e.lat)) && e.bar_id && W.BARS && W.BARS.byId) { var b = W.BARS.byId(e.bar_id); if (b) return Object.assign({}, e, { lat: b.lat, lng: b.lng }); }
      return e;
    });
  }
  function myBar(per) {   // my own bar (check-in, else my pin's bar): only for MY group's Skåltimmen
    var B = W.BARS; if (!B) return null;
    try {
      var ci = A && A.myCheckin ? A.myCheckin() : null, id = ci && ci.bar_id ? B.canonId(ci.bar_id) : "";
      if (!id && A && A.myBeer) { var m = A.myBeer(); if (m) { var a = B.assign([m]).perBar || {}; id = Object.keys(a)[0] || ""; } }
      var bar = id && (per[id] || B.byId(id)); return bar ? { id: id, lat: +bar.lat, lng: +bar.lng } : null;
    } catch (e) { return null; }
  }
  function groupSkal() {
    try { var t = now(); return !!(W.SKAL && W.SKAL.data && W.SKAL.data().some(function (h) { return Date.parse(h.ends_at) > t; })); } catch (e) { return false; }
  }

  /* ---------- drawing ---------- */
  var MUG = '<svg viewBox="0 0 16 20" width="13" height="17" aria-hidden="true"><path d="M2 6h9v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill="#f5a623"/>' +
    '<path d="M11 9h1.6a2 2 0 0 1 2 2v2.4a2 2 0 0 1-2 2H11" fill="none" stroke="#f5a623" stroke-width="1.6"/>' +
    '<path d="M1.4 6.6a2.4 2.4 0 0 1 2-3.6 3 3 0 0 1 5.2-.4 2.4 2.4 0 0 1 3 4z" fill="#fff6e5"/></svg>';
  var ICON = {
    skal: { html: '<i class="al-g al-gl">' + MUG + '</i><i class="al-g al-gr"><b>' + MUG + '</b></i><i class="al-sp"></i>', size: [34, 26], anchor: [-4, 44] },
    event: { html: "<i></i><i></i>", size: [46, 46], anchor: [23, 23] },
    lively: { html: "<i></i><i></i><i></i>", size: [30, 26], anchor: [15, 46] },
    glow: { html: "<i></i>", size: [40, 40], anchor: [20, 20] }
  };
  function marker(k, s, cls) {
    var ic = ICON[k], L = W.L;
    return L.marker([s.lat, s.lng], { pane: "alive", interactive: false, keyboard: false, bubblingMouseEvents: false,
      icon: L.divIcon({ className: "al-m al-" + k + (cls ? " " + cls : ""), html: ic.html, iconSize: ic.size, iconAnchor: ic.anchor }) });
  }
  function sync(store, want, cls) {   // keep markers that stay (no restart of their animation), add new, remove gone
    var keep = {};
    want.forEach(function (s) {
      var key = s.k + ":" + s.id; keep[key] = 1;
      var m = store[key];
      if (m) { var ll = m.getLatLng(); if (ll.lat !== s.lat || ll.lng !== s.lng) m.setLatLng([s.lat, s.lng]); return; }
      store[key] = marker(s.k, s, cls).addTo(map);
    });
    Object.keys(store).forEach(function (key) { if (!keep[key]) { map.removeLayer(store[key]); delete store[key]; } });
  }
  function glEnsure(m) {
    if (!m || !m.style || !m.style._loaded) return false;
    if (!m.getSource(SRC)) { m.addSource(SRC, { type: "geojson", data: EMPTY, maxzoom: 14 }); glSig = ""; }
    if (!m.getLayer(LAY)) {
      var ids = W.GLBARS && W.GLBARS._layers ? W.GLBARS._layers() : [], before = ids.filter(function (id) { return m.getLayer(id); })[0];
      var lay = { id: LAY, type: "circle", source: SRC, minzoom: GLOW_Z, paint: {
        "circle-color": glowColor(), "circle-blur": 1, "circle-pitch-alignment": "map", "circle-emissive-strength": 1,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], GLOW_Z, 5, 15, 13, 18, 30],
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], GLOW_Z, 0, 13.5, ["*", 0.42, ["get", "w"]]] } };
      try { m.addLayer(lay, before); } catch (e) {}
      if (!m.getLayer(LAY)) { delete lay.paint["circle-emissive-strength"]; try { m.addLayer(lay, before); } catch (e) {} }   // older GL: no emissive
    } else { try { m.setPaintProperty(LAY, "circle-color", glowColor()); } catch (e) {} }
    if (glHooked !== m) { glHooked = m; m.on("style.load", function () { glSig = ""; soon(50); }); }
    return !!m.getLayer(LAY);
  }
  function drawGlow(list) {
    var m = gm(); stats.gl = !!(m && glEnsure(m));
    if (stats.gl) {
      sync(glows, []);
      var sig = list.map(function (s) { return s.id + s.w; }).join();
      if (sig !== glSig) { glSig = sig; m.getSource(SRC).setData({ type: "FeatureCollection", features: list.map(function (s) {
        return { type: "Feature", geometry: { type: "Point", coordinates: [s.lng, s.lat] }, properties: { id: String(s.id), w: s.w } }; }) }); }
      return;
    }
    sync(glows, list.slice(0, DOM_GLOW).map(function (s) { return { k: "glow", id: s.id, lat: s.lat, lng: s.lng }; }));
  }

  /* ---------- the run ---------- */
  function run() {
    timer = 0; if (dead || !map || !W.L) return;
    if (moving) { soon(300); return; }
    stats.runs++;
    var t = now(), z = map.getZoom(), c = map.getCenter(), bounds = map.getBounds().pad(0.1);
    var calm = isOff() || reduced() || saveData();
    stats.skip = isOff() ? "off" : reduced() ? "reduced" : saveData() ? "saveData" : z < MIN_Z ? "zoom" : "";
    var info = barsIn(bounds), anim = [];
    var list = signals(info.list, { now: t, prevSk: prevSk, rises: rises, myBar: myBar(info.per), groupSkal: groupSkal(), events: eventRows(), feeds: feeds });
    if (!calm && z >= MIN_Z) {
      var cap = (W.navigator.hardwareConcurrency || 8) <= 2 ? 6 : CAP;
      anim = pick(list, c, function (s) { return bounds.contains([s.lat, s.lng]); }, CAPS, cap);
    }
    sync(marks, anim);
    stats.anim = anim.length;
    // 🌙 ambient: quiet bars (< K_MIN) while the sun is down; static, not counted in the animation cap
    stats.night = isNight(t, c.lat, c.lng);
    var glow = [];
    if (!isOff() && stats.night && z >= GLOW_Z && W.BARS && W.BARS.inBounds) {
      var busy = {}; info.list.forEach(function (g) { if (Math.max(g.pins, g.cis) >= K_MIN) busy[g.id] = 1; });
      anim.forEach(function (s) { busy[s.id] = 1; });
      W.BARS.inBounds(bounds, 600).forEach(function (b) {
        if (b.arena || busy[b.id] || (W.BARS.isClosed && W.BARS.isClosed(b.id))) return;
        var w = glowW(b, t); if (w > 0) glow.push({ id: String(b.id), lat: +b.lat, lng: +b.lng, w: w });
      });
      glow = pick(glow.map(function (g) { g.k = "lively"; return g; }), c, null, { lively: GLOW_MAX }, GLOW_MAX);
    }
    drawGlow(glow);
    stats.glow = glow.length;
  }
  function soon(ms) { if (!timer) timer = setTimeout(function () { try { run(); } catch (e) { fail(e); } }, ms == null ? 200 : ms); }
  function clearAll() { if (!map) return; sync(marks, []); sync(glows, []); var m = gm(); if (m && m.getSource && m.getSource(SRC)) try { m.getSource(SRC).setData(EMPTY); glSig = ""; } catch (e) {} }
  function fail(e) { dead = true; try { clearAll(); } catch (x) {} if (!warned++) try { console.warn("alive off:", e && e.message || e); } catch (x) {} }
  function setMoving(on) {
    moving = on; if (pane) pane.classList.toggle("al-move", on);
    if (!on) soon(150);
  }

  /* ---------- CSS (own style tag; transform + opacity only) ---------- */
  var CSS = ".leaflet-alive-pane{pointer-events:none!important}" +
    ".al-m{pointer-events:none!important;background:none!important;border:0!important}.al-m i,.al-m b{position:absolute;display:block;pointer-events:none}" +
    ".al-move .al-m *,html.is-moving .al-m *{animation-play-state:paused!important}" +
    // 🍻 clink: two mugs swing in, touch, a spark; then rest (2.6 s)
    ".al-skal .al-g{bottom:0;width:15px;height:18px;transform-origin:50% 100%;animation:2.6s ease-in-out infinite both}" +
    ".al-skal .al-gl{left:2px;animation-name:alCl}.al-skal .al-gr{right:2px;animation-name:alCr}.al-skal .al-gr b{transform:scaleX(-1)}" +
    ".al-skal svg{display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,.7))}" +
    ".al-skal .al-sp{left:13px;top:0;width:8px;height:8px;border-radius:50%;background:radial-gradient(#fff6e5,rgba(255,194,77,0) 70%);opacity:0;animation:alSp 2.6s ease-out infinite}" +
    "@keyframes alCl{0%,58%,100%{transform:translateX(0) rotate(-16deg)}30%{transform:translateX(4px) rotate(9deg)}36%{transform:translateX(3px) rotate(5deg)}}" +
    "@keyframes alCr{0%,58%,100%{transform:translateX(0) rotate(16deg)}30%{transform:translateX(-4px) rotate(-9deg)}36%{transform:translateX(-3px) rotate(-5deg)}}" +
    "@keyframes alSp{0%,27%{opacity:0;transform:scale(.3)}32%{opacity:1;transform:scale(1.2)}48%,100%{opacity:0;transform:scale(1.8)}}" +
    // 📅 event: two soft rings
    ".al-event i{inset:0;border-radius:50%;border:2px solid var(--ds-blue-t,#8cc6ff);opacity:0;animation:alPu 2.8s ease-out infinite}.al-event i+i{animation-delay:1.4s}" +
    "@keyframes alPu{0%{transform:scale(.35);opacity:.85}100%{transform:scale(1.15);opacity:0}}" +
    // ✨ lively: 3 sparks rise and fade
    ".al-lively i{bottom:0;width:5px;height:5px;border-radius:50%;background:var(--ds-amber-t,#ffc24d);box-shadow:0 0 4px var(--ds-amber,#f5a623);opacity:0;animation:alUp 2.4s ease-out infinite}" +
    ".al-lively i:nth-child(1){left:5px}.al-lively i:nth-child(2){left:13px;animation-delay:.8s}.al-lively i:nth-child(3){left:21px;animation-delay:1.6s}" +
    "@keyframes alUp{0%{transform:translateY(0) scale(.6);opacity:0}25%{opacity:.95}100%{transform:translateY(-20px) scale(1);opacity:0}}" +
    // 🌙 raster fallback glow (static)
    ".al-glow i{inset:0;border-radius:50%;background:radial-gradient(rgba(255,194,77,.42),rgba(255,194,77,0) 68%)}" +
    "@media (prefers-reduced-motion:reduce){.al-m *{animation:none!important}}";

  /* ---------- settings row ---------- */
  function paint(row) {
    var b = row.querySelector("button"); if (b) b.setAttribute("aria-checked", String(!isOff()));
  }
  function settingsRow() {
    var row = D.createElement("div"), sp = D.createElement("span"), b = D.createElement("button");
    row.className = "toggle-row al-row";
    sp.textContent = en() ? "Living map" : "Levande karta";
    sp.title = en() ? "Small animations on the map: cheers, events, lively bars, lights at night." : "Små animationer på kartan: skål, event, livliga krogar, ljus på kvällen.";
    b.type = "button"; b.className = "switch"; b.setAttribute("role", "switch"); b.setAttribute("aria-label", sp.textContent);
    b.addEventListener("click", function () { setOff(!isOff()); });
    row.appendChild(sp); row.appendChild(b); rows.push(row); paint(row);
    return row;
  }
  function setOff(off) {
    try { if (off) W.localStorage.setItem(LS, "1"); else W.localStorage.removeItem(LS); } catch (e) {}
    rows = rows.filter(function (r) { return r.isConnected; }); rows.forEach(paint);
    soon(0);
  }

  /* ---------- start ---------- */
  function start(api) {
    A = api; map = api && api.map; if (!map || !W.L || !map.createPane) return;
    css = D.createElement("style"); css.id = "alive-css"; css.textContent = CSS; D.head.appendChild(css);
    pane = map.getPane("alive") || map.createPane("alive"); pane.style.zIndex = 575; pane.classList.add("leaflet-alive-pane");
    map.on("movestart zoomstart", function () { setMoving(true); });
    map.on("moveend", function () { setMoving(false); });
    D.addEventListener("basemap:change", function () { glSig = ""; soon(400); });
    try { W.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", function () { soon(0); }); } catch (e) {}
    D.addEventListener("visibilitychange", function () { if (!D.hidden) soon(500); });
    setInterval(function () { if (!D.hidden) soon(0); }, 60e3);   // events start, night falls, a rise ages out
    soon(1500);
  }

  var api = {
    init: function (a) { try { start(a); } catch (e) { fail(e); } },
    onPoll: function () { soon(); },
    onPublicPoll: function () { soon(); },
    settingsSheet: function (body) { if (body && !body.querySelector(".al-row")) body.appendChild(settingsRow()); },
    settingsRow: settingsRow, off: isOff, setOff: setOff, refresh: function () { soon(0); },
    // later server aggregates (e.g. Skåltimmen per bar, k ≥ 3): rows [{lat, lng, bar_id}] for kind skal | event | lively
    feed: function (kind, list) { if (PRIO[kind]) { feeds[kind] = Array.isArray(list) ? list.slice(0, 200) : []; soon(0); } },
    stats: stats,
    _sunAlt: sunAlt, _isNight: isNight, _signals: signals, _pick: pick, _glowW: glowW, _caps: function () { return { caps: CAPS, cap: CAP, kMin: K_MIN, lively: LIVELY_N }; },
    _clock: function (ms) { clock = ms == null ? null : +ms; soon(0); },
    _run: function () { clearTimeout(timer); timer = 0; run(); return stats; },
    _state: function () { return { anim: Object.keys(marks), glow: stats.glow, gl: stats.gl, moving: moving, night: stats.night, skip: stats.skip, layer: LAY, src: SRC }; }
  };
  W.ALIVE = api;
  if (PN && PN.mod) PN.mod("ALIVE");
})();
