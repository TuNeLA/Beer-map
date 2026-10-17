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
    [window.SOCIAL, window.EXTRAS, window.RALLY].forEach(function (m) {
      if (!m || typeof m[fn] !== "function") return;
      try { var r = m[fn](a, b, c); if (typeof r === "string") out += r; } catch (e) { try { console.warn("olnu " + fn, e); } catch (x) {} }
    });
    return out;
  }
  // Pins with at least one beer (chaos, heat, counts and news stay beers only; v8 other-drink pins are left out).
  function beerOnly() { return beers.filter(function (b) { return (b.beer_count | 0) >= 1; }); }

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
    zoomControl: false, attributionControl: false, minZoom: 4, maxZoom: 19,
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
  L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(10, 150), autoPanPaddingBottomRight: L.point(10, 240), maxWidth: 300 });

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
    return Math.max(0.5, n * (l === 2 ? 3 : l === 1 ? 2 : 1));
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
    var bo = beerOnly();
    if (heatPoints && (heatPoints.length || !bo.length)) heat.setLatLngs(heatPoints);
    else heat.setLatLngs(bo.map(function (b) { return [b.lat, b.lng, heatWeight(b)]; }));
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
  // Single pin: compact pill "N 🍺". Streak shows only as the pill border.
  function beerIcon(b) {
    var oc = b.other_count | 0, n = oc ? Math.max(0, b.beer_count | 0) : Math.max(1, b.beer_count | 0);
    var label = b.friend_name ? '<span class="bm-name">' + U.esc(b.friend_name) + "</span>" :
      b.is_mine ? '<span class="bm-name bm-me">' + U.esc(t("you")) + "</span>" : "";
    var html = U.pillHTML(n, U.level(n), { friend: !!b.friend_name, mine: !!b.is_mine, approx: !b.precise, label: label, other: oc });
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
  function otherLine(b) {
    var oc = b.other_count | 0; if (!oc) return "";
    var k = (t("kindLow") || {})[b.other_kind] || (t("kindLow") || {}).annat || "";
    return '<div class="pp-other">' + U.esc(oc === 1 ? t("otherPlus", oc, k) : t("otherPlusMany", oc, k)) + "</div>";
  }
  function beerPopup(b) {
    var h = '<div class="pp-title">' + U.esc((b.beer_count | 0) >= 1 ? t("beerNo", b.beer_count | 0) : t("otherPin")) + "</div>" +
      '<div class="pp-data">' + U.esc(t("since", U.timeHM(b.created_at))) + "</div>";
    h += otherLine(b);
    h += levelLine(U.level(b.beer_count));
    if (b.is_mine) h += '<div class="pp-mine">' + U.esc(t("you")) + '</div><div class="pp-skal">' + U.esc(t("skalN", skalCount(b))) + "</div>";
    if (b.friend_name) h += '<div class="pp-friend">' + U.esc(b.friend_name) + "</div>";
    h += mods("beerTitleHTML", b);
    if (!b.precise) h += '<div class="pp-note">' + U.esc(t("approx")) + "</div>";
    if (!b.is_mine) h += skalBtn(b, false);
    h += mods("beerPopupHTML", b);
    return h;
  }
  function barTypeLabel(type) { var m = t("barTypes"); return m[type] || m.bar; }
  function maxLevel(list) { var l = 0; list.forEach(function (b) { l = Math.max(l, U.level(b.beer_count)); }); return l; }
  // Bar badge: compact pill "N 🍺" (N = people at the bar). Border = highest streak there.
  function hotBarIcon(agg) {
    var friend = agg.beers.some(function (b) { return b.friend_name; });
    var mine = agg.beers.some(function (b) { return b.is_mine; });
    var html = U.pillHTML(agg.beers.length, maxLevel(agg.beers), { friend: friend, mine: mine, cls: "p-bar",
      label: mods("barBadgeHTML", agg.bar, agg.beers, map.getZoom()) });
    return L.divIcon({ html: html, className: "", iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -12] });
  }
  function barPopup(bar, list) {
    list = list || [];
    var names = [];
    list.forEach(function (b) { if (b.friend_name && names.indexOf(b.friend_name) < 0) names.push(b.friend_name); });
    var h = '<div class="pp-title">' + U.esc(bar.name || t("unnamedBar")) + "</div>" +
      '<div class="muted">' + U.esc(barTypeLabel(bar.type)) + "</div>";
    if (list.length) h += '<div class="pp-data"><b>' + U.esc(t("barHere", list.length)) + "</b></div>";
    h += checkinHTML(bar);
    h += mods("barPopupHTML", bar, list);
    h += levelLine(maxLevel(list));
    if (names.length) h += '<div class="pp-friend">' + U.esc(t("barFriends")) + names.map(U.esc).join(", ") + "</div>";
    var tot = 0; list.forEach(function (b) { tot += skalCount(b); });
    if (tot) h += '<div class="pp-skal">' + U.esc(t("barSkal", tot)) + "</div>";
    if (list.length) {
      var rows = list.slice().sort(function (a, b) { return (b.beer_count | 0) - (a.beer_count | 0); }).slice(0, 8);
      h += '<ul class="pp-list">' + rows.map(function (b) {
        var l = U.level(b.beer_count);
        return '<li><span class="pp-who' + (b.friend_name ? " f" : b.is_mine ? " m" : "") + '">' + U.esc(whoOf(b)) + "</span>" +
          '<span class="pp-n">' + (b.beer_count | 0) + (l === 2 ? " 🚁" : l === 1 ? " 🔥" : " 🍺") + "</span>" +
          (b.is_mine ? '<span class="pp-skal">' + U.esc(t("skalN", skalCount(b))) + "</span>" : skalBtn(b, true)) + "</li>";
      }).join("") + "</ul>";
      if (list.length > 8 && bar.id != null) {
        h += '<button type="button" class="btn btn-small btn-block pp-all" data-crowd="' + U.esc(String(bar.id)) + '">' + U.esc(t("crowdAll", list.length)) + "</button>";
      }
    }
    h += '<div class="pp-note">' + U.esc(t("barNote")) + "</div>";
    return h;
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
      U.ls.setJSON(CI_KEY, { id: String(mine.bar_id), name: mine.bar_name, lat: +mine.lat, lng: +mine.lng, at: at, until: U.next5am().getTime() });
    }
  }
  function checkinsAt(bar) {
    var id = String(bar.id);
    return checkins.filter(function (c) { return String(c.bar_id) === id; });
  }
  // "📍 Incheckade här: Anton, Oskar + 2 till" + the big button (LIVE and signed in only).
  function checkinHTML(bar) {
    if (!LIVE || bar == null || bar.id == null) return "";
    ciBarById[String(bar.id)] = bar;
    var list = checkinsAt(bar), names = [], more = 0, h = "";
    list.forEach(function (c) {
      var n = c.is_mine ? (getName() || t("you")) : c.is_friend && c.name ? c.name : null;
      if (n && names.indexOf(n) < 0) names.push(n); else if (!n) more++;
    });
    if (names.length) h += '<div class="pp-ci">' + U.esc(t("ciHere", names, more)) + "</div>";
    else if (more) h += '<div class="pp-ci">' + U.esc(t("ciHereAnon", more)) + "</div>";
    if (!authed || checkinState === "missing") return h;
    var me = myCheckin(), here = me && me.id === String(bar.id);
    h += '<button type="button" class="ci-btn" data-ci="' + U.esc(String(bar.id)) + '"' + (here ? " disabled" : "") + ">" +
      U.esc(here ? t("ciDone") : t("ciBtn")) + "</button>";
    return h;
  }
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
        U.ls.setJSON(CI_KEY, { id: String(bar.id), name: d.bar_name || name, lat: +bar.lat, lng: +bar.lng, at: Date.now(), until: U.next5am().getTime() });
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
  function render() {
    var z = map.getZoom(), keep = openKey;
    redrawing = true;
    clusters.clearLayers(); hotLayer.clearLayers(); markerById = {}; hotBarIds = {};
    var split = z >= HOT_ZOOM ? window.BARS.assign(beers) : { perBar: {}, rest: beers };
    var ms = split.rest.map(function (b) {
      var l = U.level(b.beer_count);
      var m = L.marker([b.lat, b.lng], { icon: beerIcon(b), friend: !!b.friend_name, mine: !!b.is_mine, streak: l, beerId: b.id,
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
          icon: L.divIcon({ html: '<div class="bar-ico">' + U.GLASS_OUTLINE_SVG + mods("barIcoHTML", bar) + "</div>", className: "", iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -10] })
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
  // LIVE ticker = funny TV news feed (js/news.js). New headlines after each poll (or language change), not on map moves.
  var tickerKey = "", newsDirty = true, newsPrev = [];
  function renderTicker() {
    if (!newsDirty && tickerKey) return;
    newsDirty = false;
    var titles = null;
    try { titles = window.SOCIAL && window.SOCIAL.titlesByBeer ? window.SOCIAL.titlesByBeer() : null; } catch (e) { titles = null; }
    var items = window.NEWS ? window.NEWS.build(beerOnly(), { center: chaosCenter(), now: new Date(), prev: newsPrev, titles: titles,
      others: beers.filter(function (b) { return (b.other_count | 0) > 0; }), checkins: checkins }) : [];
    if (!items.length) items = [{ text: t("tickQuiet"), cls: "tk-quiet" }];
    newsPrev = items.map(function (x) { return x.text; });
    var chars = 0;
    var html = '<span class="tk-kick">' + U.esc(t("newsKick")) + "</span>" + items.map(function (x) {
      chars += x.text.length;
      return '<span class="tk-item' + (x.cls ? " " + x.cls : "") + '">' + U.esc(x.text) + "</span>";
    }).join('<span class="tk-sep">///</span>') + '<span class="tk-sep">///</span>';
    tickerKey = html;
    var track = $("ticker-track");
    // Duplicate content for a seamless loop.
    track.innerHTML = '<span class="tk-run">' + html + '</span><span class="tk-run" aria-hidden="true">' + html + "</span>";
    track.classList.add("moving");
    // About 55 px per second at 13 px font.
    track.style.animationDuration = Math.max(16, Math.round(chars * 0.13)) + "s";
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
    chaosHidden = { at: Date.now(), out: r.out | 0, hot: r.hot | 0, until: U.next5am().getTime() };
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
    root.querySelectorAll(".ci-btn").forEach(function (x) {
      x.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); doCheckin(x); });
    });
    root.querySelectorAll(".pp-all").forEach(function (x) {
      x.addEventListener("click", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var id = x.getAttribute("data-crowd"), agg = window.BARS.assign(beers).perBar[id];
        map.closePopup();
        if (agg && agg.beers.length) openCrowd(agg.beers, agg.bar);
      });
    });
  });

  /* ---------- Crowd list (many people at one spot) ---------- */
  // Me first, then friends, then most beers.
  function crowdSort(a, b) {
    var ra = a.is_mine ? 0 : a.friend_name ? 1 : 2, rb = b.is_mine ? 0 : b.friend_name ? 1 : 2;
    return ra - rb || (b.beer_count | 0) - (a.beer_count | 0) || (b.other_count | 0) - (a.other_count | 0) ||
      String(a.created_at || "").localeCompare(String(b.created_at || ""));
  }
  function crowdCountHTML(b) {
    var n = b.beer_count | 0, oc = b.other_count | 0, l = U.level(n), h = "";
    if (n > 0 || !oc) h += "<b>" + n + "</b> 🍺" + (l === 2 ? " 🚁" : l === 1 ? " 🔥" : "");
    if (oc) h += '<span class="cr-oc">' + (n > 0 ? "+" : "") + oc + " 🥃</span>";
    return h;
  }
  // bar: the bar these beers belong to (bar popup "Visa alla"), or null (cluster tap).
  function openCrowd(list, bar) {
    list = (list || []).slice().sort(crowdSort);
    if (!list.length) return;
    var tot = 0, oth = 0, fr = 0, lat = 0, lng = 0, allPrecise = true;
    list.forEach(function (b) {
      tot += b.beer_count | 0; oth += b.other_count | 0; if (b.friend_name) fr++;
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
        var l = U.level(b.beer_count);
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
    // The server's wait_seconds always wins. Without it (accepted tap) the local fallback is 10 min.
    var wait = d.wait_seconds | 0;
    if (wait > 0) m.lastTap = Date.now() + wait * 1000 - U.COOLDOWN_MS;
    else if (accepted) m.lastTap = Date.now();
    U.ls.setJSON("olnu.night", m);
  }
  function updateCounts() {
    $("live-count").innerHTML = LIVE ? t("live", beerOnly().length | 0) : t("soonLive");
    var f = friendsDrinking(), badge = $("groups-badge");
    badge.textContent = String(f); badge.hidden = f === 0;
    $("btn-groups").setAttribute("aria-label", t("groups") + (f ? " — " + t("friendsNow", f) : ""));
    var mine = myBeer();
    $("btn-stop").hidden = true; // Hidden from the dock (user asked). Still reachable in ⚙️ Inställningar.
    var night = myNight(), n = mine ? mine.beer_count | 0 : night ? night.count | 0 : 0;
    // Other drinks tonight: from the live pin, else the local count (pin hidden).
    var oc = mine ? mine.other_count | 0 : 0;
    try { if (window.EXTRAS && window.EXTRAS.otherTonight) oc = Math.max(oc, window.EXTRAS.otherTonight() | 0); } catch (e) {}
    var st = $("my-streak");
    if (n > 0 || oc > 0) {
      var l = U.level(n);
      st.hidden = false;
      st.className = "my-streak" + lvlClass(l);
      st.innerHTML = '<span class="ms-k">' + U.esc(t("tonight")) + ':</span> <b>' + n + "</b>" +
        (l === 2 ? ' 🚁 <span class="ms-tag">' + U.esc(t("medevac")) + "</span>" : l === 1 ? ' 🔥 <span class="ms-tag">' + U.esc(t("hot")) + "</span>" : " 🍺") +
        (oc ? ' <span class="ms-other">· ' + oc + " 🥃</span>" : "") +
        (mine ? ' <span class="ms-skal">· ' + U.esc(t("skalN", skalCount(mine))) + "</span>" : "");
    } else st.hidden = true;
    // v9 HUD chips (title, ghost, taxi, come here). Built by the modules; clicks go to mods("hudClick").
    var hx = $("hud-x"), chips = LIVE ? mods("hudChipsHTML", { mine: mine, n: n }) : "";
    var ci = LIVE ? myCheckin() : null;
    if (ci) chips += '<button type="button" class="hx-chip hx-ci" data-hx="checkin" aria-label="' + U.esc(t("ciChip", ci.name)) + '">📍 ' + U.esc(ci.name) + "</button>";
    if (hx.getAttribute("data-html") !== chips) { hx.innerHTML = chips; hx.setAttribute("data-html", chips); }
    hx.hidden = !chips;
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
  var loading = false, refreshAgain = false;
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
  function refresh() {
    // A poll is already running (e.g. right after a beer tap): run once more after it, so the new pin shows now.
    if (loading) { refreshAgain = true; return Promise.resolve(); }
    if (!LIVE || !authed || movedState) return Promise.resolve();
    if (document.visibilityState === "hidden") return Promise.resolve();
    loading = true;
    return Promise.all([rpc("live_beers"), fetchOthers(), fetchCheckins()]).then(function (res) {
      var r = res[0], others = res[1] || {};
      if (movedState) return;   // the account moved away while this poll ran
      if (r.error) throw r.error;
      // Pins: rows with a beer, or (v8) with another drink. Shots-only rows from an older app are not pins.
      beers = (r.data || []).filter(function (b) {
        if (!b || !isFinite(b.lat) || !isFinite(b.lng)) return false;
        var o = others[b.id];
        b.other_count = o ? Math.max(0, o.other_count | 0) : 0; b.other_kind = o ? o.other_kind || null : null;
        return (b.beer_count | 0) >= 1 || b.other_count >= 1;
      });
      beers.forEach(function (b) {
        b.skal_count = Math.max(0, b.skal_count | 0); b.i_skaled = !!b.i_skaled;
        var mine = mySkals[b.id];
        if (mine != null && !b.is_mine) { b.i_skaled = true; if (b.skal_count < mine) b.skal_count = mine; }
      });
      if (window.NEWS) window.NEWS.update(beers);
      newsDirty = true;
      render();
      loadHeatPoints();
      streakAlerts();
      evalChaos(true);
      skalAlert();
      toastClear("load");
      if (!firstLoadDone) { firstLoadDone = true; handleFocus(); }
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
      loading = false;
      if (refreshAgain) { refreshAgain = false; refresh(); }
    });
  }
  // Poll only while the tab is visible. Hidden tab = no timer at all.
  var pollTimer = null;
  function startPoll() { if (!pollTimer && LIVE) pollTimer = setInterval(refresh, POLL_MS); }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      if (flyttOnVisible()) return;   // back from the new app: the account moved, do not poll with the old token
      startPoll(); refresh(); tickCooldown();
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
    if (!LIVE || !client || reauthing || movedState || flyttPendingNow()) return;
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
    lastLoc = { lat: lat, lng: lng };
    if (PUSH_ON && authed) window.PUSH.setLocation(rpc, lat, lng);
    if (chaosRes) evalChaos(false);
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
  // "Var dricker du?" — sometimes asks which bar you are at, so the beer counts there.
  // Asks: on the first beer tonight, when you moved > 150 m since the last pick, or now and then (1 in 4).
  // Else it reuses the last picked bar while you stay within 150 m of where you picked it.
  // Close the sheet = use the real GPS position. A picked bar puts the pin on the bar.
  var WHERE_KEY = "olnu.where", WHERE_R = 400, WHERE_STAY = 150;
  function askWhere(pos) {
    var lat = pos.coords.latitude, lng = pos.coords.longitude;
    var real = { lat: lat, lng: lng, precise: prec === "exact" };
    // v10: fresh own check-in (< 3 h) and still within 150 m of it → drink there, no question.
    var ci = myCheckin();
    if (ci && Date.now() - ci.at < CI_FRESH_MS && U.haversine(lat, lng, ci.lat, ci.lng) <= CI_STAY_M) {
      return Promise.resolve({ lat: ci.lat, lng: ci.lng, precise: prec === "exact" });
    }
    var list = window.BARS && window.BARS.nearby ? window.BARS.nearby(lat, lng, WHERE_R, 6) : [];
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
        U.ls.setJSON(WHERE_KEY, { atLat: lat, atLng: lng, until: U.nightEnd ? U.nightEnd() : Date.now() + 6 * 3600e3,
          bar: bar ? { id: bar.id, name: bar.name, lat: bar.lat, lng: bar.lng } : null });
        sheetOnClose = null; closeSheet();
        resolve(bar ? { lat: bar.lat, lng: bar.lng, precise: true } : real);
      }
      openSheet(t("whereTitle"), function (body) {
        body.appendChild(el("p", { class: "muted", text: t("whereInfo") }));
        list.forEach(function (x, i) {
          var m = Math.round(x.d / 10) * 10;
          body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [
            btn("🍺 " + x.bar.name + "  · " + (m < 20 ? t("whereHere") : m + " m"), (i === 0 ? "btn-amber " : "") + "btn-block", function () { pick(x.bar); })
          ]));
        });
        body.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn("🏠 " + t("whereNone"), "btn-ghost btn-block", function () { pick(null); })]));
      });
      sheetOnClose = function () { if (!done) { done = true; resolve(real); } };
    });
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
    getPosition().then(askWhere).then(function (spot) {
      return rpc("post_beer", { p_lat: spot.lat, p_lng: spot.lng, p_precise: spot.precise })
        .then(function (r) {
          if (r.error) { toast(errMsg(r.error, t("postFail")), { err: true, ms: 6000 }); return; }
          var d = parseData(r.data);
          if (d.accepted === false) {
            saveNight(d, false);
            toast(t("cooldownToast", U.mmss((d.wait_seconds | 0) * 1000)));
            return;
          }
          saveNight(d, true);
          if (isFinite(d.lat) && isFinite(d.lng)) lastLoc = { lat: +d.lat, lng: +d.lng };
          var n = d.beer_count | 0, l = U.level(n);
          var ghost = !!(window.EXTRAS && window.EXTRAS.ghostOn && window.EXTRAS.ghostOn());
          var medExtra = n === 10 ? mods("medevacExtraHTML") : "";
          if (n === 10) window.FX.takeover(2, { title: t("medTitle"), sub: t("medSub"), hint: t("tapClose"), extraHTML: medExtra, ms: medExtra ? 7000 : 0 });
          else if (n === 5) window.FX.takeover(1, { title: t("hotTitle"), sub: t("hotSub"), hint: t("tapClose") });
          else {
            toast(levelToast(n), { cls: l === 2 ? "med" : l === 1 ? "hot" : "" });
            window.FX.vibrate(l ? [40, 60, 40] : [30, 40, 60]);
          }
          window.FX.sound.beer();
          // Spökläge: hide the pin at once and tell nobody. Else: server friend milestones + KAOS I STAN check.
          if (ghost) rpc("stop_beer").then(function () { refresh(); });
          else notifyGroup();
          mods("onBeerAccepted", d, { precise: prec === "exact", ghost: ghost });
          if (PUSH_ON) window.PUSH.setLocation(rpc, +d.lat, +d.lng);
          if (PUSH_ON && window.PUSH.supported() && Notification.permission === "default" && U.ls.get("olnu.notifAsked", "") !== "1") {
            setTimeout(function () { askNotifSheet(); }, 2200);
          }
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
  // "Sluta dricka": choose "Jag är hemma" or "Öltorsk". Both hide the pin; the group gets a fun push.
  function stopBeer(kind) {
    var sb = $("btn-stop"); if (sb.disabled) return;
    sb.disabled = true; closeSheet();
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
  $("btn-stop").addEventListener("click", function () {
    if ($("btn-stop").disabled) return;
    openSheet(t("stopTitle"), function (body) {
      body.appendChild(el("p", { class: "muted", text: t("stopInfo") }));
      body.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [btn("🏠 " + t("stopHome"), "btn-green btn-block", function () { stopBeer("home"); })]));
      body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [btn("🥀 " + t("stopPause"), "btn-amber btn-block", function () { stopBeer("pause"); })]));
      body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [btn(t("cancel"), "btn-block", closeSheet)]));
      mods("stopSheet", body);   // taxi + SOS
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
    mods("groupItem", g, wrap, main);   // chat button + tap for group status
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
          steps.setAttribute("start", "2"); steps.hidden = true;
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
      if (LIVE && myBeer()) body.appendChild(el("div", { class: "row", style: "margin-bottom:10px" }, [btn("🏠 " + t("stop"), "btn-block", function () { $("btn-stop").click(); })]));
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
    // Do NOT unregister the service worker: that also deletes the push subscription (notifications turned
    // themselves off). Ask it to fetch the newest sw.js instead; the new one takes over on reload.
    if ("serviceWorker" in navigator) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
      return Promise.all(rs.map(function (r) { return r.update().catch(function () {}); }));
    }));
    // Also refresh the browser HTTP cache (max-age=600 on GitHub Pages), else the reload can get old files.
    ["./", "./index.html", "./sw.js", "./config.js", "./app.js", "./styles.css", "./js/i18n.js", "./js/util.js",
      "./js/bars.js", "./js/push.js", "./js/fx.js", "./js/cities.js", "./js/chaos.js", "./js/news.js", "./js/social.js", "./js/extras.js", "./js/rally.js"].forEach(function (u) {
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
      if (typing() || busy) { setTimeout(reloadNow, 5000); return; }
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
  if (focusId) pendingFocus = focusId;
  if (joinCode || focusId || invited || chatId || sosAt || rallyId || rallyAns) {
    params.delete("join"); params.delete("focus"); params.delete("invite"); params.delete("chat"); params.delete("sos");
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
      return Promise.resolve(client.auth.signInAnonymously()).then(function (r) { if (r && r.error) throw r.error; return r; });
    });
  }
  function signIn() {
    if (!client || movedState) return Promise.resolve();
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
      if (PUSH_ON) window.PUSH.resync(rpc, CFG.VAPID_PUBLIC_KEY).then(function () { if (lastLoc) window.PUSH.setLocation(rpc, lastLoc.lat, lastLoc.lng); });
      startPoll();
      mods("onAuthed");
      return refresh();
    }).catch(function (e) {
      var m = String((e && e.message) || "");
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
    U.ls.del(AUTH_KEY); U.ls.del(AUTH_KEY + "-code-verifier"); U.ls.del(AUTH_KEY + "-user");
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
      if (!$("sheet").hidden) { sheetOnClose = null; closeSheet(); }
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
      body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [btn(t("flyttDone"), "btn-block", closeSheet)]));
    });
    sheetOnClose = function () { showMoved().then(signIn); };
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
    U.ls.del("olnu.shot");   // shots were removed; drop the old timer
    mods("init", appApi());
    $("hud-x").addEventListener("click", function (e) {
      var b = e.target.closest("[data-hx]"); if (!b || b.disabled) return;
      if (b.getAttribute("data-hx") === "checkin") { var ci = myCheckin(); if (ci) flyTo(ci.lat, ci.lng, 17, null); return; }
      mods("hudClick", b.getAttribute("data-hx"), b);
    });
    applyStaticText();
    applyOnline();
    // Bars load after the first poll: then also re-check the busiest bar in the chaos banner (no toast).
    window.BARS.init({ map: map, onChange: function () { render(); if (chaosRes) evalChaos(false); } });
    // Restaurant names for the feed: load after the map is up, then redraw the ticker.
    setTimeout(window.BARS.loadPlaces, 1500);
    window.BARS.onPlacesReady(function () { tickerKey = ""; newsDirty = true; renderTicker(); });
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
      if (!U.isStandalone() && (invited || inAppBrowser() || U.ls.get("olnu.guideSeen", "") !== "1")) {
        U.ls.set("olnu.guideSeen", "1");
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
  }
  // v9: what js/social.js and js/extras.js may use. Getters for state that changes.
  function appApi() {
    return {
      LIVE: LIVE, PUSH_ON: PUSH_ON, t: t, map: map, rpc: rpc, parseData: parseData, toast: toast, toastClear: toastClear,
      openSheet: openSheet, closeSheet: closeSheet, el: el, btn: btn, errMsg: errMsg, flyTo: flyTo, refresh: refresh,
      render: render, updateCounts: updateCounts, renderTicker: function () { tickerKey = ""; newsDirty = true; renderTicker(); },
      beers: function () { return beers; }, myBeer: myBeer, myNight: myNight, getName: getName, withName: withName,
      authed: function () { return authed; }, client: function () { return client; }, prec: function () { return prec; },
      center: chaosCenter, getPosition: getPosition, locError: locError, inSweden: inSweden, showGroups: showGroups,
      copyText: copyText, beerOnly: beerOnly, othersOn: function () { return othersState === "on"; },
      checkins: function () { return checkins; }, myCheckin: myCheckin,
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
