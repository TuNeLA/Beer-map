/* PintsNow — SEASON MAP (lane seasons, owner I-115 / I-117 / I-120). window.PNSeasonMap. Decorations INSIDE the Mapbox GL
   map (they move with it in the same frame) + the season palettes. Store builds: allowed (no drinking celebration in them).
   - Palettes (Standard style config): "snow has fallen" (snow depth > 2 cm) for Natt and Skymning (still a night map; pins and
     street light stand out), autumn parks (October), fresh spring green (April, May). Restored when the season ends.
   - Christmas: the drawn tree (a symbol that always faces you; 3 twinkle frames) on the best shopping street of the town in
     view; the REAL 3D tree (js/../season/tree.glb, made by scripts/make-tree-glb.mjs) in the tilted view (pitch > 25) in its
     place. Light strings ACROSS that street every 30 m (5 bulbs, 3 twinkle phases). Advent candles (1-4 lit) and the Lucia
     crown (13 Dec) at the churches. NO hand lists: the streets, churches and parks come from the map tiles that are ALREADY
     loaded (the Standard style's own vector source, read with querySourceFeatures, as js/barlight.js does), so it works in
     every town at once.
   - Midsummer poles (one damped swing) + flowers in the parks; Valborg fires 18:00 - 01:00 (8 s of flame, then still);
     autumn leaves in the parks; light beams over bars with 15+ people (tilted view only).
   - RULE (owner 15 Nov: "as long as it doesn't cover any bars"): every piece sits UNDER every bar layer (before the first
     olnu bar layer), is never placed within 45 m of a bar, and is hidden when its box on screen touches a bar icon, a bar
     name, my marker or any DOM pin (faces, people) — checked again after every move / zoom / tilt, and when a DOM pin comes,
     goes or moves while the map stands still (seasonsfix 24 Nov: a pin that came with a poll stayed under the tree). The 3D
     tree follows the same hidden flag at once.
   - Every motion ends: twinkle / flame / swing run 40 s at most after the map opens or the season changes, then stand still.
   - "Levande karta: av" = no decorations, no palette (js/alive.js pn_alive_off). Kill switch: PNSeason.off(). */
