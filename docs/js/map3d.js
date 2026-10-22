/* Öl Nu — 🏙️ MAP3D: real 3D houses and 3D-lit bars on the Mapbox map styles (CONTRACT "KARTSTIL 4 · 3D hus").
   window.MAP3D, in app.js mods() after BARLIT / ARENAPIN: init, onPoll. No RPC, no new buttons. Klassisk + the free
   (MapLibre) styles are NOT touched: there barlit.js / arenapin.js still draw the 2D lit outlines and glows.
   On a Mapbox style (BASEMAP.isMapbox()) this module adds its own sources + fill-extrusion layers to the Mapbox GL map
   (the one map object basemap.js owns; re-added after every setStyle) and sets html[data-bm3d], which hides the 2D
   barlit / arenaglow panes (not while the ✏️ BAREA editor is open):
   - Houses: docs/buildings3d tiles (scripts/town-buildings.mjs: every OSM + Microsoft footprint of a town, height from
     OSM height / levels / type, else from the area). Mapbox has almost no buildings in small Swedish towns (Ludvika:
     none), so these make the town look full in 3D. Fade in from zoom 13.5 (Leaflet; Mapbox's own from 14).
     A house whose centre lies in a Mapbox 3D house is left out (Mapbox's wins; no double houses). Not on Satellit.
   - Bars: the bar's house (docs/buildings tiles, same data as barlit.js) extruded in warm amber with a soft glow
     (flood light on Standard), ≥ 8 m; for a big house (BAREA lit "part", or a drawn ✏️ area) the whole house is a dim
     amber and the bar's part gets a bright glowing roof slab. State from BARLIT (same ids as the markers): quiet amber,
     1–4 people brighter, ≥ 5 orange-red, a friend / you green. Places (restaurants) only while someone is there.
     No pulse in 3D (a GL repaint per pulse frame costs battery).
   - Mapbox's own building under a bar (Standard: "buildings" featureset; classic styles: our extrusion of the
     composite "building" layer) gets feature-state highlight (warm, colorBuildingHighlight) and our copy of that bar
     is left out; an arena on match days gets select (icy blue, colorBuildingSelect).
   - Arenas with a match ≤ 7 days away (ARENAPIN._matches): the outline (arenas.json) extruded 14 m, 🏒 icy blue /
     ⚽ grass green, brighter on match day / live. The 🏟️ chip stays (arenapin.js).
   - Tap a lit house = the bar's sheet (BARLIT.open) / the arena sheet (ARENAPIN.open).
   - Mapbox's own 3D buildings show from zoom 14 (were 16): basemap.js lowers the import's building layers. */
