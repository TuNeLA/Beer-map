/* Öl Nu — 📍 MYPINS: "my" bars stay on the map at every zoom (CONTRACT "PIN-NIVÅER" → 📍 Mina ställen).
   window.MYPINS, in app.js mods(): init, onPoll. No RPC, no new button. Owner: "när man zoomar ut mycket ser man inte
   ställena, inte ens dom man ska till".
   My bars (one reason each, best first):
     🏃 my "Jag ä på väg" target (BARSPLUS.eta.mine) · 🪖 a call-out I made or said yes / maybe to (RALLY.list) ·
     🚪 the bar I am checked in at (olnu.checkin) · 👥 friends / group mates drinking there now (app beers with friend_name) ·
     📅 my "Går" events tonight (EVSHEET going state, event at a bar or with its own point) · 📍 the selected bar (open sheet).
   - js/tiers.js gives these bars the full pill whenever their marker is drawn (ignores cap, HUD zone and minimum zooms).
   - Where no marker of that bar shows (zoom < 13 for quiet bars, < 11 for every bar, or a dot hidden in the town view), a small
     labelled pin "🏃 Pitchers" is drawn in its own pane "mypins" (z 700: above the people count chips 600 and every bar pane).
     Max 8 pins in view; pins that would touch merge into the best one (with +N). Tap → zoom to the bar (z ≥ 16) and open its sheet.
   - Redrawn after each tier pass (js/tiers.js calls MYPINS.sync), on the poll and on moveend; diffed by id. */
