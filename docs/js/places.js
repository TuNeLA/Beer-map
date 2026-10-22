/* Öl Nu — 🍽️ PLACEPINS: restaurants, cafés and fast food on the map (CONTRACT "📅 EVENT MÅNAD + 🍽️ RESTAURANGER PÅ KARTAN").
   window.PLACEPINS, in app.js mods(): init, onPoll, settingsSheet. No RPC, no new buttons, no new fetch.
   - Data: the places js/bars.js already loads for the view (docs/places/ tiles, BARS.placesInBounds). A place that is the
     same venue as a bar (barTwin) is never drawn twice.
   - Calm map: zoom ≥ 16 only, small quiet dots (🍽️ restaurant, ☕ café, 🍔 fast food) in their own pane "placepins"
     (z 570: under arena chips 580, bar markers 590, beer pins 600). Names only at zoom ≥ 17, and only when the name does
     not touch a bar marker, a bar label or another name. A dot that would overlap a bar / arena / people marker or a bar
     label is left out; dots closer than 30 / 24 / 20 px (zoom 16 / 17 / 18+) to a kept dot are left out. At most 60 / 110 / 150
     dots in view (calm city centres, phones stay smooth).
     Markers are diffed by id (a pan only adds / removes the changed ones).
   - A place where someone drinks or checks in is drawn by app.js as a normal composite marker: this module skips it.
   - Redrawn on move / zoom, when places load, and when app.js redraws bar markers (MutationObserver on its panes).
   - Tap a dot → the normal bar sheet (app.js barPopup through the api: header, Checka in, folds, Info).
   - ⚙️ Karta: "🍽️ Visa restauranger" (localStorage "olnu.places", default on). Works on Klassisk and every GL style
     (the markers are plain Leaflet DOM markers above the base map). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, L = window.L;
  var A = null, map = null, layer = null, timer = 0, drawn = {}, selId = null;
  var KEY = "olnu.places", MIN_Z = 16, LABEL_Z = 17, MAX_IN_VIEW = 150, PAD_PX = 4;
  // denser zoomed out: fewer dots, more space (a city centre at zoom 16 stays calm); zoom 18+: up to 150
  function capFor(z) { return z < 17 ? 60 : z < 18 ? 110 : MAX_IN_VIEW; }
  function gapFor(z) { return z < 17 ? 30 : z < 18 ? 24 : 20; }
  var ICON = { restaurant: "🍽️", cafe: "☕", fast_food: "🍔" }, RANK = { restaurant: 0, cafe: 1, fast_food: 2 };
  // 🌭 js/oppet.js nattmat mode (01–05): open late food from zoom 13 and first in the cap (class pl-nm). Nothing else changes.
  var NM_Z = 13;
  function nmOn() { try { return !!(window.OPPET && window.OPPET.nightMode()); } catch (e) { return false; } }
  function nmOpen(p) { try { return !!(window.OPPET && window.OPPET.openLate(p)); } catch (e) { return false; } }
  function sv() { return !I || I.lang !== "en"; }
  function on() { try { return U.ls.get(KEY, "1") !== "0"; } catch (e) { return true; } }
  var lastPick = {};
  function pick(k, a) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[k]) i = (i + 1) % a.length; lastPick[k] = i; return a[i]; }
  var T = {
    head: ["🍽️ Restauranger på kartan", "🍽️ Restaurants on the map"],
    row: ["🍽️ Visa restauranger", "🍽️ Show restaurants"],
    note: ["Små prickar för restauranger, kaféer och gatukök från zoom 16. Krogarna går alltid först.",
      "Small dots for restaurants, cafés and fast food from zoom 16. Bars always come first."],
    onT: [["🍽️ Restaurangerna ä tillbaka på kartan. Spaningen fortsätter.", "🍽️ Matställena ä inne i rapporten igen.",
      "🍽️ Käket ä kartlagt. Truppen marscherar på magen."], ["🍽️ Restaurants are back on the map."]],
    offT: [["🍽️ Restaurangerna gömda. Bara krogarna kvar – som Dalregementet vill ha't.", "🍽️ Matställena ä bortplockade. Kartan andas ut.",
      "🍽️ Käket ä av kartan. Nu ä hä bara öl som gäller."], ["🍽️ Restaurants hidden. Only bars left."]]
  };
  function two(k) { return sv() ? T[k][0] : T[k][1]; }
  var CSS =
    ".leaflet-placepins-pane .pl-mk{background:none;border:0}" +
    ".pl-in{position:relative;width:32px;height:32px}" +
    ".pl-dot{position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;display:grid;place-items:center;" +
      "background:rgba(10,15,28,.74);border:1px solid rgba(232,226,210,.42);box-shadow:0 1px 3px rgba(0,0,0,.45);font-size:9px;line-height:1;opacity:.78;" +
      "transition:transform .15s ease,opacity .15s ease}" +
    ".pl-mk:hover .pl-dot,.pl-mk.pl-sel .pl-dot{opacity:1;transform:scale(1.25);border-color:var(--amber,#f5a623)}" +
    ".pl-lbl{position:absolute;left:50%;top:calc(50% + 11px);transform:translateX(-50%);white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;" +
      "font:500 11px/1.2 var(--body,system-ui,sans-serif);color:rgba(236,232,220,.9);text-shadow:0 1px 2px #000,0 0 3px #000;pointer-events:none}" +
    "@media (prefers-reduced-motion:reduce){.pl-dot{transition:none}}";

  function ready() { return !!(map && layer && window.BARS && window.BARS.placesInBounds); }
  function soon(ms) { clearTimeout(timer); timer = setTimeout(draw, ms == null ? 150 : ms); }
  function clear() { layer && layer.clearLayers(); drawn = {}; }
  function rel(r, cr) { return { l: r.left - cr.left, t: r.top - cr.top, r: r.right - cr.left, b: r.bottom - cr.top }; }
  function hit(a, b) { return a.l < b.r + PAD_PX && a.r > b.l - PAD_PX && a.t < b.b + PAD_PX && a.b > b.t - PAD_PX; }
  // What the map already shows: bar / arena / people markers and visible bar labels (rects in container px) + spot ids.
  function obstacles(cont) {
    var cr = cont.getBoundingClientRect(), out = [], ids = {};
    cont.querySelectorAll(".leaflet-hotbars-pane .cm[data-bar], .leaflet-bars-pane .cm[data-bar]").forEach(function (x) { ids[x.getAttribute("data-bar")] = true; });
    cont.querySelectorAll(".leaflet-hotbars-pane .bar-ico, .leaflet-hotbars-pane .pill, .leaflet-hotbars-pane .cm-rally, .leaflet-bars-pane .bar-ico," +
      " .cm-ci:not(.lbl-hide), .cm-b:not(.lbl-hide), .bm-crowd:not(.lbl-hide), .bm-q:not(.lbl-hide), .me-dot," +
      " .leaflet-arenapins-pane .ap-pin, .leaflet-marker-pane .pill, .leaflet-marker-pane .rl-pin, .cm-labels .cm-lbl:not(.lbl-hide)").forEach(function (x) {
      var r = x.getBoundingClientRect(); if (r.width || r.height) out.push(rel(r, cr));
    });
    return { rects: out, ids: ids };
  }
  function iconFor(p, lbl) {
    var nm = String(p.name || "");
    var h = '<div class="pl-in"><span class="pl-dot" aria-hidden="true">' + (p._nm ? "🌭" : ICON[p.type] || ICON.restaurant) + "</span>" +
      (lbl ? '<span class="pl-lbl">' + U.esc(nm) + "</span>" : "") + "</div>";
    return L.divIcon({ html: h, className: "pl-mk" + (selId === p.id ? " pl-sel" : "") + (p._nm ? " pl-nm" : ""), iconSize: [32, 32], iconAnchor: [16, 16] });
  }
  function draw() {
    if (!ready()) return;
    var z = map.getZoom();
    var nm = nmOn();
    if (!on() || (z < MIN_Z && !(nm && z >= NM_Z))) { clear(); return; }
    var cont = map.getContainer(), W = cont.clientWidth, H = cont.clientHeight;
    var list = window.BARS.placesInBounds(map.getBounds().pad(0.1), 900);
    list.sort(function (a, b) { return (RANK[a.type] || 0) - (RANK[b.type] || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    if (nm) {
      list.forEach(function (p) { p._nm = nmOpen(p); });
      list = list.filter(function (p) { return p._nm || z >= MIN_Z; });
      list.sort(function (a, b) { return (b._nm ? 1 : 0) - (a._nm ? 1 : 0); });
    } else list.forEach(function (p) { p._nm = false; });
    var ob = obstacles(cont), kept = [], labels = [], want = {}, n = 0, showLbl = z >= LABEL_Z;
    var CAP = capFor(z), GAP_PX = gapFor(z);
    for (var i = 0; i < list.length && n < CAP; i++) {
      var p = list[i];
      if (ob.ids[p.id]) continue;   // app.js draws it (people / check-ins / call-out there)
      var pt = map.latLngToContainerPoint([p.lat, p.lng]);
      var inView = pt.x >= -20 && pt.y >= -20 && pt.x <= W + 20 && pt.y <= H + 20;
      var dot = { l: pt.x - 8, t: pt.y - 8, r: pt.x + 8, b: pt.y + 8 };
      if (ob.rects.some(function (o) { return hit(dot, o); })) continue;
      if (kept.some(function (k) { return Math.abs(k.x - pt.x) < GAP_PX && Math.abs(k.y - pt.y) < GAP_PX; })) continue;
      kept.push(pt); if (inView) n++;
      var lbl = false;
      if (showLbl && p.name) {
        var w = Math.min(120, String(p.name).length * 6.1 + 6), lr = { l: pt.x - w / 2, t: pt.y + 11, r: pt.x + w / 2, b: pt.y + 25 };
        lbl = !ob.rects.some(function (o) { return hit(lr, o); }) && !labels.some(function (o) { return hit(lr, o); });
        if (lbl) labels.push(lr);
      }
      want[p.id] = { p: p, lbl: lbl };
    }
    // second pass: a label may not cover a dot kept after it
    Object.keys(want).forEach(function (id) {
      var x = want[id]; if (!x.lbl) return;
      var pt = map.latLngToContainerPoint([x.p.lat, x.p.lng]), w = Math.min(120, String(x.p.name).length * 6.1 + 6);
      var lr = { l: pt.x - w / 2, t: pt.y + 11, r: pt.x + w / 2, b: pt.y + 25 };
      if (kept.some(function (k) { return (k.x !== pt.x || k.y !== pt.y) && hit(lr, { l: k.x - 9, t: k.y - 9, r: k.x + 9, b: k.y + 9 }); })) x.lbl = false;
    });
    Object.keys(drawn).forEach(function (id) {
      var d = drawn[id], w2 = want[id];
      if (!w2) { layer.removeLayer(d.m); delete drawn[id]; return; }
      if (d.lbl !== w2.lbl || d.nm !== !!w2.p._nm) { d.lbl = w2.lbl; d.nm = !!w2.p._nm; d.m.setIcon(iconFor(w2.p, w2.lbl)); }
      delete want[id];
    });
    Object.keys(want).forEach(function (id) {
      var x = want[id], p = x.p;
      var m = L.marker([p.lat, p.lng], { pane: "placepins", keyboard: false, icon: iconFor(p, x.lbl), bubblingMouseEvents: false, riseOnHover: true });
      m.on("click", function () { openPlace(p); });
      m.on("add", function () { var el = m.getElement(); if (el) { el.setAttribute("data-place", String(p.id)); el.setAttribute("aria-label", String(p.name || "")); el.setAttribute("role", "button"); } });
      m.addTo(layer);
      drawn[id] = { m: m, lbl: x.lbl, nm: !!p._nm };
    });
  }
  function phone() { return !!(window.matchMedia && window.matchMedia("(max-width: 600px)").matches); }
  function mark(id, onOff) { var d = drawn[id], el = d && d.m.getElement(); if (el) el.classList.toggle("pl-sel", onOff); }
  function openPlace(p) {
    if (!A || !map) return;
    try { if (window.FX && FX.haptic) FX.haptic(8); } catch (e) {}
    var html = "";
    try { html = A.barPopup ? A.barPopup(p) : ""; } catch (e) { html = ""; }
    if (!html) { if (A.openBar) A.openBar(p); return; }
    if (selId) mark(selId, false);
    selId = p.id; mark(selId, true);
    var pop = L.popup({ className: "olnu-bar", offset: L.point(0, -10), autoPan: !phone(), maxWidth: Math.min(320, (window.innerWidth || 360) - 40) })
      .setLatLng([p.lat, p.lng]).setContent(html);
    pop.on("remove", function () { if (selId === p.id) { mark(p.id, false); selId = null; } });
    pop.openOn(map);
  }
  function settingsBlock(body) {
    body.appendChild(A.el("h3", { text: two("head") }));
    var sw = A.el("button", { type: "button", class: "switch pl-switch", role: "switch", "aria-checked": String(on()), "aria-label": two("row") });
    sw.addEventListener("click", function () {
      var now = sw.getAttribute("aria-checked") !== "true";
      try { U.ls.set(KEY, now ? "1" : "0"); } catch (e) {}
      sw.setAttribute("aria-checked", String(now));
      soon(0);
      try { A.toast(sv() ? pick(now ? "on" : "off", now ? T.onT[0] : T.offT[0]) : (now ? T.onT[1][0] : T.offT[1][0]), { id: "places", ms: 2600 }); } catch (e) {}
    });
    body.appendChild(A.el("div", { class: "toggle-row pl-row" }, [A.el("span", { text: two("row") }), sw]));
    body.appendChild(A.el("p", { class: "muted pl-note", text: two("note") }));
  }

  window.PLACEPINS = {
    init: function (api) {
      A = api; map = api && api.map; if (!map || !L) return;
      if (!map.getPane("placepins")) { map.createPane("placepins"); map.getPane("placepins").style.zIndex = 570; }
      layer = L.layerGroup().addTo(map);
      var st = document.createElement("style"); st.id = "places-css"; st.textContent = CSS; document.head.appendChild(st);
      map.on("moveend", function () { soon(150); });
      // after a zoom other layers may still settle (CSS zoom transitions): draw now and once more when it is calm
      var late = 0;
      map.on("zoomend", function () { soon(150); clearTimeout(late); late = setTimeout(function () { soon(0); }, 700); });
      try { window.BARS.onPlacesReady(function () { soon(450); }); } catch (e) {}
      // app.js redraws bar markers on its own (poll, places loaded, zoom band): follow it, so dots and names avoid the new markers.
      try {
        var mo = new MutationObserver(function () { if (on() && (map.getZoom() >= MIN_Z || nmOn())) soon(120); });
        ["bars", "hotbars", "arenapins"].forEach(function (n) { var pn = map.getPane(n); if (pn) mo.observe(pn, { childList: true }); });
      } catch (e) {}
      soon(1200);
    },
    onPoll: function () { soon(400); },
    settingsSheet: function (body) { if (A && A.el) settingsBlock(body); },
    // tests
    _draw: draw, _drawn: function () { return drawn; }, _on: on, MAX: MAX_IN_VIEW
  };
})();
