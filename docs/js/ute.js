/* Öl Nu — ☀️ UTEVÄDER (CONTRACT "📸 KROGBILDER · ☀️ UTEVÄDER · 🏠 FÖLJ MIG HEM · 🔍 HITTA KOMPIS"). window.UTE, in app.js mods():
   init, onAuthed, onPoll, hudChipsHTML (max ONE chip), hudClick, barPopupHTML. Client only: no migration, no push, no new button.
   - Weather: Open-Meteo forecast API (free, no key, CC BY 4.0, non-commercial use; attribution in the sheet). One call per
     ~0.1° cell (≈ 10 km, the user's town) per 30 min, cached in localStorage olnu.ute.wx. Nothing is sent but the rounded point.
     Not fetched 02:00–09:00 or while the tab is hidden.
   - Uteväder = no rain now (precipitation 0, weather code < 51) and no rain likely in the next 2 h (probability < 50 %), and
     ≥ 14 °C, or a sunny evening (clear sky, after 16:00, daylight, ≥ 11 °C).
   - Uteservering = bars.json `outdoor: 1` (OSM outdoor_seating / beer_garden, scripts/fetch-bars.mjs) or type biergarten.
   - Ikväll panel chip (11:00–24:00, ≥ 1 outdoor bar within 3 km): "☀️ Uteväder! 17° – uteserveringar nära: Pitchers +2"
     → sheet with the nearest 8 (distance, open now from js/oppet.js, 📍 Visa = A.openBar).
   - Bar sheet: ".ev-line.ute-line" pill "☀️ Uteservering" (+ "Uteväder nu 17°" when the weather is good). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, WX_KEY = "olnu.ute.wx", WX_TTL = 30 * 60000, busy = false, wx = null, lastTry = 0;
  var NEAR_M = 3000, API = "https://api.open-meteo.com/v1/forecast";
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function esc(s) { return U.esc(s); }
  var lastPick = {};
  function pick(k, a) {
    if (!a || !a.length) return "";
    var seen = lastPick[k] || [], i = Math.floor(Math.random() * a.length), n = 0;
    while (seen.indexOf(i) >= 0 && n++ < a.length) i = (i + 1) % a.length;
    seen.push(i); if (seen.length > Math.min(4, a.length - 1)) seen.shift(); lastPick[k] = seen;
    return a[i];
  }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : ""; }); }

  var T = {
    chip: ["☀️ Uteväder! {t}° – uteserveringar nära: {list}", "😎 Solen ä framme, {t}°! Sitt ute: {list}",
      "☀️ {t}° och torrt. Spaning: uteservering på {list}", "🍺 {t}° ute! Uteserveringar i närheten: {list}",
      "☀️ Uteväder, {t}°. Generalen pekar mot: {list}"],
    chipEve: ["🌅 Kvällssol, {t}°! Ta ölen ute: {list}", "🌇 Sol i kväll, {t}°. Uteservering på {list}",
      "🌅 Solnedgång + öl = {list}", "🌅 Kvällssolen kallar, {t}°: {list}"],
    flavor: ["Generalen beordrar: frisk luft och kall öl.", "Int' sitta inne när solen skiner, dä ä ju synd å skam.",
      "Spaningen visar sol. Målet ä uteserveringen.", "Solbrillor på, jackan i handen – marsch!",
      "Ute ä inne ikväll, pojkar.", "Dalarna i sol. Sånt får man int' slösa bort.",
      "Väderrapport från fältet: torrt och skönt. Över.", "Ta med en tröja. Solen gömmer sig fortare än du tror.",
      "Uteservering ä kvällens taktiska läge.", "Inga moln i sikte. Inga ursäkter heller."],
    flavorEn: ["Patio weather. Go outside.", "Sun is out – so are we.", "Dry and warm. Find a terrace."],
    none: ["Inga uteserveringar i kartdatat nära dig. OpenStreetMap vet int' allt – säg till krogen!",
      "Spaningen hittar ingen uteservering inom 3 km. Kanske en balkong då?"],
    bad: ["Int' uteväder just nu. Sitt inne och värm dig.", "Regnet vinner idag. Uteserveringen får vänta."]
  };

  /* ---------- weather ---------- */
  function here() {
    try { var l = A.lastLoc && A.lastLoc(); if (l && isFinite(l.lat) && isFinite(l.lng)) return { lat: l.lat, lng: l.lng }; } catch (e) {}
    try { var c = A.map.getCenter(); return { lat: c.lat, lng: c.lng }; } catch (e) { return null; }
  }
  function cellOf(p) { return p ? (Math.round(p.lat * 10) / 10).toFixed(1) + "," + (Math.round(p.lng * 10) / 10).toFixed(1) : ""; }
  function hourNow() {
    try { return +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(new Date()) % 24; }
    catch (e) { return new Date().getHours(); }
  }
  function cached(cell) {
    if (wx && wx.cell === cell && Date.now() - wx.at < WX_TTL) return wx;
    var c = U.ls.getJSON(WX_KEY, null);
    if (c && c.cell === cell && Date.now() - c.at < WX_TTL && c.d) { wx = c; return c; }
    return null;
  }
  function parse(j) {
    var c = j && j.current; if (!c || typeof c.temperature_2m !== "number") return null;
    var probs = (j.hourly && j.hourly.precipitation_probability) || [], times = (j.hourly && j.hourly.time) || [];
    var nowIso = c.time || "", mx = 0, k = 0;
    for (var i = 0; i < times.length && k < 3; i++) { if (times[i] >= nowIso.slice(0, 13)) { mx = Math.max(mx, probs[i] | 0); k++; } }
    return { t: Math.round(c.temperature_2m), code: c.weather_code | 0, pr: +(c.precipitation || 0) + +(c.rain || 0) + +(c.showers || 0),
      day: c.is_day === 1 || c.is_day === true, cloud: c.cloud_cover | 0, p2: mx };
  }
  function load(force) {
    var p = here(), cell = cellOf(p), h = hourNow();
    if (!p || busy || document.hidden || (h >= 2 && h < 9)) return;
    if (!force && cached(cell)) return;
    if (Date.now() - lastTry < 60000) return;
    lastTry = Date.now(); busy = true;
    var c = cell.split(",");
    var url = API + "?latitude=" + c[0] + "&longitude=" + c[1] +
      "&current=temperature_2m,precipitation,rain,showers,weather_code,cloud_cover,is_day" +
      "&hourly=precipitation_probability&forecast_hours=4&timezone=auto";
    var ctl = window.AbortController ? new AbortController() : null, tm = setTimeout(function () { try { if (ctl) ctl.abort(); } catch (e) {} }, 8000);
    fetch(url, { signal: ctl ? ctl.signal : undefined, credentials: "omit" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var d = parse(j);
      if (d) { wx = { cell: cell, at: Date.now(), d: d }; U.ls.setJSON(WX_KEY, wx); changed(); }
    }).catch(function () {}).then(function () { clearTimeout(tm); busy = false; });
  }
  function changed() { try { A.updateCounts(); } catch (e) {} }
  function current() { var p = here(); return p ? cached(cellOf(p)) : null; }
  function isDry(d) { return d && d.pr <= 0 && d.code < 51 && d.p2 < 50; }
  function sunnyEve(d) { return d && d.code <= 1 && d.day && hourNow() >= 16 && d.t >= 11; }
  function good(d) { return !!d && isDry(d) && (d.t >= 14 || sunnyEve(d)); }
  function emo(code) {
    return code === 0 ? "☀️" : code === 1 ? "🌤️" : code === 2 ? "⛅" : code === 3 ? "☁️" : code < 50 ? "🌫️" : code < 70 ? "🌧️" : code < 80 ? "❄️" : code < 95 ? "🌦️" : "⛈️";
  }
  function wxText(d) {
    if (!d) return "";
    var w = d.code === 0 ? L("sol", "sunny") : d.code === 1 ? L("mest sol", "mostly sunny") : d.code === 2 ? L("halvklart", "partly cloudy") : d.code === 3 ? L("mulet", "cloudy") :
      d.code < 50 ? L("dimma", "fog") : d.code < 70 ? L("regn", "rain") : d.code < 80 ? L("snö", "snow") : d.code < 95 ? L("skurar", "showers") : L("åska", "thunder");
    return emo(d.code) + " " + d.t + "° · " + w + (isDry(d) ? L(" · torrt", " · dry") : "");
  }

  /* ---------- outdoor bars ---------- */
  function isOut(b) { return !!(b && (b.outdoor === 1 || b.outdoor === true || b.type === "biergarten")); }
  function nearOut(p, max) {
    if (!p || !window.BARS || !window.BARS.inBounds || !window.L) return [];
    var dLat = NEAR_M / 111000, dLng = NEAR_M / (111000 * Math.max(0.2, Math.cos(p.lat * Math.PI / 180)));
    var b = window.L.latLngBounds([p.lat - dLat, p.lng - dLng], [p.lat + dLat, p.lng + dLng]);
    var out = [];
    window.BARS.inBounds(b, 4000).forEach(function (x) {
      if (!isOut(x) || !x.name) return;
      var d = U.haversine(p.lat, p.lng, x.lat, x.lng);
      if (d <= NEAR_M) out.push({ bar: x, d: d });
    });
    out.sort(function (a, b2) {
      var oa = openRank(a.bar), ob = openRank(b2.bar);
      return oa !== ob ? oa - ob : a.d - b2.d;
    });
    return max ? out.slice(0, max) : out;
  }
  function openRank(bar) {
    try { var s = window.OPPET && window.OPPET.barStatus ? window.OPPET.barStatus(bar) : null; return s && s.known ? (s.open ? 0 : 2) : 1; } catch (e) { return 1; }
  }
  function distTxt(d) {
    if (window.OPPET && window.OPPET.distTxt) try { return window.OPPET.distTxt(d); } catch (e) {}
    return d < 1000 ? Math.round(d / 10) * 10 + " m" : (d / 1000).toFixed(1).replace(".", sv() ? "," : ".") + " km";
  }

  /* ---------- Ikväll chip ---------- */
  var chipCache = { at: 0, key: "", v: null };
  function chip() {
    var h = hourNow(); if (h < 11 && h >= 2) return null;
    var w = current(); if (!w || !good(w.d)) return null;
    var p = here(), key = cellOf(p) + "|" + w.at + "|" + Math.floor(Date.now() / 60000) + "|" + (I && I.lang);
    if (chipCache.key === key) return chipCache.v;
    var rows = nearOut(p, 0), v = null;
    if (rows.length) {
      var names = rows.slice(0, 2).map(function (r) { return r.bar.name; }).join(", ") + (rows.length > 2 ? " +" + (rows.length - 2) : "");
      var tpl = sv() ? (sunnyEve(w.d) && w.d.t < 14 ? pick("ce", T.chipEve) : pick("c", T.chip)) : "☀️ Patio weather! {t}° – outdoor seating near: {list}";
      v = { t: fill(tpl, { t: w.d.t, list: names }) };
    }
    chipCache = { key: key, v: v };
    return v;
  }
  function sheet() {
    var w = current(), p = here(), rows = nearOut(p, 8);
    A.openSheet(L("☀️ Uteväder", "☀️ Patio weather"), function (body) {
      var el = A.el;
      var box = el("section", { class: "ute-sheet" });
      box.appendChild(el("div", { class: "ute-wx-h", text: w ? wxText(w.d) : L("Väder saknas just nu", "No weather right now") }));
      box.appendChild(el("p", { class: "muted ute-flavor", text: w && good(w.d) ? (sv() ? pick("f", T.flavor) : pick("fe", T.flavorEn)) : (sv() ? pick("b", T.bad) : "Not patio weather right now.") }));
      if (!rows.length) box.appendChild(el("p", { class: "muted", text: sv() ? pick("n", T.none) : "No outdoor seating in the map data near you." }));
      var ul = el("ul", { class: "ute-list" });
      rows.forEach(function (r) {
        var st = null, lb = null;
        try { st = window.OPPET ? window.OPPET.barStatus(r.bar) : null; lb = st && window.OPPET.label ? window.OPPET.label(st) : null; } catch (e) {}
        var li = el("li", { class: "ute-row" }, [
          el("div", { class: "ute-n" }, [el("b", { text: (r.bar.type === "biergarten" ? "🍺 " : "☀️ ") + r.bar.name }),
            el("span", { class: "muted", text: " · " + distTxt(r.d) + (lb ? " · " + lb.t : "") })]),
          A.btn(L("📍 Visa", "📍 Show"), "btn-small ute-go", function () { A.closeSheet(); A.openBar(r.bar); })
        ]);
        ul.appendChild(li);
      });
      box.appendChild(ul);
      var src = el("p", { class: "muted ute-src" });
      src.appendChild(document.createTextNode(L("Väder: ", "Weather: ")));
      src.appendChild(el("a", { href: "https://open-meteo.com/", target: "_blank", rel: "noopener noreferrer", text: "Open-Meteo.com" }));
      src.appendChild(document.createTextNode(L(" (CC BY 4.0). Uteservering enligt OpenStreetMap – kan vara fel eller stängd för säsongen.",
        " (CC BY 4.0). Outdoor seating from OpenStreetMap – may be wrong or closed for the season.")));
      box.appendChild(src);
      body.appendChild(box);
    });
  }

  window.UTE = {
    init: function (api) { A = api; setTimeout(function () { load(false); }, 4000); setInterval(function () { chipCache.key = ""; load(false); }, 5 * 60000);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) load(false); }); },
    onAuthed: function () { load(false); },
    onPoll: function () { load(false); },
    hudChipsHTML: function () {
      var v = null; try { v = chip(); } catch (e) { v = null; }
      return v ? '<button type="button" class="hx-chip hx-ute" data-hx="ute">' + esc(v.t) + "</button>" : "";
    },
    hudClick: function (a) { if (a === "ute") sheet(); },
    barPopupHTML: function (bar) {
      if (!isOut(bar)) return "";
      var w = current(), d = w && w.d, g = good(d);
      var right = d ? (g ? L("Uteväder nu ", "Patio weather ") + d.t + "°" : emo(d.code) + " " + d.t + "°") : "";
      return '<div class="ev-line ute-line' + (g ? " ute-good" : "") + '"><span class="ute-tag">☀️ ' + esc(L("Uteservering", "Outdoor seating")) + "</span>" +
        (right ? '<span class="ute-wx">' + esc(right) + "</span>" : "") + "</div>";
    },
    // tests / other modules
    good: good, isOutdoor: isOut, nearOut: nearOut, current: current, sheet: sheet,
    _set: function (d, cell) { wx = { cell: cell || cellOf(here()), at: Date.now(), d: d }; chipCache.key = ""; changed(); }
  };
})();
