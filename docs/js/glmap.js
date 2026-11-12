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
        n: txt(pill.querySelector(".pn")), e: !!pill.querySelector(".pe"), o: txt(pill.querySelector(".po")), u: !!pill.querySelector(".pe-ppl"), q: /\bpq\b/.test(pc), ft: txt(pill.querySelector(".pft")) };   // ds31 friends' totals   // gw: pq = < 3 people
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

  /* map BR1: the glyph = the venue type (bar.vt, else window.PNVTYPE from type + name); the state from the marker HTML is
     shared (cached): a typed copy per (state, type), so images stay shared by bars with the same look */
  var vtCache = typeof WeakMap === "function" ? new WeakMap() : null;
  function withVt(s, bar) {
    if (!bar || bar.arena || bar.place || !vtCache) return s;
    var V = window.PNVTYPE, k = bar.vt || (V && V.of ? (bar.vt = V.of(bar)) : null); if (!k || k === s.k) return s;
    var m = vtCache.get(s); if (!m) { m = {}; vtCache.set(s, m); }
    return m[k] || (m[k] = Object.assign({}, s, { k: k }));
  }
  // name badges: s uteservering (in season, Apr–Sep; olnu.map.ute = 1 / 0 for tests) · n live music · h HBTQ+ · r rooftop
  function season() { try { var v = localStorage.getItem("olnu.map.ute"); if (v === "1") return true; if (v === "0") return false; } catch (e) {} var mo = new Date().getMonth() + 1; return mo >= 4 && mo <= 9; }
  var ROOF_RX = /(takterrass|rooftop|roof ?top|sky ?bar)/i;
  function attrsOf(b, sun) {
    if (!b || b.arena || b.place) return ""; var a = "";
    if (sun && (b.outdoor === 1 || b.outdoor === true || b.type === "biergarten")) a += "s";
    if (b.live) a += "n"; if (b.lgbtq) a += "h"; if (b.roof || ROOF_RX.test(b.name || "")) a += "r";
    return a.slice(0, 2);
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
    var ops = [], parts = [], full = mode !== "d", D = hi ? 32 : 24, gs = hi ? 18 : 14;   // map B9: dot = full disc
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
        else if (p.n && p.n !== "0") { segs.push([p.n, p.m ? "#ffe08a" : "#ffc24d"]); if (p.e) segs.push([p.u ? " 👥" : " 🍺", "#fff"]); if (p.o) segs.push([" " + p.o, "#d9b8ff"]); }
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
  function buildLabel(name, at) {
    var P = art();
    if (P) { try { var r = P.buildLabel(name, at); stats.made++; return { data: r.data, w: r.data.width / R, h: r.data.height / R }; } catch (e) {} }
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
  function label(m, name, at) {
    var k = keyOf(name + (at ? "|" + at : ""), "l", 0), im = imgs[k];   // map BR1: + name badges
    if (!im) { im = imgs[k] = buildLabel(name, at); im.k = k; }
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
  // map B9: dot sprites are drawn at the full disc size (28): icon-size follows the full images' zoom tiers (town view 24,
  // Leaflet z >= 16 32), × 1.25 for the selected bar. So a dot and a full pill of the same zoom have the same icon.
  // map M2 (owner: "sizes jump in steps"): every bar image is drawn ONCE at the z >= 16 size; ONE smooth ramp scales them all
  // (dots, pills, badges, names, cluster dots). ZK = [GL zoom, scale]; zk(Leaflet zoom) is the same ramp in JS (taps, boxes).
  var ZK = [[11, 0.75], [14, 0.875], [15, 1]];
  function zk(zl) { var g = zl - 1, i; if (g <= ZK[0][0]) return ZK[0][1];
    for (i = 1; i < ZK.length; i++) if (g <= ZK[i][0]) return ZK[i - 1][1] + (ZK[i][1] - ZK[i - 1][1]) * (g - ZK[i - 1][0]) / (ZK[i][0] - ZK[i - 1][0]);
    return ZK[ZK.length - 1][1]; }
  var ICON_Z = ["interpolate", ["linear"], ["zoom"]]; ZK.forEach(function (s) { ICON_Z.push(s[0], ["*", s[1], ["get", "sz"]]); });
  var DOT_SIZE = ICON_Z;
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
      // a1map I-08: the quiet dot's image = its disc (+ the 1 px edge), no shadow margin: GL collision then hides a quiet dot only
      // when the discs really touch (the margin made a 36 px box round a 28 px disc: icons hid while there was room)
      var tight = function (n, ops) { var e = window.PNTOKENS.size.dot / 2 + window.PNTOKENS.size.edge, r = P.raster(ops, R, [-e, -e, e, e]);
        imgs0[n] = { data: r.canvas.getContext("2d").getImageData(0, 0, r.canvas.width, r.canvas.height), pixelRatio: R }; };
      cats.forEach(function (c) {
        tight("dot-" + c + "-quiet", P.barOps({ k: c }, "d", false).ops);
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
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 8.4, 0.12, 9.6, 1, 12, 1, 14, 0.6, 15, 0.45, 16, 0] } });   // ds44: no heat blob over the lit houses (Leaflet ≥ 17)
      var common = { "icon-image": ["get", "img"], "icon-anchor": "top-left", "icon-offset": offExpr(), "icon-size": ICON_Z,   // map M2
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
      // a1map I-27: a bar's dot lives in ONE layer at every zoom and tier. "Pin" bars (people / check-ins / call-outs / 👑 / 📅:
      // they can be full pills zoomed out) keep their dot here (dh 1, always drawn); quiet bars have their dot in the cluster
      // source (cdote) whatever their tier. A tier change only adds / removes the pill over the dot: the icon never blinks.
      var isBar = ["all", ["<=", ["get", "t"], 1], ["==", ["get", "dh"], 1]];
      if (!m.getLayer(L_DOT)) m.addLayer({ id: L_DOT, type: "symbol", source: SRC_B, minzoom: DOT_Z - 1, filter: ["all", isBar, ["==", ["get", "e"], 0]],
        layout: dotLay, paint: { "icon-emissive-strength": 1 } });
      // 👑 / 📅 pins with nobody there: always drawn too (the quiet bars thin out in the cluster source, a1map I-08)
      if (!m.getLayer(L_DOTE)) m.addLayer({ id: L_DOTE, type: "symbol", source: SRC_B, minzoom: DOT_Z - 1, filter: ["all", isBar, ["==", ["get", "e"], 1]],
        layout: dotLay, paint: { "icon-opacity": 0.82, "icon-emissive-strength": 1 } }, L_DOT);
      // mapart P2: dot badges as 2 cheap layers (only on bars shown as a dot): friend here · crown (👑) / stammis
      var badge = function (id, img, filt, off) { if (!m.getLayer(id)) m.addLayer({ id: id, type: "symbol", source: SRC_B, minzoom: DOT_Z - 1, filter: ["all", ["==", ["get", "t"], 0], filt],
        layout: { "icon-image": img, "icon-anchor": "center", "icon-offset": off, "icon-size": DOT_SIZE, "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-padding": 0,
          "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" }, paint: { "icon-emissive-strength": 1 } }, m.getLayer(L_LBL) ? L_LBL : undefined); };
      if (spr.sheet) {   // (only with the sprite images there; ensure() runs again when the sprite has loaded)
      // map B9: badge places on the 28 px dot disc (one size for quiet and busy dots)
      badge(L_DOTB1, "badge-friend", ["==", ["get", "bf"], 1], ["literal", [12, 12]]);   // map M2: on the 32 px image disc
      badge(L_DOTB2, ["get", "b2"], ["!=", ["get", "b2"], ""], ["match", ["get", "b2"], "badge-king", ["literal", [0, -18]], ["literal", [-12, 12]]]);
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
          "icon-padding": 0, "symbol-sort-key": ["-", 0, ["get", "sk"]], "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport", "icon-size": ICON_Z },   // map M2: the name scales with its pill
        paint: { "icon-emissive-strength": 1 } });
      // mapart P3b: full pills are boxes on their REAL image (a name, layer under it, may not touch any pill or a better name).
      // a1map I-08: the pill never hides by GL collision (that hid the whole bar while there was room): sync() demotes a pill
      // that would touch another pill or another bar's icon to its dot at each tier pass; the icons (placed first) always win.
      if (!m.getLayer(L_FULL)) m.addLayer({ id: L_FULL, type: "symbol", source: SRC_B, filter: ["==", ["get", "t"], 1],
        layout: Object.assign({}, common, { "icon-allow-overlap": true, "icon-ignore-placement": false, "symbol-sort-key": ["get", "sk"] }), paint: { "icon-emissive-strength": 1 } });
      clEnsure(m);   // ds30: dot bars cluster when zoomed out
      meEnsure(m);   // a1map I-28
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
  /* a1map I-08: which icon wins when two icons touch: live crowd first (barPrio), then open now, then the type:
     bar > pub > nightclub > restaurant > café (the rank stays < 1, so it never beats a person) */
  var RANK = { bar: 6, cocktail: 6, vinbar: 6, olbar: 6, sportsbar: 6, hotellbar: 6, spelbar: 6, nation: 6, karaoke: 6, livescen: 6,
    pub: 5, biergarten: 5, nightclub: 4, restbar: 3, restaurant: 3, cafe: 2, fastfood: 1, kebab: 1 }, openC = {};
  function rankOf(bar, s) {
    var P = window.PNPINS, k = P && P.cat ? P.cat(s.k) : s.k, id = String(bar.id), o = openC[id], now = Date.now();
    if (!o || now - o[0] > 60000) {
      var v = 0; try { var st = window.OPPET && window.OPPET.barStatus ? window.OPPET.barStatus(bar) : null; v = st && st.open ? 0.5 : 0; } catch (e) {}
      o = openC[id] = [now, v];
    }
    return o[1] + (RANK[k] || 0) * 0.07;
  }
  // a1map I-08: the icon discs (70 % core, container px) a full pill may not cover: pins from DOT_Z, quiet dots where they are
  // single (no clusters, Leaflet z >= 15)
  function icoDiscs(list, z, size) {
    var out = [], k = zk(z) * 16 * 0.7;
    list.forEach(function (x) {
      if (!(x.pin ? z >= DOT_Z : z >= CL_MAXZ + 2)) return;
      var p = map.latLngToContainerPoint([+x.c.bar.lat, +x.c.bar.lng]), r = k * (x.sel ? 1.25 : 1);
      if (p.x < -40 || p.y < -40 || p.x > size.x + 40 || p.y > size.y + 40) return;
      out.push({ id: x.c.bar.id, 0: p.x - r, 1: p.y - r, 2: p.x + r, 3: p.y + r });
    });
    return out;
  }
  function sync() {
    if (!on || !A) return;
    var m = gm; if (!m || !layersReady) return;
    var t0 = performance.now(), z = map.getZoom(), hi = z >= 16, xlo = z < 12.5, feats = [], cfeats = [], used = {}, n = 0, list = [], sun = season();
    byId = {}; parts = {}; meAt = null;
    (A.layers || []).forEach(function (ly) {
      if (!ly || !ly.eachLayer) return;
      ly.eachLayer(function (mk) {
        var c = mk.options && mk.options.olnuC, io = mk.options && mk.options.icon && mk.options.icon.options; if (!c || !c.bar || !io) return;
        var ic = mk.getElement && mk.getElement(), s = withVt(parse(io.html || "", io.className || ""), c.bar);   // map BR1
        var empty = !((c.beers && c.beers.length) || (c.rallies && c.rallies.length) || (c.cis && c.cis.length));
        list.push({ mk: mk, c: c, s: s, full: mk._olnuTier === "f", sel: !!(ic && ic.classList.contains("cm-sel")), prio: (mk.options.olnuPrio || 0),
          empty: empty, pin: !empty || !!s.king || !!s.ev });   // a1map I-27: a pin can be a full pill zoomed out: never clustered
      });
    });
    // mapart P3b: walk the full pills best first; a pill whose real image box (−2 px) touches one already placed shows as a dot.
    // The selected bar is never demoted. Only pills near the view count (off-screen ones keep their tier).
    var size = map.getSize(), placed = [], demoted = 0, discs = icoDiscs(list, z, size);
    list.filter(function (x) { return x.full; }).sort(function (a, b) { return (b.sel ? 1 : 0) - (a.sel ? 1 : 0) || b.prio - a.prio; }).forEach(function (x) {
      x.im = image(m, x.s, xlo ? "x" : "f", hi, { sel: x.sel });
      var p = map.latLngToContainerPoint([+x.c.bar.lat, +x.c.bar.lng]), k = (x.sel ? 1.25 : 1) * zk(z), W = x.im.data.width / R, H = x.im.data.height / R;   // map M2
      if (p.x < -150 || p.y < -150 || p.x > size.x + 150 || p.y > size.y + 150) return;
      var b = [p.x - x.im.ox * k + 2, p.y - x.im.oy * k + 2, p.x + (W - x.im.ox) * k - 2, p.y + (H - x.im.oy) * k - 2];
      var hit = function (q) { return String(q.id) !== String(x.c.bar.id) && b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]; };
      if (!x.sel && (placed.some(hit) || discs.some(hit))) { x.full = false; demoted++; return; }   // a1map I-08: + another bar's icon
      placed.push(b);
    });
    list.forEach(function (x) {
      var s = x.s, c = x.c, mk = x.mk, full = x.full, sel = x.sel, mode = full ? (xlo ? "x" : "f") : "d";
      var im = full ? (x.im || image(m, s, mode, hi, { sel: sel })) : null, di = spr.ok ? dotName(s) : "";
      if (!di) {   // no sprite (yet): the canvas dot, centred
        var dk = keyOf(s, "d", hi), dimg = image(m, s, "d", hi); used[dimg.k] = 1; di = dk + "c";
        if (!m.hasImage(di)) m.addImage(di, centred(dimg), { pixelRatio: R }); used[di] = 1;
        if (!im) im = dimg;
      } else if (!im) {   // a sprite dot (map B9 + M2: Ø 32 image px, the full disc; zk() scales it; the box is centred on the point)
        var dr = 16;
        im = { k: di, ox: dr, oy: dr, bottom: dr, parts: [{ sel: ".bar-ico", bb: [-dr, -dr, dr, dr] }], data: { width: 2 * dr * R, height: 2 * dr * R } };
      }
      used[im.k] = 1;
      var empty = x.empty, pin = x.pin || !cl.on, rk = rankOf(c.bar, s);   // a1map I-08: + type / open rank (< 1)
      var prio = x.prio + rk + (full ? 10000 : 0) + (sel ? 1e6 : 0), busy = !!(s.p || s.hot);
      if (c.cis && c.cis.some(function (q) { return q && q.is_mine; })) meAt = { id: String(c.bar.id), ll: [+c.bar.lat, +c.bar.lng], r: 16 * (sel ? 1.25 : 1) };   // I-28
      // the name sits 3 px under its own pill image: the pills are GL collision boxes now (mapart P3b), a name that
      // touched its own pill box was always hidden
      var lblTop = Math.max(18, Math.ceil(im.bottom) + 1);   // just clear of its own image box (GL collision); image px (M2)
      var id = String(c.bar.id);
      byId[id] = mk; parts[id] = { im: im, sz: sel ? 1.25 : 1, ll: [+c.bar.lat, +c.bar.lng], t: full ? 1 : 0, e: empty ? 1 : 0, s: s, sel: sel, dem: x.full !== (mk._olnuTier === "f"),
        lt: lblTop, lw: 0, lh: 0, pin: pin };
      var at = full && s.name ? attrsOf(c.bar, sun) : "", lim = full && s.name ? label(m, s.name, at) : null, li = lim ? lim.k : "";
      if (lim) { parts[id].lw = lim.w; parts[id].lh = lim.h || 18; parts[id].at = at; }
      if (li) used[li] = 1;
      var g = { type: "Point", coordinates: [+c.bar.lng, +c.bar.lat] };
      if (pin || full) feats.push({ type: "Feature", id: ++n, geometry: g,
        properties: { id: id, t: full ? 1 : 0, dh: pin ? 1 : 0, img: full ? im.k : "", di: di, oi: full ? offIndex(-im.ox, -im.oy) : 0, sz: sel ? 1.25 : 1, e: empty ? 1 : 0, sk: prio, skf: -prio,
          bf: s.p && s.p.f ? 1 : 0, bs: busy ? 1 : 0, b2: s.king && spr.ok && (!empty || z >= DOTE_Z) ? "badge-king" : "",
          li: li, lo: offIndex(0, lblTop) } });
      // a1map I-27: the quiet bar's dot = zoom-free data (no tier, no zoom in it): a zoom never re-sends this source
      if (!pin) cfeats.push({ type: "Feature", geometry: g, properties: { id: id, t: 0, dh: 1, di: di, sz: sel ? 1.25 : 1, e: 1, sk: x.prio + rk + (sel ? 1e6 : 0), bf: 0, bs: busy ? 1 : 0, b2: "" } });
    });
    placeFeats.forEach(function (f) { f.id = ++n; feats.push(f); used[f.properties.img] = 1; });
    stats.demoted = demoted;
    if (offsDirty) {   // a new offset: the layers' offset tables first (the label layer reads its own row "lo")
      offsDirty = false; lastSig = "";
      try { var oe = offExpr(); m.setLayoutProperty(L_FULL, "icon-offset", oe); m.setLayoutProperty(L_PLACE, "icon-offset", oe);
        m.setLayoutProperty(L_LBL, "icon-offset", JSON.parse(JSON.stringify(oe).replace('["get","oi"]', '["get","lo"]'))); } catch (e) {}
    }
    clSplit(m, cfeats);   // ds30 + a1map I-27
    meDraw(m);   // a1map I-28
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
  // map BR1: nattmat and kebab / pizza / grill places get the döner glyph
  var KEBAB_RX = /(kebab|kebap|d[öo]ner|falafel|pizz|gatuk[öo]k|shawarma|gyros|grill(?!bar)|korv)/i;
  function placeImage(m, p) {
    var pk = p.nm ? "kebab" : /^(fast_food|fastfood)$/.test(p.type) && KEBAB_RX.test(p.name || "") ? "kebab" : p.type;
    var P = art(), k = "pl|" + pk + "|" + (p.lbl ? p.name : ""), im = imgs[k];
    if (!im && P) {
      try {
        var ops = P.placeOps(pk).ops.slice();
        if (p.lbl && p.name) P.labelOps(String(p.name), true).ops.forEach(function (o) { var q = Object.assign({}, o); q.y = (q.y || 0) + Math.round((window.PNTOKENS ? window.PNTOKENS.size.placeDot : 16) / 2) + 1; ops.push(q); });   // ownerfix 3: under the disc
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

  /* ds30 barcl START — owner 2026-11-08: "zoomed out only some bars show; zoom in and more come". Bars that are a DOT (not a
     full pill) now go into a Mapbox GL cluster source (supercluster in the map's worker: no per-frame JS, they move with the
     map in the same frame). Zoomed out they merge into ONE marker per area: navy capsule + foam ring + bar glyph + count, a
     second capsule behind it (stack cue, like the people cluster). Busy bar inside = amber ring, friend inside = green dot.
     Full pills (friends / people / check-ins / call-outs: tiers.js priority) stay out of it, always on top.
     Tap a cluster = zoom in to where it splits (getClusterExpansionZoom). From Leaflet z15 (GL 14) every bar is its own dot
     again. The dot / badge layers are clones of the old ones on the cluster source (same images, same rules). */
  var SRC_CL = "olnu-bars-cl", L_CL = "olnu-bar-cl", L_CDOT = "olnu-bar-cdot", L_CDOTE = "olnu-bar-cdote", L_CB1 = "olnu-bar-cdotb1", L_CB2 = "olnu-bar-cdotb2";
  var L_CDOTF = "olnu-bar-cdotf";   // map B8: empty dots from Leaflet z16, always drawn (they block names, names never hide them)
  var L_BLK = "olnu-bar-blk";   // a1map I-08: invisible pin discs (collision only)
  var CL_IDS = [L_CDOTE, L_CDOT, L_CB1, L_CB2, L_CL, L_BLK];   // cifix3: L_CDOTF is no layer any more (a1map I-27): only real ids here
  // cifix3: ONE list of every GL venue layer: the BAREA editor hide/restore (editVis) and _layers() use it
  function venueIds() { return [L_PLACE, L_DOT, L_DOTE, L_DOTB1, L_DOTB2, L_LBL, L_FULL].concat(CL_IDS); }
  var CL_MAXZ = 13, CL_MINZ = 9, CL_R = 52;   // GL zooms (Leaflet = GL + 1): clusters up to Leaflet 14, one dot per bar from Leaflet 15
  var cl = { on: false, sig: "", feats: [], seen: null, seenAt: 0, hooked: null, made: 0 };
  function clOps(n, busy, friend) {
    var T = window.PNTOKENS, K = T.col, ops = [], t = n > 999 ? (Math.floor(n / 100) / 10).toString().replace(".", ",") + "k" : String(n);
    // a1map I-09 (owner: "the cluster is smaller than one pin"): never smaller than a bar pin (Ø 32) and a step bigger with the
    // count: 2–4 = 34 px · 5–9 = 38 px · 10+ = 42 px high (ring, navy body, glyph + count: the pin look)
    var st = clStep(n), px = st[2], h = st[0], g = st[1], tw0 = window.PNPINS && window.PNPINS._tw ? Math.ceil(window.PNPINS._tw(t, px, 700)) : t.length * 8;
    var w = Math.max(h + 10, 8 + g + 4 + tw0 + 10), x = Math.round(-w / 2), y = -h / 2, ring = busy ? K.amber : K.foam;
    // ds44: no stack cue (owner: it read as a ghost pill behind the cluster) — one capsule
    // the front capsule: ink hairline, ring, navy body, bar glyph + the count
    ops.push({ o: "rr", x: x - 1, y: y - 1, w: w + 2, h: h + 2, r: h / 2 + 1, fill: K.edge, sh: true });
    ops.push({ o: "rr", x: x, y: y, w: w, h: h, r: h / 2, fill: ring });
    ops.push({ o: "rr", x: x + 2, y: y + 2, w: w - 4, h: h - 4, r: h / 2 - 2, fill: K.navy2 });
    ops.push({ o: "g", n: "pub", x: x + 8, y: -g / 2, s: g, fg: T.tint.pub, bg: K.navy2 });
    ops.push({ o: "t", x: x + 8 + g + 4, y: 0, t: t, px: px, wt: 700, fill: K.foam });
    if (friend) {   // a friend at a bar inside: the green friend badge, top-right (same badge as on a dot)
      var bx = x + w - 4, by = y + 3;
      ops.push({ o: "c", x: bx, y: by, r: 8, fill: K.edge }); ops.push({ o: "c", x: bx, y: by, r: 7, fill: K.foam });
      ops.push({ o: "c", x: bx, y: by, r: 5.5, fill: K.green }); ops.push({ o: "g", n: "person", x: bx - 4.5, y: by - 4.5, s: 9, fg: K.greenInk, bg: K.green });
    }
    return ops;
  }
  function clStep(n) { return n >= 10 ? [42, 22, 16] : n >= 5 ? [38, 20, 15] : [34, 18, 14]; }   // [height, glyph, text px]
  function clImage(m, id) {
    var q = /^pncl-(\d+)-([01])([01])$/.exec(id || ""), P = window.PNPINS; if (!q || !P || !P.raster || m.hasImage(id)) return;
    try {
      var ops = clOps(+q[1], q[2] === "1", q[3] === "1"), b = P.bboxOf(ops), e = Math.ceil(Math.max(-b[0], -b[1], b[2], b[3]));
      var r = P.raster(ops, R, [-e, -e, e, e]);   // square and centred on the point
      m.addImage(id, r.canvas.getContext("2d").getImageData(0, 0, r.canvas.width, r.canvas.height), { pixelRatio: R }); cl.made++;
    } catch (x) {}
  }
  function clEnsure(m) {
    try {
      if (cl.hooked !== m) { cl.hooked = m; m.on("styleimagemissing", function (e) { if (e && /^pncl-/.test(e.id)) clImage(m, e.id); }); m.on("zoom", clZoomRule); }
      if (!m.getSource(SRC_CL)) {
        m.addSource(SRC_CL, { type: "geojson", data: EMPTY, cluster: true, clusterRadius: CL_R, clusterMaxZoom: CL_MAXZ, clusterMinPoints: 2, maxzoom: 15,
          buffer: 64, tolerance: 0, clusterProperties: { f: ["+", ["get", "bf"]], b: ["+", ["get", "bs"]] } });
        cl.sig = "";
      }
      var byL = {}; ((m.getStyle() || {}).layers || []).forEach(function (l) { byL[l.id] = l; });
      var un = ["!", ["has", "point_count"]];
      var clone = function (src, id) {   // the old dot / badge layer, on the cluster source, single points only
        var o = byL[src]; if (!o || m.getLayer(id)) return;
        var c = JSON.parse(JSON.stringify(o)); c.id = id; c.source = SRC_CL; c.minzoom = CL_MINZ; delete c.maxzoom; delete c.slot;
        c.filter = o.filter ? ["all", un, o.filter] : un;
        // map B8: the dots are placed BEFORE the names (layer above = placed first) and block them (still always drawn):
        // a long name that would cover another bar's icon hides, the icon stays (badges keep ignoring placement)
        if (/cdote?$/.test(id)) c.layout["icon-ignore-placement"] = false;
        if (id === L_CDOTE) {   // a1map I-08 / I-27: ONE layer for the quiet dots at every zoom (no cdote → cdotf hand-off at z16):
          // they hide only when their disc touches a better icon (no padding; bar > pub > nightclub > restaurant > café),
          // never under a pill or a name; from Leaflet z16 every one is drawn (map B8: clZoomRule switches the overlap rule)
          c.layout["icon-allow-overlap"] = false; c.layout["icon-padding"] = 0; c.layout["symbol-sort-key"] = ["-", 0, ["get", "sk"]];
          c.paint = { "icon-opacity": 0.82, "icon-emissive-strength": 1 };
        }
        m.addLayer(c);   // a1map I-08: above the pills: placed first, so a pill or a name never hides an icon
      };
      clone(L_DOTE, L_CDOTE); clone(L_DOT, L_CDOT); clone(L_DOTB1, L_CB1); clone(L_DOTB2, L_CB2);
      if (!m.getLayer(L_CL)) m.addLayer({ id: L_CL, type: "symbol", source: SRC_CL, minzoom: CL_MINZ, filter: ["has", "point_count"],
        layout: { "icon-image": ["concat", "pncl-", ["to-string", ["get", "point_count"]], "-", ["case", [">", ["get", "b"], 0], "1", "0"], ["case", [">", ["get", "f"], 0], "1", "0"]],
          "icon-anchor": "center", "icon-allow-overlap": true, "icon-ignore-placement": false, "icon-padding": 0, "symbol-sort-key": ["get", "point_count"],
          "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" }, paint: { "icon-emissive-strength": 1 } });   // map B8: a name never covers a cluster
      // a1map I-08: the pins' discs (drawn under the pills) as invisible boxes placed first: a quiet dot never sits on a pin
      if (!m.getLayer(L_BLK) && byL[L_DOT]) { var bk = JSON.parse(JSON.stringify(byL[L_DOT])); bk.id = L_BLK; bk.filter = byL[L_DOT].filter.slice(0, 2);
        bk.layout["icon-ignore-placement"] = false; bk.paint = { "icon-opacity": 0 }; m.addLayer(bk); }
      clZoomRule();
      cl.on = !!(m.getSource(SRC_CL) && m.getLayer(L_CL) && m.getLayer(L_CDOT));
    } catch (e) { cl.on = false; try { console.warn("olnu glmap cl", e && e.message); } catch (x) {} }
    return cl.on;
  }
  // map B8 kept: from Leaflet z16 (GL 15) no quiet dot is left out; below that they thin out by collision (one layer, a1map I-27)
  var clOver = null;
  function clZoomRule() {
    var m = gm || cl.hooked; if (!m || !m.getLayer || !m.getLayer(L_CDOTE)) return;
    var v = m.getZoom() >= 15; if (v === clOver && m.getLayoutProperty(L_CDOTE, "icon-allow-overlap") === v) return;
    clOver = v; try { m.setLayoutProperty(L_CDOTE, "icon-allow-overlap", v); } catch (e) {}
  }
  // sync(): the quiet bars' dots live in the cluster source; pins, full pills + places stay in the main source
  function clSplit(m, dots) {   // a1map I-27: the quiet bars' dots (zoom-free properties: a zoom alone never re-sends them)
    if (!cl.on || !m.getSource(SRC_CL)) return;
    var sig = dots.map(function (f) { var p = f.properties; return p.id + p.di + p.e + p.bf + p.bs + p.b2 + p.sz + "~" + p.sk + "~" + f.geometry.coordinates[0] + "," + f.geometry.coordinates[1]; }).join("|");
    if (sig !== cl.sig) { cl.sig = sig; cl.feats = dots; cl.seenAt = 0; try { m.getSource(SRC_CL).setData({ type: "FeatureCollection", features: dots }); } catch (e) {} stats.clSets = (stats.clSets || 0) + 1; }
    stats.clDots = dots.length;
  }
  // which dot bars are drawn on their own right now (not inside a cluster, not thinned out): cached 250 ms
  function clShown(id) {
    if (!cl.on || !gm) return false;
    if (!cl.seen || performance.now() - cl.seenAt > 250) {
      cl.seen = {}; cl.seenAt = performance.now();
      try { gm.queryRenderedFeatures({ layers: [L_CDOT, L_CDOTE, L_CDOTF].filter(function (l) { return gm.getLayer(l); }) }).forEach(function (f) { cl.seen[String(f.properties.id)] = 1; }); } catch (e) {}
    }
    return !!cl.seen[String(id)];
  }
  function clTap(m, p, e) {
    var best = null, bd = 1e9;
    try {
      m.queryRenderedFeatures([[p.x - 24, p.y - 24], [p.x + 24, p.y + 24]], { layers: [L_CL] }).forEach(function (f) {
        var q = m.project(f.geometry.coordinates), d = Math.abs(q.x - p.x) + Math.abs(q.y - p.y); if (d < bd) { bd = d; best = f; }
      });
    } catch (x) { return false; }
    if (!best) return false;
    var c = best.geometry.coordinates.slice(), n = best.properties.point_count, src = m.getSource(SRC_CL), done = false;
    var go = function (err, ez) {
      if (done) return; done = true;
      var z = m.getZoom(), to = Math.min(Math.max(isFinite(ez) && !err ? ez + 0.3 : z + 2, z + 1), CL_MAXZ + 1.5);
      var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      m.easeTo({ center: c, zoom: to, duration: still ? 0 : 420 });
    };
    try { var pr = src.getClusterExpansionZoom(best.properties.cluster_id, go); if (pr && pr.then) pr.then(function (z) { go(null, z); }, function () { go(1); }); } catch (x) { go(1); }
    setTimeout(function () { go(1); }, 600);   // no answer from the worker: zoom in 2 steps
    stats.taps++; stats.lastTap = "cluster:" + n; tapAt = performance.now();
    if (e.originalEvent) e.originalEvent._olnuGl = 1;
    return true;
  }
  /* ds30 barcl END */
  /* a1map I-28 (owner 2026-11-12: "my dot sat on top of the Pitchers icon"): my position in GL. The blue dot is UNDER every
     bar / food icon; a thin blue ring, bigger than a bar icon, is OVER them, so "where am I" stays clear and the bar icon
     on my spot stays readable. Checked in at a bar in view: no dot, a blue ring + "Du" tag on that bar's icon instead.
     app-map.js showMe() calls GLBARS.me(); the DOM me-dot is hidden while GL draws (and sits under the bar panes without GL). */
  var SRC_ME = "olnu-me", L_MED = "olnu-me-dot", L_MER = "olnu-me-ring", L_MEDU = "olnu-me-du", meLL = null, meAt = null, meSig = "";
  function duImage(m) {
    if (m.hasImage("pn-du")) return;
    var w = 26, h = 16, cv = document.createElement("canvas"), x = cv.getContext("2d"); cv.width = (w + 4) * R; cv.height = (h + 4) * R; x.scale(R, R);
    x.fillStyle = "#ffffff"; x.beginPath(); x.roundRect ? x.roundRect(0, 0, w + 4, h + 4, (h + 4) / 2) : x.rect(0, 0, w + 4, h + 4); x.fill();
    x.fillStyle = "#2B6FD6"; x.beginPath(); x.roundRect ? x.roundRect(2, 2, w, h, h / 2) : x.rect(2, 2, w, h); x.fill();
    x.fillStyle = "#ffffff"; x.font = "700 11px " + FONT; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(L1("Du", "You"), (w + 4) / 2, (h + 4) / 2 + 0.5);
    m.addImage("pn-du", x.getImageData(0, 0, cv.width, cv.height), { pixelRatio: R });
  }
  function L1(sv, en) { return window.I18N && window.I18N.lang === "en" ? en : sv; }
  function meEnsure(m) {
    try {
      if (!m.getSource(SRC_ME)) { m.addSource(SRC_ME, { type: "geojson", data: EMPTY }); meSig = ""; }
      var rr = ["interpolate", ["linear"], ["zoom"]]; ZK.forEach(function (q) { rr.push(q[0], ["*", ["get", "s"], 16 * q[1] + 5]); });   // the bar disc + 5 px
      if (!m.getLayer(L_MED)) m.addLayer({ id: L_MED, type: "circle", source: SRC_ME, filter: ["==", ["get", "k"], "dot"],
        paint: { "circle-radius": 8, "circle-color": "#4AA3FF", "circle-stroke-width": 3, "circle-stroke-color": "#ffffff", "circle-emissive-strength": 1 } }, m.getLayer(L_PLACE) ? L_PLACE : undefined);
      if (!m.getLayer(L_MER)) m.addLayer({ id: L_MER, type: "circle", source: SRC_ME, filter: ["!=", ["get", "k"], "dot"],
        paint: { "circle-radius": rr, "circle-opacity": 0, "circle-stroke-width": 2.5, "circle-stroke-color": "#4AA3FF", "circle-stroke-opacity": 0.95, "circle-emissive-strength": 1 } });
      duImage(m);
      if (!m.getLayer(L_MEDU)) m.addLayer({ id: L_MEDU, type: "symbol", source: SRC_ME, filter: ["==", ["get", "k"], "du"],
        layout: { "icon-image": "pn-du", "icon-anchor": "center", "icon-offset": ["literal", [-15, -17]], "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.75, 14, 0.875, 15, 1],
          "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" }, paint: { "icon-emissive-strength": 1 } });
    } catch (e) { try { console.warn("olnu glmap me", e && e.message); } catch (x) {} }
  }
  function meDraw(m) {
    if (!m || !m.getSource || !m.getSource(SRC_ME)) return;
    var f = [], pt = function (ll, p) { f.push({ type: "Feature", geometry: { type: "Point", coordinates: [ll[1], ll[0]] }, properties: p }); };
    if (meAt) { pt(meAt.ll, { k: "du", s: meAt.r / 16 }); }
    else if (meLL) { pt(meLL, { k: "dot", s: 1 }); pt(meLL, { k: "ring", s: 1 }); }
    var sig = JSON.stringify(f); if (sig === meSig) return; meSig = sig;
    try { m.getSource(SRC_ME).setData({ type: "FeatureCollection", features: f }); } catch (e) {}
  }
  /* ---------- tap ---------- */
  var synth = false, tapAt = -1e9;
  // map B8 (owner 2026-11-09: a long name of bar A reaching toward bar B stole the tap from B's icon): ICONS decide.
  //   1. the finger is on a bar's disc (its radius + 6 px): the nearest disc wins, full pill or dot;
  //   2. a direct hit on a full pill's count badge / chip (± 2 px): best priority first (the "Folk här" folds);
  //   3. a bar cluster; 4. the nearest icon centre within 28 px; 5. the name label (fallback only); 6. a restaurant dot.
  var TAP_NEAR = 28, TAP_DISC = 6;
  function icoR(id) {   // a bar's drawn disc radius (CSS px), from its image parts
    var x = parts[String(id)], b = x && x.im && x.im.parts.filter(function (q) { return q.sel === ".bar-ico"; })[0];
    return (b ? (b.bb[2] - b.bb[0]) / 2 : 14) * (x && x.sz || 1) * zk(map.getZoom());   // map M2
  }
  function onPreclick(e) {
    if (!on || synth || !gm || !layersReady || !e || !e.latlng) return;
    var m = gm, z = map.getZoom();
    try {
      var p = m.project([e.latlng.lng, e.latlng.lat]), hit = null, how = "", B = TAP_NEAR + 6;
      var lays = [L_FULL].concat(z >= DOT_Z || cl.on ? (cl.on ? [L_DOT, L_DOTE, L_CDOT, L_CDOTE, L_CDOTF] : [L_DOT, L_DOTE]) : []).filter(function (l) { return m.getLayer(l); });
      var near = {};   // bar id -> { f, d (px from its icon centre), r (disc radius) }; the full pill feature wins over its own dot
      m.queryRenderedFeatures([[p.x - B, p.y - B], [p.x + B, p.y + B]], { layers: lays }).forEach(function (f) {
        if (f.layer.id !== L_FULL && z < DOT_Z && f.source !== SRC_CL) return;   // hidden by the zoom rule
        var id = String(f.properties.id); if (!byId[id]) return;
        var q = m.project(f.geometry.coordinates), d = Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y)), o = near[id];
        if (!o || (f.layer.id === L_FULL && o.f.layer.id !== L_FULL)) near[id] = { f: f, d: d, r: icoR(id) };
      });
      var list = Object.keys(near).map(function (k) { return near[k]; }).sort(function (a, b) { return a.d - b.d; });
      var onDisc = list.filter(function (o) { return o.d <= o.r + TAP_DISC; })[0];
      if (onDisc) { hit = onDisc.f; how = "disc"; }
      if (!hit) list.forEach(function (o) {   // 2: a full pill's count badge / chip
        if (o.f.layer.id !== L_FULL) return;
        var pi0 = parts[String(o.f.properties.id)]; if (!pi0) return;
        var k0 = pi0.sz * zk(z), bp0 = m.project(o.f.geometry.coordinates), dx0 = (p.x - bp0.x) / k0, dy0 = (p.y - bp0.y) / k0;   // map M2
        if (!pi0.im.parts.some(function (x) { return x.sel !== ".bar-ico" && dx0 >= x.bb[0] - 2 && dx0 <= x.bb[2] + 2 && dy0 >= x.bb[1] - 2 && dy0 <= x.bb[3] + 2; })) return;
        if (!hit || o.f.properties.sk > hit.properties.sk) { hit = o.f; how = "part"; }
      });
      if (!hit && cl.on && clTap(m, p, e)) return;   // ds30
      if (!hit && list.length && list[0].d <= TAP_NEAR) { hit = list[0].f; how = "near"; }
      if (!hit && m.getLayer(L_LBL)) {   // 5: the name, only when no icon is near
        var lf = m.queryRenderedFeatures([[p.x - 3, p.y - 3], [p.x + 3, p.y + 3]], { layers: [L_LBL] })[0];
        if (lf && byId[String(lf.properties.id)]) { hit = lf; how = "name"; }
      }
      if (!hit && placeTap) {   // a restaurant dot
        var pf = m.queryRenderedFeatures([[p.x - 14, p.y - 14], [p.x + 14, p.y + 14]], { layers: [L_PLACE] })[0]   /* ownerfix 3: bigger dot, bigger box */, pl = pf && placeById[String(pf.properties.id)];
        if (pl) { stats.taps++; stats.lastTap = "place:" + pl.id; if (e.originalEvent) e.originalEvent._olnuGl = 1; synth = true; try { placeTap(pl); } finally { synth = false; } return; }
      }
      if (!hit) return;
      var id = String(hit.properties.id), mk = byId[id], el = mk && mk.getElement && mk.getElement(); if (!el) return;
      // which part was tapped (same folds as a tap on the DOM marker)
      var bp = m.project([mk.getLatLng().lng, mk.getLatLng().lat]), pi = parts[id], kk = (pi ? pi.sz : 1) * zk(z), dx = (p.x - bp.x) / kk, dy = (p.y - bp.y) / kk, sel = ".bar-ico";
      if (hit.properties.t === 1 && pi) pi.im.parts.forEach(function (x) { if (dx >= x.bb[0] - 2 && dx <= x.bb[2] + 2 && dy >= x.bb[1] - 2 && dy <= x.bb[3] + 2 && x.sel !== ".bar-ico") sel = x.sel; });
      var tgt = el.querySelector(sel) || el;
      stats.taps++; stats.lastTap = id + sel; stats.tapHow = how; tapAt = performance.now();
      if (e.originalEvent) e.originalEvent._olnuGl = 1;   // map3d.js: this tap is used
      synth = true;
      // glfix: our own click event, flagged too: it bubbles to the map, and map3d.js (3D house tap → BARLIT.open → a 2nd click
      // on the same marker) must skip it, else Leaflet toggles the just-opened popup closed again
      try { var ev = new MouseEvent("click", { bubbles: true, cancelable: true, view: window }); ev._olnuGl = 1; tgt.dispatchEvent(ev); } finally { synth = false; }
    } catch (x) {}
  }

  /* ---------- on / off ---------- */
  var CSS = "html[data-glbars] .leaflet-bars-pane,html[data-glbars] .leaflet-hotbars-pane{display:none}" +
    "html[data-glbars] .me-dot{display:none !important}" +   // a1map I-28: GL draws it (meEnsure)
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
    venueIds().forEach(function (id) { try { gm.setLayoutProperty(id, "visibility", v ? "none" : "visible"); } catch (e) {} });
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
    "@media (prefers-reduced-motion:no-preference){.pk-pin:not(.pk-sk) .pk-r{animation:pkRing 1.8s var(--e-std) infinite}}" +
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
    // a1map I-28: app-map.js showMe(): my position (drawn in GL under the bar icons while GL is on). true = GL draws it.
    me: function (lat, lng) { meLL = isFinite(+lat) && isFinite(+lng) ? [+lat, +lng] : null; if (on && gm && layersReady) meDraw(gm); return on; },
    _me: function () { return { ll: meLL, at: meAt, sig: meSig, layers: [L_MED, L_MER, L_MEDU] }; },
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
        var x = parts[id], im = x.im; if (!x.t && (x.pin ? z < DOT_Z : !clShown(id))) return;
        var p = map.latLngToContainerPoint(x.ll); if (p.x < -120 || p.y < -120 || p.x > size.x + 120 || p.y > size.y + 120) return;
        var k = x.sz * zk(z), W = im.data.width / R, H = im.data.height / R;   // map M2
        out.push({ l: p.x - im.ox * k, t: p.y - im.oy * k, r: p.x + (W - im.ox) * k, b: p.y + (H - im.oy) * k, id: id, t1: x.t });
        if (x.t && x.lw) out.push({ l: p.x - x.lw * k / 2, t: p.y + x.lt * k, r: p.x + x.lw * k / 2, b: p.y + (x.lt + (x.lh || 18)) * k, id: id, lbl: 1 });
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
          pill: !!(x.t && s.p), dem: !!x.dem, icoW: ico ? +((ico.bb[2] - ico.bb[0]) * x.sz * zk(z)).toFixed(1) : 0, lbl: !!placed[id], name: s.name,
          shown: !!x.t || (x.pin ? z >= DOT_Z : clShown(id)) });
      });
      return out;
    },
    _layers: function () { return [L_CLOUD, L_HEAT, L_PLACE, L_DOTE, L_DOT, L_DOTB1, L_DOTB2, L_LBL, L_FULL].concat(cl.on ? CL_IDS : []).filter(function (id) { return !gm || gm.getLayer(id); }); },
    _cl: function () { return { on: cl.on, dots: cl.feats.length, ids: cl.feats.map(function (f) { return f.properties.id; }).sort().join(), made: cl.made, maxz: CL_MAXZ + 1, src: SRC_CL, layer: L_CL, step: clStep }; },   // ds30 tests (+ a1map I-09)
    // places.js: the restaurant dots it chose (GL draws them under the bars); false = GL is off (keep the DOM dots)
    places: setPlaces,
    // map3d.js: a map click right after a GL bar tap (same finger) is that tap, not a tap on the 3D house under it
    tappedAt: function () { return tapAt; },
    // mbx: is this bar drawn in GL right now (full, or a dot the zoom rules show)? (mypins.js: else it draws its own chip)
    shown: function (id) {
      var x = parts[String(id)]; if (!on || !x || !map) return false;
      var z = map.getZoom(); if (!x.t && (x.pin ? z < DOT_Z : !clShown(id))) return false;
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
    _feats: function () { try { return gm.getSource(SRC_B)._data.features.concat(cl.feats).map(function (f) { return f.properties; }); } catch (e) { return []; } },
    _marker: function (id) { return byId[String(id)] || null; },
    _vt: function (id) { var x = parts[String(id)]; return x ? { k: x.s.k, at: x.at || "" } : null; },   // map BR1 tests
    _img: function (id) { var x = parts[String(id)]; return x ? { k: x.im.k, ox: x.im.ox, oy: x.im.oy, bottom: x.im.bottom, parts: x.im.parts } : null; }
  };
})();
