/* Öl Nu — 🏠 BARLIT: the bar's whole building lights up on the map (CONTRACT "KARTSTIL 2 · lit bar buildings").
   window.BARLIT, in app.js mods(): init, onPoll. No RPC, no new buttons.
   - Data: docs/buildings/index.json + docs/buildings/<ty>_<tx>.json (scripts/bar-buildings.mjs, weekly workflow):
     GeoJSON footprints with properties {bar_id, also?, k}. Tiles load lazily for the view (+25 %), only at zoom ≥ 15,
     max 8 new tiles per pass, at most 30 tiles kept (the farthest are dropped).
   - Drawn as Leaflet SVG polygons in our own pane "barlit" (z 380): above every base map (tilePane 200; also Klassisk),
     under the heat canvas (overlayPane 400) and all marker panes (bars 590, markers 600, hotbars 650).
     Below zoom 15 the whole group is off the map (only the markers show).
   - Look: amber fill 25 % + an amber outline with a soft glow. State from the poll (same bar ids as the markers):
     quiet = soft amber; people there (1–4) = brighter + slow pulse (0.4 Hz); hot (≥ 5) = orange/red + pulse;
     a friend (or you) there = green outline. Reduced motion = no pulse. Restaurants / cafés (places) light up only
     when someone is there (as their markers).
   - Tap a building = a tap on that bar's marker (same bar sheet); no marker drawn → app openBar(bar).
   - Zoom ≥ 16: the plain bar icon on a lit building shrinks to a small badge (class bl-has + #map.bl-z16). */
