/* PintsNow — 🗺️ KARTZONER: kommun / län zones on the zoomed-out map (CONTRACT "KARTZONER"; owner 2026-11-07).
   window.ZONES, app.js mods(): init, onPoll, onPublicPoll. Loaded after glmap.js. Mapbox GL only (the raster fallback has no zones).
   - Leaflet zoom < 6.6: the 21 län · 6.6 – 10.5: the 290 kommuner (fade out 9.5 → 10.5, the bar pills / heat take over from 11).
     Colour = people out tonight (absolute steps, same for everyone): 0 · några (1–2) · 3–9 · 10–24 · 25+; a calm static glow
     on the border of a zone with 10+ (no pulse: no per-frame work, ≤ 2 Hz rule kept).
   - Labels (images, like the GL bar names): län = name · "🍺 47 ute" / "🍺 några ute" / "lugnt" · "👑 Ludvika" (busiest kommun);
     kommun (only where someone is out) = name · count · "👑 Pitchers" (busiest bar, ≥ 3 there). GL collision: busiest first.
   - Top bar: #live-count shows the zone under the map centre ("Dalarna · 47 ute ikväll", "Sverige · …" when the whole
     country is in view); app.js updateCounts() asks ZONES.pill(). Zoomed in = the normal world counter.
   - Tap a zone = zoom in (län → its kommuner, kommun → its bars). A GL bar tap (glmap.js) wins. If GL has not drawn the
     zone layer at the tap yet, the zone is found in JS (zoneAt) from the same border files.
   - Borders: docs/zones/lan.json + kommuner.json (SCB Digitala gränser, CC0, simplified; ~65 KB gzip), fetched only the first
     time the map is zoomed out below 10.5. Counts: RPC zone_counts (0221, cached 60 s on the server; < 3 = "några", never a
     position), asked when zones are in view and the last answer is > 60 s old (shared poll + moveend), never while hidden. */
