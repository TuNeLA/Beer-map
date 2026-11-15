/* PintsNow — 🏮 BARLIGHT (lane maplight, owner 15 Nov 2026, I-115): the map shows where the life is. window.BARLIGHT.
   Information about PLACES, never about how much anyone drank. Store builds show it too (same policy as the heat cloud).
   Crowd step of a bar (PNCROWD.step): 3-7 people = 1 · 8-14 = 2 · 15+ = 3. Under 3 people = 0 = NO light, no halo, no
   lantern, no ring for a stranger (it must never point at one or two persons).
   A  street light  warm light on the street pieces near a busy bar. Reach 60 / 95 / 140 m, brightest at the bar's "door"
                    (the nearest street point within 70 m), fades out to the end. Two GL line layers in the Standard
                    style's slot "middle" (over the roads, under the houses and the labels).
   C  halo          two soft GL circles under the bar pin, in the street-light yellow: "exactly here"; the inner one is
                    bigger zoomed out (the town view: one warm spot per busy bar).
   B  lantern pin   the bar disc itself (js/mapart.js barOps, drawn by js/glmap.js): this module only gives the step.
   E  ring          ONE 2 s ring when a check-in at a bar arrives in the poll (max one per bar per 10 s). A DOM marker
                    (CSS transform / opacity only), so it also works without GL.
   Street data: NO data files and no build step. The street lines come from the road tiles the map has ALREADY loaded
   (the Standard style's own vector source, source layer "road", read with querySourceFeatures on the "basemap" style
   fragment: a few ms). The pieces (4 m long, d = metres from the door) are made ONCE per bar in idle time and kept in
   memory. It works in every town of the world at once. No roads found (raster fallback, a field, an old GL) = the halo
   and the lantern still show.
   Motion: "the light spreads" once (1.7 s) when the map opens and when a bar goes UP a step. It runs on feature-state
   (no new data, no re-layout). Nothing runs per frame when idle. Reduced motion / Data Saver / < 4 GB memory / "Levande
   karta" off: no motion, the still light stays (it is information).
   Kill switch: PN.CFG.barlight === false, or ?barlight=0. Off = no light, no halo, no lantern, no ring, the old heat cloud.
   Feed: app-pins.js render() → BARLIGHT.set(list) (the same people data the bar pills use). Layers: glmap.js ensure(). */