(function () {
  "use strict";
  var U = window.U, L = window.L;
  var MINZ = 15, BADGEZ = 16, MAX_NEW = 8, MAX_TILES = 30, HOT_N = 5;
  var A = null, map = null, group = null, renderer = null;
  var index = null, indexP = null, tiles = {}, order = [];   // key -> { state, feats:[{f, layers:[]}] }
  var byBar = {};    // canonical bar id -> [polygon layer]
  var state = {};    // canonical bar id -> { n, friend }
  var reduce = false;
  try { reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  var CSS = ".leaflet-barlit-pane path.bl{stroke-linejoin:round;transition:fill-opacity .4s,stroke-width .4s}" +
    ".leaflet-barlit-pane svg{filter:drop-shadow(0 0 3px rgba(245,166,35,.55))}" +
    ".leaflet-barlit-pane path.bl-live,.leaflet-barlit-pane path.bl-hot{animation:bl-pulse 2.5s ease-in-out infinite}" +
    "@keyframes bl-pulse{0%,100%{fill-opacity:.32;stroke-opacity:.85}50%{fill-opacity:.5;stroke-opacity:1}}" +
    "@media (prefers-reduced-motion:reduce){.leaflet-barlit-pane path.bl{animation:none !important;transition:none}}" +
    "#map.bl-z16 .cm.bl-has:not(.cm-hot) .bar-ico{transform:scale(.6);transform-origin:50% 50%}" +
    "#map.bl-z16 .cm.bl-has.cm-hot .bar-ico{transform:scale(.75);transform-origin:50% 50%}";

  function looks(st) {
    var n = st ? st.n : 0, fr = st && st.friend;
    var o = n >= HOT_N ? { color: "#ff5a1f", fillColor: "#ff6a2b", fillOpacity: 0.38, weight: 3, cls: "bl bl-hot" }
      : n > 0 ? { color: "#ffb02e", fillColor: "#ffb02e", fillOpacity: 0.34, weight: 2.5, cls: "bl bl-live" }
      : { color: "#f5a623", fillColor: "#f5a623", fillOpacity: 0.25, weight: 1.5, cls: "bl bl-quiet" };
    if (fr) { o.color = "#3ee07a"; o.weight += 0.5; o.cls += " bl-friend"; }
    return o;
  }
  function canon(id) { try { return window.BARS && window.BARS.canonId ? window.BARS.canonId(id) : String(id); } catch (e) { return String(id); } }
  function barOf(id) { try { return window.BARS && window.BARS.byId(id); } catch (e) { return null; } }

  /* ---------- tiles ---------- */
  function loadIndex() {
    if (indexP) return indexP;
    indexP = fetch("./buildings/index.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("no buildings"); return r.json(); })
      .then(function (ix) { if (!ix || !ix.t || !Array.isArray(ix.d)) throw new Error("bad buildings"); index = ix; return ix; })
      .catch(function () { index = { d: [0.05, 0.1], t: {} }; return index; });
    return indexP;
  }
  function wantKeys() {
    var b = map.getBounds().pad(0.25), D = index.d, out = [];
    var y0 = Math.floor(b.getSouth() / D[0]), y1 = Math.floor(b.getNorth() / D[0]);
    var x0 = Math.floor(b.getWest() / D[1]), x1 = Math.floor(b.getEast() / D[1]);
    if ((y1 - y0 + 1) * (x1 - x0 + 1) > 64) return out;
    var c = map.getCenter();
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) if (index.t[y + "_" + x]) out.push({ k: y + "_" + x, d: Math.abs((y + 0.5) * D[0] - c.lat) + Math.abs((x + 0.5) * D[1] - c.lng) / 2 });
    out.sort(function (a, b) { return a.d - b.d; });
    return out.map(function (o) { return o.k; });
  }
  function update() {
    if (!map) return;
    var z = map.getZoom(), on = z >= MINZ;
    var mc = map.getContainer(); if (mc && mc.classList) mc.classList.toggle("bl-z16", z >= BADGEZ);
    if (!on) { if (map.hasLayer(group)) map.removeLayer(group); return; }
    if (!map.hasLayer(group)) group.addTo(map);
    loadIndex().then(function () {
      if (map.getZoom() < MINZ) return;
      var keys = wantKeys(), n = 0;
      keys.forEach(function (k) {
        var t = tiles[k];
        if (t) { touch(k); return; }
        if (n++ >= MAX_NEW) return;
        tiles[k] = { state: "loading", feats: [] }; touch(k);
        fetch("./buildings/" + k + ".json")
          .then(function (r) { if (!r.ok) throw new Error("tile " + r.status); return r.json(); })
          .then(function (fc) { if (tiles[k]) { tiles[k].state = "done"; addTile(k, fc); } })
          .catch(function () { delete tiles[k]; });
      });
      trim(keys);
    });
  }
  function touch(k) { var i = order.indexOf(k); if (i >= 0) order.splice(i, 1); order.push(k); }
  function trim(keep) {
    while (order.length > MAX_TILES) {
      var k = null;
      for (var i = 0; i < order.length; i++) if (keep.indexOf(order[i]) < 0) { k = order[i]; break; }
      if (!k) break;
      order.splice(order.indexOf(k), 1);
      (tiles[k].feats || []).forEach(function (o) { o.layers.forEach(dropLayer); });
      delete tiles[k];
    }
  }
  function dropLayer(l) {
    group.removeLayer(l);
    var a = byBar[l._blId]; if (a) { var i = a.indexOf(l); if (i >= 0) a.splice(i, 1); if (!a.length) delete byBar[l._blId]; }
  }
  function toLatLngs(g) {
    var ring = function (r) { return r.map(function (p) { return [p[1], p[0]]; }); };
    if (g.type === "Polygon") return g.coordinates.map(ring);
    if (g.type === "MultiPolygon") return g.coordinates.map(function (p) { return p.map(ring); });
    return null;
  }
  function addTile(k, fc) {
    var t = tiles[k];
    (fc && fc.features || []).forEach(function (f) {
      var p = f.properties || {}, ll = f.geometry && toLatLngs(f.geometry);
      if (!ll || !p.bar_id) return;
      var ids = [p.bar_id].concat(Array.isArray(p.also) ? p.also : []);
      var o = { f: f, ids: ids, layers: [] };
      t.feats.push(o);
      draw(o, ll);
    });
    refreshMarkers();
    if (window.BASEMAP && window.BASEMAP.setExtraAttribution && t.feats.length) {
      window.BASEMAP.setExtraAttribution('Hus: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>, ' +
        '<a href="https://github.com/microsoft/GlobalMLBuildingFootprints" target="_blank" rel="noopener">Microsoft</a> (ODbL)');
    }
  }
  // Which of the spots in this building is shown? The first that the app knows (bars first, then places).
  function pickId(o) {
    var best = null, bestN = -1;
    o.ids.forEach(function (id) {
      var c = canon(id), b = barOf(c); if (!b) return;
      var n = state[c] ? state[c].n + (state[c].friend ? 100 : 0) : (b.place ? -1 : 0);
      if (n > bestN) { bestN = n; best = c; }
    });
    return best;
  }
  function draw(o, ll) {
    var id = pickId(o);
    if (!id) return;
    var b = barOf(id), st = state[id];
    if (b && b.place && !(st && st.n)) return;   // a restaurant lights up only when someone is there
    var lk = looks(st);
    var pl = L.polygon(ll, { pane: "barlit", renderer: renderer, color: lk.color, weight: lk.weight, opacity: 0.95,
      fillColor: lk.fillColor, fillOpacity: lk.fillOpacity, className: lk.cls, bubblingMouseEvents: false, interactive: true });
    pl._blId = id; pl._blIds = o.ids;
    pl.on("click", onTap);
    pl.addTo(group);
    o.layers.push(pl);
    (byBar[id] || (byBar[id] = [])).push(pl);
  }
  function redrawAll() {
    Object.keys(tiles).forEach(function (k) {
      var t = tiles[k]; if (t.state !== "done") return;
      t.feats.forEach(function (o) {
        o.layers.forEach(dropLayer); o.layers = [];
        var g = o.f.geometry && toLatLngs(o.f.geometry); if (g) draw(o, g);
      });
    });
    refreshMarkers();
  }

  /* ---------- tap → the bar's own marker / sheet ---------- */
  function onTap(e) {
    if (e && e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
    var pl = e.target, ids = (pl._blIds || [pl._blId]).map(canon), id = pl._blId;
    if (ids.length > 1 && e.latlng) {   // several bars in one house: the one nearest the tap
      var bd = Infinity;
      ids.forEach(function (x) { var b = barOf(x); if (!b) return; var d = U.haversine(e.latlng.lat, e.latlng.lng, b.lat, b.lng); if (d < bd) { bd = d; id = x; } });
    }
    open(id);
  }
  function open(id) {
    var esc = String(id).replace(/["\\]/g, "");
    var icon = document.querySelector('.leaflet-hotbars-pane [data-bar="' + esc + '"]') || document.querySelector('.leaflet-bars-pane [data-bar="' + esc + '"]') ||
      document.querySelector('.leaflet-marker-icon[data-bar="' + esc + '"]');
    if (icon) { icon.click(); return true; }
    var b = barOf(id);
    if (b && A && A.openBar) { A.openBar(b); return true; }
    return false;
  }

  /* ---------- live state from the poll ---------- */
  function computeState(beers) {
    var out = {};
    try {
      var per = window.BARS.assign(beers || []).perBar;
      Object.keys(per).forEach(function (id) {
        var list = per[id].beers || [];
        out[String(id)] = { n: list.length, friend: list.some(function (b) { return b.is_mine || !!b.friend_name; }) };
      });
      var cis = A && A.checkins ? A.checkins() || [] : [];
      cis.forEach(function (c) {
        if (!c || !c.bar_id) return;
        var id = canon(c.bar_id), s = out[id] || (out[id] = { n: 0, friend: false, ci: 0 });
        s.ci = (s.ci || 0) + 1; if (!s.n) s.n = 0;
        if (c.is_mine || c.is_friend) s.friend = true;
      });
      Object.keys(out).forEach(function (id) { var s = out[id]; s.n = Math.max(s.n, s.ci || 0); });
    } catch (e) {}
    return out;
  }
  function sig(st) { return Object.keys(st).sort().map(function (k) { var s = st[k]; return k + ":" + (s.n >= HOT_N ? "h" : s.n ? "l" : "q") + (s.friend ? "f" : ""); }).join(","); }
  var lastSig = null;
  function setState(beers) {
    var st = computeState(beers), s = sig(st);
    state = st;
    if (s === lastSig) return;
    lastSig = s;
    redrawAll();
  }

  // Plain bar icons on a lit building get "bl-has" (CSS shrinks them to a badge at zoom ≥ 16).
  var markTimer = 0;
  function refreshMarkers() {
    clearTimeout(markTimer);
    markTimer = setTimeout(function () {
      Array.prototype.forEach.call(document.querySelectorAll(".leaflet-marker-icon.cm[data-bar]"), function (el) {
        var on = !!byBar[el.getAttribute("data-bar")];
        if (el.classList.contains("bl-has") !== on) el.classList.toggle("bl-has", on);
      });
    }, 30);
  }

  window.BARLIT = {
    init: function (api) {
      A = api; map = api && api.map; if (!map || !L || map.getPane("barlit")) return;
      var st = document.createElement("style"); st.id = "bl-css"; st.textContent = CSS; document.head.appendChild(st);
      map.createPane("barlit"); map.getPane("barlit").style.zIndex = 380;
      renderer = L.svg({ pane: "barlit", padding: 0.3 });
      group = L.layerGroup();
      map.on("zoomend moveend", U.debounce(update, 250));
      map.on("layeradd", function (e) { if (e.layer && e.layer.options && e.layer.options.olnuKey) refreshMarkers(); });
      if (window.BARS && window.BARS.onPlacesReady) window.BARS.onPlacesReady(function () { if (Object.keys(tiles).length) redrawAll(); });
      setTimeout(update, 1200);
    },
    onPoll: function (beers) { if (map) setState(beers); },
    // test hooks
    _stats: function () {
      var n = 0; Object.keys(byBar).forEach(function (k) { n += byBar[k].length; });
      return { tiles: Object.keys(tiles).length, polys: n, onMap: !!(map && group && map.hasLayer(group)), bars: Object.keys(byBar) };
    },
    _layers: function (id) { return byBar[canon(id)] || []; },
    _state: function () { return state; },
    open: open, update: update
  };
})();
