/* Öl Nu v27 — ÖLPASSET (CONTRACT "v27 MORGONEN EFTER", migration 0052_passport.sql).
   A personal passport: an ink stamp for every bar you visited (check-ins, "Kung av baren" taps and drinks that
   snapped to a bar) and every town, on a small map in a sheet, plus a country count. Milestones (visa stamps):
   5, 10, 25 and 50 bars, and the first time abroad. Own data only (my_passport); bar points are public bar
   positions, never a pin or a home. Countries abroad are a coarse guess from the nearest big city (client).
   Entry points: "🛂 Ölpasset" in the 🏆 sheet (topSheet) and in ⚙️ (settingsSheet). No map button.
   Hooks (app.js mods): init, onAuthed, onPoll, topSheet, settingsSheet. Missing RPC = hidden. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null, off = false, data = null, at = 0, busy = false, mini = null;
  var MILES_KEY = "olnu.passMiles";
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function pick(a) { return a && a.length ? a[Math.floor(Math.random() * a.length)] : ""; }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* ---------- Coarse country guess (abroad only): nearest big city within 450 km ---------- */
  var WORLD = [
    ["Oslo", 59.91, 10.75, "Norge", "Norway"], ["Bergen", 60.39, 5.32, "Norge", "Norway"], ["Trondheim", 63.43, 10.39, "Norge", "Norway"],
    ["Tromsø", 69.65, 18.96, "Norge", "Norway"], ["Narvik", 68.44, 17.43, "Norge", "Norway"], ["Bodø", 67.28, 14.40, "Norge", "Norway"],
    ["Stavanger", 58.97, 5.73, "Norge", "Norway"], ["Kristiansand", 58.15, 8.00, "Norge", "Norway"], ["Halden", 59.12, 11.39, "Norge", "Norway"],
    ["Köpenhamn", 55.68, 12.57, "Danmark", "Denmark"], ["Århus", 56.16, 10.20, "Danmark", "Denmark"], ["Aalborg", 57.05, 9.92, "Danmark", "Denmark"],
    ["Odense", 55.40, 10.39, "Danmark", "Denmark"], ["Helsingør", 56.03, 12.59, "Danmark", "Denmark"],
    ["Helsingfors", 60.17, 24.94, "Finland", "Finland"], ["Åbo", 60.45, 22.27, "Finland", "Finland"], ["Tammerfors", 61.50, 23.79, "Finland", "Finland"],
    ["Uleåborg", 65.01, 25.47, "Finland", "Finland"], ["Torneå", 65.85, 24.15, "Finland", "Finland"], ["Mariehamn", 60.10, 19.94, "Åland", "Åland"],
    ["Tallinn", 59.44, 24.75, "Estland", "Estonia"], ["Riga", 56.95, 24.11, "Lettland", "Latvia"], ["Vilnius", 54.69, 25.28, "Litauen", "Lithuania"],
    ["Reykjavik", 64.15, -21.94, "Island", "Iceland"], ["Berlin", 52.52, 13.40, "Tyskland", "Germany"], ["Hamburg", 53.55, 9.99, "Tyskland", "Germany"],
    ["München", 48.14, 11.58, "Tyskland", "Germany"], ["Köln", 50.94, 6.96, "Tyskland", "Germany"], ["Frankfurt", 50.11, 8.68, "Tyskland", "Germany"],
    ["Rostock", 54.09, 12.10, "Tyskland", "Germany"], ["Kiel", 54.32, 10.14, "Tyskland", "Germany"], ["Dresden", 51.05, 13.74, "Tyskland", "Germany"],
    ["Gdańsk", 54.35, 18.65, "Polen", "Poland"], ["Warszawa", 52.23, 21.01, "Polen", "Poland"], ["Kraków", 50.06, 19.94, "Polen", "Poland"],
    ["Prag", 50.08, 14.44, "Tjeckien", "Czechia"], ["Wien", 48.21, 16.37, "Österrike", "Austria"], ["Budapest", 47.50, 19.04, "Ungern", "Hungary"],
    ["Amsterdam", 52.37, 4.90, "Nederländerna", "Netherlands"], ["Bryssel", 50.85, 4.35, "Belgien", "Belgium"], ["Paris", 48.86, 2.35, "Frankrike", "France"],
    ["Lyon", 45.76, 4.84, "Frankrike", "France"], ["Nice", 43.70, 7.27, "Frankrike", "France"], ["London", 51.51, -0.13, "Storbritannien", "UK"],
    ["Manchester", 53.48, -2.24, "Storbritannien", "UK"], ["Edinburgh", 55.95, -3.19, "Storbritannien", "UK"], ["Dublin", 53.35, -6.26, "Irland", "Ireland"],
    ["Madrid", 40.42, -3.70, "Spanien", "Spain"], ["Barcelona", 41.39, 2.17, "Spanien", "Spain"], ["Malaga", 36.72, -4.42, "Spanien", "Spain"],
    ["Palma", 39.57, 2.65, "Spanien", "Spain"], ["Las Palmas", 28.12, -15.43, "Spanien", "Spain"], ["Santa Cruz", 28.46, -16.25, "Spanien", "Spain"],
    ["Lissabon", 38.72, -9.14, "Portugal", "Portugal"], ["Rom", 41.90, 12.50, "Italien", "Italy"], ["Milano", 45.46, 9.19, "Italien", "Italy"],
    ["Neapel", 40.85, 14.27, "Italien", "Italy"], ["Zürich", 47.38, 8.54, "Schweiz", "Switzerland"], ["Aten", 37.98, 23.73, "Grekland", "Greece"],
    ["Rhodos", 36.43, 28.22, "Grekland", "Greece"], ["Chania", 35.51, 24.02, "Grekland", "Greece"], ["Istanbul", 41.01, 28.98, "Turkiet", "Turkey"],
    ["Antalya", 36.90, 30.70, "Turkiet", "Turkey"], ["Split", 43.51, 16.44, "Kroatien", "Croatia"], ["Dubrovnik", 42.65, 18.09, "Kroatien", "Croatia"],
    ["Valletta", 35.90, 14.51, "Malta", "Malta"], ["Nicosia", 35.19, 33.38, "Cypern", "Cyprus"], ["New York", 40.71, -74.01, "USA", "USA"],
    ["Los Angeles", 34.05, -118.24, "USA", "USA"], ["Miami", 25.76, -80.19, "USA", "USA"], ["Chicago", 41.88, -87.63, "USA", "USA"],
    ["Toronto", 43.65, -79.38, "Kanada", "Canada"], ["Bangkok", 13.76, 100.50, "Thailand", "Thailand"], ["Phuket", 7.88, 98.39, "Thailand", "Thailand"],
    ["Tokyo", 35.68, 139.69, "Japan", "Japan"], ["Dubai", 25.20, 55.27, "Förenade Arabemiraten", "UAE"], ["Sydney", -33.87, 151.21, "Australien", "Australia"],
    ["Kapstaden", -33.92, 18.42, "Sydafrika", "South Africa"], ["Mexico City", 19.43, -99.13, "Mexiko", "Mexico"], ["Rio de Janeiro", -22.91, -43.17, "Brasilien", "Brazil"]
  ];
  function km(a, b, c, d) { var x = (d - b) * Math.cos((a + c) * Math.PI / 360), y = c - a; return Math.sqrt(x * x + y * y) * 111.2; }
  function nearestWorld(lat, lng) {
    var best = null, bd = 1e9;
    WORLD.forEach(function (w) { var d = km(lat, lng, w[1], w[2]); if (d < bd) { bd = d; best = w; } });
    return best ? { city: best[0], country: L(best[3], best[4]), d: bd } : null;
  }
  function placeOf(b) {
    if (b.in_se !== false) return { country: L("Sverige", "Sweden"), town: b.town || null, se: true };
    if (b.lat == null) return { country: L("Utlandet", "Abroad"), town: null, se: false };
    var w = nearestWorld(+b.lat, +b.lng);
    if (!w || w.d > 450) return { country: L("Utlandet", "Abroad"), town: null, se: false };
    return { country: w.country, town: w.d <= 40 ? w.city : null, se: false };
  }

  /* ---------- Server ---------- */
  function call(name, params) {
    if (!A || !A.LIVE || off) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) { if (r.error && U.missing(r.error)) { off = true; r.off = true; } return r; });
  }
  function load(force) {
    if (!A || !A.LIVE || off || busy || !A.authed()) return Promise.resolve(data);
    if (!force && Date.now() - at < 30 * 60000) return Promise.resolve(data);
    busy = true; at = Date.now();
    return call("my_passport").then(function (r) {
      busy = false;
      if (!r.error) { data = model(A.parseData(r.data)); miles(); }
      return data;
    });
  }
  function model(d) {
    var bars = (d.bars || []).map(function (b) { var p = placeOf(b); b.country = p.country; b.ptown = b.town || p.town; b.se = p.se; return b; });
    var countries = {}, towns = {};
    bars.forEach(function (b) { countries[b.country] = 1; if (b.ptown) towns[b.ptown] = towns[b.ptown] || { town: b.ptown, nights: 0, first: b.first, se: b.se }; });
    (d.towns || []).forEach(function (t) { towns[t.town] = { town: t.town, nights: t.nights, first: t.first, last: t.last, se: true }; countries[L("Sverige", "Sweden")] = 1; });
    bars.forEach(function (b) { if (b.ptown && !b.se) towns[b.ptown].nights = Math.max(towns[b.ptown].nights, b.nights | 0); });
    var tl = Object.keys(towns).map(function (k) { return towns[k]; });
    return { raw: d, bars: bars, towns: tl, countries: Object.keys(countries), nights: d.nights_n | 0,
      abroad: bars.some(function (b) { return !b.se; }), first_abroad: d.first_abroad };
  }

  /* ---------- Milestones ---------- */
  var MILES = [
    ["b5", 5, "🎫", "Krogvisum", "Bar visa", "5 krogar"], ["b10", 10, "🎟️", "Tiokortet", "Ten pass", "10 krogar"],
    ["b25", 25, "🛂", "Diplomatpass", "Diplomatic passport", "25 krogar"], ["b50", 50, "🌐", "Ölambassadör", "Beer ambassador", "50 krogar"],
    ["abroad", 0, "✈️", "Första utlandsresan", "First trip abroad", "En krog utomlands"]
  ];
  function reached(m, d) { return m[0] === "abroad" ? d.abroad : d.bars.length >= m[1]; }
  var MILE_LINES = ["🛂 Nytt visum i Ölpasset: {m}!", "🛂 Stämpel! {m} – passet blir tjockare.", "🛂 {m}! Tullen vinkar igenom dig."];
  function miles() {
    if (!data) return;
    var have = U.ls.getJSON(MILES_KEY, null), first = !have; have = have || {};
    var fresh = MILES.filter(function (m) { return reached(m, data) && !have[m[0]]; });
    fresh.forEach(function (m) { have[m[0]] = Date.now(); });
    U.ls.setJSON(MILES_KEY, have);
    if (first || !fresh.length) return;
    var m = fresh[fresh.length - 1];
    A.toast(pick(MILE_LINES).replace("{m}", m[2] + " " + L(m[3], m[4])), { cls: "skal", ms: 6000, action: { label: L("🛂 Passet", "🛂 Passport"), fn: openSheet } });
  }

  /* ---------- Stamps ---------- */
  var INKS = ["#c0392b", "#1f5fa8", "#2e7d4f", "#6a3d9a", "#b0601a", "#8a1c3a"];
  var SHAPES = ["circ", "rect", "oval", "dbl", "hex"];
  function fmtDate(ev) {
    var s = String(ev || "").slice(0, 10), p = s.split("-"); if (p.length < 3) return "";
    var mo = sv() ? ["JAN", "FEB", "MAR", "APR", "MAJ", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEC"] : ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    return (+p[2]) + " " + mo[(+p[1]) - 1] + " " + p[0];
  }
  function stampHTML(kind, name, ev, n, seed, extra) {
    var h = hash(seed), ink = INKS[h % INKS.length], shape = kind === "town" ? (h % 2 ? "circ" : "dbl") : SHAPES[(h >> 3) % SHAPES.length];
    var rot = ((h >> 7) % 25) - 12;
    var nm = String(name || L("Okänd krog", "Unknown bar")).toUpperCase();
    return '<div class="ps-stamp ps-' + kind + " ps-" + shape + '" style="--ink:' + ink + ";--rot:" + rot + 'deg">' +
      '<span class="ps-top">' + esc(kind === "town" ? L("STAD", "TOWN") : (extra || L("KROG", "BAR"))) + "</span>" +
      '<span class="ps-name">' + esc(nm.length > 22 ? nm.slice(0, 21) + "…" : nm) + "</span>" +
      '<span class="ps-date">' + esc(fmtDate(ev)) + "</span>" +
      (n > 1 ? '<span class="ps-n">×' + n + "</span>" : "") + "</div>";
  }
  var INK_SVG = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><filter id="ps-ink">' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="n" scale="2.2"/></filter></svg>';

  /* ---------- Sheet ---------- */
  function openSheet() {
    A.openSheet(L("🛂 Ölpasset", "🛂 Beer passport"), function (body) {
      var root = A.el("div", { id: "ps-root", class: "ps" }, [A.el("p", { class: "muted", text: "…" })]);
      body.appendChild(root);
    }, { onClose: killMap });
    load(true).then(function () { render(); });
  }
  function killMap() { if (mini) { try { mini.remove(); } catch (e) {} mini = null; } }
  function render() {
    var root = document.getElementById("ps-root"); if (!root) return;
    killMap();
    if (!data) { root.innerHTML = '<p class="muted">' + esc(L("Passet gick int' att hämta.", "Could not load the passport.")) + "</p>"; return; }
    var d = data, name = (A.getName && A.getName()) || L("Hemlig agent", "Secret agent");
    var h = INK_SVG + '<div class="ps-cover"><div class="ps-crest" aria-hidden="true">🍺</div><div class="ps-ct">' +
      esc(L("ÖLPASS", "BEER PASSPORT")) + '</div><div class="ps-cs">' + esc(L("KONUNGARIKET DALARNA · ÖL NU", "KINGDOM OF DALARNA · ÖL NU")) + "</div>" +
      '<div class="ps-holder">' + esc(name) + "</div>" +
      '<div class="ps-stats"><span><b>' + d.bars.length + "</b>" + esc(L("krogar", "bars")) + "</span><span><b>" + d.towns.length + "</b>" + esc(L("städer", "towns")) +
      "</span><span><b>" + d.countries.length + "</b>" + esc(d.countries.length === 1 ? L("land", "country") : L("länder", "countries")) +
      "</span><span><b>" + d.nights + "</b>" + esc(L("kvällar", "nights")) + "</span></div></div>";
    if (!d.bars.length && !d.towns.length) {
      h += '<p class="ps-empty">' + esc(L("Passet ä tomt än. Checka in på en krog så får du din första stämpel!", "The passport is empty. Check in at a bar to get your first stamp!")) + "</p>";
      root.innerHTML = h; return;
    }
    var geo = d.bars.filter(function (b) { return b.lat != null && b.lng != null; });
    if (geo.length && window.L) h += '<div class="ps-map" id="ps-map" role="img" aria-label="' + esc(L("Karta med dina stämplar", "Map of your stamps")) + '"></div>';
    h += '<h4 class="ps-h">' + esc(L("Visum", "Visas")) + '</h4><div class="ps-miles">' + MILES.map(function (m) {
      var ok = reached(m, d);
      return '<div class="ps-mile' + (ok ? " ok" : "") + '"><span class="ps-me" aria-hidden="true">' + m[2] + "</span><b>" + esc(L(m[3], m[4])) + "</b><small>" +
        esc(ok ? (m[0] === "abroad" ? fmtDate(d.first_abroad) : L("klart", "done")) : (m[0] === "abroad" ? L("en krog utomlands", "a bar abroad") : d.bars.length + "/" + m[1])) + "</small></div>";
    }).join("") + "</div>";
    if (d.countries.length) h += '<div class="ps-flags">🌍 ' + esc(d.countries.join(" · ")) + "</div>";
    var towns = d.towns.slice().sort(function (a, b) { return String(b.first).localeCompare(String(a.first)); });
    h += '<h4 class="ps-h">' + esc(L("Städer", "Towns")) + '</h4><div class="ps-page">' + towns.map(function (t) { return stampHTML("town", t.town, t.first, t.nights | 0, "t:" + t.town); }).join("") + "</div>";
    var bars = d.bars.slice().sort(function (a, b) { return String(b.last).localeCompare(String(a.last)); });
    var shown = bars.slice(0, 60);
    h += '<h4 class="ps-h">' + esc(L("Krogar", "Bars")) + '</h4><div class="ps-page">' + shown.map(function (b) {
      return stampHTML("bar", b.name, b.first, b.nights | 0, "b:" + b.id, b.se ? null : b.country.toUpperCase());
    }).join("") + "</div>" + (bars.length > shown.length ? '<p class="muted ps-more">+' + (bars.length - shown.length) + " " + esc(L("stämplar till", "more stamps")) + "</p>" : "");
    h += '<p class="ps-fine muted">' + esc(L("Stämplar från incheckningar och öl vid en krog. Bara du ser ditt pass. Länder utomlands ä en grov gissning.",
      "Stamps come from check-ins and drinks at a bar. Only you see your passport. Countries abroad are a rough guess.")) + "</p>";
    root.innerHTML = h;
    if (geo.length && window.L) setTimeout(function () { drawMap(geo); }, 60);
  }
  function drawMap(geo) {
    var box = document.getElementById("ps-map"); if (!box || !window.L) return;
    try {
      mini = window.L.map(box, { zoomControl: false, attributionControl: true, worldCopyJump: true, minZoom: 2 });
      var ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
      window.L.tileLayer(ESRI + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 18, attribution: "Tiles &copy; Esri" }).addTo(mini);
      var pts = [];
      geo.forEach(function (b) {
        var hh = hash("b:" + b.id), ink = INKS[hh % INKS.length], rot = ((hh >> 7) % 25) - 12;
        var ic = window.L.divIcon({ className: "ps-pin", iconSize: [30, 30], iconAnchor: [15, 15],
          html: '<span style="--ink:' + ink + ";--rot:" + rot + 'deg">' + esc(String(b.name || "?").charAt(0).toUpperCase()) + "</span>" });
        window.L.marker([+b.lat, +b.lng], { icon: ic, keyboard: false, title: b.name || "" }).addTo(mini)
          .bindTooltip(esc(b.name || L("Okänd krog", "Unknown bar")) + (b.nights > 1 ? " ×" + b.nights : ""), { direction: "top" });
        pts.push([+b.lat, +b.lng]);
      });
      if (pts.length === 1) mini.setView(pts[0], 13); else mini.fitBounds(pts, { padding: [24, 24], maxZoom: 14 });
      setTimeout(function () { try { mini && mini.invalidateSize(); } catch (e) {} }, 250);
    } catch (e) { try { console.warn("olnu passport map", e); } catch (x) {} }
  }

  /* ---------- Hooks ---------- */
  function entryBtn() {
    var sub = data ? data.bars.length + " " + L("krogar", "bars") + " · " + data.countries.length + " " + (data.countries.length === 1 ? L("land", "country") : L("länder", "countries")) : "";
    var b = A.el("button", { type: "button", class: "btn btn-block ps-entry" }, [A.el("span", { text: L("🛂 Ölpasset", "🛂 Beer passport") }), sub ? A.el("small", { text: sub }) : null]);
    b.addEventListener("click", openSheet);
    return b;
  }
  window.PASSPORT = {
    data: function () { return data; }, open: openSheet, refresh: function () { return load(true); }, _placeOf: placeOf,
    init: function (api) { A = api; },
    onAuthed: function () { setTimeout(function () { load(false); }, 8000); },   // review2: the first poll has loaded it already
    onPoll: function () { load(false); },
    topSheet: function (body) {
      if (!A || !A.LIVE || off) return;
      var row = A.el("div", { class: "row ps-toprow" }, [entryBtn()]);
      body.appendChild(row);
    },
    profileSheet: function (body) {   // 👤 Profil (was settingsSheet)
      if (!A || !A.LIVE || off) return;
      body.appendChild(A.el("div", { class: "row", style: "margin-top:8px" }, [entryBtn()]));
    }
  };
})();
