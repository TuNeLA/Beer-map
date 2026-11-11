/* Öl Nu — 🗺️ KARTSTIL: the ONE Mapbox GL map (CONTRACT "KARTSTIL 2/3", "KARTSTIL 5 · bara Mapbox", "KARTSTIL 6 · MBX").
   window.BASEMAP. app.js calls BASEMAP.early(map, rasterLayers) right after the raster tiles are made, and the
   mods() hooks init, settingsSheet and applyText. mbx (owner 2026-11-07: "move everything to Mapbox"): no Leaflet, no
   bridge plugin. js/mbx.js is the map API; here the mapboxgl.Map is made IN the map container and handed to it
   (map._attachGL). The raster tiles of app.js are only the start frame / the silent fallback (mbx.js raster engine).
   - glmap (owner 2026-11-07): ONLY two styles, both Mapbox Standard: ⭐ Skymning "mb-dusk" (default for everyone) and
     Natt "mb-night" (the Ludvika-tuned dark one). Every other stored value (Klassisk, the free MapLibre styles, the
     other Mapbox styles) = Skymning. The MapLibre / OpenFreeMap code is gone.
   - ONE Mapbox map object per page load (= one billed web map load, free tier ≈ 50 000 / month): Skymning ↔ Natt is
     setConfig on the same Standard style (no new map, no new style download). The object is never re-created: not on a
     style switch, not when the page is hidden / visible again, not on resume. BASEMAP.mapboxLoads() counts them (1).
   - Silent fallback: no token, no WebGL, the Mapbox script or style does not load, Mapbox 401/403 = the free raster
     tiles app.js made ("classic", not in the picker) for this page life. No toast unless the user tapped a style.
   - The raster layers stay on the map until the GL map has loaded (no blank map), then they are removed.
   - The token: CFG.MAPBOX_TOKEN, else the public_config() RPC (anon), cached in localStorage "olnu.mbToken".
   - Attribution in the ⓘ popover + the Mapbox logo above the ⓘ button (Mapbox terms). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var KEY = "olnu.mapStyle", DEFAULT = "mb-dusk", TIP = "mb-dusk", TOKEN_KEY = "olnu.mbToken";
  var MB_VER = "3.32.0";
  var MB_JS = "https://cdn.jsdelivr.net/npm/mapbox-gl@" + MB_VER + "/dist/mapbox-gl.js";
  var MB_CSS = "https://cdn.jsdelivr.net/npm/mapbox-gl@" + MB_VER + "/dist/mapbox-gl.css";
  var ATTR_MB = '&copy; <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> ' +
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> ' +
    '<a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener"><strong>Improve this map</strong></a>';
  var CFG = window.OLNU_CONFIG || {};

  /* ---------- The style list (best first). chip = [land, accent] for the little preview swatch. ---------- */
  var STD = "mapbox://styles/mapbox/standard";
  // Standard: our own POIs are the bars, so Mapbox POI + transit labels are off; 3D buildings + landmarks on
  // (under Leaflet there is no pitch, so they show as shaded footprints seen from above); trees/facades off (GPU).
  // map3: big landmarks keep their icon + name (showLandmarkIcons); shields, exit numbers, house numbers etc. are hidden in clean().
  function stdCfg(preset, theme, colors) {
    var c = { lightPreset: preset, theme: theme || "default", showPointOfInterestLabels: false, showTransitLabels: false,
      showPedestrianRoads: true, show3dObjects: true, show3dBuildings: true, show3dLandmarks: true, show3dTrees: false, show3dFacades: false,
      showLandmarkIcons: true, showLandmarkIconLabels: true,
      // map4: js/map3d.js marks the bar's real Mapbox house (feature-state highlight) and an arena on match days (select)
      colorBuildingHighlight: "#ffb020", colorBuildingSelect: "#8fd8ff" };
    for (var k in colors || {}) c[k] = colors[k];
    return c;
  }
  // map3 "Ludvika looks": tuned over Ludvika centre at zoom 13–17 (map3-ludvika.png). Colours go through the Standard config;
  // look = small changes in the basemap import: water = flat deep blue (no depth darkening), amber = main streets
  // [primary, secondary/tertiary], ambient = a brighter ambient light so dusk/night are not too dark.
  // map4 (owner: "the road is too orange"): amber is kept for OUR data (bars, ÖL!, heat); the base map's main roads are
  // cool slate a step lighter than the minor streets, and main roads are drawn at 80 % width (thin: [factor]).
  // look.amber = [primary, secondary/tertiary] colours (name kept from map3).
  var LOOK_DUSK = { water: 1, amber: ["#cfcae6", "#c0bbdb"], thin: 0.8, ambient: { intensity: 0.32, color: "hsl(235, 30%, 55%)" } };
  var LOOK_NIGHT = { water: 1, amber: ["#9aa6c6", "#8b97b9"], thin: 0.8, ambient: { intensity: 0.35, color: "hsl(225, 35%, 45%)" } };
  var LIST = [
    { id: "mb-dusk", light: 1, mb: STD, look: LOOK_DUSK, cfg: stdCfg("dusk", "", { colorWater: "#2a78ee", colorGreenspace: "#5aa868", colorLand: "#6a6790",
      colorMotorways: "#dcd8ef", colorTrunks: "#d6d1ea", colorRoads: "#b3aed0", colorPlaceLabels: "#fff6e6", colorRoadLabels: "#efe8fa", colorBuildings: "#8b87b0" }),
      chip: ["#5b567a", "#cfcae6"], sv: "Skymning", en: "Dusk" },
    { id: "mb-night", mb: STD, look: LOOK_NIGHT, cfg: stdCfg("night", "", { colorWater: "#2f6fd8", colorGreenspace: "#5f9e68", colorLand: "#4a5678",
      colorMotorways: "#b0bbd8", colorTrunks: "#a5b0cf", colorRoads: "#7d8bb0", colorPlaceLabels: "#efe4c8", colorRoadLabels: "#b8c0d6", colorBuildings: "#55618a" }),
      chip: ["#1c2742", "#9aa6c6"], sv: "Natt", en: "Night" },
    { id: "classic", hidden: 1, chip: ["#22252b", "#e6e0d2"], sv: "Reserv", en: "Fallback" }
  ];
  var BY = {}; LIST.forEach(function (s) { BY[s.id] = s; });
  var ALIAS = { mapbox: "mb-night" };   // anything else unknown → DEFAULT (Skymning)

  var A = null, map = null, rasters = [], classicAttr = "";
  var cur = "classic", failed = false;
  var mb = null, mbLoaded = false, mbP = null, mbFailed = false, logoEl = null, mbUrl = "", mbLoads = 0, mbStyleBusy = false;
  var attrTimer = 0, lastToast = -1;

  /* ---------- Mapbox token: config.js, else the database (public_config RPC), cached per phone ---------- */
  var token = CFG.MAPBOX_TOKEN || U.ls.get(TOKEN_KEY, "") || "", tokenP = null;
  if (!/^pk\./.test(token)) token = "";
  function fetchToken() {
    if (tokenP) return tokenP;
    if (CFG.MAPBOX_TOKEN || !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !window.fetch) { tokenP = Promise.resolve(token); return tokenP; }
    tokenP = fetch(CFG.SUPABASE_URL + "/rest/v1/rpc/public_config", { method: "POST", credentials: "omit",
      headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + CFG.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: "{}" })
      .then(function (r) { if (!r.ok) throw new Error("cfg " + r.status); return r.json(); })
      .then(function (d) {
        try { localStorage.setItem("olnu.mbTokenAt", String(Date.now())); } catch (e) {}   // perf (load fix 7): asked at most once per 10 min
        var t = d && typeof d === "object" && !Array.isArray(d) && typeof d.mapbox_token === "string" && /^pk\.[\w.-]{20,}$/.test(d.mapbox_token) ? d.mapbox_token : "";
        if (t) { token = t; U.ls.set(TOKEN_KEY, t); }
        else if (d && typeof d === "object" && !Array.isArray(d) && "mapbox_token" in d) { token = ""; U.ls.del(TOKEN_KEY); }   // removed on the server
        return token;
      })
      .catch(function () { return token; });   // offline / old server: keep the cached one
    return tokenP;
  }
  function variants() { return LIST.filter(function (s) { return s.mb; }).map(function (s) { return s.id; }); }   // the picker: exactly 2 rows

  function sv() { return !I || I.lang !== "en"; }
  var S = {
    sv: { title: "🗺️ Kartstil", tip: "Chefens val", row: "Kartstil", hint: "Skymning ä chefens val. Natt ä mörkare.",
      info: "Skymning ä chefens favorit, Natt ä för mörka kvällar. Krogar, värme och pins ä som vanligt.",
      fail: "🗺️ Kartan vägrade starta här. Kör reservkartan så länge.",
      on: ["🗺️ Ny karta i drift. Spaningsläge: på.", "🗺️ Kartan bytt. Samma krogar, nytt ljus.", "🗺️ Klart! Ny terräng, samma uppdrag.",
        "🗺️ Kartan ä laddad. Säg till om nåt ser konstigt ut!", "🗺️ Ny karta. Krogarna lyser som förut.", "🗺️ Bytt! Spanarn ser allt nu."] },
    en: { title: "🗺️ Map style", tip: "⭐ Boss's pick", row: "Map style", hint: "Dusk is the boss's pick. Night is darker.",
      info: "Dusk is the boss's favourite, Night is for dark evenings. Bars, heat and pins stay the same.",
      fail: "🗺️ The map would not start here. Using the backup map for now.",
      on: ["🗺️ New map deployed. Recon mode: on.", "🗺️ Map switched. Same bars, new light.", "🗺️ Done! New terrain, same mission.",
        "🗺️ Map loaded. Tell us if something looks odd!", "🗺️ New map. The bars glow like before.", "🗺️ Switched! Recon sees everything now."] }
  };
  function T(k) { return (sv() ? S.sv : S.en)[k]; }
  function nameOf(id) { var s = BY[id]; return s ? (sv() ? s.sv : s.en) : id; }

  /* ---------- Loading ---------- */
  function addScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = src; s.async = false; s.crossOrigin = "anonymous";
      s.onload = res; s.onerror = function () { rej(new Error("load " + src)); };
      document.head.appendChild(s);
    });
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
  function isMb(id) { return !!(BY[id] && BY[id].mb); }

  /* ---------- Attribution (ⓘ popover) ---------- */
  var extraAttr = "";   // e.g. js/barlit.js: building outlines (OSM, Microsoft)
  function setAttr(showIt) {
    var pop = document.getElementById("attrib-pop"), btn = document.getElementById("btn-attrib");
    if (!pop) return;
    // Only our own credit span changes: other modules add their own parts to the popover (invite.js map legend).
    creditEl(pop).innerHTML = (cur === "classic" ? classicAttr : ATTR_MB) + (extraAttr ? " | " + extraAttr : "");   // static strings only
    if (showIt && !(window.OLNU_STRIP && window.OLNU_STRIP.up && window.OLNU_STRIP.up())) {
      clearTimeout(attrTimer);
      pop.hidden = false; if (btn) btn.setAttribute("aria-expanded", "true");
      attrTimer = setTimeout(function () { pop.hidden = true; if (btn) btn.setAttribute("aria-expanded", "false"); }, 5000);
    }
  }
  // The credit text lives in span.bm-credit (made in early(): app.js has just put the raster credit into the popover).
  function creditEl(pop) {
    var c = pop.querySelector(".bm-credit");
    if (!c) {
      c = document.createElement("span"); c.className = "bm-credit";
      while (pop.firstChild) c.appendChild(pop.firstChild);
      pop.insertBefore(c, pop.firstChild);
    }
    return c;
  }
  var showOnLoad = false;
  function attrOnLoad() { showOnLoad = false; setAttr(false); }   // calm: never auto-open (owner 2026-10-22)

  /* ---------- Switching ---------- */
  // mbx: the raster layers stay on the map object; mbx.js draws them only while no GL map has drawn (start frame, fallback)
  function rastersOn(on) {
    rasters.forEach(function (l) { try { if (!map.hasLayer(l)) l.addTo(map); } catch (e) {} });
  }
  function fallback(why) {
    try { console.warn("olnu basemap", why); } catch (e) {}
    failed = true; mbOff(); cur = "classic"; rastersOn(true); setAttr(false);
    document.documentElement.removeAttribute("data-basemap");
    if (A && A.toast && userAsked) A.toast(T("fail"));
    emit();
  }
  var userAsked = false, applySeq = 0;
  // Light styles: the HUD vignette (polish.css) is made fainter so the map is not darkened at the edges.
  function lightAttr() {
    var de = document.documentElement, on = !!(BY[cur] && BY[cur].light);
    if (on) de.setAttribute("data-bm-light", ""); else de.removeAttribute("data-bm-light");
    if (on && !document.getElementById("bm-light-css")) {
      var st = document.createElement("style"); st.id = "bm-light-css";
      st.textContent = "html[data-bm-light] .hud-overlay{background:radial-gradient(ellipse at center,transparent 66%,rgba(0,0,0,.16) 100%)}";
      document.head.appendChild(st);
    }
  }
  function emit() { lightAttr(); try { document.dispatchEvent(new CustomEvent("basemap:change", { detail: { style: cur } })); } catch (e) {} }
  function toastOn(why) {
    if (why !== "user" || !A || !A.toast) return;
    var o = T("on"), i; do { i = Math.floor(Math.random() * o.length); } while (o.length > 1 && i === lastToast); lastToast = i; A.toast(o[i]);
  }
  function norm(name) { name = ALIAS[name] || name; return variants().indexOf(name) >= 0 ? name : null; }
  function apply(name, why) {
    var seq = ++applySeq;
    name = norm(name) || DEFAULT;
    if (failed || !token || !isMb(name)) {   // silent fallback: the free raster tiles
      cur = "classic"; rastersOn(true); mbOff(); setAttr(false);
      document.documentElement.removeAttribute("data-basemap");
      emit();
      return Promise.resolve("classic");
    }
    if (!webglOk()) { fallback("no_webgl"); return Promise.resolve("classic"); }
    return applyMb(name, seq, why);
  }

  /* ---------- Mapbox ---------- */
  function loadMb() {
    if (mbP) return mbP;
    if (!document.querySelector('link[data-basemap-mb]')) {
      var ln = document.createElement("link"); ln.rel = "stylesheet"; ln.href = MB_CSS; ln.setAttribute("data-basemap-mb", "1"); ln.crossOrigin = "anonymous";
      document.head.appendChild(ln);
    }
    // index.html loads mapbox-gl.js before js/mbx.js; this only helps when that CDN request failed once
    mbP = (window.mapboxgl ? Promise.resolve() : addScript(MB_JS))
      .then(function () { if (!window.mapboxgl || !window.mapboxgl.Map) throw new Error("no_mb_lib"); });
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
  function placeLogo() {
    var b = document.getElementById("btn-attrib"); if (!logoEl || !b) return;
    var r = b.getBoundingClientRect(); if (!r.height) return;
    logoEl.style.left = Math.round(r.left) + "px"; logoEl.style.bottom = Math.round(window.innerHeight - r.top + 8) + "px";
  }
  window.addEventListener("resize", function () { if (logoEl && !logoEl.hidden) placeLogo(); });
  // the fallback: the GL map goes (a new one later = a new billed load, so only after a real failure), mbx.js draws the rasters
  function mbOff() {
    if (mb) { try { map._detachGL(false); } catch (e) {} }   // parked: a way back without a new map load
    try { ["bars", "hotbars"].forEach(function (n) { map.setVirtualPane(n, false); }); } catch (e) {}
    logo(false);
  }
  /* ---------- map3: a clean map (no road number shields, exit numbers, house numbers, one-way arrows, POI/transit icons) ----------
     Street NAMES stay. Classic Mapbox styles: the layers are hidden by id. Standard (an import): there is no config switch
     for shields alone (showRoadLabels also hides the names), so the layers are hidden inside the "basemap" import
     (style.getFragmentStyle — not public API; any error = the map just keeps them). Big landmarks keep their icon. */
  var CLUTTER = /shield|road-number|road-intersection|level-crossing|oneway-arrow|building-number-label|block-number-label|turning-feature|incident-|gate-label|golf-hole|^crosswalks|^poi-label|^transit-label|^airport-label/;
  var lookSaved = null, lookErr = "";   // the import's own paint values / lights, kept so another Standard variant can put them back
  function frag(m) { try { return m.style && m.style.getFragmentStyle ? m.style.getFragmentStyle("basemap") || null : null; } catch (e) { return null; } }
  function clean(m) {
    var n = 0, fr = frag(m);
    try {
      if (fr && fr._layers) Object.keys(fr._layers).forEach(function (id) {
        if (CLUTTER.test(id)) { try { fr.setLayoutProperty(id, "visibility", "none"); n++; } catch (e) {} }
      });
      else (m.getStyle().layers || []).forEach(function (l) {
        if (CLUTTER.test(l.id)) { m.setLayoutProperty(l.id, "visibility", "none"); n++; }
      });
    } catch (e) {}
    return n;
  }
  function amberExpr(o, a) {
    var w = function (x) { return ["match", ["get", "class"], ["primary", "primary_link"], a[0], ["secondary", "secondary_link", "tertiary", "tertiary_link"], a[1], x]; };
    // A zoom "step" must stay the outermost expression: wrap each of its outputs.
    if (Array.isArray(o) && o[0] === "step") return o.map(function (x, i) { return i >= 2 && i % 2 === 0 ? w(x) : x; });
    if (Array.isArray(o) && /^interpolate/.test(o[0])) return o.map(function (x, i) { return i >= 4 && i % 2 === 0 ? w(x) : x; });
    return w(o);
  }
  function thinExpr(o, f) {
    var w = function (x) { return ["*", x, ["match", ["get", "class"], ["motorway", "trunk", "primary", "secondary", "tertiary"], f, 1]]; };
    if (Array.isArray(o) && o[0] === "step") return o.map(function (x, i) { return i >= 2 && i % 2 === 0 ? w(x) : x; });
    if (Array.isArray(o) && /^interpolate/.test(o[0])) return o.map(function (x, i) { return i >= 4 && i % 2 === 0 ? w(x) : x; });
    return typeof o === "number" || Array.isArray(o) ? w(o) : o;
  }
  /* map4: Mapbox's own 3D houses from zoom 14 (Leaflet; GL 13) instead of 16, fading in. The tiles carry the large
     buildings from GL 13 and all of them from GL 16 (Mapbox Streets v8), so the big ones come first. */
  var BLD = ["3d-building", "2d-building", "2d-building-outline", "building-underground"], BLD_Z = 13;
  function buildingsNear(fr) {
    BLD.forEach(function (id) {
      var l = fr._layers[id]; if (!l) return;
      try {
        if (l.minzoom > BLD_Z) fr.setLayerZoomRange(id, BLD_Z, l.maxzoom || 24);
        if (id === "3d-building") fr.setPaintProperty(id, "fill-extrusion-opacity", ["interpolate", ["linear"], ["zoom"], BLD_Z, 0, BLD_Z + 0.8, 1]);
      } catch (e) {}
    });
  }
  /* mbx: zoomed out our zone labels (js/zones.js) carry the map: the Mapbox country / state / town names step back a little
     (text 65 % until Leaflet z 10.5, where the zones end); collisions (crossSourceCollisions) hide the ones under a zone label */
  var PLACE_LBL = /^(country-label|state-label|settlement-major-label|settlement-minor-label|settlement-subdivision-label|continent-label)$/;
  function zoneLabels(fr) {
    Object.keys(fr._layers).forEach(function (id) {
      if (!PLACE_LBL.test(id)) return;
      try { fr.setPaintProperty(id, "text-opacity", ["interpolate", ["linear"], ["zoom"], 2, 0.65, 8.8, 0.65, 9.6, 1]); } catch (e) {}
    });
  }
  function look(m, st) {
    var fr = frag(m); if (!fr || !fr._layers) return;
    var L0 = st.look || {};
    try {
      if (!lookSaved) {
        lookSaved = { paint: {}, lights: null };
        ["roads", "bridge-roads", "water"].forEach(function (id) {
          var l = fr._layers[id], p = id === "water" ? "fill-color" : "line-color", o = {};
          if (l) { o[p] = fr.getPaintProperty(id, p); if (p === "line-color") o["line-width"] = fr.getPaintProperty(id, "line-width"); lookSaved.paint[id] = o; }
        });
      }
      ["roads", "bridge-roads"].forEach(function (id) {
        var o = lookSaved.paint[id]; if (!o || o["line-color"] == null) return;
        fr.setPaintProperty(id, "line-color", L0.amber ? amberExpr(o["line-color"], L0.amber) : o["line-color"]);
        if (o["line-width"] != null) fr.setPaintProperty(id, "line-width", L0.thin ? thinExpr(o["line-width"], L0.thin) : o["line-width"]);
      });
      buildingsNear(fr);
      zoneLabels(fr);
      if (lookSaved.paint.water) fr.setPaintProperty("water", "fill-color", L0.water ? ["config", "colorWater"] : lookSaved.paint.water["fill-color"]);
      if (fr._layers["water-depth"]) fr.setLayoutProperty("water-depth", "visibility", L0.water ? "none" : "visible");
      // Lights: the import's lights with a brighter ambient; null = back to the import's own.
      if (L0.ambient) {
        m.setLights(null);
        var base = m.getLights() || [];
        m.setLights(base.map(function (l) { return l.type === "ambient" ? { id: l.id, type: l.type, properties: Object.assign({}, l.properties, L0.ambient) } : l; }));
      } else if (lookSaved.lit) m.setLights(null);
      lookSaved.lit = !!L0.ambient;
    } catch (e) { lookErr = String(e && e.message || e); try { console.warn("olnu basemap look", lookErr); } catch (x) {} }
  }
  function mbStyled(m) {
    var s = BY[cur]; if (!s || !s.mb) return;
    clean(m);
    if (s.cfg && s.mb === STD) look(m, s);
    m.triggerRepaint();
  }
  function mbSetStyle(st) {
    var m = mb.getMapboxMap();
    if (mbUrl === st.mb && st.cfg) {   // same Standard style: only the config changes (no new style download)
      try { m.setConfig("basemap", st.cfg); mbStyled(m); return; } catch (e) {}
    }
    lookSaved = null;
    mbUrl = st.mb; mbStyleBusy = true;
    var o = { diff: false }; if (st.cfg) o.config = { basemap: st.cfg };
    m.setStyle(st.mb, o);
  }
  function applyMb(name, seq, why) {
    if (mbFailed) { fallback("mapbox_failed"); return Promise.resolve("classic"); }
    var st = BY[name];
    return loadMb().then(function () {
      if (seq !== applySeq) return cur;
      cur = name;
      if (!mbLoaded) rastersOn(true);   // the old map stays until Mapbox has drawn
      document.documentElement.setAttribute("data-basemap", name);
      if (!mb) {
        mbUrl = st.mb;
        // map3 perf: no label fade, no MSAA, Mercator, no world copies. mbx: our own symbols (bars, zones) DO collide with the
        // Mapbox labels (crossSourceCollisions on): a street / town name under a bar pill or a zone label is left out
        // (owner screenshots 2026-11-07: "79 kr" pill over street names, zone labels on top of country names).
        window.mapboxgl.accessToken = token;
        var c = map.getCenter(), opts = { container: map.getContainer(), style: st.mb, center: [c.lng, c.lat], zoom: Math.max(0, map.getZoom() - 1),
          minZoom: Math.max(0, map.getMinZoom() - 1), maxZoom: map.getMaxZoom() - 1, attributionControl: false, renderWorldCopies: false,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2), fadeDuration: 180, antialias: false,   /* map M2: symbols fade (clusters split / merge, pills), no pop */ projection: "mercator",
          crossSourceCollisions: true, performanceMetricsCollection: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0,
          bearingSnap: 180, clickTolerance: 4, refreshExpiredTiles: false };
        if (st.cfg) opts.config = { basemap: st.cfg };
        var m = new window.mapboxgl.Map(opts); mbLoads++;
        mb = { getMapboxMap: function () { return m; } };
        map._attachGL(m);
        m.on("load", function () { mbLoaded = true; if (isMb(cur)) { rastersOn(false); attrOnLoad(); } });
        m.on("style.load", function () {
          mbStyleBusy = false; lookSaved = null;
          var s = BY[cur]; if (!s || !s.mb) return;
          if (s.cfg && s.mb === mbUrl) { try { m.setConfig("basemap", s.cfg); } catch (e) {} }
          mbStyled(m);
        });
        m.on("error", function (e) {
          if (!e || e.sourceId || e.tile) return;   // a missing tile (e.g. terrain DEM) is not fatal
          var code = e.error && e.error.status;
          if ((code === 401 || code === 403) && !mbLoaded) { mbFailed = true; if (isMb(cur)) fallback("mapbox_" + code); }
        });
      } else {
        if (map.isGL && !map.isGL()) map._attachGL(mb.getMapboxMap());   // back from the fallback: the same map object
        mbSetStyle(st);
        if (mbLoaded) rastersOn(false);
      }
      logo(true);
      showOnLoad = why === "user" || why === "start";
      if (mbLoaded) attrOnLoad(); else setAttr(false);
      toastOn(why); emit();
      return name;
    }).catch(function (e) { if (seq === applySeq) fallback(e && e.message || "mb_error"); return "classic"; });
  }

  function stored() {
    var v = U.ls.get(KEY, DEFAULT); v = ALIAS[v] || v;
    if (!BY[v] || !BY[v].mb) { v = DEFAULT; U.ls.set(KEY, v); }   // glmap: Klassisk / free / other Mapbox styles → Skymning
    return v;
  }
  function choice() { return norm(stored()) || DEFAULT; }

  var sheetSeg = null;
  function fillSeg(seg) {
    var el = A.el, now = choice();
    while (seg.firstChild) seg.removeChild(seg.firstChild);
    variants().forEach(function (v) {
      var st = BY[v];
      var b = el("button", { type: "button", role: "radio", "aria-checked": String(now === v), "data-bm": v });
      var chip = el("span", { class: "bm-chip", "aria-hidden": "true" });
      chip.style.background = "linear-gradient(135deg," + st.chip[0] + " 0 58%," + st.chip[1] + " 58% 100%)";
      b.appendChild(chip);
      b.appendChild(el("span", { class: "bm-n", text: nameOf(v) }));
      if (v === TIP && !seg.classList.contains("bm-seg2")) b.appendChild(el("span", { class: "bm-b", text: T("tip") }));   // the 2-style row says it in the hint
      b.addEventListener("click", function () {
        U.ls.set(KEY, v); failed = false; userAsked = true;
        Array.prototype.forEach.call(seg.querySelectorAll("[data-bm]"), function (x) { x.setAttribute("aria-checked", String(x === b)); });
        apply(v, "user");
      });
      seg.appendChild(b);
    });
  }
  function settingsBlock(body) {
    var el = A.el;
    if (!document.getElementById("bm-css")) {
      var st = document.createElement("style"); st.id = "bm-css";
      // 2 columns of small rows with a colour swatch. Selectors carry .bm-grid so they win over ds.css' list rules.
      st.textContent =
        ".sheet .seg.bm-seg.bm-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:4px 12px 8px;flex-direction:unset}" +
        ".sheet .seg.bm-seg.bm-grid>.bm-gh{grid-column:1/-1;font:600 12px/16px var(--ds-sans,sans-serif);letter-spacing:.06em;text-transform:uppercase;color:var(--ds-muted,#8b93a7);padding:8px 2px 0}" +
        ".sheet .seg.bm-seg.bm-grid>button{min-height:48px;padding:0 8px;gap:8px;border:1px solid var(--ds-border,#2a3550) !important;border-radius:12px;font-size:14px;line-height:18px;background:var(--ds-card,#19233a)}" +
        ".sheet .seg.bm-seg.bm-grid>button+button{border-top:1px solid var(--ds-border,#2a3550)}" +
        ".sheet .seg.bm-seg.bm-grid>button[aria-checked=true]{border-color:var(--ds-amber,#f5a623) !important;box-shadow:0 0 0 1px var(--ds-amber,#f5a623) inset !important}" +
        ".sheet .seg.bm-seg.bm-grid>button[aria-checked=true]::after{right:8px;font-size:14px}" +
        ".bm-chip{flex:0 0 22px;width:22px;height:22px;border-radius:6px;box-shadow:0 0 0 1px rgba(255,255,255,.18) inset}" +
        ".bm-n{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:14px}" +
        ".bm-seg .bm-b{position:absolute;top:-7px;right:6px;font:700 10px/14px var(--ds-sans,sans-serif);padding:0 5px;border-radius:7px;background:var(--ds-amber,#f5a623);color:var(--ds-on-amber,#241300);white-space:nowrap}" +
        // map R1-16: 2–4 styles = the ONE segmented control (ds-seg); the tip badge is a 12 px token pill inside the item
        ".ds-seg.bm-seg2>button{gap:var(--sp-2)}" +
        ".bm-seg2 .bm-chip{flex:0 0 18px;width:18px;height:18px;border-radius:var(--r-xs)}" +
        ".bm-seg2 .bm-n{flex:0 1 auto;padding:0}" +
        // followups (owner 11 Nov): Kartstil = a normal settings row (icon + title like "Visa restauranger"); the segmented
        // control is its own line INSIDE the row padding; "Chefens val" lives in the hint (no pill in the segment)
        ".toggle-row.bm-row{flex-wrap:wrap}" +
        ".toggle-row.bm-row>span{flex:1 1 auto;min-width:0}" +
        ".toggle-row.bm-row>.bm-seg2{flex:1 0 100%;margin:0}" +
        ".bm-seg2 .bm-b{flex:0 0 auto;font:600 var(--fs-12)/16px var(--ds-sans,sans-serif);padding:0 var(--sp-1);border-radius:var(--r-xs);background:var(--ds-amber,#f5a623);color:var(--ds-on-amber,#241300);white-space:nowrap}";
      document.head.appendChild(st);
    }
    body.appendChild(el("h3", { text: T("title") }));
    var few = variants().length <= 4;   // map R1-16: the segmented control for 2–4 styles (today: Skymning · Natt)
    var seg = sheetSeg = el("div", { class: few ? "ds-seg bm-seg2" : "seg bm-seg bm-grid", role: "radiogroup", "aria-label": few ? T("row") : T("title") });
    fillSeg(seg);
    if (few) {
      // ds.js makes the row + the hint after it ONE settings item (same as the toggle rows above and below)
      var lab = el("span", {}); lab.innerHTML = (window.PNI && window.PNI.has("map") ? window.PNI.svg("map", "pi-lead") : "") ;
      lab.appendChild(document.createTextNode(T("row")));
      body.appendChild(el("div", { class: "toggle-row bm-row" }, [lab, seg]));
      body.appendChild(el("p", { class: "muted bm-hint", text: T("hint") }));
      return;
    }
    body.appendChild(seg);
    body.appendChild(el("p", { class: "muted", style: "margin-top:6px", text: T("info") }));
  }

  window.BASEMAP = {
    LIST: LIST,
    get VARIANTS() { return variants(); },
    DEFAULT: DEFAULT,
    current: function () { return cur; },
    isMapbox: function () { return isMb(cur); },
    loaded: function () { return isMb(cur) && mbLoaded && !mbStyleBusy; },
    mapbox: function () { return mb; },
    mapboxLoads: function () { return mbLoads; },
    // Test hook (map3): visibility of the shield / clutter layers and the look in the current Mapbox style.
    _clean: function () {
      if (!mb || !isMb(cur)) return null;
      var m = mb.getMapboxMap(), fr = frag(m), out = { shields: [], visible: [], amber: false, water: null, lights: false };
      try {
        var ids = fr && fr._layers ? Object.keys(fr._layers) : (m.getStyle().layers || []).map(function (l) { return l.id; });
        ids.forEach(function (id) {
          if (!CLUTTER.test(id)) return;
          var v = fr ? fr.getLayoutProperty(id, "visibility") : m.getLayoutProperty(id, "visibility");
          if (/shield|road-number/.test(id)) out.shields.push(id + "=" + v);
          if (v !== "none") out.visible.push(id);
        });
        if (fr && fr._layers.roads) out.amber = /primary/.test(JSON.stringify(fr.getPaintProperty("roads", "line-color")).slice(0, 80));
        if (fr && fr._layers["water-depth"]) out.water = fr.getLayoutProperty("water-depth", "visibility");
        out.lights = !!(lookSaved && lookSaved.lit); if (lookErr) out.lookErr = lookErr;
      } catch (e) { out.err = e.message; }
      return out;
    },
    layer: function () { return null; },   // the MapLibre layer is gone (glmap)
    gl: function () { return mb ? mb.getMapboxMap() : null; },
    token: function () { return token; },
    tokenReady: fetchToken,
    // Extra credit text for the ⓘ popover (static HTML from our own modules only).
    setExtraAttribution: function (html) { extraAttr = html || ""; setAttr(false); },
    // Called by app.js right after the raster layers exist (before init). Starts the chosen map at once.
    early: function (m, list) {
      map = m; rasters = (list || []).slice();
      var parts = [];
      rasters.forEach(function (l) { var a = l.getAttribution && l.getAttribution(); if (a && parts.indexOf(a) < 0) parts.push(a); });
      classicAttr = parts.join(" | ");
      var pop = document.getElementById("attrib-pop"); if (pop) creditEl(pop);
      var v = stored();
      // perf (load fix 7): public_config at most once per 10 min (a reopened app uses the answer it has)
      var tAt = 0; try { tAt = +localStorage.getItem("olnu.mbTokenAt") || 0; } catch (e) {}
      var tFresh = !CFG.MAPBOX_TOKEN && Date.now() - tAt < 10 * 60e3 && tAt <= Date.now();
      if (!token && !tFresh) {
        // A Mapbox style but no token on this phone yet (first visit, cleared storage): ask the database first.
        fetchToken().then(function () { if (stored() === v) apply(v, "start"); });
      } else {
        apply(v, "start");
        if (!CFG.MAPBOX_TOKEN && !tFresh) setTimeout(fetchToken, 4000);   // refresh the cached token once per page life
      }
    },
    set: function (v) {
      if (v === "classic") { applySeq++; fallback("api"); return Promise.resolve("classic"); }   // tests: the silent raster fallback (not stored)
      U.ls.set(KEY, v); failed = false; return apply(v, "api");
    },
    init: function (api) { A = api; if (!map && api && api.map) { map = api.map; } },
    settingsSheet: function (body) { if (A && map) settingsBlock(body); },
    applyText: function () { if (sheetSeg && sheetSeg.isConnected) fillSeg(sheetSeg); }
  };
})();
