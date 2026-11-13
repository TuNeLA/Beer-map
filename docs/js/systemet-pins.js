/* PintsNow — 🍾 SYSTEMET: Systembolaget stores on the map (I-18 part 1). window.SYSTEMET, hook: init, onPoll, settingsSheet.
   - Data: docs/systembolaget.json (OpenStreetMap, weekly Action, 413 stores), read through OPPET.sbList() (js/oppet.js; it also owns the
     hours parser: OPPET.status). Rows: [name, lat, lng, [Mo..Su "600-1140"], guess, address?].
   - Own map layer, own PNI bottle icon (navy disc + foam ring + light-blue bottle; NOT the Systembolaget logo, NOT their colours).
     From Leaflet zoom 12. LOWER priority than bars: they hide first when crowded.
       GL (Mapbox): own source "pn-sb" + one symbol layer BELOW the restaurant layer (olnu-place): GL collision (crossSourceCollisions)
         places every bar icon / pill / name first. The source is set ONCE (store list); a zoom never calls setData. Closed stores are
         dimmed (setData only when the open set changes, once a minute at most).
       Leaflet fallback (no Mapbox / GL off): DOM markers in pane "sbpins" (z 565, under the restaurant dots); a store that would touch a bar
         icon / pill, or another store, is left out; at most 60 in view.
   - Filter: ⚙️ Karta row "Systembolaget på kartan" (localStorage "olnu.sb", default on).
   - Tap = a small card: "Systembolaget <ort>", today's hours, "Stänger om 40 min" / "Stängt – öppnar mån 10:00", the address.
     No products, no prices, no alcohol promotion (Alkohollagen).
   - HOLIDAY HOURS: not yet. OSM has normal weeks only; the holiday list needs the owner's Systembolaget API key (api-portal.systembolaget.se,
     store info) and their site forbids scraping. HOOK: SYSTEMET.setDeviations([{ date: "2026-12-24", open: "10:00", close: "15:00" },
     { date: "2026-12-25", closed: true }, { date: "2026-12-31", open: "10:00", close: "15:00", store: "<lat>,<lng>" }]) — date = Stockholm
     date; store (optional) = "lat,lng" as in the JSON (omitted = all stores). The card, the dimming and the pin state use it at once. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, L = window.L;
  var A = null, map = null, SB = null, devs = [], layer = null, drawn = {}, timer = 0, popup = null;
  var KEY = "olnu.sb", MIN_Z = 12, MAX_DOM = 60, GAP_PX = 26, PAD_PX = 3;
  var SRC = "pn-sb", LAY = "pn-sb-pin", IMG = "pn-sb-ico", BEFORE = "olnu-place";
  var gl = { m: null, hooked: null, sig: "" }, tapOff = false;
  var DSV = ["mån", "tis", "ons", "tor", "fre", "lör", "sön"], DEN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var NAVY = "#152050", FOAM = "#FFFAF0", EDGE = "rgba(4,7,20,0.62)", GLYPH = "#8FD3FF";
  var BOTTLE = "M10.4 2.2h3.2v5.4c0 1.2 2.5 2.3 2.5 5v7.2c0 .9-.7 1.6-1.6 1.6H9.5c-.9 0-1.6-.7-1.6-1.6v-7.2c0-2.7 2.5-3.8 2.5-5z";
  var LABEL = "M9.2 13.2h5.6v3.8H9.2z";

  function sv() { return !I || I.lang !== "en"; }
  function tx(a, b) { return sv() ? a : b; }
  function esc(s) { return U && U.esc ? U.esc(s) : String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function on() { try { return U.ls.get(KEY, "1") !== "0"; } catch (e) { return true; } }
  function setOn(v) { try { U.ls.set(KEY, v ? "1" : "0"); } catch (e) {} }
  function O() { return window.OPPET || null; }
  function key(s) { return s.lat + "," + s.lng; }

  /* ---------- hours (shared parser = OPPET.status; deviations = the holiday hook) ---------- */
  var dfmt = null;
  function dateOf(ms) {   // Stockholm date "YYYY-MM-DD"
    try { if (!dfmt) dfmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }); return dfmt.format(new Date(ms)); }
    catch (e) { return new Date(ms).toISOString().slice(0, 10); }
  }
  function mins(hhmm) { var p = String(hhmm || "").split(":"); return (+p[0]) * 60 + (+p[1] || 0); }
  function devFor(s, date) {
    for (var i = 0; i < devs.length; i++) { var d = devs[i]; if (d && d.date === date && (!d.store || d.store === key(s))) return d; }
    return null;
  }
  // The week the parser sees: the next 7 days from today, a deviation replaces that date's hours.
  function weekFor(s, ms) {
    if (!devs.length) return s.w;
    var o = O(), dow = o.wall(ms).dow, w = s.w ? s.w.slice() : ["", "", "", "", "", "", ""], any = false;
    for (var k = 0; k < 7; k++) {
      var d = devFor(s, dateOf(ms + k * 864e5)); if (!d) continue;
      any = true; w[(dow + k) % 7] = d.closed ? "" : mins(d.open) + "-" + mins(d.close);
    }
    return any ? w : s.w;
  }
  function statusOf(s, ms) { var o = O(); return o ? o.status(weekFor(s, ms), ms) : { known: false }; }
  function dayIv(s, ms) {   // today's opening as "10:00–19:00" or ""
    var o = O(), w = weekFor(s, ms), a = o.day(w, o.wall(ms).dow)[0];
    return a ? o.hhmm(a[0]) + "–" + o.hhmm(a[1]) : "";
  }

  /* ---------- the card text (pure: tests call SYSTEMET.cardText(store, ms)) ---------- */
  function dname(n) { return String(n || "").replace(/^Systembolaget\s*,?\s*/i, "").trim(); }
  function placeName(s) {
    var nm = dname(s.name);
    if (!nm && s.addr) nm = s.addr.split(",").pop().trim();
    if (!nm) { try { var tw = window.CITIES && window.CITIES.nearest(s.lat, s.lng); nm = tw && U.haversine(s.lat, s.lng, tw.lat, tw.lng) < 8000 ? tw.name : ""; } catch (e) { nm = ""; } }
    return nm;
  }
  function stateLine(st) {
    var o = O();
    if (!st || !st.known) return { cls: "", t: tx("Öppettider saknas", "Opening hours missing") };
    if (st.open) {
      if (st.always) return { cls: "oh-open", t: tx("Öppet dygnet runt", "Open 24/7") };
      if (st.closeIn <= 60) return { cls: "oh-soon", t: tx("Stänger om " + o.dur(st.closeIn), "Closes in " + o.dur(st.closeIn)) };
      return { cls: "oh-open", t: tx("Öppet till " + st.closeAt, "Open until " + st.closeAt) };
    }
    if (st.opensAt == null) return { cls: "oh-shut", t: tx("Stängt", "Closed") };
    var dn = sv() ? DSV[st.opensDow] : DEN[st.opensDow];
    var when = st.opensDay === 0 ? tx("idag ", "today ") + st.opensAt : st.opensDay === 1 ? tx("i morgon ", "tomorrow ") + st.opensAt : dn + " " + st.opensAt;
    return { cls: "oh-shut", t: tx("Stängt – öppnar " + when, "Closed – opens " + when) };
  }
  function cardText(s, ms) {
    ms = ms == null ? Date.now() : ms;
    var st = statusOf(s, ms), ln = stateLine(st), iv = dayIv(s, ms), dev = devFor(s, dateOf(ms));
    return { title: "Systembolaget" + (placeName(s) ? " " + placeName(s) : ""), state: ln.t, cls: ln.cls, open: !!st.open,
      today: st.known ? tx("Idag: ", "Today: ") + (iv || tx("stängt", "closed")) : "", addr: s.addr || "", guess: !!s.guess, special: !!dev };
  }
  function cardHTML(s, ms) {
    var c = cardText(s, ms), h = '<div class="sb-card"><div class="sb-h">' + esc(c.title) + "</div>";
    h += '<div class="sb-st ' + c.cls + '">' + esc(c.state) + "</div>";
    if (c.today) h += '<div class="sb-today">' + esc(c.today) + (c.special ? " · " + esc(tx("avvikande tid", "special hours")) : "") + "</div>";
    if (c.addr) h += '<div class="sb-addr">' + esc(c.addr) + "</div>";
    h += '<div class="sb-row"><a class="btn btn-small sb-dir" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + s.lat + "," + s.lng + '">' + esc(tx("Vägbeskrivning", "Directions")) + "</a></div>";
    h += '<div class="sb-note">' + esc((c.guess ? tx("Vanliga tider (mån–fre 10–19, lör 10–15). ", "Usual hours (Mon–Fri 10–19, Sat 10–15). ") : "") +
      tx("Tider från OpenStreetMap – helgdagar kan skilja.", "Hours from OpenStreetMap – holidays may differ.")) + "</div></div>";
    return h;
  }
  function phone() { return !!(window.matchMedia && window.matchMedia("(max-width: 600px)").matches); }
  function openCard(s) {
    if (!map || !L) return;
    try { if (window.FX && FX.haptic) FX.haptic(8); } catch (e) {}
    popup = L.popup({ className: "olnu-bar sb-pop", offset: L.point(0, -12), autoPan: !phone(), maxWidth: Math.min(300, (window.innerWidth || 360) - 40) })
      .setLatLng([s.lat, s.lng]).setContent(cardHTML(s)).openOn(map);
  }

  /* ---------- the icon (same drawing for canvas and SVG) ---------- */
  function iconCanvas(px, R) {
    var cv = document.createElement("canvas"), n = Math.round(px * R); cv.width = cv.height = n;
    var c = cv.getContext("2d"), r = n / 2;
    c.fillStyle = EDGE; c.beginPath(); c.arc(r, r, r - 0.5 * R, 0, 6.2832); c.fill();
    c.fillStyle = FOAM; c.beginPath(); c.arc(r, r, r - 1.5 * R, 0, 6.2832); c.fill();
    c.fillStyle = NAVY; c.beginPath(); c.arc(r, r, r - 3.5 * R, 0, 6.2832); c.fill();
    var k = (n * 0.62) / 24; c.save(); c.translate(r - 12 * k, r - 12.2 * k); c.scale(k, k);
    c.fillStyle = GLYPH; c.fill(new Path2D(BOTTLE)); c.fillStyle = NAVY; c.fill(new Path2D(LABEL)); c.restore();
    return cv;
  }
  function iconSVG(px) {
    return '<svg class="sb-ico" width="' + px + '" height="' + px + '" viewBox="0 0 ' + px + " " + px + '" aria-hidden="true"><circle cx="' + px / 2 + '" cy="' + px / 2 + '" r="' + (px / 2 - 0.5) + '" fill="' + FOAM +
      '" stroke="' + EDGE + '"/><circle cx="' + px / 2 + '" cy="' + px / 2 + '" r="' + (px / 2 - 3.5) + '" fill="' + NAVY + '"/><g transform="translate(' + (px / 2 - 12 * px * 0.62 / 24) + " " + (px / 2 - 12.2 * px * 0.62 / 24) +
      ") scale(" + px * 0.62 / 24 + ')"><path d="' + BOTTLE + '" fill="' + GLYPH + '"/><path d="' + LABEL + '" fill="' + NAVY + '"/></g></svg>';
  }

  /* ---------- GL path ---------- */
  function glm() { try { var b = window.BASEMAP; return b && b.isMapbox() && b.mapbox() ? b.mapbox().getMapboxMap() : null; } catch (e) { return null; } }
  function glOn() { try { return !!(window.GLBARS && GLBARS.on()); } catch (e) { return false; } }
  function feats(ms) {
    var out = [];
    (SB || []).forEach(function (s) { var st = statusOf(s, ms); out.push({ type: "Feature", geometry: { type: "Point", coordinates: [+s.lng, +s.lat] }, properties: { k: key(s), o: st.open ? 1 : 0 } }); });
    return out;
  }
  // cifix4: "bars first" is done HERE (setFilter, no setData) and not by GL collision: with real Mapbox the symbol collision also hit the basemap
  // labels and the invisible bar blockers, so a store in a town never drew (0 features at z15). A store whose 24 px box touches a GL bar box
  // (icon, pill: GLBARS.rects) is left out of the layer filter; the rest always draws.
  function hideUnderBars(m) {
    var rs = []; try { rs = ((window.GLBARS && GLBARS.rects && GLBARS.rects()) || []).filter(function (o) { return !o.lbl; }); } catch (e) {}   // icon / pill boxes, not the name text (same as the DOM fallback)
    var hid = [];
    if (rs.length && map.getZoom() >= MIN_Z) (SB || []).forEach(function (s) {
      var pt = map.latLngToContainerPoint([s.lat, s.lng]), b = { l: pt.x - 12, t: pt.y - 12, r: pt.x + 12, b: pt.y + 12 };
      if (rs.some(function (o) { return hit(b, o); })) hid.push(key(s));
    });
    var sg = hid.sort().join("|"); if (sg === gl.hid) return;
    gl.hid = sg; m.setFilter(LAY, hid.length ? ["!", ["in", ["get", "k"], ["literal", hid]]] : null);
  }
  function ensureGL() {
    var m = glm();
    if (!m || !m.style || !m.style._loaded || !SB) return false;
    if (!m.getLayer(BEFORE)) return false;   // glmap not ready: our layer goes UNDER the restaurant layer (placed after every bar icon)
    try {
      if (m !== gl.hooked) {
        gl.hooked = m; gl.m = m;
        m.on("style.load", function () { gl.sig = ""; gl.hid = null; setTimeout(update, 0); });
        map.on("preclick", onPreclick);
      }
      if (!m.hasImage(IMG)) { var R = Math.min(3, Math.max(2, Math.ceil(window.devicePixelRatio || 1))), cv = iconCanvas(24, R); m.addImage(IMG, cv.getContext("2d").getImageData(0, 0, cv.width, cv.height), { pixelRatio: R }); }
      if (!m.getSource(SRC)) { m.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } }); gl.sig = ""; }
      if (!m.getLayer(LAY)) m.addLayer({ id: LAY, type: "symbol", source: SRC, minzoom: MIN_Z - 1,   // GL zoom = Leaflet zoom - 1
        layout: { "icon-image": IMG, "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport",
          "icon-size": ["interpolate", ["linear"], ["zoom"], MIN_Z - 1, 0.85, MIN_Z + 3, 1.1], visibility: on() ? "visible" : "none" },
        paint: { "icon-emissive-strength": 1, "icon-opacity": ["case", ["==", ["get", "o"], 1], 1, 0.6] } }, BEFORE);
      m.setLayoutProperty(LAY, "visibility", on() ? "visible" : "none");
      hideUnderBars(m);
      var sig = (SB.length) + "|" + devs.length + "|" + feats(Date.now()).map(function (f) { return f.properties.o; }).join("");
      if (sig !== gl.sig) { gl.sig = sig; m.getSource(SRC).setData({ type: "FeatureCollection", features: feats(Date.now()) }); }
      return true;
    } catch (e) { try { console.warn("olnu systemet", e && e.message); } catch (x) {} return false; }
  }
  var byKey = {};
  function onPreclick(e) {
    var m = gl.m; if (!m || !e || !e.latlng || !m.getLayer(LAY) || !on() || map.getZoom() < MIN_Z) return;
    try { if (window.GLBARS && GLBARS.tappedAt && performance.now() - GLBARS.tappedAt() < 300) return; } catch (x) {}   // a bar took this tap
    var p = m.project([e.latlng.lng, e.latlng.lat]), best = null, bd = 1e9;
    m.queryRenderedFeatures([[p.x - 18, p.y - 18], [p.x + 18, p.y + 18]], { layers: [LAY] }).forEach(function (f) {
      var q = m.project(f.geometry.coordinates), d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = f; }
    });
    var s = best && byKey[best.properties.k]; if (s) { if (e.originalEvent) e.originalEvent._olnuGl = 1; openCard(s); }
  }

  /* ---------- Leaflet fallback ---------- */
  function rel(r, cr) { return { l: r.left - cr.left, t: r.top - cr.top, r: r.right - cr.left, b: r.bottom - cr.top }; }
  function hit(a, b) { return a.l < b.r + PAD_PX && a.r > b.l - PAD_PX && a.t < b.b + PAD_PX && a.b > b.t - PAD_PX; }
  function obstacles(cont) {
    var cr = cont.getBoundingClientRect(), out = [];
    cont.querySelectorAll(".leaflet-hotbars-pane .bar-ico, .leaflet-hotbars-pane .pill, .leaflet-bars-pane .bar-ico, .leaflet-bars-pane .pill, .leaflet-arenapins-pane .ap-pin, .leaflet-placepins-pane .pl-dot, .me-dot").forEach(function (x) {
      var r = x.getBoundingClientRect(); if (r.width || r.height) out.push(rel(r, cr));
    });
    return out;
  }
  function clearDom() { if (layer) layer.clearLayers(); drawn = {}; }
  function drawDom() {
    if (!layer || !SB) return;
    var z = map.getZoom(); if (!on() || z < MIN_Z) { clearDom(); return; }
    var cont = map.getContainer(), W = cont.clientWidth, H = cont.clientHeight, ob = obstacles(cont), kept = [], want = {}, bnd = map.getBounds().pad(0.1);
    SB.forEach(function (s) {
      if (!bnd.contains([s.lat, s.lng]) || kept.length >= MAX_DOM) return;
      var pt = map.latLngToContainerPoint([s.lat, s.lng]); if (pt.x < -20 || pt.y < -20 || pt.x > W + 20 || pt.y > H + 20) return;
      var box = { l: pt.x - 12, t: pt.y - 12, r: pt.x + 12, b: pt.y + 12 };
      if (ob.some(function (o) { return hit(box, o); })) return;   // a bar (or its pill) is there: bars first
      if (kept.some(function (k) { return Math.abs(k.x - pt.x) < GAP_PX && Math.abs(k.y - pt.y) < GAP_PX; })) return;
      kept.push(pt); want[key(s)] = s;
    });
    Object.keys(drawn).forEach(function (k) { if (!want[k]) { layer.removeLayer(drawn[k]); delete drawn[k]; } });
    Object.keys(want).forEach(function (k) {
      var s = want[k], open = !!statusOf(s, Date.now()).open;
      if (drawn[k]) { var el = drawn[k].getElement(); if (el) el.classList.toggle("sb-closed", !open); return; }
      var m = L.marker([s.lat, s.lng], { pane: "sbpins", keyboard: false, bubblingMouseEvents: false,
        icon: L.divIcon({ html: iconSVG(24), className: "sb-mk" + (open ? "" : " sb-closed"), iconSize: [24, 24], iconAnchor: [12, 12] }) });
      m.on("click", function () { openCard(s); });
      m.on("add", function () { var e = m.getElement(); if (e) { e.setAttribute("data-sb", k); e.setAttribute("role", "button"); e.setAttribute("aria-label", "Systembolaget " + placeName(s)); } });
      m.addTo(layer); drawn[k] = m;
    });
  }

  /* ---------- glue ---------- */
  function load() {
    var o = O(), l = o && o.sbList && o.sbList(); if (!l || SB === l) return;
    SB = l; byKey = {}; l.forEach(function (s) { byKey[key(s)] = s; });
    update();
  }
  function update() {
    if (!map) return;
    load();
    if (!SB) return;
    if (glOn()) { if (ensureGL()) { clearDom(); return; } clearDom(); return; }   // GL on but not ready yet: wait (no DOM blink)
    if (gl.m) { try { if (gl.m.getLayer(LAY)) gl.m.setLayoutProperty(LAY, "visibility", "none"); } catch (e) {} }
    drawDom();
  }
  function soon(ms) { clearTimeout(timer); timer = setTimeout(update, ms == null ? 150 : ms); }
  var CSS = ".leaflet-sbpins-pane .sb-mk{background:none;border:0}.sb-mk .sb-ico{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}.sb-mk.sb-closed{opacity:.6}" +
    ".sb-card{min-width:190px;display:grid;gap:4px;font:400 14px/1.3 var(--body,system-ui,sans-serif)}.sb-h{font-weight:700;font-size:15px}" +
    ".sb-st{font-weight:600}.sb-today,.sb-addr{opacity:.85}.sb-row{margin-top:4px}.sb-note{font-size:12px;opacity:.65;margin-top:2px}";
  var T = { head: ["Systembolaget", "Systembolaget"], row: ["Systembolaget på kartan", "Systembolaget on the map"],
    note: ["Butiker och öppettider från zoom 12. Bara plats och tider – ingen reklam. Krogarna går alltid först.", "Stores and opening hours from zoom 12. Location and hours only. Bars always come first."] };
  function settingsBlock(body) {
    body.appendChild(A.el("h3", { text: tx(T.head[0], T.head[1]) }));
    var sw = A.el("button", { type: "button", class: "switch sb-switch", role: "switch", "aria-checked": String(on()), "aria-label": tx(T.row[0], T.row[1]) });
    sw.addEventListener("click", function () { var now = sw.getAttribute("aria-checked") !== "true"; setOn(now); sw.setAttribute("aria-checked", String(now)); if (!now && map) map.closePopup(popup); update(); });
    body.appendChild(A.el("div", { class: "toggle-row sb-row-toggle" }, [A.el("span", { text: tx(T.row[0], T.row[1]) }), sw]));
    body.appendChild(A.el("p", { class: "muted sb-set-note", text: tx(T.note[0], T.note[1]) }));
  }

  // uxfix P1-4 (blind test: hours were hard to find): "Mer på kartan" and "Ställen nära dig" open the NEAREST store card.
  // Turns the pins on, centres that store (zoom ≥ 14) and opens its card. No list yet: waits for oppet:sb (max 8 s).
  function nearest(lat, lng) {
    load(); if (!SB || !SB.length || !isFinite(lat)) return null;
    var best = null, bd = Infinity;
    SB.forEach(function (s) { var d = U.haversine(lat, lng, s.lat, s.lng); if (d < bd) { bd = d; best = s; } });
    return best;
  }
  function openNearest(pos) {
    if (!map) return Promise.resolve(null);
    if (!on()) { setOn(true); update(); }
    return new Promise(function (res) {
      var t0 = Date.now();
      (function go() {
        var p = pos; try { if (!p && A && A.lastLoc) p = A.lastLoc(); } catch (e) {}
        if (!p) { var c = map.getCenter(); p = { lat: c.lat, lng: c.lng }; }
        var s = nearest(p.lat, p.lng);
        if (!s) { if (Date.now() - t0 < 8000) { setTimeout(go, 300); return; } res(null); return; }
        try { map.setView([s.lat, s.lng], Math.max(map.getZoom(), 14), { animate: false }); } catch (e) {}
        update();
        setTimeout(function () { openCard(s); res(s); }, 120);
      })();
    });
  }
  window.SYSTEMET = {
    isOn: on,
    setOn: function (v) { setOn(!!v); if (!v && map && popup) map.closePopup(popup); update(); },
    nearest: nearest, openNearest: openNearest, icon: iconSVG,
    init: function (api) {
      A = api; map = api && api.map; if (!map || !L) return;
      if (!map.getPane("sbpins")) { map.createPane("sbpins"); map.getPane("sbpins").style.zIndex = 565; }
      layer = L.layerGroup().addTo(map);
      var st = document.createElement("style"); st.id = "systemet-css"; st.textContent = CSS; document.head.appendChild(st);
      map.on("moveend", function () { soon(150); });
      map.on("zoomend", function () { soon(150); });
      document.addEventListener("oppet:sb", function () { soon(0); });
      document.addEventListener("glbars:sync", function () { soon(60); });
      var n = 0, iv = setInterval(function () { update(); if (++n > 30 || (SB && (gl.sig || !glOn()))) clearInterval(iv); }, 1500);   // GL layers arrive late
      setInterval(function () { if (SB && glOn()) ensureGL(); else if (SB) drawDom(); }, 60000);   // open / closed changes
      soon(1500);
    },
    onPoll: function () { soon(400); },
    settingsSheet: function (body) { if (A && A.el) settingsBlock(body); },
    // Holiday hours hook (see the header): list of {date, open, close | closed, store?}. Not filled yet.
    setDeviations: function (list) { devs = Array.isArray(list) ? list.filter(function (d) { return d && /^\d{4}-\d{2}-\d{2}$/.test(d.date || ""); }) : []; gl.sig = ""; update(); },
    cardText: cardText, cardHTML: cardHTML,
    // tests
    _update: update, _on: on, _drawn: function () { return drawn; }, _stores: function () { return SB; }, _gl: function () { return gl; }, _open: openCard, LAYER: LAY, MIN_Z: MIN_Z
  };
  if (window.PN) PN.mod("SYSTEMET");
})();
