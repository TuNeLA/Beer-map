/* Öl Nu — 🗺️ GLBARS: bar markers, heat and clouds drawn INSIDE the Mapbox GL map (CONTRACT "KARTSTIL 5 · GL-markörer").
   window.GLBARS. No mods hooks, no RPC, no new button. app.js calls GLBARS.attach() once, GLBARS.sync() after every tier pass
   (tiersNow: render, renderPlainBars, moveend, popupopen / popupclose) and GLBARS.heat() from renderHeat(); clouds.js calls
   GLBARS.clouds() from its redraw. Owner speed data: zoom was the #1 hang (hundreds of DOM markers + a heat canvas redrawn
   every zoom frame). In GL they move with the map in the same frame (zoom, pan, pinch), with no per-frame JS.
   - ON only while the Mapbox map is the base map and its style has loaded. Off (the silent raster fallback) = everything
     as before: Leaflet DOM markers, leaflet.heat canvas, the clouds canvas.
   - Model stays in app.js: the Leaflet bar markers (hotbars / bars panes) are still made, keep their popup, ids, olnuC
     composite and TIERS classes, but their panes are display:none (html[data-glbars]). This module mirrors them:
     each marker's icon HTML is parsed once (cached) into a state (type glyph, hot / lit ring, people pill with level /
     friend / me, crowd word, 🚶, 🏰 label, 👑, 🪖 n, 🚪 n, 📅 badge, price tag, name) and drawn on a canvas as ONE image
     per state (pixel ratio 2, cached by key, unused ones pruned). TIERS decides dot / full as before (tiers.js unchanged).
   - Layers (one GeoJSON source per kind, all above the Mapbox labels, under every remaining DOM marker):
       olnu-clouds (circle, blur 1, metres by zoom like clouds.js, alpha = age fade over 3 days) <
       olnu-heat (heatmap: radius = 10–500 m by zoom with the 40–46 px far-out floor, per-view colour scale like leaflet.heat) <
       olnu-bar-dot (dots; zoom rules of tiers.js: none < z12.5, empty ones from z14) <
       olnu-bar-lbl (name text of full pills; GL collision hides a label that would touch a pill or a higher label) <
       olnu-bar-full (full pills, highest priority on top; the selected bar 1.25× and on top).
   - Tap: Leaflet "preclick" (the DOM markers still above, e.g. people pins, take their own taps first) → queryRenderedFeatures
     (full: its box, dot: 44 × 44 px) → a click on the matching part of that bar's hidden marker (pill → 🍺 Folk här fold,
     🪖 → call-outs, 🚪 → check-ins, 👑 → stammis) = the normal bar sheet. map3d.js skips a tap that was used here.
   - Still DOM (drawn over the GL map, unchanged): people pins + clusters, 📍 mypins, 🏟️ arena chips, 🍽️ restaurant dots,
     📨 invite chips, me-dot, demo town pills. Static in GL: pill glow pulses, the 🪖 pulse (battery; ≤ 2 Hz rule kept). */
