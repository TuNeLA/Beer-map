/* PintsNow — WALKTIME (lane walktime, PLAN E6 "Walking time to bars", 24 Nov 2026). window.WALKTIME.
   Research + sources: walktime-RESEARCH.md (lane report, copied to the ops handover). Owner rule: research first.
   1. ESTIMATE ON THE PHONE (default, the only path that is ON): straight line (haversine) × DETOUR 1.3 at 80 m/min.
      Why 1.3: walk-network detour in 40 cities = 1.14 to 1.49 (Boeing 2017). Why 80 m/min (4.8 km/h): Mapbox's walking default
      is 5.1 km/h; groups at night walk slower. Nothing leaves the phone: no cost, no new data flow, works offline.
   2. Only with a GOOD position: FASTPOS.fresh() = an exact fix (<= 100 m) less than 2 min old (fastpos.js rule). A rough fix:
      no walking time at all (a time from a rough fix would look exact).
   3. Text "ca 8 min promenad" (en "about 8 min walk"); from 16 min in steps of 5. Under 80 m straight line: nothing (you are
      there). Over 45 min: nothing. A count/time is information only (no push to go out or drink).
   4. ROUTE TIME (built, OFF; OLNU_CONFIG.walkRoute = "mapbox" turns it on, owner decision): Mapbox Directions, walking, for the
      bar card only. The origin is the CENTRE of a 150 m cell, never the GPS point; never inside the home zone (+300 m); never
      while the page is hidden (a hidden page aborts the call); one call per bar per cell per session (memory only); 4 s
      timeout; after an error (429 too) a 5 min pause. A failed call changes nothing: the estimate stays. The token is read at
      run time only and never logged; the URL is never logged.
   Hooks (for the merge with lane barcard): wraps window.PNDS.barSheet (pnds.js ds07; barcard.js wraps it too, earlier in
   index.html) and adds ONE element <span class="pn-wt"> at the end of the card's .bs-head .bs-meta line. barsearch.js calls
   WALKTIME.short(bar) in its bar rows and WALKTIME.near() for the "Inom 10 min promenad" list. CSS: docs/walktime.css. */
