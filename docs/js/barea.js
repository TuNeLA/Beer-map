/* Öl Nu — ✏️ BAREA "Rita krogens yta" (CONTRACT "BAREA · krogens yta", migration 0095).
   Open data has no premises outlines; barlit.js lights only the part of a big house near the bar (build time). Here a
   user draws the bar's real premises, and an approved drawing replaces that automatic part for everyone.
   - Entry: bar sheet → "🚩 Fel plats / stängt?" → first row "✏️ Rita krogens yta" (events.js calls BAREA.reportHook).
     No new map button.
   - Editor: the map flies to zoom 19 on the bar; the app's dock (ÖL!), markers and lit houses step aside while it is open.
     Tap = a corner, drag a corner to move it, "↶ Ångra" = the last corner, "🗑️ Rensa", "✕ Avbryt", "✅ Klar" (≥ 3 corners).
     The polygon shows live in amber with its area. A corner within 1.5 m of a house wall / corner (BARLIT.edges) snaps to it.
     Checked here and on the server: 3–40 corners, each ≤ 60 m from the bar, 20–3000 m², no crossing edges.
   - Server: submit_bar_area(bar_id, [[lng, lat]…]) (10 per day) → pending, or ok at once for the owner's trusted account.
     bar_areas_in(s, w, n, e) per building tile (0.05° × 0.1°, zoom ≥ 15, cached 10 min) → approved areas + my own pending.
   - BARLIT reads BAREA.areas() / BAREA.areaFor(id) and draws them instead of the automatic part (my pending one dashed).
   - Owner review: docs/stats-areas.js in stats.html (owner key): list + mini map, ✅ Godkänn / 🙈 Avvisa, and
     "📱 Den här mobilen är min" (owner_trust_me) so the owner's own drawings need no review.
   Hooks (app.js mods): init, onAuthed. Missing RPC (old database) → the feature hides quietly. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, L = window.L;
  var A = null, map = null, off = false;
  var D = [0.05, 0.1], TTL = 10 * 60e3, MAXPTS = 40, SNAP_M = 1.5, MAX_M = 60, MIN_M2 = 20, MAX_M2 = 3000;
  var cache = {};       // tile key -> { at, rows }
  var byId = {};        // canonical bar id -> area
  var sigNow = "";
  var ed = null;        // editor state
  function sv() { return !I || I.lang !== "en"; }
  function T(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(k, a) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[k]) i = (i + 1) % a.length; lastPick[k] = i; return a[i]; }
  function canon(id) { try { return window.BARS && window.BARS.canonId ? window.BARS.canonId(id) : String(id); } catch (e) { return String(id); } }

  /* ---------- texts (dalmål + military, ä for é) ---------- */
  var X = {
    entry: ["✏️ Rita krogens yta", "✏️ Draw the bar's area"],
    entrySub: ["Lyser fel del av huset? Tryck ut krogens hörn på kartan, så lyser rätt yta.", "Wrong part of the house lit? Tap the bar's corners on the map."],
    hint0: ["Tryck ut krogens hörn ett i taget. Dra ett hörn för att flytta det.", "Tap the bar's corners one by one. Drag a corner to move it."],
    hint1: ["Bra! Fortsätt runt krogen – minst 3 hörn.", "Good! Keep going around the bar – at least 3 corners."],
    hintN: ["{n} hörn · {m2} m²", "{n} corners · {m2} m²"],
    snapped: [" · fäst vid väggen", " · snapped to the wall"],
    undo: ["↶ Ångra", "↶ Undo"], clear: ["🗑️ Rensa", "🗑️ Clear"], cancel: ["✕ Avbryt", "✕ Cancel"], done: ["✅ Klar", "✅ Done"],
    sending: ["Skickar…", "Sending…"],
    title: ["✏️ Krogens yta", "✏️ Bar area"],
    max: ["Max 40 hörn. Hä ä ingen slottsritning.", "Max 40 corners."],
    sentPend: ["✏️ Ritningen ä inne hos högkvarteret. Du ser den streckad tills den ä godkänd.",
      "✏️ Mottaget, kartograf! Syns för dig nu, för alla efter godkännande.",
      "✏️ Ritningen ligger på generalens bord. Streckad tills han stämplat den.",
      "✏️ Tack, soldat! Lantmäteriet i Ludvika granskar ritningen."],
    sentPendEn: ["✏️ Thanks! You see it dashed until it is approved."],
    sentOk: ["✏️ Godkänd direkt, chefen. Krogen lyser rätt nu.", "✏️ Stämplad och klar! Nu lyser rätt yta.", "✏️ Generalens egen ritning – gäller på en gång."],
    sentOkEn: ["✏️ Approved at once – the bar area is live."],
    errs: {
      few: ["Minst 3 hörn behövs.", "At least 3 corners."],
      too_far: ["Ett hörn ligger över 60 m från krogen. Håll dig vid huset.", "A corner is more than 60 m from the bar."],
      area_size: ["Ytan måste vara 20–3000 m². Kolla hörnen.", "The area must be 20–3000 m²."],
      self_cross: ["Kanterna korsar varann. Flytta ett hörn så det blir en ren form.", "The edges cross. Move a corner."],
      slow_down: ["Lugn i stormen – max 10 ritningar om dan.", "Easy – max 10 drawings a day."],
      unknown_bar: ["Den krogen hittar servern int'.", "The server does not know this bar."],
      invalid_area: ["Ritningen gick int' att läsa. Försök igen.", "Could not read the drawing."],
      offline: ["Ingen kontakt med servern. Försök igen.", "No connection. Try again."],
      error: ["Nåt gick snett. Försök igen.", "Something went wrong. Try again."]
    }
  };
  function two(k) { return T(X[k][0], X[k][1]); }
  function errText(c) { var m = X.errs[c] || X.errs.error; return T(m[0], m[1]); }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }

  /* ---------- geometry (local metres around a point) ---------- */
  function frame(lat0, lng0) {
    var kx = Math.cos(lat0 * Math.PI / 180) * 111195, ky = 111195;
    return { to: function (ll) { return [(ll[1] - lng0) * kx, (ll[0] - lat0) * ky]; }, from: function (p) { return [lat0 + p[1] / ky, lng0 + p[0] / kx]; } };
  }
  function areaM2(pts, F) {   // pts = [[lat, lng]…]
    var a = 0, q = pts.map(F.to);
    for (var i = 0; i < q.length; i++) { var p = q[i], r = q[(i + 1) % q.length]; a += p[0] * r[1] - r[0] * p[1]; }
    return Math.abs(a / 2);
  }
  function crosses(pts, F) {
    var q = pts.map(F.to), n = q.length;
    var side = function (a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); };
    for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      var a = q[i], b = q[(i + 1) % n], c = q[j], d = q[(j + 1) % n];
      var d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
    return false;
  }
  // → error code or null
  function check(pts, bar) {
    if (pts.length < 3) return "few";
    if (pts.length > MAXPTS) return "invalid_area";
    var F = frame(bar.lat, bar.lng);
    if (pts.some(function (p) { var m = F.to(p); return Math.hypot(m[0], m[1]) > MAX_M; })) return "too_far";
    if (crosses(pts, F)) return "self_cross";
    var a = areaM2(pts, F);
    if (a < MIN_M2 || a > MAX_M2) return "area_size";
    return null;
  }
  // nearest house corner (preferred) or wall point within SNAP_M → [lat, lng] or null
  function snap(ll) {
    var rings = []; try { rings = window.BARLIT && window.BARLIT.edges ? window.BARLIT.edges(ll[0], ll[1], 40) : []; } catch (e) {}
    if (!rings.length) return null;
    var F = frame(ll[0], ll[1]), bestV = null, dv = SNAP_M, bestE = null, de = SNAP_M;
    rings.forEach(function (r) {
      var q = r.map(function (p) { return F.to([p[0], p[1]]); });
      for (var i = 0; i < q.length; i++) {
        var a = q[i], b = q[(i + 1) % q.length], d = Math.hypot(a[0], a[1]);
        if (d < dv) { dv = d; bestV = a; }
        var dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; if (!l) continue;
        var t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / l)), x = a[0] + t * dx, y = a[1] + t * dy, e = Math.hypot(x, y);
        if (e < de) { de = e; bestE = [x, y]; }
      }
    });
    var p = bestV || bestE;
    return p ? F.from(p) : null;
  }

  /* ---------- areas from the server ---------- */
  function keysInView() {
    var b = map.getBounds().pad(0.1), out = [];
    var y0 = Math.floor(b.getSouth() / D[0]), y1 = Math.floor(b.getNorth() / D[0]), x0 = Math.floor(b.getWest() / D[1]), x1 = Math.floor(b.getEast() / D[1]);
    if ((y1 - y0 + 1) * (x1 - x0 + 1) > 16) return out;
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) out.push(y + "_" + x);
    return out;
  }
  function rebuild() {
    var next = {};
    Object.keys(cache).forEach(function (k) {
      (cache[k].rows || []).forEach(function (r) {
        if (!r || !r.bar_id || !Array.isArray(r.polygon) || r.polygon.length < 3) return;
        var id = canon(r.bar_id), cur = next[id];
        var a = { id: r.id, bar_id: id, ll: r.polygon.map(function (p) { return [+p[1], +p[0]]; }), pending: r.status !== "ok", mine: !!r.mine, m2: r.area_m2 };
        // my own newest drawing wins (I just drew it), else the approved one
        if (!cur || (a.mine && a.pending && (!cur.pending || a.id > cur.id)) || (!cur.mine && !a.pending && a.id > cur.id)) next[id] = a;
      });
    });
    var s = Object.keys(next).sort().map(function (k) { var a = next[k]; return k + ":" + a.id + (a.pending ? "p" : ""); }).join(",");
    byId = next;
    if (s !== sigNow) { sigNow = s; try { if (window.BARLIT && window.BARLIT.redraw) window.BARLIT.redraw(); } catch (e) {} }
  }
  var busy = 0;
  function load(force) {
    if (off || !map || !A || !A.LIVE || !A.authed || !A.authed() || map.getZoom() < 15) return;
    var keys = keysInView(), n = 0;
    keys.forEach(function (k) {
      var c = cache[k];
      if (!force && c && (c.loading || Date.now() - c.at < TTL)) return;
      if (n++ >= 4) return;
      var yx = k.split("_").map(Number), s = yx[0] * D[0], w = yx[1] * D[1];
      cache[k] = { at: c ? c.at : 0, rows: c ? c.rows : [], loading: true };
      busy++;
      A.rpc("bar_areas_in", { p_s: s, p_w: w, p_n: s + D[0], p_e: w + D[1] }).then(function (r) {
        busy--;
        if (r.error) { if (U.missing(r.error)) off = true; cache[k].loading = false; return; }
        var rows = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
        cache[k] = { at: Date.now(), rows: Array.isArray(rows) ? rows : [] };
        rebuild();
      });
    });
  }
  function keyOf(lat, lng) { return Math.floor(lat / D[0]) + "_" + Math.floor(lng / D[1]); }

  /* ---------- editor ---------- */
  var CSS = "body.ba-edit .dock,body.ba-edit .leaflet-bars-pane,body.ba-edit .leaflet-hotbars-pane,body.ba-edit .leaflet-marker-pane," +
    "body.ba-edit .leaflet-popup-pane,body.ba-edit .attrib-btn,body.ba-edit .locate-btn{visibility:hidden !important}" +
    "body.ba-edit .leaflet-barlit-pane path{pointer-events:none !important}body.ba-edit .leaflet-barlit-pane{opacity:.4}" +
    "body.ba-edit #map{cursor:crosshair}" +
    ".ba-dock{position:fixed;z-index:1100;left:0;right:0;bottom:0;margin:0 auto;max-width:560px;background:var(--ds-sheet,#121a2a);" +
    "border-top:1px solid var(--ds-border-2,rgba(255,255,255,.16));border-radius:var(--ds-r-3,20px) var(--ds-r-3,20px) 0 0;box-shadow:var(--ds-sh-2);" +
    "padding:var(--ds-3,12px) calc(var(--sar,0px) + var(--ds-4,16px)) calc(var(--sab,0px) + var(--ds-4,16px)) calc(var(--sal,0px) + var(--ds-4,16px))}" +
    ".ba-dock .ba-k{font-size:var(--ds-fs-12,12px);line-height:16px;letter-spacing:.08em;text-transform:uppercase;color:var(--ds-amber-t,#ffc24d);font-weight:700;margin:0 0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".ba-dock .ba-h{font-size:var(--ds-fs-14,14px);line-height:20px;color:var(--ds-text-2,#c9d0cd);margin:0 0 var(--ds-3,12px);min-height:40px}" +
    ".ba-row{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--ds-2,8px);margin-bottom:var(--ds-2,8px)}" +
    ".ba-row .btn,.ba-dock .ba-ok{min-height:52px;font-size:var(--ds-fs-16,16px)}" +
    ".ba-dock .ba-ok{width:100%;min-height:56px}" +
    ".ba-pt{width:44px !important;height:44px !important;margin:-22px 0 0 -22px !important;display:grid;place-items:center;touch-action:none}" +
    ".ba-pt i{display:block;width:18px;height:18px;border-radius:50%;background:#ffc24d;border:3px solid #241300;box-shadow:0 0 0 2px #ffc24d,0 2px 6px rgba(0,0,0,.6)}" +
    ".ba-pt.ba-last i{background:#fff}" +
    ".ba-bar{width:28px !important;height:28px !important;margin:-14px 0 0 -14px !important;font-size:20px;line-height:28px;text-align:center;pointer-events:none;filter:drop-shadow(0 1px 2px #000)}" +
    ".ba-card{margin:0 0 var(--ds-4,16px);padding:var(--ds-3,12px);border:1px solid rgba(245,166,35,.45);border-radius:var(--ds-r-2,16px);background:var(--ds-amber-soft,rgba(245,166,35,.14))}" +
    ".ba-card p{margin:var(--ds-2,8px) 0 0 !important;font-size:var(--ds-fs-14,14px)}";

  function stripUp() { try { return window.OLNU_STRIP && window.OLNU_STRIP.up(); } catch (e) { return false; } }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "text") n.textContent = attrs[k]; else if (k === "onclick") n.addEventListener("click", attrs[k]); else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  function open(bar) {
    if (!A || !map || off || !bar || ed) return false;
    if (!A.LIVE || !A.authed || !A.authed()) { A.toast(errText("offline"), { err: true }); return false; }
    if (stripUp()) return false;
    try { A.map.closePopup(); } catch (e) {}
    try { if (A.sheetOpen && A.sheetOpen()) A.closeSheet("barea"); } catch (e) {}
    if (!map.getPane("baedit")) { map.createPane("baedit"); map.getPane("baedit").style.zIndex = 670; }
    ed = { bar: { id: canon(bar.id), name: bar.name || "", lat: +bar.lat, lng: +bar.lng }, pts: [], marks: [], snapped: false, sending: false };
    ed.layer = L.layerGroup().addTo(map);
    var house = null; try { house = window.BARLIT && window.BARLIT.house ? window.BARLIT.house(ed.bar.id) : null; } catch (e) {}
    if (house) L.polygon(house, { pane: "baedit", color: "#ffffff", weight: 1.5, opacity: 0.7, dashArray: "4 4", fill: false, interactive: false }).addTo(ed.layer);
    L.marker([ed.bar.lat, ed.bar.lng], { pane: "baedit", interactive: false, icon: L.divIcon({ className: "ba-bar", html: "🍺", iconSize: [28, 28] }) }).addTo(ed.layer);
    ed.poly = L.polygon([], { pane: "baedit", color: "#ffb02e", weight: 3, opacity: 1, fillColor: "#ffb02e", fillOpacity: 0.3, interactive: false }).addTo(ed.layer);
    ed.line = L.polyline([], { pane: "baedit", color: "#ffb02e", weight: 3, opacity: 1, dashArray: "6 6", interactive: false }).addTo(ed.layer);
    document.body.classList.add("ba-edit");
    buildDock();
    map.on("click", onMapClick);
    document.addEventListener("keydown", onKey);
    map.flyTo([ed.bar.lat, ed.bar.lng], 19, { duration: 0.8 });
    update();
    return true;
  }
  function buildDock() {
    var d = el("div", { class: "ba-dock", id: "ba-dock", role: "region", "aria-label": two("title") });
    ed.hint = el("p", { class: "ba-h", "aria-live": "polite" });
    ed.bUndo = el("button", { type: "button", class: "btn btn-ghost", "data-ba": "undo", text: two("undo"), onclick: undo });
    ed.bClear = el("button", { type: "button", class: "btn btn-ghost", "data-ba": "clear", text: two("clear"), onclick: clearPts });
    var bCancel = el("button", { type: "button", class: "btn btn-danger", "data-ba": "cancel", text: two("cancel"), onclick: function () { close(); } });
    ed.bDone = el("button", { type: "button", class: "btn btn-amber ba-ok", "data-ba": "done", text: two("done"), onclick: submit });
    d.appendChild(el("p", { class: "ba-k", text: two("title") + " · " + ed.bar.name }));
    d.appendChild(ed.hint);
    d.appendChild(el("div", { class: "ba-row" }, [ed.bUndo, ed.bClear, bCancel]));
    d.appendChild(ed.bDone);
    L.DomEvent.disableClickPropagation(d);
    document.body.appendChild(d);
    ed.dock = d;
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  function onMapClick(e) {
    if (!ed || ed.sending || !e.latlng) return;
    if (ed.pts.length >= MAXPTS) { A.toast(two("max"), { err: true }); return; }
    var ll = [e.latlng.lat, e.latlng.lng], s = snap(ll);
    ed.snapped = !!s;
    ed.pts.push(s || ll);
    redrawMarks(); update();
    try { window.FX.vibrate(8); } catch (x) {}
  }
  function redrawMarks() {
    ed.marks.forEach(function (m) { ed.layer.removeLayer(m); });
    ed.marks = ed.pts.map(function (p, i) {
      var m = L.marker(p, { pane: "baedit", draggable: true, autoPan: true, keyboard: false,
        icon: L.divIcon({ className: "ba-pt" + (i === ed.pts.length - 1 ? " ba-last" : ""), html: "<i></i>", iconSize: [44, 44] }) });
      m.on("drag", function (ev) { var q = ev.target.getLatLng(); ed.pts[i] = [q.lat, q.lng]; update(true); });
      m.on("dragend", function (ev) { var q = ev.target.getLatLng(), s = snap([q.lat, q.lng]); ed.snapped = !!s; ed.pts[i] = s || [q.lat, q.lng]; ev.target.setLatLng(ed.pts[i]); update(); });
      m.addTo(ed.layer);
      return m;
    });
  }
  function update(quick) {
    if (!ed) return;
    var n = ed.pts.length;
    ed.poly.setLatLngs(n >= 3 ? ed.pts : []);
    ed.line.setLatLngs(n === 2 ? ed.pts : []);
    if (quick) return;
    var m2 = n >= 3 ? Math.round(areaM2(ed.pts, frame(ed.bar.lat, ed.bar.lng))) : 0;
    ed.hint.textContent = n === 0 ? two("hint0") : n < 3 ? two("hint1") : fill(two("hintN"), { n: n, m2: m2 }) + (ed.snapped ? two("snapped") : "");
    ed.bUndo.disabled = !n; ed.bClear.disabled = !n; ed.bDone.disabled = n < 3 || ed.sending;
  }
  function undo() { if (!ed || !ed.pts.length) return; ed.pts.pop(); ed.snapped = false; redrawMarks(); update(); }
  function clearPts() { if (!ed) return; ed.pts = []; ed.snapped = false; redrawMarks(); update(); }
  function close() {
    if (!ed) return;
    map.off("click", onMapClick);
    document.removeEventListener("keydown", onKey);
    try { map.removeLayer(ed.layer); } catch (e) {}
    if (ed.dock) ed.dock.remove();
    document.body.classList.remove("ba-edit");
    ed = null;
  }
  function code(err) {
    var m = String((err && (err.message || err.details || err.hint)) || "");
    var k = ["too_far", "area_size", "self_cross", "slow_down", "unknown_bar", "invalid_area"].filter(function (c) { return m.indexOf(c) >= 0; })[0];
    return k || (/fetch|network|timeout/i.test(m) ? "offline" : "error");
  }
  function submit() {
    if (!ed || ed.sending) return;
    var bad = check(ed.pts, ed.bar);
    if (bad) { A.toast(errText(bad), { err: true }); return; }
    ed.sending = true; ed.bDone.textContent = two("sending"); update();
    var bar = ed.bar, poly = ed.pts.map(function (p) { return [Math.round(p[1] * 1e6) / 1e6, Math.round(p[0] * 1e6) / 1e6]; });
    A.rpc("submit_bar_area", { p_bar_id: bar.id, p_polygon: poly }).then(function (r) {
      if (!ed) return;
      ed.sending = false; ed.bDone.textContent = two("done");
      if (r.error) {
        if (U.missing(r.error)) { off = true; close(); return; }
        update(); A.toast(errText(code(r.error)), { err: true }); return;
      }
      var d = typeof r.data === "string" ? JSON.parse(r.data) : r.data || {};
      var ok = d.status === "ok";
      // show it at once (my own row), then refresh that tile from the server
      var k = keyOf(bar.lat, bar.lng), c = cache[k] || (cache[k] = { at: 0, rows: [] });
      c.rows = (c.rows || []).concat([{ id: d.id || Date.now(), bar_id: bar.id, polygon: d.polygon || poly, area_m2: d.area_m2, status: ok ? "ok" : "pending", mine: true }]);
      rebuild();
      close();
      A.toast(sv() ? pick(ok ? "ok" : "pend", ok ? X.sentOk : X.sentPend) : (ok ? X.sentOkEn : X.sentPendEn)[0]);
      setTimeout(function () { if (cache[k]) cache[k].at = 0; load(); }, 1500);
    });
  }

  /* ---------- 🚩 report sheet row (events.js) ---------- */
  function reportHook(body, bar) {
    if (off || !A || !A.LIVE || !bar || bar.lat == null) return;
    var b = el("button", { type: "button", class: "btn btn-amber btn-block", "data-ba": "open", text: two("entry"),
      onclick: function () { A.closeSheet("barea"); setTimeout(function () { open(bar); }, 120); } });
    body.appendChild(el("div", { class: "ba-card" }, [b, el("p", { text: two("entrySub") })]));
  }

  window.BAREA = {
    init: function (api) {
      A = api; map = api && api.map; if (!map || !L) return;
      var st = document.createElement("style"); st.id = "ba-css"; st.textContent = CSS; document.head.appendChild(st);
      map.on("moveend zoomend", U.debounce(function () { load(); }, 400));
    },
    onAuthed: function () { setTimeout(function () { load(true); }, 600); },
    areas: function () { return Object.keys(byId).map(function (k) { return byId[k]; }); },
    areaFor: function (id) { return byId[canon(id)] || null; },
    open: open, close: close, reportHook: reportHook,
    // test hooks
    _check: check, _snap: snap, _ed: function () { return ed; }, _load: load, _cache: function () { return cache; },
    _tap: function (lat, lng) { onMapClick({ latlng: { lat: lat, lng: lng } }); }
  };
})();