(function () {
  "use strict";
  var A = null, map = null, on = false, gm = null, hooked = null, layersReady = false;
  var SRC_B = "olnu-bars", SRC_H = "olnu-heat", SRC_C = "olnu-clouds";
  var L_DOT = "olnu-bar-dot", L_LBL = "olnu-bar-lbl", L_BLK = "olnu-bar-blk", L_FULL = "olnu-bar-full", L_HEAT = "olnu-heat", L_CLOUD = "olnu-clouds";
  var R = 2, FONT = '"Chakra Petch", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  var EMPTY = { type: "FeatureCollection", features: [] };
  var stats = { syncs: 0, ms: 0, last: 0, feats: 0, imgs: 0, made: 0, taps: 0, heatPts: 0, cloudPts: 0 };

  function bm() { return window.BASEMAP; }
  function glm() { try { var b = bm(); return b && b.isMapbox() && b.mapbox() ? b.mapbox().getMapboxMap() : null; } catch (e) { return null; } }

  /* ---------- marker HTML → state (cached) ---------- */
  var box = document.createElement("div"), stCache = new Map();
  function txt(el) { return el ? String(el.textContent || "").replace(/\s+/g, " ").trim() : ""; }
  function parse(html, cls) {
    var k = cls + "|" + html, s = stCache.get(k); if (s) return s;
    box.innerHTML = html;
    var q = function (sel) { return box.querySelector(sel); };
    var ico = q(".bar-ico"), pill = q(".pill"), m = ico && /ic-t-([\w-]+)/.exec(ico.className);
    s = { k: m ? m[1] : "pub", hot: /\bcm-hot\b/.test(cls), lit: /\bcm-lit\b/.test(cls), name: txt(q(".cm-lbl")).slice(0, 40) };
    if (pill) {
      var pc = pill.className;
      s.p = { l: /\bp2\b/.test(pc) ? 2 : /\bp1\b/.test(pc) ? 1 : 0, f: /\bpf\b/.test(pc), m: /\bpm\b/.test(pc), a: /\bpa\b/.test(pc),
        n: txt(pill.querySelector(".pn")), e: !!pill.querySelector(".pe"), o: txt(pill.querySelector(".po")) };
      var cr = pill.querySelector(".bm-crowd"); if (cr) s.cw = [txt(cr), (/\bc(\d)\b/.exec(cr.className) || [0, 2])[1]];
      if (pill.querySelector(".bm-q")) s.q = 1;
      var fl = pill.querySelector(".bm-flag"); if (fl) s.fl = [txt(fl), /\bmine\b/.test(fl.className) ? 1 : 0];
    }
    if (q(".cm-king")) s.king = 1;
    var cf = q(".cm-flag"); if (cf) s.cf = /\bmine\b/.test(cf.className) ? 2 : 1;
    var rl = q(".cm-rally"); if (rl) s.rl = [txt(rl.querySelector("b")), /\bme\b/.test(rl.className) ? 1 : 0];
    var ci = q(".cm-ci"); if (ci) s.ci = txt(ci.querySelector("b"));
    var ev = q(".bi-ev"); if (ev) s.ev = txt(ev).slice(0, 4);
    var tg = q(".bi-tag"); if (tg) s.tg = txt(tg).slice(0, 12);
    box.innerHTML = "";
    if (stCache.size > 3000) stCache.clear();
    stCache.set(k, s);
    return s;
  }

  /* ---------- drawing (canvas, CSS px around the bar point) ---------- */
  var glyphs = {};
  function glyph(k) {
    if (glyphs[k]) return glyphs[k];
    var ty = window.ICONS && window.ICONS.type ? window.ICONS.type(k) : { g: "beer-stein", c: "#E58A00" };
    var raw = (window.ICONS && window.ICONS._glyphs && window.ICONS._glyphs[ty.g + "-f"]) || "", ps = [], re = /\sd="([^"]+)"/g, mm;
    while ((mm = re.exec(raw))) { try { ps.push(new Path2D(mm[1])); } catch (e) {} }
    return (glyphs[k] = { c: ty.c, p: ps });
  }
  var mc = document.createElement("canvas").getContext("2d");
  function tw(s, font) { mc.font = font; return mc.measureText(s).width; }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function chip(ops, parts, sel, cx, cy, text, o) {   // small dark chip with emoji + number (🪖 3, 🚪 2)
    var f = "700 12px " + FONT, w = Math.ceil(tw(text, f)) + 10, h = 18, x = cx - w / 2, y = cy - h / 2;
    if (o && o.right) x = o.right - w;
    var bb = [x, y, x + w, y + h];
    ops.push({ bb: bb, fn: function (g) {
      rr(g, x, y, w, h, 9); g.fillStyle = "rgba(10,15,28,.92)"; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = o && o.col || "rgba(255,255,255,.55)"; g.stroke();
      g.font = f; g.fillStyle = "#fff"; g.textBaseline = "middle"; g.textAlign = "center"; g.fillText(text, x + w / 2, y + h / 2 + 0.5);
    } });
    if (sel) parts.push({ sel: sel, bb: bb });
  }
  function emoji(ops, parts, sel, cx, cy, e, size) {
    var bb = [cx - size / 2 - 1, cy - size / 2 - 1, cx + size / 2 + 1, cy + size / 2 + 1];
    ops.push({ bb: bb, fn: function (g) {
      g.font = size + "px " + FONT; g.textAlign = "center"; g.textBaseline = "middle";
      g.shadowColor = "rgba(0,0,0,.9)"; g.shadowBlur = 2; g.shadowOffsetY = 1; g.fillText(e, cx, cy); g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
    } });
    if (sel) parts.push({ sel: sel, bb: bb });
  }
  // mode: "d" dot · "f" full · "x" full in the town view (z < 12.5: no disc, like .olnu-zxlo)
  function build(s, mode, hi) {
    var ops = [], parts = [], full = mode !== "d", D = full ? (hi ? 32 : 24) : (hi ? 28 : 19.2), gs = full ? (hi ? 18 : 14) : (hi ? 15.75 : 11.2);
    if (mode !== "x") {
      var gl = glyph(s.k), ring = s.hot ? "#ffc24d" : s.lit ? "#3ddc84" : null, rad = D / 2;
      ops.push({ bb: [-rad - 3, -rad - 3, rad + 3, rad + 4], fn: function (g) {
        g.beginPath(); g.arc(0, 1, rad + (ring ? 2.5 : 1), 0, 6.2832); g.fillStyle = "rgba(0,0,0,.45)"; g.fill();
        if (ring) { g.beginPath(); g.arc(0, 0, rad + 2, 0, 6.2832); g.fillStyle = ring; g.fill(); }
        g.beginPath(); g.arc(0, 0, rad, 0, 6.2832); g.fillStyle = "#fff"; g.fill();
        g.beginPath(); g.arc(0, 0, rad - (full ? 2 : 1.6), 0, 6.2832); g.fillStyle = gl.c; g.fill();
        g.save(); g.translate(-gs / 2, -gs / 2); g.scale(gs / 256, gs / 256); g.fillStyle = "#fff"; gl.p.forEach(function (p) { g.fill(p); }); g.restore();
      } });
      parts.push({ sel: ".bar-ico", bb: [-rad, -rad, rad, rad] });
    }
    if (full) {
      if (s.p) {
        var p = s.p, py = hi ? 30 : 23, fB = "700 13px " + FONT, segs = [];
        if (p.n && p.n !== "0") { segs.push([p.n, p.m ? "#ffe08a" : "#ffc24d"]); if (p.e) segs.push([" 🍺", "#fff"]); if (p.o) segs.push([" " + p.o, "#d9b8ff"]); }
        else if (p.o) segs.push([p.o.replace(/^·\s*/, ""), "#d9b8ff"]);
        else segs.push([p.n || "0", "#ffc24d"]);
        var tws = segs.map(function (x) { return tw(x[0], fB); }), tot = tws.reduce(function (a, b) { return a + b; }, 0);
        var pw = Math.ceil(tot) + 16, ph = 24, px = -pw / 2, top = py - ph / 2;
        ops.push({ bb: [px - 4, top - 4, px + pw + 4, top + ph + 6], fn: function (g) {
          rr(g, px, top, pw, ph, 12);
          g.fillStyle = p.m ? "rgba(58,38,0,.95)" : "rgba(24,18,6,.95)";
          if (p.l === 1) { g.shadowColor = "rgba(255,122,26,.85)"; g.shadowBlur = 8; }
          else if (p.l === 2) { g.shadowColor = "rgba(255,59,59,.8)"; g.shadowBlur = 10; }
          else { g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 5; g.shadowOffsetY = 2; }
          g.fill(); g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
          if (p.l === 2) { rr(g, px - 2, top - 2, pw + 4, ph + 4, 14); g.lineWidth = 2; g.strokeStyle = "#fff"; g.stroke(); }
          rr(g, px, top, pw, ph, 12); g.lineWidth = p.l === 2 ? 2 : 1.5; g.strokeStyle = p.l === 2 ? "#ff3b3b" : p.l === 1 ? "#ff7a1a" : "#f5a623";
          if (p.a) g.setLineDash([3, 2]); g.stroke(); g.setLineDash([]);
          if (p.f) { rr(g, px + 1.5, top + 1.5, pw - 3, ph - 3, 10.5); g.lineWidth = 2; g.strokeStyle = "#3ddc84"; g.stroke(); }
          g.font = fB; g.textBaseline = "middle"; g.textAlign = "left";
          var x = px + 8; segs.forEach(function (sg, i) { g.fillStyle = sg[1]; g.fillText(sg[0], x, py + 0.5); x += tws[i]; });
          if (p.f) { g.beginPath(); g.arc(px + pw - 1, top + 1, 4, 0, 6.2832); g.fillStyle = "#3ddc84"; g.fill(); g.lineWidth = 1.5; g.strokeStyle = "#0a0f1c"; g.stroke(); }
        } });
        parts.push({ sel: ".pill", bb: [px, top, px + pw, top + ph] });
        if (s.cw) {
          var fC = "700 12px " + FONT, cw = tw(s.cw[0], fC), cx0 = px + pw + 4, col = s.cw[1] === "1" ? "#8fd19e" : s.cw[1] === "3" ? "#ff6b5b" : "#ffc24d";
          ops.push({ bb: [cx0 - 1, py - 10, cx0 + cw + 11, py + 10], fn: function (g) {
            rr(g, cx0, py - 9, cw + 10, 18, 4); g.fillStyle = "rgba(10,15,28,.88)"; g.fill(); g.lineWidth = 1; g.strokeStyle = col; g.stroke();
            g.font = fC; g.textBaseline = "middle"; g.textAlign = "left"; g.fillStyle = col; g.fillText(s.cw[0], cx0 + 5, py + 0.5);
          } });
        }
        if (s.q) emoji(ops, parts, ".pill", px + pw + 2, top - 4, "🚶", 12);
        if (s.fl) chip(ops, parts, ".pill", 0, py, s.fl[0], { right: px - 4, col: s.fl[1] ? "#3ddc84" : "#f5a623" });
      }
      if (mode !== "x") {
        var r2 = D / 2;
        if (s.king) emoji(ops, parts, ".cm-king", -r2 + 1, -r2 - 2, "👑", hi ? 14 : 13);
        if (s.ev) emoji(ops, parts, null, -r2 - 1, -r2 + 4, s.ev, hi ? 13 : 11);
        if (s.cf) chip(ops, parts, ".cm-flag", r2 + 12, hi ? -2 : 4, "🏰", { col: s.cf === 2 ? "#3ddc84" : null });
        if (s.ci) chip(ops, parts, ".cm-ci", 0, 0, "🚪" + s.ci, { right: -r2 - 4 });
        if (s.tg) {
          var fT = "700 10px " + FONT, tgw = Math.ceil(tw(s.tg, fT)) + 8, tx = -r2 + D * 0.62, ty = -r2 - 9;
          ops.push({ bb: [tx, ty, tx + tgw, ty + 14], fn: function (g) {
            rr(g, tx, ty, tgw, 14, 7); g.fillStyle = "#f5a623"; g.fill(); g.font = fT; g.fillStyle = "#241300"; g.textBaseline = "middle"; g.textAlign = "left"; g.fillText(s.tg, tx + 4, ty + 7.5);
          } });
        }
      }
      if (s.rl) chip(ops, parts, ".cm-rally", (mode === "x" ? 0 : D / 2) + 14, mode === "x" ? 0 : -D / 2, "🪖" + s.rl[0], { col: s.rl[1] ? "#3ddc84" : "#ff7a1a" });
    }
    var b = [1e9, 1e9, -1e9, -1e9];
    ops.forEach(function (o) { b[0] = Math.min(b[0], o.bb[0]); b[1] = Math.min(b[1], o.bb[1]); b[2] = Math.max(b[2], o.bb[2]); b[3] = Math.max(b[3], o.bb[3]); });
    if (!ops.length) b = [-1, -1, 1, 1];
    var ox = Math.ceil(-b[0]) + 1, oy = Math.ceil(-b[1]) + 1, W = Math.ceil(b[2]) + ox + 1, H = Math.ceil(b[3]) + oy + 1;
    var cv = document.createElement("canvas"); cv.width = W * R; cv.height = H * R;
    var g = cv.getContext("2d"); g.scale(R, R); g.translate(ox, oy);
    ops.forEach(function (o) { g.save(); o.fn(g); g.restore(); });
    stats.made++;
    return { data: g.getImageData(0, 0, W * R, H * R), ox: ox, oy: oy, bottom: b[3], parts: parts };
  }
  // the name under a full pill (GL text needs glyphs the Standard root style does not have: drawn as an image, same font as before)
  function buildLabel(name, hi) {
    var f = "600 13px " + FONT, t = name, w = tw(t, f);
    while (w > 140 && t.length > 3) { t = t.slice(0, -2).replace(/\s+$/, "") + "…"; w = tw(t, f); }
    var W = Math.ceil(w) + 6, Hh = 18, cv = document.createElement("canvas"); cv.width = W * R; cv.height = Hh * R;
    var g = cv.getContext("2d"); g.scale(R, R); g.font = f; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineJoin = "round"; g.lineWidth = 3.2; g.strokeStyle = "rgba(0,0,0,.88)"; g.strokeText(t, W / 2, Hh / 2 + 0.5);
    g.fillStyle = "#f3f0e8"; g.fillText(t, W / 2, Hh / 2 + 0.5);
    stats.made++;
    return { data: g.getImageData(0, 0, W * R, Hh * R) };
  }
  function label(m, name) {
    var k = keyOf(name, "l", 0), im = imgs[k];
    if (!im) { im = imgs[k] = buildLabel(name); im.k = k; }
    if (!m.hasImage(k)) m.addImage(k, im.data, { pixelRatio: R });
    return im;
  }
  // GeoJSON properties cannot carry arrays into the GL tiles (they arrive as strings): icon offsets are an index into a
  // small table that the layers read through a "match" expression (re-set only when a new offset shows up).
  var offs = [], offIx = {}, offsDirty = false;
  function offIndex(x, y) {
    var k = x + "," + y; if (offIx[k] != null) return offIx[k];
    offIx[k] = offs.length; offs.push([x, y]); offsDirty = true; return offIx[k];
  }
  function offExpr() {
    var e = ["match", ["get", "oi"]];
    offs.forEach(function (o, i) { e.push(i, ["literal", o]); });
    e.push(["literal", [0, 0]]);
    return offs.length ? e : ["literal", [0, 0]];
  }
  var imgs = {}, IMG_MAX = 700;
  function keyOf(s, mode, hi) {
    var str = JSON.stringify(s) + mode + (hi ? 1 : 0), h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return "gb" + (h >>> 0).toString(36) + str.length.toString(36);
  }
  function image(m, s, mode, hi) {
    var k = keyOf(s, mode, hi), im = imgs[k];
    if (!im) { im = imgs[k] = build(s, mode, hi); im.k = k; }
    if (!m.hasImage(k)) m.addImage(k, im.data, { pixelRatio: R });
    return im;
  }

  /* ---------- layers ---------- */
  // leaflet.heat gradient, shifted down: one lone point (weight ≥ 0.42 × intensity × the 0.4 kernel peak ≈ 0.2) = amber, as before
  var HEAT_COL = ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(90,35,0,0)", 0.02, "rgba(90,35,0,0)", 0.08, "rgba(194,101,10,0.5)",
    0.2, "rgba(245,166,35,0.78)", 0.4, "rgba(255,122,26,0.88)", 0.68, "rgba(255,59,59,0.93)", 1, "rgba(255,246,224,0.95)"];
  function ensure(m) {
    if (!m || !m.style || !m.style._loaded) return false;
    try {
      [SRC_C, SRC_H, SRC_B].forEach(function (id) { if (!m.getSource(id)) m.addSource(id, { type: "geojson", data: EMPTY, buffer: 64, tolerance: 0, maxzoom: 20 }); });
      if (!m.getLayer(L_CLOUD)) m.addLayer({ id: L_CLOUD, type: "circle", source: SRC_C,
        paint: { "circle-color": "#c8d4ea", "circle-blur": 1, "circle-opacity": ["*", 0.62, ["get", "a"]], "circle-radius": 9, "circle-pitch-alignment": "map",
          "circle-emissive-strength": 1 } });
      if (!m.getLayer(L_HEAT)) m.addLayer({ id: L_HEAT, type: "heatmap", source: SRC_H,
        paint: { "heatmap-color": HEAT_COL, "heatmap-radius": 40, "heatmap-intensity": 1.25, "heatmap-weight": 1,
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 12, 1, 14, 0.6] } });
      var common = { "icon-image": ["get", "img"], "icon-anchor": "top-left", "icon-offset": offExpr(), "icon-size": ["get", "sz"],
        "icon-allow-overlap": true, "icon-padding": 0, "symbol-sort-key": ["get", "sk"], "symbol-z-order": "auto",
        "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" };
      if (!m.getLayer(L_DOT)) m.addLayer({ id: L_DOT, type: "symbol", source: SRC_B, filter: ["==", ["get", "t"], 0],
        layout: Object.assign({ "icon-ignore-placement": true }, common),
        // tiers.js zoom rules (Leaflet zoom = GL zoom + 1): no dots under z12.5, empty ones from z14 (0.82)
        paint: { "icon-opacity": ["step", ["zoom"], 0, 11.5, ["case", ["==", ["get", "e"], 1], 0, 1], 13, ["case", ["==", ["get", "e"], 1], 0.82, 1]], "icon-emissive-strength": 1 } });
      // names: placed after the full pills (layer above = placed first), so a name that would touch a pill or a
      // higher-priority name is left out (the old placeLabels rule); dots never block a name (they ignore placement)
      if (!m.getLayer(L_LBL)) m.addLayer({ id: L_LBL, type: "symbol", source: SRC_B, filter: ["all", ["==", ["get", "t"], 1], ["!=", ["get", "li"], ""]],
        layout: { "icon-image": ["get", "li"], "icon-anchor": "top", "icon-offset": JSON.parse(JSON.stringify(offExpr()).replace('["get","oi"]', '["get","lo"]')), "icon-allow-overlap": false, "icon-ignore-placement": false,
          "icon-padding": 1, "symbol-sort-key": ["-", 0, ["get", "sk"]], "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" },
        paint: { "icon-emissive-strength": 1 } });
      // the tiers.js full-pill box (disc + pill, 56 × 58 px around the point) as an invisible collision blocker: a name may
      // not touch another bar's pill (its own name sits under its own pill, outside the box)
      if (!m.hasImage("olnu-blk")) m.addImage("olnu-blk", { width: 56, height: 58, data: new Uint8Array(56 * 58 * 4) });
      if (!m.getLayer(L_BLK)) m.addLayer({ id: L_BLK, type: "symbol", source: SRC_B, filter: ["==", ["get", "t"], 1],
        layout: { "icon-image": "olnu-blk", "icon-anchor": "top", "icon-offset": [0, -24], "icon-allow-overlap": true, "icon-ignore-placement": false, "icon-padding": 0 },
        paint: { "icon-opacity": 0 } });
      if (!m.getLayer(L_FULL)) m.addLayer({ id: L_FULL, type: "symbol", source: SRC_B, filter: ["==", ["get", "t"], 1],
        layout: Object.assign({ "icon-ignore-placement": true }, common), paint: { "icon-emissive-strength": 1 } });
      return true;
    } catch (e) { try { console.warn("olnu glmap", e && e.message); } catch (x) {} return false; }
  }

  /* ---------- bars ---------- */
  var byId = {}, lastSig = "", parts = {};
  function sync() {
    if (!on || !A) return;
    var m = gm; if (!m || !layersReady) return;
    var t0 = performance.now(), z = map.getZoom(), hi = z >= 16, xlo = z < 12.5, feats = [], used = {}, n = 0;
    byId = {}; parts = {};
    (A.layers || []).forEach(function (ly) {
      if (!ly || !ly.eachLayer) return;
      ly.eachLayer(function (mk) {
        var c = mk.options && mk.options.olnuC, io = mk.options && mk.options.icon && mk.options.icon.options; if (!c || !c.bar || !io) return;
        var ic = mk.getElement && mk.getElement(), s = parse(io.html || "", io.className || ""), full = mk._olnuTier === "f";
        var sel = !!(ic && ic.classList.contains("cm-sel"));
        var mode = full ? (xlo ? "x" : "f") : "d", im = image(m, s, mode, hi);
        used[im.k] = 1;
        var empty = !((c.beers && c.beers.length) || (c.rallies && c.rallies.length) || (c.cis && c.cis.length));
        var prio = (mk.options.olnuPrio || 0) + (full ? 10000 : 0) + (sel ? 1e6 : 0);
        var lblTop = Math.max(s.p ? (hi ? 43 : 36) : (hi ? 19 : 14), Math.ceil(im.bottom) + 1, 35);
        var id = String(c.bar.id);
        byId[id] = mk; parts[id] = { im: im, sz: sel ? 1.25 : 1 };
        feats.push({ type: "Feature", id: ++n, geometry: { type: "Point", coordinates: [+c.bar.lng, +c.bar.lat] },
          properties: { id: id, t: full ? 1 : 0, img: im.k, oi: offIndex(-im.ox, -im.oy), sz: sel ? 1.25 : 1, e: empty ? 1 : 0, sk: prio,
            li: full && s.name ? label(m, s.name).k : "", lo: offIndex(0, lblTop) } });
        if (full && s.name) used[feats[feats.length - 1].properties.li] = 1;
      });
    });
    if (offsDirty) {   // a new offset: the layers' offset tables first (the label layer reads its own row "lo")
      offsDirty = false; lastSig = "";
      try { var oe = offExpr(); m.setLayoutProperty(L_DOT, "icon-offset", oe); m.setLayoutProperty(L_FULL, "icon-offset", oe);
        m.setLayoutProperty(L_LBL, "icon-offset", JSON.parse(JSON.stringify(oe).replace('["get","oi"]', '["get","lo"]'))); } catch (e) {}
    }
    var sig = feats.map(function (f) { var p = f.properties; return p.id + p.img + p.t + p.sz + p.e + p.li + p.lo; }).join("|");
    if (sig !== lastSig) { lastSig = sig; try { m.getSource(SRC_B).setData({ type: "FeatureCollection", features: feats }); } catch (e) {} }
    var keys = Object.keys(imgs);
    if (keys.length > IMG_MAX) keys.forEach(function (k) { if (!used[k]) { try { if (m.hasImage(k)) m.removeImage(k); } catch (e) {} delete imgs[k]; } });
    var ms = performance.now() - t0;
    stats.syncs++; stats.ms += ms; stats.last = ms; stats.feats = feats.length; stats.imgs = Object.keys(imgs).length;
  }

  /* ---------- heat ---------- */
  var heatPts = null, heatSig = "", heatLat = null, heatPaintKey = "", rawPeak = 0;
  function mpp(zl, lat) { return 156543.03 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zl); }
  function heatPaint() {
    var m = gm; if (!on || !m || !layersReady || !A) return;
    var z = map.getZoom(), lat = map.getCenter().lat, size = map.getSize(), pts = heatPts || [];
    // the view's hottest cell (same grid idea as app.js leaflet.heat _peakFor): colour scale + far-out floor
    var Rpx = A.heatRadiusPx ? A.heatRadiusPx(z, lat, rawPeak) : 40, gsz = Math.max(2, Rpx / 2), cells = {}, peak = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = map.latLngToContainerPoint([pts[i][0], pts[i][1]]);
      if (p.x < -Rpx || p.y < -Rpx || p.x > size.x + Rpx || p.y > size.y + Rpx) continue;
      var k = Math.floor(p.x / gsz) + "_" + Math.floor(p.y / gsz);
      cells[k] = (cells[k] || 0) + (+pts[i][2] || 1); if (cells[k] > peak) peak = cells[k];
    }
    rawPeak = peak;
    var P = Math.max(4, peak), floor = Math.min(46, 40 + 2 * Math.sqrt(peak));
    var key = Math.round(P * 10) + "|" + Math.round(floor) + "|" + Math.round(lat * 4);
    if (key === heatPaintKey) return;
    heatPaintKey = key;
    var stops = [];
    for (var zl = 3; zl <= 21.01; zl += 0.5) {
      var meters = A.heatMeters ? A.heatMeters(zl) : 170;
      stops.push(zl - 1, +Math.max(floor, meters / mpp(zl, lat)).toFixed(2));
    }
    var W = function (g) { return ["max", 0.42, ["min", 1, ["/", ["^", ["/", ["get", "w"], P], g], 0.6]]]; };   // 0.42 = leaflet.heat minOpacity
    try {
      m.setPaintProperty(L_HEAT, "heatmap-radius", ["interpolate", ["exponential", 2], ["zoom"]].concat(stops));
      m.setPaintProperty(L_HEAT, "heatmap-weight", ["interpolate", ["linear"], ["zoom"], 10, W(0.5), 13, W(1)]);
    } catch (e) {}
  }
  function heatData() {
    var m = gm; if (!on || !m || !layersReady) return;
    var pts = heatPts || [], sig = pts.length + ":" + (pts.length ? pts[0].join(",") + pts[pts.length - 1].join(",") : "");
    var feats = pts.map(function (p) { return { type: "Feature", geometry: { type: "Point", coordinates: [+p[1], +p[0]] }, properties: { w: +p[2] || 1 } }; });
    stats.heatPts = feats.length;
    try { m.getSource(SRC_H).setData({ type: "FeatureCollection", features: feats }); heatSig = sig; } catch (e) {}
    heatPaintKey = ""; heatPaint();
  }

  /* ---------- clouds ---------- */
  var cloudPts = null, cloudLat = null;
  function cloudPaint() {
    var m = gm; if (!on || !m || !layersReady) return;
    var lat = map.getCenter().lat; if (cloudLat != null && Math.abs(lat - cloudLat) < 0.25) return;
    cloudLat = lat;
    var C = window.CLOUDS || {}, MM = C.M_MAX || 300, Mm = C.M_MIN || 10, Rm = C.R_MIN || 9, stops = [];
    for (var zl = 3; zl <= 21.01; zl += 0.5) {
      var base = MM * Math.pow(2, -0.72 * Math.max(0, zl - 12)), mp = mpp(zl, lat);
      stops.push(zl - 1, ["max", Rm, ["/", ["max", Mm, ["min", MM, ["*", base, ["get", "s"]]]], mp]]);
    }
    try { m.setPaintProperty(L_CLOUD, "circle-radius", ["interpolate", ["exponential", 2], ["zoom"]].concat(stops)); } catch (e) {}
  }
  function cloudData() {
    var m = gm; if (!on || !m || !layersReady) return;
    var pts = cloudPts || [];
    stats.cloudPts = pts.length;
    var feats = pts.map(function (p) { var w = +p.w || 1; return { type: "Feature", geometry: { type: "Point", coordinates: [+p.lng, +p.lat] },
      properties: { s: Math.max(0.55, Math.min(1, 0.55 + 0.15 * Math.sqrt(w))), a: +p.a || 0.6 } }; });
    try { m.getSource(SRC_C).setData({ type: "FeatureCollection", features: feats }); } catch (e) {}
    cloudLat = null; cloudPaint();
  }

  /* ---------- tap ---------- */
  var synth = false;
  function onPreclick(e) {
    if (!on || synth || !gm || !layersReady || !e || !e.latlng) return;
    var m = gm, z = map.getZoom();
    try {
      var p = m.project([e.latlng.lng, e.latlng.lat]), hit = null;
      var fs = m.queryRenderedFeatures([[p.x - 3, p.y - 3], [p.x + 3, p.y + 3]], { layers: [L_FULL] });
      fs.forEach(function (f) { if (!hit || f.properties.sk > hit.properties.sk) hit = f; });
      if (!hit && z >= 12.5) {
        var best = 1e9;
        m.queryRenderedFeatures([[p.x - 22, p.y - 22], [p.x + 22, p.y + 22]], { layers: [L_DOT] }).forEach(function (f) {
          if (z < 14 && f.properties.e === 1) return;   // hidden by the zoom rule
          var q = m.project(f.geometry.coordinates), d = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
          if (d < best) { best = d; hit = f; }
        });
      }
      if (!hit) return;
      var id = String(hit.properties.id), mk = byId[id], el = mk && mk.getElement && mk.getElement(); if (!el) return;
      // which part was tapped (same folds as a tap on the DOM marker)
      var bp = m.project([mk.getLatLng().lng, mk.getLatLng().lat]), pi = parts[id], dx = (p.x - bp.x) / (pi ? pi.sz : 1), dy = (p.y - bp.y) / (pi ? pi.sz : 1), sel = ".bar-ico";
      if (hit.properties.t === 1 && pi) pi.im.parts.forEach(function (x) { if (dx >= x.bb[0] - 2 && dx <= x.bb[2] + 2 && dy >= x.bb[1] - 2 && dy <= x.bb[3] + 2 && x.sel !== ".bar-ico") sel = x.sel; });
      var tgt = el.querySelector(sel) || el;
      stats.taps++; stats.lastTap = id + sel;
      if (e.originalEvent) e.originalEvent._olnuGl = 1;   // map3d.js: this tap is used
      synth = true;
      try { tgt.click(); } finally { synth = false; }
    } catch (x) {}
  }

  /* ---------- on / off ---------- */
  var CSS = "html[data-glbars] .leaflet-bars-pane,html[data-glbars] .leaflet-hotbars-pane{display:none}";
  function setOn(v) {
    if (on === v) return;
    on = v;
    var de = document.documentElement;
    if (v) de.setAttribute("data-glbars", ""); else de.removeAttribute("data-glbars");
    lastSig = ""; heatPaintKey = ""; cloudLat = null;
    try { if (A && A.renderHeat) A.renderHeat(); } catch (e) {}      // heat moves between leaflet.heat and GL
    try { var c = window.CLOUDS && window.CLOUDS._last; if (c && c._map) c.redraw(); else { cloudPts = null; cloudData(); } } catch (e) {}
    if (v) sync();
    try { if (A && A.labels) A.labels(); } catch (e) {}
  }
  function check() {
    var m = glm();
    if (!m) { layersReady = false; setOn(false); return; }
    if (m !== hooked) {
      hooked = m;
      m.on("style.load", function () { if (glm() === m) { layersReady = false; lastSig = ""; heatPaintKey = ""; cloudLat = null; imgs = {}; setTimeout(check, 0); } });
    }
    gm = m;
    if (!m.style || !m.style._loaded) { m.once("style.load", function () { setTimeout(check, 0); }); return; }
    layersReady = ensure(m);
    if (!layersReady) { setOn(false); return; }
    if (on) { lastSig = ""; sync(); heatData(); cloudData(); } else setOn(true);
    editOn = !editOn; editVis();
  }

  var editOn = false;
  function editVis() {
    var v = document.body.classList.contains("ba-edit"); if (v === editOn && layersReady) return;
    editOn = v; if (!gm || !layersReady) return;
    [L_DOT, L_LBL, L_BLK, L_FULL].forEach(function (id) { try { gm.setLayoutProperty(id, "visibility", v ? "none" : "visible"); } catch (e) {} });
  }
  window.GLBARS = {
    attach: function (o) {
      A = o; map = o.map;
      var st = document.createElement("style"); st.id = "glmap-css"; st.textContent = CSS; document.head.appendChild(st);
      document.addEventListener("basemap:change", function () { setTimeout(check, 0); });
      map.on("preclick", onPreclick);
      map.on("moveend", function () { if (on) { heatPaint(); cloudPaint(); } });
      // ✏️ BAREA editor (body.ba-edit) hides the marker panes: the GL bar layers hide with them
      if (window.MutationObserver) new MutationObserver(editVis).observe(document.body, { attributes: true, attributeFilter: ["class"] });
      setTimeout(check, 0);
    },
    on: function () { return on; },
    sync: sync,
    // app.js renderHeat: pts = [[lat, lng, w]…] or null (heat off). true = drawn in GL (leaflet.heat stays off the map).
    heat: function (pts) { if (!on) return false; heatPts = pts || null; heatData(); return true; },
    // clouds.js redraw: the snapped points {lat, lng, w, a}. true = drawn in GL (the canvas stays empty).
    clouds: function (pts) { if (!on) return false; if (pts !== cloudPts) { cloudPts = pts || null; cloudData(); } else cloudPaint(); return true; },
    stats: stats,
    _check: check,
    _feats: function () { try { return gm.getSource(SRC_B)._data.features.map(function (f) { return f.properties; }); } catch (e) { return []; } },
    _marker: function (id) { return byId[String(id)] || null; },
    _img: function (id) { var x = parts[String(id)]; return x ? { k: x.im.k, ox: x.im.ox, oy: x.im.oy, bottom: x.im.bottom, parts: x.im.parts } : null; }
  };
})();
