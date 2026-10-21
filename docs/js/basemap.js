/* Öl Nu — 🗺️ KARTSTIL (beta): an opt-in vector basemap under the Leaflet map (CONTRACT "KARTSTIL BETA").
   window.BASEMAP. app.js calls BASEMAP.early(map, rasterLayers) right after the raster tiles are made, and the
   mods() hooks init, settingsSheet and applyText. Markers, clusters, heat, popups and panes are NOT touched:
   the GL canvas sits in Leaflet's tilePane (z 200), under the heat canvas (overlayPane, z 400) and the markers.
   - Classic (default) = the old CARTO/Esri raster layers. Nothing extra loads for Classic users.
   - Natt / Grafit / Neon = OpenFreeMap "liberty" (OpenMapTiles schema), recoloured here in code.
     maplibre-gl (UMD) + @maplibre/maplibre-gl-leaflet load LAZILY from jsDelivr (exact versions) only then.
   - The choice lives in localStorage "olnu.mapStyle" (classic|natt|grafit|neon). A switch applies live.
   - The raster layers stay on the map until the GL map has loaded (no blank map), then they are removed.
     Any failure (no WebGL, script or style not loading, context lost) = back to Classic for this session.
   - Memory: while the page is hidden (camera, app switch) the GL layer is removed (its WebGL context is
     released) and it comes back when the page is visible again (same idea as app.js memShed).
   - Attribution: OpenFreeMap © OpenMapTiles © OpenStreetMap contributors in the ⓘ popover. It opens by
     itself for 5 s when a GL style starts, and closes on map move (OSMF attribution guideline). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var KEY = "olnu.mapStyle", DEFAULT = "classic";
  var ML_VER = "5.24.0", PLUG_VER = "0.1.4";
  var ML_JS = "https://cdn.jsdelivr.net/npm/maplibre-gl@" + ML_VER + "/dist/maplibre-gl.js";
  var ML_CSS = "https://cdn.jsdelivr.net/npm/maplibre-gl@" + ML_VER + "/dist/maplibre-gl.css";
  var PLUG_JS = "https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@" + PLUG_VER + "/leaflet-maplibre-gl.js";
  var STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
  // "Mapbox natt (beta)": Mapbox GL JS v3 + Standard style (night) through the old mapbox-gl-leaflet bridge.
  // Only offered when config.js has MAPBOX_TOKEN. One Mapbox map object per page life (= one billed map load):
  // switching away only detaches it, switching back re-attaches the same object.
  var MB_VER = "3.32.0", MBL_VER = "0.0.16";
  var MB_JS = "https://cdn.jsdelivr.net/npm/mapbox-gl@" + MB_VER + "/dist/mapbox-gl.js";
  var MB_CSS = "https://cdn.jsdelivr.net/npm/mapbox-gl@" + MB_VER + "/dist/mapbox-gl.css";
  var MBL_JS = "https://cdn.jsdelivr.net/npm/mapbox-gl-leaflet@" + MBL_VER + "/leaflet-mapbox-gl.js";
  var ATTR_MB = '&copy; <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> ' +
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> ' +
    '<a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener"><strong>Improve this map</strong></a>';
  var MB_CONFIG = { lightPreset: "night", showPointOfInterestLabels: false, showTransitLabels: false, showPedestrianRoads: true,
    show3dObjects: false, colorMotorways: "#f5a623", colorTrunks: "#c77a0e", colorRoads: "#2b3550", colorWater: "#06182c",
    colorPlaceLabels: "#ffd28a", colorBuildingHighlight: "#f5a623" };
  var CFG = window.OLNU_CONFIG || {};
  var ATTR_GL = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
    '&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

  var A = null, map = null, rasters = [], classicAttr = "";
  var gl = null, glLoaded = false, cur = "classic", failed = false, hiddenOff = false;
  var mb = null, mbLoaded = false, mbP = null, mbFailed = false, logoEl = null;
  var libP = null, baseP = null, attrTimer = 0, lastToast = -1;

  function sv() { return !I || I.lang !== "en"; }
  var S = {
    sv: { title: "🗺️ Kartstil", classic: "Klassisk", natt: "Natt", grafit: "Grafit", neon: "Neon", mapbox: "Mapbox natt", beta: "beta",
      info: "Beta: en ny, skarpare karta med vektorlinjer. Pins, värme och krogar ä som vanligt. Drar mer batteri på äldre lurar.",
      fail: "🗺️ Nya kartan vägrade starta här. Kör Klassisk så länge.",
      on: ["🗺️ Nattkartan ä laddad. Säg till om nåt ser konstigt ut!", "🗺️ Ny karta i drift. Spaningsläge: på.",
        "🗺️ Kartan bytt. Samma krogar, snyggare gator.", "🗺️ Klart! Vägarna glöder som en fredag."] },
    en: { title: "🗺️ Map style", classic: "Classic", natt: "Night", grafit: "Graphite", neon: "Neon", mapbox: "Mapbox night", beta: "beta",
      info: "Beta: a new, sharper vector map. Pins, heat and bars stay the same. Uses more battery on older phones.",
      fail: "🗺️ The new map would not start here. Using Classic for now.",
      on: ["🗺️ Night map loaded. Tell us if something looks odd!", "🗺️ New map deployed. Recon mode: on.",
        "🗺️ Map switched. Same bars, nicer streets.", "🗺️ Done! The roads glow like a Friday."] }
  };
  function T(k) { return (sv() ? S.sv : S.en)[k]; }

  /* ---------- Palettes ---------- */
  var P = {
    natt: { land: "#0a1020", landHi: "#0c1426", park: "#0b1a1e", wood: "#0b1620", grass: "#0c1a1f", ice: "#121a2a", sand: "#121726",
      water: "#06182c", waterLine: "#0b2742", waterText: "#5f86ad", build: "#111a2d", buildLine: "#1a2742",
      path: "#2c3854", minor: "#2a3754", minorCase: "#0a1020", mid: "#6b4a1c", major: "#e8992a", motor: "#ffb340",
      glow: "#f5a623", glowOp: 0.22, rail: "#26314a", aero: "#131b2c", border: "#3a3f5a",
      text: "#efe4c8", textSub: "#b9ad92", halo: "#060a14", roadText: "#8e98ae", majorText: "#d9b67a" },
    grafit: { land: "#111214", landHi: "#141518", park: "#121614", wood: "#121513", grass: "#131614", ice: "#1a1b1e", sand: "#18181a",
      water: "#0a0c0f", waterLine: "#1a1e24", waterText: "#6d7682", build: "#1b1c20", buildLine: "#26282d",
      path: "#2e3035", minor: "#323439", minorCase: "#111214", mid: "#4a4234", major: "#b89562", motor: "#d4ad6c",
      glow: "#d4ad6c", glowOp: 0.12, rail: "#2a2b30", aero: "#18191c", border: "#3c3d42",
      text: "#e4e2dc", textSub: "#a9a69f", halo: "#08090a", roadText: "#8d8c88", majorText: "#c9b28a" },
    neon: { land: "#0b0818", landHi: "#0e0a1e", park: "#0a1420", wood: "#0a1220", grass: "#0b1422", ice: "#141230", sand: "#131026",
      water: "#04121f", waterLine: "#0c3a52", waterText: "#3fc6e8", build: "#160f2c", buildLine: "#2a1c50",
      path: "#2a2050", minor: "#262050", minorCase: "#0b0818", mid: "#123d4e", major: "#ff4fd8", motor: "#ff6be0",
      glow: "#ff4fd8", glowOp: 0.28, rail: "#251d44", aero: "#130f26", border: "#4a2f7a",
      text: "#f2e9ff", textSub: "#b9a8e0", halo: "#05030c", roadText: "#8f86c0", majorText: "#ff9de9" }
  };
  var VARIANTS = ["classic", "natt", "grafit", "neon"];
  if (CFG.MAPBOX_TOKEN) VARIANTS.push("mapbox");

  /* ---------- Recolour OpenFreeMap liberty ---------- */
  var DROP = /^(natural_earth|poi_|highway-shield|road_shield|road_area_pattern|building-3d|airport|road_one_way|tunnel_.*hatching|park_outline)/;
  function roadRole(id) {
    if (/rail/.test(id)) return "rail";
    if (/path_pedestrian/.test(id)) return "path";
    if (/motorway(?!_link)/.test(id)) return "motor";
    if (/trunk_primary|motorway_link/.test(id)) return "major";
    if (/secondary_tertiary/.test(id)) return "mid";
    return "minor";   // minor, street, link, service_track
  }
  function nameExpr(lang) {
    var key = lang === "en" ? "name_en" : "name:sv";
    return ["coalesce", ["get", key], ["get", "name"]];
  }
  function fixNames(v, lang) {
    // liberty: ["coalesce", ["get","name_en"], ["get","name"]] inside a nonlatin case. Swedish names first.
    if (Array.isArray(v)) {
      if (v[0] === "coalesce" && Array.isArray(v[1]) && v[1][0] === "get" && v[1][1] === "name_en") return nameExpr(lang);
      return v.map(function (x) { return fixNames(x, lang); });
    }
    return v;
  }
  function recolor(base, name, lang) {
    var c = P[name] || P.natt, out = JSON.parse(JSON.stringify(base)), layers = [], glows = [];
    delete out.sources.ne2_shaded;
    out.layers.forEach(function (l) {
      var id = l.id;
      if (DROP.test(id)) return;
      var p = l.paint = l.paint || {}, lay = l.layout = l.layout || {};
      if (l.type === "background") { p["background-color"] = c.land; }
      else if (l.type === "fill") {
        delete p["fill-pattern"];
        var col = c.landHi, op = 1;
        if (id === "water") { col = c.water; }
        else if (id === "park") { col = c.park; op = 0.9; }
        else if (/wood/.test(id)) { col = c.wood; op = 0.9; }
        else if (/grass|pitch|track|cemetery/.test(id)) { col = c.grass; op = 0.8; }
        else if (/ice/.test(id)) { col = c.ice; }
        else if (/sand|wetland/.test(id)) { col = c.sand; op = 0.8; }
        else if (/aeroway/.test(id)) { col = c.aero; }
        else if (id === "building") { col = c.build; }
        else if (/residential|hospital|school/.test(id)) { col = c.landHi; op = 0.85; }
        p["fill-color"] = col; p["fill-opacity"] = op; p["fill-antialias"] = true;
        if (id === "building") {
          // Flat footprints (no extrusion in the Leaflet bridge), from z13, with a crisp edge from z15.
          l.minzoom = 13; delete l.maxzoom;
          p["fill-outline-color"] = c.buildLine;
          p["fill-opacity"] = ["interpolate", ["linear"], ["zoom"], 13, 0.4, 15, 1];
        } else delete p["fill-outline-color"];
      } else if (l.type === "line") {
        if (/^waterway/.test(id)) { p["line-color"] = c.waterLine; }
        else if (/^boundary/.test(id)) { p["line-color"] = c.border; p["line-opacity"] = 0.6; }
        else if (/^aeroway/.test(id)) { p["line-color"] = c.aero; }
        else if (/^(road|tunnel|bridge)_/.test(id)) {
          var role = roadRole(id), casing = /casing/.test(id), tunnel = /^tunnel_/.test(id);
          if (casing) {
            p["line-color"] = role === "motor" || role === "major" ? "#000000" : c.minorCase;
            p["line-opacity"] = role === "motor" || role === "major" ? 0.55 : 0.9;
          } else {
            p["line-color"] = role === "rail" ? c.rail : c[role];
            p["line-opacity"] = tunnel ? 0.45 : role === "major" ? 0.9 : 1;
            if (!tunnel && (role === "motor" || role === "major") && !/link/.test(id)) glows.push(l);
          }
          if (role === "rail") delete p["line-dasharray"];
        } else p["line-color"] = c.minor;
      } else if (l.type === "symbol") {
        if (lay["text-field"]) lay["text-field"] = fixNames(lay["text-field"], lang);
        if (/^label_/.test(id)) {
          delete lay["icon-image"];
          p["text-color"] = /village|other/.test(id) ? c.textSub : c.text;
          p["text-halo-color"] = c.halo; p["text-halo-width"] = 1.6; p["text-halo-blur"] = 0.5;
        } else if (/^water/.test(id)) {
          p["text-color"] = c.waterText; p["text-halo-color"] = c.halo; p["text-halo-width"] = 1.2;
        } else if (/^highway-name/.test(id)) {
          p["text-color"] = /major/.test(id) ? c.majorText : c.roadText; p["text-halo-color"] = c.halo; p["text-halo-width"] = 1.4;
        } else { p["text-color"] = c.roadText; p["text-halo-color"] = c.halo; p["text-halo-width"] = 1.2; }
      }
      layers.push(l);
    });
    // Amber/pink glow under the major roads: a wide, blurred, faint copy of each road line.
    glows.forEach(function (l) {
      var g = JSON.parse(JSON.stringify(l));
      g.id = l.id + "_glow";
      g.paint = { "line-color": c.glow, "line-opacity": c.glowOp, "line-blur": ["interpolate", ["linear"], ["zoom"], 6, 2, 14, 6, 18, 12],
        "line-width": ["interpolate", ["exponential", 1.2], ["zoom"], 5, 1, 10, 5, 14, 12, 18, 28] };
      var at = layers.indexOf(l); if (at >= 0) layers.splice(at, 0, g);
    });
    out.layers = layers;
    return out;
  }

  /* ---------- Loading ---------- */
  function addScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = src; s.async = false; s.crossOrigin = "anonymous";
      s.onload = res; s.onerror = function () { rej(new Error("load " + src)); };
      document.head.appendChild(s);
    });
  }
  function loadLib() {
    if (libP) return libP;
    if (!document.querySelector('link[data-basemap]')) {
      var ln = document.createElement("link"); ln.rel = "stylesheet"; ln.href = ML_CSS; ln.setAttribute("data-basemap", "1"); ln.crossOrigin = "anonymous";
      document.head.appendChild(ln);
    }
    libP = (window.maplibregl ? Promise.resolve() : addScript(ML_JS))
      .then(function () { return window.L && window.L.maplibreGL ? null : addScript(PLUG_JS); })
      .then(function () { if (!window.maplibregl || !window.L.maplibreGL) throw new Error("no_lib"); });
    libP.catch(function () { libP = null; });
    return libP;
  }
  function loadBase() {
    if (baseP) return baseP;
    baseP = fetch(STYLE_URL, { credentials: "omit" }).then(function (r) { if (!r.ok) throw new Error("style " + r.status); return r.json(); });
    baseP.catch(function () { baseP = null; });
    return baseP;
  }
  var glOk = null;
  function webglOk() {
    if (glOk !== null) return glOk;
    try {
      var cv = document.createElement("canvas"), g = cv.getContext("webgl2") || cv.getContext("webgl");
      glOk = !!g;
      var ext = g && g.getExtension("WEBGL_lose_context"); if (ext) ext.loseContext();
    } catch (e) { glOk = false; }
    return glOk;
  }

  /* ---------- Attribution (ⓘ popover) ---------- */
  function setAttr(showIt) {
    var pop = document.getElementById("attrib-pop"), btn = document.getElementById("btn-attrib");
    if (!pop) return;
    pop.innerHTML = cur === "classic" ? classicAttr : cur === "mapbox" ? ATTR_MB : ATTR_GL;   // static strings only
    if (showIt && !(window.OLNU_STRIP && window.OLNU_STRIP.up && window.OLNU_STRIP.up())) {
      clearTimeout(attrTimer);
      pop.hidden = false; if (btn) btn.setAttribute("aria-expanded", "true");
      attrTimer = setTimeout(function () { pop.hidden = true; if (btn) btn.setAttribute("aria-expanded", "false"); }, 5000);
    }
  }

  // The credit opens by itself once the new map is on screen (then 5 s, or until the map moves).
  var showOnLoad = false;
  function attrOnLoad() { var s0 = showOnLoad; showOnLoad = false; setAttr(s0); }

  /* ---------- Switching ---------- */
  function rastersOn(on) {
    rasters.forEach(function (l) {
      try { if (on && !map.hasLayer(l)) l.addTo(map); else if (!on && map.hasLayer(l)) map.removeLayer(l); } catch (e) {}
    });
  }
  function dropGL() {
    if (!gl) return;
    try { if (map.hasLayer(gl)) map.removeLayer(gl); } catch (e) {}
    gl = null; glLoaded = false;
  }
  function fallback(why) {
    try { console.warn("olnu basemap", why); } catch (e) {}
    failed = true; dropGL(); mbOff(); cur = "classic"; rastersOn(true); setAttr(false);
    document.documentElement.removeAttribute("data-basemap");
    if (A && A.toast && userAsked) A.toast(T("fail"));
  }
  var userAsked = false, applySeq = 0, curLang = "";
  function glOpts(style) {
    return {
      style: style, interactive: false, padding: 0.12, updateInterval: 32,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),   // less GPU memory on 3× phones; still crisp
      maxTileCacheSize: 60, fadeDuration: 120, refreshExpiredTiles: false, attributionControl: false
    };
  }
  function hookGL(layer) {
    var m = layer.getMaplibreMap(); if (!m) return;
    m.on("load", function () {
      if (gl !== layer) return;
      glLoaded = true; rastersOn(false); attrOnLoad();
    });
    try {
      m.getCanvas().addEventListener("webglcontextlost", function () { if (gl === layer && !document.hidden) fallback("context_lost"); });
    } catch (e) {}
  }
  function apply(name, why) {
    var seq = ++applySeq;
    if (VARIANTS.indexOf(name) < 0) name = DEFAULT;
    if (name === "classic" || failed) {
      cur = "classic"; rastersOn(true); dropGL(); mbOff(); setAttr(false);
      document.documentElement.removeAttribute("data-basemap");
      return Promise.resolve("classic");
    }
    if (!webglOk()) { fallback("no_webgl"); return Promise.resolve("classic"); }
    if (name === "mapbox") return applyMb(seq, why);
    mbOff();
    var lang = curLang = sv() ? "sv" : "en";
    return Promise.all([loadLib(), loadBase()]).then(function (r) {
      if (seq !== applySeq) return cur;
      var style = recolor(r[1], name, lang);
      cur = name;
      document.documentElement.setAttribute("data-basemap", name);
      if (gl && gl.getMaplibreMap()) {
        gl.options.style = style;
        gl.getMaplibreMap().setStyle(style);
      } else {
        rastersOn(true);   // the old map stays until the GL map has drawn
        gl = window.L.maplibreGL(glOpts(style));
        if (!document.hidden) { gl.addTo(map); hookGL(gl); } else hiddenOff = true;
      }
      showOnLoad = why === "user" || why === "start";
      if (glLoaded) attrOnLoad(); else setAttr(false);
      if (why === "user" && A && A.toast) { var o = T("on"), i; do { i = Math.floor(Math.random() * o.length); } while (o.length > 1 && i === lastToast); lastToast = i; A.toast(o[i]); }
      return name;
    }).catch(function (e) { if (seq === applySeq) fallback(e && e.message || "error"); return "classic"; });
  }

  /* ---------- Mapbox natt ---------- */
  function loadMb() {
    if (mbP) return mbP;
    if (!document.querySelector('link[data-basemap-mb]')) {
      var ln = document.createElement("link"); ln.rel = "stylesheet"; ln.href = MB_CSS; ln.setAttribute("data-basemap-mb", "1"); ln.crossOrigin = "anonymous";
      document.head.appendChild(ln);
    }
    mbP = (window.mapboxgl ? Promise.resolve() : addScript(MB_JS))
      .then(function () { return window.L.mapboxGL ? null : addScript(MBL_JS); })
      .then(function () { if (!window.mapboxgl || !window.L.mapboxGL) throw new Error("no_mb_lib"); });
    mbP.catch(function () { mbP = null; });
    return mbP;
  }
  function logo(on) {
    // Mapbox terms: the logo stays visible. The GL container sits partly off screen, so we show our own copy
    // (mapbox-gl.css draws the official logo) next to the ⓘ button.
    if (on && !logoEl) {
      if (window.ResizeObserver) { var dk = document.querySelector(".dock"); if (dk) new ResizeObserver(function () { if (logoEl && !logoEl.hidden) placeLogo(); }).observe(dk); }
      logoEl = document.createElement("a");
      logoEl.className = "mapboxgl-ctrl-logo bm-mblogo"; logoEl.href = "https://www.mapbox.com/"; logoEl.target = "_blank"; logoEl.rel = "noopener";
      logoEl.setAttribute("aria-label", "Mapbox logo");
      document.body.appendChild(logoEl);
      if (!document.getElementById("bm-mb-css")) {
        var st = document.createElement("style"); st.id = "bm-mb-css";
        st.textContent = ".bm-mblogo{position:fixed !important;z-index:998;left:calc(var(--sal,0px) + 46px);bottom:calc(var(--dock-h,212px) + 6px);" +
          "display:block;width:88px;height:23px;opacity:.9}";
        document.head.appendChild(st);
      }
    }
    if (logoEl) { logoEl.hidden = !on; if (on) placeLogo(); }
  }
  // Just above the ⓘ button (clear of the ANNAT button and the dock), follows the dock height.
  function placeLogo() {
    var b = document.getElementById("btn-attrib"); if (!logoEl || !b) return;
    var r = b.getBoundingClientRect(); if (!r.height) return;
    logoEl.style.left = Math.round(r.left) + "px"; logoEl.style.bottom = Math.round(window.innerHeight - r.top + 8) + "px";
  }
  window.addEventListener("resize", function () { if (logoEl && !logoEl.hidden) placeLogo(); });
  function mbOff() {
    if (mb) { try { if (map.hasLayer(mb)) map.removeLayer(mb); } catch (e) {} }
    logo(false);
  }
  function applyMb(seq, why) {
    if (mbFailed) { fallback("mapbox_failed"); return Promise.resolve("classic"); }
    return loadMb().then(function () {
      if (seq !== applySeq) return cur;
      dropGL(); cur = "mapbox";
      if (!mbLoaded) rastersOn(true);   // the old map stays until Mapbox has drawn
      document.documentElement.setAttribute("data-basemap", "mapbox");
      if (!mb) {
        mb = window.L.mapboxGL({ accessToken: CFG.MAPBOX_TOKEN, style: "mapbox://styles/mapbox/standard",
          config: { basemap: MB_CONFIG }, interactive: false, padding: 0.12, attributionControl: false,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2), fadeDuration: 120 });
        mb.addTo(map);
        var m = mb.getMapboxMap();
        m.on("load", function () { mbLoaded = true; if (cur === "mapbox") { rastersOn(false); attrOnLoad(); } });
        m.on("error", function (e) {
          if (!e || e.sourceId || e.tile) return;   // a missing tile (e.g. terrain DEM) is not fatal
          var st = e.error && e.error.status;
          if ((st === 401 || st === 403) && !mbLoaded) { mbFailed = true; if (cur === "mapbox") fallback("mapbox_" + st); }
        });
      } else {
        if (!map.hasLayer(mb)) mb.addTo(map);
        if (mbLoaded) rastersOn(false);
      }
      logo(true);
      showOnLoad = why === "user" || why === "start";
      if (mbLoaded) attrOnLoad(); else setAttr(false);
      if (why === "user" && A && A.toast) A.toast(T("on")[0]);
      return "mapbox";
    }).catch(function (e) { if (seq === applySeq) fallback(e && e.message || "mb_error"); return "classic"; });
  }

  // Page hidden (camera, gallery, app switch): release the WebGL context. Visible again: rebuild from the kept style.
  document.addEventListener("visibilitychange", function () {
    if (!map) return;
    if (document.hidden) {
      if (gl && map.hasLayer(gl)) { try { map.removeLayer(gl); } catch (e) {} hiddenOff = true; glLoaded = false; }
    } else if (hiddenOff) {
      hiddenOff = false;
      if (gl && cur !== "classic") { try { gl.addTo(map); hookGL(gl); } catch (e) { fallback("restore"); } }
    }
  });

  function choice() { var v = U.ls.get(KEY, DEFAULT); return VARIANTS.indexOf(v) >= 0 ? v : DEFAULT; }

  function settingsBlock(body) {
    var el = A.el;
    if (!document.getElementById("bm-css")) {
      var st = document.createElement("style"); st.id = "bm-css";
      st.textContent = ".bm-seg{flex-direction:row;flex-wrap:wrap;width:100%}.bm-seg button{flex:1 1 40%;min-width:0}.bm-seg button[data-bm=mapbox]{flex-basis:100%}" +
        ".bm-seg button+button{border-top:0}.bm-seg .bm-b{font-size:var(--fs-xs,11px);opacity:.75;margin-left:4px;text-transform:uppercase}";
      document.head.appendChild(st);
    }
    body.appendChild(el("h3", { text: T("title") }));
    var seg = el("div", { class: "seg bm-seg", role: "radiogroup", "aria-label": T("title") });
    var now = choice();
    VARIANTS.forEach(function (v) {
      var b = el("button", { type: "button", role: "radio", "aria-checked": String(now === v), "data-bm": v });
      b.appendChild(document.createTextNode(T(v)));
      if (v !== "classic") b.appendChild(el("span", { class: "bm-b", text: T("beta") }));
      b.addEventListener("click", function () {
        U.ls.set(KEY, v); failed = false; userAsked = true;
        Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute("aria-checked", String(x === b)); });
        apply(v, "user");
      });
      seg.appendChild(b);
    });
    body.appendChild(seg);
    body.appendChild(el("p", { class: "muted", style: "margin-top:6px", text: T("info") }));
  }

  window.BASEMAP = {
    VARIANTS: VARIANTS, PALETTES: P, recolor: recolor,
    current: function () { return cur; },
    loaded: function () { return cur === "mapbox" ? mbLoaded : !!(gl && glLoaded); },
    mapbox: function () { return mb; },
    layer: function () { return gl; },
    // Called by app.js right after the raster layers exist (before init). Starts the beta map at once when chosen.
    early: function (m, list) {
      map = m; rasters = (list || []).slice();
      var parts = [];
      rasters.forEach(function (l) { var a = l.getAttribution && l.getAttribution(); if (a && parts.indexOf(a) < 0) parts.push(a); });
      classicAttr = parts.join(" | ");
      var v = choice();
      if (v !== "classic") apply(v, "start");
    },
    set: function (v) { U.ls.set(KEY, v); failed = false; return apply(v, "api"); },
    init: function (api) { A = api; if (!map && api && api.map) { map = api.map; } },
    settingsSheet: function (body) { if (A && map) settingsBlock(body); },
    applyText: function () { if (cur !== "classic" && cur !== "mapbox" && gl && curLang !== (sv() ? "sv" : "en")) apply(cur, "lang"); }
  };
})();
