/* Öl Nu v28 — 🏠 Hemzon, easy to find (CONTRACT v14 "Hemzon", phone only: localStorage olnu.home = {lat, lng, r, at}).
   v14 had it at the very bottom of ⚙️ with a fixed 300 m and "set here" only. Now: ⚙️ right under the name and
   📍 Hemstad (hook settingsName) one row "🏠 Hemzon: på · 300 m ›" → sheet with a small map preview (tap the map =
   "sätt min hemadress"), "📍 Använd nuvarande plats", a radius slider (100–1000 m), Spara / Ta bort.
   What it does (unchanged, v14 PRIVACY.inHome reads r): a drink inside the zone is posted as an area (≈ 550 m grid),
   never as the exact spot, unless you pick a bar or restaurant. Nothing leaves the phone. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, KEY = "olnu.home", R0 = 300, RMIN = 100, RMAX = 1000;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function home() { var h = U.ls.getJSON(KEY, null); return h && isFinite(h.lat) && isFinite(h.lng) ? h : null; }
  function label() {
    var h = home();
    return h ? L("🏠 Hemzon: på · ", "🏠 Home zone: on · ") + (h.r || R0) + " m" : L("🏠 Hemzon: av – sätt din hemadress", "🏠 Home zone: off – set your home");
  }
  function row(body) {
    var b = A.btn(label() + " ›", "btn-block hz-row", function () { open(); });
    body.appendChild(A.el("div", { class: "row hz-set", style: "margin-top:8px" }, [b]));
  }
  function open() {
    var h = home(), st = { lat: h ? h.lat : null, lng: h ? h.lng : null, r: h ? h.r || R0 : R0 }, mini = null, circ = null, dot = null;
    A.openSheet(L("🏠 Hemzon", "🏠 Home zone"), function (body) {
      var el = A.el;
      body.appendChild(el("p", { class: "muted", style: "margin-top:0", text: L("En öl inom hemzonen visas alltid som ungefärlig plats (som ”Bara område”), så ingen ser exakt var du bor. Väljer du en krog gäller krogen. Sparas bara på din telefon.",
        "A drink inside the zone always shows as an approximate area, so nobody sees where you live. Picking a bar uses the bar. Kept on this phone only.") }));
      var mapEl = el("div", { class: "hz-map", role: "img", "aria-label": L("Karta över hemzonen", "Home zone map") });
      body.appendChild(mapEl);
      var hint = el("p", { class: "muted hz-hint", text: L("👆 Tryck på kartan där du bor – eller använd din plats.", "👆 Tap the map where you live – or use your location.") });
      body.appendChild(hint);
      var gps = A.btn(L("📍 Använd nuvarande plats", "📍 Use my location"), "btn-block", function () {
        gps.disabled = true;
        A.getPosition().then(function (pos) {
          gps.disabled = false;
          setPt(+pos.coords.latitude.toFixed(5), +pos.coords.longitude.toFixed(5), true);
        }, function (e) { gps.disabled = false; try { A.locError(e); } catch (x) {} });
      });
      body.appendChild(el("div", { class: "row", style: "margin:8px 0" }, [gps]));
      var rl = el("label", { class: "ev-l", for: "hz-r", text: "" });
      var rng = el("input", { type: "range", id: "hz-r", class: "hz-range", min: String(RMIN), max: String(RMAX), step: "50", value: String(st.r) });
      function rText() { rl.textContent = L("Radie: ", "Radius: ") + st.r + " m"; }
      rng.addEventListener("input", function () { st.r = +rng.value; rText(); draw(); });
      rText();
      body.appendChild(rl); body.appendChild(rng);
      var save = A.btn(L("💾 Spara hemzonen", "💾 Save home zone"), "btn-amber btn-block", function () {
        if (st.lat == null) { A.toast(L("Välj en plats först.", "Pick a spot first."), { err: true }); return; }
        U.ls.setJSON(KEY, { lat: st.lat, lng: st.lng, r: st.r, at: Date.now() });
        A.toast(L("🏠 Hemzonen ä sparad (" + st.r + " m). Hemma ä du bara ett område.", "🏠 Home zone saved (" + st.r + " m)."));
        A.closeSheet();
      });
      var clr = A.btn(L("Ta bort hemzonen", "Remove home zone"), "btn-small btn-ghost", function () {
        U.ls.del(KEY); A.toast(L("Hemzonen ä borttagen.", "Home zone removed.")); A.closeSheet();
      });
      body.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [save]));
      if (h) body.appendChild(el("div", { class: "row", style: "margin-top:6px" }, [clr]));
      function setPt(la, ln, fly) {
        st.lat = la; st.lng = ln;
        hint.textContent = L("✅ Punkt vald. Dra i reglaget för storleken och tryck Spara.", "✅ Spot picked. Set the size and save.");
        draw(fly);
      }
      function draw(fly) {
        if (!mini || st.lat == null) return;
        var Lf = window.L, ll = [st.lat, st.lng];
        if (!circ) circ = Lf.circle(ll, { radius: st.r, color: "#f5a623", weight: 2, fillColor: "#f5a623", fillOpacity: 0.15, interactive: false }).addTo(mini);
        else { circ.setLatLng(ll); circ.setRadius(st.r); }
        if (!dot) dot = Lf.circleMarker(ll, { radius: 6, color: "#fff", weight: 2, fillColor: "#f5a623", fillOpacity: 1, interactive: false }).addTo(mini);
        else dot.setLatLng(ll);
        if (fly) mini.fitBounds(circ.getBounds().pad(0.3));
      }
      setTimeout(function () {
        if (!window.L || !document.body.contains(mapEl)) return;
        try {
          mini = window.L.map(mapEl, { zoomControl: false, attributionControl: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false });
          window.L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 19 }).addTo(mini);
          var c = st.lat != null ? [st.lat, st.lng] : (function () { try { var l = A.lastLoc && A.lastLoc(); if (l && isFinite(l.lat)) return [l.lat, l.lng]; } catch (e) {} var m = A.map.getCenter(); return [m.lat, m.lng]; })();
          mini.setView(c, 15);
          mini.on("click", function (e) { setPt(+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5), false); });
          draw(true);
          setTimeout(function () { try { mini.invalidateSize(); } catch (e) {} }, 80);
        } catch (e) { mapEl.remove(); }
      }, 60);
    }, { now: true, onClose: function () { try { if (mini) mini.remove(); } catch (e) {} mini = null; } });
  }
  window.HOMEZONE = {
    ready: true, open: open, home: home,
    init: function (api) { A = api; },
    settingsName: function (body) { if (A && A.LIVE) row(body); }
  };
})();