(function () {
  "use strict";
  var A = null, map = null, layer = null, drawn = {}, raf = 0, MAX = 8;
  var RANK = { eta: 6, rally: 5, ci: 4, friends: 3, go: 2, sel: 1 };
  var EMO = { eta: "🏃", rally: "🪖", ci: "🚪", friends: "👥", go: "📅", sel: "📍" };
  var CSS =
    ".leaflet-mypins-pane .mp-w{background:none;border:0}" +
    ".mp-pin{position:absolute;left:0;bottom:0;transform:translate(-50%,0);display:inline-flex;align-items:center;gap:3px;padding:2px 7px 2px 5px;" +
      "border-radius:12px;background:rgba(16,22,36,.95);border:1.5px solid var(--amber,#f5a623);color:#fff6e0;white-space:nowrap;" +
      "font:700 11px/1.25 var(--body,system-ui,sans-serif);box-shadow:0 2px 6px rgba(0,0,0,.55);cursor:pointer;max-width:150px}" +
    ".mp-pin::after{content:\"\";position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);border:6px solid transparent;border-top-color:var(--amber,#f5a623);border-bottom:0}" +
    ".mp-pin b{overflow:hidden;text-overflow:ellipsis;font-weight:700}" +
    ".mp-pin.mp-friends{border-color:var(--green,#3ddc84)}.mp-pin.mp-friends::after{border-top-color:var(--green,#3ddc84)}" +
    ".mp-more{font-style:normal;font-weight:700;color:var(--amber-2,#ffd27a);margin-left:2px}" +
    ".mp-dot{position:absolute;left:-4px;top:-4px;width:8px;height:8px;border-radius:50%;background:var(--amber,#f5a623);border:1.5px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.6)}";
  function sv() { return !window.I18N || window.I18N.lang !== "en"; }
  function byId(id) { try { return id != null && window.BARS && window.BARS.byId ? window.BARS.byId(String(id)) || null : null; } catch (e) { return null; } }
  function spot(lat, lng) { try { return window.BARS && window.BARS.nearestSpot ? window.BARS.nearestSpot(+lat, +lng) : null; } catch (e) { return null; } }
  // {key: {id, lat, lng, name, why}}; key = bar id (or "p:lat,lng" for a place with no bar)
  function mine() {
    var out = {};
    var add = function (why, bar, lat, lng, name) {
      if (!bar && !(isFinite(lat) && isFinite(lng))) return;
      var k = bar ? String(bar.id) : "p:" + (+lat).toFixed(4) + "," + (+lng).toFixed(4), o = out[k];
      if (o && RANK[o.why] >= RANK[why]) return;
      out[k] = { id: bar ? String(bar.id) : null, lat: bar ? bar.lat : +lat, lng: bar ? bar.lng : +lng, name: (bar && bar.name) || name || "", why: why };
    };
    try { var e = window.BARSPLUS && window.BARSPLUS.eta && window.BARSPLUS.eta.mine && window.BARSPLUS.eta.mine();
      if (e && !e.arrived) add("eta", byId(e.bar_id) || spot(e.lat, e.lng), e.lat, e.lng, e.bar_name); } catch (x) {}
    try { (window.RALLY && window.RALLY.list ? window.RALLY.list() : []).forEach(function (r) {
      if (!(r.is_mine || r.my_answer === "yes" || r.my_answer === "maybe")) return;
      add("rally", byId(r.bar_id) || spot(r.lat, r.lng), r.lat, r.lng, r.place); }); } catch (x) {}
    try { var c = window.U && window.U.ls ? window.U.ls.getJSON("olnu.checkin", null) : null;
      if (c && c.until && Date.now() < c.until) add("ci", byId(c.id) || spot(c.lat, c.lng), c.lat, c.lng, c.name); } catch (x) {}
    try { (A && A.beers ? A.beers() : []).forEach(function (b) {
      if (!b.friend_name || !b.precise || b.snap === "area") return;
      var bar = byId(b.bar_id) || (b.snap ? null : spot(b.lat, b.lng)); if (bar) add("friends", bar); }); } catch (x) {}
    try {
      var ev = window.EVSHEET, rows = ev && ev._cache ? (ev._cache().rows || []) : [], gs = ev && ev._going ? ev._going() : null, now = Date.now();
      rows.forEach(function (r) {
        var s = gs && gs.by && gs.by[String(r.id)]; if (!s || !s.mine) return;
        var st = Date.parse(r.starts_at); if (!(st > now - 4 * 3600e3 && st < now + 16 * 3600e3)) return;   // tonight
        add("go", byId(r.bar_id), r.lat, r.lng, r.place || r.title);
      });
    } catch (x) {}
    try { var sel = document.querySelector(".cm.cm-sel[data-bar]"); if (sel) add("sel", byId(sel.getAttribute("data-bar"))); } catch (x) {}
    return out;
  }
  function ids() { var m = mine(), o = {}; Object.keys(m).forEach(function (k) { if (m[k].id) o[m[k].id] = m[k].why; }); return o; }
  // the bar's own marker is on screen (and not a hidden dot)?
  function shown(id) {
    if (!id || !map) return false;
    var ic = map.getContainer().querySelector('.cm[data-bar="' + String(id).replace(/["\\]/g, "") + '"]'); if (!ic) return false;
    try { return getComputedStyle(ic).opacity > 0.3; } catch (e) { return true; }
  }
  function label(x) {
    var n = String(x.name || (sv() ? "Hit" : "Here")); if (n.length > 18) n = n.slice(0, 17) + "…";
    return '<div class="mp-pin mp-' + x.why + '" title="' + window.U.esc(x.name || "") + '"><span aria-hidden="true">' + (x.whys || EMO[x.why]) + "</span><b>" + window.U.esc(n) + "</b>" +
      (x.more ? '<i class="mp-more">+' + x.more + "</i>" : "") + '</div><i class="mp-dot" aria-hidden="true"></i>';
  }
  function sync() {
    if (!map || !layer || !window.L) return;
    var m = mine(), W = map.getSize().x, H = map.getSize().y;
    var list = Object.keys(m).map(function (k) { var x = m[k]; x.k = k; x.p = map.latLngToContainerPoint([x.lat, x.lng]); return x; })
      .filter(function (x) { return x.p.x > -40 && x.p.y > -40 && x.p.x < W + 40 && x.p.y < H + 40 && !shown(x.id); })
      .sort(function (a, b) { return RANK[b.why] - RANK[a.why]; });
    var kept = [], want = {};
    list.forEach(function (x) {
      var near = null;
      kept.forEach(function (k) { if (!near && Math.abs(k.p.x - x.p.x) < 70 && Math.abs(k.p.y - x.p.y) < 26) near = k; });
      if (near) {   // one pin: "🏃👥 La Parma +1"
        near.more = (near.more || 0) + 1;
        var w0 = near.whys || EMO[near.why]; near.whys = w0.indexOf(EMO[x.why]) >= 0 ? w0 : w0 + EMO[x.why]; return;
      }
      if (kept.length >= MAX) return;
      x.more = 0; x.whys = null; kept.push(x); want[x.k] = x;
    });
    Object.keys(drawn).forEach(function (k) {
      var d = drawn[k], w = want[k];
      if (!w) { layer.removeLayer(d.m); delete drawn[k]; return; }
      var wk = w.why + "|" + w.name + "|" + w.more + "|" + w.whys;
      if (d.key !== wk) { d.key = wk; d.m.setIcon(icon(w)); }
      d.m.setLatLng([w.lat, w.lng]); delete want[k];
    });
    Object.keys(want).forEach(function (k) {
      var x = want[k], mk = window.L.marker([x.lat, x.lng], { pane: "mypins", icon: icon(x), keyboard: true, title: x.name, bubblingMouseEvents: false, zIndexOffset: RANK[x.why] * 100 });
      mk.on("click", function () { go(x); });
      mk.addTo(layer); drawn[k] = { m: mk, key: x.why + "|" + x.name + "|" + x.more + "|" + x.whys };
    });
  }
  function icon(x) { return window.L.divIcon({ html: label(x), className: "mp-w", iconSize: [0, 0], iconAnchor: [0, 10] }); }
  function go(x) {
    var z = Math.max(16, map.getZoom());
    map.once("moveend", function () { setTimeout(function () {
      var ic = x.id && map.getContainer().querySelector('.cm[data-bar="' + String(x.id).replace(/["\\]/g, "") + '"] .bar-ico');
      if (ic) ic.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, 350); });
    map.setView([x.lat, x.lng], z);
  }
  function soon() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; try { sync(); } catch (e) {} }); }
  window.MYPINS = {
    init: function (api) {
      A = api; map = A.map;
      if (!map.getPane("mypins")) { map.createPane("mypins"); map.getPane("mypins").style.zIndex = 700; }
      var st = document.createElement("style"); st.id = "mypins-css"; st.textContent = CSS; document.head.appendChild(st);
      layer = window.L.layerGroup().addTo(map);
      map.on("moveend zoomend popupopen popupclose", soon);
      soon();
    },
    onPoll: function () { soon(); },
    sync: soon, ids: ids, _mine: mine, _drawn: function () { return Object.keys(drawn); }
  };
})();