(function () {
  "use strict";
  var W = window, D = W.document, PI = Math.PI;
  var SRC = "pn-ss", SRC_W = "pn-ss-wire", SRC_B = "pn-ss-bulbs", SRC_P = "pn-ss-parks", SRC_M = "pn-ss-tree3d";
  var L_PARK = "pn-ss-park", L_GLOW = "pn-ss-glow", L_WIRE = "pn-ss-wire", L_BB = "pn-ss-bulb-bloom", L_BC = "pn-ss-bulb-core", L_SYM = "pn-ss-deco", L_MODEL = "pn-ss-tree3d", MODEL = "pn-ss-tree";
  var BAR_LAYERS = ["olnu-place", "olnu-bar-dote", "olnu-bar-dot", "olnu-bar-dotb1", "olnu-bar-dotb2", "olnu-bar-lbl", "olnu-bar-full"];
  var CLS = ["street", "street_limited", "pedestrian", "primary", "secondary", "tertiary"];
  var EMPTY = { type: "FeatureCollection", features: [] };
  var map = null, gm = null, hooked = null, cur = null, town = null, feats = [], bulbs = [], wires = [], parks = [], buildT = 0, animT = 0, animEnd = 0, frame = 0, swingT0 = 0;
  var pal = { on: "", orig: {} }, made = {}, sig = "", lastBuild = 0, treeAt = {}, pend = 0, pinT = 0, mo = null, moOn = null;
  var stats = { builds: 0, ms: 0, roads: 0, churches: 0, parks: 0, feats: 0, bulbs: 0, hidden: 0, street: "", tree: null, palette: "", model: false, anim: 0 };
  function S() { return W.PNSeason; }
  function glm() { try { var b = W.BASEMAP; return b && b.isMapbox && b.isMapbox() && b.mapbox() ? b.mapbox().getMapboxMap() : null; } catch (e) { return null; } }
  function allowed() { var s = S(); return !!(s && !s.off() && s.alive()); }
  // does today draw anything on the map? (normal days: no tile reading at all)
  function needed(m) { var M = cur && cur.map; return !!(M && allowed() && (M.tree || M.lights || M.advent || M.lucia || M.midsummer || M.fire || M.autumn || (m && m.getPitch() > 30))); }
  function frag(m) { try { return m.style && m.style.getFragmentStyle ? m.style.getFragmentStyle("basemap") || null : null; } catch (e) { return null; } }
  function before(m) { for (var i = 0; i < BAR_LAYERS.length; i++) if (m.getLayer(BAR_LAYERS[i])) return BAR_LAYERS[i]; return undefined; }
  function kx(lat) { return 111320 * Math.cos(lat * PI / 180); }
  function dist(a, b) { var dx = (a[0] - b[0]) * kx(a[1]), dy = (a[1] - b[1]) * 110540; return Math.sqrt(dx * dx + dy * dy); }

  /* ---------- palettes (Standard config) ---------- */
  var PAL = {
    snow: { "mb-night": { colorLand: "#6373a8", colorGreenspace: "#8a9fd6", colorWater: "#78a9d8", colorBuildings: "#94a6da", colorRoads: "#343f6c" },
      "mb-dusk": { colorLand: "#7c7ab0", colorGreenspace: "#a6b4e2", colorWater: "#84b4ea", colorBuildings: "#aca8da", colorRoads: "#524e84" } },
    autumn: { "mb-night": { colorGreenspace: "#9a6a3a" }, "mb-dusk": { colorGreenspace: "#a8743e" } },
    spring: { "mb-night": { colorGreenspace: "#5fb86a" }, "mb-dusk": { colorGreenspace: "#68c874" } }
  };
  function palette(m, s) {
    var st = W.BASEMAP && W.BASEMAP.current ? W.BASEMAP.current() : "", want = "";
    if (allowed() && s) { if (s.wx && s.wx.fallen) want = "snow"; else if (s.map.autumn) want = "autumn"; else if (s.map.spring) want = "spring"; }
    var set = want && PAL[want][st] ? PAL[want][st] : null, key = want + "|" + st;
    if (key === pal.on) return;
    try {
      Object.keys(pal.orig).forEach(function (k) { m.setConfigProperty("basemap", k, pal.orig[k]); });   // back to the style's own colours first
      pal.orig = {};
      if (set) Object.keys(set).forEach(function (k) { pal.orig[k] = m.getConfigProperty("basemap", k); m.setConfigProperty("basemap", k, set[k]); });
      pal.on = key; stats.palette = set ? want : "";
    } catch (e) { pal.on = ""; }
  }

  /* ---------- images ---------- */
  function img(m, name, kind, w, h, o) {
    if (m.hasImage(name)) return name;
    var a = W.PNArt && W.PNArt.map(kind, w, h, o); if (!a) return "";
    try { m.addImage(name, a.data, { pixelRatio: a.pixelRatio }); made[name] = 1; } catch (e) { return ""; }
    return name;
  }
  function pattern(m, name, kind) {
    if (m.hasImage(name)) return name;
    var a = W.PNArt && W.PNArt.map(kind, 32, 32, {}); if (!a) return "";
    try { m.addImage(name, a.data, { pixelRatio: 2 }); } catch (e) { return ""; }
    return name;
  }

  /* ---------- layers (again after a style reload) ---------- */
  function ensure(m) {
    if (!m || !m.style || !m.style._loaded) return false;
    try {
      [SRC, SRC_W, SRC_B, SRC_P, SRC_M].forEach(function (id) { if (!m.getSource(id)) m.addSource(id, { type: "geojson", data: EMPTY, tolerance: 0 }); });
      var bf = before(m), Z = ["zoom"], SZ = function (k) { return ["*", k, ["coalesce", ["get", "sz"], 1]]; };
      if (!m.getLayer(L_PARK)) m.addLayer({ id: L_PARK, type: "fill", source: SRC_P, slot: "middle", minzoom: 13, paint: { "fill-pattern": ["get", "pat"], "fill-opacity": ["interpolate", ["linear"], Z, 13, 0, 14, 0.55, 17, 0.75] } });   // slot "middle": under the labels
      if (!m.getLayer(L_GLOW)) m.addLayer({ id: L_GLOW, type: "circle", source: SRC, minzoom: 13, filter: ["all", ["!=", ["get", "h"], 1], ["has", "glow"]],
        paint: { "circle-color": ["to-color", ["get", "glow"]], "circle-blur": 1, "circle-pitch-alignment": "map", "circle-emissive-strength": 1,
          "circle-radius": ["interpolate", ["exponential", 2], Z, 13, 6, 16, 34, 18, 120], "circle-opacity": 0.45 } }, bf);
      if (!m.getLayer(L_WIRE)) m.addLayer({ id: L_WIRE, type: "line", source: SRC_W, minzoom: 14.5, paint: { "line-color": "rgba(20,16,30,.55)", "line-width": ["interpolate", ["linear"], Z, 15, 0.6, 18, 1.4], "line-emissive-strength": 1 } }, bf);
      var ph = function (a, b, c) { return ["match", ["get", "ph"], 0, a, 1, b, c]; };
      if (!m.getLayer(L_BB)) m.addLayer({ id: L_BB, type: "circle", source: SRC_B, minzoom: 14, filter: ["!=", ["get", "h"], 1],
        paint: { "circle-color": "#ffcf7a", "circle-blur": 1, "circle-emissive-strength": 1, "circle-radius": ["interpolate", ["exponential", 2], Z, 14, 2.5, 16, 6, 18, 16], "circle-opacity": ph(0.75, 0.55, 0.65) } }, bf);
      if (!m.getLayer(L_BC)) m.addLayer({ id: L_BC, type: "circle", source: SRC_B, minzoom: 14, filter: ["!=", ["get", "h"], 1],
        paint: { "circle-color": ["match", ["get", "c"], 1, "#fff4d0", 2, "#ffd27a", "#fff9ea"], "circle-emissive-strength": 1, "circle-radius": ["interpolate", ["exponential", 2], Z, 14, 0.9, 16, 1.8, 18, 4.2], "circle-opacity": ph(1, 0.8, 0.9) } }, bf);
      if (!m.getLayer(L_SYM)) m.addLayer({ id: L_SYM, type: "symbol", source: SRC, minzoom: 13, filter: ["all", ["!=", ["get", "h"], 1], ["!=", ["get", "k"], "beam"]],
        layout: { "icon-image": ["get", "img"], "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-pitch-alignment": "viewport", "icon-rotation-alignment": "viewport",
          "icon-size": ["interpolate", ["linear"], Z, 13, SZ(0.32), 15, SZ(0.55), 17, SZ(0.9), 19, SZ(1.3)], "symbol-sort-key": ["get", "sk"] },
        paint: { "icon-emissive-strength": 1 } }, bf);
      if (!m.getLayer("pn-ss-beam")) m.addLayer({ id: "pn-ss-beam", type: "symbol", source: SRC, minzoom: 13.5, filter: ["all", ["!=", ["get", "h"], 1], ["==", ["get", "k"], "beam"]],
        layout: { "icon-image": ["get", "img"], "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-pitch-alignment": "viewport", "icon-rotation-alignment": "viewport",
          "icon-size": ["interpolate", ["linear"], Z, 14, 0.5, 16, 0.85, 18, 1.2] }, paint: { "icon-emissive-strength": 1, "icon-opacity": 0.9 } }, L_GLOW);
    } catch (e) { try { console.warn("pn seasonmap", e && e.message); } catch (x) {} return false; }
    if (cur && cur.map.tree && allowed()) model(m);   // the 115 KB model is fetched only in the Christmas period
    return true;
  }
  // the real 3D tree (tilted view only): addModel FIRST, then a model layer (a URL as model-id broke rendering in 3.32)
  function model(m) {
    if (!m.addModel || m.getLayer(L_MODEL)) return;
    try {
      if (!m.hasModel || !m.hasModel(MODEL)) m.addModel(MODEL, new URL("season/tree.glb", D.baseURI).href);
      // slot "middle": the houses hide it where they stand in front (depth), and every bar layer / pin is drawn above it
      m.addLayer({ id: L_MODEL, type: "model", source: SRC_M, slot: "middle", minzoom: 14, layout: { "model-id": MODEL, visibility: "none" },
        paint: { "model-scale": [1.7, 1.7, 1.7], "model-emissive-strength": 0.65, "model-cast-shadows": false } });
      stats.model = true;
    } catch (e) { stats.model = false; }
  }

  /* ---------- the town from the loaded tiles ---------- */
  function srcOf(m) {
    var fr = frag(m), st = fr || m.style, src = null;
    try { var Ls = st && st._layers ? st._layers : {}; Object.keys(Ls).some(function (id) { var l = Ls[id]; if (l && l.sourceLayer === "road" && l.source) { src = l.source; return true; } return false; }); } catch (e) {}
    return { fr: fr, src: src };
  }
  function q(m, sl, filter) {
    var hook = W.__PN_SEASON_TILES; if (typeof hook === "function") return hook(sl) || [];   // tests: { road | poi_label | landuse } → features
    var s = srcOf(m); if (!s.src) return [];
    try { return (s.fr || m).querySourceFeatures(s.src, filter ? { sourceLayer: sl, filter: filter } : { sourceLayer: sl }) || []; } catch (e) { return []; }
  }
  function lines(g) { return !g ? [] : g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : []; }
  function barsNear(c, r) {
    if (!W.BARS || !W.BARS.inBounds) return [];
    var dy = r / 110540, dx = r / kx(c[1]);
    try { return W.BARS.inBounds({ contains: function (ll) { var a = ll.lat != null ? ll.lat : ll[0], b = ll.lng != null ? ll.lng : ll[1]; return Math.abs(a - c[1]) < dy && Math.abs(b - c[0]) < dx; } }, 400)
      .map(function (b) { return [+b.lng, +b.lat, b.id]; }); } catch (e) { return []; }
  }
  function clearOf(p, bars, min) { for (var i = 0; i < bars.length; i++) if (dist(p, bars[i]) < min) return false; return true; }
  // the shopping street: the named street with the most bars along it (pedestrian streets count more), in the view's town
  function bestStreet(roads, bars) {
    var by = {};
    roads.forEach(function (f) {
      var p = f.properties || {}, n = p.name; if (!n || CLS.indexOf(p.class) < 0) return;
      var o = by[n] || (by[n] = { name: n, ls: [], len: 0, ped: 0, bars: {} });
      lines(f.geometry).forEach(function (l) {
        if (l.length < 2) return; o.ls.push(l);
        for (var i = 1; i < l.length; i++) { var d = dist(l[i - 1], l[i]); o.len += d; if (p.class === "pedestrian") o.ped += d; }
        l.forEach(function (pt) { bars.forEach(function (b) { if (dist(pt, b) < 45) o.bars[b[2]] = 1; }); });
      });
    });
    var best = null;
    Object.keys(by).forEach(function (n) { var o = by[n], nb = Object.keys(o.bars).length; o.score = nb * 60 + o.ped * 0.4 + Math.min(o.len, 600) * 0.05; if (o.len > 60 && (!best || o.score > best.score)) best = o; });
    return best;
  }
  // points every `step` metres along the street lines (deduped: the same line comes from several tiles)
  function walk(ls, step, cap) {
    var out = [], seen = {}, used = 0;
    ls.forEach(function (l) {
      var k = l.length + "|" + l[0][0].toFixed(5) + "|" + l[l.length - 1][0].toFixed(5); if (seen[k]) return; seen[k] = 1;
      var acc = step / 2;
      for (var i = 1; i < l.length && used < cap; i++) {
        var a = l[i - 1], b = l[i], d = dist(a, b); if (!d) continue;
        while (acc <= d && used < cap) { var u = acc / d; out.push({ p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], dx: (b[0] - a[0]) * kx(a[1]) / d, dy: (b[1] - a[1]) * 110540 / d }); acc += step; used += step; }
        acc -= d;
      }
    });
    return out;
  }
  function centroid(g) {
    var r = g && (g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : null); if (!r || r.length < 3) return null;
    var x = 0, y = 0, a = 0; for (var i = 0; i < r.length - 1; i++) { var c = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; a += c; x += (r[i][0] + r[i + 1][0]) * c; y += (r[i][1] + r[i + 1][1]) * c; }
    if (!a) return null; return { p: [x / (3 * a), y / (3 * a)], area: Math.abs(a / 2) * kx(r[0][1]) * 110540 };
  }
  // read the town once per view (cached by a 0.02° cell): streets, churches, parks
  function readTown(m) {
    var c = m.getCenter(), cell = (Math.round(c.lat * 50) / 50) + "," + (Math.round(c.lng * 50) / 50), z = m.getZoom();
    if (town && town.cell === cell && (town.z >= 14 || z < 14)) return town;
    var t0 = W.performance.now(), C = [c.lng, c.lat], bars = barsNear(C, 1500);
    var roads = q(m, "road", ["match", ["get", "class"], CLS, true, false]), pois = q(m, "poi_label"), lu = q(m, "landuse");
    var st = bestStreet(roads, bars);
    var ch = [], seen = {};
    pois.forEach(function (f) { var p = f.properties || {}, g = f.geometry; if (!g || g.type !== "Point" || !(p.maki === "religious-christian" || (p.class === "religion" && !p.maki))) return;
      var k = (p.name || "") + g.coordinates[0].toFixed(4); if (seen[k]) return; seen[k] = 1; ch.push({ p: g.coordinates, name: p.name || "", d: dist(g.coordinates, C) }); });
    ch.sort(function (a, b) { return a.d - b.d; });
    var pk = []; seen = {};
    lu.forEach(function (f) { var p = f.properties || {}; if (p.class !== "park" && p.class !== "grass") return; var ce = centroid(f.geometry); if (!ce) return; var k = ce.p[0].toFixed(4) + ce.p[1].toFixed(4); if (seen[k]) return; seen[k] = 1;
      pk.push({ f: f, p: ce.p, area: ce.area, cls: p.class, d: dist(ce.p, C) }); });
    town = { cell: cell, z: z, st: st, ch: ch.slice(0, 3), parks: pk, bars: bars, C: C, at: Date.now(), n: roads.length + pois.length + lu.length };
    stats.roads = roads.length; stats.churches = ch.length; stats.parks = pk.length; stats.street = st ? st.name : ""; stats.ms = Math.round(W.performance.now() - t0);
    return town;
  }

  /* ---------- the pieces of today ---------- */
  function build() {
    var m = gm; if (!m || !cur) return;
    stats.builds++; lastBuild = Date.now();
    var s = cur, M = s.map, f = [], b = [], w = [], pp = [], mdl = [];
    if (!needed(m) || m.getZoom() < 12.5) { if (feats.length || bulbs.length || wires.length || parks.length) push(m, f, b, w, pp, mdl); return; }
    var T = readTown(m), bars = T.bars;
    // Christmas: the tree on the shopping street (45 m from every bar), light strings across it
    if (M.tree && T.st) {
      var pts = walk(T.st.ls, 10, 900), best = null, cen = [0, 0], nb = 0, cands = [], R = pinRects(m);
      bars.forEach(function (x) { if (dist(x, T.C) < 600) { cen[0] += x[0]; cen[1] += x[1]; nb++; } }); cen = nb ? [cen[0] / nb, cen[1] / nb] : T.C;
      // on the street itself (open space: the 3D tree is not inside a house)
      pts.forEach(function (q2) { [0, 5, -5].forEach(function (o) { var side = [q2.p[0] - q2.dy * o / kx(q2.p[1]), q2.p[1] + q2.dx * o / 110540];
        if (clearOf(side, bars, 70)) cands.push({ sc: dist(side, cen), p: side }); }); });
      cands.sort(function (a, b2) { return a.sc - b2.sc; });
      // the nearest free spot: its box on screen touches no pin now (the rule), else the nearest one (then it is hidden)
      // the tree keeps its spot in this town (it must not jump on zoom); a new pick only in a new town
      var tk = T.cell + "|" + T.st.name; if (treeAt[tk]) best = treeAt[tk];
      for (var ci = 0; ci < Math.min(60, cands.length) && !best; ci++) if (!hit(boxOf(m, F(cands[ci].p, { k: "tree" })), R)) best = cands[ci];
      best = best || cands[0]; if (best && m.getZoom() >= 14.5) treeAt[tk] = best;
      if (best) { f.push(F(best.p, { k: "tree", img: "ss-tree-0", glow: "#ffcf7a", sk: 1 })); mdl.push(F(best.p, { k: "tree3d" })); stats.tree = best.p; }
      if (M.lights) walk(T.st.ls, 30, 720).forEach(function (q2, i) {
        var ax = -q2.dy / kx(q2.p[1]), ay = q2.dx / 110540, ends = [[q2.p[0] + ax * 9.5, q2.p[1] + ay * 9.5], [q2.p[0] - ax * 9.5, q2.p[1] - ay * 9.5]];
        if (!clearOf(q2.p, bars, 22)) return;
        w.push({ type: "Feature", geometry: { type: "LineString", coordinates: ends }, properties: {} });
        for (var j = 0; j < 5; j++) { var o = -8.5 + j * 4.25; b.push(F([q2.p[0] + ax * o, q2.p[1] + ay * o], { ph: (i + j) % 3, c: j % 3 })); }
      });
    }
    // Advent candles / the Lucia crown at the churches
    if (M.advent || M.lucia) T.ch.forEach(function (c, i) { if (!clearOf(c.p, bars, 35)) return;
      f.push(F(c.p, M.lucia ? { k: "lucia", img: "ss-lucia-0", glow: "#ffd27a", sz: 0.95, sk: 2 } : { k: "advent", n: M.advent, img: "ss-adv-" + M.advent + "-0", glow: "#ffd27a", sz: 0.9, sk: 2 })); });
    // Midsummer poles + flowers; Valborg fires; autumn leaves in the parks
    var big = T.parks.filter(function (p) { return p.area > 1500 && p.d < 1800; }).sort(function (a, b2) { return b2.area - a.area; });
    if (M.midsummer) big.slice(0, 3).forEach(function (p) { if (clearOf(p.p, bars, 45)) f.push(F(p.p, { k: "pole", img: "ss-pole-0", sz: 1, sk: 3 })); });
    if (M.fire) big.slice(0, 2).forEach(function (p) { if (clearOf(p.p, bars, 60)) f.push(F(p.p, { k: "fire", img: "ss-fire-0", glow: "#ff8a3a", sz: 1, sk: 3 })); });
    var pat = M.midsummer ? "ss-pat-flowers" : M.autumn ? "ss-pat-leaves" : "";
    if (pat) T.parks.forEach(function (p) { if (p.cls === "park") pp.push({ type: "Feature", geometry: p.f.geometry, properties: { pat: pat } }); });
    // light beams over very full bars (15+ people), tilted view only
    if (m.getPitch() > 30 && W.BARLIGHT && W.BARLIGHT._state) { var lit = W.BARLIGHT._state().lit || [], ids = {}; lit.forEach(function (x) { if (x.lv >= 3) ids[x.id] = 1; });
      bars.forEach(function (x) { if (ids[x[2]]) f.push(F([x[0], x[1]], { k: "beam", img: "ss-beam" })); }); }
    push(m, f, b, w, pp, mdl);
  }
  function F(p, props) { return { type: "Feature", geometry: { type: "Point", coordinates: p }, properties: props }; }
  function push(m, f, b, w, pp, mdl) {
    feats = f; bulbs = b; wires = w; parks = pp;
    images(m, f);
    cull(m);
    try { m.getSource(SRC_W).setData({ type: "FeatureCollection", features: w }); m.getSource(SRC_P).setData({ type: "FeatureCollection", features: pp }); m.getSource(SRC_M).setData({ type: "FeatureCollection", features: mdl }); } catch (e) {}
    stats.feats = f.length; stats.bulbs = b.length;
    tilt(m);
    if (f.some(function (x) { return /tree|adv|lucia|pole|fire/.test(x.properties.k); }) || b.length) anim(m, false);
  }
  function images(m, f) {
    var k = {}; f.forEach(function (x) { k[x.properties.k + (x.properties.n || "")] = x.properties; });
    if (k.tree) for (var i = 0; i < 3; i++) img(m, "ss-tree-" + i, "tree", 100, 132, { f: i });
    Object.keys(k).forEach(function (n) { if (/^advent/.test(n)) for (var i2 = 0; i2 < 3; i2++) img(m, "ss-adv-" + k[n].n + "-" + i2, "advent", 74, 84, { n: k[n].n, f: i2 }); });
    if (k.lucia) for (i = 0; i < 3; i++) img(m, "ss-lucia-" + i, "lucia", 84, 76, { f: i });
    if (k.pole) for (i = 0; i < 9; i++) img(m, "ss-pole-" + i, "pole", 72, 124, { sw: (i - 4) * 3 });
    if (k.fire) for (i = 0; i < 12; i++) img(m, "ss-fire-" + i, "fire", 92, 112, { t: i / 12 * 2 });
    if (k.beam) img(m, "ss-beam", "beam", 90, 280, {});
    pattern(m, "ss-pat-flowers", "flowers"); pattern(m, "ss-pat-leaves", "leafpat");
  }

  /* ---------- the rule: nothing on a pin ---------- */
  function pinRects(m) {
    var out = [];
    try { if (W.GLBARS && W.GLBARS.on()) W.GLBARS.rects().forEach(function (r) { out.push([r.l, r.t, r.r, r.b]); }); } catch (e) {}
    try { var me = W.GLBARS._me(); if (me && me.px) out.push([me.px.x - me.px.r, me.px.y - me.px.r, me.px.x + me.px.r, me.px.y + me.px.r]); } catch (e) {}
    try { var c = m.getContainer(), cr = c.getBoundingClientRect();
      c.querySelectorAll(".leaflet-marker-icon").forEach(function (el) { if (el.offsetParent === null) return; var r = el.getBoundingClientRect(); if (r.width > 2 && r.width < 200) out.push([r.left - cr.left, r.top - cr.top, r.right - cr.left, r.bottom - cr.top]); }); } catch (e) {}
    return out;
  }
  var SIZE = { tree: [100, 132], advent: [74, 84], lucia: [84, 76], pole: [72, 124], fire: [92, 112] };
  function iconK(z) { var s = [[13, 0.32], [15, 0.55], [17, 0.9], [19, 1.3]]; for (var i = 1; i < s.length; i++) if (z <= s[i][0]) return s[i - 1][1] + (s[i][1] - s[i - 1][1]) * (z - s[i - 1][0]) / (s[i][0] - s[i - 1][0]); return 1.3; }
  function hit(a, R) { for (var i = 0; i < R.length; i++) { var r = R[i]; if (a[0] < r[2] && a[2] > r[0] && a[1] < r[3] && a[3] > r[1]) return true; } return false; }
  // the screen box of each piece (anchor bottom centre) against every pin box → h = 1 (hidden)
  function boxOf(m, x) {
    var p = m.project(x.geometry.coordinates), k = x.properties.k, sz = SIZE[k];
    if (!sz) { var r0 = k === "bulb" ? 5 : 3; return [p.x - r0, p.y - r0, p.x + r0, p.y + r0]; }
    var s = iconK(m.getZoom()) * (x.properties.sz || 1), w = sz[0] * s, h = sz[1] * s;
    return [p.x - w / 2, p.y - h, p.x + w / 2, p.y];
  }
  var cullSig = "";
  function cull(m, quiet) {
    if (!m) return;
    var R = pinRects(m), hid = 0, sg = "";
    feats.forEach(function (x) { if (x.properties.k === "beam") return; var h = hit(boxOf(m, x), R) ? 1 : 0; x.properties.h = h; hid += h; sg += h; });
    bulbs.forEach(function (x) { var p = m.project(x.geometry.coordinates), h = hit([p.x - 6, p.y - 6, p.x + 6, p.y + 6], R) ? 1 : 0; x.properties.h = h; hid += h; sg += h; });
    stats.hidden = hid;
    // quiet (map "idle"): send only when a piece changed (else idle → setData → idle … would loop)
    if (quiet && sg === cullSig) return;
    cullSig = sg; stats.culls = (stats.culls || 0) + 1;
    try { m.getSource(SRC).setData({ type: "FeatureCollection", features: feats }); m.getSource(SRC_B).setData({ type: "FeatureCollection", features: bulbs }); } catch (e) {}
    tilt(m);   // the 3D tree is hidden with the drawn one (it showed over a pin until the next build)
  }

  /* ---------- motion: twinkle, flame, swing (40 s at most, then still) ---------- */
  function anim(m, again) {
    if (animT && !again) return;
    var rm = S().reduced(); if (rm) { stillFrame(m); return; }
    if (!again) { animEnd = Date.now() + 40000; swingT0 = Date.now(); frame = 0; }
    W.clearTimeout(animT);
    animT = W.setTimeout(function step() {
      animT = 0; if (!gm || D.hidden) return;
      var now = Date.now(), el = now - swingT0, done = now > animEnd, lt = S().light(); frame++; stats.anim++;
      var fl = !lt && el < 8000 && feats.some(function (x) { return x.properties.k === "fire"; }), sw = !lt && el < 2600 && feats.some(function (x) { return x.properties.k === "pole"; });
      var f = done ? 0 : Math.floor(el / 900) % 3, sway = sw ? Math.round(4 + 4 * 0.95 * Math.exp(-1.25 * el / 1000) * Math.sin(5.4 * el / 1000)) : 4;
      try {
        m.setLayoutProperty(L_SYM, "icon-image", ["match", ["get", "k"], "tree", "ss-tree-" + f, "lucia", "ss-lucia-" + f, "advent", ["concat", "ss-adv-", ["to-string", ["get", "n"]], "-" + f],
          "pole", "ss-pole-" + Math.max(0, Math.min(8, sway)), "fire", "ss-fire-" + (fl ? frame % 12 : 3), ["get", "img"]]);
        var r = done ? 0 : f; m.setPaintProperty(L_BB, "circle-opacity", ["match", ["get", "ph"], r, 0.82, (r + 1) % 3, 0.5, 0.66]);
      } catch (e) {}
      if (!done) animT = W.setTimeout(step, fl || sw ? 85 : 900);
    }, 120);
  }
  function stillFrame(m) {
    try { m.setLayoutProperty(L_SYM, "icon-image", ["match", ["get", "k"], "tree", "ss-tree-0", "lucia", "ss-lucia-0", "advent", ["concat", "ss-adv-", ["to-string", ["get", "n"]], "-0"], "pole", "ss-pole-4", "fire", "ss-fire-3", ["get", "img"]]); } catch (e) {}
  }
  // the tilted view: the real 3D tree in place of the drawn one
  function tilt(m) {
    var up = m.getPitch() > 25 && feats.some(function (x) { return x.properties.k === "tree" && !x.properties.h; });
    try { if (m.getLayer(L_MODEL)) m.setLayoutProperty(L_MODEL, "visibility", up ? "visible" : "none");
      m.setFilter(L_SYM, ["all", ["!=", ["get", "h"], 1], ["!=", ["get", "k"], "beam"]].concat(up ? [["!=", ["get", "k"], "tree"]] : [])); } catch (e) {}
  }

  /* ---------- wiring ---------- */
  function need(delay) { pend = 1; W.clearTimeout(buildT); buildT = W.setTimeout(function () { (W.requestIdleCallback || function (f) { return W.setTimeout(f, 30); })(function () { pend = 0; build(); }, { timeout: 1200 }); }, delay == null ? 350 : delay); }
  // DOM pins come, go and move without a map "idle" (a poll, my position, Levande karta sparks): check the rule again then
  function isPin(n) { return !!(n && n.nodeType === 1 && n.classList && n.classList.contains("leaflet-marker-icon")); }
  function pinRec(r) {
    if (r.type === "attributes") return isPin(r.target);
    var L2 = [r.addedNodes, r.removedNodes];
    for (var j = 0; j < 2; j++) for (var i = 0; i < L2[j].length; i++) { var n = L2[j][i]; if (isPin(n) || (n.querySelector && n.querySelector(".leaflet-marker-icon"))) return true; }
    return false;
  }
  function pinsSoon(m) {
    if (pinT) return;
    pinT = W.setTimeout(function () { pinT = 0; if (gm !== m || (m.isMoving && m.isMoving())) return; cull(m, true); }, 150);   // moving: moveend builds + culls
  }
  function watchPins(m) {
    if (moOn === m || !W.MutationObserver) return;
    try { if (mo) mo.disconnect(); moOn = m;
      mo = new W.MutationObserver(function (recs) { if (!feats.length && !bulbs.length) return; for (var i = 0; i < recs.length; i++) if (pinRec(recs[i])) { pinsSoon(m); return; } });
      mo.observe(m.getContainer(), { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] }); } catch (e) {}
  }
  function hook(m) {
    if (!m || hooked === m) return; hooked = m; gm = m; town = null; pal = { on: "", orig: {} }; watchPins(m);
    m.on("style.load", function () { pal = { on: "", orig: {} }; town = null; W.setTimeout(function () { if (ensure(m)) { palette(m, cur); need(200); } }, 400); });
    m.on("moveend", function () { if (!needed(m) && !feats.length && !bulbs.length) return; need(250); });
    m.on("pitchend", function () { cull(m, true); tilt(m); need(100); });   // the boxes of the new view first (the 3D tree must not show over a pin)
    // pins come and go (a poll, a DOM pin mounts, a name gets placed): check the rule again when the map is still
    m.on("idle", function () {
      if (feats.length || bulbs.length) cull(m, true);
      // more tiles came after the first read (a church, the real shopping street): read the town again, at most every 10 s
      if (town && needed(m) && Date.now() - town.at > 10000 && Date.now() - (town.re || 0) > 10000) { town.re = Date.now();
        (W.requestIdleCallback || function (f) { return W.setTimeout(f, 200); })(function () { if (!town) return; var n0 = town.n, t0 = town; town = null; var t2 = readTown(m); if (t2.n > n0) need(50); else town = t0; }, { timeout: 3000 }); }
    });
    m.on("sourcedata", function (e) { if (e && e.isSourceLoaded && !town && needed(m)) need(600); });
  }
  function check() {
    var m = glm(); if (!m || !(W.GLBARS && W.GLBARS.on && W.GLBARS.on())) return false;
    hook(m); if (!ensure(m)) return false;
    palette(m, cur); need(400); return true;
  }
  function onSeason(s) {
    var g2 = [s.key, s.map.advent, s.map.lucia, s.map.fire, s.map.fireworks, s.wx && s.wx.fallen, allowed()].join("|");
    cur = s; if (g2 === sig) return; sig = g2;
    if (gm) { if (s.map.tree && allowed()) model(gm); palette(gm, s); W.clearTimeout(animT); animT = 0; need(100); }
  }
  W.PNSeasonMap = {
    init: function (api) {
      map = api && api.map; if (!S()) return;
      cur = S().now(); S().on(onSeason);
      D.addEventListener("basemap:change", function () { W.setTimeout(check, 400); });
      var n = 0, t = W.setInterval(function () { if (check() || ++n > 120) W.clearInterval(t); }, 500);
    },
    stats: stats,
    rects: function () { var m = gm, out = []; if (!m) return out; feats.concat(bulbs).forEach(function (x) { if (x.properties.h) return; var b = boxOf(m, x); out.push({ k: x.properties.k || "bulb", l: b[0], t: b[1], r: b[2], b: b[3] }); }); return out; },
    pins: function () { return gm ? pinRects(gm) : []; },
    feats: function () { return feats.map(function (x) { return { k: x.properties.k, h: x.properties.h || 0, p: x.geometry.coordinates }; }); },
    _build: function () { town = null; build(); return stats; },
    _pending: function () { return !!(pend || pinT); },   // tests: a build or a pin check still waits
    _layers: function () { return [L_PARK, L_GLOW, L_WIRE, L_BB, L_BC, L_SYM, L_MODEL, "pn-ss-beam"].filter(function (id) { return gm && gm.getLayer(id); }); }
  };
  if (W.PN && W.PN.mod) W.PN.mod("PNSeasonMap");
})();