(function () {
  "use strict";
  var W = window, D = W.document;
  var REACH = [0, 60, 95, 140], STR = [0, 0.62, 0.84, 1], DOOR_M = 70, PIECE_M = 4, MAX_LIT = 24, SPREAD_MS = 1700, RING_MS = 2000, RING_GAP = 10000, RING_NEW = 120e3;
  var CLS = ["street", "street_limited", "pedestrian", "primary", "secondary", "tertiary", "primary_link", "secondary_link", "tertiary_link"];
  var SRC_L = "pn-light", SRC_P = "pn-light-pts", L_GLOW = "pn-light-glow", L_CORE = "pn-light-core", L_HA = "pn-light-halo-a", L_HB = "pn-light-halo-b";
  var EMPTY = { type: "FeatureCollection", features: [] };
  var map = null, gm = null, ready = false, hooked = null, offV = null;
  var all = {}, lit = [], lvSeen = {}, cache = {}, tries = {}, featIds = {}, sigP = "", sigL = "", booted = false, bootAt = 0;
  var buildT = 0, building = false, animRaf = 0, anim = null, ciSeen = {}, ciFirst = true, ringAt = {}, pane = null;
  var stats = { sets: 0, ptSets: 0, lineSets: 0, builds: 0, buildMs: 0, roadMs: 0, roads: 0, pieces: 0, rings: 0, spreads: 0, frames: 0, noRoads: 0 };

  /* ---------- switches ---------- */
  function off() {
    if (offV != null) return offV;
    var v = false;
    try { if (/[?&]barlight=0(&|$)/.test(W.location.search)) v = true; } catch (e) {}
    try { var c = (W.PN && W.PN.CFG) || W.OLNU_CONFIG || {}; if (c.barlight === false || c.barlight === 0 || c.barlight === "0") v = true; } catch (e) {}
    return (offV = v);
  }
  function motionOK() {
    try {
      if (D.hidden) return false;
      if (W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
      var c = W.navigator.connection; if (c && c.saveData) return false;
      if (W.navigator.deviceMemory && W.navigator.deviceMemory < 4) return false;
      if (W.localStorage.getItem("pn_alive_off") === "1") return false;   // "Levande karta: av" (js/alive.js): no motion, the still light stays
    } catch (e) {}
    return true;
  }
  function step(n) { return W.PNCROWD && W.PNCROWD.step ? W.PNCROWD.step(n) : (n >= 15 ? 3 : n >= 8 ? 2 : n >= 3 ? 1 : 0); }

  /* ---------- GL layers (glmap.js ensure() calls this; again after a style reload) ---------- */
  function L3(a, b, c) { return ["match", ["get", "lv"], 1, a, 2, b, c]; }
  function ensure(m, before) {
    if (off() || !m) return false;
    try {
      if (hooked !== m) { hooked = m; sigP = ""; sigL = ""; }
      gm = m;
      if (!m.getSource(SRC_L)) { m.addSource(SRC_L, { type: "geojson", data: EMPTY, tolerance: 0, buffer: 32, maxzoom: 16 }); sigL = ""; }
      if (!m.getSource(SRC_P)) { m.addSource(SRC_P, { type: "geojson", data: EMPTY, maxzoom: 14 }); sigP = ""; }
      var bf = before && m.getLayer(before) ? before : undefined;
      // k = how far the light has spread (feature-state, 0.02 → 1 while "the light spreads"; no state = 1 = the still light)
      var K = ["coalesce", ["feature-state", "k"], 1];
      var A = ["*", L3(STR[1], STR[2], STR[3]), ["^", ["max", 0, ["-", 1, ["/", ["get", "d"], ["*", K, L3(REACH[1], REACH[2], REACH[3])]]]], 1.2]];
      var Wd = function (k) { return ["interpolate", ["exponential", 1.6], ["zoom"], 12, 1.4 * k, 14, 5.6 * k, 16, 17 * k, 18, 44 * k]; };
      var line = function (id, paint) {
        if (m.getLayer(id)) return;
        // slot "middle" of the Standard style = over the roads, under the houses and the labels. A style without that slot
        // (tests, an old style) keeps the layer where it is added: under the halo and the bar layers.
        m.addLayer({ id: id, type: "line", source: SRC_L, slot: "middle", minzoom: 12, layout: { "line-cap": "butt", "line-join": "round" }, paint: paint }, bf);
      };
      line(L_GLOW, { "line-color": "#F5A623", "line-width": Wd(2.3), "line-blur": Wd(1.6), "line-opacity": ["*", A, 0.68], "line-emissive-strength": 1 });
      line(L_CORE, { "line-color": ["interpolate", ["linear"], A, 0, "#F5A623", 0.5, "#FFB84A", 1, "#FFDC96"], "line-width": Wd(0.95), "line-blur": Wd(0.25),
        "line-opacity": A, "line-emissive-strength": 1 });
      var Z = function (a, b, c) { return ["interpolate", ["linear"], ["zoom"], 12, L3(a * 0.4, b * 0.4, c * 0.4), 14, L3(a * 0.63, b * 0.63, c * 0.63), 16, L3(a * 0.9, b * 0.9, c * 0.9), 18, L3(a * 1.35, b * 1.35, c * 1.35)]; };
      if (!m.getLayer(L_HA)) m.addLayer({ id: L_HA, type: "circle", source: SRC_P, paint: { "circle-color": "#F5A623", "circle-blur": 1, "circle-emissive-strength": 1, "circle-pitch-alignment": "map",
        "circle-radius": Z(40, 58, 80), "circle-opacity": ["interpolate", ["linear"], ["zoom"], 13.4, 0, 14.4, L3(0.36, 0.5, 0.62)] } }, bf);
      if (!m.getLayer(L_HB)) m.addLayer({ id: L_HB, type: "circle", source: SRC_P, paint: { "circle-color": "#FFB84A", "circle-blur": 0.9, "circle-emissive-strength": 1, "circle-pitch-alignment": "map",
        // the town view (owner 15 Nov 18:17: "hard to see where people are at the bar"; "a slight yellow glow where people drink,
        // the same yellow as the street light"): this inner glow is bigger and stronger zoomed out, one spot per busy bar
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, L3(11, 14, 18), 13.5, L3(15, 19, 24), 16, L3(18, 23.4, 30.6), 18, L3(27, 35, 46)],
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 11, L3(0.4, 0.52, 0.64), 13.5, L3(0.5, 0.64, 0.78)] } }, bf);
      ready = !!(m.getLayer(L_HA) && m.getLayer(L_HB) && m.getLayer(L_GLOW) && m.getLayer(L_CORE));
    } catch (e) { ready = false; try { console.warn("pn barlight", e && e.message); } catch (x) {} }
    if (ready) { pushPts(); pushLines(); need(); }
    return ready;
  }

  /* ---------- data in (app-pins.js render) ---------- */
  // list = [{ id, lat, lng, n (people at the bar), cis: [check-in rows] }] for every bar with somebody; null = no data at this zoom
  function set(list) {
    if (off()) return;
    stats.sets++;
    var now = Date.now(), next = {}, ups = [];
    (list || []).forEach(function (b) {
      if (!b || b.id == null || !isFinite(+b.lat) || !isFinite(+b.lng)) return;
      var id = String(b.id), n = Math.max(0, b.n | 0), lv = step(n);
      next[id] = { id: id, lat: +b.lat, lng: +b.lng, n: n, lv: lv };
      if (lv && lvSeen[id] != null && lv > lvSeen[id]) ups.push(id);   // the bar went UP a step: its light spreads once
      if (list) lvSeen[id] = lv;
      rings(next[id], b.cis || [], now);
    });
    if (list) ciFirst = false;
    all = next;
    lit = Object.keys(all).map(function (id) { return all[id]; }).filter(function (b) { return b.lv > 0; })
      .sort(function (a, b) { return b.n - a.n || (a.id < b.id ? -1 : 1); }).slice(0, MAX_LIT);
    ups.forEach(function (id) { if (all[id]) all[id].up = 1; });
    if (ready) { pushPts(); pushLines(); need(); }
  }
  function pushPts() {
    if (!ready || !gm) return;
    var sig = lit.map(function (b) { return b.id + ":" + b.lv; }).join("|");
    if (sig === sigP) return;   // the same bars and steps (every poll): nothing is sent, nothing is rebuilt
    sigP = sig; stats.ptSets++;
    try { gm.getSource(SRC_P).setData({ type: "FeatureCollection", features: lit.map(function (b) {
      return { type: "Feature", geometry: { type: "Point", coordinates: [b.lng, b.lat] }, properties: { id: b.id, lv: b.lv } }; }) }); } catch (e) { sigP = ""; }
  }
  function pushLines() {
    if (!ready || !gm) return;
    var sig = lit.map(function (b) { var c = cache[b.id]; return b.id + ":" + b.lv + ":" + (c ? c.v : "-"); }).join("|");
    if (sig === sigL) return;
    sigL = sig; stats.lineSets++;
    var feats = [], ids = {}, n = 0, spread = [], first = !booted && lit.some(function (b) { return cache[b.id] && cache[b.id].f.length; });
    lit.forEach(function (b, bi) {
      var c = cache[b.id]; if (!c) return;
      var R = REACH[b.lv], a = ids[b.id] = [];
      c.f.forEach(function (p) { if (p[0] >= R) return; var fid = bi * 100000 + a.length + 1; a.push(fid); n++;
        feats.push({ type: "Feature", id: fid, geometry: { type: "LineString", coordinates: p[1] }, properties: { d: p[0], lv: b.lv } }); });
      if (a.length && (first || b.up)) { spread.push(b.id); b.up = 0; }
    });
    featIds = ids; stats.pieces = n;
    stopSpread(); try { gm.removeFeatureState({ source: SRC_L }); } catch (e) {}
    if (first) { booted = true; bootAt = Date.now(); }
    if (spread.length && motionOK()) startSpread(spread);
    try { gm.getSource(SRC_L).setData({ type: "FeatureCollection", features: feats }); } catch (e) { sigL = ""; }
  }

  /* ---------- "the light spreads": k 0.02 → 1 in 1.7 s on feature-state (no new data); then nothing runs ---------- */
  function setK(ids, k) { for (var i = 0; i < ids.length; i++) { try { gm.setFeatureState({ source: SRC_L, id: ids[i] }, { k: k }); } catch (e) {} } }
  function startSpread(barIds) {
    var ids = []; barIds.forEach(function (id) { ids = ids.concat(featIds[id] || []); });
    if (!ids.length || !gm) return;
    stopSpread();
    anim = { ids: ids, t0: 0, bars: barIds.slice() }; stats.spreads++;
    setK(ids, 0.02);
    var tick = function (t) {
      if (!anim) return;
      if (!anim.t0) anim.t0 = t + 120;   // the new data needs a moment to reach the map
      var p = Math.max(0, Math.min(1, (t - anim.t0) / SPREAD_MS)), e = 1 - Math.pow(1 - p, 2.2);
      if (p >= 1 || D.hidden) { stopSpread(); return; }
      stats.frames++; setK(anim.ids, 0.02 + 0.98 * e);
      animRaf = W.requestAnimationFrame(tick);
    };
    animRaf = W.requestAnimationFrame(tick);
  }
  function stopSpread() {
    if (animRaf) W.cancelAnimationFrame(animRaf); animRaf = 0;
    if (anim && gm) { try { gm.removeFeatureState({ source: SRC_L }); } catch (e) {} }
    anim = null;
  }

  /* ---------- street pieces from the road tiles the map already has ---------- */
  function fragOf(m) { try { return m.style && m.style.getFragmentStyle ? m.style.getFragmentStyle("basemap") || null : null; } catch (e) { return null; } }
  // every road line near the bars that still need pieces: [{ c: [[lng, lat]…], z: tile zoom }], and the tiles they came from
  function roadLines(m, bars) {
    var out = { lines: [], tiles: [] }, hook = W.__PN_ROADS;   // (tests: a function that returns road lines [[ [lng, lat]… ]…])
    if (typeof hook === "function") { (hook(bars) || []).forEach(function (c) { out.lines.push({ c: c, z: 16 }); }); out.all = true; return out; }
    var fr = fragOf(m), st = fr || m.style, src = null, feats = [];
    try { var Ls = st && st._layers ? st._layers : {}; Object.keys(Ls).some(function (id) { var l = Ls[id]; if (l && l.type === "line" && l.sourceLayer === "road" && l.source) { src = l.source; return true; } return false; }); } catch (e) {}
    if (!src) return out;
    var filt = ["all", ["match", ["get", "class"], CLS, true, false], ["!=", ["get", "structure"], "tunnel"]];
    try { feats = (fr || m).querySourceFeatures(src, { sourceLayer: "road", filter: filt }) || []; } catch (e) { feats = []; }
    var seen = {}, tb = {}, pad = function (b) { var dy = 150 / 110540, dx = 150 / (111320 * Math.cos(b.lat * Math.PI / 180)); return [b.lng - dx, b.lat - dy, b.lng + dx, b.lat + dy]; };
    var boxes = bars.map(pad);
    for (var i = 0; i < feats.length; i++) {
      var f = feats[i], t = f.tile || { z: f._z, x: f._x, y: f._y }, tk = t.z + "/" + t.x + "/" + t.y, b = tb[tk];
      if (!b) { var n2 = Math.pow(2, t.z), la = function (y) { var q = Math.PI - 2 * Math.PI * y / n2; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(q) - Math.exp(-q))); };
        b = tb[tk] = [t.x / n2 * 360 - 180, la(t.y + 1), (t.x + 1) / n2 * 360 - 180, la(t.y)]; b.z = t.z; out.tiles.push(b);
        b.near = boxes.some(function (q) { return q[0] < b[2] && q[2] > b[0] && q[1] < b[3] && q[3] > b[1]; }); }
      if (!b.near) continue;   // a tile far from every bar: its geometry is never read
      var g = null; try { g = f.geometry; } catch (e) { g = null; } if (!g) continue;
      var ls = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
      for (var j = 0; j < ls.length; j++) { var l = ls[j]; if (!l || l.length < 2) continue;
        var k = tk + "|" + l.length + "|" + l[0][0] + "," + l[0][1] + "|" + l[l.length - 1][0] + "," + l[l.length - 1][1];   // the 3 source caches of one source give each line 3 times
        if (seen[k]) continue; seen[k] = 1; out.lines.push({ c: l, z: t.z }); }
    }
    return out;
  }
  function q6(v) { return Math.round(v * 1e6) / 1e6; }
  // the pieces of ONE bar: [[d, [[lng, lat]…]]…], d = metres from the door (4 m steps), up to the longest reach
  function pieces(lines, bar) {
    var kx = 111320 * Math.cos(bar.lat * Math.PI / 180), ky = 110540, X = function (p) { return (p[0] - bar.lng) * kx; }, Y = function (p) { return (p[1] - bar.lat) * ky; };
    var RM = REACH[3], near = [], door = [0, 0], bd = DOOR_M, out = [], len = 0, i, j;
    lines.forEach(function (ln) {
      var c = ln.c, hit = false, pts = [];
      for (i = 0; i < c.length; i++) { var x = X(c[i]), y = Y(c[i]); pts.push([x, y]); if (Math.abs(x) < RM + 60 && Math.abs(y) < RM + 60) hit = true; }
      if (hit) near.push({ c: c, p: pts });
    });
    near.forEach(function (ln) { for (i = 0; i < ln.p.length - 1; i++) {
      var a = ln.p[i], b = ln.p[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, (-a[0] * dx - a[1] * dy) / L2));
      var px = a[0] + dx * t, py = a[1] + dy * t, d = Math.sqrt(px * px + py * py); if (d < bd) { bd = d; door = [px, py]; } } });
    near.forEach(function (ln) {
      var cur = null, key = -1;
      var flush = function () { if (cur && cur.length > 1) out.push([key, cur]); cur = null; key = -1; };
      for (i = 0; i < ln.p.length - 1; i++) {
        var a = ln.p[i], b = ln.p[i + 1], ca = ln.c[i], cb = ln.c[i + 1], sl = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])), n = Math.max(1, Math.ceil(sl / PIECE_M));
        for (j = 0; j < n; j++) {
          var t0 = j / n, t1 = (j + 1) / n, tm = (t0 + t1) / 2, mx = a[0] + (b[0] - a[0]) * tm - door[0], my = a[1] + (b[1] - a[1]) * tm - door[1];
          var d = Math.sqrt(mx * mx + my * my), dk = d < RM ? Math.round(d / PIECE_M) * PIECE_M : -1;
          var p0 = [q6(ca[0] + (cb[0] - ca[0]) * t0), q6(ca[1] + (cb[1] - ca[1]) * t0)], p1 = [q6(ca[0] + (cb[0] - ca[0]) * t1), q6(ca[1] + (cb[1] - ca[1]) * t1)];
          if (dk !== key) { flush(); if (dk >= 0) { key = dk; cur = [p0, p1]; } } else if (cur) cur.push(p1);
          if (dk >= 0) len += sl / n;
        }
      }
      flush();
    });
    return { f: out, len: Math.round(len), door: bd < DOOR_M };
  }
  // is the whole reach of the bar inside the road tiles the map has now?
  function covered(bar, tiles) {
    var kx = 111320 * Math.cos(bar.lat * Math.PI / 180), ky = 110540, R = REACH[3], ok = true;
    for (var a = 0; a < 8 && ok; a++) { var x = bar.lng + R * Math.cos(a * Math.PI / 4) / kx, y = bar.lat + R * Math.sin(a * Math.PI / 4) / ky;
      ok = tiles.some(function (b) { return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; }); }
    return ok;
  }
  function pending() {
    var z = 0; try { z = gm.getZoom(); } catch (e) {}
    if (z < 12.9) return [];   // the road tiles of the town view have too few streets (and the light is a hair there)
    // no pieces yet · only a part of the reach was in the loaded tiles (try again after a move, at most 12 times) ·
    // made from coarse tiles and finer ones are here now (once)
    return lit.filter(function (b) { var c = cache[b.id]; return !c || (!c.full && (tries[b.id] || 0) < 12) || (c.z < 15 && z >= 14.9 && !c.hi); });
  }
  function need() {
    if (!ready || !gm || building || off()) return;
    if (!pending().length) return;
    W.clearTimeout(buildT);
    var go = function () { W.clearTimeout(buildT); buildT = W.setTimeout(function () { (W.requestIdleCallback || function (f) { return W.setTimeout(f, 30); })(build, { timeout: 1500 }); }, 60); };
    try { if (gm.loaded() && gm.areTilesLoaded() && !gm.isMoving()) go(); else { gm.once("idle", go); buildT = W.setTimeout(go, 2500); } } catch (e) { go(); }
  }
  function build() {
    if (!ready || !gm || building) return;
    var todo = pending(); if (!todo.length) return;
    building = true;
    try {
      var z = gm.getZoom(), t0 = W.performance.now(), rd = roadLines(gm, todo); stats.roadMs = +(W.performance.now() - t0).toFixed(1); stats.roads = rd.lines.length;
      var tz = rd.lines.reduce(function (a, l) { return Math.max(a, l.z); }, 0), t1 = W.performance.now();
      todo.forEach(function (b) {
        var p = pieces(rd.lines, b), old = cache[b.id], full = !!rd.all || covered(b, rd.tiles);
        tries[b.id] = (tries[b.id] || 0) + 1;
        var better = !old || (full && !old.full) || (full === old.full && (tz > old.z ? p.len >= old.len * 0.8 : p.len > old.len));
        if (!better) { if (z >= 14.9) old.hi = 1; return; }   // the best result so far stays
        cache[b.id] = { f: p.f, len: p.len, full: full, z: tz, v: (old ? old.v : 0) + 1, door: p.door, hi: z >= 14.9 ? 1 : 0 };
        if (!p.f.length) stats.noRoads++;
      });
      stats.builds++; stats.buildMs = +(W.performance.now() - t1).toFixed(1);
    } catch (e) { try { console.warn("pn barlight roads", e && e.message); } catch (x) {} }
    building = false;
    pushLines();
  }

  /* ---------- E: one ring on a check-in ---------- */
  function rings(b, cis, now) {
    cis.forEach(function (c) {
      if (!c) return;
      var k = b.id + "|" + (c.is_mine ? "me" : (c.name || "") + "|" + (c.created_at || "")); if (ciSeen[k]) return;
      ciSeen[k] = 1;
      if (ciFirst) return;   // what was there when the map opened is not "a check-in arrives"
      var at = c.created_at ? Date.parse(c.created_at) : now; if (!(now - at < RING_NEW)) return;   // old news (zoomed in later, came back to the tab)
      if (!(b.lv > 0 || c.is_mine || c.is_friend)) return;   // a stranger at a bar with under 3 people: no ring (never point at one person)
      if (now - (ringAt[b.id] || 0) < RING_GAP) return;
      ringAt[b.id] = now; ring(b);
    });
  }
  function ring(b) {
    if (!map || !W.L || !motionOK()) return false;
    try {
      if (!pane) { pane = map.getPane("barlight") || map.createPane("barlight"); pane.style.zIndex = 585; pane.style.pointerEvents = "none"; }
      var mk = W.L.marker([b.lat, b.lng], { pane: "barlight", interactive: false, keyboard: false, bubblingMouseEvents: false,
        icon: W.L.divIcon({ className: "bl-ring", html: "<i></i><i></i>", iconSize: [0, 0], iconAnchor: [0, 0] }) }).addTo(map);
      stats.rings++; stats.lastRing = b.id;
      W.setTimeout(function () { try { map.removeLayer(mk); } catch (e) {} }, RING_MS + 150);
      return true;
    } catch (e) { return false; }
  }

  W.BARLIGHT = {
    attach: function (o) {
      if (map || !o || !o.map) return; map = o.map;
      try { map.on("moveend", function () { if (ready) need(); }); } catch (e) {}
    },
    on: function () { return !off(); },
    step: step,
    set: set,
    ensure: ensure,
    // glmap.js: the crowd step / the people count of a bar (0 = no lantern)
    lvOf: function (id) { var b = all[String(id)]; return b && !off() ? b.lv : 0; },
    nOf: function (id) { var b = all[String(id)]; return b ? b.n : 0; },
    layers: function () { return [L_GLOW, L_CORE, L_HA, L_HB]; },
    stats: stats,
    _ring: ring,
    _state: function () {
      return { on: !off(), ready: ready, lit: lit.map(function (b) { return { id: b.id, n: b.n, lv: b.lv }; }), pieces: Object.keys(featIds).reduce(function (o, id) { o[id] = featIds[id].length; return o; }, {}),
        cache: Object.keys(cache).reduce(function (o, id) { var c = cache[id]; o[id] = { n: c.f.length, len: c.len, full: c.full, z: c.z, door: c.door }; return o; }, {}), anim: !!anim, motion: motionOK(), booted: booted };
    },
    _pieces: pieces, _reset: function () { offV = null; },
    // tests / pictures: hold the spread at k (0..1) on every piece; null = the still light again
    _k: function (k) { if (!gm) return; if (k == null) { try { gm.removeFeatureState({ source: SRC_L }); } catch (e) {} return; }
      var ids = []; Object.keys(featIds).forEach(function (id) { ids = ids.concat(featIds[id]); }); setK(ids, k); }
  };
})();
