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
  var POLL_MS = 30000, RPC_TIMEOUT_MS = 15000;
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
      b.onclick = function () { el.remove(); opts.action.fn(); };
      el.appendChild(b);
    }
    el.addEventListener("click", function (e) { if (e.target === el || e.target === span) el.remove(); });
    while (box.children.length > 2) box.firstChild.remove();
    box.appendChild(el);
    if (opts.ms !== 0) setTimeout(function () { el.remove(); }, opts.ms || 3800);
  }
  function toastClear(id) {
    document.querySelectorAll('#toasts [data-id="' + id + '"]').forEach(function (x) { x.remove(); });
  }

  /* ---------- Map ---------- */
  var map = L.map("map", {
    zoomControl: false, attributionControl: true, minZoom: 4, maxZoom: 19,
    maxBounds: MAX_BOUNDS, maxBoundsViscosity: 0.8, worldCopyJump: false, tap: true
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
  map.attributionControl.setPrefix(false);
  // Keep popups clear of the top HUD and the bottom dock.
  L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(10, 150), autoPanPaddingBottomRight: L.point(10, 240), maxWidth: 300 });

  map.createPane("bars"); map.getPane("bars").style.zIndex = 590;
  map.createPane("hotbars"); map.getPane("hotbars").style.zIndex = 650;

  var clusters = L.markerClusterGroup({
    showCoverageOnHover: false, spiderfyOnMaxZoom: true, maxClusterRadius: 50, disableClusteringAtZoom: 18,
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
  var hotLayer = L.layerGroup().addTo(map);
  var barLayer = L.layerGroup().addTo(map);

  /* ---------- Heat glow (leaflet.heat). Its canvas goes in overlayPane (z 400), under the marker pane (z 600). ---------- */
  var HEAT_KEY = "olnu.heat";
  var heatOn = U.ls.get(HEAT_KEY, "1") !== "0";
  var heat = null;
  // Fix leaflet.heat 0.2.0 zoom drift on Leaflet 1.9: its _animateZoom uses the old
  // pre-1.0 maths. Remember where the canvas was drawn, then scale it from that spot.
  if (L.HeatLayer && !L.HeatLayer.prototype._olnuFixed) {
    var HP = L.HeatLayer.prototype, origReset = HP._reset;
    HP._reset = function () {
      // The library sets transform-origin 50% 50%; Leaflet's zoom maths needs 0 0.
      if (this._canvas) { this._canvas.style.transformOrigin = "0 0"; this._canvas.style.webkitTransformOrigin = "0 0"; }
      origReset.call(this);
      this._nw0 = this._map.containerPointToLatLng([0, 0]);
      this._z0 = this._map.getZoom();
    };
    HP._animateZoom = function (e) {
      var m = this._map;
      if (!this._canvas || !this._nw0) return;
      var scale = m.getZoomScale(e.zoom, this._z0);
      var pos = m._latLngToNewLayerPoint(this._nw0, e.zoom, e.center);
      L.DomUtil.setTransform(this._canvas, pos, scale);
    };
    HP._olnuFixed = true;
  }
  if (typeof L.heatLayer === "function") {
    heat = L.heatLayer([], {
      radius: 34, blur: 26, maxZoom: 11, max: 4, minOpacity: 0.25,
      gradient: { 0.1: "rgba(60,25,0,0)", 0.3: "#a85a08", 0.5: "#f5a623", 0.68: "#ff7a1a", 0.85: "#ff3b3b", 1.0: "#fff6e0" }
    });
  }
  // Pinch-zoom on phones fires "zoom" (not "zoomanim"): keep the heat glued to the map.
  map.on("zoom", function () {
    if (heat && map.hasLayer(heat) && !map._animatingZoom) {
      heat._animateZoom({ zoom: map.getZoom(), center: map.getCenter() });
    }
  });
  function heatWeight(b) {
    var n = b.beer_count | 0, l = U.level(n);
    var w = (n > 0 ? n * (l === 2 ? 3 : l === 1 ? 2 : 1) : 0) + shotCount(b) * 0.5;
    return Math.max(0.5, w);
  }
  // heatPoints: tonight's beers at the place each one was drunk (RPC heat_points, migration 0005).
  // null = not available (old database) → fall back to the live pins weighted by their count.
  var heatPoints = null, heatRpcMissing = false, heatFetchedAt = 0;
  function loadHeatPoints() {
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
  function renderHeat() {
    if (!heat) return;
    if (heatOn && !map.hasLayer(heat)) heat.addTo(map);
    if (!heatOn && map.hasLayer(heat)) map.removeLayer(heat);
    if (!heatOn) return;
    // Use the per-beer trail when the server has it; an empty trail with live pins means it is still filling.
    if (heatPoints && (heatPoints.length || !beers.length)) heat.setLatLngs(heatPoints);
    else heat.setLatLngs(beers.map(function (b) { return [b.lat, b.lng, heatWeight(b)]; }));
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
    applyHeatBtn(); heatFetchedAt = 0; loadHeatPoints(); renderHeat();
  });

  function lvlClass(l) { return l === 2 ? " medevac" : l === 1 ? " hot" : ""; }
  // Shots (v5): missing field = 0.
  function shotCount(b) { return Math.max(0, (b && b.shot_count) | 0); }
  function sumShots(list) { var s = 0; (list || []).forEach(function (b) { s += shotCount(b); }); return s; }
  // Single pin: compact pill "N 🍺" (+ " · M 🥃"). Streak shows only as the pill border.
  function beerIcon(b) {
    var sh = shotCount(b);
    var n = sh > 0 ? Math.max(0, b.beer_count | 0) : Math.max(1, b.beer_count | 0);
    var label = b.friend_name ? '<span class="bm-name">' + U.esc(b.friend_name) + "</span>" :
      b.is_mine ? '<span class="bm-name bm-me">' + U.esc(t("you")) + "</span>" : "";
    var html = U.pillHTML(n, U.level(n), { friend: !!b.friend_name, mine: !!b.is_mine, approx: !b.precise, label: label, shots: sh });
    return L.divIcon({ html: html, className: "", iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -12] });
  }
  function levelLine(l) {
    if (l === 2) return '<div class="pp-med">🚁 ' + U.esc(t("medevac")) + '</div><div class="pp-care">' + U.esc(t("care")) + "</div>";
    if (l === 1) return '<div class="pp-hot">🔥 ' + U.esc(t("hot")) + "</div>";
    return "";
  }
  function skalCount(b) { return Math.max(0, b.skal_count | 0); }
  function skalBtn(b, small) {
    var done = !!b.i_skaled;
    return '<button type="button" class="skal-btn' + (small ? " small" : "") + '" data-skal="' + U.esc(String(b.id)) + '"' +
      (done ? " disabled" : "") + ">" + U.esc(done ? t("skaled", skalCount(b)) : t("skal", skalCount(b))) + "</button>";
  }
  function beerPopup(b) {
    var sh = shotCount(b), bc = b.beer_count | 0;
    var h = '<div class="pp-title">' + U.esc(bc === 0 && sh > 0 ? t("shotsN", sh) : t("beerNo", bc)) + "</div>" +
      '<div class="pp-data">' + U.esc(t("since", U.timeHM(b.created_at))) + "</div>";
    if (sh > 0 && bc > 0) h += '<div class="pp-shot">' + U.esc(t("shotsN", sh)) + "</div>";
    h += levelLine(U.level(b.beer_count));
    if (b.is_mine) h += '<div class="pp-mine">' + U.esc(t("you")) + '</div><div class="pp-skal">' + U.esc(t("skalN", skalCount(b))) + "</div>";
    if (b.friend_name) h += '<div class="pp-friend">' + U.esc(b.friend_name) + "</div>";
    if (!b.precise) h += '<div class="pp-note">' + U.esc(t("approx")) + "</div>";
    if (!b.is_mine) h += skalBtn(b, false);
    return h;
  }
  function barTypeLabel(type) { var m = t("barTypes"); return m[type] || m.bar; }
  function maxLevel(list) { var l = 0; list.forEach(function (b) { l = Math.max(l, U.level(b.beer_count)); }); return l; }
  // Bar badge: compact pill "N 🍺" (N = people at the bar). Border = highest streak there.
  function hotBarIcon(agg) {
    var friend = agg.beers.some(function (b) { return b.friend_name; });
    var mine = agg.beers.some(function (b) { return b.is_mine; });
    var html = U.pillHTML(agg.beers.length, maxLevel(agg.beers), { friend: friend, mine: mine, cls: "p-bar", shots: sumShots(agg.beers) });
    return L.divIcon({ html: html, className: "", iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -12] });
  }
  function barPopup(bar, list) {
    list = list || [];
    var names = [];
    list.forEach(function (b) { if (b.friend_name && names.indexOf(b.friend_name) < 0) names.push(b.friend_name); });
    var h = '<div class="pp-title">' + U.esc(bar.name || t("unnamedBar")) + "</div>" +
      '<div class="muted">' + U.esc(barTypeLabel(bar.type)) + "</div>";
    if (list.length) h += '<div class="pp-data"><b>' + U.esc(t("barHere", list.length)) + "</b></div>";
    h += levelLine(maxLevel(list));
    if (names.length) h += '<div class="pp-friend">' + U.esc(t("barFriends")) + names.map(U.esc).join(", ") + "</div>";
    var tot = 0; list.forEach(function (b) { tot += skalCount(b); });
    if (tot) h += '<div class="pp-skal">' + U.esc(t("barSkal", tot)) + "</div>";
    var shTot = sumShots(list);
    if (shTot) h += '<div class="pp-shot">' + U.esc(t("barShots", shTot)) + "</div>";
    if (list.length) {
      var rows = list.slice().sort(function (a, b) { return (b.beer_count | 0) - (a.beer_count | 0); }).slice(0, 8);
      h += '<ul class="pp-list">' + rows.map(function (b) {
        var l = U.level(b.beer_count);
        return '<li><span class="pp-who' + (b.friend_name ? " f" : b.is_mine ? " m" : "") + '">' + U.esc(whoOf(b)) + "</span>" +
          '<span class="pp-n">' + ((b.beer_count | 0) === 0 && shotCount(b) ? "" : (b.beer_count | 0) + (l === 2 ? " 🚁" : l === 1 ? " 🔥" : " 🍺")) +
          (shotCount(b) ? ((b.beer_count | 0) ? " · " : "") + shotCount(b) + " 🥃" : "") + "</span>" +
          (b.is_mine ? '<span class="pp-skal">' + U.esc(t("skalN", skalCount(b))) + "</span>" : skalBtn(b, true)) + "</li>";
      }).join("") + "</ul>";
    }
    h += '<div class="pp-note">' + U.esc(t("barNote")) + "</div>";
    return h;
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
  function render() {
    var z = map.getZoom(), keep = openKey;
    redrawing = true;
    clusters.clearLayers(); hotLayer.clearLayers(); markerById = {}; hotBarIds = {};
    var split = z >= HOT_ZOOM ? window.BARS.assign(beers) : { perBar: {}, rest: beers };
    var ms = split.rest.map(function (b) {
      var l = U.level(b.beer_count);
      var m = L.marker([b.lat, b.lng], { icon: beerIcon(b), friend: !!b.friend_name, mine: !!b.is_mine, streak: l,
        zIndexOffset: (b.is_mine ? 900 : b.friend_name ? 500 : 0) + l * 300, keyboard: false, olnuKey: "b" + b.id });
      m.bindPopup(function () { return beerPopup(b); });
      markerById[b.id] = m;
      return m;
    });
    clusters.addLayers(ms);
    Object.keys(split.perBar).forEach(function (id) {
      var agg = split.perBar[id];
      hotBarIds[id] = true;
      var m = L.marker([agg.bar.lat, agg.bar.lng], { icon: hotBarIcon(agg), pane: "hotbars", keyboard: false,
        zIndexOffset: 1000 + agg.beers.length + maxLevel(agg.beers) * 500, olnuKey: "h" + id });
      m.bindPopup(function () { return barPopup(agg.bar, agg.beers); }, { pane: "popupPane" });
      m.addTo(hotLayer);
      agg.beers.forEach(function (b) { markerById[b.id] = m; });
    });
    renderPlainBars();
    redrawing = false;
    reopenPopup(keep);
    renderHeat();
    updateCounts();
    renderTicker();
  }
  function renderPlainBars() {
    var wasRedrawing = redrawing, keep = openKey;
    redrawing = true;
    barLayer.clearLayers(); plainBarMarkers = {};
    redrawing = wasRedrawing;
    if (map.getZoom() < BAR_ZOOM) return;
    var list = window.BARS.inBounds(map.getBounds().pad(0.15), MAX_PLAIN_BARS + 50);
    var n = 0;
    for (var i = 0; i < list.length && n < MAX_PLAIN_BARS; i++) {
      var bar = list[i];
      if (hotBarIds[bar.id]) continue;
      n++;
      (function (bar) {
        var m = L.marker([bar.lat, bar.lng], {
          pane: "bars", keyboard: false,
          icon: L.divIcon({ html: '<div class="bar-ico">' + U.GLASS_OUTLINE_SVG + "</div>", className: "", iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -10] })
        });
        m.options.olnuKey = "p" + bar.id;
        m.bindPopup(function () { return barPopup(bar, []); });
        m.addTo(barLayer);
        plainBarMarkers[bar.id] = m;
      })(bar);
    }
    if (!wasRedrawing && keep && keep.charAt(0) === "p") reopenPopup(keep);
  }
  var lastZoomBand = null;
  map.on("zoomend", function () {
    var z = map.getZoom(), band = z >= HOT_ZOOM ? 1 : 0;
    if (band !== lastZoomBand) { lastZoomBand = band; render(); } else renderPlainBars();
  });
  map.on("moveend", U.debounce(renderPlainBars, 150));
  lastZoomBand = map.getZoom() >= HOT_ZOOM ? 1 : 0;

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
  var tickerKey = "";
  function renderTicker() {
    var list = beers.filter(function (b) { return U.level(b.beer_count) > 0; })
      .sort(function (a, b) { return U.level(b.beer_count) - U.level(a.beer_count) || b.beer_count - a.beer_count; })
      .slice(0, 12);
    var items = list.map(function (b) {
      var who = whoOf(b), where = whereOf(b), n = b.beer_count | 0;
      var friend = b.friend_name ? " tk-friend" : "";
      return '<span class="tk-item' + friend + (U.level(n) === 2 ? " tk-med" : "") + '">' +
        U.esc(U.level(n) === 2 ? t("tickMed", who, where, n) : t("tickHot", who, where, n)) + "</span>";
    });
    var html = items.length ? items.join('<span class="tk-sep">///</span>') : '<span class="tk-item tk-quiet">' + U.esc(t("tickQuiet")) + "</span>";
    if (html === tickerKey) return;
    tickerKey = html;
    var track = $("ticker-track");
    // Duplicate content for a seamless loop.
    track.innerHTML = '<span class="tk-run">' + html + '</span>' + (items.length ? '<span class="tk-run" aria-hidden="true">' + html + "</span>" : "");
    track.classList.toggle("moving", items.length > 0);
    track.style.animationDuration = Math.max(14, items.length * 7) + "s";
  }
  var prevLevels = null;
  function streakAlerts() {
    var now = {};
    beers.forEach(function (b) { now[b.id] = U.level(b.beer_count); });
    if (prevLevels) {
      beers.forEach(function (b) {
        if (b.is_mine) return;
        var before = prevLevels[b.id] | 0, l = now[b.id];
        if (l > before) {
          var who = whoOf(b), where = whereOf(b);
          toast(l === 2 ? t("newMed", who, where) : t("newHot", who, where), { ms: 5000, cls: l === 2 ? "med" : "hot" });
        }
      });
    }
    prevLevels = now;
  }

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
  function doSkal(button) {
    var id = button.getAttribute("data-skal"), b = beerById(id);
    if (!b || b.i_skaled || button.disabled) return;
    window.FX.unlock();
    button.disabled = true; button.classList.add("busy");
    rpc("skal", { p_beer_id: b.id }).then(function (r) {
      button.classList.remove("busy");
      if (r.error) {
        var c = U.errCode(r.error);
        button.disabled = false;
        if (c === "own_beer") { toast(t("skalOwn"), { err: true }); button.disabled = true; }
        else if (c === "beer_not_found") { toast(t("skalGone"), { err: true }); refresh(); }
        else toast(errMsg(r.error), { err: true });
        return;
      }
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
  });

  /* ---------- Counts / chrome ---------- */
  function friendsDrinking() {
    var seen = {};
    beers.forEach(function (b) { if (b.friend_name) seen[b.id] = 1; });
    return Object.keys(seen).length;
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
    m.expires = d.expires_at ? new Date(d.expires_at).getTime() : U.next5am().getTime();
    if (accepted) {
      m.lastTap = Date.now();
      // Server without 0003 (no shot_count field) still has the old 15 min beer cooldown.
      if (!("shot_count" in d)) m.lastTap += 15 * 60 * 1000 - U.COOLDOWN_MS;
    }
    else if (d.wait_seconds > 0) m.lastTap = Date.now() + d.wait_seconds * 1000 - U.COOLDOWN_MS;
    U.ls.setJSON("olnu.night", m);
  }
  // Own shot state on the phone: {count, expires, lastTap}. Separate from the beer timer.
  var SHOT_KEY = "olnu.shot";
  function myShot() {
    var m = U.ls.getJSON(SHOT_KEY, null);
    if (!m || !m.expires || Date.now() > m.expires) return null;
    return m;
  }
  function saveShot(d, accepted) {
    var m = myShot() || {};
    m.count = d.shot_count | 0;
    m.expires = d.expires_at ? new Date(d.expires_at).getTime() : U.next5am().getTime();
    if (accepted) m.lastTap = Date.now();
    else if (d.wait_seconds > 0) m.lastTap = Date.now() + d.wait_seconds * 1000 - U.SHOT_COOLDOWN_MS;
    U.ls.setJSON(SHOT_KEY, m);
    // Keep the beer count on the phone in sync, without touching the beer timer.
    var n = myNight();
    if (n) { n.count = d.beer_count | 0; U.ls.setJSON("olnu.night", n); }
  }
  function updateCounts() {
    $("live-count").innerHTML = LIVE ? t("live", beers.length | 0) : t("soonLive");
    var f = friendsDrinking(), badge = $("groups-badge");
    badge.textContent = String(f); badge.hidden = f === 0;
    $("btn-groups").setAttribute("aria-label", t("groups") + (f ? " — " + t("friendsNow", f) : ""));
    var mine = myBeer();
    $("btn-stop").hidden = !mine;
    var night = myNight(), n = mine ? mine.beer_count | 0 : night ? night.count | 0 : 0;
    var shotSt = myShot(), shots = mine ? shotCount(mine) : shotSt ? shotSt.count | 0 : 0;
    var st = $("my-streak");
    if (n > 0 || shots > 0) {
      var l = U.level(n);
      st.hidden = false;
      st.className = "my-streak" + lvlClass(l);
      st.innerHTML = '<span class="ms-k">' + U.esc(t("tonight")) + ':</span> <b>' + n + "</b>" +
        (l === 2 ? ' 🚁 <span class="ms-tag">' + U.esc(t("medevac")) + "</span>" : l === 1 ? ' 🔥 <span class="ms-tag">' + U.esc(t("hot")) + "</span>" : " 🍺") +
        (shots > 0 ? ' <span class="ms-shot">· <b>' + shots + "</b> 🥃</span>" : "") +
        (mine ? ' <span class="ms-skal">· ' + U.esc(t("skalN", skalCount(mine))) + "</span>" : "");
    } else st.hidden = true;
  }
  function applyStaticText() {
    $("beer-label").textContent = t("beer");
    $("beer-sub").textContent = t("beerSub");
    $("shot-label").textContent = t("shot");
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
    $("btn-locate").title = t("locate");
    $("offline-text").textContent = t("offline");
    $("btn-top").setAttribute("aria-label", t("top"));
    $("btn-top").title = t("top");
    applyHeatBtn();
    applyPrec();
    updateCounts();
    tickerKey = ""; renderTicker();
    tickCooldown();
    tickShot();
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
  var loading = false, refreshAgain = false;
  function refresh() {
    // A poll is already running (e.g. right after a beer tap): run once more after it, so the new pin shows now.
    if (loading) { refreshAgain = true; return Promise.resolve(); }
    if (!LIVE || !authed) return Promise.resolve();
    if (document.visibilityState === "hidden") return Promise.resolve();
    loading = true;
    return rpc("live_beers").then(function (r) {
      if (r.error) throw r.error;
      beers = (r.data || []).filter(function (b) { return b && isFinite(b.lat) && isFinite(b.lng); });
      beers.forEach(function (b) {
        b.skal_count = Math.max(0, b.skal_count | 0); b.i_skaled = !!b.i_skaled;
        var mine = mySkals[b.id];
        if (mine != null && !b.is_mine) { b.i_skaled = true; if (b.skal_count < mine) b.skal_count = mine; }
      });
      render();
      loadHeatPoints();
      streakAlerts();
      skalAlert();
      toastClear("load");
      if (!firstLoadDone) { firstLoadDone = true; handleFocus(); }
    }).catch(function (e) {
      if (U.errCode(e) === "not_authenticated") { reauth(); return; }
      if (!firstLoadDone && navigator.onLine !== false) toast(t("loadFail"), { err: true, id: "load", ms: 0, action: { label: t("retry"), fn: refresh } });
    }).then(function () {
      loading = false;
      if (refreshAgain) { refreshAgain = false; refresh(); }
    });
  }
  // Poll only while the tab is visible. Hidden tab = no timer at all.
  var pollTimer = null;
  function startPoll() { if (!pollTimer && LIVE) pollTimer = setInterval(refresh, POLL_MS); }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { startPoll(); refresh(); tickCooldown(); tickShot(); }
    else stopPoll();
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
      if (clusters.hasLayer(m)) clusters.zoomToShowLayer(m, function () { m.openPopup(); });
      else m.openPopup();
    }, 350);
  }

  /* ---------- Error messages ---------- */
  function errMsg(e, fallback) {
    switch (U.errCode(e)) {
      case "outside_sweden": return t("outside");
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
    if (!LIVE || !client || reauthing) return;
    reauthing = true; authed = false;
    // Try to refresh the token first: signing out makes a NEW anonymous user and loses all groups.
    client.auth.refreshSession().then(function (r) {
      if (r && r.data && r.data.session && !r.error) return;
      // Network error (phone just woke up, bad signal): keep the session. A new anonymous
      // user would lose all groups and leave the old pin on the map.
      if (authRetryable(r && r.error)) return;
      return client.auth.signOut().catch(function () {});
    }).catch(function () {}).then(function () { return signIn(); })
      .then(function () { reauthing = false; });
  }

  /* ---------- Cooldown ---------- */
  var RING_LEN = 2 * Math.PI * 56;
  var cdTimer = null;
  function cooldownLeft() {
    var m = myNight();
    if (!m || !m.lastTap) return 0;
    return Math.max(0, m.lastTap + U.COOLDOWN_MS - Date.now());
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
      if (!cdTimer) cdTimer = setInterval(tickCooldown, 1000);
    } else {
      if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
      if (!busy) btnEl.disabled = false;
      $("beer-label").textContent = t("beer");
      $("beer-sub").textContent = t("beerSub");
      btnEl.removeAttribute("aria-label");
      ring.style.strokeDashoffset = String(RING_LEN);
    }
  }
  $("cd-ring").style.strokeDasharray = String(RING_LEN);

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
    meLayer.clearLayers();
    if (acc && acc < 2000) L.circle([lat, lng], { radius: acc, className: "me-acc", interactive: false, stroke: false }).addTo(meLayer);
    L.marker([lat, lng], { icon: L.divIcon({ html: '<div class="me-dot"></div>', className: "", iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false, keyboard: false }).addTo(meLayer);
  }
  function inSweden(lat, lng) { return lat >= SWEDEN[0][0] && lat <= SWEDEN[1][0] && lng >= SWEDEN[0][1] && lng <= SWEDEN[1][1]; }
  function locate(opts) {
    opts = opts || {};
    var b = $("btn-locate"); b.classList.add("busy");
    return getPosition({ enableHighAccuracy: !!opts.precise, timeout: 12000, maximumAge: 60000 }).then(function (pos) {
      var la = pos.coords.latitude, ln = pos.coords.longitude;
      showMe(la, ln, pos.coords.accuracy);
      if (inSweden(la, ln)) map.setView([la, ln], Math.max(opts.keepZoom ? map.getZoom() : 0, START_ZOOM), { animate: !!opts.animate });
      else if (!opts.quiet) toast(t("outside"), { ms: 5000 });
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
  }
  function levelToast(n) {
    if (n === 1) return t("lvl1");
    if (n === 5) return t("lvl5");
    if (n === 10) return t("lvl10");
    if (n > 10) return t("lvlMed", n);
    if (n > 5) return t("lvlHot", n);
    return t("lvlN", n);
  }
  $("btn-beer").addEventListener("click", function () {
    if (!LIVE) { toast(t("soonToast"), { id: "soon" }); return; }
    if (busy || cooldownLeft() > 0) return;
    if (navigator.onLine === false) { toast(t("offline"), { err: true, id: "off" }); return; }
    if (!authed) { toast(t("connecting"), { id: "auth" }); signIn(); return; }
    window.FX.unlock();
    window.FX.splash($("btn-beer"));
    window.FX.vibrate(20);
    setBusy(true);
    getPosition().then(function (pos) {
      return rpc("post_beer", { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_precise: prec === "exact" })
        .then(function (r) {
          if (r.error) { toast(errMsg(r.error, t("postFail")), { err: true, ms: 6000 }); return; }
          var d = parseData(r.data);
          if (d.accepted === false) {
            saveNight(d, false);
            toast(t("cooldownToast", U.mmss((d.wait_seconds | 0) * 1000)));
            return;
          }
          saveNight(d, true);
          var n = d.beer_count | 0, l = U.level(n);
          if (n === 10) window.FX.takeover(2, { title: t("medTitle"), sub: t("medSub"), hint: t("tapClose") });
          else if (n === 5) window.FX.takeover(1, { title: t("hotTitle"), sub: t("hotSub"), hint: t("tapClose") });
          else {
            toast(levelToast(n), { cls: l === 2 ? "med" : l === 1 ? "hot" : "" });
            window.FX.vibrate(l ? [40, 60, 40] : [30, 40, 60]);
          }
          window.FX.sound.beer();
          if (d.milestone != null) notifyGroup();
          if (isFinite(d.lat) && isFinite(d.lng)) {
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
  /* ---------- Shot button (v5) ---------- */
  var SHOT_RING = 2 * Math.PI * 21;
  var shotTimer = null, shotBusy = false;
  function shotLeft() {
    var m = myShot();
    if (!m || !m.lastTap) return 0;
    return Math.max(0, m.lastTap + U.SHOT_COOLDOWN_MS - Date.now());
  }
  function tickShot() {
    var b = $("btn-shot"), ring = $("shot-ring"), lab = $("shot-label");
    var left = LIVE ? shotLeft() : 0, on = left > 0;
    b.classList.toggle("cooldown", on);
    b.classList.toggle("soon", !LIVE);
    if (on) {
      lab.textContent = U.mmss(left);
      b.setAttribute("aria-label", t("shotNextIn") + " " + U.mmss(left));
      ring.style.strokeDashoffset = String(SHOT_RING * (1 - Math.min(1, left / U.SHOT_COOLDOWN_MS)));
      if (!shotTimer) shotTimer = setInterval(tickShot, 1000);
    } else {
      if (shotTimer) { clearInterval(shotTimer); shotTimer = null; }
      lab.textContent = t("shot");
      b.setAttribute("aria-label", t("shotAria"));
      ring.style.strokeDashoffset = String(SHOT_RING);
    }
    b.setAttribute("aria-disabled", String(on || !LIVE));
  }
  $("shot-ring").style.strokeDasharray = String(SHOT_RING);
  // post_shot not deployed yet → PostgREST 404 / PGRST202 "Could not find the function".
  function shotMissing(e) {
    if (!e) return false;
    var m = [e.code, e.message, e.details, e.hint, e.status].map(function (x) { return x == null ? "" : String(x); }).join(" ");
    return /PGRST202|post_shot|could not find the function|function .* does not exist|not found|\b404\b/i.test(m) &&
      !/outside_sweden|not_authenticated/.test(m);
  }
  function setShotBusy(v) { shotBusy = v; $("btn-shot").classList.toggle("busy", v); }
  $("btn-shot").addEventListener("click", function () {
    if (!LIVE) { toast(t("soonToast"), { id: "soon" }); return; }
    if (shotBusy) return;
    var left = shotLeft();
    if (left > 0) { toast(t("shotCooldown", U.mmss(left)), { id: "shotcd" }); return; }
    if (navigator.onLine === false) { toast(t("offline"), { err: true, id: "off" }); return; }
    if (!authed) { toast(t("connecting"), { id: "auth" }); signIn(); return; }
    window.FX.unlock();
    window.FX.vibrate(12);
    setShotBusy(true);
    getPosition().then(function (pos) {
      return rpc("post_shot", { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_precise: prec === "exact" })
        .then(function (r) {
          if (r.error) {
            if (shotMissing(r.error)) { toast(t("shotSoon"), { id: "shotsoon" }); return; }
            toast(errMsg(r.error, t("postFail")), { err: true, ms: 6000 });
            return;
          }
          var d = parseData(r.data);
          if (d.accepted === false) {
            saveShot(d, false);
            toast(t("shotCooldown", U.mmss((d.wait_seconds | 0) * 1000)), { id: "shotcd" });
            return;
          }
          saveShot(d, true);
          toast(t("shotNo", Math.max(1, d.shot_count | 0)), { cls: "shot" });
          window.FX.sound.shot();
          window.FX.vibrate([15, 30, 15]);
          $("btn-shot").classList.remove("pop"); void $("btn-shot").offsetWidth; $("btn-shot").classList.add("pop");
          if (isFinite(d.lat) && isFinite(d.lng)) map.setView([d.lat, d.lng], Math.max(map.getZoom(), 15));
          refresh();
        });
    }, locError).catch(function () { toast(t("postFail"), { err: true }); })
      .then(function () { setShotBusy(false); tickShot(); updateCounts(); });
  });

  $("btn-stop").addEventListener("click", function () {
    var sb = $("btn-stop"); if (sb.disabled) return;
    sb.disabled = true;
    rpc("stop_beer").then(function (r) {
      sb.disabled = false;
      if (r.error) { toast(errMsg(r.error), { err: true }); return; }
      toast(t("stopped"), { ms: 5000 }); refresh();
    });
  });

  /* ---------- Sheet ---------- */
  var sheetOnClose = null;
  function openSheet(title, build) {
    $("sheet-title").textContent = title;
    var body = $("sheet-body"); body.innerHTML = "";
    build(body);
    $("sheet").hidden = false; $("backdrop").hidden = false;
  }
  function closeSheet() {
    $("sheet").hidden = true; $("backdrop").hidden = true; $("sheet-body").innerHTML = "";
    var f = sheetOnClose; sheetOnClose = null; if (f) f();
  }
  $("sheet-close").addEventListener("click", closeSheet);
  $("backdrop").addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });

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
    var wrap = el("div", {}, [el("div", { style: "display:flex;align-items:center;gap:10px" }, [
      main,
      btn(t("show"), "btn-small", function () { showCode(g, false); }),
      btn(t("leave"), "btn-small btn-danger", function () {
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
      })
    ])]);
    li.appendChild(wrap);
    li.style.display = "block";
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
    map.flyTo([lat, lng], z, { duration: 1.2 });
    if (openId == null) return;
    map.once("moveend", function () {
      setTimeout(function () {
        var m = markerById[openId]; if (!m) return;
        if (clusters.hasLayer(m)) clusters.zoomToShowLayer(m, function () { m.openPopup(); }); else m.openPopup();
      }, 150);
    });
  }
  function topRows(kind) {
    if (kind === "bars") {
      var per = window.BARS.assign(beers).perBar;
      return Object.keys(per).map(function (k) { return per[k]; })
        .sort(function (a, b) { return b.beers.length - a.beers.length || maxLevel(b.beers) - maxLevel(a.beers); })
        .slice(0, 15).map(function (a) {
          var sk = 0; a.beers.forEach(function (b) { sk += skalCount(b); });
          var sh = sumShots(a.beers);
          return { name: a.bar.name || t("unnamedBar"), sub: barTypeLabel(a.bar.type) + (sh ? " · " + t("shotsN", sh) : "") + (sk ? " · " + t("skalN", sk) : ""),
            n: a.beers.length, icon: lvlIcon(maxLevel(a.beers)), lat: a.bar.lat, lng: a.bar.lng, z: 17,
            friend: a.beers.some(function (b) { return b.friend_name; }) };
        });
    }
    if (kind === "cities") {
      var g = {};
      beers.forEach(function (b) {
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
          var sh = sumShots(x.list);
          var avg = avgOf(x);
          var avgTxt = (Math.round(avg * 10) / 10).toString().replace(".", I.lang === "sv" ? "," : ".");
          return { name: x.name, sub: t("cityAvgSub", x.list.length, tot) + (sh ? " · " + sh + " 🥃" : ""), n: avgTxt + " 🍺/" + t("perPerson"), icon: lvlIcon(maxLevel(x.list)),
            lat: c ? c.lat : lat / x.list.length, lng: c ? c.lng : lng / x.list.length, z: c ? 12 : 7,
            friend: x.list.some(function (b) { return b.friend_name; }) };
        });
    }
    return beers.filter(function (b) { return U.level(b.beer_count) > 0; })
      .sort(function (a, b) { return (b.beer_count | 0) - (a.beer_count | 0); })
      .slice(0, 20).map(function (b) {
        return { name: whoOf(b), sub: placeLabel(b), n: b.beer_count | 0, icon: lvlIcon(U.level(b.beer_count)),
          lat: b.lat, lng: b.lng, z: 17, id: b.id, friend: !!b.friend_name, mine: !!b.is_mine };
      });
  }
  function showTop() {
    openSheet(t("top"), function (body) {
      var tabs = el("div", { class: "tabs", role: "tablist" });
      var list = el("ol", { class: "toplist" });
      var note = el("p", { class: "muted top-note" });
      var kinds = [["bars", t("topBars")], ["cities", t("topCities")], ["streaks", t("topStreaks")]];
      function draw() {
        tabs.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-k") === topTab)); });
        list.innerHTML = "";
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
    });
  }
  $("btn-top").addEventListener("click", showTop);

  /* ---------- Notifications ---------- */
  function iosNeedsInstall() { return U.isIOS() && !U.isStandalone(); }
  function enableNotifs() {
    if (!PUSH_ON) return Promise.resolve("nokey");
    if (iosNeedsInstall()) { toast(t("iosInstall"), { ms: 8000 }); return Promise.resolve("ios"); }
    return window.PUSH.enable(rpc, CFG.VAPID_PUBLIC_KEY).then(function (res) {
      if (res === "on") toast(t("notifOn"));
      else if (res === "denied") toast(t("notifDenied"), { err: true, ms: 6000 });
      else if (res === "nokey") toast(t("notifNoKey"), { err: true });
      else toast(t("notifUnsupported"), { err: true });
      return res;
    }).catch(function (e) { toast(errMsg(e), { err: true }); return "error"; });
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

  /* ---------- Settings ---------- */
  function showSettings() {
    openSheet(t("settings"), function (body) {
      if (!LIVE) body.appendChild(el("div", { class: "info", text: t("soonInfo") }));
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

      body.appendChild(el("div", { class: "row", style: "margin-top:14px" }, [btn(t("showIntro"), "btn-small", function () {
        closeSheet(); showIntro(true);
      })]));

      body.appendChild(el("h3", { text: t("about") }));
      body.appendChild(el("p", { text: t("privacy") }));
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
      return Promise.all(ks.filter(function (k) { return k.indexOf("olnu-") === 0; }).map(function (k) { return caches.delete(k); }));
    }));
    if ("serviceWorker" in navigator) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
      return Promise.all(rs.map(function (r) { return r.unregister(); }));
    }));
    // Also refresh the browser HTTP cache (max-age=600 on GitHub Pages), else the reload can get old files.
    ["./", "./index.html", "./sw.js", "./config.js", "./app.js", "./styles.css", "./js/i18n.js", "./js/util.js",
      "./js/bars.js", "./js/push.js", "./js/fx.js", "./js/cities.js"].forEach(function (u) {
      jobs.push(fetch(u, { cache: "reload" }).catch(function () {}));
    });
    Promise.all(jobs).catch(function () {}).then(function () {
      var u = location.pathname + "?v=" + Date.now() + location.hash;
      location.replace(u);
    });
  }
  $("btn-settings").addEventListener("click", showSettings);

  /* ---------- Install hint ---------- */
  var deferredPrompt = null;
  function showInstallBanner(kind) {
    if (U.isStandalone() || U.ls.get("olnu.installSeen", "") === "1") return;
    var b = $("install-banner"), go = $("install-go");
    if (kind === "ios") { $("install-text").textContent = t("iosInstall"); go.hidden = true; }
    else { $("install-text").textContent = t("installAndroid"); go.textContent = t("install"); go.hidden = false; }
    b.hidden = false;
  }
  function hideInstallBanner() { $("install-banner").hidden = true; U.ls.set("olnu.installSeen", "1"); }
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
      if (typing() || busy || shotBusy) { setTimeout(reloadNow, 5000); return; }
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
  if (focusId) pendingFocus = focusId;
  if (joinCode || focusId) {
    params.delete("join"); params.delete("focus");
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
      return Promise.resolve(client.auth.signInAnonymously()).then(function (r) { if (r && r.error) throw r.error; return r; });
    });
  }
  function signIn() {
    if (!client) return Promise.resolve();
    if (signingIn) return signingIn;
    toastClear("auth");
    var delays = [1000, 3000, 6000], attempt = 0;
    function go() {
      return trySignInOnce().catch(function (e) {
        if (attempt >= delays.length) throw e;
        return wait(delays[attempt++]).then(go);
      });
    }
    signingIn = go().then(function () {
      authed = true;
      toastClear("auth");
      if (PUSH_ON) window.PUSH.resync(rpc);
      startPoll();
      return refresh();
    }).catch(function (e) {
      var m = String((e && e.message) || "");
      var key = navigator.onLine === false ? "authOffline" : /anonymous/i.test(m) && /disabled/i.test(m) ? "authDisabled" : "authFail";
      toast(t(key), { err: true, ms: 0, id: "auth", action: { label: t("retry"), fn: signIn } });
    }).then(function () { signingIn = null; });
    return signingIn;
  }

  /* ---------- First start (shown once) ---------- */
  var INTRO_KEY = "olnu.intro";
  function introDone() { return U.ls.get(INTRO_KEY, "") === "1"; }
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
          U.ls.set(INTRO_KEY, "1");
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
    applyStaticText();
    applyOnline();
    window.BARS.init({ map: map, onChange: render });
    // Restaurant names for the feed: load after the map is up, then redraw the ticker.
    setTimeout(window.BARS.loadPlaces, 1500);
    window.BARS.onPlacesReady(function () { tickerKey = ""; renderTicker(); });
    var intro = introDone() ? Promise.resolve() : showIntro(false);
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
      try {
        client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "olnu.auth" }
        });
      } catch (e) { client = null; }
      ready = client ? signIn() : Promise.resolve(toast(t("authFail"), { err: true, ms: 0, id: "auth" }));
    }
    if (joinCode) {
      var c = U.cleanCode(joinCode);
      Promise.all([ready, intro]).then(function () {
        if (LIVE) showJoin(c); else toast(t("soonToast"), { id: "soon" });
      });
    }
  }
  start();
})();
