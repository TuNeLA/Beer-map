/* Bars layer: OSM bars from bars.json or Overpass, crowd estimate from precise beers. */
(function () {
  "use strict";
  var U = window.U;
  // Main Overpass server first, a mirror second (used only when the main one fails).
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  var FETCH_TIMEOUT_MS = 30000, RETRY_AFTER_MS = 30000;
  var failedAt = 0, endpointIx = 0;
  var TILE = 0.05, TTL = 7 * 86400e3, PREFIX = "olnu.bars.", MAX_TILES = 16;
  var ASSIGN_M = 75, GRID = 0.01;

  var bars = {};          // id -> bar
  var grid = {};          // "gy_gx" -> [bar]
  var mode = "none";      // "static" | "overpass"
  var inFlight = false, pending = false;
  var onChange = function () {};

  var DEDUPE_M = 60;
  var extras = [];        // hand-curated bars from bars-extra.json

  function gridKey(b) { return Math.floor(b.lat / GRID) + "_" + Math.floor(b.lng / GRID); }

  function insertBar(b) {
    bars[b.id] = b;
    var k = gridKey(b);
    (grid[k] || (grid[k] = [])).push(b);
  }

  function removeBar(b) {
    delete bars[b.id];
    var cell = grid[gridKey(b)];
    if (cell) { var i = cell.indexOf(b); if (i >= 0) cell.splice(i, 1); }
  }

  function normName(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/['’´`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  // Similar: one name contains the other, or the first word (3+ letters) is the same.
  function similarName(a, b) {
    var x = normName(a), y = normName(b);
    if (!x || !y) return false;
    if (x.indexOf(y) >= 0 || y.indexOf(x) >= 0) return true;
    var fx = x.split(" ")[0], fy = y.split(" ")[0];
    return fx.length >= 3 && fx === fy;
  }
  function isDuplicate(extra, b) {
    return similarName(extra.name, b.name) && U.haversine(extra.lat, extra.lng, b.lat, b.lng) <= DEDUPE_M;
  }

  // Closed places (docs/bars-closed.json = [{id, name, note}]): never shown, from any source.
  var closed = {};
  function loadClosed() {
    return fetch("./bars-closed.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("no bars-closed.json"); return r.json(); })
      .then(function (list) {
        if (!Array.isArray(list)) return;
        list.forEach(function (c) { if (c && c.id != null) closed[String(c.id)] = true; });
        Object.keys(closed).forEach(function (id) { if (bars[id]) removeBar(bars[id]); });
      })
      .catch(function () { /* optional */ });
  }

  function addBar(b) {
    if (!b || bars[b.id] || typeof b.lat !== "number" || typeof b.lng !== "number") return;
    if (closed[String(b.id)]) return;
    // A real OSM bar wins over a curated extra with a similar name close by.
    for (var i = 0; i < extras.length; i++) {
      var ex = extras[i];
      if (bars[ex.id] === ex && isDuplicate(ex, b)) removeBar(ex);
    }
    insertBar(b);
  }

  function addExtra(b) {
    if (!b || typeof b.id !== "string" || bars[b.id] || typeof b.lat !== "number" || typeof b.lng !== "number") return;
    if (closed[b.id]) return;
    b.extra = true;
    extras.push(b);
    for (var id in bars) { if (!bars[id].extra && isDuplicate(b, bars[id])) return; }
    insertBar(b);
  }

  function loadExtras() {
    return fetch("./bars-extra.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("no bars-extra.json"); return r.json(); })
      .then(function (list) { if (Array.isArray(list)) list.forEach(addExtra); })
      .catch(function () { /* extras are optional */ });
  }

  function nearestBar(lat, lng) {
    var gy = Math.floor(lat / GRID), gx = Math.floor(lng / GRID), best = null, bestD = ASSIGN_M;
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var cell = grid[(gy + dy) + "_" + (gx + dx)]; if (!cell) continue;
      for (var i = 0; i < cell.length; i++) {
        var d = U.haversine(lat, lng, cell[i].lat, cell[i].lng);
        if (d <= bestD) { bestD = d; best = cell[i]; }
      }
    }
    return best;
  }

  function parseOverpass(json) {
    var out = [];
    (json && json.elements || []).forEach(function (el) {
      var lat = el.lat != null ? el.lat : el.center && el.center.lat;
      var lng = el.lon != null ? el.lon : el.center && el.center.lon;
      if (lat == null || lng == null) return;
      var t = el.tags || {};
      var bar = { id: el.type[0] + el.id, name: t.name || null, lat: +(+lat).toFixed(5), lng: +(+lng).toFixed(5), type: t.amenity || "bar" };
      // Optional info for the bar popup, only when OSM has it.
      if (t.opening_hours) bar.opening_hours = String(t.opening_hours).slice(0, 120);
      if (t.website || t["contact:website"]) bar.website = String(t.website || t["contact:website"]).slice(0, 200);
      if (t.phone || t["contact:phone"]) bar.phone = String(t.phone || t["contact:phone"]).slice(0, 40);
      out.push(bar);
    });
    return out;
  }

  function tileKey(ty, tx) { return ty + "_" + tx; }
  function readTile(k) {
    var v = U.ls.getJSON(PREFIX + k, null);
    if (!v || !Array.isArray(v.b) || Date.now() - v.t > TTL) return null;
    return v.b;
  }
  function loadAllCachedTiles() {
    try {
      var drop = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf(PREFIX) !== 0) continue;
        var b = readTile(key.slice(PREFIX.length));
        if (b) b.forEach(addBar); else drop.push(key);
      }
      drop.forEach(function (k) { U.ls.del(k); });
    } catch (e) { /* storage blocked */ }
  }
  function writeTile(k, list) {
    if (!U.ls.setJSON(PREFIX + k, { t: Date.now(), b: list })) {
      // Quota full: drop old bar tiles and try once more.
      try {
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) { var key = localStorage.key(i); if (key && key.indexOf(PREFIX) === 0) keys.push(key); }
        keys.slice(0, Math.ceil(keys.length / 2)).forEach(function (x) { U.ls.del(x); });
      } catch (e) {}
      U.ls.setJSON(PREFIX + k, { t: Date.now(), b: list });
    }
  }

  var fetchedThisSession = {};
  function fetchViewport(map) {
    if (mode !== "overpass") return;
    if (map.getZoom() < 13) return;
    if (inFlight) { pending = true; return; }
    if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return;   // back off after an error
    if (navigator.onLine === false) return;
    var bnd = map.getBounds();
    var y0 = Math.floor(bnd.getSouth() / TILE), y1 = Math.floor(bnd.getNorth() / TILE);
    var x0 = Math.floor(bnd.getWest() / TILE), x1 = Math.floor(bnd.getEast() / TILE);
    var missing = [];
    for (var ty = y0; ty <= y1; ty++) for (var tx = x0; tx <= x1; tx++) {
      var k = tileKey(ty, tx);
      if (fetchedThisSession[k]) continue;
      var cached = readTile(k);
      if (cached) { cached.forEach(addBar); fetchedThisSession[k] = true; continue; }
      missing.push([ty, tx]);
    }
    if (!missing.length) { onChange(); return; }
    missing = missing.slice(0, MAX_TILES);
    var S = Infinity, W = Infinity, N = -Infinity, E = -Infinity;
    missing.forEach(function (m) {
      S = Math.min(S, m[0] * TILE); N = Math.max(N, (m[0] + 1) * TILE);
      W = Math.min(W, m[1] * TILE); E = Math.max(E, (m[1] + 1) * TILE);
    });
    var bb = [S, W, N, E].map(function (v) { return v.toFixed(4); }).join(",");
    var q = '[out:json][timeout:25];(node["amenity"~"^(bar|pub|nightclub|biergarten)$"](' + bb +
      ');way["amenity"~"^(bar|pub|nightclub|biergarten)$"](' + bb + '););out center tags;';
    inFlight = true;
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var tm = ctl ? setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT_MS) : null;
    fetch(OVERPASS[endpointIx % OVERPASS.length], { method: "POST", body: "data=" + encodeURIComponent(q),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("overpass " + r.status); return r.json(); })
      .then(function (json) {
        var list = parseOverpass(json), per = {};
        missing.forEach(function (m) { per[tileKey(m[0], m[1])] = []; });
        list.forEach(function (b) {
          var k = tileKey(Math.floor(b.lat / TILE), Math.floor(b.lng / TILE));
          if (per[k]) per[k].push(b);
          addBar(b);
        });
        Object.keys(per).forEach(function (k) { writeTile(k, per[k]); fetchedThisSession[k] = true; });
        failedAt = 0;
        onChange();
      })
      .catch(function () { failedAt = Date.now(); endpointIx++; /* silent: bars are optional */ })
      .then(function () {
        if (tm) clearTimeout(tm);
        inFlight = false;
        if (pending) { pending = false; fetchViewport(map); }
      });
  }

  /* ---------- Places: restaurants, cafés, fast food ---------- */
  // docs/places.json = [[name, lat, lng, t], …] made weekly by scripts/fetch-places.mjs. t: r|f|c.
  // v14: places are also drink spots ("Var dricker du?", check-in, crowd counts) but are drawn only when
  // someone has a beer or a check-in there. Stable id = "pl_<lat*1e5>_<lng*1e5>" (same rule as the
  // server's bars_lite import, so the server's bar_id matches).
  var places = {}, placesById = {}, placesState = "idle", onPlaces = [];
  var PLACE_TYPES = { r: "restaurant", f: "fast_food", c: "cafe" };
  function placeId(lat, lng) { return "pl_" + Math.round(lat * 1e5) + "_" + Math.round(lng * 1e5); }
  function loadPlaces() {
    if (placesState !== "idle") return;
    placesState = "loading";
    fetch("./places.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("no places.json"); return r.json(); })
      .then(function (list) {
        if (!Array.isArray(list)) throw new Error("bad places.json");
        list.forEach(function (p) {
          var o = Array.isArray(p) ? { name: p[0], lat: p[1], lng: p[2], type: PLACE_TYPES[p[3]] || "restaurant" } : p;
          if (!o || !o.name || typeof o.lat !== "number" || typeof o.lng !== "number") return;
          o.id = o.id || placeId(o.lat, o.lng);
          if (placesById[o.id]) return;
          o.place = true;
          placesById[o.id] = o;
          var k = gridKey(o);
          (places[k] || (places[k] = [])).push(o);
        });
        placesState = "ready";
        onPlaces.forEach(function (f) { try { f(); } catch (e) {} });
      })
      .catch(function () { placesState = "failed"; /* optional: fall back to bars + town */ });
  }
  function nearestPlace(lat, lng, maxM) {
    var gy = Math.floor(lat / GRID), gx = Math.floor(lng / GRID), best = null, bestD = maxM;
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var cell = places[(gy + dy) + "_" + (gx + dx)]; if (!cell) continue;
      for (var i = 0; i < cell.length; i++) {
        var d = U.haversine(lat, lng, cell[i].lat, cell[i].lng);
        if (d <= bestD) { bestD = d; best = cell[i]; }
      }
    }
    return best;
  }
  // Drink spot for a pin: a bar within 75 m wins, else a restaurant/café within 40 m (same rule as the server).
  var PLACE_M = 40;   // restaurants are small and often next to homes: 40 m (bars 75 m), same as the server
  function nearestSpot(lat, lng) { return nearestBar(lat, lng) || nearestPlace(lat, lng, PLACE_M); }
  // Nearest named spot (bar or place) within maxM metres. Search radius limited to the 3x3 grid (~1 km).
  function nearestNamed(lat, lng, maxM) {
    var gy = Math.floor(lat / GRID), gx = Math.floor(lng / GRID), best = null, bestD = maxM;
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var k = (gy + dy) + "_" + (gx + dx);
      [grid[k], places[k]].forEach(function (cell) {
        if (!cell) return;
        for (var i = 0; i < cell.length; i++) {
          if (!cell[i].name) continue;
          var d = U.haversine(lat, lng, cell[i].lat, cell[i].lng);
          if (d <= bestD) { bestD = d; best = cell[i]; }
        }
      });
    }
    return best ? { spot: best, d: bestD } : null;
  }

  window.BARS = {
    // Where is this beer? → { kind: "at"|"near"|"town"|"unknown", name }
    //  at:   precise pin within 75 m of a named bar or restaurant
    //  near: precise pin within 300 m of one
    //  town: approximate pin (the user hid the exact spot), or nothing named close by
    describe: function (b) {
      if (b && b.precise) {
        var bar = nearestBar(b.lat, b.lng);
        if (bar && bar.name) return { kind: "at", name: bar.name };
        var n = nearestNamed(b.lat, b.lng, 300);
        if (n) return { kind: n.d <= ASSIGN_M ? "at" : "near", name: n.spot.name };
      }
      var c = window.CITIES && window.CITIES.nearest(b.lat, b.lng);
      if (c) return { kind: "town", name: c.name };
      return { kind: "unknown", name: null };
    },
    loadPlaces: loadPlaces,
    onPlacesReady: function (f) { onPlaces.push(f); if (placesState === "ready") f(); },
    init: function (opts) {
      onChange = opts.onChange || onChange;
      var map = opts.map;
      var debounced = U.debounce(function () { fetchViewport(map); }, 600);
      var closedReady = loadClosed();
      var extrasReady = closedReady.then(loadExtras);
      fetch("./bars.json", { cache: "no-cache" })
        .then(function (r) { if (!r.ok) throw new Error("no bars.json"); return r.json(); })
        .then(function (list) { return closedReady.then(function () { return list; }); })
        .then(function (list) {
          if (!Array.isArray(list) || !list.length) throw new Error("bad bars.json");
          list.forEach(addBar); mode = "static";
          return extrasReady.then(function () { onChange(); });
        })
        .catch(function () {
          mode = "overpass";
          loadAllCachedTiles(); onChange();
          extrasReady.then(function () { onChange(); });
          map.on("moveend", debounced);
          debounced();
          // Retry after a failed request even if the map does not move.
          setInterval(function () { if (failedAt && document.visibilityState !== "hidden") fetchViewport(map); }, RETRY_AFTER_MS + 1000);
        });
    },
    nearest: nearestBar,
    // Named bars within maxM metres, nearest first: [{ bar, d }]. Search is the 3x3 grid (~1 km).
    // opts.places: also restaurants/cafés/fast food (after the bars, marked place:true), up to opts.maxPlaces.
    nearby: function (lat, lng, maxM, max, opts) {
      var gy = Math.floor(lat / GRID), gx = Math.floor(lng / GRID), out = [], pl = [];
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var k = (gy + dy) + "_" + (gx + dx), cell = grid[k];
        if (cell) for (var i = 0; i < cell.length; i++) {
          if (!cell[i].name) continue;
          var d = U.haversine(lat, lng, cell[i].lat, cell[i].lng);
          if (d <= maxM) out.push({ bar: cell[i], d: d });
        }
        var pc = opts && opts.places ? places[k] : null;
        if (pc) for (var j = 0; j < pc.length; j++) {
          var d2 = U.haversine(lat, lng, pc[j].lat, pc[j].lng);
          if (d2 <= (opts.placeM || maxM)) pl.push({ bar: pc[j], d: d2, place: true });
        }
      }
      out.sort(function (a, b) { return a.d - b.d; });
      pl.sort(function (a, b) { return a.d - b.d; });
      out = max ? out.slice(0, max) : out;
      // A restaurant that is the same spot as a listed bar (similar name, ≤ 80 m) is left out.
      pl = pl.filter(function (p) {
        return !out.some(function (b) { return similarName(p.bar.name, b.bar.name) && U.haversine(p.bar.lat, p.bar.lng, b.bar.lat, b.bar.lng) <= 80; });
      });
      return out.concat(pl.slice(0, opts && opts.maxPlaces != null ? opts.maxPlaces : 4));
    },
    nearestSpot: nearestSpot,
    placeId: placeId,
    placesReady: function () { return placesState === "ready"; },
    byId: function (id) { return bars[id] || placesById[id] || null; },
    inBounds: function (b, max) {
      var out = [];
      for (var id in bars) { if (b.contains([bars[id].lat, bars[id].lng])) { out.push(bars[id]); if (max && out.length >= max) break; } }
      return out;
    },
    // Split live pins into per-spot aggregates and the rest.
    // v14: the server's bar_id (poll_v2, 75 m, bars before restaurants) decides; no bar_id = not at a spot.
    // snap "area" never belongs to a spot. Old server (no snap field): nearest bar, else place (75 m).
    assign: function (beers) {
      var perBar = {}, rest = [];
      beers.forEach(function (be) {
        var bar = null;
        if (be.snap === "area" || !be.precise) bar = null;
        else if (be.bar_id != null) bar = bars[be.bar_id] || placesById[be.bar_id] || null;
        else if (!be.snap) bar = nearestSpot(be.lat, be.lng);   // old server: no snap/bar_id fields
        if (!bar) { rest.push(be); return; }
        var a = perBar[bar.id] || (perBar[bar.id] = { bar: bar, beers: [] });
        a.beers.push(be);
      });
      return { perBar: perBar, rest: rest };
    }
  };
})();