(function () {
  "use strict";
  var U = window.U;
  var HOUSE_Z = 13.5, MAX_TILES = 14, MAX_BTILES = 12, BAR_MIN_H = 8, CAP = 1.4, ARENA_H = 14;
  var A = null, map = null, on = false, gm = null, hookedMap = null;
  var hix = null, hixP = null, htiles = {}, horder = [];      // docs/buildings3d
  var bix = null, bixP = null, btiles = {}, border = [];      // docs/buildings (bar houses)
  var dirtyH = true, dirtyB = true, mbHasBar = {}, mbStates = [], arenaSig = "", mbSig = "", mbGrid = null, idleT = 0;

  var HOUSE = { "mb-dusk": "#8b87b0", "mb-day": "#e6e1ec", "mb-dawn": "#d9cad9", "mb-night": "#55618a", "mb-faded": "#e5e1d9",
    "mb-mono": "#d2d2d2", "mb-streets": "#e4dfd7", "mb-outdoors": "#e1ddd0", "mb-light": "#e6e6e6", "mb-dark": "#4b4b4b",
    "mb-navday": "#e3e1dc", "mb-navnight": "#34425c" };
  var DARKISH = { "mb-dusk": 1, "mb-night": 1, "mb-dark": 1, "mb-navnight": 1, "mb-sat": 1 };
  var ST_COL = ["match", ["get", "st"], "h", "#ff6a2b", "l", "#ffbf3a", "f", "#3ee07a", "#ffa726"];
  // a big house with the bar in one part: the house is a darker amber, the bar's part a bright roof slab
  var DIM_COL = ["match", ["get", "st"], "h", "#a8502a", "l", "#a9772f", "f", "#3f8f5a", "#94683a"];
  var ARENA_COL = ["match", ["get", "sp"], "fotboll", "#5ee27a", "#8fd8ff"];

  function bm() { return window.BASEMAP; }
  function glMap() { try { var b = bm(); return b && b.isMapbox() && b.mapbox() ? b.mapbox().getMapboxMap() : null; } catch (e) { return null; } }
  function cur() { try { return bm().current(); } catch (e) { return ""; } }
  function isStd(m) { try { return !!(m.style && m.style.getFragmentStyle && m.style.getFragmentStyle("basemap")); } catch (e) { return false; } }
  function canon(id) { try { return window.BARS && window.BARS.canonId ? window.BARS.canonId(id) : String(id); } catch (e) { return String(id); } }
  function barOf(id) { try { return window.BARS && window.BARS.byId(id); } catch (e) { return null; } }

  /* ---------- geometry helpers ---------- */
  var RAD = Math.PI / 180;
  function ringArea(r) {
    var lat = r[0][1], kx = 111320 * Math.cos(lat * RAD), ky = 110540, a = 0;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * kx) * (r[i][1] * ky) - (r[i][0] * kx) * (r[j][1] * ky);
    return Math.abs(a / 2);
  }
  function inRing(p, r) {
    var c = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    }
    return c;
  }
  function centre(r) { var x = 0, y = 0, n = Math.max(1, r.length - 1); for (var i = 0; i < n; i++) { x += r[i][0]; y += r[i][1]; } return [x / n, y / n]; }
  function outer(g) { return !g ? [] : g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map(function (p) { return p[0]; }) : []; }
  function bbox(rings) { var b = [180, 90, -180, -90]; rings.forEach(function (r) { r.forEach(function (p) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; }); }); return b; }
  function byArea(m2) { return m2 < 30 ? 3 : m2 < 80 ? 4 : m2 < 200 ? 6 : m2 < 600 ? 8 : m2 < 2000 ? 10 : m2 < 6000 ? 12 : 14; }

  /* ---------- tiles (two lazy sets, same idea as barlit.js) ---------- */
  function loadIx(url, set) {
    return fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (ix) { if (!ix || !ix.t || !Array.isArray(ix.d)) throw 0; set(ix); return ix; })
      .catch(function () { var e = { d: [0.05, 0.1], t: {} }; set(e); return e; });
  }
  function keysFor(ix) {
    var b = map.getBounds().pad(0.2), D = ix.d, out = [], c = map.getCenter();
    var y0 = Math.floor(b.getSouth() / D[0]), y1 = Math.floor(b.getNorth() / D[0]), x0 = Math.floor(b.getWest() / D[1]), x1 = Math.floor(b.getEast() / D[1]);
    if ((y1 - y0 + 1) * (x1 - x0 + 1) > 40) return out;
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) if (ix.t[y + "_" + x]) out.push({ k: y + "_" + x, d: Math.abs((y + 0.5) * D[0] - c.lat) + Math.abs((x + 0.5) * D[1] - c.lng) / 2 });
    out.sort(function (a, b) { return a.d - b.d; });
    return out.map(function (o) { return o.k; });
  }
  function pull(ix, dir, store, order, max, onDone) {
    var keys = keysFor(ix), n = 0;
    keys.forEach(function (k) {
      var i = order.indexOf(k); if (i >= 0) order.splice(i, 1); order.push(k);
      if (store[k] || n++ >= 6) return;
      store[k] = { state: "loading", fc: null };
      fetch("./" + dir + "/" + k + ".json").then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (fc) { if (store[k]) { store[k].state = "done"; store[k].fc = fc; onDone(); } })
        .catch(function () { delete store[k]; });
    });
    var dropped = false;
    while (order.length > max) {
      var drop = null; for (var j = 0; j < order.length; j++) if (keys.indexOf(order[j]) < 0) { drop = order[j]; break; }
      if (!drop) break;
      order.splice(order.indexOf(drop), 1); delete store[drop]; dropped = true;
    }
    if (dropped) onDone();
  }
  function update() {
    if (!on || !map) return;
    if (map.getZoom() < HOUSE_Z - 0.3) return;
    (hixP || (hixP = loadIx("./buildings3d/index.json", function (x) { hix = x; }))).then(function () {
      pull(hix, "buildings3d", htiles, horder, MAX_TILES, function () { dirtyH = true; soon(); });
    });
    (bixP || (bixP = loadIx("./buildings/index.json", function (x) { bix = x; }))).then(function () {
      pull(bix, "buildings", btiles, border, MAX_BTILES, function () { dirtyB = true; soon(); });
    });
  }

  /* ---------- build the GeoJSON ---------- */
  function stOf(id) {
    var s = {}; try { s = (window.BARLIT && window.BARLIT._state && window.BARLIT._state()) || {}; } catch (e) {}
    var x = s[id]; if (!x) return "q";
    return x.friend ? "f" : x.n >= 5 ? "h" : x.n > 0 ? "l" : "q";
  }
  function people(id) { try { var s = window.BARLIT._state()[id]; return !!(s && s.n); } catch (e) { return false; } }
  function manualRing(id) {
    try {
      var a = window.BAREA && window.BAREA.areaFor ? window.BAREA.areaFor(id) : null;
      if (!a || !a.ll || a.ll.length < 3) return null;
      var r = a.ll.map(function (p) { return Array.isArray(p) ? [p[1], p[0]] : [p.lng, p.lat]; });
      r.push(r[0].slice()); return r;
    } catch (e) { return null; }
  }
  var barHouses = [];   // [{ id, rings, bb }] for hiding the matching plain houses
  var hAdj = {};        // bar id -> height of the plain house it replaces (when taller)
  var cands = [];       // bars / arenas we would draw (for the Mapbox house check)
  function buildBars() {
    var feats = [], seen = {}; barHouses = []; cands = [];
    Object.keys(btiles).forEach(function (k) {
      var t = btiles[k]; if (t.state !== "done" || !t.fc) return;
      var fs = t.fc.features || [], outl = fs.filter(function (f) { return f.properties && f.properties.bldg && Array.isArray(f.properties.of); });
      fs.forEach(function (f) {
        var p = f.properties || {}; if (!p.bar_id || !f.geometry) return;
        var ids = [p.bar_id].concat(Array.isArray(p.also) ? p.also : []), id = null;
        ids.forEach(function (x) { var c = canon(x), b = barOf(c); if (!id && b && !(b.place && !people(c))) id = c; });
        if (!id || seen[id]) return;
        seen[id] = 1;
        var st = stOf(id), man = manualRing(id), house = f.geometry, part = null;
        if (p.lit === "part" || man) {
          var o = outl.filter(function (q) { return q.properties.of.some(function (x) { return canon(x) === id || ids.indexOf(x) >= 0; }); })[0];
          house = o ? o.geometry : (man ? f.geometry : f.geometry);
          part = man ? { type: "Polygon", coordinates: [man] } : f.geometry;
        }
        var rings = outer(house); if (!rings.length) return;
        var bo = barOf(id); if (bo) cands.push({ id: id, lat: bo.lat, lng: bo.lng, c: centre(rings[0]) });
        if (mbHasBar[id]) return;   // Mapbox has this house in 3D: it is highlighted there instead
        var m2 = rings.reduce(function (s, r) { return s + ringArea(r); }, 0);
        var h = Math.max(BAR_MIN_H, Math.min(byArea(m2), 14), hAdj[id] || 0);
        barHouses.push({ id: id, rings: rings, bb: bbox(rings), h: h, feat: null });
        var hf = { type: "Feature", properties: { k: part ? "dim" : "house", id: id, st: st, h: h }, geometry: house };
        barHouses[barHouses.length - 1].feat = hf;
        feats.push(hf);
        if (part) feats.push({ type: "Feature", properties: { k: "cap", id: id, st: st, b: h, h: h + CAP }, geometry: part });
      });
    });
    // arenas with a match this week
    var mm = {}, now = Date.now(); try { mm = (window.ARENAPIN && window.ARENAPIN._matches && window.ARENAPIN._matches()) || {}; } catch (e) {}
    var sigs = [];
    Object.keys(mm).forEach(function (aid) {
      var x = mm[aid], a = x.arena, m0 = x.matches[0]; if (!a || !a.g || !a.g.length) return;
      cands.push({ id: aid, lat: a.lat, lng: a.lng, c: centre(a.g[0]), arena: true }); if (mbHasBar[aid]) return;
      var st = "week"; try { st = window.ARENAPIN._state(m0, now); } catch (e) {}
      var lvl = st === "live" ? "live" : st === "week" ? "week" : "day";
      var rings = a.g.map(function (r) { return r; });
      barHouses.push({ id: aid, rings: rings, bb: bbox(rings), h: ARENA_H, feat: null });
      feats.push({ type: "Feature", properties: { k: "arena", id: aid, sp: m0.sport === "fotboll" ? "fotboll" : "hockey", lv: lvl, h: ARENA_H },
        geometry: { type: "Polygon", coordinates: rings } });
      sigs.push(aid + lvl);
    });
    arenaSig = sigs.join(",");
    return { type: "FeatureCollection", features: feats };
  }
  function buildHouses() {
    var feats = [], adj = {};
    Object.keys(htiles).forEach(function (k) {
      var t = htiles[k]; if (t.state !== "done" || !t.fc) return;
      (t.fc.features || []).forEach(function (f) {
        var r = f.geometry && f.geometry.coordinates && f.geometry.coordinates[0]; if (!r) return;
        var c = centre(r), hide = coveredByMb(c);
        for (var i = 0; !hide && i < barHouses.length; i++) {
          var bh = barHouses[i], b = bh.bb;
          if (c[0] < b[0] || c[0] > b[2] || c[1] < b[1] || c[1] > b[3]) continue;
          if (bh.rings.some(function (rr) { return inRing(c, rr); })) {
            hide = true;
            var h = f.properties && f.properties.h;   // the bar house takes the real height when it is taller
            if (h > bh.h && h > (adj[bh.id] || 0)) adj[bh.id] = Math.min(h, 40);
            break;
          }
        }
        if (!hide) feats.push(f);
      });
    });
    var changed = JSON.stringify(adj) !== JSON.stringify(hAdj); hAdj = adj;
    return { fc: { type: "FeatureCollection", features: feats }, changed: changed };
  }

  /* ---------- GL layers ---------- */
  function firstSymbol(m) { var ls = (m.getStyle().layers || []); for (var i = 0; i < ls.length; i++) if (ls[i].type === "symbol") return ls[i].id; return undefined; }
  function addLayer(m, l, std, before) {
    if (m.getLayer(l.id)) return;
    if (std) { l.slot = "middle"; m.addLayer(l); } else m.addLayer(l, before);
  }
  function ensure(m) {
    if (!m || !m.isStyleLoaded || !m.style || !m.isStyleLoaded()) return false;
    var id = cur(), sat = id === "mb-sat", dark = !!DARKISH[id], col = HOUSE[id] || "#9a96b0";
    try {
      var std = isStd(m), before = std ? undefined : firstSymbol(m);
      if (!m.getSource("olnu-houses")) { m.addSource("olnu-houses", { type: "geojson", data: { type: "FeatureCollection", features: [] }, maxzoom: 16, buffer: 32, tolerance: 0.25 }); dirtyH = true; }
      if (!m.getSource("olnu-bars3d")) { m.addSource("olnu-bars3d", { type: "geojson", data: { type: "FeatureCollection", features: [] }, maxzoom: 17, buffer: 32, tolerance: 0.2 }); dirtyB = true; }
      var fade = ["interpolate", ["linear"], ["zoom"], HOUSE_Z - 1, 0, HOUSE_Z - 0.2, 0.92];   // GL zoom = Leaflet zoom − 1
      addLayer(m, { id: "olnu-houses-3d", type: "fill-extrusion", source: "olnu-houses", minzoom: HOUSE_Z - 1,
        paint: { "fill-extrusion-color": col, "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": 0, "fill-extrusion-opacity": fade,
          "fill-extrusion-vertical-gradient": true, "fill-extrusion-emissive-strength": dark ? 0.25 : 0.1 } }, std, before);
      addLayer(m, { id: "olnu-bars-3d", type: "fill-extrusion", source: "olnu-bars3d", minzoom: HOUSE_Z - 1.5, filter: ["match", ["get", "k"], ["house", "dim"], true, false],
        paint: { "fill-extrusion-color": ["match", ["get", "k"], "dim", DIM_COL, ST_COL], "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": 0,
          "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], HOUSE_Z - 1.5, 0, HOUSE_Z - 0.7, 0.96],
          "fill-extrusion-emissive-strength": ["match", ["get", "k"], "dim", dark ? 0.3 : 0.1, dark ? 0.95 : 0.55],
          "fill-extrusion-flood-light-color": "#ffb347", "fill-extrusion-flood-light-intensity": dark ? 0.5 : 0.2,
          "fill-extrusion-flood-light-ground-radius": 8, "fill-extrusion-flood-light-wall-radius": 3 } }, std, before);
      addLayer(m, { id: "olnu-bars-cap", type: "fill-extrusion", source: "olnu-bars3d", minzoom: HOUSE_Z - 1.5, filter: ["==", ["get", "k"], "cap"],
        paint: { "fill-extrusion-color": ST_COL, "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": ["get", "b"],
          "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], HOUSE_Z - 1.5, 0, HOUSE_Z - 0.7, 1],
          "fill-extrusion-emissive-strength": 1 } }, std, before);
      addLayer(m, { id: "olnu-arena-3d", type: "fill-extrusion", source: "olnu-bars3d", minzoom: 10.5, filter: ["==", ["get", "k"], "arena"],
        paint: { "fill-extrusion-color": ARENA_COL, "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.95,
          "fill-extrusion-emissive-strength": ["match", ["get", "lv"], "live", 1, "day", 0.85, 0.55],
          "fill-extrusion-flood-light-color": "#9be0ff", "fill-extrusion-flood-light-intensity": dark ? 0.6 : 0.25,
          "fill-extrusion-flood-light-ground-radius": 14, "fill-extrusion-flood-light-wall-radius": 4 } }, std, before);
      if (!std && m.getSource("composite") && !m.getLayer("olnu-mb3d")) {
        // classic Mapbox styles: Mapbox's own houses in 3D (they are flat there) + the bar highlight by feature-state
        addLayer(m, { id: "olnu-mb3d", type: "fill-extrusion", source: "composite", "source-layer": "building", minzoom: 13,
          filter: ["all", ["==", ["get", "extrude"], "true"], ["!=", ["get", "underground"], "true"]],
          paint: { "fill-extrusion-color": ["case", ["boolean", ["feature-state", "hl"], false], "#ffb020", ["boolean", ["feature-state", "sel"], false], "#8fd8ff", col],
            "fill-extrusion-height": ["get", "height"], "fill-extrusion-base": ["get", "min_height"],
            "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 13.8, 0.9] } }, false, "olnu-houses-3d");
      }
      if (m.getLayer("olnu-houses-3d")) {
        m.setPaintProperty("olnu-houses-3d", "fill-extrusion-color", col);
        m.setLayoutProperty("olnu-houses-3d", "visibility", sat ? "none" : "visible");
      }
      if (m.getLayer("olnu-mb3d")) m.setPaintProperty("olnu-mb3d", "fill-extrusion-color", ["case", ["boolean", ["feature-state", "hl"], false], "#ffb020", ["boolean", ["feature-state", "sel"], false], "#8fd8ff", col]);
      return true;
    } catch (e) { try { console.warn("olnu map3d", e && e.message); } catch (x) {} return false; }
  }
  var flushT = 0, houseSig = "";
  function soon() { clearTimeout(flushT); flushT = setTimeout(flush, 60); }
  function flush() {
    var m = glMap(); if (!on || !m || !ensure(m)) return;
    try {
      if (!dirtyB && !dirtyH) return;
      var bf = buildBars(), sig = barHouses.map(function (x) { return x.id + ":" + x.bb.join(","); }).join("|");
      if (dirtyH || sig !== houseSig) {
        var hs = buildHouses(); m.getSource("olnu-houses").setData(hs.fc); houseSig = sig;
        if (hs.changed) bf = buildBars();
      }
      m.getSource("olnu-bars3d").setData(bf);
      dirtyB = dirtyH = false;
    } catch (e) {}
  }

  /* ---------- Mapbox's own buildings: highlight under bars, density check ---------- */
  function onIdle() {
    var m = glMap(); if (!on || !m || m !== gm) return;
    if (map.getZoom() < 13.9) { if (mbGrid) { mbGrid = null; mbSig = ""; dirtyH = true; soon(); } return; }
    try {
      var std = isStd(m), tgt = std ? { target: { featuresetId: "buildings", importId: "basemap" } } : (m.getLayer("olnu-mb3d") ? { layers: ["olnu-mb3d"] } : null);
      if (!tgt) return;
      var is3d = function (f) { return !std || (f.properties && f.properties.group === "building-3d"); };
      var all = m.queryRenderedFeatures(tgt).filter(is3d);
      // our plain houses only fill the gaps: a house whose centre lies in a Mapbox 3D house is left out (no double houses)
      var sig = all.map(function (f) { return f.id; }).sort().join(",");
      if (sig !== mbSig) { mbSig = sig; mbGrid = gridOf(all); dirtyH = true; soon(); }
      if (!all.length) { if (mbStates.length || Object.keys(mbHasBar).length) { clearStates(m); mbHasBar = {}; dirtyB = true; soon(); } return; }
      var b = map.getBounds(), now = {}, next = [], list;
      list = cands.filter(function (x) { return b.contains([x.lat, x.lng]); });
      list.forEach(function (bar) {
        var f = null;
        [[bar.lng, bar.lat], bar.c].forEach(function (ll) {   // the bar point, then the centre of its house
          if (f || !ll) return;
          var p = m.project(ll);
          f = m.queryRenderedFeatures([[p.x - 2, p.y - 2], [p.x + 2, p.y + 2]], tgt).filter(is3d)[0] || null;
        });
        if (!f || f.id == null) return;
        now[bar.id] = 1;
        next.push({ f: f, id: bar.id, arena: !!bar.arena, s: bar.arena ? (std ? { select: true } : { sel: true }) : (std ? { highlight: true } : { hl: true }) });
      });
      var ns = next.map(function (x) { return x.f.id + JSON.stringify(x.s); }).sort().join(), os = mbStates.map(function (x) { return x.f.id + JSON.stringify(x.s); }).sort().join();
      if (ns !== os) {   // only on a change: a feature-state write repaints the map (and fires idle again)
        clearStates(m);
        next.forEach(function (x) { try { m.setFeatureState(x.f, x.s); mbStates.push(x); } catch (e) {} });
      }
      if (Object.keys(now).sort().join() !== Object.keys(mbHasBar).sort().join()) { mbHasBar = now; dirtyB = true; soon(); }
    } catch (e) {}
  }
  var GC = [0.0005, 0.001];
  function gridOf(feats) {
    var g = {};
    feats.forEach(function (f) {
      outer(f.geometry).forEach(function (r) {
        var b = bbox([r]);
        for (var y = Math.floor(b[1] / GC[0]); y <= Math.floor(b[3] / GC[0]); y++) for (var x = Math.floor(b[0] / GC[1]); x <= Math.floor(b[2] / GC[1]); x++) {
          (g[y + "_" + x] || (g[y + "_" + x] = [])).push(r);
        }
      });
    });
    return g;
  }
  function coveredByMb(c) {
    if (!mbGrid) return false;
    var l = mbGrid[Math.floor(c[1] / GC[0]) + "_" + Math.floor(c[0] / GC[1])]; if (!l) return false;
    for (var i = 0; i < l.length; i++) if (inRing(c, l[i])) return true;
    return false;
  }
  function clearStates(m) {
    mbStates.forEach(function (x) { try { var o = {}; Object.keys(x.s).forEach(function (k) { o[k] = false; }); m.setFeatureState(x.f, o); } catch (e) {} });
    mbStates = [];
  }
  /* ---------- on / off ---------- */
  function setOn(v) {
    on = v;
    var de = document.documentElement;
    if (v) de.setAttribute("data-bm3d", ""); else de.removeAttribute("data-bm3d");
  }
  function sync() {
    var m = glMap();
    if (!m) { setOn(false); return; }
    if (m !== hookedMap) {
      hookedMap = m;
      m.on("style.load", function () { if (glMap() === m) { dirtyB = dirtyH = true; mbStates = []; mbHasBar = {}; mbSig = ""; mbGrid = null; setTimeout(sync, 0); } });
      m.on("idle", function () { clearTimeout(idleT); idleT = setTimeout(onIdle, 250); });
    }
    gm = m;
    if (!m.isStyleLoaded()) { m.once("idle", sync); return; }
    if (!ensure(m)) { setOn(false); return; }
    setOn(true);
    dirtyB = dirtyH = true; update(); flush();
  }

  /* ---------- tap: a lit 3D house = that bar's sheet ---------- */
  function onClick(e) {
    var m = glMap(); if (!on || !m || !e || !e.latlng) return;
    try {
      var p = m.project([e.latlng.lng, e.latlng.lat]);
      var hit = m.queryRenderedFeatures([[p.x - 3, p.y - 3], [p.x + 3, p.y + 3]], { layers: ["olnu-arena-3d", "olnu-bars-cap", "olnu-bars-3d"].filter(function (l) { return m.getLayer(l); }) })[0];
      if (!hit && mbStates.length) {   // a bar / arena in Mapbox's own (highlighted) house
        var tgt = isStd(m) ? { target: { featuresetId: "buildings", importId: "basemap" } } : { layers: ["olnu-mb3d"] };
        var fs = m.queryRenderedFeatures([[p.x - 2, p.y - 2], [p.x + 2, p.y + 2]], tgt);
        mbStates.forEach(function (x) { if (!hit && fs.some(function (f) { return f.id === x.f.id; })) hit = { properties: { id: x.id, k: x.arena ? "arena" : "house" } }; });
      }
      if (!hit || !hit.properties) return;
      var id = hit.properties.id;
      if (hit.properties.k === "arena") { if (window.ARENAPIN && window.ARENAPIN.open) window.ARENAPIN.open(id); return; }
      if (window.BARLIT && window.BARLIT.open) window.BARLIT.open(id);
    } catch (x) {}
  }

  var CSS = "html[data-bm3d] body:not(.ba-edit) .leaflet-barlit-pane,html[data-bm3d] .leaflet-arenaglow-pane{display:none}";
  window.MAP3D = {
    init: function (api) {
      A = api; map = api && api.map; if (!map) return;
      var st = document.createElement("style"); st.id = "map3d-css"; st.textContent = CSS; document.head.appendChild(st);
      document.addEventListener("basemap:change", function () { setTimeout(sync, 0); });
      map.on("zoomend moveend", U.debounce(function () { if (on) update(); }, 250));
      map.on("click", onClick);
      setInterval(function () {   // arenas change state with the clock (week → day → live)
        if (!on || document.hidden) return;
        var old = arenaSig; buildBars(); if (arenaSig !== old) { dirtyB = true; soon(); }
      }, 60000);
      setTimeout(sync, 500);
    },
    onPoll: function () { if (on) { dirtyB = true; soon(); } },
    // tests
    _on: function () { return on; },
    _stats: function () {
      var m = glMap(), o = { on: on, htiles: Object.keys(htiles).length, btiles: Object.keys(btiles).length, mbHas: Object.keys(mbHasBar), mbCover: mbSig ? mbSig.split(",").length : 0 };
      try {
        o.houses = m && m.getSource("olnu-houses") ? m.getSource("olnu-houses")._data.features.length : 0;
        var bf = m && m.getSource("olnu-bars3d") ? m.getSource("olnu-bars3d")._data.features : [];
        o.bars = bf.filter(function (f) { return f.properties.k !== "arena"; }).map(function (f) { return f.properties.k + ":" + f.properties.id + ":" + f.properties.st + ":" + f.properties.h; });
        o.arenas = bf.filter(function (f) { return f.properties.k === "arena"; }).map(function (f) { return f.properties.id + ":" + f.properties.sp + ":" + f.properties.lv; });
        o.layers = ["olnu-houses-3d", "olnu-bars-3d", "olnu-bars-cap", "olnu-arena-3d", "olnu-mb3d"].filter(function (l) { return m && m.getLayer(l); });
      } catch (e) { o.err = e.message; }
      return o;
    },
    _cand: function (id) { return cands.filter(function (x) { return x.id === id; })[0] || null; },
    _sync: sync, _flush: flush
  };
})();