(function () {
  "use strict";
  var W = window, D = document;
  var DETOUR = 1.3, M_PER_MIN = 80, MIN_M = 80, MAX_MIN = 45, NEAR_MIN = 10, NEAR_N = 5, GOOD_M = 100;
  var CELL_M = 150, HOME_PAD_M = 300, TIMEOUT_MS = 4000, PAUSE_MS = 5 * 60e3, TICK_MS = 5000;
  var cache = {}, pending = {}, live = [], pausedAt = 0, tick = 0;

  function tl(sv, en) { return W.I18N && W.I18N.lang === "en" ? en : sv; }
  function num(v) { return v != null && v !== "" && isFinite(+v); }
  function hasLL(b) { return !!b && num(b.lat) && num(b.lng); }
  function dist(a, b) {
    if (W.U && W.U.haversine) return W.U.haversine(+a.lat, +a.lng, +b.lat, +b.lng);
    var r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // my position, only when it is exact and fresh (fastpos rule); else null
  function here() {
    try {
      var F = W.FASTPOS, p = F && F.fresh ? F.fresh() : null, c = p && p.coords;
      if (!c || !num(c.latitude) || !num(c.longitude) || !(c.accuracy <= GOOD_M)) return null;
      return { lat: +c.latitude, lng: +c.longitude };
    } catch (e) { return null; }
  }
  // minutes on foot (not rounded) from o to the bar, or null (too near / too far / no data)
  function estimate(o, bar) {
    if (!o || !hasLL(bar)) return null;
    var d = dist(o, bar); if (!(d >= MIN_M)) return null;
    var m = d * DETOUR / M_PER_MIN;
    return m > MAX_MIN ? null : m;
  }
  function round(m) { var n = Math.max(1, Math.round(m)); return n > 15 ? Math.round(n / 5) * 5 : n; }
  function longText(n) { return tl("ca " + n + " min promenad", "about " + n + " min walk"); }
  function shortText(n) { return tl("ca " + n + " min", "about " + n + " min"); }
  function bid(bar) { return String(bar.id != null ? bar.id : (+bar.lat).toFixed(5) + "," + (+bar.lng).toFixed(5)); }

  /* ---------- route time (OFF unless OLNU_CONFIG.walkRoute === "mapbox") ---------- */
  function routeOn() {
    var c = W.OLNU_CONFIG && W.OLNU_CONFIG.walkRoute || W.PN_CFG && W.PN_CFG.walkRoute;
    return c === "mapbox";
  }
  function token() {   // read at run time, the same way as placesearch.js; never stored, never logged
    var t = ""; try { t = (W.OLNU_CONFIG && W.OLNU_CONFIG.MAPBOX_TOKEN) || (W.mapboxgl && W.mapboxgl.accessToken) || ""; } catch (e) {}
    return /^pk\./.test(t) ? t : "";
  }
  // the 150 m cell around o: the call sends its centre, not the GPS point
  function cell(o) {
    var dy = CELL_M / 111320, dx = CELL_M / (111320 * Math.max(0.2, Math.cos(o.lat * Math.PI / 180)));
    var gy = Math.floor(o.lat / dy), gx = Math.floor(o.lng / dx);
    return { k: gy + "_" + gx, lat: (gy + 0.5) * dy, lng: (gx + 0.5) * dx };
  }
  function atHome(o) {
    try {
      var H = W.HOMEZONE, h = H && H.home ? H.home() : JSON.parse(W.localStorage.getItem("olnu.home") || "null");
      if (!hasLL(h)) return false;
      return dist(o, h) <= (+(h.r || h.ar) || 100) + HOME_PAD_M;
    } catch (e) { return true; }   // unsure → treat as home: no call
  }
  function routeMin(bar, o) {
    if (!routeOn() || !o) return null;
    var v = cache[bid(bar) + "@" + cell(o).k];
    return v > 0 ? v : null;
  }
  function want(bar, o) {
    if (!routeOn() || !o || D.hidden || Date.now() - pausedAt < PAUSE_MS || atHome(o)) return false;
    if (W.navigator && W.navigator.onLine === false) return false;
    var t = token(); if (!t || !W.fetch) return false;
    var c = cell(o), k = bid(bar) + "@" + c.k;
    if (cache[k] || pending[k]) return false;
    pending[k] = 1;
    var ac = W.AbortController ? new W.AbortController() : null, job = { ac: ac, hid: false };
    live.push(job);
    var to = setTimeout(function () { if (ac) ac.abort(); }, TIMEOUT_MS);
    var url = "https://api.mapbox.com/directions/v5/mapbox/walking/" + c.lng.toFixed(5) + "," + c.lat.toFixed(5) + ";" +
      (+bar.lng).toFixed(5) + "," + (+bar.lat).toFixed(5) + "?alternatives=false&overview=false&steps=false&walking_speed=" +
      (M_PER_MIN / 60).toFixed(2) + "&access_token=" + encodeURIComponent(t);
    W.fetch(url, { credentials: "omit", signal: ac ? ac.signal : undefined }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (j) {
      var s = j && j.routes && j.routes[0] && +j.routes[0].duration;
      if (!(s > 0)) throw new Error("no route");
      cache[k] = s / 60;
      paintAll();
    }).catch(function () {
      if (!job.hid) pausedAt = Date.now();   // a real failure: pause. Aborted because the page was hidden: no pause.
    }).then(function () {
      clearTimeout(to); delete pending[k];
      var i = live.indexOf(job); if (i >= 0) live.splice(i, 1);
    });
    return true;
  }
  D.addEventListener("visibilitychange", function () {
    if (!D.hidden) { paintAll(); return; }
    live.forEach(function (j) { j.hid = true; try { if (j.ac) j.ac.abort(); } catch (e) {} });
  });

  /* ---------- what to show ---------- */
  // { n: rounded minutes, src: "route" | "est" } for this bar now, or null
  function info(bar, o) {
    o = o || here();
    var m = estimate(o, bar); if (m == null) return null;
    var r = routeMin(bar, o);
    if (r != null && r <= MAX_MIN) return { n: round(r), src: "route" };
    return { n: round(m), src: "est" };
  }
  function fill(el, inf) {
    if (!inf) { if (!el.hidden) el.hidden = true; return; }
    var txt = longText(inf.n), sp = el.querySelector(".pn-wt-t");
    if (sp && sp.textContent !== txt) sp.textContent = txt;
    if (el.getAttribute("data-wt-src") !== inf.src) el.setAttribute("data-wt-src", inf.src);
    if (el.hidden) el.hidden = false;
  }
  function barOf(el) {
    var ll = String(el.getAttribute("data-wt-ll") || "").split(",");
    return { id: el.getAttribute("data-wt"), lat: +ll[0], lng: +ll[1] };
  }
  // repaint every walking-time element on screen (a new fix, a route answer, back from hidden). Runs only while one exists.
  function paintAll() {
    var els = D.querySelectorAll(".pn-wt[data-wt]");
    if (!els.length) { if (tick) { clearInterval(tick); tick = 0; } return; }
    if (D.hidden) return;
    var o = here();
    [].forEach.call(els, function (el) { var b = barOf(el); fill(el, info(b, o)); if (o && b.id) want(b, o); });
  }
  function ensureTick() { if (!tick) tick = setInterval(paintAll, TICK_MS); }

  /* ---------- the bar card hook ---------- */
  function decorate(html, bar) {
    try {
      if (!hasLL(bar) || html.indexOf("bs-meta") < 0) return html;
      var tp = D.createElement("template"); tp.innerHTML = html;
      var bs = tp.content.firstElementChild, meta = bs && bs.querySelector(".bs-head .bs-meta");
      if (!meta || meta.querySelector(".pn-wt")) return html;
      var o = here(), inf = info(bar, o);
      var el = D.createElement("span");
      el.className = "pn-wt" + (meta.textContent.trim() ? "" : " pn-wt-1");
      el.setAttribute("data-wt", bid(bar)); el.setAttribute("data-wt-ll", (+bar.lat).toFixed(6) + "," + (+bar.lng).toFixed(6));
      el.innerHTML = (W.PNI && W.PNI.has && W.PNI.has("walk") ? W.PNI.svg("walk") : "") + '<span class="pn-wt-t"></span>';
      var svg = el.querySelector("svg"); if (svg) svg.setAttribute("aria-hidden", "true");
      el.hidden = true; fill(el, inf);
      meta.appendChild(el);
      if (o) want(bar, o);
      setTimeout(ensureTick, 0);
      return bs.outerHTML;
    } catch (e) { return html; }
  }
  function hook() {
    var P = W.PNDS; if (!P || !P.barSheet) return false;
    if (P.barSheet._wt) return true;
    var b0 = P.barSheet;
    P.barSheet = function (html, bar, list) { return decorate(b0.call(this, html, bar, list), bar); };
    P.barSheet._wt = true;
    if (b0._bc) P.barSheet._bc = true;   // barcard.js checks its own flag on the current function: keep it, so it never wraps twice
    return true;
  }
  if (!hook()) { var n = 0, iv = setInterval(function () { if (hook() || ++n > 50) clearInterval(iv); }, 100); }

  /* ---------- for barsearch.js (Sök › Krogar) ---------- */
  // "ca 8 min" for a list row, or "" (no good position / too near / too far). Estimate only: a list never calls the API.
  function short(bar) { var m = estimate(here(), bar); return m == null ? "" : shortText(round(m)); }
  // bars within NEAR_MIN minutes on foot: [{ bar, n, label }], nearest first, at most NEAR_N. [] without a good position.
  function near(maxMin) {
    var o = here(), B = W.BARS, lim = maxMin || NEAR_MIN, out = [];
    if (!o || !B || !B.around) return out;
    var r = B.around(o.lat, o.lng, lim * M_PER_MIN / DETOUR);
    (r && r.bars || []).forEach(function (x) {
      var m = estimate(o, x.bar); if (m == null || round(m) > lim) return;
      out.push({ bar: x.bar, n: round(m), m: m, label: shortText(round(m)) });
    });
    out.sort(function (a, b) { return a.m - b.m; });
    return out.slice(0, NEAR_N);
  }

  W.WALKTIME = {
    estimate: estimate, round: round, info: info, short: short, near: near, here: here, cell: cell,
    text: longText, decorate: decorate, paintAll: paintAll,
    _cfg: { DETOUR: DETOUR, M_PER_MIN: M_PER_MIN, MIN_M: MIN_M, MAX_MIN: MAX_MIN, CELL_M: CELL_M, PAUSE_MS: PAUSE_MS },
    _want: want, _reset: function () { cache = {}; pending = {}; pausedAt = 0; }
  };
  if (W.PN && W.PN.mod) W.PN.mod("WALKTIME");
})();
