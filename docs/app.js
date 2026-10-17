/* Öl Nu — main app. Plain JS, no build step. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, t = I.t;
  var CFG = window.OLNU_CONFIG || {};
  // No Supabase keys yet → "coming soon" mode: real map + real bars, no beers, ÖL! disabled.
  var LIVE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  var PUSH_ON = LIVE && !!CFG.VAPID_PUBLIC_KEY;
  var client = null;
  var authed = false;

  var SWEDEN = [[55.0, 10.9], [69.1, 24.2]];
  var MAX_BOUNDS = [[53.3, 7.5], [70.8, 27.8]];
  var POLL_MS = 30000, POLL_SLOW_MS = 60000, IDLE_MS = 180000, HEAT_MS = 60000, RPC_TIMEOUT_MS = 15000;
  var LUDVIKA = [60.1496, 15.1878], START_ZOOM = 14;
  var HOT_ZOOM = 11, BAR_ZOOM = 13, MAX_PLAIN_BARS = 300;

  var $ = function (id) { return document.getElementById(id); };
  var beers = [];
  var firstLoadDone = false;
  var pendingFocus = null;
  var busy = false;

  /* ---------- RPC wrapper ---------- */
  // Always resolves to {data, error}. Never rejects, never hangs longer than RPC_TIMEOUT_MS.
  function rpc(name, params) {
    if (!client) return Promise.resolve({ data: null, error: { message: "no_client" } });
    // Account moved away (flyttkod): this browser must never use or refresh that session again.
    if (flyttGuard()) return Promise.resolve({ data: null, error: { message: "moved" } });
    return new Promise(function (resolve) {
      var done = false;
      var tm = setTimeout(function () { done = true; resolve({ data: null, error: { message: "timeout" } }); }, RPC_TIMEOUT_MS);
      var finish = function (r) { if (done) return; done = true; clearTimeout(tm); resolve(r); };
      try {
        Promise.resolve(params ? client.rpc(name, params) : client.rpc(name))
          .then(function (r) { finish(r || { data: null, error: null }); }, function (e) { finish({ data: null, error: e || { message: "error" } }); });
      } catch (e) { finish({ data: null, error: e }); }
    });
  }
  function parseData(d) {
    if (typeof d === "string") { try { return JSON.parse(d) || {}; } catch (e) { return {}; } }
    return d || {};
  }
  // v9: hooks into js/social.js + js/extras.js. Returns the joined HTML of string results. A broken module never breaks the app.
  function mods(fn, a, b, c) {
    var out = "";
    [window.SOCIAL, window.EXTRAS, window.RALLY, window.BARSPLUS, window.PRIVACY, window.GAMES, window.AFTER, window.BOARDS, window.DELIGHT, window.GANG, window.PHOTO, window.CREW, window.CHIEF, window.DUEL, window.WISH].forEach(function (m) {
      if (!m || typeof m[fn] !== "function") return;
      try { var r = m[fn](a, b, c); if (typeof r === "string") out += r; } catch (e) { try { console.warn("olnu " + fn, e); } catch (x) {} }
    });
    return out;
  }
  // v14 (owner: all drinks count): every live pin as a light view whose beer_count = beers + other drinks.
  // Used for levels, chaos, heat, counts, top lists and news numbers. The real rows stay in "beers".
  var drinkViews = null;
  function beerOnly() {
    if (drinkViews) return drinkViews;
    drinkViews = beers.filter(function (b) { return U.drinks(b) >= 1; }).map(function (b) {
      var v = Object.create(b); v.beer_count = U.drinks(b); v.beers_only = b.beer_count | 0; v.other_count = 0; v.row = b;
      return v;
    });
    return drinkViews;
  }

  /* ---------- Toasts ---------- */
  function toast(msg, opts) {
    opts = opts || {};
    var box = $("toasts"), el = document.createElement("div");
    if (opts.id) { toastClear(opts.id); el.setAttribute("data-id", opts.id); }
    el.className = "toast" + (opts.err ? " err" : "") + (opts.cls ? " " + opts.cls : "");
    el.setAttribute("role", opts.err ? "alert" : "status");
    var span = document.createElement("span"); span.textContent = msg; el.appendChild(span);
    if (opts.action) {
      var b = document.createElement("button"); b.className = "btn btn-small"; b.type = "button";
      b.textContent = opts.action.label;
      b.onclick = function () { if (!opts.action.stay) el.remove(); opts.action.fn(b, el); };
      el.appendChild(b);
    }
    el.addEventListener("click", function (e) { if (e.target === el || e.target === span) el.remove(); });
    if (opts.keep) { el.setAttribute("data-keep", "1"); toastShow(el, opts); return el; }
    // Design pass 2: toast queue. Max 1 visible (2 when both are alarms) + 1 waiting. Rank: 3 = error or a toast with a button,
    // 2 = alarm (medevac, undo, level pop, kaos), 1 = the answer to a tap (within 2.5 s), 0 = calm news (polls, kings,
    // medals). A toast replaces the visible one only with an equal or higher rank (the old one then waits); calm
    // toasts also wait while a sheet is open. A newer toast replaces a waiting one of the same or lower rank.
    var rank = opts.err || opts.action ? 3 : opts.urgent || /\b(med|undo|lv-pop|chaos-toast|promo)\b/.test(opts.cls || "") ? 2 : Date.now() - lastTap < 2500 ? 1 : 0;
    el._olnuT = { opts: opts, rank: rank };
    var vis = toastsVisible(), vr = vis.length ? Math.max.apply(null, vis.map(function (x) { return x._olnuT ? x._olnuT.rank : 0; })) : -1;
    if (!vis.length && (rank > 0 || !sheetIsOpen())) toastShow(el, opts);
    else if (rank >= 2 && vis.every(function (x) { return x._olnuT && x._olnuT.rank >= 2; })) {
      // Two alarms about the same moment (friend at 10: level line + "Jag kollar") may stand together; never more than 2.
      while (vis.length >= 2) vis.shift().remove();
      toastShow(el, opts);
    } else if (vis.length && rank >= 1 && rank >= vr) {
      vis.forEach(function (x) { var r = x._olnuT ? x._olnuT.rank : 0; if (r >= 1 && (!toastWait || r >= toastWait._olnuT.rank)) toastWait = x; x.remove(); });
      toastShow(el, opts);
    } else if (!toastWait || rank >= toastWait._olnuT.rank) toastWait = el;
    return el;
  }
  var toastWait = null, lastTap = 0, lastTapOut = 0;
  ["pointerdown", "keydown", "click"].forEach(function (ev) { document.addEventListener(ev, function (e) {
    lastTap = Date.now();
    // A tap outside the beer-type strip and the ÖL! button = the user asked for something (a sheet may open now).
    var tg = e && e.target && e.target.closest ? e.target : null;
    if (!tg || !tg.closest(".bp-strip, #btn-beer")) lastTapOut = Date.now();
  }, true); });
  function sheetIsOpen() { var s = $("sheet"); return !!(s && !s.hidden); }
  function toastsVisible() { return Array.prototype.filter.call($("toasts").children, function (x) { return !x.hasAttribute("data-keep"); }); }
  function toastShow(el, opts) {
    $("toasts").appendChild(el);
    if (opts.ms !== 0) setTimeout(function () { el.remove(); }, opts.ms || 3800);
  }
  function toastPump() {
    if (!toastWait || toastsVisible().length || (sheetIsOpen() && !toastWait._olnuT.rank)) return;
    var el = toastWait; toastWait = null;
    toastShow(el, el._olnuT.opts);
  }
  if (window.MutationObserver) new MutationObserver(function () { setTimeout(toastPump, 250); }).observe($("toasts"), { childList: true });
  function toastClear(id) {
    document.querySelectorAll('#toasts [data-id="' + id + '"]').forEach(function (x) { x.remove(); });
    if (toastWait && toastWait.getAttribute("data-id") === id) toastWait = null;
  }

  /* ---------- Map ---------- */
  // v14 worldwide: no Sweden bounds. worldCopyJump keeps pins visible across the date line.
  var map = L.map("map", {
    zoomControl: false, attributionControl: false, minZoom: 3, maxZoom: 19,
    worldCopyJump: true, tap: true
  });
  // Start on Ludvika. If the user allows location, we move to them (see locate()).
  map.setView(LUDVIKA, START_ZOOM);
  // Default tiles: Esri Dark Gray Canvas (no key, no watermark). With CFG.CARTO_KEY set: CARTO dark_all.
  if (CFG.CARTO_KEY) {
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=" + encodeURIComponent(CFG.CARTO_KEY), {
      subdomains: "abcd", maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
    }).addTo(map);
  } else {
    var ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
    L.tileLayer(ESRI + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 16, maxZoom: 19,
      attribution: 'Tiles &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(map);
    L.tileLayer(ESRI + "World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 19, opacity: 0.85 }).addTo(map);
  }
  // Dock height as a CSS var, so the ⓘ map-sources button sits just above the dock (the Sluta dricka row comes and goes).
  (function () {
    var dock = document.querySelector(".dock");
    function upd() { document.documentElement.style.setProperty("--dock-h", Math.round(dock.getBoundingClientRect().height) + "px"); }
    upd();
    if (window.ResizeObserver) new ResizeObserver(upd).observe(dock); else window.addEventListener("resize", upd);
  })();
  /* Map sources: a small ⓘ button with a popover (OSM guidelines allow an "i" toggle on small screens). */
  (function () {
    var btn = $("btn-attrib"), pop = $("attrib-pop"), parts = [];
    map.eachLayer(function (l) { var a = l.getAttribution && l.getAttribution(); if (a && parts.indexOf(a) < 0) parts.push(a); });
    pop.innerHTML = parts.join(" | ");   // static strings from the tile layers above
    function setOpen(on) { pop.hidden = !on; btn.setAttribute("aria-expanded", String(on)); }
    btn.addEventListener("click", function (e) { e.stopPropagation(); setOpen(pop.hidden); });
    document.addEventListener("pointerdown", function (e) {
      if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) setOpen(false);
    }, true);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !pop.hidden) { setOpen(false); btn.focus(); } });
    map.on("movestart", function () { setOpen(false); });
  })();
  // Keep popups clear of the top HUD and the bottom dock.
  L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(10, 150), autoPanPaddingBottomRight: L.point(10, 290), maxWidth: Math.min(300, Math.max(220, (window.innerWidth || 360) - 60)) });

  map.createPane("bars"); map.getPane("bars").style.zIndex = 590;
  map.createPane("hotbars"); map.getPane("hotbars").style.zIndex = 650;

  // Never spiderfy (a crowded spot became a tangle). A tap on a cluster zooms in, or, when zooming
  // would not split it (same spot, or already close in), opens a clean list sheet (openCrowd).
  // Clustering stays on at every zoom (no disableClusteringAtZoom) so pins never sit on top of each other.
  // A pill with a name label ("5 🍺 · 2 🥃" + "Robban") is ~90–130 px wide, so pins closer than that
  // stay in one cluster; pins further apart show one by one.
  var clusters = L.markerClusterGroup({
    showCoverageOnHover: false, spiderfyOnMaxZoom: false, zoomToBoundsOnClick: false,
    maxClusterRadius: function (z) { return z >= 13 ? 130 : 80; },
    iconCreateFunction: function (cluster) {
      var kids = cluster.getAllChildMarkers(), friend = false, mine = false, lvl = 0, n = 0;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].options.friend) friend = true;
        if (kids[i].options.mine) mine = true;
        if ((kids[i].options.streak | 0) > lvl) lvl = kids[i].options.streak | 0;
        n++;
      }
      // Cluster: just the number. The border shows the highest streak inside.
      return L.divIcon({
        html: U.pillHTML(n, lvl, { friend: friend, mine: mine, noEmoji: true, cls: "p-cl" }),
        className: "olnu-cl", iconSize: [0, 0], iconAnchor: [0, 0]
      });
    }
  });
  map.addLayer(clusters);
  var CROWD_SPAN_M = 120, CROWD_ZOOM = 17;
  clusters.on("clusterclick", function (e) {
    var c = e.layer; if (!c) return;
    var list = [];
    c.getAllChildMarkers().forEach(function (m) { var b = beerById(m.options.beerId); if (b) list.push(b); });
    var bnds = c.getBounds(), z = map.getZoom();
    var span = bnds.isValid() ? U.haversine(bnds.getSouth(), bnds.getWest(), bnds.getNorth(), bnds.getEast()) : 0;
    var target = bnds.isValid() ? map.getBoundsZoom(bnds.pad(0.3)) : z;
    if (list.length && (span <= CROWD_SPAN_M || z >= CROWD_ZOOM || target <= z || z >= map.getMaxZoom())) openCrowd(list, null);
    else c.zoomToBounds({ padding: [40, 40] });
  });
  // Zoomed out: a class on the map so CSS can slim the markers and let the heat glow show.
  function zoomClass() { var z = map.getZoom(); map.getContainer().classList.toggle("olnu-zlo", z < 14); map.getContainer().classList.toggle("olnu-zxlo", z < 12.5); }
  map.on("zoomend", zoomClass); zoomClass();
  var hotLayer = L.layerGroup().addTo(map);
  var barLayer = L.layerGroup().addTo(map);

  /* ---------- Heat glow (leaflet.heat). Its canvas goes in overlayPane (z 400), under the marker pane (z 600). ----------
     Polish (owner: "heat doesn't match the numbers, the hotspot jumps when a pinch ends, zoomed out I want hotspots"):
     - radius in metres (HEAT_R_M), clamped 24–60 px (14 px was too small to see at zoom 10), recomputed for the zoom of every drawn frame;
     - the canvas is never CSS-scaled: during a pinch it is redrawn on each "zoom" event, during a zoom animation
       it is redrawn every frame with the same easing as Leaflet's CSS zoom, so the last animated frame IS the
       final frame (no jump at zoomend, also where the px clamp applies);
     - no maxZoom fade; colour scale per view (≈ 0.6 × the hottest cell in view), softer curve zoomed out;
     - fed the same bar-snapped spots as the markers (live drinks), plus tonight's server trail at low weight. */
  var HEAT_KEY = "olnu.heat";
  var heatOn = U.ls.get(HEAT_KEY, "1") !== "0";
  var heat = null;
  var HEAT_R_M = 170, HEAT_MIN_PX = 34, HEAT_MAX_PX = 80, HEAT_FLOOR = 4, HEAT_TRAIL_W = 0.3, HEAT_ANIM_MS = 250;
  function heatRadiusPx(z, lat) {
    var mpp = 156543.03 * Math.cos((lat || 0) * Math.PI / 180) / Math.pow(2, z);
    // Zoomed out the glow must be clearly bigger than the markers (owner: "heatmapen är helt gömd"):
    // min 34 px at zoom 15+, growing to 120 px at zoom 11 and below.
    var minPx = z >= 15 ? HEAT_MIN_PX : z <= 11 ? 120 : HEAT_MIN_PX + (15 - z) / 4 * (120 - HEAT_MIN_PX);
    return Math.max(minPx, Math.min(Math.max(HEAT_MAX_PX, minPx), HEAT_R_M / Math.max(1e-6, mpp)));
  }
  // Fade the glow when zoomed in close (markers + labels carry the detail there). Continuous: no jump.
  function heatOpacity(z) { return z <= 15.5 ? 1 : z >= 18 ? 0.45 : 1 - (z - 15.5) / 2.5 * 0.55; }
  // Softer colour curve when zoomed out, so small towns still glow next to a big one (Strava-style per-view scale).
  function heatGamma(z) { return z <= 11 ? 0.5 : z >= 14 ? 1 : 0.5 + (z - 11) / 3 * 0.5; }
  // CSS cubic-bezier(0,0,0.25,1) = Leaflet's zoom transition. Returns eased progress for t in 0..1.
  function zoomEase(t) {
    if (t <= 0) return 0; if (t >= 1) return 1;
    var x1 = 0, y1 = 0, x2 = 0.25, y2 = 1, lo = 0, hi = 1, u = t;
    for (var i = 0; i < 24; i++) {
      u = (lo + hi) / 2;
      var x = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
      if (x < t) lo = u; else hi = u;
    }
    return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
  }
  if (L.HeatLayer && !L.HeatLayer.prototype._olnuFixed) {
    var HP = L.HeatLayer.prototype, origInit = HP._initCanvas;
    HP._initCanvas = function () {
      origInit.call(this);
      // We animate it ourselves: no CSS zoom transition, no CSS scale.
      L.DomUtil.removeClass(this._canvas, "leaflet-zoom-animated");
      this._canvas.style.transformOrigin = "0 0"; this._canvas.style.webkitTransformOrigin = "0 0";
    };
    // proj(latlng) → container point of the frame; z = (fractional) zoom of the frame; normZ: zoom for the colour scale.
    HP._drawFrame = function (proj, z, lat, norm) {
      var m = this._map; if (!m || !this._heat) return;
      var R = heatRadiusPx(z, lat);
      if (!this._rNow || Math.abs(R - this._rNow) > 0.2) { this._heat.radius(R * 0.5, R * 0.5); this._rNow = R; }
      var size = m.getSize(), r = this._heat._r, g = Math.max(2, r / 2), cells = {}, list = [];
      if (this._canvas.width !== size.x) this._canvas.width = this._heat._width = size.x;
      if (this._canvas.height !== size.y) this._canvas.height = this._heat._height = size.y;
      L.DomUtil.setTransform(this._canvas, m.containerPointToLayerPoint([0, 0]), 1);
      var ll = this._latlngs || [], i, p, w, k, c;
      for (i = 0; i < ll.length; i++) {
        p = proj(ll[i]);
        if (p.x < -r || p.y < -r || p.x > size.x + r || p.y > size.y + r) continue;
        w = ll[i][2] != null ? +ll[i][2] : 1; if (!(w > 0)) continue;
        // Cells anchored to the map (not the screen), weighted mean position like leaflet.heat.
        var o = this._cellOrigin ? proj(this._cellOrigin) : { x: 0, y: 0 };
        k = Math.floor((p.x - o.x) / g) + "_" + Math.floor((p.y - o.y) / g);
        c = cells[k];
        if (c) { c[0] = (c[0] * c[2] + p.x * w) / (c[2] + w); c[1] = (c[1] * c[2] + p.y * w) / (c[2] + w); c[2] += w; }
        else { c = cells[k] = [p.x, p.y, w]; list.push(c); }
      }
      var peak = norm;
      if (peak == null) { peak = 0; for (i = 0; i < list.length; i++) if (list[i][2] > peak) peak = list[i][2]; }
      peak = Math.max(HEAT_FLOOR, peak);
      var gam = heatGamma(z), data = [];
      for (i = 0; i < list.length; i++) data.push([Math.round(list[i][0]), Math.round(list[i][1]), Math.min(1, Math.pow(list[i][2] / peak, gam) / 0.6)]);
      this._heat.max(1);
      this._heat.data(data).draw(this.options.minOpacity);
      this._canvas.style.opacity = String(heatOpacity(z));
      this._lastPeak = peak;
    };
    // Hottest cell of a view (center/zoom), for a stable colour scale through a whole animation.
    HP._peakFor = function (proj, z, lat) {
      var m = this._map, size = m.getSize(), r = heatRadiusPx(z, lat), g = Math.max(2, r / 2), cells = {}, peak = 0;
      var ll = this._latlngs || [], o = this._cellOrigin ? proj(this._cellOrigin) : { x: 0, y: 0 };
      for (var i = 0; i < ll.length; i++) {
        var p = proj(ll[i]); if (p.x < -r || p.y < -r || p.x > size.x + r || p.y > size.y + r) continue;
        var k = Math.floor((p.x - o.x) / g) + "_" + Math.floor((p.y - o.y) / g);
        cells[k] = (cells[k] || 0) + (+ll[i][2] || 1); if (cells[k] > peak) peak = cells[k];
      }
      return peak;
    };
    HP._redraw = function () {
      this._frame = null;
      if (this._anim) return;   // the zoom animation draws its own frames (its last frame = the final view)
      var m = this._map; if (!m) return;
      this._drawFrame(function (x) { return m.latLngToContainerPoint(x); }, m.getZoom(), m.getCenter().lat, null);
    };
    HP._reset = function () { if (this._anim) return; this._redraw(); };
    // Zoom animation (double tap, +/-, flyTo end, pinch release snap): draw every frame with Leaflet's easing.
    HP._animateZoom = function (e) {
      var m = this._map, self = this; if (!m || !this._heat) return;
      if (this._anim) cancelAnimationFrame(this._anim.raf);
      var z0 = m.getZoom(), z1 = e.zoom, S = m.getZoomScale(z1, z0), pane = m._getMapPanePos(), lat = e.center.lat;
      var p0 = function (x) { return m.latLngToContainerPoint(x); };
      var p1 = function (x) { return m._latLngToNewLayerPoint(x, z1, e.center).add(pane); };
      var norm = this._peakFor(p1, z1, lat), t0 = performance.now();
      var a = this._anim = { raf: 0 };
      var frame = function () {
        if (self._anim !== a) return;
        var t = Math.min(1, (performance.now() - t0) / HEAT_ANIM_MS), q = zoomEase(t), s = 1 + (S - 1) * q;
        var zf = z0 + Math.log(s) / Math.LN2;
        self._drawFrame(function (x) { var a0 = p0(x), a1 = p1(x); return L.point(a0.x + (a1.x - a0.x) * q, a0.y + (a1.y - a0.y) * q); }, zf, lat, norm);
        if (t < 1 && m._animatingZoom !== false) a.raf = requestAnimationFrame(frame);
        else a.raf = 0;
      };
      frame();
      // Leaflet ends the zoom with zoomend → moveend (_reset). Draw the exact final frame there.
      m.once("zoomend", function () { if (self._anim === a) { cancelAnimationFrame(a.raf); self._anim = null; self._redraw(); } });
    };
    HP._olnuFixed = true;
  }
  if (typeof L.heatLayer === "function") {
    heat = L.heatLayer([], {
      radius: 25, blur: 30, minOpacity: 0.42,
      gradient: { 0.05: "rgba(90,35,0,0)", 0.22: "#c2650a", 0.42: "#f5a623", 0.62: "#ff7a1a", 0.82: "#ff3b3b", 1.0: "#fff6e0" }
    });
    heat._cellOrigin = L.latLng(LUDVIKA[0], LUDVIKA[1]);
  }
  // Pinch-zoom on phones fires "zoom" on every frame (no zoomanim until the fingers lift): redraw at the live zoom.
  var heatPinchRaf = 0;
  map.on("zoom", function () {
    if (!heat || !map.hasLayer(heat) || map._animatingZoom || heat._anim || heatPinchRaf) return;
    heatPinchRaf = requestAnimationFrame(function () {
      heatPinchRaf = 0;
      if (!map._animatingZoom && !heat._anim && map.hasLayer(heat)) heat._redraw();
    });
  });
  // Where a pin is drawn: on its bar's point when it belongs to a bar (same rule as the markers), else its own spot.
  function pinSpot(b) {
    if (b.snap === "area" || !b.precise) return [b.lat, b.lng];
    var bar = null;
    if (b.bar_id != null) bar = window.BARS.byId(b.bar_id);
    else if (!b.snap && window.BARS.nearestSpot) bar = window.BARS.nearestSpot(b.lat, b.lng);
    return bar ? [bar.lat, bar.lng] : [b.lat, b.lng];
  }
  // heatPoints: tonight's trail from the server (heat_points / poll_v2.heat, already snapped to bars / 55 m cells).
  // null = not available (old database).
  var heatPoints = null, heatRpcMissing = false, heatFetchedAt = 0;
  function loadHeatPoints() {
    if (pollV2 === "on") return;   // v13: heat comes with poll_v2 (max once per minute, only when the layer is on)
    if (!heat || heatRpcMissing || !heatOn || Date.now() - heatFetchedAt < 25000) return;
    heatFetchedAt = Date.now();
    rpc("heat_points").then(function (r) {
      if (r.error) {
        var m = String(r.error.message || r.error.code || "");
        if (/PGRST202|could not find the function|does not exist|\b404\b/i.test(m)) heatRpcMissing = true;
        return;
      }
      var list = (r.data || []).filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lng) && p.w > 0; });
      heatPoints = list.map(function (p) { return [+p.lat, +p.lng, +p.w]; });
      renderHeat();
    });
  }
  // Live drinks (weight = the number on the pill, at the marker's spot) + the night's trail at low weight.
  function heatData() {
    var out = [];
    beerOnly().forEach(function (b) { var s = pinSpot(b); out.push([s[0], s[1], Math.max(1, U.drinks(b))]); });
    if (heatPoints) heatPoints.forEach(function (p) { out.push([p[0], p[1], p[2] * HEAT_TRAIL_W]); });
    return out;
  }
  function renderHeat() {
    if (!heat) return;
    if (heatOn && !map.hasLayer(heat)) heat.addTo(map);
    if (!heatOn && map.hasLayer(heat)) map.removeLayer(heat);
    if (!heatOn) return;
    heat.setLatLngs(heatData());
  }
  // "🔥 Värme" → icon + screen-reader word. Re-wraps when another module sets textContent again.
  function iconChip(b) {
    if (!b) return;
    function wrap() {
      if (b.querySelector(".mc-i")) return;
      var tx = b.textContent.trim(), i = tx.indexOf(" ");
      if (i < 0) return;
      var w = tx.slice(i + 1);
      b.innerHTML = '<span class="mc-i" aria-hidden="true">' + U.esc(tx.slice(0, i)) + '</span><span class="mc-t">' + U.esc(w) + "</span>";
      if (!b.title) b.title = w;
    }
    wrap();
    if (window.MutationObserver) new MutationObserver(wrap).observe(b, { childList: true, characterData: true, subtree: true });
  }
  function applyHeatBtn() {
    var b = $("btn-heat");
    b.hidden = !heat || !LIVE;
    b.textContent = t("heat");
    b.setAttribute("aria-pressed", String(heatOn));
    b.setAttribute("aria-label", heatOn ? t("heatOn") : t("heatOff"));
  }
  $("btn-heat").addEventListener("click", function () {
    heatOn = !heatOn; U.ls.set(HEAT_KEY, heatOn ? "1" : "0");
    applyHeatBtn(); heatFetchedAt = 0; heatAskAt = 0; loadHeatPoints(); renderHeat();
    if (heatOn && pollV2 === "on") refresh();
  });

  function lvlClass(l) { return l === 2 ? " medevac" : l === 1 ? " hot" : ""; }
  // Single pin: compact pill "N 🍺". Streak shows only as the pill border.
  function beerIcon(b) {
    var n = Math.max(1, U.drinks(b));
    var label = b.friend_name ? '<span class="bm-name">' + U.esc(b.friend_name) + "</span>" :
      b.is_mine ? '<span class="bm-name bm-me">' + U.esc(t("you")) + "</span>" : "";
    var html = U.pillHTML(n, U.level(n), { friend: !!b.friend_name, mine: !!b.is_mine, approx: !b.precise, label: label });
    return L.divIcon({ html: html, className: "", iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -12] });
  }
  /* ---------- Drink levels (polish): Swedish names from js/levels-content.js (LEVELS_SV at 3/5/7/10/13/16/20).
     Each person gets one of the 6 names per level per night (hash of night + person + level: stable, no flicker).
     English keeps HOT STREAK / MEDEVAC. 10+ stays caring. ---------- */
  function lvList() { return I.lang === "sv" && Array.isArray(window.LEVELS_SV) && window.LEVELS_SV.length ? window.LEVELS_SV : null; }
  function lvOf(n) {
    var all = lvList(), best = null; if (!all) return null;
    for (var i = 0; i < all.length; i++) if (n >= all[i].at && (!best || all[i].at > best.at)) best = all[i];
    return best;
  }
  function lvAt(at) { var all = lvList() || []; for (var i = 0; i < all.length; i++) if (all[i].at === at) return all[i]; return null; }
  function hashStr(x) { var h = 2166136261; x = String(x); for (var i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function lvNight() { try { return window.NEWS && window.NEWS.nightKey ? window.NEWS.nightKey() : ""; } catch (e) { return ""; } }
  function personKey(b) {
    if (!b || b.is_mine) return "me";
    if (b.friend_name) return "f:" + b.friend_name;
    return "s:" + (b.bar_id || "") + ":" + (+b.lat).toFixed(4) + "," + (+b.lng).toFixed(4) + ":" + (b.created_at || "");
  }
  // The name changes every 10 minutes (same for everyone in that window), so it never feels stuck.
  function lvName(lv, key) { return lv.names[hashStr(lvNight() + "|" + key + "|" + lv.key + "|" + Math.floor(Date.now() / 6e5)) % lv.names.length]; }
  var lvLastLine = {};
  function lvLine(lv) {
    var a = lv.lines || [], i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && i === lvLastLine[lv.key]) i = (i + 1) % a.length;
    lvLastLine[lv.key] = i;
    return a[i] || "";
  }
  function noLeadEmoji(s) { return String(s || "").replace(/^[^0-9A-Za-zÅÄÖåäöÉé"'(]+/, ""); }
  // "🔥 Het på gröten" for a pin (null below level 3 or in English).
  function lvTag(b) { var lv = lvOf(U.drinks(b)); return lv ? { lv: lv, name: lvName(lv, personKey(b)) } : null; }
  function lvEmoji(b) {
    var x = lvTag(b); if (x) return x.lv.emoji;
    var l = U.level(U.drinks(b)); return l === 2 ? "🚁" : l === 1 ? "🔥" : "🍺";
  }
  // Popup line for a pin (x = one pin) or a bar (x = list: its top drinker). l = U.level of that count.
  function levelLine(l, x) {
    var b = Array.isArray(x) ? x.slice().sort(function (a, c) { return U.drinks(c) - U.drinks(a); })[0] : x;
    var tag = b ? lvTag(b) : null;
    if (tag) {
      return '<div class="pp-lv" style="color:' + U.esc(tag.lv.color) + '">' + tag.lv.emoji + " " + U.esc(tag.name) + "</div>" +
        (U.drinks(b) >= 10 ? '<div class="pp-care">' + U.esc(t("care")) + "</div>" : "");
    }
    if (l === 2) return '<div class="pp-med">🚁 ' + U.esc(t("medevac")) + '</div><div class="pp-care">' + U.esc(t("care")) + "</div>";
    if (l === 1) return '<div class="pp-hot">🔥 ' + U.esc(t("hot")) + "</div>";
    return "";
  }
  // Toast when someone else reaches 5 / 10. Friends: LEVEL_FRIEND_SV lines. Strangers: "🔥 Någon vid X: Het på gröten!"
  function streakToastText(b, l, who, where) {
    var tag = lvTag(b);
    if (tag && b.friend_name && window.LEVEL_FRIEND_SV) {
      var arr = window.LEVEL_FRIEND_SV[l === 2 ? "at10" : "at5"] || [];
      if (arr.length) return arr[hashStr(lvNight() + b.friend_name + l + Math.floor(Date.now() / 6e5)) % arr.length].replace(/\{name\}/g, b.friend_name);
    }
    if (tag) return tag.lv.emoji + " " + who + " " + where + ": " + tag.name + "!";
    return l === 2 ? t("newMed", who, where) : t("newHot", who, where);
  }
  function skalCount(b) { return Math.max(0, b.skal_count | 0); }
  function skalBtn(b, small) {
    var done = !!b.i_skaled;
    // Quiet outline and no "(0)" until someone has skålat; amber once there are skåls.
    var n = skalCount(b);
    return '<button type="button" class="skal-btn' + (small ? " small" : "") + (n > 0 ? " has" : "") + '" data-skal="' + U.esc(String(b.id)) + '"' +
      (done ? " disabled" : "") + ">" + U.esc(done ? t("skaled", n) : n > 0 ? t("skal", n) : t("skalDone")) + "</button>";
  }
  function otherLine(b) {
    var oc = b.other_count | 0; if (!oc) return "";
    var k = (t("kindLow") || {})[b.other_kind] || (t("kindLow") || {}).annat || "";
    return '<div class="pp-other">' + U.esc(oc === 1 ? t("otherPlus", oc, k) : t("otherPlusMany", oc, k)) + "</div>";
  }
  function beerPopup(b) {
    var h = '<div class="pp-title">' + U.esc(t("beerNo", U.drinks(b))) + "</div>" +
      '<div class="pp-data">' + U.esc(t("since", U.timeHM(b.created_at))) + "</div>";
    h += levelLine(U.level(U.drinks(b)), b);
    if (b.is_mine) h += '<div class="pp-mine">' + U.esc(t("you")) + '</div><div class="pp-skal">' + U.esc(t("skalN", skalCount(b))) + "</div>";
    if (b.friend_name) h += '<div class="pp-friend">' + U.esc(b.friend_name) + "</div>";
    h += mods("beerTitleHTML", b);
    if (!b.precise) h += '<div class="pp-note">' + U.esc(t("approx")) + "</div>";
    if (!b.is_mine) h += skalBtn(b, false);
    else h += '<button type="button" class="btn btn-small btn-block pp-hide" data-hidepin="1">' + U.esc(t("hidePin")) + "</button>";
    h += mods("beerPopupHTML", b);
    return h;
  }
  function barTypeLabel(type) { var m = t("barTypes"); return m[type] || (t("placeTypes") || {})[type] || m.bar; }
  function maxLevel(list) { var l = 0; list.forEach(function (b) { l = Math.max(l, U.level(U.drinks(b))); }); return l; }
  /* ---------- One marker per bar (polish 2026-10-17, research "place stack") ----------
     Bar icon + people pill + check-in badge + call-out badge (🪖N) + name label = ONE composite marker with
     one ≥ 44×44 px hit area. A tap anywhere on it opens ONE popup with the sections Checka in, Inkallelser,
     Folk här nu, Incheckade. Labels only at zoom ≥ 16 and only when they do not collide. Selected = 1.25×. */
  var LABEL_ZOOM = 16;
  function friendHere(list) { return list.some(function (b) { return b.friend_name; }); }
  // Priority for z-order and label collision: call-out > friends present > people > check-ins > empty bar.
  function barPrio(c) {
    return (c.rallies.length ? 4000 : 0) + (friendHere(c.beers) || c.cis.some(function (x) { return x.is_friend || x.is_mine; }) ? 3000 : 0) +
      (c.beers.length ? 1000 + Math.min(500, c.beers.length * 10) : 0) + (c.cis.length ? 200 + c.cis.length : 0) + maxLevel(c.beers) * 100;
  }
  // Design pass 2 (declutter): module badges (👑 king, 🏰 takeover, queue) are read here and redrawn as small
  // fixed slots on the marker, only at zoom ≥ 16. The takeover group name is never on the map (popup only).
  var tplBox = document.createElement("div");
  function pickBadges(html, out) {
    if (!html) return "";
    tplBox.innerHTML = html;
    tplBox.querySelectorAll(".bi-king, .bm-king").forEach(function (x) { out.king = true; x.remove(); });
    tplBox.querySelectorAll(".bi-flag, .bm-flag").forEach(function (x) { out.flag = true; if (x.classList.contains("mine")) out.flagMine = true; x.remove(); });
    if (out.z < LABEL_ZOOM) tplBox.querySelectorAll(".bm-q, .bm-crowd").forEach(function (x) { x.remove(); });
    var r = tplBox.innerHTML; tplBox.innerHTML = ""; return r;
  }
  function compositeIcon(c) {
    var bar = c.bar, z = map.getZoom(), list = c.beers, h = '<div class="cm-in">', bx = { z: z };
    var ico = pickBadges(mods("barIcoHTML", bar), bx);
    h += bar.place ? '<div class="bar-ico place-ico" aria-hidden="true">🍽️' + ico + "</div>" :
      '<div class="bar-ico">' + U.GLASS_OUTLINE_SVG + ico + "</div>";
    if (list.length) {
      h += U.pillHTML(list.length, maxLevel(list), { friend: friendHere(list), mine: list.some(function (b) { return b.is_mine; }), cls: "p-bar",
        label: pickBadges(mods("barBadgeHTML", bar, list, z), bx) });
    }
    if (z >= LABEL_ZOOM) {
      if (bx.king) h += '<span class="cm-b cm-king" aria-hidden="true">👑</span>';
      if (bx.flag) h += '<span class="cm-b cm-flag' + (bx.flagMine ? " mine" : "") + '" aria-hidden="true">🏰</span>';
    }
    if (c.rallies.length) {
      var yes = 0, me = false;
      c.rallies.forEach(function (r) { yes = Math.max(yes, r.yes | 0); if (r.my_answer === "yes") me = true; });
      h += '<span class="cm-rally' + (me ? " me" : "") + '" title="' + U.esc(t("cmRallyAria", yes)) + '">🪖<b>' + yes + "</b>" + (c.rallies.length > 1 ? '<i class="cm-dot"></i>' : "") + "</span>";
    }
    // Check-in badge: always on a bar without drinkers; next to a people pill only when zoomed in (less clutter).
    // Check-in count: zoom ≥ 16 only (below it the bar icon is just "lit", not a number).
    if (c.cis.length && z >= LABEL_ZOOM) h += '<span class="cm-ci" aria-hidden="true">🚪<b>' + c.cis.length + "</b></span>";
    if (bar.name) h += '<span class="cm-lbl' + (list.length ? " below" : "") + '">' + U.esc(bar.name) + "</span>";
    h += "</div>";
    var quiet = !list.length && !c.rallies.length && !c.cis.length && z < LABEL_ZOOM;
    return L.divIcon({ html: h, className: "cm" + (list.length ? " cm-hot" : "") + (c.rallies.length ? " cm-has-rally" : "") +
        (quiet ? " cm-quiet" : "") + (!list.length && c.cis.length ? " cm-lit" : ""),
      iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -20] });
  }
  // Check-ins per bar id (from the poll), rally badges per bar id (js/rally.js).
  function checkinsByBar() {
    var out = {};
    checkins.forEach(function (c) { var id = c.bar_id ? window.BARS.canonId(c.bar_id) : ""; if (id) (out[id] = out[id] || []).push(c); });
    return out;
  }
  function rallyBadges(z) {
    try { return window.RALLY && window.RALLY.barBadges ? window.RALLY.barBadges(z) || {} : {}; } catch (e) { return {}; }
  }
  function sec(title, body, cls) {
    return '<div class="pp-sec' + (cls ? " " + cls : "") + '"><div class="pp-sec-h">' + U.esc(title) + "</div>" + body + "</div>";
  }
  /* ---------- Bar sheet (design pass 2, owner: "the list you see when you tap a place is far too full") ----------
     Header (name · type · "≈ 7 här · Livligt" · 👑 🏰 🕺 🚶) → ONE action row (Checka in, På väg, Kommer when exactly
     one call-out) → one short care line at 10+ → compact folds, closed by default: Inkallelser, Folk här, Kö ·
     erbjudanden · tips, Incheckade, Stammis & kung, Info. Module sections (barPopupHTML hooks) are wrapped, not
     removed: their HTML is sorted into the folds by class, so their own click wiring keeps working. On phones the
     Leaflet popup element itself is lifted into a bottom sheet (popupopen below), so every popupopen hook still runs. */
  function tl(sv, en) { return window.I18N && window.I18N.lang === "en" ? en : sv; }
  var FOLD_KEY = "olnu.folds", popBox = document.createElement("div"), foldOnce = null;
  function foldsOpen() { try { return JSON.parse(sessionStorage.getItem(FOLD_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function foldSave(k, on) { try { var f = foldsOpen(); if (on) f[k] = 1; else delete f[k]; sessionStorage.setItem(FOLD_KEY, JSON.stringify(f)); } catch (e) {} }
  document.addEventListener("toggle", function (e) {
    var d = e.target; if (!d || !d.classList || !d.classList.contains("pp-fold")) return;
    foldSave(d.getAttribute("data-fold"), d.open);
  }, true);
  function fold(key, title, n, body, cls, open) {
    if (!body) return "";
    return '<details class="pp-fold pp-sec ' + (cls || "") + '" data-fold="' + key + '"' + (open ? " open" : "") + ">" +
      '<summary><span class="pp-sec-h">' + U.esc(title) + "</span>" + (n ? '<span class="pf-n">' + n + "</span>" : "") +
      '<span class="pf-chev" aria-hidden="true">›</span></summary><div class="pf-body">' + body + "</div></details>";
  }
  // "VILKEN FEST" → "Vilken fest" (only when the whole text is shouted; mixed case stays as written).
  function unshout(s) {
    var letters = String(s).replace(/[^A-Za-zÅÄÖåäöÉé]/g, "");
    return letters.length >= 6 && letters === letters.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s;
  }
  function take(sel) { var out = ""; popBox.querySelectorAll(sel).forEach(function (x) { out += x.outerHTML; x.remove(); }); return out; }
  function barPopup(bar, list) {
    list = list || [];
    var id = bar.id != null ? String(bar.id) : null, open = foldsOpen(), once = foldOnce; foldOnce = null;
    var isOpen = function (k) { return !!open[k] || once === k; };
    // Module sections, sorted by class.
    popBox.innerHTML = mods("barPopupHTML", bar, list);
    var crowdEl = popBox.querySelector(".pp-crowd"), crowd = crowdEl ? crowdEl.textContent : "", crowdCls = crowdEl ? crowdEl.className.replace("pp-crowd", "").trim() : "";
    if (crowdEl) crowdEl.remove();
    var dance = popBox.innerHTML.indexOf("🕺") >= 0;
    var eta = take(".pp-sec-eta");
    var own = take(".bp-own"), qEl = popBox.querySelector(".bp-q"), qCls = qEl ? (qEl.className.match(/q-\w+/) || [""])[0] : "", qTxt = qEl ? qEl.textContent : "";
    var bp = take(".bp"), ofN = (bp.match(/class="bp-of"/g) || []).length;
    var king = take(".pp-king"), stam = take(".af-stam");
    var info = take(".pp-info, .pp-links, .af-qr, .gg-pop") + popBox.innerHTML.trim();
    popBox.innerHTML = "";
    var hasKing = /pp-king"/.test(king) || /class="pp-king"/.test(king);
    // Header
    var h = '<div class="bs-head"><div class="pp-title">' + U.esc(bar.name || t("unnamedBar")) + "</div>" +
      '<div class="bs-meta">' + U.esc(barTypeLabel(bar.type)) +
      (list.length ? ' · <b class="bs-n">' + U.esc(tl("≈ " + list.length + " här", "≈ " + list.length + " here")) + "</b>" : "") +
      (crowd ? ' · <span class="pp-crowd-t ' + U.esc(crowdCls) + '">' + U.esc(crowd) + "</span>" : "") + "</div>";
    var icons = (hasKing ? '<span title="' + U.esc(tl("Kung", "King")) + '">👑</span>' : "") + (own ? '<span title="' + U.esc(tl("Övertagen", "Taken over")) + '">🏰</span>' : "") +
      (dance ? "<span>🕺</span>" : "") + (qEl ? '<span class="bs-q ' + U.esc(qCls) + '" title="' + U.esc(qTxt) + '">🚶</span>' : "");
    if (icons) h += '<div class="bs-icons" aria-hidden="true">' + icons + "</div>";
    h += "</div>";
    // Call-outs (rally.js rows): compact, route link as 🧭, shouting toned down.
    var rl = "", nRl = 0;
    try { rl = id && window.RALLY && window.RALLY.barSectionHTML ? window.RALLY.barSectionHTML(id) : ""; } catch (e) { rl = ""; }
    var kommer = "";
    if (rl) {
      popBox.innerHTML = rl;
      var rows = popBox.querySelectorAll(".pp-rl-row"); nRl = rows.length;
      rows.forEach(function (row) {
        var tx = row.querySelector(".pp-rl-txt");
        if (tx && tx.firstChild && tx.firstChild.nodeType === 3) {   // "🪖 Ström: HÅRDMUSIK…" → only the message part
          var raw = tx.firstChild.textContent, ix = raw.indexOf(": ");
          tx.firstChild.textContent = ix > 0 ? raw.slice(0, ix + 2) + unshout(raw.slice(ix + 2)) : unshout(raw);
        }
        var a = row.querySelector("a.pp-rl-route");
        if (a) { a.setAttribute("aria-label", a.textContent); a.setAttribute("title", a.textContent); a.textContent = "🧭"; }
      });
      if (nRl === 1) {
        var y = popBox.querySelector('[data-rl-ans="yes"]');
        if (y) kommer = '<button type="button" class="pa-kommer' + (y.classList.contains("on") ? " on" : "") + '" data-proxy-rl="' + U.esc(rows[0].getAttribute("data-rl-id") || "") + '">' + U.esc(y.textContent) + "</button>";
      }
      rl = popBox.innerHTML; popBox.innerHTML = "";
    }
    // ONE action row
    var act = checkinBtnHTML(bar) + eta + kommer;
    if (act) h += '<div class="pp-act">' + act + "</div>";
    // At most one short care line (someone here at 10+)
    var top = list.slice().sort(function (a, b) { return U.drinks(b) - U.drinks(a); })[0];
    if (top && U.drinks(top) >= 10) { var tg = lvTag(top); h += '<div class="pp-care1">' + U.esc(tg ? tg.lv.emoji + " " + tg.name : "🚁 " + t("medevac")) + "</div>"; }
    // Folds (closed ones tile two per row; an open one takes the full width)
    var h0 = h; h = "";
    h += fold("rally", tl("🪖 Inkallelser", "🪖 Call-outs"), nRl, rl, "pp-sec-rl", isOpen("rally"));
    if (list.length) {
      var names = [], body = "";
      list.forEach(function (b) { if (b.friend_name && names.indexOf(b.friend_name) < 0) names.push(b.friend_name); });
      if (!(top && U.drinks(top) >= 10)) body += levelLine(maxLevel(list), list);
      if (names.length) body += '<div class="pp-friend">' + U.esc(t("barFriends")) + names.map(U.esc).join(", ") + "</div>";
      var tot = 0; list.forEach(function (b) { tot += skalCount(b); });
      if (tot) body += '<div class="pp-skal">' + U.esc(t("barSkal", tot)) + "</div>";
      var prow = list.slice().sort(function (a, b) { return U.drinks(b) - U.drinks(a); }).slice(0, 8);
      body += '<ul class="pp-list">' + prow.map(function (b) {
        return '<li><span class="pp-who' + (b.friend_name ? " f" : b.is_mine ? " m" : "") + '">' + U.esc(whoOf(b)) + "</span>" +
          '<span class="pp-n">' + U.drinks(b) + " " + lvEmoji(b) + "</span>" +
          (b.is_mine ? '<span class="pp-skal">' + U.esc(t("skalN", skalCount(b))) + "</span>" : skalBtn(b, true)) + "</li>";
      }).join("") + "</ul>";
      if (list.length > 8 && id != null) body += '<button type="button" class="btn btn-small btn-block pp-all" data-crowd="' + U.esc(id) + '">' + U.esc(t("crowdAll", list.length)) + "</button>";
      body += '<div class="pp-note">' + U.esc(t("barNote")) + "</div>";
      h += fold("here", tl("🍺 Folk här", "🍺 People here"), list.length, body, "pp-sec-here", isOpen("here"));
    }
    h += fold("bp", tl("📋 Kö · erbjudanden · tips", "📋 Queue · offers · tips"), ofN, bp, "pp-sec-bp", isOpen("bp"));
    var ci = checkinNamesHTML(bar);
    h += fold("ci", tl("🚪 Incheckade", "🚪 Checked in"), id != null ? checkinsAt(bar).length : 0, ci, "pp-sec-ci", isOpen("ci"));
    h += fold("stam", tl("🎖️ Stammis & kung", "🎖️ Regulars & king"), 0, own + king + stam, "pp-sec-stam", isOpen("stam"));
    h += fold("info", tl("ℹ️ Info", "ℹ️ Info"), 0, info, "pp-sec-info", isOpen("info"));
    return '<div class="bs">' + h0 + (h ? '<div class="pp-folds">' + h + "</div>" : "") + "</div>";
  }
  // Phones: the bar popup's element is moved out of the map into a fixed bottom sheet. It stays a Leaflet popup
  // (popupopen hooks, e.popup.update(), closePopup and a tap on the map all keep working).
  function sheetMode() { return !!(window.matchMedia && window.matchMedia("(max-width: 600px)").matches); }
  var barSheet = null, sheetScroll = {};
  // While the sheet is open, other code must not pan the map to "fit" a popup that is no longer on the map.
  var panBy0 = map.panBy;
  map.panBy = function (off, o) { if (barSheet && !(o && o.olnuSheet)) return this; return panBy0.call(this, off, o); };
  map.on("popupopen", function (e) {
    var pp = e.popup, root = pp && pp.getElement();
    if (!root || !root.querySelector(".bs")) return;
    if (!root._olnuBs) root._olnuBs = true, root.addEventListener("click", function (ev) {
      var k = ev.target.closest && ev.target.closest(".pa-kommer"); if (!k) return;
      ev.preventDefault(); ev.stopPropagation();
      var b = root.querySelector('.pp-rl-row[data-rl-id="' + (k.getAttribute("data-proxy-rl") || "").replace(/["\\]/g, "") + '"] [data-rl-ans="yes"]');
      if (b) { b.click(); k.classList.add("on"); }
    });
    if (!sheetMode()) return;
    barSheet = pp;
    root.classList.add("olnu-sheet");
    if (root.parentNode !== document.body) document.body.appendChild(root);
    document.body.classList.add("barsheet-open");
    var key = pp._source && pp._source.options.olnuKey, sc = root.querySelector(".leaflet-popup-content");
    if (key && sheetScroll[key] && sc) sc.scrollTop = sheetScroll[key];
    if (sc) sc.addEventListener("scroll", function () { if (key) sheetScroll[key] = sc.scrollTop; }, { passive: true });
    // Keep the bar itself visible in the map strip above the sheet.
    requestAnimationFrame(function () {
      if (barSheet !== pp) return;
      var ll = pp.getLatLng(); if (!ll) return;
      var p = map.latLngToContainerPoint(ll), top = 150, bottom = window.innerHeight - root.getBoundingClientRect().height - 16;
      var want = Math.max(top, Math.min(bottom, (top + bottom) / 2));
      if (p.y > bottom || p.y < top) map.panBy([0, Math.round(p.y - want)], { animate: true, duration: 0.3, olnuSheet: true });
    });
  });
  map.on("popupclose", function (e) {
    if (e.popup !== barSheet) return;
    barSheet = null;
    document.body.classList.remove("barsheet-open");
    if (!redrawing) sheetScroll = {};
  });
  // Which part of the bar marker was tapped: open that fold once (🪖 → call-outs, people pill → people, 🚪 → check-ins).
  function foldFromTap(e) {
    var tg = e.target && e.target.closest ? e.target : null; if (!tg) return;
    foldOnce = tg.closest(".cm-rally") ? "rally" : tg.closest(".pill") ? "here" : tg.closest(".cm-ci") ? "ci" : tg.closest(".cm-king, .cm-flag") ? "stam" : null;
  }

  /* ---------- v10 Checka in ---------- */
  var CI_KEY = "olnu.checkin", CI_FRESH_MS = 3 * 3600e3, CI_STAY_M = 150;
  var ciBarById = {};    // bar id -> bar, for the button in an open popup
  // Own check-in on this phone: {id, name, lat, lng, at, until}. null when none or after 05:00.
  function myCheckin() {
    var c = U.ls.getJSON(CI_KEY, null);
    if (!c || !c.until || Date.now() > c.until || !isFinite(c.lat) || !isFinite(c.lng)) return null;
    return c;
  }
  // The server row wins (e.g. checked in on another phone, or the night ended).
  function syncMyCheckin() {
    var mine = null;
    checkins.forEach(function (c) { if (c.is_mine) mine = c; });
    var loc = myCheckin();
    if (!mine) { if (loc && (Date.now() - loc.at) > 120e3) U.ls.del(CI_KEY); return; }
    var at = Date.parse(mine.created_at) || Date.now();
    if (!loc || loc.id !== mine.bar_id || Math.abs(loc.at - at) > 5000) {
      U.ls.setJSON(CI_KEY, { id: String(mine.bar_id), name: mine.bar_name, lat: +mine.lat, lng: +mine.lng, at: at, until: nightEnd() });
    }
  }
  function checkinsAt(bar) {
    var id = String(bar.id);
    return checkins.filter(function (c) { return window.BARS.canonId(c.bar_id) === window.BARS.canonId(id); });
  }
  // "Anton, Oskar + 2 till" (names: me + friends; strangers only as a count).
  function checkinNamesHTML(bar) {
    if (!LIVE || bar == null || bar.id == null) return "";
    var list = checkinsAt(bar), names = [], more = 0;
    list.forEach(function (c) {
      var n = c.is_mine ? (getName() || t("you")) : c.is_friend && c.name ? c.name : null;
      if (n && names.indexOf(n) < 0) names.push(n); else if (!n) more++;
    });
    if (names.length) return '<div class="pp-ci">' + U.esc(t("ciHere", names, more)) + "</div>";
    if (more) return '<div class="pp-ci">' + U.esc(t("ciHereAnon", more)) + "</div>";
    return "";
  }
  // The big "📍 Checka in" button (LIVE and signed in only).
  function checkinBtnHTML(bar) {
    if (!LIVE || bar == null || bar.id == null) return "";
    ciBarById[String(bar.id)] = bar;
    if (!authed || checkinState === "missing") return "";
    var me = myCheckin(), here = me && me.id === String(bar.id);
    return '<button type="button" class="ci-btn" data-ci="' + U.esc(String(bar.id)) + '"' + (here ? " disabled" : "") + ">" +
      U.esc(here ? t("ciDone") : t("ciBtn")) + "</button>";
  }
  function checkinHTML(bar) { return checkinNamesHTML(bar) + checkinBtnHTML(bar); }
  function doCheckin(button) {
    var bar = ciBarById[button.getAttribute("data-ci")];
    if (!bar || button.disabled) return;
    if (!LIVE) { toast(t("soonToast"), { id: "soon" }); return; }
    if (!authed) { toast(t("connecting"), { id: "auth" }); signIn(); return; }
    window.FX.unlock();
    // Spökläge: nothing goes to the server, nobody is told.
    if (window.EXTRAS && window.EXTRAS.ghostOn && window.EXTRAS.ghostOn()) { toast(t("ciGhost"), { ms: 5000 }); return; }
    var name = String(bar.name || t("unnamedBar")).replace(/\s+/g, " ").trim().slice(0, 60);
    withName(function () {
      if (!$("sheet").hidden) closeSheet();   // the name sheet (first time only)
      button.disabled = true; button.classList.add("busy"); button.textContent = t("ciBusy");
      rpc("check_in", { p_bar_id: String(bar.id), p_bar_name: name, p_lat: bar.lat, p_lng: bar.lng }).then(function (r) {
        button.classList.remove("busy");
        var reset = function () { button.disabled = false; button.textContent = t("ciBtn"); };
        if (r.error) {
          reset();
          if (U.missing(r.error)) { checkinState = "missing"; toast(t("ciOff"), { err: true }); return; }
          var c = U.errCode(r.error);
          toast(c === "outside_sweden" || c === "not_authenticated" ? errMsg(r.error) : t("ciFail"), { err: true });
          return;
        }
        var d = parseData(r.data);
        if (d.ok === false) { reset(); toast(t("ciWait", Math.max(1, d.wait_seconds | 0))); return; }
        U.ls.setJSON(CI_KEY, { id: String(bar.id), name: d.bar_name || name, lat: +bar.lat, lng: +bar.lng, at: Date.now(), until: nightEnd() });
        button.textContent = t("ciDone");
        var lines = t("ciToasts") || [];
        toast(lines.length ? lines[Math.floor(Math.random() * lines.length)](d.bar_name || name) : t("ciDone"), { ms: 5000, cls: "skal" });
        window.FX.sound.clink(); window.FX.vibrate([18, 40, 18, 40, 60]);
        if (PUSH_ON && client && client.functions) {
          try { Promise.resolve(client.functions.invoke("notify-group", { body: { event: "checkin", bar: d.bar_name || name } })).then(function () {}, function () {}); } catch (e) {}
        }
        updateCounts();
        refresh();
      });
    });
  }

  var markerById = {};   // beer id -> marker (or hot bar marker)
  var hotBarIds = {};    // bar id -> true
  // Keep an open popup open when the 30 s poll or a map move redraws the markers.
  var openKey = null, redrawing = false, plainBarMarkers = {};
  map.on("popupopen", function (e) { var s = e.popup && e.popup._source; openKey = s && s.options.olnuKey || null; });
  map.on("popupclose", function () { if (!redrawing) openKey = null; });
  function reopenPopup(keep) {
    if (!keep) return;
    var id = keep.slice(1), m = keep.charAt(0) === "b" ? markerById[id] : null;
    if (!m) hotLayer.eachLayer(function (x) { if (x.options.olnuKey === "h" + id) m = x; });
    if (!m && plainBarMarkers[id]) m = plainBarMarkers[id];
    if (!m || !m.getPopup()) { openKey = null; return; }
    if (clusters.hasLayer(m) && clusters.getVisibleParent(m) !== m) { openKey = null; return; }
    var pp = m.getPopup(), ap = pp.options.autoPan;
    pp.options.autoPan = false; m.openPopup(); pp.options.autoPan = ap;
  }
  var compIds = {};      // bar id -> true: drawn as a composite with content (people / call-out / check-ins)
  function addComposite(c, layer, pane) {
    var prio = barPrio(c);
    var m = L.marker([c.bar.lat, c.bar.lng], { icon: compositeIcon(c), pane: pane, keyboard: false,
      zIndexOffset: 1000 + prio, olnuKey: (pane === "hotbars" ? "h" : "p") + c.bar.id, olnuPrio: prio });
    m.bindPopup(function () { return barPopup(c.bar, c.beers); }, { pane: "popupPane", className: "olnu-bar", autoPan: !sheetMode() });
    m.on("add", function () {
      var ic = m.getElement(); if (!ic) return;
      ic.setAttribute("data-bar", String(c.bar.id)); ic.setAttribute("data-prio", String(prio));
      if (!ic._olnuFold) { ic._olnuFold = true; ic.addEventListener("click", foldFromTap, true); ic.addEventListener("pointerdown", foldFromTap, true); }
    });
    m.addTo(layer);
    return m;
  }
  function render() {
    var z = map.getZoom(), keep = openKey;
    redrawing = true;
    clusters.clearLayers(); hotLayer.clearLayers(); markerById = {}; hotBarIds = {}; compIds = {};
    var split = z >= HOT_ZOOM ? window.BARS.assign(beers) : { perBar: {}, rest: beers };
    var ms = split.rest.map(function (b) {
      var l = U.level(U.drinks(b));
      var m = L.marker([b.lat, b.lng], { icon: beerIcon(b), friend: !!b.friend_name, mine: !!b.is_mine, streak: l, beerId: b.id,
        zIndexOffset: (b.is_mine ? 900 : b.friend_name ? 500 : 0) + l * 300, keyboard: false, olnuKey: "b" + b.id });
      m.bindPopup(function () { return beerPopup(b); });
      markerById[b.id] = m;
      return m;
    });
    clusters.addLayers(ms);
    // Composite bars: people (z ≥ 11), call-outs at the bar (z ≥ 11), check-ins (z ≥ 13).
    var comp = {}, rb = z >= HOT_ZOOM ? rallyBadges(z) : {}, cib = z >= BAR_ZOOM ? checkinsByBar() : {};
    var get = function (id, bar) { return comp[id] || (comp[id] = { bar: bar, beers: [], rallies: [], cis: [] }); };
    Object.keys(split.perBar).forEach(function (id) { var a = split.perBar[id]; get(id, a.bar).beers = a.beers; });
    Object.keys(rb).forEach(function (id) { var x = rb[id]; if (x && x.bar) get(id, x.bar).rallies = x.rallies || []; });
    Object.keys(cib).forEach(function (id) { var bar = window.BARS.byId(id); if (bar) get(id, bar).cis = cib[id]; });
    Object.keys(comp).forEach(function (id) {
      var c = comp[id];
      hotBarIds[id] = true; compIds[id] = true;
      var m = addComposite(c, hotLayer, "hotbars");
      c.beers.forEach(function (b) { markerById[b.id] = m; });
    });
    renderPlainBars();
    redrawing = false;
    reopenPopup(keep);
    renderHeat();
    updateCounts();
    renderTicker();
    labelsSoon();
  }
  function renderPlainBars() {
    var wasRedrawing = redrawing, keep = openKey;
    redrawing = true;
    barLayer.clearLayers(); plainBarMarkers = {};
    redrawing = wasRedrawing;
    if (map.getZoom() < BAR_ZOOM) { labelsSoon(); return; }
    var list = window.BARS.inBounds(map.getBounds().pad(0.15), MAX_PLAIN_BARS + 50);
    var n = 0;
    for (var i = 0; i < list.length && n < MAX_PLAIN_BARS; i++) {
      var bar = list[i];
      if (hotBarIds[bar.id]) continue;
      n++;
      plainBarMarkers[bar.id] = addComposite({ bar: bar, beers: [], rallies: [], cis: [] }, barLayer, "bars");
    }
    if (!wasRedrawing && keep && keep.charAt(0) === "p") reopenPopup(keep);
    labelsSoon();
  }
  /* Bar name labels: zoom ≥ 16 only; a label that would cover a higher-priority label or another marker hides. */
  var labelTimer = 0;
  function labelsSoon() { clearTimeout(labelTimer); labelTimer = setTimeout(placeLabels, 60); }
  // Design pass 2: one collision pass for every badge (🪖, 👑, 🏰, 🚪, crowd tag, queue) and, at zoom ≥ 16, the
  // name labels. Highest-priority marker first; a badge or label that would touch a kept one, or another marker's
  // icon / pill, is dropped. Icons and people pills themselves are never hidden.
  var BADGES = ".cm-rally, .cm-b, .cm-ci, .bm-crowd, .bm-q";
  function badgeRank(x) {
    var c = x.classList;
    return c.contains("cm-rally") ? 6 : c.contains("cm-king") ? 5 : c.contains("cm-ci") ? 4 : c.contains("cm-flag") ? 3 : c.contains("bm-crowd") ? 2 : 1;
  }
  function placeLabels() {
    var on = map.getZoom() >= LABEL_ZOOM, cont = map.getContainer();
    cont.classList.toggle("cm-labels", on);
    var icons = Array.prototype.slice.call(cont.querySelectorAll(".leaflet-marker-icon"));
    var obstacles = [], labels = [], badges = [];
    icons.forEach(function (ic) {
      var p = +(ic.getAttribute("data-prio") || 0);
      ic.querySelectorAll(".bar-ico, .pill, .rl-pin").forEach(function (x) { obstacles.push({ ic: ic, r: x.getBoundingClientRect() }); });
      ic.querySelectorAll(BADGES).forEach(function (x) { x.classList.remove("lbl-hide"); badges.push({ ic: ic, el: x, p: p * 10 + badgeRank(x) }); });
      var lb = ic.querySelector(".cm-lbl");
      if (lb) { lb.classList.remove("lbl-hide"); if (on) labels.push({ ic: ic, el: lb, p: p }); }
    });
    badges.sort(function (a, b) { return b.p - a.p; });
    labels.sort(function (a, b) { return b.p - a.p; });
    var kept = [], W = cont.clientWidth, H = cont.clientHeight, cr = cont.getBoundingClientRect();
    var hit = function (a, b) { return a.left < b.right + 2 && a.right > b.left - 2 && a.top < b.bottom + 1 && a.bottom > b.top - 1; };
    badges.forEach(function (x) {
      var r = x.el.getBoundingClientRect(); if (!r.width) return;
      var bad = kept.some(function (k) { return hit(r, k); }) || obstacles.some(function (o) { return o.ic !== x.ic && hit(r, o.r); });
      if (bad) x.el.classList.add("lbl-hide"); else kept.push(r);
    });
    if (!on) return;
    labels.forEach(function (x) {
      var r = x.el.getBoundingClientRect();
      if (r.right < cr.left || r.left > cr.left + W || r.bottom < cr.top || r.top > cr.top + H) return;   // off screen: keep, costs nothing
      var bad = kept.some(function (k) { return hit(r, k); }) ||
        obstacles.some(function (o) { return o.ic !== x.ic && hit(r, o.r); });
      if (bad) x.el.classList.add("lbl-hide"); else kept.push(r);
    });
  }
  map.on("zoomend moveend", labelsSoon);
  // Selected marker: 1.25× and on top while its popup is open.
  var selMarker = null;
  map.on("popupopen", function (e) {
    var s = e.popup && e.popup._source;
    // Modules add content after open (and fonts load late): pan again once the popup has its final size.
    setTimeout(function () { try { if (e.popup.isOpen() && e.popup.options.autoPan !== false) { e.popup._adjustPan(); } } catch (x) {} }, 80);
    if (selMarker && selMarker !== s && selMarker.getElement()) L.DomUtil.removeClass(selMarker.getElement(), "cm-sel");
    selMarker = null;
    if (s && s.getElement && s.getElement() && L.DomUtil.hasClass(s.getElement(), "cm")) {
      selMarker = s; L.DomUtil.addClass(s.getElement(), "cm-sel"); s.setZIndexOffset(30000);
    }
  });
  map.on("popupclose", function (e) {
    var s = e.popup && e.popup._source;
    if (s && s.getElement && s.getElement()) { L.DomUtil.removeClass(s.getElement(), "cm-sel"); if (s.options.olnuPrio != null) s.setZIndexOffset(1000 + s.options.olnuPrio); }
    if (s === selMarker) selMarker = null;
  });
  var lastZoomBand = null;
  map.on("zoomend", function () {
    // Band 2 (zoom 16+): bar badges get the small Lugnt/Livligt/Packat tag.
    var z = map.getZoom(), band = z >= 16 ? 2 : z >= HOT_ZOOM ? 1 : 0;
    if (band !== lastZoomBand) { lastZoomBand = band; render(); } else renderPlainBars();
  });
  map.on("moveend", U.debounce(renderPlainBars, 150));
  lastZoomBand = map.getZoom() >= 16 ? 2 : map.getZoom() >= HOT_ZOOM ? 1 : 0;

  /* ---------- Ticker + streak alerts ---------- */
  function whoOf(b) { return b.is_mine ? t("you") : b.friend_name || t("someone"); }
  // Place phrase with its preposition: "vid Pub X" / "nära Pizzeria Y" / "i Ludvika" / "på okänd plats".
  function whereOf(b) {
    var d = window.BARS.describe(b);
    return d.kind === "unknown" ? t("whereUnknown") : t("where_" + d.kind, d.name);
  }
  // Short place label without preposition, for list rows.
  function placeLabel(b) {
    var d = window.BARS.describe(b);
    return d.kind === "near" ? t("nearX", d.name) : d.name || t("other");
  }
  /* News context (polish): my groups' members tonight (home_status, max every 3 min, only with groups),
     call-outs, my name/title/new medals, check-ins, centre. */
  var groupRows = [], groupRowsAt = 0, groupRowsOff = false, groupRowsBusy = false, GROUP_NEWS_MS = 180000;
  function loadGroupNews() {
    if (!LIVE || !authed || groupRowsOff || groupRowsBusy || document.hidden) return;
    if (Date.now() - groupRowsAt < GROUP_NEWS_MS) return;
    groupRowsBusy = true; groupRowsAt = Date.now();
    rpc("home_status", { p_last: false }).then(function (r) {
      groupRowsBusy = false;
      if (r.error) { if (U.missing(r.error)) groupRowsOff = true; return; }
      groupRows = Array.isArray(r.data) ? r.data.filter(function (x) { return x && x.group_id != null; }) : [];
      newsDirty = true;
    });
  }
  function newsCtx(titles) {
    var me = meState || {}, medals = [];
    try {
      var mm = window.MEDALS && window.MEDALS.mine ? window.MEDALS.mine() : null;
      if (mm) Object.keys(mm).forEach(function (id) {
        var at = Date.parse(mm[id] && mm[id].at || "") || 0;
        if (at && Date.now() - at < 2 * 3600e3) medals.push(window.MEDALS.info(id).name);
      });
    } catch (e) {}
    var rl = [];
    try { rl = window.RALLY && window.RALLY.list ? window.RALLY.list() : []; } catch (e) { rl = []; }
    return { center: chaosCenter(), now: new Date(), prev: newsPrev, titles: titles,
      others: beers.filter(function (b) { return (b.other_count | 0) > 0; }), checkins: checkins,
      home: groupRows, rallies: rl, myName: getName() || null, myTitle: me.title || null, myMedals: medals.slice(0, 3) };
  }
  // LIVE ticker = funny TV news feed (js/news.js). New headlines after each poll (or language change), not on map moves.
  var tickerKey = "", newsDirty = true, newsPrev = [];
  // Lazy-loaded news texts (boot.js): use them at the next ticker refill.
  document.addEventListener("olnu:lazy", function () { newsDirty = true; });
  function renderTicker() {
    if (!newsDirty && tickerKey) return;
    newsDirty = false;
    var titles = null;
    try { titles = window.SOCIAL && window.SOCIAL.titlesByBeer ? window.SOCIAL.titlesByBeer() : null; } catch (e) { titles = null; }
    var items = window.NEWS ? window.NEWS.build(beerOnly(), newsCtx(titles)) : [];
    if (!items.length) items = [{ text: t("tickQuiet"), cls: "tk-quiet" }];
    newsPrev = items.map(function (x) { return x.text; });
    tickerKey = "v2";
    tickPending = items; tickIx = 0;
    tickStart();
  }
  /* Smooth news belt: one constant speed, never restarts. New headlines are queued and join at the
     end of the belt; items that have left on the left side are removed. */
  var TICK_PX_S = 55, tickPending = [], tickIx = 0, tickOff = 0, tickLast = 0, tickRaf = 0, tickKickDone = false;
  function tickPiece() {
    var track = $("ticker-track"), frag = document.createDocumentFragment();
    if (!tickKickDone) {
      tickKickDone = true;
      frag.appendChild(el("span", { class: "tk-kick", text: t("newsKick") }));
    } else frag.appendChild(el("span", { class: "tk-sep", text: "///" }));
    if (tickIx >= tickPending.length) {   // all queued shown once: build a fresh set next time
      tickIx = 0; newsDirty = true;
      try { renderTickerItemsOnly(); } catch (e) {}
    }
    var x = tickPending[tickIx++] || { text: t("tickQuiet"), cls: "tk-quiet" };
    frag.appendChild(el("span", { class: "tk-item" + (x.cls ? " " + x.cls : ""), text: x.text }));
    track.appendChild(frag);
  }
  function tickFill() {
    var track = $("ticker-track"), vp = track.parentNode, need = (vp ? vp.clientWidth : 400) * 2 + 200, guard = 0;
    while (track.scrollWidth - tickOff < need && guard++ < 20) tickPiece();
  }
  function tickFrame(ts) {
    tickRaf = 0;
    var track = $("ticker-track");
    var dt = tickLast ? Math.min(0.1, (ts - tickLast) / 1000) : 0;
    tickLast = ts;
    tickOff += TICK_PX_S * dt;
    var first = track.firstChild, guard = 0;
    while (first && first.offsetWidth && tickOff >= first.offsetWidth && guard++ < 20) {
      tickOff -= first.offsetWidth; track.removeChild(first); first = track.firstChild;
    }
    tickFill();
    track.style.transform = "translate3d(" + (-tickOff).toFixed(2) + "px,0,0)";
    tickRaf = requestAnimationFrame(tickFrame);
  }
  function tickStart() {
    var track = $("ticker-track");
    track.classList.remove("moving"); track.style.animation = "none";
    if (window.FX && window.FX.reduced && window.FX.reduced()) {
      // Reduced motion: static list, the user can scroll it sideways.
      track.innerHTML = ""; tickKickDone = false; tickIx = 0;
      for (var i = 0; i < tickPending.length; i++) tickPiece();
      track.style.transform = "none";
      return;
    }
    if (!track.firstChild) tickFill();
    if (!tickRaf) { tickLast = 0; tickRaf = requestAnimationFrame(tickFrame); }
  }
  // Build a fresh set of headlines for the queue without touching what is on screen.
  function renderTickerItemsOnly() {
    newsDirty = false;
    var titles = null;
    try { titles = window.SOCIAL && window.SOCIAL.titlesByBeer ? window.SOCIAL.titlesByBeer() : null; } catch (e) { titles = null; }
    var items = window.NEWS ? window.NEWS.build(beerOnly(), newsCtx(titles)) : [];
    if (!items.length) items = [{ text: t("tickQuiet"), cls: "tk-quiet" }];
    newsPrev = items.map(function (x) { return x.text; });
    tickPending = items;
  }
  // Known pins (friends) keep their numeric id: compare by id. Strangers get a new opaque id every
  // 10 min and only the map view is polled: count strangers per level inside the part of the map both
  // polls covered, and toast only when that count went up (an id change or a pan never toasts).
  var prevLevels = null, prevStr = null, prevBox = null;
  function strangerLevels(box) {
    var c = { 1: [], 2: [] };
    beers.forEach(function (b) {
      if (b.is_mine || b.friend_name || b.is_friend) return;
      if (box && !(b.lat >= box[0] && b.lat <= box[2] && b.lng >= box[1] && b.lng <= box[3])) return;
      var l = U.level(U.drinks(b)); if (l) c[l].push(b);
    });
    return c;
  }
  function streakAlerts(box) {
    var now = {};
    beers.forEach(function (b) { if (b.is_mine || b.friend_name || b.is_friend) now[b.id] = U.level(U.drinks(b)); });
    if (prevLevels) {
      beers.forEach(function (b) {
        if (b.is_mine || now[b.id] == null) return;
        var before = prevLevels[b.id] | 0, l = now[b.id];
        if (l > before) {
          var who = whoOf(b), where = whereOf(b);
          toast(streakToastText(b, l, who, where), { ms: 5000, cls: l === 2 ? "med" : "hot" });
        }
      });
    }
    prevLevels = now;
    // Strangers: overlap of the previous and the current poll box (whole world when there is no box).
    var inter = null;
    if (box && prevBox) inter = [Math.max(box[0], prevBox[0]), Math.max(box[1], prevBox[1]), Math.min(box[2], prevBox[2]), Math.min(box[3], prevBox[3])];
    if (inter && (inter[0] > inter[2] || inter[1] > inter[3])) inter = null;
    var cur = strangerLevels(inter);
    if (prevStr && (inter || (!box && !prevBox))) {
      var before = { 1: 0, 2: 0 };
      prevStr.forEach(function (x) {
        if (!inter || (x.lat >= inter[0] && x.lat <= inter[2] && x.lng >= inter[1] && x.lng <= inter[3])) before[x.l]++;
      });
      [2, 1].some(function (l) {
        if (cur[l].length <= before[l]) return false;
        var b = cur[l][cur[l].length - 1], who = whoOf(b), where = whereOf(b);
        toast(streakToastText(b, l, who, where), { ms: 5000, cls: l === 2 ? "med" : "hot" });
        return true;
      });
    }
    var all = strangerLevels(null);
    prevStr = all[1].map(function (b) { return { lat: b.lat, lng: b.lng, l: 1 }; }).concat(all[2].map(function (b) { return { lat: b.lat, lng: b.lng, l: 2 }; }));
    prevBox = box || null;
  }

  /* ---------- Kaos i stan (in-app only, anonymous counts) ---------- */
  var lastLoc = null;          // last known own location {lat, lng} (locate or own beer tap)
  var chaosRes = null;         // last result of CHAOS.compute
  var chaosPrevOn = null;      // was it chaos at the last poll? (null before the first poll)
  var chaosShown = false;
  // {at, out, hot, until} when the user tapped ✕ or the banner hid itself. Saved, so it stays away
  // after the app is reopened, until 05:00 or until the night gets clearly wilder.
  var CHAOS_SEEN_KEY = "olnu.chaosSeen", CHAOS_AUTO_MS = 9000, chaosAutoTimer = null;
  var chaosHidden = (function () {
    var v = U.ls.getJSON(CHAOS_SEEN_KEY, null);
    return v && v.until > Date.now() ? v : null;
  })();
  function chaosMarkSeen(r) {
    chaosHidden = { at: Date.now(), out: r.out | 0, hot: r.hot | 0, until: nightEnd() };
    U.ls.setJSON(CHAOS_SEEN_KEY, chaosHidden);
  }
  var chaosLine = null;        // {lang, ix} of the headline on screen
  var chaosLastIx = -1;        // last headline index, never the same twice in a row
  var CHAOS_BACK_MS = 60 * 60 * 1000;
  function chaosCenter() {
    if (lastLoc) return lastLoc;
    var m = myBeer();
    if (m) return { lat: m.lat, lng: m.lng };
    var c = map.getCenter();
    return { lat: c.lat, lng: c.lng };
  }
  function chaosFits(line, r) {
    if (line.indexOf("{bar}") >= 0 && !r.bar) return false;
    if (line.indexOf("{hot}") >= 0 && !r.hot) return false;
    return true;
  }
  function pickChaosLine(r) {
    var lines = t("chaosLines") || [], ok = [];
    lines.forEach(function (l, i) { if (chaosFits(l, r)) ok.push(i); });
    if (ok.length > 1) ok = ok.filter(function (i) { return i !== chaosLastIx; });
    var ix = ok.length ? ok[Math.floor(Math.random() * ok.length)] : 0;
    chaosLastIx = ix;
    chaosLine = { lang: I.lang, ix: ix };
  }
  function chaosHeadline(r) {
    var lines = t("chaosLines") || [];
    if (!chaosLine || chaosLine.lang !== I.lang || !lines[chaosLine.ix] || !chaosFits(lines[chaosLine.ix], r)) pickChaosLine(r);
    var town = r.city || t("chaosTown");
    return String(lines[chaosLine.ix] || "").replace(/\{stad\}/g, town).replace(/\{n\}/g, String(r.out))
      .replace(/\{hot\}/g, String(r.hot)).replace(/\{bar\}/g, r.bar || "");
  }
  function chaosFacts(r) {
    var parts = [t("chaosOut", r.out)];
    if (r.hot) parts.push(t("chaosHot", r.hot));
    if (r.bar) parts.push(t("chaosBar", r.bar));
    return parts.join(" · ");
  }
  function chaosSuppressed(r) {
    if (!chaosHidden) return false;
    // Comes back only when clearly wilder: 50 % more people out (min +5) or 2 more on hot streak, or after the night.
    var back = Date.now() > (chaosHidden.until || 0) ||
      r.out >= Math.max(Math.ceil(chaosHidden.out * 1.5), chaosHidden.out + 5) || r.hot >= chaosHidden.hot + 2;
    if (back) { chaosHidden = null; U.ls.del(CHAOS_SEEN_KEY); }
    return !back;
  }
  function setChaosHeight() {
    var box = $("chaos");
    // The banner floats over the HUD (it hides itself after a few seconds), so buttons never jump.
    var h = 0;
    document.documentElement.style.setProperty("--chaos-h", "0px");
    // Keep popups clear of the banner too.
    L.Popup.prototype.options.autoPanPaddingTopLeft = L.point(10, 150 + h);
  }
  function renderChaos() {
    var box = $("chaos"), r = chaosRes;
    var show = !!(LIVE && r && r.on && !chaosSuppressed(r));
    if (show && !chaosShown) pickChaosLine(r);   // new headline each time it starts or comes back
    var started = show && !chaosShown;
    chaosShown = show;
    box.hidden = !show;
    if (show) {
      $("chaos-head").textContent = chaosHeadline(r);
      $("chaos-facts").textContent = chaosFacts(r);
      box.setAttribute("aria-label", t("chaosAria", r.city || t("chaosTown")));
      $("chaos-show").textContent = t("chaosShow");
      $("chaos-show").hidden = !r.target;
      $("chaos-close").setAttribute("aria-label", t("chaosHide"));
    }
    setChaosHeight();
    if (started) {
      clearTimeout(chaosAutoTimer);
      chaosAutoTimer = setTimeout(function () {
        if (chaosShown && chaosRes) { chaosMarkSeen(chaosRes); renderChaos(); }
      }, CHAOS_AUTO_MS);
    } else if (!show) clearTimeout(chaosAutoTimer);
    return started;
  }
  // fromPoll: called after live_beers loaded. Else (location or language changed): redraw, no toast.
  function evalChaos(fromPoll) {
    if (!window.CHAOS || !LIVE) return;
    chaosRes = window.CHAOS.compute(beerOnly(), chaosCenter());
    var started = renderChaos();
    if (!fromPoll) return;
    if (chaosPrevOn === false && chaosRes.on && started) {
      toast($("chaos-head").textContent, { cls: "chaos-toast", ms: 5000, id: "chaos" });
      if (!window.FX.muted()) window.FX.vibrate([30, 50, 30]);
    }
    chaosPrevOn = chaosRes.on;
  }
  $("chaos-show").addEventListener("click", function () {
    var g = chaosRes && chaosRes.target; if (!g) return;
    flyTo(g.lat, g.lng, g.zoom, null);
  });
  $("chaos-close").addEventListener("click", function () {
    if (!chaosRes) return;
    chaosMarkSeen(chaosRes);
    renderChaos();
  });
  window.addEventListener("resize", U.debounce(setChaosHeight, 150));

  /* ---------- Skål ---------- */
  var mySkals = {};          // beer id -> count after my skål (kept until the server agrees)
  var prevMySkal = null;     // own skal_count at last poll (null before first load)
  function skalAlert() {
    var m = myBeer(), n = m ? skalCount(m) : null;
    if (prevMySkal != null && n != null && n > prevMySkal) {
      toast(t("skalUp", n - prevMySkal), { cls: "skal" });
      window.FX.vibrate(25);
    }
    if (firstLoadDone || n != null) prevMySkal = n == null ? 0 : n;
  }
  function beerById(id) { for (var i = 0; i < beers.length; i++) if (String(beers[i].id) === String(id)) return beers[i]; return null; }
  // Same person after a re-poll: a known pin keeps its id; a stranger's opaque id rotates every 10 min,
  // so match by spot (bar or grid point) + counts.
  function samePin(b) {
    var x = beerById(b.id); if (x) return x;
    if (b.is_mine || b.friend_name) return null;
    for (var i = 0; i < beers.length; i++) {
      var y = beers[i];
      if (y.is_mine || y.friend_name) continue;
      if ((y.bar_id || "") === (b.bar_id || "") && Math.abs(y.lat - b.lat) < 1e-6 && Math.abs(y.lng - b.lng) < 1e-6 &&
          (y.beer_count | 0) === (b.beer_count | 0) && (y.other_count | 0) === (b.other_count | 0)) return y;
    }
    return null;
  }
  // v13: skal_v2(String(id)); old server: skal(numeric id). beer_not_found → re-poll once and retry.
  function skalCall(b, retried) {
    if (pollV2 !== "on") return rpc("skal", { p_beer_id: b.id });
    return rpc("skal_v2", { p_pin: String(b.id) }).then(function (r) {
      if (r.error && U.missing(r.error)) { pollV2 = "missing"; return rpc("skal", { p_beer_id: b.id }); }
      if (r.error && U.errCode(r.error) === "beer_not_found" && !retried) {
        return refresh(true).then(function () {
          var nb = samePin(b);
          if (!nb) return r;
          return skalCall(nb, true).then(function (r2) { r2.pin = nb; return r2; });
        });
      }
      return r;
    });
  }
  function doSkal(button) {
    var id = button.getAttribute("data-skal"), b = beerById(id);
    if (!b || b.i_skaled || button.disabled) return;
    window.FX.unlock();
    button.disabled = true; button.classList.add("busy");
    skalCall(b, false).then(function (r) {
      button.classList.remove("busy");
      if (r.error) {
        var c = U.errCode(r.error);
        button.disabled = false;
        if (c === "own_beer") { toast(t("skalOwn"), { err: true }); button.disabled = true; }
        else if (c === "beer_not_found") { toast(t("skalGone"), { err: true }); refresh(); }
        else toast(errMsg(r.error), { err: true });
        return;
      }
      if (r.pin) b = r.pin;
      var d = parseData(r.data);
      var n = Math.max(skalCount(b), d.skal_count | 0);
      b.skal_count = n; b.i_skaled = true; mySkals[b.id] = n;
      document.querySelectorAll('.skal-btn[data-skal="' + String(id).replace(/["\\]/g, "") + '"]').forEach(function (x) {
        x.disabled = true; x.textContent = t("skaled", n);
      });
      if (!d.already) {
        window.FX.sound.clink(); window.FX.vibrate([18, 40, 18]);
        button.classList.add("pop");
      }
    });
  }
  map.on("popupopen", function (e) {
    var root = e.popup.getElement(); if (!root) return;
    root.querySelectorAll(".skal-btn").forEach(function (x) {
      x.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); doSkal(x); });
    });
    root.querySelectorAll("[data-hidepin]").forEach(function (x) {
      x.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); map.closePopup(); showStopSheet(); });
    });
    root.querySelectorAll(".ci-btn").forEach(function (x) {
      x.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); doCheckin(x); });
    });
    root.querySelectorAll(".pp-all").forEach(function (x) {
      x.addEventListener("click", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var id = x.getAttribute("data-crowd"), agg = window.BARS.assign(beers).perBar[id];   // (rows, not views)
        map.closePopup();
        if (agg && agg.beers.length) openCrowd(agg.beers, agg.bar);
      });
    });
  });

  /* ---------- Crowd list (many people at one spot) ---------- */
  // Me first, then friends, then most beers.
  function crowdSort(a, b) {
    var ra = a.is_mine ? 0 : a.friend_name ? 1 : 2, rb = b.is_mine ? 0 : b.friend_name ? 1 : 2;
    return ra - rb || U.drinks(b) - U.drinks(a) ||
      String(a.created_at || "").localeCompare(String(b.created_at || ""));
  }
  function crowdCountHTML(b) {
    var n = U.drinks(b), l = U.level(n);
    return "<b>" + n + "</b> 🍺" + (l === 2 ? " 🚁" : l === 1 ? " 🔥" : "");
  }
  // bar: the bar these beers belong to (bar popup "Visa alla"), or null (cluster tap).
  function openCrowd(list, bar) {
    list = (list || []).slice().sort(crowdSort);
    if (!list.length) return;
    var tot = 0, oth = 0, fr = 0, lat = 0, lng = 0, allPrecise = true;
    list.forEach(function (b) {
      tot += U.drinks(b); if (b.friend_name) fr++;
      lat += b.lat; lng += b.lng; if (!b.precise) allPrecise = false;
    });
    var where;
    if (bar) where = t("where_at", bar.name || t("unnamedBar"));
    else {
      // Approximate pins never reveal a bar: then only the town.
      var d = window.BARS.describe({ lat: lat / list.length, lng: lng / list.length, precise: allPrecise });
      where = d.kind === "unknown" ? t("whereUnknown") : t("where_" + d.kind, d.name);
    }
    openSheet(t("crowdTitle", list.length), function (body) {
      body.appendChild(el("div", { class: "crowd-head" }, [
        el("div", { class: "crowd-where", text: "📍 " + where }),
        el("div", { class: "crowd-sum", text: t("crowdSum", tot, oth, fr) })
      ]));
      var ul = el("ul", { class: "crowd-list" });
      list.forEach(function (b) {
        var l = U.level(U.drinks(b));
        var sub = t("since", U.timeHM(b.created_at)) + (b.precise ? "" : " · " + t("crowdApprox"));
        var main = el("button", { type: "button", class: "cr-main", "aria-label": t("crowdShow", whoOf(b)), onclick: function () { showBeer(b); } }, [
          el("span", { class: "cr-name", text: whoOf(b) }),
          el("span", { class: "cr-sub", text: sub })
        ]);
        var right;
        if (b.is_mine) right = el("span", { class: "cr-skal", text: t("skalN", skalCount(b)) });
        else {
          right = el("span", { class: "cr-act", html: skalBtn(b, true) });
          var sb = right.querySelector(".skal-btn");
          if (sb) sb.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); doSkal(sb); });
        }
        ul.appendChild(el("li", { class: "cr-row" + (b.is_mine ? " mine" : b.friend_name ? " friend" : "") + lvlClass(l) }, [
          main, el("span", { class: "cr-n", html: crowdCountHTML(b) }), right
        ]));
      });
      body.appendChild(ul);
      body.appendChild(el("p", { class: "muted crowd-note", text: t("crowdTap") }));
    });
  }
  // Fly to one beer and open its popup. When the pin is still inside a cluster (same spot),
  // the popup opens on its own at the pin's position (no spiderfy).
  function showBeer(b, z) {
    if (!b) return;
    closeSheet();
    var opened = false;
    var open = function () {
      if (opened) return; opened = true;
      var cur = beerById(b.id) || b, m = markerById[cur.id];
      if (m && clusters.hasLayer(m) && clusters.getVisibleParent(m) === m) { m.openPopup(); return; }
      L.popup({ offset: L.point(0, -12) }).setLatLng([cur.lat, cur.lng]).setContent(beerPopup(cur)).openOn(map);
    };
    map.once("moveend", function () { setTimeout(open, 200); });
    map.flyTo([b.lat, b.lng], Math.max(map.getZoom(), z || 18), { duration: 0.9 });
    setTimeout(open, 2200);   // flyTo to the same view may not fire moveend
  }

  /* ---------- Counts / chrome ---------- */
  function friendsDrinking() {
    var seen = {};
    beers.forEach(function (b) { if (b.friend_name) seen[b.id] = 1; });
    return Object.keys(seen).length;
  }
  // v13 poll_v2 "me": the server's view of the caller (count, cooldown, undo, ghost). null on an old server.
  var meState = null;
  // End of tonight: the server's expires_at when known, else the next 05:00 Stockholm (DST-safe).
  function nightEnd() {
    var e = meState && meState.expires_at ? Date.parse(meState.expires_at) : NaN;
    if (!isFinite(e) || e < Date.now()) { var n = myNight(); e = n && n.expires ? n.expires : NaN; }
    return isFinite(e) && e > Date.now() ? e : U.next5am().getTime();
  }
  function myBeer() { for (var i = 0; i < beers.length; i++) if (beers[i].is_mine) return beers[i]; return null; }

  // Own night state kept on the phone: {count, expires, lastTap}. Server stays the authority.
  function myNight() {
    var m = U.ls.getJSON("olnu.night", null);
    if (!m || !m.expires || Date.now() > m.expires) return null;
    return m;
  }
  function saveNight(d, accepted) {
    var m = myNight() || {};
    m.count = d.beer_count | 0;
    m.expires = d.expires_at ? new Date(d.expires_at).getTime() : nightEnd();
    // The server's wait_seconds always wins. Without it (accepted tap) the local fallback is 10 min.
    var wait = d.wait_seconds | 0;
    if (wait > 0) m.lastTap = Date.now() + wait * 1000 - U.COOLDOWN_MS;
    else if (accepted) m.lastTap = Date.now();
    U.ls.setJSON("olnu.night", m);
  }
  function updateCounts() {
    $("live-count").innerHTML = LIVE ? t("live", liveTotal != null ? liveTotal : beerOnly().length | 0) : t("soonLive");
    var f = friendsDrinking(), badge = $("groups-badge");
    badge.textContent = String(f); badge.hidden = f === 0;
    $("btn-groups").setAttribute("aria-label", t("groups") + (f ? " — " + t("friendsNow", f) : ""));
    var mine = myBeer();
    $("btn-stop").hidden = true; // Hidden from the dock (user asked). Still reachable in ⚙️ Inställningar.
    // v14: all drinks count. Server "me" first (also right when the pin is hidden), then the pin, then the phone.
    var night = myNight(), n = meState ? U.drinks(meState) : mine ? U.drinks(mine) : night ? (night.count | 0) : 0;
    if (!meState) {
      var oc = mine ? mine.other_count | 0 : 0;
      try { if (window.EXTRAS && window.EXTRAS.otherTonight) oc = Math.max(oc, window.EXTRAS.otherTonight() | 0); } catch (e) {}
      if (!mine) n += oc;
    }
    // Design pass 2: ONE compact "Ikväll" pill ("🍺 6 Nu brinner byn ▾"). Tap = small panel with all HUD chips.
    // Closed, only the most urgent chip (🚑 a friend at 10+, or 🚕 Taxi at 10+) shows next to the pill.
    var st = $("my-streak"), head = "";
    var hx = $("hud-x"), chips = LIVE ? mods("hudChipsHTML", { mine: mine, n: n }) : "";
    var ci = LIVE ? myCheckin() : null;
    if (ci) chips += '<button type="button" class="hx-chip hx-ci" data-hx="checkin" aria-label="' + U.esc(t("ciChip", ci.name)) + '">🚪 ' + U.esc(ci.name) + "</button>";
    if (n > 0) {
      var l = U.level(n), mlv = lvOf(n);
      var emo = mlv ? mlv.emoji : l === 2 ? "🚁" : l === 1 ? "🔥" : "🍺";
      var tag = mlv ? lvName(mlv, "me") : l === 2 ? t("medevac") : l === 1 ? t("hot") : "";
      st.className = "my-streak" + lvlClass(l);
      st.innerHTML = '<span class="sr-only">' + U.esc(t("tonight")) + ": </span>" +
        '<span class="ms-e" aria-hidden="true">' + U.esc(emo) + "</span><b>" + n + "</b>" +
        (tag ? '<span class="ms-tag' + (mlv ? " ms-lv" : "") + '"' + (mlv ? ' style="--lv:' + U.esc(mlv.color) + '"' : "") + ">" + U.esc(tag) + "</span>" : "") +
        '<span class="ms-chev" aria-hidden="true">▾</span>';
      head = '<div class="hx-head">' + U.esc(t("tonight")) + ": <b>" + n + "</b>" + (tag ? " · " + U.esc(emo + " " + tag) : "") +
        (mine ? " · " + U.esc(t("skalN", skalCount(mine))) : "") + "</div>";
    } else if (chips) {
      st.className = "my-streak";
      st.innerHTML = '<span class="ms-e" aria-hidden="true">🍺</span><span class="ms-k">' + U.esc(t("tonight")) + '</span><span class="ms-chev" aria-hidden="true">▾</span>';
    }
    st.hidden = !(n > 0 || chips);
    var html = chips ? head + chips : "";
    if (hx.getAttribute("data-html") !== html) { hx.innerHTML = html; hx.setAttribute("data-html", html); }
    hx.hidden = !html;
    // Closed pill: the 🚑 friend check comes first, then 🚕 Taxi at 10+, then the delight 🧢 cap chip.
    var urgent = hx.querySelector(".af-chip-med") || (n >= 10 ? hx.querySelector(".hx-taxi") : null) || hx.querySelector(".dl-cap-chip");
    hx.querySelectorAll(".hx-urgent").forEach(function (x) { if (x !== urgent) x.classList.remove("hx-urgent"); });
    if (urgent) urgent.classList.add("hx-urgent");
    if (st.hidden) hudPanel(false);
  }
  // The Ikväll panel (open/close). Closes on outside tap, Escape, map move, and after a chip action.
  function hudPanel(open) {
    var box = document.querySelector(".hud-left"), st = $("my-streak");
    if (!box) return;
    box.classList.toggle("open", !!open);
    st.setAttribute("aria-expanded", String(!!open));
  }
  function applyStaticText() {
    $("beer-label").textContent = t("beer");
    $("beer-sub").textContent = t("beerSub");
    $("btn-stop").textContent = t("stop");
    $("btn-stop").title = t("stopHint");
    $("groups-label").textContent = t("groups");
    $("prec-exact").textContent = t("exact");
    $("prec-area").textContent = t("area");
    $("btn-settings").setAttribute("aria-label", t("settings"));
    $("sheet-close").setAttribute("aria-label", t("close"));
    $("install-close").setAttribute("aria-label", t("close"));
    $("soon-chip").hidden = LIVE;
    $("soon-chip").textContent = t("soonChip");
    $("btn-locate").setAttribute("aria-label", t("locate"));
    $("btn-attrib").setAttribute("aria-label", t("mapSources"));
    $("btn-attrib").title = t("mapSources");
    $("btn-locate").title = t("locate");
    $("offline-text").textContent = t("offline");
    $("btn-top").setAttribute("aria-label", t("top"));
    $("btn-top").title = t("top");
    applyHeatBtn();
    applyPrec();
    mods("applyText");
    updateCounts();
    tickerKey = ""; newsDirty = true; renderTicker();
    if (chaosRes) evalChaos(false);
    $("chaos-show").textContent = t("chaosShow");
    $("chaos-close").setAttribute("aria-label", t("chaosHide"));
    tickCooldown();
  }

  /* ---------- Precision toggle ---------- */
  var prec = U.ls.get("olnu.prec", "exact") === "area" ? "area" : "exact";
  function applyPrec() {
    $("prec-exact").setAttribute("aria-checked", String(prec === "exact"));
    $("prec-area").setAttribute("aria-checked", String(prec === "area"));
    $("prec-hint").textContent = prec === "area" ? t("hintArea") : t("hintExact");
  }
  $("prec-seg").addEventListener("click", function (e) {
    var b = e.target.closest("[data-prec]"); if (!b) return;
    prec = b.getAttribute("data-prec"); U.ls.set("olnu.prec", prec); applyPrec();
  });

  /* ---------- Live beers ---------- */
  var loading = false, refreshAgain = false, loadingP = null;
  // v8 other drinks: beer id -> {other_count, other_kind}. null = RPC missing (old database) → feature off.
  var othersMap = {}, othersState = "unknown";   // "unknown" | "on" | "missing"
  function fetchOthers() {
    if (othersState === "missing") return Promise.resolve({});
    return rpc("live_others").then(function (r) {
      if (r.error) {
        if (U.missing(r.error)) { othersState = "missing"; othersMap = {}; mods("onOthersState", false); }
        return othersMap;   // network error: keep the last known map
      }
      var m = {};
      (r.data || []).forEach(function (o) { if (o && o.beer_id != null) m[o.beer_id] = o; });
      othersMap = m;
      if (othersState !== "on") { othersState = "on"; mods("onOthersState", true); }
      return m;
    });
  }
  // v10 Checka in: tonight's check-ins (RPC live_checkins, migration 0011). "missing" = old database → feature off.
  var checkins = [], checkinState = "unknown";   // "unknown" | "on" | "missing"
  function fetchCheckins() {
    if (checkinState === "missing") return Promise.resolve(checkins);
    return rpc("live_checkins").then(function (r) {
      if (r.error) {
        if (U.missing(r.error)) { checkinState = "missing"; checkins = []; }
        return checkins;   // network error: keep the last list
      }
      checkins = (r.data || []).filter(function (c) { return c && c.bar_name && isFinite(c.lat) && isFinite(c.lng); });
      checkinState = "on";
      syncMyCheckin();
      return checkins;
    });
  }
  // v13 poll_v2: one call per poll for the map view (+ margin). "unknown" | "on" | "missing" (old server).
  var pollV2 = "unknown", liveTotal = null, heatAskAt = 0, pollBox = null, lastPollAt = 0, lastAcceptAt = 0;
  function viewBox() {
    var b = map.getBounds(), s = Math.max(-85, b.getSouth()), n = Math.min(85, b.getNorth());
    var w = b.getWest(), e = b.getEast();
    // Wide view or across the date line: the whole longitude range. Else wrap into -180..180.
    if (e - w >= 360) { w = -180; e = 180; }
    else {
      w = ((w + 180) % 360 + 360) % 360 - 180; e = ((e + 180) % 360 + 360) % 360 - 180;
      if (e < w) { w = -180; e = 180; }
    }
    return { p_min_lat: s, p_min_lng: w, p_max_lat: n, p_max_lng: e };
  }
  function normPins(list) {
    return (list || []).filter(function (b) { return b && isFinite(b.lat) && isFinite(b.lng) && b.id != null; }).map(function (b) {
      b.lat = +b.lat; b.lng = +b.lng;
      b.beer_count = Math.max(0, b.beer_count | 0); b.other_count = Math.max(0, b.other_count | 0); b.other_kind = b.other_kind || null;
      b.precise = !!b.precise; b.is_mine = !!b.is_mine; b.friend_name = b.friend_name || null;
      b.skal_count = Math.max(0, b.skal_count | 0); b.i_skaled = !!b.i_skaled;
      return b;
    }).filter(function (b) { return b.beer_count >= 1 || b.other_count >= 1; });
  }
  // The server's "me" → cooldown, night count, check-in end. A poll that started before an accepted beer
  // came back is older than that beer: its cooldown is ignored.
  function applyMe(me, startedAt) {
    if (!me || typeof me !== "object") return;
    meState = me;
    if (startedAt < lastAcceptAt) return;
    var m = myNight() || {};
    m.count = me.beer_count | 0;
    if (me.expires_at) m.expires = Date.parse(me.expires_at) || nightEnd();
    else if (!m.expires) m.expires = nightEnd();
    var w = me.wait_seconds | 0;
    m.lastTap = w > 0 ? Date.now() + w * 1000 - U.COOLDOWN_MS : 0;
    U.ls.setJSON("olnu.night", m);
    tickCooldown();
    undoSync(me);
  }
  function fetchV2(startedAt, wantHeat) {
    var p = viewBox(); p.p_since = null; p.p_heat = !!wantHeat;
    return rpc("poll_v2", p).then(function (r) {
      if (r.error) {
        if (U.missing(r.error)) { pollV2 = "missing"; return null; }
        throw r.error;
      }
      var d = parseData(r.data);
      if (!d || !Array.isArray(d.pins)) { pollV2 = "missing"; return null; }
      pollV2 = "on";
      return d;
    });
  }
  function fetchOld() {
    return Promise.all([rpc("live_beers"), fetchOthers(), fetchCheckins()]).then(function (res) {
      var r = res[0], others = res[1] || {};
      if (r.error) throw r.error;
      return (r.data || []).filter(function (b) {
        if (!b || !isFinite(b.lat) || !isFinite(b.lng)) return false;
        var o = others[b.id];
        b.other_count = o ? Math.max(0, o.other_count | 0) : 0; b.other_kind = o ? o.other_kind || null : null;
        return (b.beer_count | 0) >= 1 || b.other_count >= 1;
      });
    });
  }
  function refresh(force) {
    // A poll is already running (e.g. right after a beer tap): run once more after it, so the new pin shows now.
    if (loading) { refreshAgain = true; return loadingP || Promise.resolve(); }
    if (!LIVE || !authed || movedState) return Promise.resolve();
    if (document.visibilityState === "hidden") return Promise.resolve();
    loading = true;
    var startedAt = Date.now(), box = null, dv2 = null;
    var wantHeat = !!(heat && heatOn && (force === "heat" || Date.now() - heatAskAt >= HEAT_MS));
    var step = pollV2 === "missing" ? Promise.resolve(null) : fetchV2(startedAt, wantHeat).catch(function (e) {
      if (U.errCode(e) === "not_authenticated") throw e;
      return pollV2 === "on" ? Promise.reject(e) : null;   // invalid_bbox / odd error on first try: old calls
    });
    loadingP = step.then(function (d) {
      if (movedState) return;
      if (d) {
        dv2 = d;
        box = Array.isArray(d.bbox) && d.bbox.length === 4 ? d.bbox.map(Number) : null;
        pollBox = box;
        beers = normPins(d.pins);
        liveTotal = d.live_total != null ? d.live_total | 0 : null;
        checkins = (d.checkins || []).filter(function (c) { return c && c.bar_name && isFinite(c.lat) && isFinite(c.lng); });
        checkinState = "on"; syncMyCheckin();
        if (othersState !== "on") { othersState = "on"; mods("onOthersState", true); }
        if (Array.isArray(d.heat)) {
          heatAskAt = Date.now();
          heatPoints = d.heat.filter(function (x) { return x && isFinite(x[0]) && isFinite(x[1]) && x[2] > 0; }).map(function (x) { return [+x[0], +x[1], +x[2]]; });
        }
        applyMe(d.me, startedAt);
        return;
      }
      return fetchOld().then(function (list) {
        if (movedState) return;
        beers = normPins(list); liveTotal = null; pollBox = null; meState = null;
      });
    }).then(function () {
      if (movedState) return;
      drinkViews = null;
      lastPollAt = Date.now();
      beers.forEach(function (b) {
        var mine = mySkals[b.id];
        if (mine != null && !b.is_mine) { b.i_skaled = true; if (b.skal_count < mine) b.skal_count = mine; }
      });
      if (window.NEWS) window.NEWS.update(beerOnly());
      newsDirty = true;
      loadGroupNews();
      render();
      loadHeatPoints();
      streakAlerts(box);
      evalChaos(true);
      skalAlert();
      toastClear("load");
      if (!firstLoadDone) { firstLoadDone = true; handleFocus(); }
      mods("onPollData", dv2);
      mods("onPoll", beers);
    }).catch(function (e) {
      if (U.errCode(e) === "not_authenticated") {
        // Export pending and the server stopped taking our token: the new app has taken the account over.
        var pend = U.ls.getJSON("olnu.flyttPending", null);
        if (pend && !movedState) { finishExport(pend.kind, false); showMoved().then(signIn); return; }
        reauth(); return;
      }
      if (!firstLoadDone && navigator.onLine !== false) toast(t("loadFail"), { err: true, id: "load", ms: 0, action: { label: t("retry"), fn: refresh } });
    }).then(function () {
      loading = false; loadingP = null;
      if (refreshAgain) { refreshAgain = false; refresh(); }
      schedulePoll();
    });
    return loadingP;
  }
  // Poll every 30 s; every 60 s when the map was not touched for 3 min. Hidden tab = no timer at all.
  var pollTimer = null, lastTouch = Date.now(), pollOn = false;
  function idle() { return Date.now() - lastTouch > IDLE_MS; }
  function schedulePoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (!pollOn || !LIVE || loading || document.visibilityState === "hidden") return;   // a running poll schedules the next itself
    var wait = (idle() ? POLL_SLOW_MS : POLL_MS) - (Date.now() - lastPollAt);
    pollTimer = setTimeout(function () { pollTimer = null; refresh(); }, Math.max(1000, wait));
  }
  function startPoll() { if (LIVE) { pollOn = true; schedulePoll(); } }
  function stopPoll() { pollOn = false; if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }
  function touched() {
    var wasIdle = idle();
    lastTouch = Date.now();
    if (wasIdle && pollOn) schedulePoll();   // back from slow mode: next poll on the fast schedule
  }
  ["pointerdown", "keydown", "wheel"].forEach(function (ev) { document.addEventListener(ev, touched, { passive: true, capture: true }); });
  map.on("movestart zoomstart", touched);
  // poll_v2 returns only the view (+ margin): a move outside the last box polls again (max every 3 s).
  map.on("moveend", U.debounce(function () {
    if (pollV2 !== "on" || !pollBox || loading) return;
    var b = map.getBounds(), v = viewBox();
    var inside = v.p_min_lat >= pollBox[0] && v.p_min_lng >= pollBox[1] && v.p_max_lat <= pollBox[2] && v.p_max_lng <= pollBox[3];
    if (!inside && Date.now() - lastPollAt > 3000) refresh();
  }, 400));
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      if (flyttOnVisible()) return;   // back from the new app: the account moved, do not poll with the old token
      lastTouch = Date.now(); startPoll(); refresh(); tickCooldown();
    }
    else { flyttHiddenAt = Date.now(); stopPoll(); }
  });

  /* ---------- Offline banner ---------- */
  function applyOnline() {
    var off = navigator.onLine === false;
    $("offline-banner").hidden = !off;
    document.body.classList.toggle("is-offline", off);
    if (!off) refresh();
  }
  window.addEventListener("online", applyOnline);
  window.addEventListener("offline", applyOnline);

  function handleFocus() {
    if (pendingFocus == null) return;
    var id = pendingFocus; pendingFocus = null;
    var b = null;
    for (var i = 0; i < beers.length; i++) if (String(beers[i].id) === String(id)) b = beers[i];
    if (!b) return;
    map.setView([b.lat, b.lng], 16, { animate: false });
    setTimeout(function () {
      var m = markerById[b.id];
      if (!m) return;
      // A hot bar badge: open the bar popup. A clustered pin: zoom in, then its own popup (never spiderfy).
      if (!clusters.hasLayer(m)) m.openPopup(); else showBeer(b, 18);
    }, 350);
  }

  /* ---------- Error messages ---------- */
  function errMsg(e, fallback) {
    switch (U.errCode(e)) {
      case "outside_sweden": return t("outsideServer");
      case "invalid_name": return t("invalidName");
      case "group_not_found": return t("notFound");
      case "not_authenticated": reauth(); return t("notAuth");
      case "invalid_subscription": return t("invalidSub");
      case "code_generation_failed": return t("codeGenFail");
      case "own_beer": return t("skalOwn");
      case "beer_not_found": return t("skalGone");
      default: return fallback || t("fail");
    }
  }
  var reauthing = false;
  function reauth() {
    if (!LIVE || !client || reauthing || movedState || flyttPendingNow()) return;
    reauthing = true; authed = false;
    // Try to refresh the token first: signing out makes a NEW anonymous user and loses all groups.
    client.auth.refreshSession().then(function (r) {
      if (r && r.data && r.data.session && !r.error) return "ok";
      // Network error (phone just woke up, bad signal): keep the session. A new anonymous
      // user would lose all groups and leave the old pin on the map.
      if (authRetryable(r && r.error)) return "ok";
      try { console.warn("olnu reauth", r && r.error && (r.error.message || r.error.status)); } catch (e) {}
      // v14: never silently: warn and offer the flyttkod first.
      return askNewAccount().then(function (choice) {
        if (choice !== "new") return choice;
        U.ls.del("olnu.uid");
        return Promise.resolve(client.auth.signOut()).catch(function () {}).then(function () { return "ok"; });
      });
    }).catch(function () { return "ok"; }).then(function (res) {
      reauthing = false;
      if (res === "retry") { setTimeout(reauth, 300); return; }
      if (res === "ok") return signIn();
    });
  }
  // "Din inloggning gick ut": continue with a new account, paste a flyttkod, or try again.
  var askingAcc = null;
  function askNewAccount() {
    if (askingAcc) return askingAcc;
    askingAcc = new Promise(function (resolve) {
      var done = false, fin = function (v) { if (done) return; done = true; askingAcc = null; resolve(v); };
      openSheet(t("reauthTitle"), function (body) {
        body.appendChild(el("p", { text: t("reauthText") }));
        body.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [btn(t("reauthRetry"), "btn-green btn-block", function () { fin("retry"); closeSheet("pick"); })]));
        body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [btn(t("reauthFlytt"), "btn-amber btn-block", function () { fin("flytt"); showFlyttImport(); })]));
        body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [btn(t("reauthNew"), "btn-ghost btn-block", function () { fin("new"); closeSheet("pick"); })]));
      }, { now: true, onClose: function () { fin("later"); } });
    });
    return askingAcc;
  }

  /* ---------- Cooldown ---------- */
  var RING_LEN = 2 * Math.PI * 56;
  var cdTimer = null;
  function cooldownLeft() {
    var m = myNight();
    if (!m || !m.lastTap) return 0;
    return Math.max(0, m.lastTap + U.COOLDOWN_MS - Date.now());
  }
  // Ready again: the foam spills over the rim once (not on page load, not with reduced motion).
  var cdWasOn = false;
  function pintSpill(btnEl) {
    var wrap = btnEl.parentNode;
    if (window.FX && window.FX.reduced && window.FX.reduced()) return;
    wrap.classList.remove("spill"); btnEl.classList.remove("ready-pop");
    void wrap.offsetWidth;
    wrap.classList.add("spill"); btnEl.classList.add("ready-pop");
    setTimeout(function () { wrap.classList.remove("spill"); btnEl.classList.remove("ready-pop"); }, 1200);
  }
  function tickCooldown() {
    var left = cooldownLeft(), btnEl = $("btn-beer"), ring = $("cd-ring");
    var on = left > 0;
    btnEl.classList.toggle("cooldown", on);
    btnEl.classList.toggle("soon", !LIVE);
    if (!LIVE) {
      // Coming soon: no backend yet. Button is visible but disabled.
      if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
      btnEl.disabled = true;
      $("beer-label").textContent = t("soonBtn");
      $("beer-sub").textContent = t("soonSub");
      btnEl.setAttribute("aria-label", t("soonBtn") + " — " + t("soonSub"));
      ring.style.strokeDashoffset = String(RING_LEN);
      return;
    }
    if (on) {
      btnEl.disabled = true;
      $("beer-label").textContent = U.mmss(left);
      $("beer-sub").textContent = t("nextIn");
      btnEl.setAttribute("aria-label", t("nextIn") + " " + U.mmss(left));
      // Server wait may be longer than the local fallback (old server): clamp the ring to 0..1.
      ring.style.strokeDashoffset = String(RING_LEN * (1 - Math.min(1, left / U.COOLDOWN_MS)));
      // Design pass 2: the button fills like a pint (14 % → 92 %), foam head on top, bubbles in the beer.
      btnEl.style.setProperty("--fill", (14 + 78 * (1 - Math.min(1, left / U.COOLDOWN_MS))).toFixed(1) + "%");
      if (!cdTimer) cdTimer = setInterval(tickCooldown, 1000);
    } else {
      if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
      if (!busy) btnEl.disabled = false;
      $("beer-label").textContent = t("beer");
      $("beer-sub").textContent = t("beerSub");
      btnEl.removeAttribute("aria-label");
      ring.style.strokeDashoffset = String(RING_LEN);
      if (cdWasOn) pintSpill(btnEl);
    }
    cdWasOn = on;
    btnEl.parentNode.classList.toggle("cd", on);
    fitBeerLabel();
  }
  $("cd-ring").style.strokeDasharray = String(RING_LEN);
  // v14: the label always fits inside the round button ("BEER!" is wider than "ÖL!").
  var fitKey = "";
  function fitBeerLabel() {
    var lab = $("beer-label"), b = $("btn-beer");
    if (!lab || !b) return;
    var key = lab.textContent + "|" + b.className + "|" + b.clientWidth;
    if (key === fitKey) return;
    fitKey = key;
    lab.style.fontSize = "";
    var room = b.clientWidth * 0.8, size = parseFloat(getComputedStyle(lab).fontSize) || 34, guard = 0;
    if (!room) return;
    while (lab.scrollWidth > room && size > 14 && guard++ < 30) { size -= 1; lab.style.fontSize = size + "px"; }
  }
  window.addEventListener("resize", U.debounce(function () { fitKey = ""; fitBeerLabel(); }, 150));

  /* ---------- Beer button ---------- */
  function getPosition(opts) {
    return new Promise(function (res, rej) {
      if (!("geolocation" in navigator)) { rej({ code: 2 }); return; }
      try {
        navigator.geolocation.getCurrentPosition(res, rej, opts || { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
      } catch (e) { rej({ code: 2 }); }
    });
  }
  // Explain how to turn location on, for the browser the user has.
  function locHelp() {
    var ua = navigator.userAgent || "";
    if (U.isIOS()) return t("locHelpIOS");
    if (/Firefox/i.test(ua)) return t("locHelpFirefox");
    if (/Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg/i.test(ua)) return t("locHelpSafari");
    return t("locHelpChrome");
  }
  function locError(err) {
    if (err && err.code === 1) toast(t("locDenied") + " " + locHelp(), { err: true, ms: 12000, id: "loc" });
    else if (err && err.code === 3) toast(t("locTimeout"), { err: true, ms: 6000, id: "loc" });
    else toast(t("locFail"), { err: true, ms: 6000, id: "loc" });
  }

  /* ---------- Locate me ---------- */
  var meLayer = L.layerGroup().addTo(map);
  function showMe(lat, lng, acc) {
    lastLoc = { lat: lat, lng: lng };
    if (PUSH_ON && authed) window.PUSH.setLocation(rpc, lat, lng);
    if (chaosRes) evalChaos(false);
    meLayer.clearLayers();
    if (acc && acc < 2000) L.circle([lat, lng], { radius: acc, className: "me-acc", interactive: false, stroke: false }).addTo(meLayer);
    L.marker([lat, lng], { icon: L.divIcon({ html: '<div class="me-dot"></div>', className: "", iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false, keyboard: false }).addTo(meLayer);
  }
  // v14 worldwide: any valid position (the server may still refuse outside Sweden: outside_sweden toast).
  function inSweden(lat, lng) { return U.validPos(lat, lng); }
  function locate(opts) {
    opts = opts || {};
    var b = $("btn-locate"); b.classList.add("busy");
    return getPosition({ enableHighAccuracy: !!opts.precise, timeout: 12000, maximumAge: 60000 }).then(function (pos) {
      var la = pos.coords.latitude, ln = pos.coords.longitude;
      showMe(la, ln, pos.coords.accuracy);
      if (U.validPos(la, ln)) map.setView([la, ln], Math.max(opts.keepZoom ? map.getZoom() : 0, START_ZOOM), { animate: !!opts.animate });
      U.ls.set("olnu.locOk", "1");
      return true;
    }, function (err) {
      if (!opts.quiet) locError(err);
      return false;
    }).then(function (ok) { b.classList.remove("busy"); return ok; });
  }
  $("btn-locate").addEventListener("click", function () { locate({ animate: true, precise: true }); });
  function setBusy(v) {
    busy = v; var b = $("btn-beer"); b.disabled = v || cooldownLeft() > 0; b.classList.toggle("busy", v);
    if (!v) setTimeout(drainSheets, 80);
  }
  function levelToast(n) {
    if (n === 1) return t("lvl1");
    var lv = lvOf(n);
    if (lv) {
      var nm = lvName(lv, "me");
      if (n === lv.at) return lv.emoji + " " + nm + "! " + t("lvlN", n) + " · " + noLeadEmoji(lvLine(lv));
      return lv.emoji + " " + t("lvlN", n) + " · " + nm;
    }
    if (n === 5) return t("lvl5");
    if (n === 10) return t("lvl10");
    if (n > 10) return t("lvlMed", n);
    if (n > 5) return t("lvlHot", n);
    return t("lvlN", n);
  }
  // v14: all drinks count. Drinks tonight after an accepted beer = beers + other drinks (server "me" or pin).
  function othersNow() {
    var oc = meState ? meState.other_count | 0 : 0, mine = myBeer();
    if (mine) oc = Math.max(oc, mine.other_count | 0);
    try { if (window.EXTRAS && window.EXTRAS.otherTonight) oc = Math.max(oc, window.EXTRAS.otherTonight() | 0); } catch (e) {}
    return oc;
  }
  // HOT STREAK / MEDEVAC takeover when the total crosses 5 / 10 (after ÖL! or after ANNAT). Returns true when shown.
  // Swedish: title = my level name tonight, sub = a random line of that level, plus a random FX gag (fx.js).
  // 5 = fire takeover, 10 = blue-light takeover (taxi buttons). 3, 7, 13, 16, 20 = small pops (toast + small effect).
  // opts.noToast: the caller shows its own toast (ÖL! flow: levelToast). Returns true when a takeover ran.
  // Takeovers never cover the beer-type strip: they wait until it closes (js/barsplus.js OLNU_STRIP).
  function stripUp() { try { return !!(window.OLNU_STRIP && window.OLNU_STRIP.up()); } catch (e) { return false; } }
  function stripAfter(fn) { if (window.OLNU_STRIP && window.OLNU_STRIP.after) window.OLNU_STRIP.after(fn); else fn(); }
  function drinkFx(total, prev, opts) {
    opts = opts || {};
    var lv10 = lvAt(10), lv5 = lvAt(5);
    if (prev < 10 && total >= 10) {
      var medExtra = mods("medevacExtraHTML");
      stripAfter(function () { window.FX.takeover(2, lv10 ? { title: lvName(lv10, "me"), sub: lvLine(lv10), icon: lv10.emoji, color: lv10.color, gag: true, hint: t("tapClose"), extraHTML: medExtra, ms: medExtra ? 7000 : 0 }
        : { title: t("medTitle"), sub: t("medSub"), hint: t("tapClose"), extraHTML: medExtra, ms: medExtra ? 7000 : 0 }); });
      return true;
    }
    if (prev < 5 && total >= 5) {
      stripAfter(function () { window.FX.takeover(1, lv5 ? { title: lvName(lv5, "me"), sub: lvLine(lv5), icon: lv5.emoji, color: lv5.color, gag: true, hint: t("tapClose") }
        : { title: t("hotTitle"), sub: t("hotSub"), hint: t("tapClose") }); });
      return true;
    }
    // Small pops: the highest level crossed (3, 7, 13, 16, 20).
    var all = lvList() || [], pop = null;
    all.forEach(function (lv) { if (lv.at !== 5 && lv.at !== 10 && prev < lv.at && total >= lv.at && (!pop || lv.at > pop.at)) pop = lv; });
    if (pop) {
      if (window.FX.levelPop) window.FX.levelPop({ emoji: pop.emoji, color: pop.color, intensity: pop.intensity | 0, care: pop.at >= 13 });
      if (!opts.noToast) toast(pop.emoji + " " + lvName(pop, "me") + "! " + noLeadEmoji(lvLine(pop)), { ms: 6000, cls: "lv-pop" });
      // Owner: no warning toasts. The 🚕 Taxi button in the HUD stays (a tool, not a text).
    }
    return false;
  }
  // "Var dricker du?" — sometimes asks which bar you are at, so the beer counts there.
  // Asks: on the first beer tonight, when you moved > 150 m since the last pick, or now and then (1 in 4).
  // Else it reuses the last picked bar while you stay within 150 m of where you picked it.
  // v14: ✕ / backdrop / Escape / another sheet = CANCEL (no beer). Bars first, then restaurants/cafés (🍽️).
  // 🏠 Hemzon: the beer is posted as an area unless a bar or restaurant is picked.
  var WHERE_KEY = "olnu.where", WHERE_R = 400, WHERE_STAY = 150, WHERE_PLACE_R = 150;
  function askWhere(pos) {
    var lat = pos.coords.latitude, lng = pos.coords.longitude;
    var home = !!(window.PRIVACY && window.PRIVACY.inHome(lat, lng));
    var real = { lat: lat, lng: lng, precise: prec === "exact" && !home, home: home };
    // v10: fresh own check-in (< 3 h) and still within 150 m of it → drink there, no question.
    var ci = myCheckin();
    if (ci && Date.now() - ci.at < CI_FRESH_MS && U.haversine(lat, lng, ci.lat, ci.lng) <= CI_STAY_M) {
      return Promise.resolve({ lat: ci.lat, lng: ci.lng, precise: prec === "exact" });
    }
    var list = window.BARS && window.BARS.nearby ? window.BARS.nearby(lat, lng, WHERE_R, 6, { places: true, placeM: WHERE_PLACE_R, maxPlaces: 4 }) : [];
    if (!list.length) return Promise.resolve(real);
    var last = U.ls.getJSON(WHERE_KEY, null), night = myNight();
    var fresh = last && last.until > Date.now();
    var stayed = fresh && U.haversine(lat, lng, last.atLat, last.atLng) <= WHERE_STAY;
    var first = !night || !(night.count | 0);
    if (stayed && !first && Math.random() >= 0.25) {
      return Promise.resolve(last.bar ? { lat: last.bar.lat, lng: last.bar.lng, precise: true } : real);
    }
    return new Promise(function (resolve) {
      var done = false;
      function pick(bar) {
        if (done) return; done = true;
        U.ls.setJSON(WHERE_KEY, { atLat: lat, atLng: lng, until: nightEnd(),
          bar: bar ? { id: bar.id, name: bar.name, lat: bar.lat, lng: bar.lng } : null });
        closeSheet("pick");
        resolve(bar ? { lat: bar.lat, lng: bar.lng, precise: true } : real);
      }
      openSheet(t("whereTitle"), function (body) {
        body.appendChild(el("p", { class: "muted", text: t("whereInfo") }));
        var bars = list.filter(function (x) { return !x.place; }), places = list.filter(function (x) { return x.place; });
        var row = function (x, i, emo) {
          var m = Math.round(x.d / 10) * 10;
          body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [
            btn(emo + " " + x.bar.name + "  · " + (m < 20 ? t("whereHere") : m + " m"), (i === 0 && emo === "🍺" ? "btn-amber " : "") + "btn-block" + (x.place ? " where-place" : ""), function () { pick(x.bar); })
          ]));
        };
        bars.forEach(function (x, i) { row(x, i, "🍺"); });
        if (places.length) {
          body.appendChild(el("p", { class: "muted where-sub", text: t("wherePlaces") }));
          places.forEach(function (x, i) { row(x, i, "🍽️"); });
        }
        body.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn("🏠 " + t("whereNone"), "btn-ghost btn-block", function () { pick(null); })]));
      }, { now: true, lock: true, onClose: function () { if (!done) { done = true; resolve(null); } } });
    });
  }
  /* ---------- Post: post_beer_v2 (v13) with fallback to post_beer ---------- */
  var postV2 = "unknown";   // "unknown" | "on" | "missing"
  function postBeer(spot, ghost) {
    var p = { p_lat: spot.lat, p_lng: spot.lng, p_precise: !!spot.precise };
    if (postV2 === "missing") return rpc("post_beer", p).then(function (r) { return { r: r, v2: false }; });
    p.p_hidden = !!ghost;
    return rpc("post_beer_v2", p).then(function (r) {
      if (r.error && U.missing(r.error)) {
        postV2 = "missing"; delete p.p_hidden;
        return rpc("post_beer", p).then(function (r2) { return { r: r2, v2: false }; });
      }
      if (!r.error) postV2 = "on";
      return { r: r, v2: true };
    });
  }
  /* ---------- ↩️ ÅNGRA (undo_beer, 2 min) + push only after the undo window ---------- */
  var NOTIFY_KEY = "olnu.notifyAt", notifyTimer = null;
  var undoEl = null, undoTimer = null, undoMiniTimer = null, UNDO_BIG_MS = 12000;
  function scheduleNotify(atMs) {
    flushNotify(true);   // a beer still waiting: its window ends now (the next beer)
    U.ls.set(NOTIFY_KEY, String(atMs));
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(function () { flushNotify(false); }, Math.max(0, atMs - Date.now()) + 1500);
  }
  function flushNotify(now) {
    var at = +U.ls.get(NOTIFY_KEY, "0") || 0;
    if (!at || (!now && Date.now() < at)) return;
    U.ls.del(NOTIFY_KEY); clearTimeout(notifyTimer); notifyTimer = null;
    if (Date.now() - at < 4 * 60e3) notifyGroup();   // notify-group needs a beer from the last 5 min
  }
  function cancelNotify() { U.ls.del(NOTIFY_KEY); clearTimeout(notifyTimer); notifyTimer = null; }
  function resumeNotify() {
    var at = +U.ls.get(NOTIFY_KEY, "0") || 0;
    if (!at) return;
    if (Date.now() >= at) flushNotify(false);
    else { clearTimeout(notifyTimer); notifyTimer = setTimeout(function () { flushNotify(false); }, at - Date.now() + 1500); }
  }
  function clearUndo() {
    clearTimeout(undoTimer); clearTimeout(undoMiniTimer); undoTimer = undoMiniTimer = null;
    if (undoEl) { undoEl.remove(); undoEl = null; }
  }
  var UNDO_SHOW_MS = 10000;
  function showUndo(d, text, cls) {
    clearUndo();
    var until = Date.parse(d.undo_until), left = isFinite(until) ? until - Date.now() : 120000;
    left = Math.max(10000, Math.min(125000, left));   // phone clock skew: at least 10 s, at most ~2 min
    // The level message is a normal short toast; ÅNGRA is a small ↩️ button next to ÖL! (owner: the big
    // red toast covered the beer-type strip).
    toast(text, { cls: cls || "", ms: 5000 });
    undoEl = el("button", { type: "button", class: "undo-fab", "aria-label": t("undoBtn"), title: t("undoBtn"), text: "↩️",
      onclick: function () { doUndo(undoEl); } });
    document.body.appendChild(undoEl);
    // The ÅNGRA toast stays 10 s only (owner: it was in the way). The group push still waits for the full window.
    undoMiniTimer = setTimeout(function () { if (undoEl) { undoEl.remove(); undoEl = null; } }, UNDO_SHOW_MS);
    undoTimer = setTimeout(function () { clearUndo(); flushNotify(false); }, left);
  }
  var undoing = false;
  function doUndo(button) {
    if (undoing) return;
    undoing = true;
    if (button) { button.disabled = true; button.textContent = button.classList.contains("undo-fab") ? "⏳" : t("undoBusy"); }
    rpc("undo_beer").then(function (r) {
      undoing = false;
      if (r.error) {
        if (button) { button.disabled = false; button.textContent = button.classList.contains("undo-fab") ? "↩️" : "↩️ " + t("undoBtn"); }
        toast(t("undoFail"), { err: true });
        return;
      }
      var d = parseData(r.data);
      clearUndo();
      if (!d.ok) {
        toast(d.reason === "limit" ? t("undoLimit") : d.reason === "no_beer" ? t("undoNone") : t("undoTooLate"), { ms: 5000 });
        flushNotify(true);
        return;
      }
      cancelNotify();   // an undone milestone sends no push
      var lines = t("undoToasts") || [];
      toast(lines.length ? lines[Math.floor(Math.random() * lines.length)] : "↩️", { ms: 5500, cls: "skal" });
      window.FX.vibrate([15, 30, 15]);
      var m = myNight() || {};
      m.count = d.beer_count | 0; m.lastTap = 0;   // the old cooldown comes back with the next poll
      U.ls.setJSON("olnu.night", m);
      lastAcceptAt = 0;
      mods("onBeerUndone", d);
      tickCooldown(); updateCounts();
      refresh();
    });
  }
  // A poll says the undo window is over (or undone on another phone): drop the button.
  function undoSync(me) { if (undoEl && me && !me.undo_until) { clearUndo(); flushNotify(false); } }

  $("btn-beer").addEventListener("click", function () {
    if (!LIVE) { toast(t("soonToast"), { id: "soon" }); return; }
    if (busy || cooldownLeft() > 0) return;
    if (navigator.onLine === false) { toast(t("offline"), { err: true, id: "off" }); return; }
    if (!authed) { toast(t("connecting"), { id: "auth" }); signIn(); return; }
    window.FX.unlock();
    window.FX.splash($("btn-beer"));
    window.FX.vibrate(20);
    setBusy(true);
    getPosition().then(askWhere).then(function (spot) {
      if (!spot) { toast(t("whereCancel"), { id: "where" }); return; }
      var ghost = !!(window.EXTRAS && window.EXTRAS.ghostOn && window.EXTRAS.ghostOn());
      var before = U.drinks(meState || myBeer() || {});
      return postBeer(spot, ghost)
        .then(function (res) {
          var r = res.r;
          if (r.error) {
            toast(U.errCode(r.error) === "outside_sweden" ? t("outsideServer") : errMsg(r.error, t("postFail")), { err: true, ms: 6000 });
            return;
          }
          var d = parseData(r.data);
          if (d.accepted === false) {
            saveNight(d, false);
            toast(t("cooldownToast", U.mmss((d.wait_seconds | 0) * 1000)));
            return;
          }
          saveNight(d, true);
          lastAcceptAt = Date.now();
          if (isFinite(d.lat) && isFinite(d.lng)) lastLoc = { lat: +d.lat, lng: +d.lng };
          // v17 server: d.drinks = total drinks tonight (beers + others). Older server: beers + others we know.
          var total = d.drinks != null && isFinite(d.drinks) ? Math.max(0, d.drinks | 0) : (d.beer_count | 0) + othersNow(), l = U.level(total);
          if (meState) { meState.beer_count = d.beer_count | 0; meState.undo_until = d.undo_until || null; }
          var big = drinkFx(total, Math.max(before, total - 1), { noToast: true });
          var text = levelToast(total) + (spot.home ? " · " + t("homeNote") : "");
          var cls = l === 2 ? "med" : l === 1 ? "hot" : "";
          if (res.v2 && d.undo_until) showUndo(d, text, cls);
          else if (!big) toast(text, { cls: cls });
          if (!big) window.FX.vibrate(l ? [40, 60, 40] : [30, 40, 60]);
          window.FX.sound.beer();
          // Spökläge: v13 server hides the pin itself (no stop_beer, no push, no record_bar). Old server: stop_beer.
          if (ghost) { if (!res.v2) rpc("stop_beer").then(function () { refresh(); }); }
          else if (res.v2 && d.undo_until) scheduleNotify(Date.parse(d.undo_until) || Date.now() + 120000);
          else notifyGroup();
          mods("onBeerAccepted", d, { precise: !!spot.precise, ghost: ghost, total: total });
          if (PUSH_ON && !ghost) window.PUSH.setLocation(rpc, +d.lat, +d.lng);
          if (PUSH_ON && window.PUSH.supported() && Notification.permission === "default" && U.ls.get("olnu.notifAsked", "") !== "1") {
            setTimeout(function () { askNotifSheet(); }, 2200);
          }
          if (isFinite(d.lat) && isFinite(d.lng) && !ghost) {
            map.setView([d.lat, d.lng], Math.max(map.getZoom(), 15));
          }
          refresh();
        });
    }, locError).catch(function () { toast(t("postFail"), { err: true }); })
      .then(function () { setBusy(false); tickCooldown(); updateCounts(); });
  });
  // Push to the group. Fully silent: no push keys, no function deployed, network error → nothing happens.
  function notifyGroup() {
    if (!PUSH_ON || !client || !client.functions) return;
    try {
      Promise.resolve(client.functions.invoke("notify-group")).then(function () {}, function () {});
    } catch (e) {}
  }
  // "Sluta dricka": choose "Jag är hemma" or "Öltorsk". Both hide the pin; the group gets a fun push.
  function stopBeer(kind) {
    var sb = $("btn-stop"); if (sb.disabled) return;
    sb.disabled = true; closeSheet("pick");
    rpc("stop_beer").then(function (r) {
      sb.disabled = false;
      if (r.error) { toast(errMsg(r.error), { err: true }); return; }
      toast(kind === "home" ? t("stopHomeToast") : t("stopPauseToast"), { ms: 5000 }); refresh();
      mods("onStopped", kind);
      if (PUSH_ON && client && client.functions) {
        try { Promise.resolve(client.functions.invoke("notify-group", { body: { event: kind } })).then(function () {}, function () {}); } catch (e) {}
      }
    });
  }
  // "🙈 Göm min pin" (own-pin popup, Settings): the same choices as "Sluta dricka".
  function showStopSheet() {
    if ($("btn-stop").disabled) return;
    openSheet(t("stopTitle"), function (body) {
      body.appendChild(el("p", { class: "muted", text: t("stopInfo") }));
      body.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [btn("🏠 " + t("stopHome"), "btn-green btn-block", function () { stopBeer("home"); })]));
      body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [btn("🥀 " + t("stopPause"), "btn-amber btn-block", function () { stopBeer("pause"); })]));
      body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [btn(t("cancel"), "btn-block", function () { closeSheet(); })]));
      mods("stopSheet", body);   // taxi + SOS
    });
  }
  $("btn-stop").addEventListener("click", showStopSheet);

  /* ---------- Sheet (v14: one sheet at a time + a queue) ----------
     A sheet that opens while "Var dricker du?" is open (lock) or while a beer is posted (busy) waits in
     a queue and opens afterwards. Replacing a sheet settles the old one's onClose("replaced"); closing
     with ✕ / backdrop / Escape gives onClose("cancel"). */
  var sheetCur = null, sheetQueue = [];
  function sheetLocked() { return !!(sheetCur && sheetCur.lock && !$("sheet").hidden); }
  function openSheet(title, build, opts) {
    opts = opts || {};
    if (!opts.now && (sheetLocked() || busy)) { sheetQueue.push([title, build, opts]); return false; }
    // Beer-type strip up: a sheet the user did not just tap for waits until the strip closes.
    if (!opts.now && stripUp() && Date.now() - lastTapOut > 1200) { sheetQueue.push([title, build, opts]); stripAfter(drainSheets); return false; }
    var prev = sheetCur; sheetCur = null;
    if (prev && prev.onClose) { try { prev.onClose("replaced"); } catch (e) {} }
    sheetCur = { onClose: opts.onClose || null, lock: !!opts.lock };
    $("sheet-title").textContent = title;
    var body = $("sheet-body"); body.innerHTML = "";
    build(body);
    $("sheet").hidden = false; $("backdrop").hidden = false;
    return true;
  }
  function closeSheet(reason) {
    $("sheet").hidden = true; $("backdrop").hidden = true; $("sheet-body").innerHTML = "";
    var cur = sheetCur; sheetCur = null;
    if (cur && cur.onClose) { try { cur.onClose(typeof reason === "string" ? reason : "cancel"); } catch (e) {} }
    setTimeout(drainSheets, 80);
    setTimeout(toastPump, 300);   // a calm toast that waited for the sheet
  }
  function drainSheets() {
    if (!sheetQueue.length || busy || !$("sheet").hidden || !$("intro").hidden) return;
    if (stripUp()) { stripAfter(drainSheets); return; }
    var x = sheetQueue.shift();
    openSheet(x[0], x[1], x[2]);
  }
  $("sheet-close").addEventListener("click", function () { closeSheet("cancel"); });
  $("backdrop").addEventListener("click", function () { closeSheet("cancel"); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("sheet").hidden) closeSheet("cancel"); });

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function btn(label, cls, fn) { return el("button", { type: "button", class: "btn " + (cls || ""), text: label, onclick: fn }); }

  /* ---------- Name ---------- */
  function getName() { return (U.ls.get("olnu.name", "") || "").trim(); }
  function validName(s) { s = (s || "").trim(); return s.length >= 1 && s.length <= 30 ? s : null; }
  function askName(then) {
    openSheet(t("yourName"), function (body) {
      var inp = el("input", { class: "inp", id: "name-inp", maxlength: "30", autocomplete: "nickname", enterkeyhint: "done", value: getName(), placeholder: t("namePh") });
      var go = function () {
        var n = validName(inp.value); if (!n) { toast(t("nameNeeded"), { err: true }); return; }
        U.ls.set("olnu.name", n); then();
      };
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      body.appendChild(el("label", { class: "fld", for: "name-inp", text: t("nameHint") }));
      body.appendChild(inp);
      body.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn(t("next"), "btn-amber btn-block", go)]));
      setTimeout(function () { inp.focus(); }, 50);
    });
  }
  function withName(fn) { if (getName()) fn(); else askName(fn); }
  function showRename(back) {
    openSheet(t("rename"), function (body) {
      var inp = el("input", { class: "inp", id: "rename-inp", maxlength: "30", autocomplete: "nickname", enterkeyhint: "done", value: getName(), placeholder: t("namePh") });
      var busy = false;
      var go = function () {
        if (busy) return;
        var n = validName(inp.value); if (!n) { toast(t("nameNeeded"), { err: true }); return; }
        busy = true;
        U.ls.set("olnu.name", n);
        rpc("set_display_name", { p_display_name: n }).then(function (r) {
          busy = false;
          if (r.error) { toast(errMsg(r.error), { err: true }); return; }
          toast(t("nameSaved"));
          if (back) back(); else closeSheet();
        });
      };
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      body.appendChild(el("label", { class: "fld", for: "rename-inp", text: t("nameHint") }));
      body.appendChild(inp);
      body.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [
        btn(t("cancel"), "", function () { if (back) back(); else closeSheet(); }),
        btn(t("save"), "btn-amber", go)
      ]));
      setTimeout(function () { inp.focus(); inp.select(); }, 50);
    });
  }

  /* ---------- Groups ---------- */
  function joinLink(code) { return location.origin + location.pathname + "?join=" + encodeURIComponent(code); }
  function friendsNowText() { var f = friendsDrinking(); return f ? " · " + t("friendsNow", f) : ""; }

  function showGroups() {
    if (!LIVE) {
      openSheet(t("groups"), function (body) { body.appendChild(el("div", { class: "info", text: t("soonInfo") })); });
      return;
    }
    withName(function () {
      openSheet(t("groups"), function (body) {
        var list = el("ul", { class: "glist" });
        body.appendChild(el("div", { class: "namebar", style: "display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:6px" }, [
          el("div", { style: "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, [
            el("span", { class: "muted", text: t("nameLabel") + " " }),
            el("strong", { text: getName() })
          ]),
          btn("✏️ " + t("rename"), "btn-small", function () { showRename(showGroups); })
        ]));
        body.appendChild(el("h3", { text: t("myGroups") + friendsNowText() }));
        body.appendChild(list);
        body.appendChild(el("div", { class: "row", style: "margin-top:14px" }, [
          btn(t("create"), "btn-amber", showCreate), btn(t("join"), "btn-green", function () { showJoin(""); })
        ]));
        body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [btn("📲 " + t("inviteBtn"), "btn-block", showInvite)]));
        mods("groupsSheet", body);   // "Kom hit!"
        list.appendChild(el("li", { class: "muted", text: "…" }));
        rpc("my_groups").then(function (r) {
          list.innerHTML = "";
          if (r.error) { list.appendChild(el("li", { class: "muted", text: t("fail") })); return; }
          var gs = r.data || [];
          if (!gs.length) { list.appendChild(el("li", { class: "muted", text: t("noGroups") })); return; }
          gs.forEach(function (g) { list.appendChild(groupItem(g)); });
        });
      });
    });
  }
  function groupItem(g) {
    var li = el("li", { class: "gitem" });
    var main = el("div", { class: "gmain" }, [
      el("div", { class: "gname", text: g.name }),
      el("div", { class: "gsub", html: U.esc(t("code")) + " " + U.esc(g.code) + " · " + t("drinkingOf", g.active_count | 0, g.member_count | 0) })
    ]);
    // Design pass 2: the name gets the full row; "Visa kod" below it; "Lämna" is a quiet text button at the
    // bottom of the card (after the module buttons), behind the same confirm. Never next to a common button.
    var leave = el("button", { type: "button", class: "g-leave", text: t("leave") });
    var wrap = el("div", {}, [main, el("div", { class: "g-acts" }, [
      btn(t("show"), "btn-small", function () { showCode(g, false); })
    ])]);
    leave.addEventListener("click", function () {
        if (wrap.querySelector(".confirm")) return;
        var box = el("div", { class: "confirm" }, [
          el("p", { text: t("leaveQ", g.name) }),
          el("div", { class: "row" }, [
            btn(t("cancel"), "btn-small", function () { box.remove(); }),
            btn(t("leaveYes"), "btn-small btn-danger", function () {
              rpc("leave_group", { p_group_id: g.id }).then(function (r) {
                if (r.error) { toast(errMsg(r.error), { err: true }); return; }
                toast(t("left")); refresh(); showGroups();
              });
            })
          ])
        ]);
        wrap.appendChild(box);
        box.scrollIntoView({ block: "nearest" });
    });
    li.appendChild(wrap);
    li.style.display = "block";
    mods("groupItem", g, wrap, main);   // chat button + tap for group status
    wrap.appendChild(el("div", { class: "g-foot" }, [leave]));
    return li;
  }
  function showCreate() {
    withName(function () {
      openSheet(t("create"), function (body) {
        var inp = el("input", { class: "inp", id: "gname-inp", maxlength: "40", enterkeyhint: "done" });
        var go = function () {
          var n = (inp.value || "").trim();
          if (n.length < 1 || n.length > 40) { toast(t("groupNameNeeded"), { err: true }); return; }
          rpc("create_group", { p_name: n, p_display_name: getName() }).then(function (r) {
            if (r.error || !r.data) { toast(errMsg(r.error), { err: true }); return; }
            var g = parseData(r.data);
            toast(t("created")); refresh(); showCode(g, true);
          });
        };
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
        body.appendChild(el("label", { class: "fld", for: "gname-inp", text: t("groupName") }));
        body.appendChild(inp);
        body.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [
          btn(t("cancel"), "", showGroups), btn(t("create"), "btn-amber", go)
        ]));
        setTimeout(function () { inp.focus(); }, 50);
      });
    });
  }
  function showJoin(code) {
    withName(function () {
      openSheet(t("join"), function (body) {
        var inp = el("input", { class: "inp code-inp", id: "code-inp", maxlength: "6", autocapitalize: "characters",
          autocomplete: "off", autocorrect: "off", spellcheck: "false", enterkeyhint: "go", value: U.cleanCode(code) });
        inp.addEventListener("input", function () {
          var c = U.cleanCode(inp.value); if (c !== inp.value) inp.value = c;
        });
        var go = function () {
          var c = U.cleanCode(inp.value);
          if (c.length !== 6) { toast(t("codeNeeded"), { err: true }); return; }
          rpc("join_group", { p_code: c, p_display_name: getName() }).then(function (r) {
            if (r.error) { toast(errMsg(r.error), { err: true }); return; }
            var g = parseData(r.data);
            toast(t("joined", g.name || "")); refresh();
            // In the browser: show how to put the app on the home screen first (the groups are there after).
            if (!U.isStandalone()) { showInstallGuide(); return; }
            showGroups();
            notifPromptOnce();
          });
        };
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
        body.appendChild(el("label", { class: "fld", for: "code-inp", text: t("joinCode") }));
        body.appendChild(inp);
        body.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [
          btn(t("cancel"), "", showGroups), btn(t("join"), "btn-green", go)
        ]));
        setTimeout(function () { inp.focus(); }, 50);
      });
    });
  }
  function showCode(g, isNew) {
    openSheet(g.name, function (body) {
      var link = joinLink(g.code);
      body.appendChild(el("p", { class: "muted", text: t("joinCode") }));
      body.appendChild(el("div", { class: "code-big", text: g.code }));
      var qr = el("div", { class: "qr", id: "qr", "aria-hidden": "true" });
      body.appendChild(qr);
      try {
        if (window.QRCode) new window.QRCode(qr, { text: link, width: 184, height: 184, colorDark: "#0b1030", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
        else qr.remove();
      } catch (e) { qr.remove(); }
      var row = el("div", { class: "row", style: "margin-top:8px" }, [
        btn(t("copy"), "", function () { copyText(link); })
      ]);
      if (navigator.share) {
        row.appendChild(btn(t("share"), "btn-amber", function () {
          navigator.share({ title: "Öl Nu", text: t("shareText", g.name), url: link }).catch(function () {});
        }));
      }
      body.appendChild(row);
      body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [btn(t("done"), "btn-block", showGroups)]));
      if (isNew) notifPromptOnce(body);
    });
  }
  function copyText(s) {
    var done = function () { toast(t("copied")); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(done, function () { fallbackCopy(s) && done(); });
    } else if (fallbackCopy(s)) done();
  }
  function fallbackCopy(s) {
    try {
      var ta = el("textarea", { style: "position:fixed;top:-100px;opacity:0" }); ta.value = s; document.body.appendChild(ta);
      ta.select(); var ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch (e) { return false; }
  }
  $("btn-groups").addEventListener("click", showGroups);

  /* ---------- Top list tonight ---------- */
  var topTab = U.ls.get("olnu.topTab", "bars");
  function lvlIcon(l) { return l === 2 ? "🚁" : l === 1 ? "🔥" : ""; }
  function cityOf(b) { var c = window.CITIES.nearest(b.lat, b.lng); return c ? c.name : null; }
  function flyTo(lat, lng, z, openId) {
    closeSheet();
    var b = openId == null ? null : beerById(openId);
    if (b) { showBeer(b, z); return; }
    map.flyTo([lat, lng], z, { duration: 1.2 });
  }
  function topRows(kind) {
    if (kind === "bars") {
      var per = window.BARS.assign(beers).perBar;
      return Object.keys(per).map(function (k) { return per[k]; })
        .sort(function (a, b) { return b.beers.length - a.beers.length || maxLevel(b.beers) - maxLevel(a.beers); })
        .slice(0, 15).map(function (a) {
          var sk = 0; a.beers.forEach(function (b) { sk += skalCount(b); });
          return { name: a.bar.name || t("unnamedBar"), sub: barTypeLabel(a.bar.type) + (sk ? " · " + t("skalN", sk) : ""),
            n: a.beers.length, icon: lvlIcon(maxLevel(a.beers)), lat: a.bar.lat, lng: a.bar.lng, z: 17,
            friend: a.beers.some(function (b) { return b.friend_name; }) };
        });
    }
    if (kind === "cities") {
      var g = {};
      beerOnly().forEach(function (b) {
        var c = cityOf(b), k = c || "";
        var x = g[k] || (g[k] = { name: c || t("other"), list: [], other: !c });
        x.list.push(b);
      });
      // Ranked by average beers per person (people = everyone who reported tonight).
      var avgOf = function (x) { var tot = 0; x.list.forEach(function (b) { tot += b.beer_count | 0; }); return x.list.length ? tot / x.list.length : 0; };
      return Object.keys(g).map(function (k) { return g[k]; })
        .sort(function (a, b) { return (a.other - b.other) || (avgOf(b) - avgOf(a)) || b.list.length - a.list.length; })
        .slice(0, 20).map(function (x) {
          var c = null; window.CITIES.list.forEach(function (cc) { if (cc.name === x.name) c = cc; });
          var lat = 0, lng = 0; x.list.forEach(function (b) { lat += b.lat; lng += b.lng; });
          var tot = 0; x.list.forEach(function (b) { tot += b.beer_count | 0; });
          var avg = avgOf(x);
          var avgTxt = (Math.round(avg * 10) / 10).toString().replace(".", I.lang === "sv" ? "," : ".");
          return { name: x.name, sub: t("cityAvgSub", x.list.length, tot), n: avgTxt + " 🍺/" + t("perPerson"), icon: lvlIcon(maxLevel(x.list)),
            lat: c ? c.lat : lat / x.list.length, lng: c ? c.lng : lng / x.list.length, z: c ? 12 : 7,
            friend: x.list.some(function (b) { return b.friend_name; }) };
        });
    }
    return beers.filter(function (b) { return U.level(U.drinks(b)) > 0; })
      .sort(function (a, b) { return U.drinks(b) - U.drinks(a); })
      .slice(0, 20).map(function (b) {
        return { name: whoOf(b), sub: placeLabel(b), n: U.drinks(b), icon: lvlIcon(U.level(U.drinks(b))),
          lat: b.lat, lng: b.lng, z: 17, id: b.id, friend: !!b.friend_name, mine: !!b.is_mine };
      });
  }
  function showTop() {
    openSheet(t("top"), function (body) {
      var tabs = el("div", { class: "tabs", role: "tablist" });
      var list = el("ol", { class: "toplist" });
      var note = el("p", { class: "muted top-note" });
      var kinds = [["bars", t("topBars")], ["cities", t("topCities")], ["streaks", t("topStreaks")]];
      var league = !!(window.SOCIAL && window.SOCIAL.leagueOn && window.SOCIAL.leagueOn());
      if (league) { kinds.push(["league", t("topLeague")]); tabs.classList.add("t4"); }
      else if (topTab === "league") topTab = "bars";
      function draw() {
        tabs.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-k") === topTab)); });
        list.innerHTML = "";
        if (topTab === "league") { note.textContent = ""; window.SOCIAL.drawLeague(list, note); return; }
        var rows = topRows(topTab);
        note.textContent = topTab === "bars" ? t("topNote") : "";
        if (!rows.length) {
          list.appendChild(el("li", { class: "muted top-empty", text: topTab === "bars" ? t("topNoBars") : topTab === "cities" ? t("topNoCities") : t("topNoStreaks") }));
          return;
        }
        rows.forEach(function (r, i) {
          var li = el("li", {}, [el("button", { type: "button", class: "top-row" + (r.friend ? " friend" : "") + (r.mine ? " mine" : ""),
            onclick: function () { flyTo(r.lat, r.lng, r.z, r.id); } }, [
            el("span", { class: "top-rank", text: String(i + 1).padStart(2, "0") }),
            el("span", { class: "top-main" }, [el("span", { class: "top-name", text: r.name }), el("span", { class: "top-sub", text: r.sub })]),
            el("span", { class: "top-n", text: (r.icon ? r.icon + " " : "") + r.n + (topTab === "streaks" ? " 🍺" : "") })
          ])]);
          list.appendChild(li);
        });
      }
      kinds.forEach(function (k) {
        tabs.appendChild(el("button", { type: "button", role: "tab", "data-k": k[0], text: k[1], onclick: function () {
          topTab = k[0]; U.ls.set("olnu.topTab", topTab); draw();
        } }));
      });
      body.appendChild(tabs); body.appendChild(list); body.appendChild(note);
      draw();
      mods("topSheet", body);   // v12: "Vad dricker stan?"
    });
  }
  $("btn-top").addEventListener("click", showTop);

  /* ---------- Notifications ---------- */
  function iosNeedsInstall() { return U.isIOS() && !U.isStandalone(); }
  function enableNotifs() {
    if (!PUSH_ON) return Promise.resolve("nokey");
    if (iosNeedsInstall()) { toast(t("iosInstall"), { ms: 8000 }); return Promise.resolve("ios"); }
    return window.PUSH.enable(rpc, CFG.VAPID_PUBLIC_KEY).then(function (res) {
      if (res === "on") { toast(t("notifOn")); if (lastLoc) window.PUSH.setLocation(rpc, lastLoc.lat, lastLoc.lng, true); }
      else if (res === "denied") toast(t("notifDenied"), { err: true, ms: 6000 });
      else if (res === "nokey") toast(t("notifNoKey"), { err: true });
      else toast(t("notifUnsupported"), { err: true });
      return res;
    }).catch(function (e) { toast(errMsg(e), { err: true }); return "error"; });
  }
  function askNotifSheet() {
    if (U.ls.get("olnu.notifAsked", "") === "1") return;
    openSheet(t("notifAskTitle"), function (body) {
      body.appendChild(el("p", { text: t("notifAskText") }));
      notifPromptOnce(body);
    });
  }
  function notifPromptOnce(container) {
    if (!PUSH_ON || !window.PUSH.supported()) return;
    if (U.ls.get("olnu.notifAsked", "") === "1") return;
    U.ls.set("olnu.notifAsked", "1");
    var box = el("div", { class: "info", style: "margin-top:14px" });
    if (iosNeedsInstall()) {
      box.appendChild(el("p", { html: "<b>" + U.esc(t("notif")) + "</b>" }));
      box.appendChild(el("p", { text: t("iosInstall") }));
    } else {
      box.appendChild(el("p", { html: "<b>" + U.esc(t("notif")) + "?</b>" }));
      box.appendChild(el("div", { class: "row" }, [
        btn(t("notNow"), "btn-small", function () { box.remove(); }),
        btn(t("yes"), "btn-small btn-green", function () { box.remove(); enableNotifs(); })
      ]));
    }
    (container || $("sheet-body")).appendChild(box);
  }

  /* ---------- Invite friends + install guide ---------- */
  function inviteLink() { return location.origin + location.pathname + "?invite=1"; }
  function showInvite() {
    openSheet(t("inviteTitle"), function (body) {
      var link = inviteLink();
      body.appendChild(el("p", { text: t("inviteText") }));
      var qr = el("div", { class: "qr", "aria-hidden": "true" });
      body.appendChild(qr);
      try {
        if (window.QRCode) new window.QRCode(qr, { text: link, width: 184, height: 184, colorDark: "#0b1030", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
        else qr.remove();
      } catch (e) { qr.remove(); }
      body.appendChild(el("p", { class: "muted", style: "text-align:center;word-break:break-all", text: link }));
      var row = el("div", { class: "row", style: "margin-top:8px" }, [btn(t("copy"), "", function () { copyText(t("inviteShare") + " " + link); })]);
      if (navigator.share) {
        row.appendChild(btn("📲 " + t("share"), "btn-amber", function () {
          navigator.share({ title: "Öl Nu", text: t("inviteShare"), url: link }).catch(function () {});
        }));
      }
      body.appendChild(row);
      body.appendChild(el("p", { class: "muted", style: "margin-top:10px", text: t("inviteHint") }));
    });
  }
  function inAppBrowser() {
    var ua = navigator.userAgent || "";
    return /FBAN|FBAV|FB_IAB|Instagram|Snapchat|Line\/|Messenger|TikTok|musical_ly|LinkedInApp|Twitter/i.test(ua);
  }
  function showInstallGuide() {
    if (U.isStandalone()) return;
    if ($("install-banner")) $("install-banner").hidden = true;
    openSheet(t("guideTitle"), function (body) {
      var ol = function (items) {
        var list = el("ol", { class: "guide-steps" });
        items.forEach(function (x) { list.appendChild(el("li", { html: x })); });
        return list;
      };
      if (inAppBrowser()) {
        body.appendChild(el("p", { html: "<b>" + U.esc(t("guideInApp")) + "</b>" }));
        body.appendChild(ol([U.esc(t("guideInApp1")), U.esc(U.isIOS() ? t("guideInApp2ios") : t("guideInApp2and"))]));
        body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [btn(t("copy"), "btn-amber btn-block", function () { copyText(inviteLink()); })]));
        // Flyttlänk: opening it in Safari/Chrome brings this account (name, groups) along.
        if (LIVE && storedAuth() && !movedState) {
          body.appendChild(el("p", { class: "muted", style: "margin-top:12px", text: t("flyttInAppHelp") }));
          body.appendChild(el("div", { class: "row", style: "margin-top:6px" }, [btn(t("flyttInApp"), "btn-block", function () {
            var code = prepareExport("inapp"); if (code) copyFlytt(flyttLink(code));
          })]));
          body.appendChild(el("p", { class: "muted", style: "font-size:12px", text: t("flyttSecret") }));
        }
      } else if (U.isIOS()) {
        var steps = ol([t("guideIos1"), t("guideIos2"), t("guideIos3"), t("guideIos4")]);
        if (LIVE && storedAuth() && !movedState) {
          // Step 1: put the account in the URL (iOS may keep it as the start URL) and on the clipboard
          // (the home-screen app asks for it). The move finishes when this page comes back (finishExport).
          steps.setAttribute("start", "2");   // the steps stay visible: a new friend must see them at once
          var box = el("div", { class: "flytt-step" });
          box.appendChild(el("p", { html: "1. " + t("flyttIos1") }));
          var prep = btn(t("flyttPrep"), "btn-amber btn-block", function () {
            var code = prepareExport("home"); if (!code) return;
            try { history.replaceState(null, "", location.pathname + "?flytt=" + code + location.hash); } catch (e) {}
            copyFlytt(flyttLink(code));   // inside the tap: iOS allows the clipboard only here
            prep.disabled = true; prep.textContent = t("flyttPrepped");
            skip.hidden = true; steps.hidden = false;
          });
          var skip = el("button", { type: "button", class: "flytt-skip", text: t("flyttSkip"), onclick: function () { skip.hidden = true; steps.hidden = false; } });
          box.appendChild(prep);
          box.appendChild(el("p", { class: "muted", style: "font-size:12px;margin:8px 0 0", text: t("flyttSecret") }));
          body.appendChild(box);
          body.appendChild(skip);
        }
        body.appendChild(steps);
        var arrow = el("div", { class: "guide-arrow", "aria-hidden": "true", text: "⬇" });
        document.body.appendChild(arrow);
        var obs = new MutationObserver(function () { if ($("sheet").hidden) { arrow.remove(); obs.disconnect(); } });
        obs.observe($("sheet"), { attributes: true, attributeFilter: ["hidden"] });
      } else if (deferredPrompt) {
        body.appendChild(el("p", { text: t("guideAndroidOne") }));
        body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [btn("📲 " + t("guideInstallBtn"), "btn-amber btn-block", function () {
          var dp = deferredPrompt; if (!dp) return;
          dp.prompt();
          Promise.resolve(dp.userChoice).catch(function () {}).then(function () { deferredPrompt = null; hideInstallBanner(); closeSheet(); });
        })]));
      } else if (/Android/i.test(navigator.userAgent || "")) {
        body.appendChild(ol([t("guideAnd1"), t("guideAnd2"), t("guideAnd3")]));
      } else {
        body.appendChild(el("p", { text: t("guideDesktop") }));
        var qr = el("div", { class: "qr", "aria-hidden": "true" });
        body.appendChild(qr);
        try { if (window.QRCode) new window.QRCode(qr, { text: inviteLink(), width: 184, height: 184, colorDark: "#0b1030", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M }); else qr.remove(); } catch (e) { qr.remove(); }
      }
      body.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn(t("guideLater"), "btn-block", closeSheet)]));
    });
  }

  /* ---------- Settings ---------- */
  function showSettings() {
    openSheet(t("settings"), function (body) {
      body.appendChild(el("div", { class: "row", style: "margin-bottom:10px" }, [btn("📲 " + t("inviteBtn"), "btn-amber btn-block", showInvite)]));
      if (!U.isStandalone()) body.appendChild(el("div", { class: "row", style: "margin-bottom:10px" }, [btn("🏠 " + t("guideTitle"), "btn-block", showInstallGuide)]));
      if (!LIVE) body.appendChild(el("div", { class: "info", text: t("soonInfo") }));
      if (LIVE && myBeer()) body.appendChild(el("div", { class: "row", style: "margin-bottom:10px" }, [btn(t("hidePin"), "btn-block", showStopSheet)]));
      body.appendChild(el("h3", { text: t("yourName") }));
      var inp = el("input", { class: "inp", id: "set-name", maxlength: "30", value: getName(), autocomplete: "nickname", enterkeyhint: "done", "aria-label": t("yourName"), placeholder: t("namePh") });
      var saveName = function () {
        var n = validName(inp.value); if (!n) { toast(t("nameNeeded"), { err: true }); return; }
        U.ls.set("olnu.name", n);
        rpc("set_display_name", { p_display_name: n }).then(function (r) {
          if (r.error) toast(errMsg(r.error), { err: true }); else toast(t("nameSaved"));
        });
      };
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") saveName(); });
      body.appendChild(el("p", { class: "muted", text: t("nameHint") }));
      body.appendChild(el("div", { style: "display:flex;gap:8px" }, [inp, btn(t("save"), "btn-amber", saveName)]));

      body.appendChild(el("h3", { text: t("language") }));
      var seg = el("div", { class: "seg", role: "radiogroup", style: "flex-direction:row;width:max-content" });
      ["sv", "en"].forEach(function (l) {
        seg.appendChild(el("button", { type: "button", role: "radio", "aria-checked": String(I.lang === l), style: "min-width:72px;min-height:48px",
          text: l.toUpperCase(), onclick: function () { I.set(l); applyStaticText(); render(); showSettings(); } }));
      });
      body.appendChild(seg);

      if (PUSH_ON) {
      body.appendChild(el("h3", { text: t("notifications") }));
      var sw = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": "false", "aria-label": t("notif") });
      var row = el("div", { class: "toggle-row" }, [el("span", { text: t("notif") }), sw]);
      body.appendChild(row);
      if (iosNeedsInstall()) body.appendChild(el("div", { class: "info", text: t("iosInstall") }));
      window.PUSH.current().then(function (sub) { sw.setAttribute("aria-checked", String(!!sub)); });
      sw.addEventListener("click", function () {
        var on = sw.getAttribute("aria-checked") === "true";
        if (on) {
          window.PUSH.disable(rpc).then(function () { sw.setAttribute("aria-checked", "false"); toast(t("notifOff")); })
            .catch(function (e) { toast(errMsg(e), { err: true }); });
        } else {
          enableNotifs().then(function (res) { sw.setAttribute("aria-checked", String(res === "on")); });
        }
      });
      }

      body.appendChild(el("h3", { text: t("sound") }));
      var snd = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(!window.FX.muted()), "aria-label": t("soundLabel") });
      snd.addEventListener("click", function () {
        var on = snd.getAttribute("aria-checked") === "true";
        window.FX.setMuted(on); snd.setAttribute("aria-checked", String(!on));
        if (!on) { window.FX.unlock(); window.FX.sound.clink(); }
      });
      body.appendChild(el("div", { class: "toggle-row" }, [el("span", { text: t("soundLabel") }), snd]));

      mods("settingsSheet", body);   // ghost mode, badges, night summary, SOS

      if (LIVE) {
        body.appendChild(el("h3", { text: t("flyttSection") }));
        var fr = el("div", { class: "row" });
        if (storedAuth() && !movedState) fr.appendChild(btn(t("flyttBtn"), "btn-block", showFlyttExport));
        fr.appendChild(btn(t("flyttImportBtn"), "btn-block btn-small", showFlyttImport));
        body.appendChild(fr);
      }

      body.appendChild(el("div", { class: "row", style: "margin-top:14px" }, [btn(t("showIntro"), "btn-small", function () {
        closeSheet(); showIntro(true);
      })]));

      if (window.PRIVACY) {
        if (LIVE) window.PRIVACY.homeBlock(body);
        body.appendChild(el("h3", { text: t("about") }));
        body.appendChild(el("p", { text: t("privacy") }));
        body.appendChild(el("div", { class: "row", style: "margin-bottom:8px" }, [btn(t("privBtn"), "btn-block", function () { window.PRIVACY.showPrivacy(showSettings); })]));
        if (LIVE && authed) body.appendChild(el("div", { class: "row", style: "margin-bottom:8px" }, [btn(t("delBtn"), "btn-block btn-danger btn-small", window.PRIVACY.showDelete)]));
      } else {
        body.appendChild(el("h3", { text: t("about") }));
        body.appendChild(el("p", { text: t("privacy") }));
      }
      body.appendChild(el("p", { class: "muted", text: t("aboutMore") }));

      // Version + force update
      var ver = el("span", { class: "muted", text: t("version") + " …" });
      if (window.caches && caches.keys) {
        caches.keys().then(function (ks) {
          var k = ks.filter(function (x) { return x.indexOf("olnu-") === 0; })[0];
          ver.textContent = t("version") + " " + (k ? k.replace("olnu-", "") : "–");
        }).catch(function () { ver.textContent = t("version") + " –"; });
      } else { ver.textContent = t("version") + " –"; }
      body.appendChild(el("div", { class: "toggle-row", style: "margin-top:10px" }, [ver, btn(t("updateNow"), "btn-small", forceUpdate)]));
    });
  }
  function forceUpdate() {
    toast(t("updating"));
    var jobs = [];
    if (window.caches && caches.keys) jobs.push(caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k.indexOf("olnu-") === 0 && k !== "olnu-pending"; }).map(function (k) { return caches.delete(k); }));
    }));
    // Do NOT unregister the service worker: that also deletes the push subscription (notifications turned
    // themselves off). Ask it to fetch the newest sw.js instead; the new one takes over on reload.
    if ("serviceWorker" in navigator) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
      return Promise.all(rs.map(function (r) { return r.update().catch(function () {}); }));
    }));
    // Also refresh the browser HTTP cache (max-age=600 on GitHub Pages), else the reload can get old files.
    // The list is sw.js's own SHELL (one list for both), plus the files the page loaded now.
    jobs.push(fetch("./sw.js", { cache: "reload" }).then(function (r) { return r.text(); }).then(function (txt) {
      var m = txt.match(/var SHELL = \[([\s\S]*?)\];/), list = [];
      if (m) list = (m[1].match(/"([^"]+)"/g) || []).map(function (x) { return x.slice(1, -1); });
      document.querySelectorAll("script[src], link[rel=stylesheet][href]").forEach(function (n) {
        var u = n.getAttribute("src") || n.getAttribute("href") || "";
        if (u.indexOf("./") === 0 && list.indexOf(u) < 0) list.push(u);
      });
      if (!list.length) list = ["./", "./index.html", "./app.js", "./styles.css"];
      return Promise.all(list.map(function (u) { return fetch(u, { cache: "reload" }).catch(function () {}); }));
    }).catch(function () {}));
    Promise.all(jobs).catch(function () {}).then(function () {
      var u = location.pathname + "?v=" + Date.now() + location.hash;
      location.replace(u);
    });
  }
  $("btn-settings").addEventListener("click", showSettings);

  /* ---------- Install hint ---------- */
  var deferredPrompt = null;
  function showInstallBanner(kind) {
    if (U.isStandalone() || Date.now() - (+U.ls.get("olnu.installSeen", "0") || 0) < 864e5) return;
    var b = $("install-banner"), go = $("install-go");
    if (kind === "ios") { $("install-text").textContent = t("iosInstall"); go.hidden = true; }
    else { $("install-text").textContent = t("installAndroid"); go.textContent = t("install"); go.hidden = false; }
    b.hidden = false;
  }
  function hideInstallBanner() { $("install-banner").hidden = true; U.ls.set("olnu.installSeen", String(Date.now())); }
  $("install-close").addEventListener("click", hideInstallBanner);
  $("install-go").addEventListener("click", function () {
    if (!deferredPrompt) { hideInstallBanner(); return; }
    deferredPrompt.prompt();
    Promise.resolve(deferredPrompt.userChoice).catch(function () {}).then(function () { deferredPrompt = null; hideInstallBanner(); });
  });
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferredPrompt = e; showInstallBanner("android"); });
  window.addEventListener("appinstalled", hideInstallBanner);
  if (iosNeedsInstall()) setTimeout(function () { showInstallBanner("ios"); }, 1500);

  /* ---------- Service worker ---------- */
  if ("serviceWorker" in navigator) {
    // Auto-update: always check for a new sw.js, and reload once when a new version takes over.
    var hadController = !!navigator.serviceWorker.controller;
    var reloading = false;
    var typing = function () {
      var a = document.activeElement;
      return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
    };
    var reloadNow = function () {
      if (reloading) return;
      // Wait while typing, posting a beer, a sheet / intro is open, a takeover is shown or the undo button is up.
      if (typing() || busy || !$("sheet").hidden || !$("intro").hidden || document.querySelector(".takeover") || undoEl) { setTimeout(reloadNow, 5000); return; }
      reloading = true; location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (hadController) reloadNow();   // first install: no reload needed
      hadController = true;
    });
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" }).then(function (reg) {
        var check = function () { reg.update().catch(function () {}); };
        document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
        setInterval(check, 10 * 60 * 1000);
      }).catch(function () {});
    });
  }

  /* ---------- Deep links ---------- */
  var params = new URLSearchParams(location.search);
  var joinCode = params.get("join");
  var focusId = params.get("focus");
  var invited = params.has("invite");
  var chatId = params.get("chat"), sosAt = params.get("sos");   // v9 push links
  var rallyId = params.get("rally"), rallyAns = params.get("answer");
  var barLink = params.get("bar");   // v12 krogtips / takeover push: open that bar
  if (focusId) pendingFocus = focusId;
  if (joinCode || focusId || invited || chatId || sosAt || rallyId || rallyAns || barLink) {
    params.delete("join"); params.delete("focus"); params.delete("invite"); params.delete("chat"); params.delete("sos"); params.delete("bar");
    params.delete("rally"); params.delete("answer");   // a reload must not answer again
    var qs = params.toString();
    try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); } catch (e) {}
  }

  /* ---------- Auth + start ---------- */
  // Anonymous sign-in. Retries 3 times (1 s, 3 s, 6 s), then shows a clear message with a retry button.
  var signingIn = null;
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function authRetryable(e) {
    return !!e && (e.name === "AuthRetryableFetchError" || navigator.onLine === false || e.status === 0 || /fetch|network/i.test(String(e.message || "")));
  }
  function trySignInOnce() {
    return Promise.resolve(client.auth.getSession()).then(function (res) {
      if (res && res.data && res.data.session) return res;
      // Token refresh failed on the network: try again later, do not make a new user.
      if (res && authRetryable(res.error)) throw res.error;
      // v14: this phone had an account (olnu.uid) but the session is gone: never make a new one silently.
      var ask = U.ls.get("olnu.uid", "") && !storedAuth() && !movedNow() ? askNewAccount() : Promise.resolve("new");
      return ask.then(function (choice) {
        if (choice !== "new") throw { message: "choice_" + choice, keep: true };
        U.ls.del("olnu.uid");
        return Promise.resolve(client.auth.signInAnonymously()).then(function (r) { if (r && r.error) throw r.error; return r; });
      });
    });
  }
  function signIn() {
    if (!client || movedState) return Promise.resolve();
    if (signingIn) return signingIn;
    toastClear("auth");
    var delays = [1000, 3000, 6000], attempt = 0;
    function go() {
      return trySignInOnce().catch(function (e) {
        if (e && e.keep) throw e;   // the user chose "later" / a flyttkod: no retries, no new account
        if (attempt >= delays.length) throw e;
        return wait(delays[attempt++]).then(go);
      });
    }
    signingIn = go().then(function () {
      authed = true;
      toastClear("auth");
      var uid = storedUid(); if (uid) U.ls.set("olnu.uid", uid);
      resumeNotify();
      if (PUSH_ON) window.PUSH.resync(rpc, CFG.VAPID_PUBLIC_KEY).then(function () { if (lastLoc) window.PUSH.setLocation(rpc, lastLoc.lat, lastLoc.lng); });
      startPoll();
      mods("onAuthed");
      return refresh();
    }).catch(function (e) {
      var m = String((e && e.message) || "");
      if (e && e.keep) { if (m === "choice_retry") setTimeout(signIn, 300); else if (m === "choice_later") toast(t("authFail"), { err: true, ms: 0, id: "auth", action: { label: t("retry"), fn: signIn } }); return; }
      var key = navigator.onLine === false ? "authOffline" : /anonymous/i.test(m) && /disabled/i.test(m) ? "authDisabled" : "authFail";
      toast(t(key), { err: true, ms: 0, id: "auth", action: { label: t("retry"), fn: signIn } });
    }).then(function () { signingIn = null; });
    return signingIn;
  }

  /* ---------- Flytta konto (flyttkod) ----------
     iPhone: a home-screen app has its own storage, separate from Safari. Android: an in-app browser
     (Messenger, Snapchat) has its own storage, separate from Chrome. Without help the user gets a new
     anonymous account there and loses name and groups.
     Code = base64url(JSON {v:1, rt: refresh token, u: user id, name, ls: {whitelisted olnu.* keys}}).
     Refresh tokens rotate, and Supabase revokes the whole session if an old token is used again.
     So after an export the source browser must never use that session again: we remove "olnu.auth"
     WITHOUT signOut (signOut would revoke the session on the server) and stop the auto refresh.
     The code is a login credential: never log it, never send it anywhere. */
  var AUTH_KEY = "olnu.auth";
  // Useful olnu.* keys that follow the account (most important first; big ones drop out to keep the code short).
  // Not moved: auth, bar caches, push state and "already asked" flags (the new app must ask again).
  var FLYTT_KEYS = ["lang", "prec", "intro", "locOk", "night", "checkin", "title", "badges", "ghostMode", "mute", "heat",
    "otherCd", "where", "comeAt", "nights", "records", "kingOf", "rallyHidden", "topTab", "nightlast", "barsEver", "nightlog"];
  var FLYTT_MAX = 900, FLYTT_HIDDEN_MS = 10000;
  var movedState = false, flyttHiddenAt = 0;
  function b64urlEnc(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function b64urlDec(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return decodeURIComponent(escape(atob(s))); }
  function storedAuth() {
    var a = U.ls.getJSON(AUTH_KEY, null);
    return a && typeof a === "object" && a.refresh_token ? a : null;
  }
  function storedUid() { var a = storedAuth(); return a && a.user && a.user.id ? String(a.user.id) : ""; }
  function makeFlyttCode() {
    var a = storedAuth(); if (!a) return null;
    var p = { v: 1, rt: String(a.refresh_token), u: storedUid() || null, name: getName() || null, ls: {} };
    var code = b64urlEnc(JSON.stringify(p));
    FLYTT_KEYS.forEach(function (k) {
      var v = U.ls.get("olnu." + k, null);
      if (v == null || v === "") return;
      p.ls[k] = v;
      var c = b64urlEnc(JSON.stringify(p));
      if (c.length > FLYTT_MAX) delete p.ls[k]; else code = c;
    });
    return code;
  }
  // Accepts a raw code or a whole link with ?flytt= / #flytt=. Returns the payload or null.
  function readFlytt(text) {
    try {
      var s = String(text || "").trim(), m = s.match(/flytt=([A-Za-z0-9_-]+)/);
      s = (m ? m[1] : s).replace(/[^A-Za-z0-9_-]/g, "");
      if (s.length < 16 || s.length > 6000) return null;
      var p = JSON.parse(b64urlDec(s));
      if (!p || p.v !== 1 || typeof p.rt !== "string" || p.rt.length < 6 || p.rt.length > 600) return null;
      return p;
    } catch (e) { return null; }
  }
  function flyttLink(code) { return location.origin + location.pathname + "?flytt=" + code; }
  // Codes already tried in this browser (a short hash, never the token). A home-screen app that kept
  // ?flytt= in its start URL must not try the same (used) token on every launch.
  function rtHash(rt) { var h = 5381; for (var i = 0; i < rt.length; i++) h = ((h * 33) ^ rt.charCodeAt(i)) >>> 0; return h.toString(36); }
  function flyttTried(rt) { var l = U.ls.getJSON("olnu.flyttUsed", []); return Array.isArray(l) && l.indexOf(rtHash(rt)) >= 0; }
  function flyttMark(rt) {
    var l = U.ls.getJSON("olnu.flyttUsed", []); if (!Array.isArray(l)) l = [];
    if (l.indexOf(rtHash(rt)) < 0) l.push(rtHash(rt));
    U.ls.setJSON("olnu.flyttUsed", l.slice(-8));
  }
  function urlFlyttCode() {
    try {
      var q = new URLSearchParams(location.search).get("flytt");
      if (q) return q;
      var m = String(location.hash || "").match(/flytt=([A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }
  function cleanUrl() {
    var ps = new URLSearchParams(location.search); ps.delete("flytt");
    var qs = ps.toString(), h = String(location.hash || "").replace(/[#&]?flytt=[A-Za-z0-9_-]*/, "");
    if (h === "#") h = "";
    return location.pathname + (qs ? "?" + qs : "") + h;
  }
  function stripFlytt() { try { history.replaceState(null, "", cleanUrl()); } catch (e) {} }
  function stopRefresh() { try { if (client && client.auth && client.auth.stopAutoRefresh) Promise.resolve(client.auth.stopAutoRefresh()).catch(function () {}); } catch (e) {} }

  // --- Import (new app / phone) ---
  // Resolves "ok" | "same" | "tried" | "bad" | "net". Never touches the old session on failure.
  function importFlytt(p) {
    if (!client || !p) return Promise.resolve("bad");
    var cur = storedUid();
    if (cur && p.u && cur === String(p.u)) return Promise.resolve("same");
    if (flyttTried(p.rt)) return Promise.resolve("tried");
    var backup = U.ls.get(AUTH_KEY, null);
    var restore = function () { if (backup && !U.ls.get(AUTH_KEY, null)) U.ls.set(AUTH_KEY, backup); };
    return new Promise(function (resolve) {
      var done = false, tm = setTimeout(function () { done = true; restore(); resolve("net"); }, RPC_TIMEOUT_MS);
      var fin = function (v) { if (done) return; done = true; clearTimeout(tm); resolve(v); };
      Promise.resolve(client.auth.refreshSession({ refresh_token: p.rt })).then(function (r) {
        if (r && r.data && r.data.session && !r.error) {
          flyttMark(p.rt);
          var ls = p.ls && typeof p.ls === "object" ? p.ls : {};
          FLYTT_KEYS.forEach(function (k) { if (typeof ls[k] === "string") U.ls.set("olnu." + k, ls[k]); });
          if (validName(p.name)) U.ls.set("olnu.name", validName(p.name));
          ["olnu.moved", "olnu.movedTo", "olnu.movedU", "olnu.flyttPending"].forEach(U.ls.del);
          U.ls.set("olnu.flyttAsked", "1");
          fin("ok"); return;
        }
        // A failed refresh makes supabase-js drop the session it had: put the old one back.
        restore();
        var e = r && r.error;
        if (authRetryable(e)) { fin("net"); return; }
        flyttMark(p.rt); fin("bad");
      }, function (e) { restore(); fin(authRetryable(e) ? "net" : "bad"); });
    });
  }
  // After a good import: start again clean, so every module reads the moved settings.
  function reloadAfterImport(p) {
    try { sessionStorage.setItem("olnu.flyttOk", validName(p.name) || "-"); } catch (e) {}
    location.replace(cleanUrl());
  }
  function flyttResultToast(res, hadAccount) {
    if (res === "bad") toast(hadAccount ? t("flyttBad") : t("flyttBadNew"), { err: true, ms: 8000, id: "flytt" });
    else if (res === "net") toast(t("flyttNet"), { err: true, ms: 8000, id: "flytt" });
    else if (res === "same") toast(t("flyttSame"), { id: "flytt" });
  }
  // A code from the URL (link, QR, or the start URL of an iOS home-screen app).
  function runUrlImport(p) {
    stripFlytt();
    if (!p) { toast(t("flyttBadNew"), { err: true, ms: 8000, id: "flytt" }); return Promise.resolve(); }
    var had = !!storedAuth();
    return importFlytt(p).then(function (res) {
      if (res === "ok") { reloadAfterImport(p); return new Promise(function () {}); }   // page reloads
      if (res !== "tried" && res !== "same") flyttResultToast(res, had);
    });
  }
  // Paste box: clipboard button (read inside the tap) + a text field fallback.
  function flyttPasteUI(box, replacing) {
    var inp = el("input", { class: "inp", id: "flytt-inp", autocomplete: "off", autocapitalize: "off", autocorrect: "off",
      spellcheck: "false", enterkeyhint: "go", placeholder: t("flyttInputPh"), "aria-label": t("flyttInputPh") });
    var busyNow = false;
    var go = function (text) {
      if (busyNow) return;
      var p = readFlytt(text);
      if (!p) { toast(t("flyttBadFormat"), { err: true, id: "flytt" }); form.hidden = false; return; }
      busyNow = true; pb.disabled = true; gob.disabled = true;
      importFlytt(p).then(function (res) {
        busyNow = false; pb.disabled = false; gob.disabled = false;
        if (res === "ok") { reloadAfterImport(p); return; }
        flyttResultToast(res === "tried" ? "bad" : res, true);
        form.hidden = false;
      });
    };
    var gob = btn(t("flyttGo"), "btn-green btn-block", function () { go(inp.value); });
    var form = el("div", { class: "flytt-paste", hidden: "" }, [inp, gob]);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(inp.value); });
    var pb = btn(t("flyttPaste"), "btn-amber btn-block", function () {
      var show = function () { form.hidden = false; setTimeout(function () { inp.focus(); }, 50); };
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (s) {
          if (readFlytt(s)) go(s); else { toast(t("flyttPasteFail"), { id: "flytt" }); show(); }
        }, function () { toast(t("flyttPasteFail"), { id: "flytt" }); show(); });
      } else show();
    });
    if (replacing) box.appendChild(el("p", { class: "muted", text: t("flyttReplace") }));
    box.appendChild(pb);
    box.appendChild(form);
  }
  // First start of a home-screen app with no account: offer to bring the old one.
  function askFlytt() {
    return new Promise(function (resolve) {
      var root = $("intro"), body = $("intro-body");
      body.innerHTML = "";
      body.classList.add("flytt-card");
      body.appendChild(el("div", { class: "intro-big", text: "📲" }));
      body.appendChild(el("h2", { class: "intro-h", text: t("flyttAskTitle") }));
      body.appendChild(el("p", { class: "intro-p", text: t("flyttAskText") }));
      var box = el("div");
      flyttPasteUI(box, false);
      body.appendChild(box);
      body.appendChild(btn(t("flyttNo"), "btn-block btn-ghost intro-later", function () {
        U.ls.set("olnu.flyttAsked", "1");
        root.hidden = true; body.innerHTML = ""; body.classList.remove("flytt-card");
        resolve();
      }));
      body.appendChild(el("p", { class: "intro-priv", text: t("flyttSecret") }));
      root.hidden = false;
    });
  }

  // --- Export (this browser hands the account over) ---
  function flyttPendingNow() { return !!U.ls.getJSON("olnu.flyttPending", null); }
  // Step 1 for the iOS guide and the in-app browser: make the code, keep using this session for now
  // (Safari must stay open to add the app), but never refresh it again. Finished later (finishExport).
  function prepareExport(kind) {
    var code = makeFlyttCode();
    if (!code) { toast(t("flyttNoAcc"), { err: true, id: "flytt" }); return null; }
    stopRefresh();
    U.ls.setJSON("olnu.flyttPending", { at: Date.now(), kind: kind, u: storedUid() });
    return code;
  }
  // This browser lets go of the account: no signOut (it would revoke the session for the new app too).
  function finishExport(kind, atBoot) {
    var pend = U.ls.getJSON("olnu.flyttPending", null) || {};
    stopRefresh();
    var u = storedUid() || pend.u || "";
    U.ls.del(AUTH_KEY); U.ls.del(AUTH_KEY + "-code-verifier"); U.ls.del(AUTH_KEY + "-user"); U.ls.del("olnu.uid");
    U.ls.set("olnu.moved", String(Date.now()));
    U.ls.set("olnu.movedTo", kind || pend.kind || "other");
    if (u) U.ls.set("olnu.movedU", u);
    U.ls.del("olnu.flyttPending");
    movedState = true; authed = false; stopPoll();
    if (!atBoot) { beers = []; checkins = []; render(); }
  }
  function clearMoved() { ["olnu.moved", "olnu.movedTo", "olnu.movedU"].forEach(U.ls.del); movedState = false; }
  function movedNow() { return !!U.ls.get("olnu.moved", "") && !storedAuth(); }
  // Called by rpc(): true = do not call the server. A pending export finishes before the access token
  // runs out, because supabase-js would then refresh it and burn the token the new app needs.
  function flyttGuard() {
    if (movedState) return true;
    var pend = U.ls.getJSON("olnu.flyttPending", null);
    if (!pend) return false;
    var a = storedAuth();
    if (!a || !a.expires_at || a.expires_at * 1000 - Date.now() < 60000) {
      finishExport(pend.kind, false);
      showMoved().then(signIn);
      return true;
    }
    return false;
  }
  // Back after the user left this page for ≥ 10 s (opened the home-screen app / Chrome): finish the move.
  // (called by the visibilitychange handler of the poll, before it polls)
  function flyttOnVisible() {
    var pend = U.ls.getJSON("olnu.flyttPending", null);
    if (pend && flyttHiddenAt && Date.now() - flyttHiddenAt >= FLYTT_HIDDEN_MS && !movedState) {
      finishExport(pend.kind, false);
      showMoved().then(signIn);
      return true;
    }
    return movedState;
  }
  // Full-screen notice. Resolves when the user picks "Fortsätt här ändå" (fresh anonymous account).
  var movedShowing = null;
  function showMoved() {
    if (movedShowing) return movedShowing;
    movedState = true;
    var kind = U.ls.get("olnu.movedTo", "other");
    movedShowing = new Promise(function (resolve) {
      if (!$("sheet").hidden) { if (sheetCur && !sheetCur.lock) sheetCur.onClose = null; closeSheet("replaced"); }
      var root = $("intro"), body = $("intro-body");
      body.innerHTML = "";
      body.classList.add("flytt-card");
      var home = kind === "home";
      body.appendChild(el("div", { class: "intro-big", text: "📲" }));
      body.appendChild(el("h2", { class: "intro-h", text: home ? t("flyttMovedHome") : t("flyttMovedOther") }));
      body.appendChild(el("p", { class: "intro-p", html: "<b>" + U.esc(home ? t("flyttMovedHome2") : t("flyttMovedOther2")) + "</b>" }));
      if (home && U.isIOS() && !U.isStandalone()) body.appendChild(el("p", { class: "intro-p muted", text: t("flyttMovedHome3") }));
      body.appendChild(btn(t("flyttStay"), "btn-block btn-ghost intro-later", function () {
        clearMoved(); stripFlytt();
        root.hidden = true; body.innerHTML = ""; body.classList.remove("flytt-card");
        movedShowing = null;
        resolve();
      }));
      body.appendChild(el("p", { class: "intro-priv", text: t("flyttStayNote") }));
      root.hidden = false;
    });
    return movedShowing;
  }
  // Settings: confirm, then make the code, log this browser out (no signOut) and show QR + link.
  function showFlyttExport() {
    openSheet(t("flyttTitle"), function (body) {
      body.appendChild(el("div", { class: "info flytt-warn", html: "<b>" + U.esc(t("flyttWarn")) + "</b>" }));
      body.appendChild(el("p", { class: "muted", text: t("flyttSecret") }));
      var go = btn(t("flyttConfirm"), "btn-amber", function () {
        var code = makeFlyttCode();
        if (!code) { toast(t("flyttNoAcc"), { err: true, id: "flytt" }); return; }
        go.disabled = true;
        stopRefresh();
        // This phone must not get the moved account's pushes any more (max 3 s, errors ignored).
        var unsub = PUSH_ON && window.PUSH.supported() ? Promise.race([window.PUSH.disable(rpc).catch(function () {}), wait(3000)]) : Promise.resolve();
        unsub.then(function () {
          finishExport("other", false);
          showFlyttCode(code);
        });
      });
      body.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn(t("cancel"), "", showSettings), go]));
    });
  }
  function showFlyttCode(code) {
    var link = flyttLink(code);
    openSheet(t("flyttTitle"), function (body) {
      body.appendChild(el("p", { text: t("flyttQrHelp") }));
      var qr = el("div", { class: "qr", "aria-hidden": "true" });
      body.appendChild(qr);
      try {
        if (window.QRCode) new window.QRCode(qr, { text: link, width: 232, height: 232, colorDark: "#0b1030", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.L });
        else qr.remove();
      } catch (e) { qr.remove(); }
      body.appendChild(el("p", { class: "flytt-link", text: link }));
      var row = el("div", { class: "row", style: "margin-top:8px" }, [btn(t("flyttCopy"), "btn-amber", function () { copyFlytt(link); })]);
      if (navigator.share) row.appendChild(btn("📲 " + t("share"), "", function () { navigator.share({ title: "Öl Nu", url: link }).catch(function () {}); }));
      body.appendChild(row);
      body.appendChild(el("p", { class: "muted", style: "margin-top:10px", text: t("flyttSecret") }));
      body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [btn(t("flyttDone"), "btn-block", function () { closeSheet(); })]));
    }, { now: true, onClose: function () { showMoved().then(signIn); } });
  }
  function copyFlytt(text) {
    var done = function () { toast(t("flyttCopied"), { id: "flytt" }); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { if (fallbackCopy(text)) done(); });
    } else if (fallbackCopy(text)) done();
  }
  function showFlyttImport() {
    openSheet(t("flyttImportBtn"), function (body) {
      body.appendChild(el("p", { text: t("flyttAskText") }));
      flyttPasteUI(body, !!storedAuth());
      body.appendChild(el("p", { class: "muted", style: "margin-top:10px", text: t("flyttSecret") }));
    });
  }
  // Runs once before sign-in. Order matters: a pending export ends BEFORE the client exists
  // (its start-up could refresh the token), and an import happens BEFORE anonymous sign-in.
  function flyttBoot() {
    if (!LIVE) return Promise.resolve();
    var pend = U.ls.getJSON("olnu.flyttPending", null);
    if (pend && storedAuth()) finishExport(pend.kind, true);
    else if (pend) U.ls.del("olnu.flyttPending");
    makeClient();
    if (!client) return Promise.resolve();
    if (U.ls.get("olnu.moved", "") && storedAuth()) clearMoved();
    var code = urlFlyttCode(), p = code ? readFlytt(code) : null;
    var step = Promise.resolve();
    if (code) {
      // The source browser keeps its own code in the URL (iOS may use it as the home-screen start URL).
      var own = movedNow() && p && p.u && String(p.u) === U.ls.get("olnu.movedU", "");
      if (!own) step = runUrlImport(p);
    }
    return step.then(function () {
      if (movedNow()) return showMoved();
      movedState = false;
      if (U.isStandalone() && !storedAuth() && U.ls.get("olnu.flyttAsked", "") !== "1") return askFlytt();
    });
  }
  function makeClient() {
    if (client) return;
    try {
      client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_KEY }
      });
    } catch (e) { client = null; }
  }

  /* ---------- First start (shown once) ---------- */
  var INTRO_KEY = "olnu.intro", AGE_KEY = "olnu.age18";
  function introDone() { return U.ls.get(INTRO_KEY, "") === "1"; }
  function ageOk() { return U.ls.get(AGE_KEY, "") === "1"; }
  // v14 🔞: users who saw the intro before the age question get it once.
  function showAgeOnce() {
    return new Promise(function (resolve) {
      var root = $("intro"), body = $("intro-body");
      function stepAsk() {
        body.innerHTML = "";
        var cb = el("input", { type: "checkbox", id: "age-cb" });
        var go = btn(t("introGo"), "btn-amber btn-block", function () {
          if (!cb.checked) { toast(t("ageNeeded"), { err: true, id: "age" }); return; }
          U.ls.set(AGE_KEY, "1"); toastClear("age");
          root.hidden = true; body.innerHTML = ""; resolve();
        });
        go.disabled = true;
        cb.addEventListener("change", function () { go.disabled = !cb.checked; });
        body.appendChild(el("div", { class: "intro-big", text: "🔞" }));
        body.appendChild(el("h2", { class: "intro-h", text: t("ageTitle") }));
        body.appendChild(el("p", { class: "intro-p", text: t("ageText") }));
        body.appendChild(el("label", { class: "age-row", for: "age-cb" }, [cb, el("span", { text: t("age18") })]));
        body.appendChild(go);
        if (window.PRIVACY) body.appendChild(el("button", { type: "button", class: "intro-privlink", text: t("privBtn"), onclick: function () {
          body.innerHTML = "";
          var box = el("div", { class: "intro-privtext" });
          window.PRIVACY.fillPrivacy(box, null);
          body.appendChild(el("h2", { class: "intro-h", text: t("privTitle") }));
          body.appendChild(box);
          body.appendChild(btn(t("back"), "btn-block btn-amber", stepAsk));
        } }));
      }
      stepAsk();
      root.hidden = false;
    });
  }
  function showIntro(again) {
    return new Promise(function (resolve) {
      var root = $("intro"), body = $("intro-body");
      function close() { root.hidden = true; body.innerHTML = ""; resolve(); }
      function stepAge() {
        body.innerHTML = "";
        var steps = el("ol", { class: "intro-steps" }, [
          el("li", {}, [el("span", { class: "is-n", text: "1" }), el("span", { text: t("intro1") })]),
          el("li", {}, [el("span", { class: "is-n", text: "2" }), el("span", { text: t("intro2") })]),
          el("li", {}, [el("span", { class: "is-n", text: "3" }), el("span", { text: t("intro3") })])
        ]);
        var cb = el("input", { type: "checkbox", id: "age-cb" });
        var go = btn(t("introGo"), "btn-amber btn-block", function () {
          if (!cb.checked) { toast(t("ageNeeded"), { err: true, id: "age" }); return; }
          U.ls.set(INTRO_KEY, "1"); U.ls.set(AGE_KEY, "1");
          toastClear("age");
          if (again || U.ls.get("olnu.locOk", "") === "1") close(); else stepLoc();
        });
        go.disabled = true;
        cb.addEventListener("change", function () { go.disabled = !cb.checked; });
        var langRow = el("div", { class: "intro-lang" });
        ["sv", "en"].forEach(function (l) {
          langRow.appendChild(el("button", { type: "button", class: "intro-lang-b", "aria-pressed": String(I.lang === l), text: l.toUpperCase(),
            onclick: function () { I.set(l); applyStaticText(); render(); stepAge(); } }));
        });
        body.appendChild(langRow);
        body.appendChild(el("div", { class: "intro-brand", text: "Öl Nu" }));
        body.appendChild(el("p", { class: "intro-tag", text: t("introTag") }));
        body.appendChild(steps);
        body.appendChild(el("label", { class: "age-row", for: "age-cb" }, [cb, el("span", { text: t("age18") })]));
        body.appendChild(go);
        body.appendChild(el("p", { class: "intro-priv", text: t("introPrivacy") }));
        if (window.PRIVACY) body.appendChild(el("button", { type: "button", class: "intro-privlink", text: t("privBtn"), onclick: stepPriv }));
      }
      // 🔒 Integritet inside the intro card (the intro covers the sheet layer).
      function stepPriv() {
        body.innerHTML = "";
        body.appendChild(el("h2", { class: "intro-h", text: t("privTitle") }));
        var box = el("div", { class: "intro-privtext" });
        window.PRIVACY.fillPrivacy(box, null);
        body.appendChild(box);
        body.appendChild(btn(t("back"), "btn-block btn-amber", stepAge));
      }
      function stepLoc() {
        body.innerHTML = "";
        body.appendChild(el("div", { class: "intro-big", text: "📍" }));
        body.appendChild(el("h2", { class: "intro-h", text: t("locTitle") }));
        body.appendChild(el("p", { class: "intro-p", text: t("locWhy") }));
        body.appendChild(el("p", { class: "intro-p muted", text: t("locWhy2") }));
        var allow = btn(t("locAllow"), "btn-amber btn-block", function () {
          allow.disabled = true;
          locate({ quiet: false }).then(close);
        });
        body.appendChild(allow);
        body.appendChild(btn(t("locLater"), "btn-block btn-ghost intro-later", close));
      }
      stepAge();
      root.hidden = false;
    });
  }

  function start() {
    U.ls.del("olnu.shot");   // shots were removed; drop the old timer
    mods("init", appApi());
    $("hud-x").addEventListener("click", function (e) {
      var b = e.target.closest("[data-hx]"); if (!b || b.disabled) return;
      setTimeout(function () { hudPanel(false); }, 0);
      if (b.getAttribute("data-hx") === "checkin") { var ci = myCheckin(); if (ci) flyTo(ci.lat, ci.lng, 17, null); return; }
      mods("hudClick", b.getAttribute("data-hx"), b);
    });
    // Design pass 2: the Ikväll pill opens the panel.
    (function () {
      var st = $("my-streak"), box = document.querySelector(".hud-left");
      st.setAttribute("role", "button"); st.setAttribute("tabindex", "0");
      st.setAttribute("aria-controls", "hud-x"); st.setAttribute("aria-expanded", "false");
      function toggle() { hudPanel(!box.classList.contains("open")); }
      st.addEventListener("click", toggle);
      st.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      document.addEventListener("pointerdown", function (e) { if (box.classList.contains("open") && !box.contains(e.target)) hudPanel(false); }, true);
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && box.classList.contains("open")) { hudPanel(false); st.focus(); } });
      map.on("movestart", function () { hudPanel(false); });
    })();
    // Right-edge map chips are icons only; the words stay for screen readers (social.js re-sets the ghost text).
    iconChip($("btn-heat")); iconChip($("btn-ghostpins"));
    // A splash on a chip inside the closed panel lands on the pill instead of the screen corner.
    if (window.FX && window.FX.splash && !window.FX.splash.__d2) {
      var sp = window.FX.splash;
      window.FX.splash = function (a, k) { if (a && !a.getClientRects().length) a = $("my-streak"); return sp(a, k); };
      window.FX.splash.__d2 = 1;
    }
    applyStaticText();
    applyOnline();
    // Bars load after the first poll: then also re-check the busiest bar in the chaos banner (no toast).
    window.BARS.init({ map: map, onChange: function () { render(); if (chaosRes) evalChaos(false); } });
    // Restaurant names for the feed: load after the map is up, then redraw the ticker.
    setTimeout(window.BARS.loadPlaces, 1500);
    // Places now load in tiles as the map moves: redraw the markers too, so a restaurant with a check-in or with
    // people (known only after its tile arrived) gets its marker.
    var placesRender = U.debounce(function () { render(); }, 300);
    window.BARS.onPlacesReady(function () { tickerKey = ""; newsDirty = true; renderTicker(); placesRender(); });
    // Flyttkod first (finish a pending export, import a code, or ask in a new home-screen app), then intro + sign-in.
    var boot;
    try { boot = flyttBoot(); } catch (e) { boot = Promise.resolve(); }
    Promise.resolve(boot).catch(function () {}).then(startRest);
  }
  function startRest() {
    try {
      var moved = sessionStorage.getItem("olnu.flyttOk");
      if (moved) { sessionStorage.removeItem("olnu.flyttOk"); toast(t("flyttOk", moved === "-" ? "" : moved), { ms: 6000, cls: "skal" }); }
    } catch (e) {}
    var intro = introDone() ? (ageOk() ? Promise.resolve() : showAgeOnce()) : showIntro(false);
    // Returning user who allowed location before: center on them quietly.
    if (introDone() && U.ls.get("olnu.locOk", "") === "1") locate({ quiet: true });
    else if (introDone() && navigator.permissions && navigator.permissions.query) {
      try {
        navigator.permissions.query({ name: "geolocation" }).then(function (p) {
          if (p && p.state === "granted") locate({ quiet: true });
        }, function () {});
      } catch (e) {}
    }
    var ready = Promise.resolve();
    if (LIVE) {
      makeClient();   // normally made in flyttBoot already
      ready = client ? signIn() : Promise.resolve(toast(t("authFail"), { err: true, ms: 0, id: "auth" }));
    }
    if (joinCode) {
      var c = U.cleanCode(joinCode);
      Promise.all([ready, intro]).then(function () {
        if (LIVE) showJoin(c); else toast(t("soonToast"), { id: "soon" });
      });
    }
    // Ask for notifications at start (not during a join link). The phone's own question only
    // appears after a tap on "Ja", because browsers need a user gesture.
    if (!joinCode) Promise.all([ready, intro]).then(function () {
      if (!U.isStandalone() && (invited || inAppBrowser() || Date.now() - (+U.ls.get("olnu.guideSeen", "0") || 0) > 864e5)) {
        U.ls.set("olnu.guideSeen", String(Date.now()));
        setTimeout(showInstallGuide, 900);
      } else setTimeout(function () {
        // v9: a deep-linked chat or last night's summary goes first; the notification question waits for next time.
        if (chatId || rallyId) return;
        if (!mods("onReadyShow")) startNotifAsk();
      }, 1200);
    });
    if (chatId) Promise.all([ready, intro]).then(function () { if (LIVE) mods("openChatLink", chatId); });
    if (rallyId && !chatId) Promise.all([ready, intro]).then(function () { if (LIVE) mods("openLink", rallyId, rallyAns); });
    if (sosAt) mods("showSosLink", sosAt);
    if (barLink && !chatId && !rallyId) Promise.all([ready, intro]).then(function () { openBarById(barLink, 0); });
  }
  // A tapped notification while the app is open: the service worker sends the link here.
  // Open exactly what the notification was about (chat, rally, bar, pin, SOS) without a reload.
  var lastOpenUrl = "", lastOpenAt = 0;
  function routeOpen(url) {
    if (!url || (url === lastOpenUrl && Date.now() - lastOpenAt < 4000)) return;
    lastOpenUrl = url; lastOpenAt = Date.now();
    try { caches.open("olnu-pending").then(function (cc) { return cc.delete("./__pending_open"); }).catch(function () {}); } catch (err) {}
    var q; try { q = new URL(url, location.href).searchParams; } catch (err) { return; }
    // Show exactly what the notification was about: nothing else may grab the screen.
    pendingFocus = null;
    try { map.closePopup(); } catch (err) {}
    if (!$("sheet").hidden) closeSheet();
    var c = q.get("chat"), r = q.get("rally"), b = q.get("bar"), f = q.get("focus"), so = q.get("sos"), st = q.get("status");
    if (st) { if (LIVE) mods("openStatusLink", st); }
    else if (c) { if (LIVE) mods("openChatLink", c); }
    else if (r) { if (LIVE) mods("openLink", r, q.get("answer")); }
    else if (b) openBarById(b, 0);
    else if (so) mods("showSosLink", so);
    else if (f) { pendingFocus = f; refresh(); }
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", function (e) {
    var d = e.data || {};
    if (d.type !== "olnu-open" || !d.url) return;
    try { if (e.ports && e.ports[0]) e.ports[0].postMessage("ok"); } catch (err) {}
    routeOpen(d.url);
  });
  // A notification tapped while this page was frozen in the background: pick it up when visible.
  function checkPendingOpen() {
    if (!window.caches || document.hidden) return;
    caches.open("olnu-pending").then(function (cc) { return cc.match("./__pending_open"); })
      .then(function (r) { return r ? r.text() : null; })
      .then(function (url) { if (url) routeOpen(url); }).catch(function () {});
  }
  document.addEventListener("visibilitychange", checkPendingOpen);
  setTimeout(checkPendingOpen, 1500);
  // v12: fly to a bar (bars.json id) and open its popup. Bars load async: retry for ~12 s.
  function openBarById(id, tries) {
    var bar = window.BARS.byId(String(id));
    if (!bar) { if (tries < 24) setTimeout(function () { openBarById(id, tries + 1); }, 500); return; }
    openBar(bar);
  }
  function openBar(bar) {
    if (!bar || !isFinite(bar.lat) || !isFinite(bar.lng)) return;
    if (!$("sheet").hidden) closeSheet();
    var opened = false, id = String(bar.id);
    var open = function () {
      if (opened) return; opened = true;
      var m = plainBarMarkers[id] || null;
      if (!m) hotLayer.eachLayer(function (x) { if (x.options.olnuKey === "h" + id) m = x; });
      if (m && m.getPopup()) { m.openPopup(); return; }
      var agg = window.BARS.assign(beers).perBar[id];
      L.popup({ offset: L.point(0, -10), className: "olnu-bar", autoPan: !sheetMode() }).setLatLng([bar.lat, bar.lng]).setContent(barPopup(bar, agg ? agg.beers : [])).openOn(map);
    };
    map.once("moveend", function () { setTimeout(open, 250); });
    map.flyTo([bar.lat, bar.lng], Math.max(map.getZoom(), 17), { duration: 0.9 });
    setTimeout(open, 2200);
  }
  // v9: what js/social.js and js/extras.js may use. Getters for state that changes.
  function appApi() {
    return {
      LIVE: LIVE, PUSH_ON: PUSH_ON, t: t, map: map, rpc: rpc, parseData: parseData, toast: toast, toastClear: toastClear,
      openSheet: openSheet, closeSheet: closeSheet, el: el, btn: btn, errMsg: errMsg, flyTo: flyTo, refresh: refresh,
      render: render, updateCounts: updateCounts, renderTicker: function () { tickerKey = ""; newsDirty = true; renderTicker(); },
      beers: function () { return beers; }, myBeer: myBeer, myNight: myNight, getName: getName, withName: withName,
      authed: function () { return authed; }, client: function () { return client; }, prec: function () { return prec; },
      center: chaosCenter, getPosition: getPosition, locError: locError, inSweden: inSweden, validPos: U.validPos, showGroups: showGroups,
      drinkFx: drinkFx, nightEnd: nightEnd, showStopSheet: showStopSheet, me: function () { return meState; },
      pollV2: function () { return pollV2 === "on"; },
      copyText: copyText, beerOnly: beerOnly, othersOn: function () { return othersState === "on"; },
      checkins: function () { return checkins; }, myCheckin: myCheckin, openBar: openBar, lastLoc: function () { return lastLoc; },
      setLastLoc: function (la, ln) { lastLoc = { lat: la, lng: ln }; },
      sheetOpen: function () { return !$("sheet").hidden; },
      // functions.invoke that always resolves to {data, error} (never rejects, max RPC_TIMEOUT_MS).
      invoke: function (name, body) {
        if (!client || !client.functions) return Promise.resolve({ data: null, error: { message: "no_client" } });
        return new Promise(function (resolve) {
          var done = false, tm = setTimeout(function () { done = true; resolve({ data: null, error: { message: "timeout" } }); }, RPC_TIMEOUT_MS);
          var fin = function (r) { if (done) return; done = true; clearTimeout(tm); resolve(r); };
          try {
            Promise.resolve(client.functions.invoke(name, body ? { body: body } : undefined))
              .then(function (r) { fin({ data: r ? parseData(r.data) : {}, error: r ? r.error : null }); }, function (e) { fin({ data: null, error: e || { message: "error" } }); });
          } catch (e) { fin({ data: null, error: e }); }
        });
      }
    };
  }
  function startNotifAsk() {
    if (!PUSH_ON || !authed || !window.PUSH.supported()) return;
    if (Notification.permission !== "default") return;          // already yes or no
    if ($("sheet") && !$("sheet").hidden) return;                // another sheet is open
    var last = +U.ls.get("olnu.notifAskAt", "0") || 0;
    if (Date.now() - last < 3 * 86400000) return;               // max once per 3 days
    U.ls.set("olnu.notifAskAt", String(Date.now()));
    U.ls.set("olnu.notifAsked", "");                             // let the prompt box show again
    askNotifSheet();
  }
  start();
})();
