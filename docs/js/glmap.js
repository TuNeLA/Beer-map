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
  var L_PLACE = "olnu-place", L_DOTB1 = "olnu-bar-dotb1", L_DOTB2 = "olnu-bar-dotb2", L_DOT = "olnu-bar-dot", L_DOTE = "olnu-bar-dote", L_LBL = "olnu-bar-lbl", L_FULL = "olnu-bar-full", L_HEAT = "olnu-heat", L_CLOUD = "olnu-clouds";
  // mbx: images at the phone's own pixel ratio (2 or 3): crisp on 3x screens (was always 2x)
  var R = Math.min(3, Math.max(2, Math.ceil(window.devicePixelRatio || 1))), FONT = '"Chakra Petch", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
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
        n: txt(pill.querySelector(".pn")), e: !!pill.querySelector(".pe"), o: txt(pill.querySelector(".po")), q: /\bpq\b/.test(pc) };   // gw: pq = < 3 people
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
  // mapart (js/mapart.js, window.PNPINS): the new marker art, same input / output as build() / buildLabel() below
  function art() { var P = window.PNPINS; if (P && P.build && P.setRatio && !P._r) { P.setRatio(R); P._r = R; } return P && P.build ? P : null; }
  function build(s, mode, hi, extra) {
    var P = art();
    if (P) { try { var r = P.build(s, mode, hi, extra); stats.made++; return { data: r.data, ox: r.ox, oy: r.oy, bottom: r.bottom, parts: r.parts }; } catch (e) {} }
    return build0(s, mode, hi);
  }
  // mode: "d" dot · "f" full · "x" full in the town view (z < 12.5: no disc, like .olnu-zxlo)
  function build0(s, mode, hi) {
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
        if (p.q) segs.push(["Lugnt", "#cfc6b4"]);   // gw: honest crowd, no count below 3
        else if (p.n && p.n !== "0") { segs.push([p.n, p.m ? "#ffe08a" : "#ffc24d"]); if (p.e) segs.push([" 🍺", "#fff"]); if (p.o) segs.push([" " + p.o, "#d9b8ff"]); }
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
          parts.push({ sel: ".pill", bb: [cx0, py - 9, cx0 + cw + 10, py + 9] });   // glfix: the crowd word is part of the pill tap
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
    var P = art();
    if (P) { try { var r = P.buildLabel(name); stats.made++; return { data: r.data, w: r.data.width / R }; } catch (e) {} }
    var f = "600 13px " + FONT, t = name, w = tw(t, f);
    while (w > 140 && t.length > 3) { t = t.slice(0, -2).replace(/\s+$/, "") + "…"; w = tw(t, f); }
    var W = Math.ceil(w) + 6, Hh = 18, cv = document.createElement("canvas"); cv.width = W * R; cv.height = Hh * R;
    var g = cv.getContext("2d"); g.scale(R, R); g.font = f; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineJoin = "round"; g.lineWidth = 3.2; g.strokeStyle = "rgba(0,0,0,.88)"; g.strokeText(t, W / 2, Hh / 2 + 0.5);
    g.fillStyle = "#f3f0e8"; g.fillText(t, W / 2, Hh / 2 + 0.5);
    stats.made++;
    return { data: g.getImageData(0, 0, W * R, Hh * R), w: W };
  }
  var lwCache = {};
  function labelW(name) {   // the drawn width of a name image (CSS px), for rects()
    if (lwCache[name]) return lwCache[name];
    var k0 = keyOf(name, "l", 0); if (imgs[k0] && imgs[k0].w) return (lwCache[name] = imgs[k0].w);
    var f = "600 13px " + FONT, t = name, w = tw(t, f);
    while (w > 140 && t.length > 3) { t = t.slice(0, -2).replace(/\s+$/, "") + "…"; w = tw(t, f); }
    if (Object.keys(lwCache).length > 2000) lwCache = {};
    return (lwCache[name] = Math.ceil(w) + 6);
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
  var imgs = {}, IMG_MAX = 240;   // glfix: a full pill image is ~130 KB (pixel ratio 2) here AND in Mapbox's atlas: keep fewer unused ones
  function keyOf(s, mode, hi, extra) {
    // mapart P1: the name is NOT on the bar image (the label is its own image) → not in the key, so bars with the same
    // state share one image (was one image per bar: 655 images, ~58 ms per sync)
    var str = JSON.stringify(Object.assign({}, s, { name: 0 })) + mode + (hi ? 1 : 0) + (extra && extra.sel ? "s" : ""), h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return "gb" + (h >>> 0).toString(36) + str.length.toString(36);
  }
  function image(m, s, mode, hi, extra) {
    var k = keyOf(s, mode, hi, extra), im = imgs[k];
    if (!im) { im = imgs[k] = build(s, mode, hi, extra); im.k = k; }
    if (!m.hasImage(k)) m.addImage(k, im.data, { pixelRatio: R });
    return im;
  }

  /* ---------- layers ---------- */
  // leaflet.heat gradient, shifted down: one lone point (weight ≥ 0.42 × intensity × the 0.4 kernel peak ≈ 0.2) = amber, as before
  var DOT_Z = 12.5, DOTE_Z = 14;   // Leaflet zooms (tiers.js): dots from 12.5, empty dots from 14
  // dot size: 1 → 1.2 at Leaflet z16 (GL 15), × 1.25 for the selected bar
  var DOT_SIZE = ["interpolate", ["linear"], ["zoom"], 14.5, ["get", "sz"], 15, ["*", 1.2, ["get", "sz"]]];
  // mapart P6: one warm hue family, a little softer at the top so pills stay readable over the hottest cells
  var HEAT_COL = ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(90,35,0,0)", 0.02, "rgba(90,35,0,0)", 0.08, "rgba(194,101,10,0.42)",
    0.2, "rgba(245,166,35,0.70)", 0.4, "rgba(255,122,26,0.80)", 0.68, "rgba(255,72,60,0.85)", 1, "rgba(255,236,200,0.88)"];
  /* ---------- mapart P2: the static marker images (dots, dot badges, place dots) from one sprite sheet ---------- */
  /* mbx: the static images (dots per type and state, dot badges) are drawn HERE from the same PNPINS art as the full markers,
     at this phone's pixel ratio. Before, a prebuilt sprite sheet had dots for 8 bar types only: every other type (restaurant,
     café, fast food, arenas …) fell back to the beer dot, so Blackstone (a restaurant) was a beer zoomed out and a
     restaurant zoomed in (owner 2026-11-07). Now every type has its own dot from the same source field (bar.type). */
  var spr = { ok: false, p: null, names: {}, sheet: null };
  function symmetric(ops) { var P = window.PNPINS, b = P.bboxOf(ops), m = Math.ceil(Math.max(-b[0], -b[1], b[2], b[3])); return [-m, -m, m, m]; }
  function loadSprite(m) {
    var P = window.PNPINS, G = window.PNGLYPHS; if (!P || !G || !P.barOps || !P.raster) return;
    if (!spr.sheet) {
      var imgs0 = {}, cats = (G.CATS || []).concat(G.PLACES || [], G.ARENAS || []);
      var put = function (n, ops) { var r = P.raster(ops, R, symmetric(ops)); imgs0[n] = { data: r.canvas.getContext("2d").getImageData(0, 0, r.canvas.width, r.canvas.height), pixelRatio: R }; };
      cats.forEach(function (c) {
        put("dot-" + c + "-quiet", P.barOps({ k: c }, "d", false).ops);
        put("dot-" + c + "-busy", P.barOps({ k: c, p: {}, hot: true }, "d", false).ops);
        put("dot-" + c + "-lit", P.barOps({ k: c, lit: true }, "d", false).ops);
      });
      ["friend", "friend-l", "king", "king-l", "stammis", "stammis-l", "event", "queue"].forEach(function (k) { var o = P.badgeOps(k).ops; if (o.length) put("badge-" + k, o); });
      spr.sheet = imgs0; stats.sprite = Object.keys(imgs0).length;
    }
    addSprite(m); spr.ok = true;
  }
  function addSprite(m) {   // (again after a style reload)
    var sh = spr.sheet; if (!sh || !m) return;
    Object.keys(sh).forEach(function (n) {
      spr.names[n] = 1;
      try { if (!m.hasImage(n)) m.addImage(n, sh[n].data, { pixelRatio: sh[n].pixelRatio }); } catch (x) {}
    });
  }
  // the dot sprite of a bar: navy disc, ring by state, category glyph (mapart tokens.typeMap)
  function dotName(s) {
    var P = window.PNPINS, c = P && P.cat ? P.cat(s.k) : "pub", st = (s.p || s.hot) ? "busy" : s.lit ? "lit" : "quiet", n = "dot-" + c + "-" + st;
    return spr.names[n] ? n : "";
  }
  function ensure(m) {
    if (!m || !m.style || !m.style._loaded) return false;
    try {
      // glfix perf: points need no deeper tiles than GL 14 (Leaflet 15): deeper zooms over-zoom that tile, so a zoom-in cuts no
      // new tiles in the worker and does not re-place every symbol per level (Mapbox: lower maxzoom for point sources)
      [SRC_C, SRC_H, SRC_B].forEach(function (id) { if (!m.getSource(id)) m.addSource(id, { type: "geojson", data: EMPTY, buffer: 64, tolerance: 0, maxzoom: 14 }); });
      if (!m.getLayer(L_CLOUD)) m.addLayer({ id: L_CLOUD, type: "circle", source: SRC_C,
        paint: { "circle-color": "#c8d4ea", "circle-blur": 1, "circle-opacity": ["*", 0.62, ["get", "a"]], "circle-radius": 9, "circle-pitch-alignment": "map",
          "circle-emissive-strength": 1 } });
      if (!m.getLayer(L_HEAT)) m.addLayer({ id: L_HEAT, type: "heatmap", source: SRC_H,
        paint: { "heatmap-color": HEAT_COL, "heatmap-radius": 40, "heatmap-intensity": 1.25, "heatmap-weight": 1,
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 8.4, 0.12, 9.6, 1, 12, 1, 14, 0.6] } });
      var common = { "icon-image": ["get", "img"], "icon-anchor": "top-left", "icon-offset": offExpr(), "icon-size": ["get", "sz"],
        "icon-allow-overlap": true, "icon-padding": 0, "symbol-sort-key": ["get", "sk"], "symbol-z-order": "auto",
        "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" };
      // tiers.js zoom rules (Leaflet zoom = GL zoom + 1): no dots under z12.5, empty ones from z14 at 0.82. glfix: two layers with
      // a minzoom and CONSTANT paint (was one data-driven icon-opacity): no filter / paint work below the zoom, and no
      // per-feature paint arrays (Mapbox re-evaluated those on a light change against a stale GeoJSON tile: "feature index out of bounds")
      loadSprite(m); if (spr.sheet) addSprite(m);
      // mapart P2: dots = sprite images, centred on the bar point (no offset table); z ≥ 16 = icon-size 1.2 (no "hi" images).
      // mapart P3b: EVERY bar has its dot (full ones too, under the bigger full disc): when GL collision hides a pill, the dot stays.
      var dotLay = { "icon-image": ["get", "di"], "icon-anchor": "center", "icon-size": DOT_SIZE, "icon-allow-overlap": true, "icon-ignore-placement": true,
        "icon-padding": 0, "symbol-sort-key": ["get", "sk"], "symbol-z-order": "auto", "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" };
      var isBar = ["<=", ["get", "t"], 1];
      if (!m.getLayer(L_DOT)) m.addLayer({ id: L_DOT, type: "symbol", source: SRC_B, minzoom: DOT_Z - 1, filter: ["all", isBar, ["==", ["get", "e"], 0]],
        layout: dotLay, paint: { "icon-emissive-strength": 1 } });
      // mbx declutter (owner: "the whole map is so covered by things"): EMPTY bars thin out by GL collision (a dot that would
      // touch a kept one, best priority first, is left out: a dense city centre keeps one dot per ~22 px, never a carpet)
      if (!m.getLayer(L_DOTE)) m.addLayer({ id: L_DOTE, type: "symbol", source: SRC_B, minzoom: DOTE_Z - 1, filter: ["all", isBar, ["==", ["get", "e"], 1]],
        layout: Object.assign({}, dotLay, { "icon-allow-overlap": false, "icon-ignore-placement": false, "icon-padding": 3, "symbol-sort-key": ["-", 0, ["get", "sk"]] }),
        paint: { "icon-opacity": 0.82, "icon-emissive-strength": 1 } }, L_DOT);
      // mapart P2: dot badges as 2 cheap layers (only on bars shown as a dot): friend here · crown (👑) / stammis
      var badge = function (id, img, filt, off) { if (!m.getLayer(id)) m.addLayer({ id: id, type: "symbol", source: SRC_B, minzoom: DOT_Z - 1, filter: ["all", ["==", ["get", "t"], 0], filt],
        layout: { "icon-image": img, "icon-anchor": "center", "icon-offset": off, "icon-size": DOT_SIZE, "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-padding": 0,
          "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" }, paint: { "icon-emissive-strength": 1 } }, m.getLayer(L_LBL) ? L_LBL : undefined); };
      if (spr.sheet) {   // (only with the sprite images there; ensure() runs again when the sprite has loaded)
      badge(L_DOTB1, "badge-friend", ["==", ["get", "bf"], 1], ["match", ["get", "bs"], 1, ["literal", [7, 7]], ["literal", [6, 6]]]);
      badge(L_DOTB2, ["get", "b2"], ["!=", ["get", "b2"], ""], ["match", ["get", "b2"], "badge-king", ["match", ["get", "bs"], 1, ["literal", [0, -12]], ["literal", [0, -11]]],
        ["match", ["get", "bs"], 1, ["literal", [-7, 7]], ["literal", [-6, 6]]]]);
      }
      // restaurant dots (places.js) in GL, UNDER every bar layer and placed last: GL collision hides one that would touch a
      // pill or a name (same source as the bars: cross-source collisions are off in basemap.js)
      if (!m.getLayer(L_PLACE)) m.addLayer({ id: L_PLACE, type: "symbol", source: SRC_B, filter: ["==", ["get", "t"], 2],
        layout: { "icon-image": ["get", "img"], "icon-anchor": "top-left", "icon-offset": offExpr(), "icon-allow-overlap": false, "icon-ignore-placement": false,
          "icon-padding": 0, "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" }, paint: { "icon-emissive-strength": 1 } }, L_DOTE);
      // names: placed after the full pills (layer above = placed first), so a name that would touch a pill or a
      // higher-priority name is left out (the old placeLabels rule); dots never block a name (they ignore placement)
      if (!m.getLayer(L_LBL)) m.addLayer({ id: L_LBL, type: "symbol", source: SRC_B, filter: ["all", ["==", ["get", "t"], 1], ["!=", ["get", "li"], ""]],
        layout: { "icon-image": ["get", "li"], "icon-anchor": "top", "icon-offset": JSON.parse(JSON.stringify(offExpr()).replace('["get","oi"]', '["get","lo"]')), "icon-allow-overlap": false, "icon-ignore-placement": false,
          "icon-padding": 0, "symbol-sort-key": ["-", 0, ["get", "sk"]], "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" },
        paint: { "icon-emissive-strength": 1 } });
      // mapart P3b: full pills collide on their REAL image box (no invisible blocker layer any more): the top layer is placed
      // first, best priority first (sort key = −priority); a pill that would touch a placed one is hidden by GL (its dot stays).
      // sync() already demotes those in JS at each tier pass; this is the live safety net while a zoom animates.
      // A name (layer under it) then may not touch any pill or a better name.
      if (!m.getLayer(L_FULL)) m.addLayer({ id: L_FULL, type: "symbol", source: SRC_B, filter: ["==", ["get", "t"], 1],
        layout: Object.assign({}, common, { "icon-allow-overlap": false, "icon-ignore-placement": false, "symbol-sort-key": ["get", "skf"] }), paint: { "icon-emissive-strength": 1 } });
      return true;
    } catch (e) { try { console.warn("olnu glmap", e && e.message); } catch (x) {} return false; }
  }

  /* ---------- bars ---------- */
  var byId = {}, lastSig = "", parts = {}, placeFeats = [], placeTap = null, placeById = {};
  function centred(im) {   // a dot image (canvas fallback when the sprite is not there) re-padded so the bar point is its centre
    if (im.cen) return im.cen;
    var W = im.data.width, H = im.data.height, ax = im.ox * R, ay = im.oy * R, hw = Math.ceil(Math.max(ax, W - ax)), hh = Math.ceil(Math.max(ay, H - ay));
    var cv = document.createElement("canvas"); cv.width = hw * 2; cv.height = hh * 2; cv.getContext("2d").putImageData(im.data, hw - ax, hh - ay);
    return (im.cen = cv.getContext("2d").getImageData(0, 0, hw * 2, hh * 2));
  }
  function sync() {
    if (!on || !A) return;
    var m = gm; if (!m || !layersReady) return;
    var t0 = performance.now(), z = map.getZoom(), hi = z >= 16, xlo = z < 12.5, feats = [], used = {}, n = 0, list = [];
    byId = {}; parts = {};
    (A.layers || []).forEach(function (ly) {
      if (!ly || !ly.eachLayer) return;
      ly.eachLayer(function (mk) {
        var c = mk.options && mk.options.olnuC, io = mk.options && mk.options.icon && mk.options.icon.options; if (!c || !c.bar || !io) return;
        var ic = mk.getElement && mk.getElement(), s = parse(io.html || "", io.className || "");
        list.push({ mk: mk, c: c, s: s, full: mk._olnuTier === "f", sel: !!(ic && ic.classList.contains("cm-sel")), prio: (mk.options.olnuPrio || 0) });
      });
    });
    // mapart P3b: walk the full pills best first; a pill whose real image box (−2 px) touches one already placed shows as a dot.
    // The selected bar is never demoted. Only pills near the view count (off-screen ones keep their tier).
    var size = map.getSize(), placed = [], demoted = 0;
    list.filter(function (x) { return x.full; }).sort(function (a, b) { return (b.sel ? 1 : 0) - (a.sel ? 1 : 0) || b.prio - a.prio; }).forEach(function (x) {
      x.im = image(m, x.s, xlo ? "x" : "f", hi, { sel: x.sel });
      var p = map.latLngToContainerPoint([+x.c.bar.lat, +x.c.bar.lng]), k = x.sel ? 1.25 : 1, W = x.im.data.width / R, H = x.im.data.height / R;
      if (p.x < -150 || p.y < -150 || p.x > size.x + 150 || p.y > size.y + 150) return;
      var b = [p.x - x.im.ox * k + 2, p.y - x.im.oy * k + 2, p.x + (W - x.im.ox) * k - 2, p.y + (H - x.im.oy) * k - 2];
      if (!x.sel && placed.some(function (q) { return b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]; })) { x.full = false; demoted++; return; }
      placed.push(b);
    });
    list.forEach(function (x) {
      var s = x.s, c = x.c, mk = x.mk, full = x.full, sel = x.sel, mode = full ? (xlo ? "x" : "f") : "d";
      var im = full ? (x.im || image(m, s, mode, hi, { sel: sel })) : null, di = spr.ok ? dotName(s) : "";
      if (!di) {   // no sprite (yet): the canvas dot, centred
        var dk = keyOf(s, "d", hi), dimg = image(m, s, "d", hi); used[dimg.k] = 1; di = dk + "c";
        if (!m.hasImage(di)) m.addImage(di, centred(dimg), { pixelRatio: R }); used[di] = 1;
        if (!im) im = dimg;
      } else if (!im) {   // a sprite dot (mapart: quiet Ø 18, busy Ø 20; the image box is centred on the point)
        var dr = (s.p || s.hot) ? 10 : 9;
        im = { k: di, ox: dr, oy: dr, bottom: dr, parts: [{ sel: ".bar-ico", bb: [-dr, -dr, dr, dr] }], data: { width: 2 * dr * R, height: 2 * dr * R } };
      }
      used[im.k] = 1;
      var empty = !((c.beers && c.beers.length) || (c.rallies && c.rallies.length) || (c.cis && c.cis.length));
      var prio = x.prio + (full ? 10000 : 0) + (sel ? 1e6 : 0), busy = !!(s.p || s.hot);
      // the name sits 3 px under its own pill image: the pills are GL collision boxes now (mapart P3b), a name that
      // touched its own pill box was always hidden
      var lblTop = Math.max(hi ? 18 : 15, Math.ceil(im.bottom) + 1);   // just clear of its own image box (GL collision)
      var id = String(c.bar.id);
      byId[id] = mk; parts[id] = { im: im, sz: sel ? 1.25 : 1, ll: [+c.bar.lat, +c.bar.lng], t: full ? 1 : 0, e: empty ? 1 : 0, s: s, sel: sel, dem: x.full !== (mk._olnuTier === "f"),
        lt: lblTop, lw: full && s.name ? labelW(s.name) : 0 };
      var li = full && s.name ? label(m, s.name).k : "";
      if (li) used[li] = 1;
      feats.push({ type: "Feature", id: ++n, geometry: { type: "Point", coordinates: [+c.bar.lng, +c.bar.lat] },
        properties: { id: id, t: full ? 1 : 0, img: full ? im.k : "", di: di, oi: full ? offIndex(-im.ox, -im.oy) : 0, sz: sel ? 1.25 : 1, e: empty ? 1 : 0, sk: prio, skf: -prio,
          bf: s.p && s.p.f ? 1 : 0, bs: busy ? 1 : 0, b2: s.king && spr.ok && (!empty || z >= DOTE_Z) ? "badge-king" : "",
          li: li, lo: offIndex(0, lblTop) } });
    });
    placeFeats.forEach(function (f) { f.id = ++n; feats.push(f); used[f.properties.img] = 1; });
    stats.demoted = demoted;
    if (offsDirty) {   // a new offset: the layers' offset tables first (the label layer reads its own row "lo")
      offsDirty = false; lastSig = "";
      try { var oe = offExpr(); m.setLayoutProperty(L_FULL, "icon-offset", oe); m.setLayoutProperty(L_PLACE, "icon-offset", oe);
        m.setLayoutProperty(L_LBL, "icon-offset", JSON.parse(JSON.stringify(oe).replace('["get","oi"]', '["get","lo"]'))); } catch (e) {}
    }
    var sig = feats.map(function (f) { var p = f.properties; return p.id + p.img + p.di + p.t + p.sz + p.e + p.li + p.lo + p.bf + p.b2 + p.oi; }).join("|");
    if (sig !== lastSig) {
      lastSig = sig; try { m.getSource(SRC_B).setData({ type: "FeatureCollection", features: feats }); } catch (e) {}
      stats.sets = (stats.sets || 0) + 1;
      // places.js (restaurant dots) and others re-run their layout against the new GL pills
      try { document.dispatchEvent(new CustomEvent("glbars:sync")); } catch (e) {}
    }
    var keys = Object.keys(imgs);
    if (keys.length > IMG_MAX) keys.forEach(function (k) { if (!used[k] && !used[k + "c"]) { try { if (m.hasImage(k)) m.removeImage(k); if (m.hasImage(k + "c")) m.removeImage(k + "c"); } catch (e) {} delete imgs[k]; } });
    var ms = performance.now() - t0;
    stats.syncs++; stats.ms += ms; stats.last = ms; stats.feats = feats.length; stats.imgs = Object.keys(imgs).length;
  }
  /* ---------- restaurant dots (places.js) in GL ---------- */
  // list = [{id, lat, lng, type, name, lbl, nm}] (what places.js decided to show); tap(id) = places.js openPlace
  function placeImage(m, p) {
    var P = art(), k = "pl|" + (p.nm ? "nm" : p.type) + "|" + (p.lbl ? p.name : ""), im = imgs[k];
    if (!im && P) {
      try {
        var ops = P.placeOps(p.nm ? "fastfood" : p.type).ops.slice();
        if (p.lbl && p.name) P.labelOps(String(p.name), true).ops.forEach(function (o) { var q = Object.assign({}, o); q.y = (q.y || 0) + 9; ops.push(q); });
        var r = P.raster(ops, R); im = imgs[k] = { data: r.canvas.getContext("2d").getImageData(0, 0, r.canvas.width, r.canvas.height), ox: r.ox, oy: r.oy, k: k };
      } catch (e) { im = null; }
    }
    if (!im) return null;
    if (!m.hasImage(k)) m.addImage(k, im.data, { pixelRatio: R });
    return im;
  }
  function setPlaces(list, tap) {
    if (!on || !gm || !layersReady) return false;
    placeTap = tap || placeTap; placeById = {}; placeFeats = [];
    (list || []).forEach(function (p) {
      var im = placeImage(gm, p); if (!im) return; placeById[String(p.id)] = p;
      placeFeats.push({ type: "Feature", geometry: { type: "Point", coordinates: [+p.lng, +p.lat] }, properties: { id: String(p.id), t: 2, img: im.k, oi: offIndex(-im.ox, -im.oy), e: 0, sz: 1 } });
    });
    stats.places = placeFeats.length;
    sync();
    return true;
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
  function heatData(force) {
    var m = gm; if (!on || !m || !layersReady) return;
    var pts = heatPts || [], sig = pts.length + ":" + pts.map(function (p) { return p[0] + "," + p[1] + "," + p[2]; }).join(";");
    if (sig === heatSig && !force) { heatPaint(); return; }   // glfix: the same points (every poll / pan) = no setData, no re-tiling
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
  var synth = false, tapAt = -1e9;
  function onPreclick(e) {
    if (!on || synth || !gm || !layersReady || !e || !e.latlng) return;
    var m = gm, z = map.getZoom();
    try {
      var p = m.project([e.latlng.lng, e.latlng.lat]), hit = null;
      var fs = m.queryRenderedFeatures([[p.x - 3, p.y - 3], [p.x + 3, p.y + 3]], { layers: [L_FULL] });
      // glfix: only a tap on a drawn part counts (disc, pill, crowd word, badge, ±4 px); the image box's empty corners let the
      // tap through to a dot or the map under it
      fs.forEach(function (f) {
        var pi0 = parts[String(f.properties.id)]; if (!pi0) return;
        var bp0 = m.project(f.geometry.coordinates), dx0 = (p.x - bp0.x) / pi0.sz, dy0 = (p.y - bp0.y) / pi0.sz;
        if (!pi0.im.parts.some(function (x) { return dx0 >= x.bb[0] - 4 && dx0 <= x.bb[2] + 4 && dy0 >= x.bb[1] - 4 && dy0 <= x.bb[3] + 4; })) return;
        if (!hit || f.properties.sk > hit.properties.sk) hit = f;
      });
      if (!hit && z >= DOT_Z) {
        var best = 1e9;
        m.queryRenderedFeatures([[p.x - 22, p.y - 22], [p.x + 22, p.y + 22]], { layers: [L_DOT, L_DOTE] }).forEach(function (f) {
          if (z < DOTE_Z && f.properties.e === 1) return;   // hidden by the zoom rule
          var q = m.project(f.geometry.coordinates), d = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
          if (d < best) { best = d; hit = f; }
        });
      }
      if (!hit && placeTap) {   // a restaurant dot
        var pf = m.queryRenderedFeatures([[p.x - 10, p.y - 10], [p.x + 10, p.y + 10]], { layers: [L_PLACE] })[0], pl = pf && placeById[String(pf.properties.id)];
        if (pl) { stats.taps++; stats.lastTap = "place:" + pl.id; if (e.originalEvent) e.originalEvent._olnuGl = 1; synth = true; try { placeTap(pl); } finally { synth = false; } return; }
      }
      if (!hit) return;
      var id = String(hit.properties.id), mk = byId[id], el = mk && mk.getElement && mk.getElement(); if (!el) return;
      // which part was tapped (same folds as a tap on the DOM marker)
      var bp = m.project([mk.getLatLng().lng, mk.getLatLng().lat]), pi = parts[id], dx = (p.x - bp.x) / (pi ? pi.sz : 1), dy = (p.y - bp.y) / (pi ? pi.sz : 1), sel = ".bar-ico";
      if (hit.properties.t === 1 && pi) pi.im.parts.forEach(function (x) { if (dx >= x.bb[0] - 2 && dx <= x.bb[2] + 2 && dy >= x.bb[1] - 2 && dy <= x.bb[3] + 2 && x.sel !== ".bar-ico") sel = x.sel; });
      var tgt = el.querySelector(sel) || el;
      stats.taps++; stats.lastTap = id + sel; tapAt = performance.now();
      if (e.originalEvent) e.originalEvent._olnuGl = 1;   // map3d.js: this tap is used
      synth = true;
      // glfix: our own click event, flagged too: it bubbles to the map, and map3d.js (3D house tap → BARLIT.open → a 2nd click
      // on the same marker) must skip it, else Leaflet toggles the just-opened popup closed again
      try { var ev = new MouseEvent("click", { bubbles: true, cancelable: true, view: window }); ev._olnuGl = 1; tgt.dispatchEvent(ev); } finally { synth = false; }
    } catch (x) {}
  }

  /* ---------- on / off ---------- */
  var CSS = "html[data-glbars] .leaflet-bars-pane,html[data-glbars] .leaflet-hotbars-pane{display:none}" +
    // mbx declutter: zoomed out (zones on) the DOM chips may not fight the zone labels: 📍 my-place pins = icon only,
    // arena chips and call-out labels hidden (zone labels + friend faces carry the view)
    "html[data-zones] .mp-pin b,html[data-zones] .mp-pin .mp-more,html[data-zones] .rl-pin-lbl{display:none}" +
    "html[data-zones] .mp-pin{padding:2px 4px;gap:0}html[data-zones] .leaflet-arenapins-pane{display:none}";
  function setOn(v) {
    if (on === v) return;
    on = v;
    var de = document.documentElement;
    if (v) de.setAttribute("data-glbars", ""); else de.removeAttribute("data-glbars");
    // mbx: the DOM twins of the GL bars never enter the DOM while GL draws them (hundreds of nodes less)
    try { if (map && map.setVirtualPane) { map.setVirtualPane("bars", v); map.setVirtualPane("hotbars", v); } } catch (e) {}
    lastSig = ""; heatPaintKey = ""; cloudLat = null; heatSig = "";
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
      m.on("style.load", function () { if (glm() === m) { layersReady = false; lastSig = ""; heatSig = ""; heatPaintKey = ""; cloudLat = null; imgs = {}; setTimeout(check, 0); } });
    }
    gm = m;
    if (!m.style || !m.style._loaded) { m.once("style.load", function () { setTimeout(check, 0); }); return; }
    layersReady = ensure(m);
    if (!layersReady) { setOn(false); return; }
    if (on) { lastSig = ""; sync(); heatData(true); cloudData(); } else setOn(true);
    editOn = !editOn; editVis();
  }

  var editOn = false;
  function editVis() {
    var v = document.body.classList.contains("ba-edit"); if (v === editOn && layersReady) return;
    editOn = v; if (!gm || !layersReady) return;
    [L_PLACE, L_DOT, L_DOTE, L_DOTB1, L_DOTB2, L_LBL, L_FULL].forEach(function (id) { try { gm.setLayoutProperty(id, "visibility", v ? "none" : "visible"); } catch (e) {} });
  }
  /* ---------- mbx: 🆘 Hämta mig / 🚗 Skjuts? requests on the map (js/skjuts.js data; coordinator request 2026-11-07) ----------
     A live request sent TO me that has a position = one small DOM pin above everything (pane "pickup", z 720), at every zoom
     (also when zoomed out: somebody needs a ride). Tap = the request sheet (SKJUTS.hudClick). Read-only: no RPC here, the
     rows come from SKJUTS' own poll; checked every 5 s while the page is visible, redrawn only when they change. */
  var pkLayer = null, pkSig = "", PK_CSS = ".pk-pin{position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:flex;align-items:center;gap:4px;padding:3px 9px 3px 4px;" +
    "border-radius:14px;background:#0A0F24;border:2px solid #FF5A4E;color:#FFF6E5;font:700 12px/1.2 var(--body,'Chakra Petch',system-ui,sans-serif);white-space:nowrap;" +
    "box-shadow:0 2px 8px rgba(0,0,0,.6);cursor:pointer;max-width:170px}" +
    ".pk-pin::after{content:'';position:absolute;left:50%;bottom:-7px;transform:translateX(-50%);border:6px solid transparent;border-top-color:#FF5A4E;border-bottom:0}" +
    ".pk-pin b{overflow:hidden;text-overflow:ellipsis}.pk-pin .pk-i{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:#FF5A4E;font-size:12px}" +
    ".pk-pin.pk-sk{border-color:#4AA3FF}.pk-pin.pk-sk::after{border-top-color:#4AA3FF}.pk-pin.pk-sk .pk-i{background:#2B6FD6}" +
    ".pk-pin .pk-r{position:absolute;left:14px;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;box-shadow:0 0 0 2px rgba(255,90,78,.7);opacity:0;pointer-events:none}" +
    "@media (prefers-reduced-motion:no-preference){.pk-pin:not(.pk-sk) .pk-r{animation:pkRing 1.8s ease-out infinite}}" +
    "@keyframes pkRing{0%{opacity:.9;transform:scale(.8)}100%{opacity:0;transform:scale(1.9)}}";
  function pkRows() {
    try { var P = window.SKJUTS && window.SKJUTS._poll && window.SKJUTS._poll(); return P && P.incoming ? P.incoming.filter(function (x) { return x && x.live && x.lat != null && isFinite(+x.lat) && isFinite(+x.lng) && x.my_ans !== "kan_inte"; }) : []; }
    catch (e) { return []; }
  }
  function pkSync() {
    if (!map || !window.L || document.hidden) return;
    var rows = pkRows(), sig = rows.map(function (x) { return x.id + ":" + (+x.lat).toFixed(5) + "," + (+x.lng).toFixed(5) + ":" + x.kind + ":" + x.name; }).join("|");
    if (sig === pkSig) return; pkSig = sig;
    if (!pkLayer) {
      if (!map.getPane("pickup")) { map.createPane("pickup"); map.getPane("pickup").style.zIndex = 720; }
      pkLayer = L.layerGroup().addTo(map);
      var st = document.createElement("style"); st.id = "pk-pins-css"; st.textContent = PK_CSS; document.head.appendChild(st);
    }
    pkLayer.clearLayers();
    rows.forEach(function (x) {
      var sk = x.kind === "skjuts", nm = String(x.name || "").slice(0, 20).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
      var mk = L.marker([+x.lat, +x.lng], { pane: "pickup", keyboard: true, title: (sk ? "Skjuts? " : "Hämta mig: ") + (x.name || ""), zIndexOffset: 9000,
        icon: L.divIcon({ className: "pk-mk", iconSize: [0, 0], iconAnchor: [0, 0],
          html: '<div class="pk-pin' + (sk ? " pk-sk" : "") + '"><span class="pk-r"></span><span class="pk-i" aria-hidden="true">' + (sk ? "🚗" : "🆘") + "</span><b>" + nm + "</b></div>" }) });
      mk.on("click", function () { try { window.SKJUTS.hudClick("pk-in:" + x.id); } catch (e) {} });
      pkLayer.addLayer(mk);
    });
    stats.pickups = rows.length;
  }

  window.GLBARS = {
    attach: function (o) {
      A = o; map = o.map;
      var st = document.createElement("style"); st.id = "glmap-css"; st.textContent = CSS; document.head.appendChild(st);
      document.addEventListener("basemap:change", function () { setTimeout(check, 0); });
      map.on("preclick", onPreclick);
      // glfix: the selected bar (cm-sel, set by app.js after the tier pass) is full + 1.25× at once, not at the next pan
      map.on("popupopen popupclose", function () { if (on) setTimeout(function () { lastSig = ""; sync(); }, 0); });
      map.on("moveend", function () { if (on) { heatPaint(); cloudPaint(); } });
      // ✏️ BAREA editor (body.ba-edit) hides the marker panes: the GL bar layers hide with them
      if (window.MutationObserver) new MutationObserver(editVis).observe(document.body, { attributes: true, attributeFilter: ["class"] });
      setTimeout(check, 0);
      setInterval(pkSync, 5000); document.addEventListener("visibilitychange", function () { if (!document.hidden) setTimeout(pkSync, 300); });
    },
    on: function () { return on; },
    sync: sync,
    // app.js renderHeat: pts = [[lat, lng, w]…] or null (heat off). true = drawn in GL (leaflet.heat stays off the map).
    heat: function (pts) { if (!on) return false; heatPts = pts || null; heatData(); return true; },
    // clouds.js redraw: the snapped points {lat, lng, w, a}. true = drawn in GL (the canvas stays empty).
    clouds: function (pts) { if (!on) return false; if (pts !== cloudPts) { cloudPts = pts || null; cloudData(); } else cloudPaint(); return true; },
    stats: stats,
    // glfix: what the GL bars cover on screen (container px), for places.js obstacles: full = its image box (disc, pill,
    // crowd word, badges) + its name; dot = the disc. Dots hidden by the zoom rules are left out.
    rects: function () {
      var out = []; if (!on || !map) return out;
      var z = map.getZoom(), size = map.getSize();
      Object.keys(parts).forEach(function (id) {
        var x = parts[id], im = x.im; if (!x.t && (z < DOT_Z || (x.e && z < DOTE_Z))) return;
        var p = map.latLngToContainerPoint(x.ll); if (p.x < -120 || p.y < -120 || p.x > size.x + 120 || p.y > size.y + 120) return;
        var k = x.sz, W = im.data.width / R, H = im.data.height / R;
        out.push({ l: p.x - im.ox * k, t: p.y - im.oy * k, r: p.x + (W - im.ox) * k, b: p.y + (H - im.oy) * k, id: id, t1: x.t });
        if (x.t && x.lw) out.push({ l: p.x - x.lw / 2, t: p.y + x.lt, r: p.x + x.lw / 2, b: p.y + x.lt + 18, id: id, lbl: 1 });
      });
      return out;
    },
    // test hook: every GL bar in view as the tiers tests need it
    _view: function () {
      if (!on || !map || !gm) return null;
      var z = map.getZoom(), size = map.getSize(), placed = {};
      try { gm.queryRenderedFeatures({ layers: [L_LBL] }).forEach(function (f) { placed[f.properties.id] = 1; }); } catch (e) {}
      var out = [];
      Object.keys(parts).forEach(function (id) {
        var x = parts[id], p = map.latLngToContainerPoint(x.ll); if (p.x < 0 || p.y < 0 || p.x > size.x || p.y > size.y) return;
        var ico = x.im.parts.filter(function (q) { return q.sel === ".bar-ico"; })[0], s = x.s;
        out.push({ id: id, full: !!x.t, empty: !!x.e, sel: x.sel, x: p.x, y: p.y, n: s.p ? +s.p.n || 0 : 0, friend: !!(s.p && s.p.f), crowd: !!s.cw,
          pill: !!(x.t && s.p), dem: !!x.dem, icoW: ico ? +((ico.bb[2] - ico.bb[0]) * x.sz).toFixed(1) : 0, lbl: !!placed[id], name: s.name,
          shown: !!x.t || (z >= DOT_Z && (!x.e || z >= DOTE_Z)) });
      });
      return out;
    },
    _layers: function () { return [L_CLOUD, L_HEAT, L_PLACE, L_DOTE, L_DOT, L_DOTB1, L_DOTB2, L_LBL, L_FULL]; },
    // places.js: the restaurant dots it chose (GL draws them under the bars); false = GL is off (keep the DOM dots)
    places: setPlaces,
    // map3d.js: a map click right after a GL bar tap (same finger) is that tap, not a tap on the 3D house under it
    tappedAt: function () { return tapAt; },
    // mbx: is this bar drawn in GL right now (full, or a dot the zoom rules show)? (mypins.js: else it draws its own chip)
    shown: function (id) {
      var x = parts[String(id)]; if (!on || !x || !map) return false;
      var z = map.getZoom(); if (!x.t && (z < DOT_Z || (x.e && z < DOTE_Z))) return false;
      var p = map.latLngToContainerPoint(x.ll), s = map.getSize(); return p.x >= -20 && p.y >= -20 && p.x <= s.x + 20 && p.y <= s.y + 20;
    },
    // mbx: open a bar's sheet the way a tap on it does (mypins / barlit used to click the DOM marker, which is virtual now)
    _pkSync: function () { pkSig = "-"; pkSync(); return stats.pickups || 0; },
    open: function (id, sel) {
      var mk = byId[String(id)], el = mk && mk.getElement && mk.getElement(); if (!el) return false;
      var tgt = el.querySelector(sel || ".bar-ico") || el; synth = true;
      try { var ev = new MouseEvent("click", { bubbles: true, cancelable: true, view: window }); ev._olnuGl = 1; tgt.dispatchEvent(ev); } finally { synth = false; }
      return true;
    },
    spriteOk: function () { return spr.ok; },
    _check: check,
    _feats: function () { try { return gm.getSource(SRC_B)._data.features.map(function (f) { return f.properties; }); } catch (e) { return []; } },
    _marker: function (id) { return byId[String(id)] || null; },
    _img: function (id) { var x = parts[String(id)]; return x ? { k: x.im.k, ox: x.im.ox, oy: x.im.oy, bottom: x.im.bottom, parts: x.im.parts } : null; }
  };
})();
