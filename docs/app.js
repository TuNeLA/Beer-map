/* Öl Nu — main app. Plain JS, no build step. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, t = I.t;
  var CFG = window.OLNU_CONFIG || {};
  var DEMO_MODE = !CFG.SUPABASE_URL;
  var client = null;
  var authed = false;

  var SWEDEN = [[55.0, 10.9], [69.1, 24.2]];
  var MAX_BOUNDS = [[53.3, 7.5], [70.8, 27.8]];
  var POLL_MS = 30000;
  var HOT_ZOOM = 11, BAR_ZOOM = 13, MAX_PLAIN_BARS = 300;

  var $ = function (id) { return document.getElementById(id); };
  var beers = [];
  var firstLoadDone = false;
  var pendingFocus = null;
  var busy = false;

  /* ---------- RPC wrapper ---------- */
  function rpc(name, params) {
    if (DEMO_MODE) return window.DEMO.rpc(name, params);
    if (!client) return Promise.resolve({ data: null, error: { message: "no_client" } });
    return Promise.resolve(params ? client.rpc(name, params) : client.rpc(name))
      .catch(function (e) { return { data: null, error: e }; });
  }

  /* ---------- Toasts ---------- */
  function toast(msg, opts) {
    opts = opts || {};
    var box = $("toasts"), el = document.createElement("div");
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

  /* ---------- Map ---------- */
  var map = L.map("map", {
    zoomControl: false, attributionControl: true, minZoom: 4, maxZoom: 19,
    maxBounds: MAX_BOUNDS, maxBoundsViscosity: 0.8, worldCopyJump: false, tap: true
  });
  map.fitBounds(SWEDEN, { padding: [10, 10] });
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
      var kids = cluster.getAllChildMarkers(), friend = false, lvl = 0, n = 0;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].options.friend) friend = true;
        if ((kids[i].options.streak | 0) > lvl) lvl = kids[i].options.streak | 0;
        n++;
      }
      var size = n < 10 ? 40 : n < 100 ? 48 : 58;
      var fs = n < 10 ? 18 : n < 100 ? 20 : 22;
      var flag = lvl === 2 ? '<span class="cl-flag">🚁</span>' : lvl === 1 ? '<span class="cl-flag">🔥</span>' : "";
      return L.divIcon({
        html: '<div class="cl' + (friend ? " friend" : "") + (lvl ? " lvl" + lvl : "") + '" style="font-size:' + fs + 'px">' + n + flag + "</div>",
        className: "marker-cluster", iconSize: [size, size]
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
  if (typeof L.heatLayer === "function") {
    heat = L.heatLayer([], {
      radius: 34, blur: 26, maxZoom: 11, max: 4, minOpacity: 0.25,
      gradient: { 0.1: "rgba(60,25,0,0)", 0.3: "#a85a08", 0.5: "#f5a623", 0.68: "#ff7a1a", 0.85: "#ff3b3b", 1.0: "#fff6e0" }
    });
  }
  function heatWeight(b) {
    var n = b.beer_count | 0, l = U.level(n);
    return Math.max(1, n) * (l === 2 ? 3 : l === 1 ? 2 : 1);
  }
  function renderHeat() {
    if (!heat) return;
    if (heatOn && !map.hasLayer(heat)) heat.addTo(map);
    if (!heatOn && map.hasLayer(heat)) map.removeLayer(heat);
    if (heatOn) heat.setLatLngs(beers.map(function (b) { return [b.lat, b.lng, heatWeight(b)]; }));
  }
  function applyHeatBtn() {
    var b = $("btn-heat");
    b.hidden = !heat;
    b.textContent = t("heat");
    b.setAttribute("aria-pressed", String(heatOn));
    b.setAttribute("aria-label", heatOn ? t("heatOn") : t("heatOff"));
  }
  $("btn-heat").addEventListener("click", function () {
    heatOn = !heatOn; U.ls.set(HEAT_KEY, heatOn ? "1" : "0");
    applyHeatBtn(); renderHeat();
  });

  function lvlClass(l) { return l === 2 ? " medevac" : l === 1 ? " hot" : ""; }
  function beerIcon(b) {
    var l = U.level(b.beer_count);
    var cls = "bm" + (b.is_mine ? " mine" : b.friend_name ? " friend" : "") + (b.precise ? "" : " approx") + lvlClass(l);
    var html = '<div class="' + cls + '"><div class="bm-dot">' + (l === 2 ? '<span class="bm-heli">🚁</span>' : U.GLASS_SVG) + "</div>" +
      (l === 1 ? '<span class="bm-fire">🔥</span>' : "") +
      (b.beer_count > 1 ? '<span class="bm-n">' + (b.beer_count | 0) + "</span>" : "") +
      (b.friend_name ? '<span class="bm-name">' + U.esc(b.friend_name) + "</span>" : "") +
      (b.is_mine ? '<span class="bm-name bm-me">' + U.esc(t("you")) + "</span>" : "") +
      "</div>";
    var s = l === 2 ? 46 : 34;
    return L.divIcon({ html: html, className: "", iconSize: [s, s], iconAnchor: [s / 2, s / 2], popupAnchor: [0, -s / 2] });
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
    var h = '<div class="pp-title">' + U.esc(t("beerNo", b.beer_count | 0)) + "</div>" +
      '<div class="pp-data">' + U.esc(t("since", U.timeHM(b.created_at))) + "</div>";
    h += levelLine(U.level(b.beer_count));
    if (b.is_mine) h += '<div class="pp-mine">' + U.esc(t("you")) + '</div><div class="pp-skal">' + U.esc(t("skalN", skalCount(b))) + "</div>";
    if (b.friend_name) h += '<div class="pp-friend">' + U.esc(b.friend_name) + "</div>";
    if (!b.precise) h += '<div class="pp-note">' + U.esc(t("approx")) + "</div>";
    if (!b.is_mine) h += skalBtn(b, false);
    return h;
  }
  function barTypeLabel(type) { var m = t("barTypes"); return m[type] || m.bar; }
  function maxLevel(list) { var l = 0; list.forEach(function (b) { l = Math.max(l, U.level(b.beer_count)); }); return l; }
  function hotBarIcon(agg) {
    var friend = agg.beers.some(function (b) { return b.friend_name; });
    var mine = agg.beers.some(function (b) { return b.is_mine; });
    var l = maxLevel(agg.beers);
    var html = '<div class="bar-hot' + (friend ? " friend" : mine ? " mine" : "") + lvlClass(l) + '"><span class="bar-ico">' +
      (l === 2 ? "🚁" : U.GLASS_SVG) + "</span>" + agg.beers.length + " 🍺" + (l === 1 ? " 🔥" : "") + "</div>";
    return L.divIcon({ html: html, className: "", iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -14] });
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
    if (list.some(function (b) { return b.is_mine; })) h += '<div class="pp-mine">' + U.esc(t("you")) + "</div>";
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
    }
    h += '<div class="pp-note">' + U.esc(t("barNote")) + "</div>";
    return h;
  }

  var markerById = {};   // beer id -> marker (or hot bar marker)
  var hotBarIds = {};    // bar id -> true
  function render() {
    var z = map.getZoom();
    clusters.clearLayers(); hotLayer.clearLayers(); markerById = {}; hotBarIds = {};
    var split = z >= HOT_ZOOM ? window.BARS.assign(beers) : { perBar: {}, rest: beers };
    var ms = split.rest.map(function (b) {
      var l = U.level(b.beer_count);
      var m = L.marker([b.lat, b.lng], { icon: beerIcon(b), friend: !!b.friend_name, mine: !!b.is_mine, streak: l,
        zIndexOffset: (b.is_mine ? 900 : b.friend_name ? 500 : 0) + l * 300, keyboard: false });
      m.bindPopup(function () { return beerPopup(b); });
      markerById[b.id] = m;
      return m;
    });
    clusters.addLayers(ms);
    Object.keys(split.perBar).forEach(function (id) {
      var agg = split.perBar[id];
      hotBarIds[id] = true;
      var m = L.marker([agg.bar.lat, agg.bar.lng], { icon: hotBarIcon(agg), pane: "hotbars", keyboard: false,
        zIndexOffset: 1000 + agg.beers.length + maxLevel(agg.beers) * 500 });
      m.bindPopup(function () { return barPopup(agg.bar, agg.beers); }, { pane: "popupPane" });
      m.addTo(hotLayer);
      agg.beers.forEach(function (b) { markerById[b.id] = m; });
    });
    renderPlainBars();
    renderHeat();
    updateCounts();
    renderTicker();
  }
  function renderPlainBars() {
    barLayer.clearLayers();
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
        m.bindPopup(function () { return barPopup(bar, []); });
        m.addTo(barLayer);
      })(bar);
    }
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
  function whereOf(b) {
    var bar = b.precise ? window.BARS.nearest(b.lat, b.lng) : null;
    return bar && bar.name ? bar.name : t("unknownPlace");
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
      var d = typeof r.data === "string" ? JSON.parse(r.data) : (r.data || {});
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
    if (accepted) m.lastTap = Date.now();
    else if (d.wait_seconds > 0) m.lastTap = Date.now() + d.wait_seconds * 1000 - U.COOLDOWN_MS;
    U.ls.setJSON("olnu.night", m);
  }
  function updateCounts() {
    $("live-count").innerHTML = t("live", beers.length | 0);
    var f = friendsDrinking(), badge = $("groups-badge");
    badge.textContent = String(f); badge.hidden = f === 0;
    $("btn-groups").setAttribute("aria-label", t("groups") + (f ? " — " + t("friendsNow", f) : ""));
    var mine = myBeer();
    $("btn-stop").hidden = !mine;
    var night = myNight(), n = mine ? mine.beer_count | 0 : night ? night.count | 0 : 0;
    var st = $("my-streak");
    if (n > 0) {
      var l = U.level(n);
      st.hidden = false;
      st.className = "my-streak" + lvlClass(l);
      st.innerHTML = '<span class="ms-k">' + U.esc(t("tonight")) + ':</span> <b>' + n + "</b>" +
        (l === 2 ? ' 🚁 <span class="ms-tag">' + U.esc(t("medevac")) + "</span>" : l === 1 ? ' 🔥 <span class="ms-tag">' + U.esc(t("hot")) + "</span>" : " 🍺") +
        (mine ? ' <span class="ms-skal">· ' + U.esc(t("skalN", skalCount(mine))) + "</span>" : "");
    } else st.hidden = true;
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
    $("demo-chip").hidden = !DEMO_MODE;
    $("btn-skip").textContent = t("skip");
    $("btn-top").setAttribute("aria-label", t("top"));
    $("btn-top").title = t("top");
    applyHeatBtn();
    applyPrec();
    updateCounts();
    tickerKey = ""; renderTicker();
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
  var loading = false;
  function refresh() {
    if (loading) return Promise.resolve();
    if (!DEMO_MODE && !authed) return Promise.resolve();
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
      streakAlerts();
      skalAlert();
      if (!firstLoadDone) { firstLoadDone = true; handleFocus(); }
    }).catch(function (e) {
      if (U.errCode(e) === "not_authenticated") { reauth(); return; }
      if (!firstLoadDone) toast(t("loadFail"), { err: true, action: { label: t("retry"), fn: refresh } });
    }).then(function () { loading = false; });
  }
  setInterval(function () { if (document.visibilityState === "visible") refresh(); }, POLL_MS);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { refresh(); tickCooldown(); } });

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
    if (DEMO_MODE || !client || reauthing) return;
    reauthing = true; authed = false;
    // Try to refresh the token first: signing out makes a NEW anonymous user and loses all groups.
    client.auth.refreshSession().then(function (r) {
      if (r && r.data && r.data.session && !r.error) return;
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
    $("btn-skip").hidden = !(DEMO_MODE && on);
    if (on) {
      btnEl.disabled = true;
      $("beer-label").textContent = U.mmss(left);
      $("beer-sub").textContent = t("nextIn");
      btnEl.setAttribute("aria-label", t("nextIn") + " " + U.mmss(left));
      ring.style.strokeDashoffset = String(RING_LEN * (1 - left / U.COOLDOWN_MS));
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
  $("btn-skip").addEventListener("click", function () {
    if (!DEMO_MODE) return;
    window.DEMO.skipCooldown();
    var m = myNight(); if (m) { m.lastTap = 0; U.ls.setJSON("olnu.night", m); }
    tickCooldown();
  });

  /* ---------- Beer button ---------- */
  function getPosition() {
    return new Promise(function (res, rej) {
      if (!("geolocation" in navigator)) { rej({ code: 2 }); return; }
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
    });
  }
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
    if (busy || cooldownLeft() > 0) return;
    if (!DEMO_MODE && !authed) { signIn(); return; }
    window.FX.unlock();
    window.FX.splash($("btn-beer"));
    window.FX.vibrate(20);
    setBusy(true);
    getPosition().then(function (pos) {
      return rpc("post_beer", { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_precise: prec === "exact" })
        .then(function (r) {
          if (r.error) { toast(errMsg(r.error, t("postFail")), { err: true, ms: 6000 }); return; }
          var d = r.data || {};
          if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = {}; } }
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
          if (d.milestone != null && !DEMO_MODE && client) {
            try { client.functions.invoke("notify-group").catch(function () {}); } catch (e) {}
          }
          if (isFinite(d.lat) && isFinite(d.lng)) {
            map.setView([d.lat, d.lng], Math.max(map.getZoom(), 15));
          }
          return refresh();
        });
    }, function (err) {
      if (err && err.code === 1) toast(t("locDenied"), { err: true, ms: 10000 });
      else toast(t("locFail"), { err: true, ms: 5000 });
    }).catch(function () { toast(t("postFail"), { err: true }); })
      .then(function () { setBusy(false); tickCooldown(); updateCounts(); });
  });
  $("btn-stop").addEventListener("click", function () {
    rpc("stop_beer").then(function (r) {
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
      var inp = el("input", { class: "inp", id: "name-inp", maxlength: "30", autocomplete: "nickname", enterkeyhint: "done", value: getName() });
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

  /* ---------- Groups ---------- */
  function joinLink(code) { return location.origin + location.pathname + "?join=" + encodeURIComponent(code); }
  function friendsNowText() { var f = friendsDrinking(); return f ? " · " + t("friendsNow", f) : ""; }

  function showGroups() {
    withName(function () {
      openSheet(t("groups"), function (body) {
        var list = el("ul", { class: "glist" });
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
            var g = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
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
            var g = typeof r.data === "string" ? JSON.parse(r.data) : (r.data || {});
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
          return { name: a.bar.name || t("unnamedBar"), sub: barTypeLabel(a.bar.type) + (sk ? " · " + t("skalN", sk) : ""),
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
      return Object.keys(g).map(function (k) { return g[k]; })
        .sort(function (a, b) { return (a.other - b.other) || b.list.length - a.list.length; })
        .slice(0, 20).map(function (x) {
          var c = null; window.CITIES.list.forEach(function (cc) { if (cc.name === x.name) c = cc; });
          var lat = 0, lng = 0; x.list.forEach(function (b) { lat += b.lat; lng += b.lng; });
          var tot = 0; x.list.forEach(function (b) { tot += b.beer_count | 0; });
          return { name: x.name, sub: t("beersN", tot), n: x.list.length, icon: lvlIcon(maxLevel(x.list)),
            lat: c ? c.lat : lat / x.list.length, lng: c ? c.lng : lng / x.list.length, z: c ? 12 : 7,
            friend: x.list.some(function (b) { return b.friend_name; }) };
        });
    }
    return beers.filter(function (b) { return U.level(b.beer_count) > 0; })
      .sort(function (a, b) { return (b.beer_count | 0) - (a.beer_count | 0); })
      .slice(0, 20).map(function (b) {
        var bar = b.precise ? window.BARS.nearest(b.lat, b.lng) : null;
        var where = bar && bar.name ? bar.name : cityOf(b) || t("other");
        return { name: whoOf(b), sub: where, n: b.beer_count | 0, icon: lvlIcon(U.level(b.beer_count)),
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
    if (DEMO_MODE) { toast(t("notifDemo")); return Promise.resolve("demo"); }
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
      if (DEMO_MODE) body.appendChild(el("div", { class: "info", text: t("demo") }));
      body.appendChild(el("h3", { text: t("yourName") }));
      var inp = el("input", { class: "inp", id: "set-name", maxlength: "30", value: getName(), autocomplete: "nickname", enterkeyhint: "done", "aria-label": t("yourName") });
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

      body.appendChild(el("h3", { text: t("sound") }));
      var snd = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(!window.FX.muted()), "aria-label": t("soundLabel") });
      snd.addEventListener("click", function () {
        var on = snd.getAttribute("aria-checked") === "true";
        window.FX.setMuted(on); snd.setAttribute("aria-checked", String(!on));
        if (!on) { window.FX.unlock(); window.FX.sound.clink(); }
      });
      body.appendChild(el("div", { class: "toggle-row" }, [el("span", { text: t("soundLabel") }), snd]));

      if (DEMO_MODE) {
        body.appendChild(el("div", { class: "row", style: "margin-top:14px" }, [btn(t("skipMed"), "btn-small btn-debug", function () {
          window.DEMO.jumpTo9();
          U.ls.setJSON("olnu.night", { count: 9, expires: U.next5am().getTime(), lastTap: 0 });
          closeSheet(); refresh().then(tickCooldown);
        })]));
      }

      body.appendChild(el("h3", { text: t("about") }));
      body.appendChild(el("p", { text: t("privacy") }));
      body.appendChild(el("p", { class: "muted", text: t("aboutMore") }));
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
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(function () {});
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
  function signIn() {
    if (!client) return Promise.resolve();
    return client.auth.getSession().then(function (res) {
      if (res && res.data && res.data.session) return res;
      return client.auth.signInAnonymously().then(function (r) { if (r.error) throw r.error; return r; });
    }).then(function () {
      authed = true;
      window.PUSH.resync(rpc);
      return refresh();
    }).catch(function () {
      toast(t("authFail"), { err: true, ms: 0, action: { label: t("retry"), fn: signIn } });
    });
  }

  function start() {
    applyStaticText();
    window.BARS.init({ map: map, staticBars: DEMO_MODE ? window.DEMO.bars : null, onChange: render });
    var ready;
    if (DEMO_MODE) {
      ready = refresh();
    } else {
      try {
        client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "olnu.auth" }
        });
      } catch (e) { client = null; }
      ready = client ? signIn() : Promise.resolve(toast(t("authFail"), { err: true }));
    }
    if (joinCode) {
      var c = U.cleanCode(joinCode);
      Promise.resolve(ready).then(function () { showJoin(c); });
    }
  }
  start();
})();