(function () {
  "use strict";
  var A = null, map = null, gm = null, hooked = null, ready = false;
  var Z_OFF = 10.5, Z_KOM = 6.6, Z_SWE = 5.2, K_MIN = 3, AGE_MS = 60000;
  /* a1map I-11 (owner 2026-11-11): the Nordic view (Leaflet z < 4.8) = ONE chip per country ("Sverige 🍺 23 ute"), the län chips
     only from 4.8. Aggregate only, the same small-number rule (< 3 = "några"), no chip for a country with nobody out.
     Data: zone_counts total (Sweden). A drinks total (" · 340 öl") and other countries show when the server sends
     counts.drinks / counts.countries [{c, n, d, x, y}] (not in 0221: owner decision, see a1map DONE.md). */
  var Z_CTRY = 4.8, SCT = "olnu-zc-pt", L_CT = "olnu-zc-lbl", sigC = "";
  var CTRY = { SE: ["Sverige", "Sweden", 16.2, 62.4] };
  var AGE_IN = 5 * 60e3;   // fixM T-15: zoomed in only the top bar pill needs the counts: every 5 min (lane perf budget; a tap refreshes)
  var SK = "olnu-zk", SL = "olnu-zl", SKL = "olnu-zk-pt", SLL = "olnu-zl-pt";
  var L_LF = "olnu-zl-fill", L_LG = "olnu-zl-glow", L_LL = "olnu-zl-line", L_KF = "olnu-zk-fill", L_KG = "olnu-zk-glow", L_KT = "olnu-zk-lbl", L_LT = "olnu-zl-lbl", L_LQ = "olnu-zl-lblq", L_LC = "olnu-zl-lblc";
  var EMPTY = { type: "FeatureCollection", features: [] };
  /* map M1 (owner 2026-11-09): the border lines of ALL kommuner are gone (too many lines zoomed out). OWNER CHOICE, one line:
     "none" = (a) no kommun outline at all · "mine" = (b) one faint outline: the kommun you are in (last position, else home).
     Fill, glow, labels, the top-bar counts and the län borders stay. Dev / screenshots: localStorage olnu.map.kline = none|mine. */
  var KOMMUN_OUTLINE = "none";
  try { var kl0 = localStorage.getItem("olnu.map.kline"); if (kl0 === "none" || kl0 === "mine") KOMMUN_OUTLINE = kl0; } catch (e) {}
  var SKY = "olnu-zk-you", L_KY = "olnu-zk-you-line", youSig = "";
  var geo = { l: null, k: null }, geoP = { l: null, k: null }, byK = {}, byL = {};
  var counts = null, countsAt = 0, asking = false, lastPill = null, missing = false;
  var stats = { asks: 0, labels: 0, taps: 0, loadMs: {} };
  var FONT = '"Chakra Petch", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', R = 2;

  function glm() { try { var b = window.BASEMAP; return b && b.isMapbox() && b.mapbox() ? b.mapbox().getMapboxMap() : null; } catch (e) { return null; } }
  function zoom() { return map ? map.getZoom() : 99; }
  function wanted() { return !!(map && glm() && zoom() < Z_OFF); }
  function nf(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }

  /* ---------- borders (lazy) ---------- */
  function load(kind) {
    if (geo[kind]) return Promise.resolve(geo[kind]);
    if (geoP[kind]) return geoP[kind];
    var t0 = performance.now();
    geoP[kind] = fetch("./zones/" + (kind === "k" ? "kommuner" : "lan") + ".json").then(function (r) { if (!r.ok) throw new Error("zones " + r.status); return r.json(); })
      .then(function (fc) {
        geo[kind] = fc; stats.loadMs[kind] = Math.round(performance.now() - t0);
        (fc.features || []).forEach(function (f) { var p = f.properties; f.rings = rings(f.geometry); if (kind === "k") byK[p.k] = f; else byL[p.l] = f; });
        ensure(); paint(); cls(); pill(true);
        return fc;
      }).catch(function (e) { geoP[kind] = null; try { console.warn("olnu zones", e && e.message); } catch (x) {} return null; });
    return geoP[kind];
  }
  function rings(g) { return !g ? [] : g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []; }
  function inPoly(poly, x, y) {   // poly = [outer, holes…]
    var inside = false;
    for (var k = 0; k < poly.length; k++) {
      var r = poly[k], c = false;
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
        var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
      }
      if (k === 0) inside = c; else if (c) inside = false;
    }
    return inside;
  }
  // SCB's simplified coast leaves some town centres (Stockholm, Göteborg harbours) just outside: try points ~1–3 km around
  function zoneAt(kind, lat, lng) {
    var f = zoneAt0(kind, lat, lng); if (f) return f;
    for (var d = 0.01; d <= 0.031; d += 0.01) for (var a = 0; a < 8; a++) {
      f = zoneAt0(kind, lat + d * Math.sin(a * 0.785), lng + 2 * d * Math.cos(a * 0.785)); if (f) return f;
    }
    return null;
  }
  function zoneAt0(kind, lat, lng) {
    var fc = geo[kind]; if (!fc) return null;
    for (var i = 0; i < fc.features.length; i++) {
      var f = fc.features[i], b = f.properties.b;
      if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
      for (var j = 0; j < f.rings.length; j++) if (inPoly(f.rings[j], lng, lat)) return f;
    }
    return null;
  }

  /* ---------- counts ---------- */
  function lvl(n, some) { return n >= 25 ? 4 : n >= 10 ? 3 : n >= K_MIN ? 2 : (n > 0 || some) ? 1 : 0; }
  function kc(code) { var c = counts && counts.kk[code]; return c || null; }
  function lc(code) { var c = counts && counts.ll[code]; return c || null; }
  function testZone() { try { var l = A && A.lastLoc && A.lastLoc(); return !!(l && l.lat > 68.25 && l.lat < 68.45 && l.lng > 18.6 && l.lng < 19); } catch (e) { return false; } }
  function ask(force, minAge) {
    if (!A || !A.rpc || asking || document.hidden || !map) return;   // fixM T-15: the top bar pill needs the counts at every zoom
    if (!force && Date.now() - countsAt < (minAge || AGE_MS)) return;
    asking = true; stats.asks++;
    A.rpc("zone_counts", testZone() ? { p_test: true } : {}).then(function (r) {
      asking = false; countsAt = Date.now();   // fixM T-15: any answer counts for the rate limit (an odd answer is not retried every poll)
      if (!r || r.error) {
        // old server (no 0221): borders + names only, the top bar keeps the world counter; ask again in 10 min
        if (r && r.error && /zone_counts|PGRST202|does not exist|could not find/i.test(String(r.error.message || r.error.code || ""))) { missing = true; countsAt = Date.now() + 9 * 60000; pill(true); }
        else countsAt = Date.now() - AGE_IN + 30000;   // fixM: a failed ask (timeout, busy) is asked again at the next poll after 30 s
        return;
      }
      missing = false;
      var d = A.parseData ? A.parseData(r.data) : r.data;
      if (!d || !Array.isArray(d.kommun)) return;
      var kk = {}, ll = {};
      d.kommun.forEach(function (x) { if (x && x.c) kk[x.c] = { n: x.n | 0, some: x.n == null, bar: x.bar || null }; });
      (d.lan || []).forEach(function (x) { if (x && x.c) ll[x.c] = { n: x.n | 0, some: x.n == null, top: x.top || null }; });
      counts = { kk: kk, ll: ll, total: d.total | 0, some: !!d.some && d.total == null, k: d.k || K_MIN, at: d.at, drinks: d.drinks | 0, countries: d.countries || null };   // a1map I-11
      countsAt = Date.now();
      paint(); pill(true);
    });
  }

  /* ---------- labels (canvas images; the Standard style has no glyphs for our font) ---------- */
  var imgs = {}, imgWH = {}, mc = document.createElement("canvas").getContext("2d");
  function tw(s, f) { mc.font = f; return mc.measureText(s).width; }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  /* ds41 zonefr START — owner 2026-11-08 (7-zone-overlap.jpg): a friend pin + a group badge on the kommun centroid covered the
     zone pill. Now no people marker is drawn over the zones (CSS: html[data-zones] hides people pins + clusters); the friends
     are IN the pill instead: a row of up to 3 green initial discs + "Oskar" / "Oskar +2" (the clearest at city zoom: Snap Map
     and Zenly show friends as faces, never on top of a place name). The 🍺 / 👑 emoji are our glyphs now (PNGLYPHS pub /
     crown). Every pill is sized to its text: never cut. */
  function countLine(c) { return !c ? "lugnt" : c.some || !c.n ? "några ute" : nf(c.n) + " ute"; }
  function gl(g, name, x, y, s, col) {   // a PNGLYPHS glyph (24 grid) with its top-left at x, y
    try { var G = window.PNGLYPHS && window.PNGLYPHS.G[name]; if (!G) return; g.save(); g.translate(x, y); g.scale(s / 24, s / 24);
      G.forEach(function (L) { if (L.k === "b") return; g.fillStyle = col; g.fill(new Path2D(L.d)); }); g.restore(); } catch (e) {}
  }
  function frText(fr) { return !fr || !fr.length ? "" : fr[0] + (fr.length > 1 ? " +" + (fr.length - 1) : ""); }
  function labelImg(m, name, line2, line3, big, hot, fr) {
    var ft = frText(fr), key = "zn|" + name + "|" + line2 + "|" + (line3 || "") + "|" + (big ? 1 : 0) + (hot ? 1 : 0) + "|" + (fr ? fr.slice(0, 3).join(",") + ft : "");
    if (imgs[key]) { if (!m.hasImage(imgs[key])) m.addImage(imgs[key], imgs["d|" + key], { pixelRatio: R }); return imgs[key]; }
    var quiet = line2 === "lugnt" && !ft, f1 = (quiet ? "600 11px " : "700 " + (big ? 13 : 12) + "px ") + FONT, f2 = "700 12px " + FONT, f3 = "600 11px " + FONT, f4 = "700 12px " + FONT;
    if (line2 === "lugnt") line2 = quiet ? "" : "lugnt";
    var GW = 14, nd = fr ? Math.min(3, fr.length) : 0, dW = nd ? 16 + (nd - 1) * 10 + 4 : 0;
    var w2 = line2 ? tw(line2, f2) + (line2 !== "lugnt" ? GW + 3 : 0) : 0, w3 = line3 ? tw(line3, f3) + GW + 3 : 0, w4 = ft ? dW + tw(ft, f4) : 0;
    var w = Math.ceil(Math.max(tw(name, f1), w2, w3, w4)) + (quiet ? 10 : 16), h = quiet ? 20 : 6 + 16 + 15 + (line3 ? 14 : 0) + (ft ? 20 : 0) + 4;
    var cv = document.createElement("canvas"); cv.width = (w + 4) * R; cv.height = (h + 4) * R;
    var g = cv.getContext("2d"); g.scale(R, R); g.translate(2, 2);
    rr(g, 0, 0, w, h, quiet ? 7 : 9); g.fillStyle = quiet ? "rgba(10,15,36,.55)" : "rgba(10,15,36,.9)"; g.fill();
    g.lineWidth = 1; g.strokeStyle = ft ? "rgba(61,220,132,.9)" : hot ? "rgba(255,194,77,.85)" : quiet ? "rgba(255,250,240,.18)" : "rgba(245,166,35,.55)"; g.stroke();
    g.textBaseline = "middle";
    g.textAlign = "center"; g.font = f1; g.fillStyle = quiet ? "rgba(255,246,229,.78)" : "#FFF6E5"; g.fillText(name, w / 2, quiet ? h / 2 + 0.5 : 6 + 8);
    var y = 6 + 16;
    if (line2) {
      g.font = f2; g.fillStyle = line2 === "lugnt" ? "#E9D9BA" : "#FFC24D"; g.textAlign = "left";
      var x2 = (w - w2) / 2; if (line2 !== "lugnt") { gl(g, "pub", x2, y + 1, GW, "#FFC24D"); x2 += GW + 3; } g.fillText(line2, x2, y + 8); y += 15;
    }
    if (line3) { g.font = f3; g.fillStyle = "#E9D9BA"; g.textAlign = "left"; var x3 = (w - w3) / 2; gl(g, "crown", x3, y + 1, GW - 2, "#FFC24D"); g.fillText(line3, x3 + GW + 3, y + 7); y += 14; }
    if (ft) {   // the friends row: initial discs + "Oskar +2"
      var x4 = (w - w4) / 2, cy = y + 10;
      for (var i = nd - 1; i >= 0; i--) {
        var cx = x4 + 8 + i * 10; g.beginPath(); g.arc(cx, cy, 8, 0, 6.2832); g.fillStyle = "#3DDC84"; g.fill();
        g.beginPath(); g.arc(cx, cy, 6.5, 0, 6.2832); g.fillStyle = "#0A0F24"; g.fill();
        g.font = "700 9px " + FONT; g.textAlign = "center"; g.fillStyle = "#3DDC84"; g.fillText(String(fr[i] || "?").charAt(0).toUpperCase(), cx, cy + 0.5);
      }
      g.font = f4; g.textAlign = "left"; g.fillStyle = "#3DDC84"; g.fillText(ft, x4 + dW, cy + 0.5);
    }
    var data = g.getImageData(0, 0, cv.width, cv.height), id = "zn" + (++stats.labels);
    imgs[key] = id; imgs["d|" + key] = data; m.addImage(id, data, { pixelRatio: R }); imgWH[id] = [w + 4, h + 4];   // map M3
    return id;
  }
  function chipImg(m, name, n, fr) {   // the whole-Sweden view: "Dalarna [glyph] 8" on one line (+ a green friend dot + count)
    var t = n, nf0 = fr ? fr.length : 0, key = "zc|" + name + "|" + t + "|" + nf0;
    if (imgs[key]) { if (!m.hasImage(imgs[key])) m.addImage(imgs[key], imgs["d|" + key], { pixelRatio: R }); return imgs[key]; }
    var f1 = "700 12px " + FONT, f2 = "700 12px " + FONT, w1 = tw(name, f1), w2 = 12 + 3 + tw(t, f2), wf = nf0 ? 8 + 14 + 3 + tw(String(nf0), f2) : 0, w = Math.ceil(w1 + w2 + wf) + 18, h = 22;
    var cv = document.createElement("canvas"); cv.width = (w + 4) * R; cv.height = (h + 4) * R;
    var g = cv.getContext("2d"); g.scale(R, R); g.translate(2, 2);
    rr(g, 0, 0, w, h, 11); g.fillStyle = "rgba(10,15,36,.9)"; g.fill(); g.lineWidth = 1; g.strokeStyle = nf0 ? "rgba(61,220,132,.9)" : "rgba(245,166,35,.6)"; g.stroke();
    g.textBaseline = "middle"; g.textAlign = "left";
    g.font = f1; g.fillStyle = "#FFF6E5"; g.fillText(name, 7, h / 2 + 0.5);
    gl(g, "pub", 11 + w1, h / 2 - 6, 12, "#FFC24D"); g.font = f2; g.fillStyle = "#FFC24D"; g.fillText(t, 11 + w1 + 15, h / 2 + 0.5);
    if (nf0) { var xf = 11 + w1 + w2 + 8; g.beginPath(); g.arc(xf + 7, h / 2, 7, 0, 6.2832); g.fillStyle = "#3DDC84"; g.fill(); gl(g, "person", xf + 2, h / 2 - 5, 10, "#00260F");
      g.fillStyle = "#3DDC84"; g.fillText(String(nf0), xf + 17, h / 2 + 0.5); }
    var data = g.getImageData(0, 0, cv.width, cv.height), id = "zn" + (++stats.labels);
    imgs[key] = id; imgs["d|" + key] = data; m.addImage(id, data, { pixelRatio: R }); imgWH[id] = [w + 4, h + 4];   // map M3
    return id;
  }
  // friends (and me) per zone code, from the pins the app has (friend rows only: strangers are never named)
  function friendsBy(kind) {
    var out = {};
    try { (A && A.beers ? A.beers() : []).forEach(function (b) {
      if (!(b.friend_name || b.is_mine) || !isFinite(b.lat)) return;
      var f = zoneAt(kind, +b.lat, +b.lng); if (!f) return; var c = kind === "k" ? f.properties.k : f.properties.l;
      var nm = b.is_mine ? "Du" : String(b.friend_name).split(" ")[0]; (out[c] = out[c] || []); if (out[c].indexOf(nm) < 0) out[c].push(nm);
    }); } catch (e) {}
    Object.keys(out).forEach(function (c) { out[c].sort(function (a, b) { return a === "Du" ? 1 : b === "Du" ? -1 : 0; }); });
    return out;
  }
  /* ds41 zonefr END */
  function barName(id) { try { var b = window.BARS && window.BARS.byId && window.BARS.byId(id); return b && b.name ? String(b.name).slice(0, 22) : null; } catch (e) { return null; } }

  /* ---------- layers ---------- */
  var VIS = ["!=", ["coalesce", ["get", "hid"], 0], 1];   // map M3: a label with no free side waits for the next move
  var COL = ["match", ["coalesce", ["feature-state", "lv"], 0], 0, "#2A3557", 1, "#C2650A", 2, "#F5A623", 3, "#FF9A1F", "#FFC24D"];
  var ALPHA = ["match", ["coalesce", ["feature-state", "lv"], 0], 0, 0.16, 1, 0.26, 2, 0.38, 3, 0.48, 0.58];
  var ALPHA_K = ["match", ["coalesce", ["feature-state", "lv"], 0], 0, 0, 1, 0.2, 2, 0.3, 3, 0.4, 0.5];   // ds44: kommun = the soft heat only
  // Leaflet zoom = GL zoom + 1
  function addL(m, spec, before) { if (m.getLayer(spec.id)) return; try { m.addLayer(spec, before && m.getLayer(before) ? before : undefined); } catch (e) { try { delete spec.slot; m.addLayer(spec); } catch (x) {} } }
  function ensure() {
    var m = gm = glm(); if (!m || !m.style || !m.style._loaded) return false;
    try {
      if (geo.l && !m.getSource(SL)) m.addSource(SL, { type: "geojson", data: geo.l, tolerance: 0.6 });
      if (geo.k && !m.getSource(SK)) m.addSource(SK, { type: "geojson", data: geo.k, tolerance: 0.6 });
      [SLL, SKL, SCT].forEach(function (id) { if (!m.getSource(id)) { m.addSource(id, { type: "geojson", data: EMPTY, maxzoom: 10 }); if (id === SCT) sigC = ""; } });
      if (KOMMUN_OUTLINE === "mine" && !m.getSource(SKY)) { m.addSource(SKY, { type: "geojson", data: EMPTY, tolerance: 0.6 }); youSig = ""; }   // map M1 (b)
      // fills + borders under the Mapbox place labels (Standard slot "middle"), labels above the heat, under the bars
      if (m.getSource(SL)) {
        addL(m, { id: L_LF, type: "fill", source: SL, slot: "middle", maxzoom: Z_KOM - 1 + 0.3,
          paint: { "fill-color": COL, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 2, ALPHA, Z_KOM - 1 - 0.2, ALPHA, Z_KOM - 1 + 0.2, 0], "fill-emissive-strength": 1 } });
        addL(m, { id: L_LG, type: "line", source: SL, slot: "middle", maxzoom: Z_KOM - 1 + 0.3,
          paint: { "line-color": "#FFB43C", "line-width": 7, "line-blur": 7, "line-emissive-strength": 1,
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 2, ["case", [">=", ["coalesce", ["feature-state", "lv"], 0], 3], 0.42, 0], Z_KOM - 1 - 0.2, ["case", [">=", ["coalesce", ["feature-state", "lv"], 0], 3], 0.42, 0], Z_KOM - 1 + 0.2, 0] } });
        addL(m, { id: L_LL, type: "line", source: SL, slot: "middle", maxzoom: Z_OFF - 1,
          paint: { "line-color": "#FFFAF0", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 6, 1.4], "line-emissive-strength": 1,
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 2, 0.5, Z_KOM - 1, 0.5, Z_OFF - 2, 0.35, Z_OFF - 1, 0] } });
      }
      if (m.getSource(SK)) {
        addL(m, { id: L_KF, type: "fill", source: SK, slot: "middle", minzoom: Z_KOM - 1 - 0.3, maxzoom: Z_OFF - 1,
          paint: { "fill-color": COL, "fill-emissive-strength": 1,   /* ds44: a kommun with nobody out has no fill */
            "fill-opacity": ["interpolate", ["linear"], ["zoom"], Z_KOM - 1 - 0.2, 0, Z_KOM - 1 + 0.2, ALPHA_K, Z_OFF - 2, ALPHA_K, Z_OFF - 1, 0] } }, m.getLayer(L_LL) ? L_LL : null);
        addL(m, { id: L_KG, type: "line", source: SK, slot: "middle", minzoom: Z_KOM - 1 - 0.3, maxzoom: Z_OFF - 1,
          paint: { "line-color": "#FFB43C", "line-width": 6, "line-blur": 6, "line-emissive-strength": 1,
            "line-opacity": ["interpolate", ["linear"], ["zoom"], Z_KOM - 1 - 0.2, 0, Z_KOM - 1 + 0.2, ["case", [">=", ["coalesce", ["feature-state", "lv"], 0], 3], 0.38, 0], Z_OFF - 2, ["case", [">=", ["coalesce", ["feature-state", "lv"], 0], 3], 0.38, 0], Z_OFF - 1, 0] } }, m.getLayer(L_LL) ? L_LL : null);
        // map M1: no line layer for all kommuner (was L_KL, ds44). Version (b): one faint outline, only the kommun you are in
        if (KOMMUN_OUTLINE === "mine" && m.getSource(SKY)) addL(m, { id: L_KY, type: "line", source: SKY, slot: "middle", minzoom: Z_KOM - 1 - 0.3, maxzoom: Z_OFF - 1,
          paint: { "line-color": "#FFFAF0", "line-emissive-strength": 1, "line-width": ["interpolate", ["linear"], ["zoom"], 5.6, 1.4, 9, 2],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], Z_KOM - 1 - 0.2, 0, Z_KOM - 1 + 0.2, 0.55, Z_OFF - 2, 0.5, Z_OFF - 1, 0] } }, m.getLayer(L_LL) ? L_LL : null);
      }
      // labels sit just above the zone's label point (the town's people pins / 📍 chips are DOM, GL cannot dodge them)
      // map M3: the side of the town point comes from place() (an), default above it as before
      var lblLay = { "icon-image": ["get", "img"], "icon-anchor": ["coalesce", ["get", "an"], "bottom"],
        "icon-offset": ["match", ["coalesce", ["get", "an"], "bottom"], "top", ["literal", [0, 10]], "left", ["literal", [10, 0]], "right", ["literal", [-10, 0]], ["literal", [0, -10]]],
        "icon-allow-overlap": false, "icon-ignore-placement": false, "icon-padding": 2,
        "symbol-sort-key": ["get", "sk"], "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" };
      var above = m.getLayer("olnu-place") ? "olnu-place" : null;   // over the heat, under every GL bar layer (glmap.js)
      // busy län first: placement goes layer by layer (top first), the sort key only orders WITHIN a tile, so quiet names
      // get their own layer under the busy one (a quiet name never hides a busy label)
      var lp = { "icon-emissive-strength": 1, "icon-opacity": ["interpolate", ["linear"], ["zoom"], Z_KOM - 1 - 0.25, 1, Z_KOM - 1 + 0.1, 0] };
      addL(m, { id: L_LQ, type: "symbol", source: SLL, minzoom: Z_CTRY - 1, maxzoom: Z_KOM - 1 + 0.15, filter: ["all", ["==", ["get", "q"], 1], VIS], layout: lblLay, paint: lp }, above);
      addL(m, { id: L_LT, type: "symbol", source: SLL, minzoom: Z_SWE - 1, maxzoom: Z_KOM - 1 + 0.15, filter: ["all", ["==", ["get", "q"], 0], VIS], layout: lblLay, paint: lp }, above);
      addL(m, { id: L_LC, type: "symbol", source: SLL, minzoom: Z_CTRY - 1, maxzoom: Z_SWE - 1, filter: ["all", ["==", ["get", "q"], 0], VIS],
        layout: Object.assign({}, lblLay, { "icon-image": ["get", "ci"] }), paint: { "icon-emissive-strength": 1 } }, above);
      addL(m, { id: L_CT, type: "symbol", source: SCT, maxzoom: Z_CTRY - 1, layout: Object.assign({}, lblLay, { "icon-anchor": "center", "icon-offset": ["literal", [0, 0]] }),
        paint: { "icon-emissive-strength": 1 } }, above);   // a1map I-11
      addL(m, { id: L_KT, type: "symbol", source: SKL, minzoom: Z_KOM - 1 - 0.1, maxzoom: Z_OFF - 1 - 0.4, filter: VIS, layout: lblLay,
        paint: { "icon-emissive-strength": 1, "icon-opacity": ["interpolate", ["linear"], ["zoom"], Z_KOM - 1 - 0.1, 0, Z_KOM - 1 + 0.25, 1, Z_OFF - 2, 1, Z_OFF - 1 - 0.4, 0] } }, above);
      // glmap.js may have added its layers after ours (style reload): keep the labels under the bars
      if (above) [L_LQ, L_LT, L_LC, L_CT, L_KT].forEach(function (id) { try { if (m.getLayer(id)) m.moveLayer(id, "olnu-place"); } catch (e) {} });
      ready = true;
      return true;
    } catch (e) { try { console.warn("olnu zones layers", e && e.message); } catch (x) {} return false; }
  }
  var sigK = "", sigL = "";
  function paint() {
    var m = gm; if (!ready || !m) return;
    var frK = geo.k ? friendsBy("k") : {}, frL = geo.l ? friendsBy("l") : {};   // ds41: friends in the pill
    try {
      if (geo.l && m.getSource(SL)) geo.l.features.forEach(function (f) { var c = lc(f.properties.l); m.setFeatureState({ source: SL, id: f.id }, { lv: lvl(c ? c.n : 0, c && c.some) }); });
      var hk = null; try { var hh = window.U && window.U.ls ? window.U.ls.getJSON("olnu.home", null) : null, ll = hh && isFinite(hh.lat) ? hh : (A && A.lastLoc ? A.lastLoc() : null); if (ll && geo.k) hk = zoneAt0("k", +ll.lat, +ll.lng); } catch (e) {}   // ds44: home kommun
      if (geo.k && m.getSource(SK)) geo.k.features.forEach(function (f) { var c = kc(f.properties.k); m.setFeatureState({ source: SK, id: f.id }, { lv: lvl(c ? c.n : 0, c && c.some), home: f === hk }); });
      if (KOMMUN_OUTLINE === "mine" && geo.k && m.getSource(SKY)) {   // map M1 (b): the kommun you are in (position first, then home)
        var yk = null; try { var yl = A && A.lastLoc ? A.lastLoc() : null; if (yl && isFinite(yl.lat)) yk = zoneAt0("k", +yl.lat, +yl.lng); } catch (e) {}
        yk = yk || hk; var ys = yk ? String(yk.properties.k) : "-";
        if (ys !== youSig) { youSig = ys; m.getSource(SKY).setData(yk ? { type: "FeatureCollection", features: [{ type: "Feature", id: 1, geometry: yk.geometry, properties: { k: yk.properties.k } }] } : EMPTY); }
      }
      // län labels: all 21
      if (geo.l) {
        var lf = geo.l.features.map(function (f) {
          var p = f.properties, c = lc(p.l), top = c && c.top && byK[c.top] ? byK[c.top].properties.n : null;
          var img = labelImg(m, p.n, countLine(c), top, true, c && c.n >= 10, frL[p.l]);
          return { type: "Feature", id: f.id, geometry: { type: "Point", coordinates: [p.x, p.y] }, properties: { img: img, ci: c ? chipImg(m, p.n, c.some || !c.n ? "några" : nf(c.n), frL[p.l]) : "", sk: -(c ? (c.n || 1) : 0), l: p.l, q: c ? 0 : 1 } };
        }), s1 = lf.map(function (f) { return f.properties.img; }).join();
        lastF[SLL] = lf; if (s1 !== sigL) { sigL = s1; place(SLL); }   // map M3: place() picks the free side, then setData
      }
      // kommun labels: only where someone is out
      if (geo.k && counts) {
        var kf = [];
        Object.keys(counts.kk).concat(Object.keys(frK).filter(function (k) { return !counts.kk[k]; })).forEach(function (code) {
          var f = byK[code]; if (!f) return; var p = f.properties, c = counts.kk[code] || { n: 0, some: true }, bn = c.bar ? barName(c.bar) : null;
          kf.push({ type: "Feature", id: f.id, geometry: { type: "Point", coordinates: [p.x, p.y] },
            properties: { img: labelImg(m, p.n, countLine(c), bn || null, false, c.n >= 10, frK[p.k]), sk: -(c.n || 1) - (frK[p.k] ? 1000 : 0), k: p.k } });
        });
        var s2 = kf.map(function (f) { return f.properties.img; }).join();
        lastF[SKL] = kf; if (s2 !== sigK) { sigK = s2; place(SKL); }
      }
      ctryPaint(m);   // a1map I-11
    } catch (e) {}
  }

  // a1map I-11: one chip per country with people out (Sweden from total / some; others only if the server lists them)
  function ctryRows() {
    if (!counts) return [];
    var en = window.I18N && window.I18N.lang === "en", rows = [];
    if (counts.total || counts.some) rows.push({ c: "SE", n: counts.total, d: counts.drinks });
    (Array.isArray(counts.countries) ? counts.countries : []).forEach(function (x) { if (x && x.c && x.c !== "SE" && (x.n || x.some) && (CTRY[x.c] || isFinite(x.x))) rows.push(x); });
    return rows.map(function (x) {
      var d = CTRY[x.c] || [x.name || x.c, x.name || x.c, +x.x, +x.y], n = x.n >= K_MIN ? nf(x.n) : "några";
      var t = (en ? n.replace("några", "a few") + " out" : n + " ute") + (x.d >= K_MIN ? " · " + nf(x.d) + (en ? " beers" : " öl") : "");
      return { c: x.c, name: en ? d[1] : d[0], t: t, x: d[2], y: d[3], n: x.n || 1 };
    });
  }
  function ctryPaint(m) {
    if (!m.getSource(SCT)) return;
    var rows = ctryRows(), fs = rows.map(function (r, i) { return { type: "Feature", id: i + 1, geometry: { type: "Point", coordinates: [r.x, r.y] },
      properties: { img: chipImg(m, r.name, r.t, null), c: r.c, sk: -r.n } }; });
    var sg = fs.map(function (f) { return f.properties.c + f.properties.img; }).join();
    if (sg !== sigC) { sigC = sg; try { m.getSource(SCT).setData({ type: "FeatureCollection", features: fs }); } catch (e) {} }
  }
  /* ---------- map M3: zone labels out of the UI-safe areas (moveend / new data only, never per frame) ---------- */
  var lastF = {}, sideSig = {}, SIDES = ["bottom", "top", "right", "left"];
  function uiRects() {   // GL canvas px: the app UI over the map + the 📍 my-pin / invite chips (DOM, GL collision cannot see them)
    var out = [], m = gm; if (!m || !map) return out;
    try {
      var cv = m.getCanvas().getBoundingClientRect(), ct = map.getContainer().getBoundingClientRect(), dx = ct.left - cv.left, dy = ct.top - cv.top;
      ((window.TIERS && TIERS.safeRects) ? TIERS.safeRects(map) : []).forEach(function (r) { out.push({ l: r.l + dx, t: r.t + dy, r: r.r + dx, b: r.b + dy }); });
      document.querySelectorAll(".leaflet-mypins-pane .mp-pin, .leaflet-invites-pane .leaflet-marker-icon > *").forEach(function (e) {
        var r = e.getBoundingClientRect(); if (r.width && r.height) out.push({ l: r.left - cv.left - 3, t: r.top - cv.top - 3, r: r.right - cv.left + 3, b: r.bottom - cv.top + 3 });
      });
    } catch (e) {}
    return out;
  }
  function sideBox(q, wh, an) {
    var w = wh[0], h = wh[1];
    if (an === "top") return { l: q.x - w / 2, t: q.y + 10, r: q.x + w / 2, b: q.y + 10 + h };
    if (an === "right") return { l: q.x - 10 - w, t: q.y - h / 2, r: q.x - 10, b: q.y + h / 2 };
    if (an === "left") return { l: q.x + 10, t: q.y - h / 2, r: q.x + 10 + w, b: q.y + h / 2 };
    return { l: q.x - w / 2, t: q.y - 10 - h, r: q.x + w / 2, b: q.y - 10 };
  }
  function place(only) {
    var m = gm; if (!ready || !m || !map) return;
    var rs = null, cv = null, z = zoom();
    [SLL, SKL].forEach(function (src) {
      if (only && only !== true && only !== src) return;
      var fs = lastF[src], s = m.getSource(src); if (!fs || !s) return;
      if (!rs) { rs = uiRects(); cv = m.getCanvas(); }
      var W = cv.clientWidth || cv.width, H = cv.clientHeight || cv.height, key = src === SLL && z < Z_SWE ? "ci" : "img", sig = "";
      // busiest first (the GL placement order): a label that steps aside may not land on a better label either
      var hits = function (b, list) { for (var j = 0; j < list.length; j++) if (b.l < list[j].r && b.r > list[j].l && b.t < list[j].b && b.b > list[j].t) return true; return false; };
      var done = [], order = fs.map(function (f, i) { return i; }).sort(function (a, b) { var A = fs[a].properties, B = fs[b].properties; return ((A.q || 0) - (B.q || 0)) || ((A.sk || 0) - (B.sk || 0)); });
      order.forEach(function (ix) {
        var f = fs[ix], pr = f.properties, wh = imgWH[pr[key]] || [90, 44], q = m.project(f.geometry.coordinates), an = "bottom", hid = 0;
        if (q.x > -200 && q.y > -200 && q.x < W + 200 && q.y < H + 200) {   // off screen: as before
          var free = null, noUi = null;
          for (var i = 0; i < SIDES.length && !free; i++) {
            var b = sideBox(q, wh, SIDES[i]), vis = Math.max(0, (Math.min(W, b.r) - Math.max(0, b.l)) / (b.r - b.l)) * Math.max(0, (Math.min(H, b.b) - Math.max(0, b.t)) / (b.b - b.t));
            if (vis < 0.97 || hits(b, rs)) continue;   // map 24: not all on screen / on the app UI: try the next side
            if (!noUi) noUi = SIDES[i];
            if (!hits(b, done)) free = SIDES[i];
          }
          an = free || noUi;   // only labels in the way: GL collision decides, as before
          if (!an) { an = "bottom"; hid = 1; } else done.push(sideBox(q, wh, an));
        }
        pr.an = an; pr.hid = hid;
      });
      fs.forEach(function (f) { sig += f.properties.an + f.properties.hid + ","; });
      if (only === src || only === true || sig !== sideSig[src]) { sideSig[src] = sig; try { s.setData({ type: "FeatureCollection", features: fs }); } catch (e) {} }
    });
  }

  /* ---------- the top bar pill ---------- */
  /* fixM T-15 PILL START — ONE meaning for the top bar pill (test teams: national total before an account, local after; not
     tappable). It always names its area and shows zone_counts for it (the same number for everyone, signed in or not):
     zoomed out to the whole country (Leaflet z < 5.2), outside Sweden or before the kommun is known = "Sverige · N ute";
     else the kommun under the map centre ("Ludvika · 11 ute"), on the GL map and on the raster fallback. The län step
     (z 5.2 – 6.6) stays a GL zones view. Kommun lookup: the zone borders when loaded, else the 0.025° grid in
     data/dialekt-kommun.json (read from DIALEKT's own copy: no second GET). Tap = the "Ute nu" sheet (openOut). */
  var kg = null, kgP = null;
  function kgLoad() {   // the kommun grid DIALEKT already loaded (data/dialekt-kommun.json): no second fetch
    if (kg || kgP) return;
    var D = window.DIALEKT; if (!D || !D.ready) return;
    var wait = 2500 - ((window.performance && performance.now()) || 3000);   // DIALEKT loads on idle ~2 s after load: never earlier because of us
    if (wait > 0) { kgP = new Promise(function (res) { setTimeout(res, wait); }).then(function () { kgP = null; kgLoad(); }); return; }
    kgP = Promise.resolve(D.ready()).then(function () {
      var st = D._sets ? D._sets() : null, s0 = st && st.filter(function (x) { return x && x.cc === "SE" && x.grid && x.k; })[0];
      kg = s0 ? { g: s0.grid, k: s0.k, rows: {} } : null; if (!kg) kgP = null; pill(true);
    }, function () { kgP = null; });
  }
  function kgRow(r) {
    if (kg.rows[r]) return kg.rows[r];
    var out = [], tok = (kg.g.rows[r] || "").split(",");
    for (var i = 0; i < tok.length; i++) { var q = tok[i].split("*"), v = q[0] === "-" ? -1 : parseInt(q[0], 36), n = q[1] ? parseInt(q[1], 36) : 1; for (var j = 0; j < n; j++) out.push(v); }
    return (kg.rows[r] = out);
  }
  function kommunAt(lat, lng) {   // {k: SCB code, n: name} or null (sea, abroad)
    if (geo.k) { var f = zoneAt("k", lat, lng); if (f) return { k: f.properties.k, n: f.properties.n }; }
    if (!kg) { kgLoad(); return null; }
    var g = kg.g, r = Math.floor((lat - g.lat0) / g.dlat), c = Math.floor((lng - g.lng0) / g.dlng);
    if (r < 0 || c < 0 || r >= g.rows.length) return null;
    var v = kgRow(r)[c], x = v != null && v >= 0 ? kg.k[v] : null;
    return x ? { k: x[0], n: x[1] } : null;
  }
  function inSwe(lat, lng) { return lat > 55 && lat < 69.2 && lng > 10.8 && lng < 24.3; }
  function areaNow() {   // {name, k (kommun code or null), n, some}
    var z = zoom(), c = map.getCenter(), ko = z >= Z_SWE && inSwe(c.lat, c.lng) ? kommunAt(c.lat, c.lng) : null;
    if (!ko) return { name: "Sverige", k: null, n: counts ? counts.total : null, some: counts ? counts.some : false };
    var y = kc(ko.k); return { name: ko.n, k: ko.k, n: counts ? (y ? y.n : 0) : null, some: !!(y && y.some), bar: y && y.bar };
  }
  function pillHTML() {
    if (missing || !map) return null;
    if (!(wanted() && (geo.l || geo.k) && zoom() >= Z_SWE && zoom() < Z_KOM)) {   // GL län view: the old branch below
      var ar = areaNow(), e0 = pillEsc;
      pillD = { name: ar.name, n: counts ? ar.n : null, some: !!ar.some, known: !!counts };
      if (!counts) return e0(ar.name) + " · <b>–</b> ute ikväll";
      return e0(ar.name) + (ar.n ? " · <b>" + nf(ar.n) + "</b> ute ikväll" : ar.some ? " · <b>några</b> ute ikväll" : " · lugnt ikväll");
    }
    /* fixM T-15 PILL END (the län branch follows) */
    if (!wanted() || (!geo.l && !geo.k) || missing) return null;
    var z = zoom(), c = map.getCenter(), name, n = null, some = false;
    if (z < Z_SWE) { name = "Sverige"; if (counts) { n = counts.total; some = counts.some; } }
    else if (z < Z_KOM) { var lf = zoneAt("l", c.lat, c.lng); if (!lf) return null; name = lf.properties.n; var x = lc(lf.properties.l); if (x) { n = x.n; some = x.some; } }
    else { var kf = zoneAt("k", c.lat, c.lng); if (!kf) return null; name = kf.properties.n; var y = kc(kf.properties.k); if (y) { n = y.n; some = y.some; } }
    pillD = { name: name, n: counts ? n : null, some: !!some, known: !!counts };
    var e = pillEsc;
    if (!counts) return e(name) + " · <b>–</b> ute ikväll";
    return e(name) + (n ? " · <b>" + nf(n) + "</b> ute ikväll" : some ? " · <b>några</b> ute ikväll" : " · lugnt ikväll");
  }
  function pillEsc(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); }
  /* ui1 B10 (owner): the town name is NEVER cut. Fit order, first that fits wins:
     1. one line "Dalarna · 47 ute ikväll" → "· 47 ute" → "· 47"
     2. two lines: the name (14 px) on top, the status (12 px, green dot when people are out) under it
     3. two lines, the name a little tighter (−0.02 em)
     4. a narrow phone and a long name: the PintsNow wordmark goes 22 → 18 px (body.pn-pill-tight), then 2 again.
     The name and the status are their own spans; textContent stays "Name · N ute ikväll" (zones-pw). CSS: pnds.css "lane:ui1". */
  var pillD = null;
  function pillVariants(d) {
    var e = pillEsc, nm = '<span class="zn-pn">' + e(d.name) + "</span>", sep = '<i class="zn-sep"> · </i>';
    var num = !d.known ? "–" : d.n ? nf(d.n) : d.some ? "några" : null;
    var one = num == null ? [" · lugnt ikväll", " · lugnt", " · lugnt"].map(function (x) { return nm + '<span class="zn-ps">' + x + "</span>"; })
      : [" ute ikväll", " ute", ""].map(function (x) { return nm + '<span class="zn-ps"> · <b>' + num + "</b>" + x + "</span>"; });
    var dot = d.known && (d.n || d.some) ? '<i class="zn-dot" aria-hidden="true"></i>' : "";
    var two = num == null ? [nm + '<span class="zn-ps">' + sep + "lugnt ikväll</span>"]
      : [" ute ikväll", " ute"].map(function (x) { return nm + '<span class="zn-ps">' + dot + sep + '<span class="zn-n">' + num + "</span>" + x + "</span>"; });
    return { one: one, two: two };
  }
  function pillFits(el) {
    var nmEl = el.querySelector(".zn-pn");
    return el.scrollWidth <= el.clientWidth + 1 && (!nmEl || nmEl.scrollWidth <= nmEl.clientWidth + 1);
  }
  function fitPill(el, d) {
    var v = pillVariants(d), body = document.body, steps = [];
    v.one.forEach(function (h) { steps.push([h, ""]); });
    v.two.forEach(function (h) { steps.push([h, "zn-2l"]); });
    v.two.forEach(function (h) { steps.push([h, "zn-2l zn-tt"]); });
    var tight = function (on) { if (body.classList.contains("pn-pill-tight") !== on) body.classList.toggle("pn-pill-tight", on); };
    var tryAll = function () {
      for (var i = 0; i < steps.length; i++) {
        el.classList.remove("zn-2l", "zn-tt"); if (steps[i][1]) el.classList.add.apply(el.classList, steps[i][1].split(" "));
        el.innerHTML = steps[i][0]; fitted = steps[i][0];
        if (pillFits(el)) return true;
      }
      return false;
    };
    tight(false);
    if (!tryAll()) { tight(true); tryAll(); }   // the last step stays when nothing fits (the name still shows whole, the status goes first)
    el.setAttribute("aria-label", el.textContent);
  }
  var fitFor = "", fitted = null;
  function pillOff(el) {
    if (el) el.classList.remove("zn-2l", "zn-tt");
    if (document.body.classList.contains("pn-pill-tight")) document.body.classList.remove("pn-pill-tight");
  }
  function pill(push) {
    var h = pillHTML(); lastPill = h;
    var el = document.getElementById("live-count"); if (!el) return;
    el.classList.toggle("zn-pill", !!h);
    if (h) {
      var key = h + "|" + window.innerWidth;
      if (fitFor !== key || !el.querySelector(".zn-pn") || el.innerHTML !== fitted) { fitFor = key; fitPill(el, pillD); }
    }
    else {
      pillOff(el); fitFor = "";
      if (push && A && A.updateCounts && el.classList) { try { A.updateCounts(); } catch (e) {} }
    }
  }

  /* ---------- tap = zoom in ---------- */
  // stats.pre / stats.skip: how far the last tap got (e2e zones-pw.js logs them; a dead tap names its reason)
  function onPreclick(e) {
    stats.pre = (stats.pre || 0) + 1;
    // not "ready" here: right after a fly-in the layers can be in a re-paint (ready off for a moment); tapZone() then
    // finds the zone in JS. Only the GL map and the zoom decide if zones take taps.
    if (!e || !e.latlng || !wanted()) { stats.skip = "off"; return; }
    var oe = e.originalEvent || {}, ll = e.latlng;
    // glmap.js's preclick runs after ours (it attaches later) and marks a tap it used: decide after this dispatch
    setTimeout(function () {
      if (oe._olnuGl || (window.GLBARS && GLBARS.tappedAt && performance.now() - GLBARS.tappedAt() < 400)) { stats.skip = "gl-bar"; return; }
      tapZone(ll);
    }, 0);
  }
  function tapZone(ll) {
    var e = { latlng: ll };
    if (!wanted()) { stats.skip = "off"; return; }
    var z = zoom(), lay = z < Z_KOM ? L_LF : L_KF;
    try {
      var f = null;
      if (ready && gm && gm.getLayer(lay)) { var p = gm.project([e.latlng.lng, e.latlng.lat]); f = gm.queryRenderedFeatures([p.x, p.y], { layers: [lay] })[0]; }
      var feat = f && (z < Z_KOM ? geo.l : geo.k) && (z < Z_KOM ? geo.l : geo.k).features.filter(function (x) { return x.id === f.id; })[0];
      // GL has not drawn this layer at the tap yet (just flown in, slow phone / CI: the kommun fill tiles for the new zoom
      // come a moment after moveend): use the same border files in JS, so the tap still zooms in.
      if (!feat) { feat = zoneAt(z < Z_KOM ? "l" : "k", ll.lat, ll.lng); if (feat) stats.tapJs = (stats.tapJs || 0) + 1; }
      if (!feat) { stats.skip = "no-zone"; return; }
      stats.skip = null;
      var b = feat.properties.b, bounds = L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
      var fz = map.getBoundsZoom(bounds, false, L.point(24, 24));
      stats.taps++; stats.lastTap = feat.properties.n;
      if (z < Z_KOM) map.flyTo(bounds.getCenter(), Math.max(Z_KOM + 0.25, Math.min(fz, 9)), { duration: 0.8 });   // into its kommuner
      else if (fz > z + 0.3) map.flyToBounds(bounds, { padding: [12, 12], duration: 0.8 });
      else map.flyTo(e.latlng, Math.min(13, Math.max(Z_OFF + 0.5, z + 2)), { duration: 0.8 });   // already showing the whole kommun: into its bars
    } catch (x) { stats.skip = "err: " + String(x && x.message || x).slice(0, 80); }
  }

  /* ---------- on / off ---------- */
  function check() {
    var m = glm();
    if (!m) { ready = false; pill(true); return; }
    if (m !== hooked) {
      hooked = m;
      m.on("style.load", function () { if (glm() === m) { ready = false; sigK = sigL = ""; imgs = {}; setTimeout(check, 0); } });
    }
    gm = m;
    if (!m.style || !m.style._loaded) { m.once("style.load", function () { setTimeout(check, 0); }); return; }
    if (wanted()) { load(zoom() < Z_KOM ? "l" : "k"); load(zoom() < Z_KOM ? "k" : "l"); }
    if (ensure()) { paint(); ask(false); }
    cls(); pill(true);
  }
  // ds41: no people marker over the zones: pins + clusters hide while zones show (friends are in the pills)
  var CSS = "html[data-zones] .olnu-cl,html[data-zones] .leaflet-marker-icon:has(>.pn-p),html[data-zones] .leaflet-marker-icon:has(>.pn-cl){display:none}";
  function cls() {
    var v = ready && !!map && !!glm() && zoom() < Z_OFF - 0.9 && !!(geo.l || geo.k), de = document.documentElement;
    if (v !== de.hasAttribute("data-zones")) { if (v) de.setAttribute("data-zones", ""); else de.removeAttribute("data-zones"); }
  }
  var placeT = 0;
  function moved() {
    cls();
    if (!map) return;
    if (ready && wanted()) { clearTimeout(placeT); placeT = setTimeout(function () { place(false); }, 60); }   // map M3 (after the my-pin chips moved)
    if (wanted()) {
      if (!geo.l && !geo.k) { check(); return; }
      if (!ready) ensure();
    }
    if (wanted()) ask(false);   // zoomed in the polls ask (fixM T-15: inside the poll fan-out = in the poll's rpc_bundle2)
    pill(true);
  }
  // credit (SCB asks for "Källa: SCB"; CC0 needs none, we give it anyway) in the ⓘ popover, next to the map credit
  function credit() {
    var pop = document.getElementById("attrib-pop"); if (!pop || pop.querySelector(".zn-credit")) return;
    var s = document.createElement("span"); s.className = "zn-credit";
    s.innerHTML = ' | Gränser: <a href="https://www.scb.se/hitta-statistik/regional-statistik-och-kartor/regionala-indelningar/digitala-granser/" target="_blank" rel="noopener">SCB</a> (CC0)';
    // map R1-36: on the map credit's own line (it stood alone after the legend)
    var mc = pop.querySelector(".bm-credit"); if (mc && mc.parentNode === pop) pop.insertBefore(s, mc.nextSibling); else pop.appendChild(s);
  }

  /* fixM T-15 OUT START — tap on the top bar pill = "Ute nu": the area and its count (the pill's own number), the busiest bar,
     the friends out (tap = fly there), one plain line on what is counted, the whole country. Same classes as the ds57 sheet. */
  function mk(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  function icon(n) { try { return window.PNI && window.PNI.has(n) ? window.PNI.svg(n) : ""; } catch (e) { return ""; } }
  function countWords(n, some) { return n ? nf(n) + " ute ikväll" : some ? "några ute ikväll" : "lugnt ikväll"; }
  function openOut() {
    if (!A || !A.openSheet || !map) return false;
    stats.outOpen = (stats.outOpen || 0) + 1;
    ask(false);
    var ar = areaNow();
    return A.openSheet("Ute nu", function (body) {
      var list = mk("div", "ds-list pn-un-list zn-out");
      var head = mk("div", "ds-row pn-row zn-out-area");
      var hi = mk("span", "ds-row-i"); hi.innerHTML = icon(ar.k ? "area" : "globe"); head.appendChild(hi);
      var ht = mk("span", "ds-row-t"); ht.appendChild(mk("span", null, ar.name)); ht.appendChild(mk("small", null, !counts ? "Räknar…" : countWords(ar.n, ar.some))); head.appendChild(ht);
      list.appendChild(head);
      if (ar.bar && ar.k) {   // zone_counts: the busiest bar of the kommun (only with 3+ there)
        var br = mk("div", "ds-row pn-row zn-out-bar"), bi = mk("span", "ds-row-i"); bi.innerHTML = icon("beer"); br.appendChild(bi);
        var bt = mk("span", "ds-row-t"); bt.appendChild(mk("span", null, String(ar.bar))); bt.appendChild(mk("small", null, "Mest folk just nu")); br.appendChild(bt);
        list.appendChild(br);
      }
      body.appendChild(list);
      // friends out (the same pins as the map; strangers never named)
      var seen = {}, fr = [];
      try { (A.beers ? A.beers() : []).forEach(function (b) { var nm = b && b.friend_name; if (!nm || seen[nm]) return; seen[nm] = 1; fr.push({ name: nm, n: b.beer_count | 0, lat: b.lat, lng: b.lng }); }); } catch (e) {}
      if (fr.length) {
        body.appendChild(mk("h3", "ds-section-h pn-un-h", "Vänner ute"));
        var ul = mk("div", "ds-list pn-un-list");
        fr.slice(0, 12).forEach(function (p) {
          var row = mk("button", "ds-row pn-row pn-un-row live"); row.type = "button";
          var av = mk("span", "pn-un-av"); av.setAttribute("aria-hidden", "true");
          try { av.innerHTML = window.PNUI && window.PNUI.capSVG ? window.PNUI.capSVG(p.name, 40) : ""; } catch (e) {}
          if (!av.innerHTML) av.textContent = String(p.name).charAt(0).toUpperCase();
          var t = mk("span", "ds-row-t"); t.appendChild(mk("span", null, p.name)); t.appendChild(mk("small", null, p.n > 0 ? p.n + " öl ikväll" : "Ute nu"));
          row.appendChild(av); row.appendChild(t); row.appendChild(mk("span", "ds-chev"));
          row.setAttribute("aria-label", p.name + (p.n > 0 ? ", " + p.n + " öl ikväll" : ", ute nu"));
          row.addEventListener("click", function () { try { A.closeSheet(); map.flyTo([p.lat, p.lng], 16, { duration: 0.8 }); } catch (e) {} });
          ul.appendChild(row);
        });
        body.appendChild(ul);
      } else if (A.authed && A.authed()) body.appendChild(mk("p", "muted pn-un-empty", "Ingen av dina vänner är ute just nu."));
      var note = mk("p", "muted zn-out-note", "Siffran = alla som har tryckt ÖL! eller ANNAT ikväll i " + (ar.k ? ar.name : "Sverige") + ". Spöken räknas inte. " + (wanted() ? "Den uppdateras varje minut." : "Den uppdateras var 5:e minut och när du öppnar den här."));   // fixMo N-19: the true refresh (AGE_MS / AGE_IN)
      body.appendChild(note);
      if (ar.k && counts) body.appendChild(mk("p", "muted zn-out-swe", "Hela Sverige: " + countWords(counts.total, counts.some)));
    });
  }
  function hookPill() {
    var el = document.getElementById("live-count"); if (!el || el._znTap) return;
    el._znTap = 1; el.setAttribute("role", "button"); el.tabIndex = 0; el.style.cursor = "pointer";
    el.addEventListener("click", function () { openOut(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openOut(); } });
  }
  /* fixM T-15 OUT END */
  window.ZONES = {
    init: function (api) {
      if (A) return; A = api; map = api && api.map; if (!map) return;
      try { hookPill(); } catch (e) {}   // fixM T-15
      document.addEventListener("basemap:change", function () { setTimeout(check, 0); });
      map.on("preclick", onPreclick);
      map.on("moveend", moved);
      map.on("zoomend", function () { cls(); pill(false); });
      window.addEventListener("resize", function () { if (lastPill) pill(false); });   // ui1 B10: refit on rotation / width change
      var st = document.createElement("style"); st.id = "zones-css"; st.textContent = CSS; document.head.appendChild(st);
      setTimeout(function () { credit(); check(); }, 0);
    },
    // left Z1: ask a little before the age limit (10 s zoomed in, 5 s zoomed out): the ask always falls on the same poll as
    // app.js's poll plan (zone_counts then rides the poll bundle, no request of its own)
    onPoll: function () { ask(false, wanted() ? AGE_MS - 5000 : AGE_IN - 10000); if (wanted()) paint(); pill(true); },   // ds41: friends move → the pills follow · fixM T-15: counts at every zoom
    onPublicPoll: function () { ask(false, wanted() ? AGE_MS : AGE_IN); pill(true); },   // fixM T-15
    // app.js updateCounts(): the zone line for the top bar, or null (zoomed in / no zones) = the world counter
    pill: function () { if (!pillHTML()) return null; pill(false); return fitted; },   // fixM T-15: every zoom (null only on an old server)
    // ui1 B10 test hook: fit a name into the top bar pill like pill() does (no map needed)
    _fitPill: function (name, n, some) { var el = document.getElementById("live-count"); if (!el) return null; el.classList.add("zn-pill"); fitFor = ""; fitPill(el, { name: name, n: n, some: !!some, known: true }); return fitted; },
    _pillOff: function () { var el = document.getElementById("live-count"); if (el) el.classList.remove("zn-pill"); pillOff(el); fitFor = ""; },
    on: function () { return ready && wanted(); },
    stats: stats,
    // test hooks
    _counts: function () { return counts; },
    _ctry: function () { return { z: Z_CTRY, layer: L_CT, rows: ctryRows() }; },   // a1map I-11 tests
    _zoneAt: function (lat, lng) { var k = zoneAt("k", lat, lng), l = zoneAt("l", lat, lng); return { k: k && k.properties.n, l: l && l.properties.n }; },
    _layers: function () { return [L_LF, L_LG, L_LL, L_KF, L_KG, L_KY, L_KT, L_LQ, L_LT, L_LC]; },
    _outline: function () { return KOMMUN_OUTLINE; },   // map M1: "none" | "mine"
    _place: function () { place(true); }, _uiRects: function () { return uiRects(); },   // map M3 test hooks
    // map M3: mypins.js calls this when its chips changed (labels step aside from them)
    relabel: function () { if (!ready || !wanted()) return; clearTimeout(placeT); placeT = setTimeout(function () { place(false); }, 60); },
    _ask: function () { countsAt = 0; ask(true); },
    _geo: function () { return { l: !!geo.l, k: !!geo.k, loadMs: stats.loadMs }; },
    openOut: openOut, _area: function () { return map ? areaNow() : null; }, _kommunAt: function (lat, lng) { return kommunAt(lat, lng); }   // fixM T-15
  };
})();
