/* PintsNow — Hemzon (home zone). CONTRACT v14 "Hemzon", phone only: localStorage olnu.home = {lat, lng, r, ar, at}.
   Row "Hemzon: på · 150 m ›" in Inställningar (pnvis.js) / settingsName → this sheet. Nothing leaves the phone.
   I-127 (owner 16 Nov 2026: "no autocomplete, not the Mapbox map, too tall, the orange lines get cut, more accuracy"):
   - ONE screen (390x844 and 360x640, Spara included): one short line + an (i) that opens the full text; the address
     suggestions float OVER the map (they never push Spara down); the map height follows the screen height; "Använd
     nuvarande plats" sits on the map; radius = one row; "Ta bort" = a small text button next to Spara.
   - Search: PN.placeSearch (placesearch.js): Mapbox Geocoding v6 TEMPORARY suggestions while typing (config placeSearch:
     "mapbox"), Nominatim on Sök / Enter as the fallback. A pick moves the pin; nothing is saved before Spara.
   - Map: a small Mapbox GL map in the app's own style (BASEMAP: the current Standard style + its config), driven through
     mbx.js (L.map + _attachGL), so the circle / pin / tap code is the same for both engines. It uses the mapboxgl that
     index.html already loaded (no second copy) and is destroyed when the sheet closes (mini.remove() removes the GL map).
     One extra billed map load per open (Hemzon is opened rarely). No GL (no token, no WebGL, offline, the main map fell
     back, Mapbox 401/403) → the old free raster mini map (BASEMAP.miniLook / miniTiles), same code.
     Tap the map = the point · drag the pin = the point · pinch = zoom · the amber circle = the radius.
   - Radius: 25–1000 m on a stepped slider (5 m steps at the low end). A NEW zone starts at 100 m where many bars are
     around (>= 8 bars within 1 km = a big town), 300 m in the countryside (no bar within 3 km), else 150 m (unsure).
   - Saved: ar = the radius you chose (Auto hemma, autohome.js, uses it); r = max(ar, 100) = the privacy area that
     PRIVACY.inHome (v14.js) reads: a drink within 100 m of home is still only an area, as before I-127 (RMIN was 100).
     A drink inside the zone is posted as an area (≈ 550 m grid), never as the exact spot, unless you pick a bar. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, KEY = "olnu.home", R0 = 150, PRIV_MIN = 100;
  var STEPS = [25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 250, 300, 350, 400, 500, 600, 700, 800, 900, 1000];
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function home() { var h = U.ls.getJSON(KEY, null); return h && isFinite(h.lat) && isFinite(h.lng) ? h : null; }
  function zoneR(h) { return h ? +(h.ar || h.r) || R0 : R0; }   // the radius the user chose (old saves: r)
  function label() {
    var h = home();
    return h ? L("🏠 Hemzon: på · ", "🏠 Home zone: on · ") + zoneR(h) + " m" : L("🏠 Hemzon: av – sätt din hemadress", "🏠 Home zone: off – set your home");
  }
  function row(body) {
    var b = A.btn(label() + " ›", "btn-block hz-row", function () { open(); });
    body.appendChild(A.el("div", { class: "row hz-set", style: "margin-top:8px" }, [b]));
  }
  function stepOf(r) { var best = 0; STEPS.forEach(function (s, i) { if (Math.abs(s - r) < Math.abs(STEPS[best] - r)) best = i; }); return best; }
  function ic(n) { try { return window.PNI ? window.PNI.svg(n, "pi-lead") : ""; } catch (e) { return ""; } }

  /* ---------- the map: Mapbox GL in the app's style, or the raster fallback ---------- */
  function glStyle() {   // the app map's current Mapbox style, or null = use the raster mini map
    var B = window.BASEMAP, G = window.mapboxgl, st = null;
    try {
      if (!B || !B.isMapbox || !B.isMapbox() || !G || !G.Map || !/^pk\./.test(String(G.accessToken || ""))) return null;
      if (navigator.onLine === false) return null;
      (B.LIST || []).forEach(function (s) { if (s.id === B.current()) st = s; });
    } catch (e) { return null; }
    return st && st.mb ? st : null;
  }
  function attachGL(mini, mapEl, st) {
    var G = window.mapboxgl, c = mini.getCenter(), gl = null;
    var o = { container: mapEl, style: st.mb, center: [c.lng, c.lat], zoom: Math.max(0, mini.getZoom() - 1), attributionControl: false,
      renderWorldCopies: false, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), antialias: false, projection: "mercator", fadeDuration: 0,
      dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0, performanceMetricsCollection: false, refreshExpiredTiles: false };
    if (st.cfg) o.config = { basemap: st.cfg };
    try { gl = new G.Map(o); } catch (e) { return null; }
    try { gl.addControl(new G.AttributionControl({ compact: true }), "bottom-right"); } catch (e) {}
    var loaded = false;
    gl.on("load", function () { loaded = true; });
    gl.on("error", function (e) {   // the style or the token failed before the map drew: back to the raster map (destroyed, no leak)
      if (loaded || !e || e.sourceId || e.tile) return;
      try { if (mini.getMapboxMap && mini.getMapboxMap() === gl) mini._detachGL(true); } catch (x) {}
    });
    mini._attachGL(gl);
    return gl;
  }
  function makeMap(mapEl, c) {
    var Lf = window.L, mini = Lf.map(mapEl, { zoomControl: false, attributionControl: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false });
    // the raster look (a1map I-06): the start frame under GL and the whole map when GL is not there
    var B = window.BASEMAP;
    if (B && B.miniLook) { B.miniLook(mapEl); B.miniTiles().forEach(function (t) { Lf.tileLayer(t[0], t[1]).addTo(mini); }); }
    else Lf.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 19 }).addTo(mini);
    mini.setView(c, 15);
    var st = glStyle(), gl = st ? attachGL(mini, mapEl, st) : null;
    mapEl.setAttribute("data-engine", gl ? "gl" : "raster");
    return mini;
  }

  /* ---------- density: the default radius for a NEW zone ---------- */
  function densityR(la, ln) {
    var M = window.MBX;
    if (!M || !M.nearbyPlaces) return Promise.resolve(R0);
    return M.nearbyPlaces(la, ln, { maxM: 3000, max: 60, places: false, waitMs: 2000 }).then(function (l) {
      l = (l || []).map(function (x) { return x && x.d != null ? x.d : (x && x.bar ? U.haversine(la, ln, x.bar.lat, x.bar.lng) : (x && isFinite(x.lat) ? U.haversine(la, ln, x.lat, x.lng) : 1e9)); });
      var n1 = l.filter(function (d) { return d <= 1000; }).length;
      return n1 >= 8 ? 100 : l.length === 0 ? 300 : R0;
    }, function () { return R0; });
  }

  /* ---------- CSS (tokens only; one place for this sheet) ---------- */
  var CSS = ".hz2-info{display:flex;align-items:center;gap:var(--sp-1);margin:0 0 var(--sp-2)}" +
    ".hz2-line{flex:1 1 auto;margin:0;font-size:var(--fs-14);line-height:20px}" +
    ".hz2-i{flex:0 0 44px;width:44px;height:44px;min-height:44px;margin:-8px -8px -8px 0;padding:0;border:0;border-radius:50%;background:transparent;color:var(--ds-amber-t);display:grid;place-items:center;cursor:pointer}" +
    ".hz2-i svg{width:20px;height:20px;margin:0}.hz2-i[aria-expanded=true]{background:var(--ds-card)}" +
    ".hz2-more{margin:0 0 var(--sp-2);font-size:var(--fs-14);line-height:20px}.hz2-more[hidden]{display:none}" +
    ".hz2-sbox{position:relative;z-index:3}.hz2 .hz-search{flex-wrap:nowrap}.hz2 .hz-search .hz-qb{width:auto;flex:0 0 auto;padding:0 var(--sp-3)}" +
    ".hz2-sbox .ps-list{position:absolute;left:0;right:0;top:calc(100% - var(--sp-1));margin:0;padding:var(--sp-1);background:var(--ds-sheet);border:1px solid var(--ds-border-2);border-radius:var(--r-md);box-shadow:var(--ds-sh-2)}" +
    ".hz2-sbox .ps-msg{position:absolute;left:0;right:0;top:calc(100% - var(--sp-1));margin:0;padding:var(--sp-2) var(--sp-3);background:var(--ds-sheet);border-radius:var(--r-md);box-shadow:var(--ds-sh-2)}" +
    ".hz2-mapw{position:relative;z-index:0;margin:0 0 var(--sp-1)}" +
    ".hz2 .hz-map{height:clamp(120px,calc(86dvh - 370px),300px);margin:0;border-radius:var(--r-md);overflow:hidden}" +
    ".hz2 .hz-map .mapboxgl-ctrl-bottom-left .mapboxgl-ctrl-logo{display:block}" +   /* Mapbox terms: the logo shows on this map (mbx.js hides it on the main map) */
    "#sheet-body .hz2 .hz-map button.mapboxgl-ctrl-attrib-button{min-width:0;min-height:0}" +   /* the Mapbox (i) keeps its own 24 px look (pnds.css gives sheet buttons 44 px) */
    ".hz2-gps{position:absolute;z-index:2;top:var(--sp-2);left:var(--sp-2);display:inline-flex;align-items:center;gap:var(--sp-1);min-height:44px;padding:0 var(--sp-3);border:1px solid var(--ds-border-2);border-radius:var(--ds-r-pill);background:var(--ds-sheet);color:var(--ds-text);font:600 var(--fs-14)/20px var(--ds-sans);box-shadow:var(--ds-sh-1);cursor:pointer}" +
    ".hz2-gps svg{width:18px;height:18px;margin:0}.hz2-gps:disabled{opacity:.6}" +
    ".hz2-pin{width:28px;height:28px;border-radius:50%;background:var(--ds-amber);border:3px solid var(--ds-text);box-sizing:border-box;box-shadow:var(--ds-sh-1);cursor:grab;touch-action:none}" +
    ".hz2 .hz-hint{margin:0 0 var(--sp-1);font-size:var(--fs-12);line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".hz2-rad{display:flex;align-items:center;gap:var(--sp-2);min-height:44px;margin:0 0 var(--sp-2)}" +
    ".hz2-rl{flex:0 0 auto;margin:0;font:600 var(--fs-14)/20px var(--ds-sans);color:var(--ds-text)}.hz2-rv{flex:0 0 64px;text-align:right;font:600 var(--fs-16)/22px var(--ds-sans);color:var(--ds-amber-t)}" +
    ".hz2 .hz-range{flex:1 1 auto;min-width:0;width:auto;margin:0}" +
    ".hz2-act{display:flex;align-items:center;gap:var(--sp-2);margin:0}.hz2-act .hz2-save{flex:1 1 auto;margin:0}" +
    ".hz2-del{flex:0 0 auto;min-height:44px;padding:0 var(--sp-2);border:0;background:transparent;color:var(--ds-muted);font:600 var(--fs-14)/20px var(--ds-sans);text-decoration:underline;cursor:pointer}";
  function css() { if (document.getElementById("hz2-css")) return; var s = document.createElement("style"); s.id = "hz2-css"; s.textContent = CSS; document.head.appendChild(s); }

  function open(opts) {
    opts = opts || {};   // ds39: opts.then = where to go after Spara (Följ mig hem, Auto hemma): no dead end
    css();
    var h = home(), picked = false, rTouched = !!h, dSeq = 0, mini = null, circ = null, pin = null;
    var st = { lat: h ? h.lat : null, lng: h ? h.lng : null, r: zoneR(h) };
    A.openSheet(L("🏠 Hemzon", "🏠 Home zone"), function (body) {
      var el = A.el, box = el("div", { class: "hz2" });
      body.appendChild(box);
      // one short line + (i) → the full text (owner: "stupid to have this small text at the top")
      var more = el("p", { class: "muted hz2-more", id: "hz2-more", text: L("En öl inom hemzonen (minst 100 m) visas alltid som ungefärlig plats (som ”Bara område”), så ingen ser exakt var du bor. Väljer du en krog gäller krogen. Auto hemma använder radien du väljer. Sparas bara på din telefon.",
        "A drink inside the zone (at least 100 m) always shows as an approximate area, so nobody sees where you live. Picking a bar uses the bar. Auto home uses the radius you choose. Kept on this phone only.") });
      more.hidden = true;
      var ib = el("button", { type: "button", class: "hz2-i", "aria-expanded": "false", "aria-controls": "hz2-more", "aria-label": L("Mer om hemzonen", "More about the home zone"), html: ic("info") || "i" });
      ib.addEventListener("click", function () { more.hidden = !more.hidden; ib.setAttribute("aria-expanded", String(!more.hidden)); });
      box.appendChild(el("div", { class: "hz2-info" }, [el("p", { class: "muted hz2-line", text: L("Din öl hemma visas bara som område.", "A drink at home shows only as an area.") }), ib]));
      box.appendChild(more);
      // address search: suggestions while typing (Mapbox), Nominatim on Sök
      var q = el("input", { type: "search", class: "hz-q", placeholder: L("Sök adress, t.ex. Storgatan 5 Ludvika", "Search address"), "aria-label": L("Sök adress", "Search address"), enterkeyhint: "search", autocomplete: "off", spellcheck: "false" });
      var qb = A.btn(L("Sök", "Search"), "btn-small hz-qb");
      var srow = el("div", { class: "row hz-search" }, [q, qb]), sbox = el("div", { class: "hz2-sbox" }, [srow]);
      box.appendChild(sbox);
      var mapC = function () {   // I-07: hits near the map centre / my position first
        try { if (mini) { var c = mini.getCenter(); return { lat: c.lat, lng: c.lng }; } } catch (e) {}
        try { var l = A.lastLoc && A.lastLoc(); if (l && isFinite(l.lat)) return { lat: l.lat, lng: l.lng }; } catch (e) {}
        try { var m = A.map.getCenter(); return { lat: m.lat, lng: m.lng }; } catch (e) {}
        return null;
      };
      if (window.PN && window.PN.placeSearch) window.PN.placeSearch.attach({ input: q, button: qb, host: srow, center: mapC, onBusy: function (b) { qb.disabled = !!b; },
        onPick: function (x) { picked = true; try { q.blur(); } catch (e) {} setPt(+x.lat.toFixed(5), +x.lng.toFixed(5), true); } });
      // the map + "Använd nuvarande plats" on it
      var mapEl = el("div", { class: "hz-map", role: "application", "aria-label": L("Karta: tryck eller dra pinnen där du bor", "Map: tap or drag the pin where you live") });
      var gps = el("button", { type: "button", class: "hz2-gps", html: ic("locate") });
      gps.setAttribute("aria-label", L("Använd nuvarande plats", "Use my location"));
      gps.appendChild(el("span", { text: L("Min plats", "My location") }));
      gps.addEventListener("click", function () {
        gps.disabled = true;
        A.getPosition().then(function (pos) {
          gps.disabled = false; picked = true;
          setPt(+pos.coords.latitude.toFixed(5), +pos.coords.longitude.toFixed(5), true);
        }, function (e) { gps.disabled = false; try { A.locError(e); } catch (x) {} });
      });
      box.appendChild(el("div", { class: "hz2-mapw" }, [mapEl, gps]));
      var hint = el("p", { class: "muted hz-hint", text: L("Tryck på kartan där du bor, eller sök.", "Tap the map where you live, or search.") });
      box.appendChild(hint);
      // radius: one row, 25–1000 m, finer steps at the low end
      var rv = el("output", { class: "hz2-rv", for: "hz-r" });
      var rng = el("input", { type: "range", id: "hz-r", class: "hz-range", min: "0", max: String(STEPS.length - 1), step: "1", value: String(stepOf(st.r)), "data-min-m": String(STEPS[0]), "data-max-m": String(STEPS[STEPS.length - 1]) });
      function rText() { rv.textContent = st.r + " m"; rng.setAttribute("aria-valuetext", st.r + " m"); }
      rng.addEventListener("input", function () { rTouched = true; st.r = STEPS[+rng.value] || R0; rText(); draw(); });
      rText();
      box.appendChild(el("div", { class: "hz2-rad" }, [el("label", { class: "hz2-rl", for: "hz-r", text: L("Radie", "Radius") }), rng, rv]));
      var save = A.btn(L("💾 Spara hemzonen", "💾 Save home zone"), "btn-amber btn-block hz2-save", function () {
        if (st.lat == null) { A.toast(L("Välj en plats först.", "Pick a spot first."), { err: true }); return; }
        U.ls.setJSON(KEY, { lat: st.lat, lng: st.lng, r: Math.max(st.r, PRIV_MIN), ar: st.r, at: Date.now() });
        A.toast(L("Hemzonen ä sparad (" + st.r + " m). Hemma ä du bara ett område.", "Home zone saved (" + st.r + " m)."), {});
        A.closeSheet();
        if (typeof opts.then === "function") setTimeout(function () { try { opts.then(); } catch (e) {} }, 320);   // ds39
      });
      var act = el("div", { class: "hz2-act" }, [save]);
      if (h) {
        var clr = el("button", { type: "button", class: "hz2-del", text: L("Ta bort", "Remove"), "aria-label": L("Ta bort hemzonen", "Remove home zone") });
        clr.addEventListener("click", function () { U.ls.del(KEY); A.toast(L("Hemzonen ä borttagen.", "Home zone removed."), {}); A.closeSheet(); });
        act.appendChild(clr);
      }
      box.appendChild(act);

      function setPt(la, ln, fly) {
        st.lat = la; st.lng = ln;
        hint.textContent = L("Punkt vald. Dra pinnen eller ändra radien.", "Spot picked. Drag the pin or change the radius.");
        draw(fly);
        if (!rTouched) {   // a new zone: the default radius from the bars around (big town 100 m, countryside 300 m)
          var my = ++dSeq;
          densityR(la, ln).then(function (r) { if (my !== dSeq || rTouched) return; st.r = r; rng.value = String(stepOf(r)); rText(); draw(false); });
        }
      }
      function draw(fly) {
        if (!mini || st.lat == null) return;
        var Lf = window.L, ll = [st.lat, st.lng];
        if (!circ) circ = Lf.circle(ll, { radius: st.r, color: "#f5a623", weight: 2, fillColor: "#f5a623", fillOpacity: 0.15, interactive: false }).addTo(mini);
        else { circ.setLatLng(ll); circ.setRadius(st.r); }
        if (!pin) {
          pin = Lf.marker(ll, { icon: Lf.divIcon({ className: "hz2-pin", html: "", iconSize: [28, 28], iconAnchor: [14, 14] }), draggable: true, keyboard: false, title: L("Ditt hem", "Your home") }).addTo(mini);
          pin.on("drag", function (e) { var p = e && e.latlng; if (p && circ) circ.setLatLng([p.lat, p.lng]); });
          pin.on("dragend", function () { var p = pin.getLatLng(); picked = true; setPt(+p.lat.toFixed(5), +p.lng.toFixed(5), false); });
        } else pin.setLatLng(ll);
        if (fly) {
          var z = Math.max(14, Math.min(17, Math.round(16.5 - Math.log(Math.max(st.r, 25) / 40) / Math.LN2)));
          mini.setView(ll, z);
        }
      }
      setTimeout(function () {
        if (!window.L || !document.body.contains(mapEl)) return;
        try {
          var c = st.lat != null ? [st.lat, st.lng] : (function () { try { var l = A.lastLoc && A.lastLoc(); if (l && isFinite(l.lat)) return [l.lat, l.lng]; } catch (e) {} var m = A.map.getCenter(); return [m.lat, m.lng]; })();
          mini = makeMap(mapEl, c);
          mini.on("click", function (e) { picked = true; setPt(+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5), false); });
          draw(st.lat != null);
          if (st.lat == null) {   // ds39: a pin at once (the map centre) that follows the map until you tap, drag or search
            var follow = function () { if (picked) return; var c0 = mini.getCenter(); setPt(+c0.lat.toFixed(5), +c0.lng.toFixed(5), false);
              hint.textContent = L("Flytta kartan eller tryck där du bor. Pinnen = ditt hem.", "Move the map or tap where you live."); };
            follow(); mini.on("moveend", follow);
          }
          setTimeout(function () { try { mini.invalidateSize(); } catch (e) {} }, 80);
        } catch (e) { mapEl.remove(); }
      }, 60);
    }, { now: true, onClose: function () { dSeq++; try { if (mini) mini.remove(); } catch (e) {} mini = null; circ = null; pin = null; } });
  }
  window.HOMEZONE = {
    ready: true, open: open, home: home, STEPS: STEPS,
    init: function (api) { A = api; },
    settingsName: function (body) { if (A && A.LIVE && !(window.PNVIS && window.PNVIS.settingsRows)) row(body); }   // lane main S2: Hemzon row is in Inställningar (pnvis.js) + the rail
  };
})();
