/* PintsNow — TOWNS: the nearest Swedish town on the phone, with no network call (E7, data-sources.md item 10).
   Before: js/ride.js asked Nominatim (reverse) for the area of a pickup point. The Nominatim usage policy calls periodic
   app requests "bulk geocoding" and asks apps to be able to switch service without an update. Now: our own list.
   Data: js/towns-data.js (PN.townsData, made by scripts/build-towns.mjs from SCB "Statistiska tätorter 2023", CC0):
   2 017 tätorter, row [name, lat, lng, r, pop, kommun index, demonym?]. Loaded on demand (x-lazy data-demand in
   index.html, about 90 KB, precached by sw.js like every file index.html names).
   Public: PN.towns = {   (no window global: quality rule)
     ready() → Promise (loads the data once; rejects never: no data = nearest() stays null),
     nearest(lat, lng, maxM) → { name, lat, lng, r, pop, kommun, dem, d, edge, inside } | null (sync, null before ready),
       chosen by the EDGE distance (d − r): a point in a big city belongs to the city, not to a small village nearer its centre.
     area(lat, lng) → Promise<string>: "Ludvika" inside or within 3 km of a tätort, else "Ludvika kommun", "" when unknown.
     near(lat, lng, n) → the n nearest towns (picker "Nära dig"), list() → all rows as objects (sorted by population). } */
(function () {
  "use strict";
  var data = null, rows = null, P = null;
  var NEAR_EDGE_M = 3000, MAX_M = 60000;

  function src() {
    var n = null;
    try { n = [].filter.call(document.querySelectorAll('script[type="text/x-lazy"][src]'), function (x) { return /js\/towns-data\.js/.test(x.getAttribute("src") || ""); })[0]; } catch (e) {}
    return n ? n.getAttribute("src") : "./js/towns-data.js";
  }
  function take() {
    var D = window.PN && window.PN.townsData;
    if (!D || !D.T || !D.T.length) return false;
    data = D;
    rows = D.T.map(function (x) {
      return { name: x[0], lat: x[1], lng: x[2], r: x[3] || 0, pop: x[4] || 0, kommun: (D.K && D.K[x[5]]) || "", dem: x[6] || "" };
    });
    return true;
  }
  function ready() {
    if (rows) return Promise.resolve(true);
    if (take()) return Promise.resolve(true);
    if (P) return P;
    var load = window.PN && window.PN.load;
    if (!load) return Promise.resolve(false);
    P = load(src(), { test: function () { return !!(window.PN && window.PN.townsData); } }).then(take, function () { P = null; return false; });
    return P;
  }
  function dist(a, b, c, d) {
    var r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
    return 12742000 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
  }
  function nearest(lat, lng, maxM) {
    if (!rows && !take()) return null;
    lat = +lat; lng = +lng; if (!isFinite(lat) || !isFinite(lng)) return null;
    var max = maxM == null ? MAX_M : +maxM, best = null, bestE = Infinity, bestD = 0;
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i];
      if (Math.abs(t.lat - lat) > 0.6) continue;   // ≈ 65 km: skip far rows cheaply
      var d = dist(lat, lng, t.lat, t.lng), e = d - t.r;
      if (e < bestE || (e === bestE && best && t.pop > best.pop)) { bestE = e; best = t; bestD = d; }
    }
    if (!best || bestD > max) return null;
    return { name: best.name, lat: best.lat, lng: best.lng, r: best.r, pop: best.pop, kommun: best.kommun, dem: best.dem,
      d: Math.round(bestD), edge: Math.round(Math.max(0, bestE)), inside: bestE <= 0 };
  }
  function areaNow(lat, lng) {
    var t = nearest(lat, lng);
    if (!t) return "";
    if (t.edge <= NEAR_EDGE_M) return t.name;
    return t.kommun ? t.kommun + " kommun" : t.name;
  }
  function area(lat, lng) { return ready().then(function () { return areaNow(lat, lng); }); }
  function near(lat, lng, n) {
    if (!rows && !take()) return [];
    return rows.map(function (t) { return { t: t, d: dist(+lat, +lng, t.lat, t.lng) }; })
      .sort(function (a, b) { return a.d - b.d; }).slice(0, n || 5)
      .map(function (x) { return { name: x.t.name, lat: x.t.lat, lng: x.t.lng, kommun: x.t.kommun, dem: x.t.dem, d: Math.round(x.d) }; });
  }
  function list() { if (!rows && !take()) return []; return rows.slice(); }

  (window.PN = window.PN || {}).towns = { ready: ready, nearest: nearest, area: area, areaNow: areaNow, near: near, list: list,
    src: function () { return data ? data.src : ""; } };
})();
