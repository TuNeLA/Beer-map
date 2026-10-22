/* Öl Nu — ⏰ ÖPPET: opening hours, 🍾 Systemet and 🌭 Nattmat (CONTRACT "⏰ ÖPPETTIDER · 🍾 SYSTEMET · 💰 PRIS · 🚪 ENTRÉ · 🌭 NATTMAT").
   window.OPPET, in app.js mods(): init, onAuthed, onPoll, hudChipsHTML (max ONE chip), hudClick.
   Data: docs/hours.json + docs/systembolaget.json (scripts/fetch-hours.mjs, weekly "Hours (OpenStreetMap)" Action). A day is
   "start-end" minutes after that day's 00:00, "," between parts, "" = closed; an end past 1440 = after midnight.
   - status(week, ms, override) → open / closes in / opens at, in Europe/Stockholm wall-clock time (any phone time zone).
   - Closing soon: checked in (or a precise pin) at a bar that closes within 30 min → ONE calm toast per bar and night with the
     nearest bar still open + distance (waits for the beer-type strip: window.OLNU_STRIP.after). Tonight's user report
     (js/barinfo.js → setOverride) beats OpenStreetMap.
   - 🌭 Nattmat 01:00–05:00: nightMode() → js/places.js shows open late food from zoom 13 (no extra layer); Ikväll chip
     "🌭 Nattmat öppet nu: …" → sheet with the nearest 3.
   - 🍾 Systemet: Ikväll chip in the last 2 h before closing (weekdays / Saturday), sheet with the nearest store; förfest start
     screen line (forfestNode). No push anywhere. Prices / amounts are never shown here.
   Missing files = the feature hides quietly. Never breaks the map. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null;
  var H = null, SB = null, nmList = [], nmById = {}, loaded = false;
  var overrides = {};                 // bar id → {min, closed, ev} (tonight's user report)
  var SEEN_KEY = "olnu.aioClose", lastMode = null, chipCache = { at: 0, key: "", v: null };
  var DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  var DSV = ["mån", "tis", "ons", "tor", "fre", "lör", "sön"], DEN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function esc(s) { return U.esc(s); }
  var lastPick = {};
  function pick(k, a) { if (!a || !a.length) return ""; var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[k]) i = (i + 1) % a.length; lastPick[k] = i; return a[i]; }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : ""; }); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- time (Europe/Stockholm wall clock) ---------- */
  var fmt = null;
  function wall(ms) {
    try {
      if (!fmt) fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      var p = {}; fmt.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
      return { dow: Math.max(0, DOW.indexOf(String(p.weekday || "").slice(0, 2))), min: (+p.hour % 24) * 60 + (+p.minute) };
    } catch (e) { var d = new Date(ms); return { dow: (d.getDay() + 6) % 7, min: d.getHours() * 60 + d.getMinutes() }; }
  }
  function hhmm(m) { m = ((m % 1440) + 1440) % 1440; return ("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + (m % 60)).slice(-2); }
  function dur(m) {
    m = Math.max(0, Math.round(m));
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60), r = m % 60;
    return h + " h" + (r ? " " + r + " min" : "");
  }
  function day(w, d) {
    var s = w && w[d]; if (!s) return [];
    return String(s).split(",").map(function (x) { var p = x.split("-"); return [+p[0], +p[1]]; }).filter(function (x) { return isFinite(x[0]) && isFinite(x[1]); });
  }
  function always(w) { return !!w && w.length === 7 && w.every(function (s) { return s === "0-1440"; }); }
  // {known, open, always, closeIn, closeAt, opensIn, opensAt, opensDay (0 today, 1 tomorrow, n), reported, closedTonight}
  function status(w, ms, ov) {
    ms = ms == null ? Date.now() : ms;
    var p = wall(ms), d = p.dow, m = p.min, out = { known: !!w || !!ov };
    if (ov) {
      var E = m < 300 ? m + 1440 : m;
      out.reported = true;
      if (ov.closed) { out.open = false; out.closedTonight = true; return out; }
      if (E < ov.min) {
        var osm = w ? status(w, ms) : null;
        if (E >= 960 || !osm || osm.open) { out.open = true; out.closeIn = ov.min - E; out.closeAt = hhmm(ov.min); return out; }
      } else if (E >= 960 || m < 300) { out.open = false; out.closedTonight = true; return out; }
    }
    if (!w) return out;
    if (always(w)) { out.open = true; out.always = true; return out; }
    var hit = null, i;
    day(w, d).forEach(function (iv) { if (iv[0] <= m && m < iv[1]) hit = { end: iv[1] - m, at: iv[1] }; });
    if (!hit) day(w, (d + 6) % 7).forEach(function (iv) { if (iv[1] > 1440 && m < iv[1] - 1440) hit = { end: iv[1] - 1440 - m, at: iv[1] }; });
    if (hit) {
      // a part that ends at 24:00 and goes on at 00:00 the next day = one opening
      var end = hit.end, at = hit.at;
      if (at % 1440 === 0) {
        for (i = 1; i < 7; i++) {
          var nx = day(w, (d + i) % 7).filter(function (iv) { return iv[0] === 0; })[0];
          if (!nx) break;
          end += nx[1]; at = nx[1];
          if (nx[1] < 1440) break;
        }
      }
      out.open = true; out.closeIn = end; out.closeAt = hhmm(at);
      return out;
    }
    out.open = false;
    for (i = 0; i < 8; i++) {
      var list = day(w, (d + i) % 7).filter(function (iv) { return i > 0 || iv[0] > m; }).sort(function (a, b) { return a[0] - b[0]; });
      if (list.length) { out.opensIn = (i ? 1440 - m + (i - 1) * 1440 : -m) + list[0][0]; out.opensAt = hhmm(list[0][0]); out.opensDay = i; out.opensDow = (d + i) % 7; return out; }
    }
    return out;
  }
  function dayName(dw) { return sv() ? DSV[dw] : DEN[dw]; }
  // Short label for the bar sheet / lists.
  function label(st) {
    if (!st || !st.known) return null;
    if (st.closedTonight) return { cls: "oh-shut", t: L("🔒 Stängt ikväll (rapporterat)", "🔒 Closed tonight (reported)") };
    if (st.open && st.always) return { cls: "oh-open", t: L("🕐 Öppet dygnet runt", "🕐 Open 24/7") };
    if (st.open && st.closeIn <= 30) return { cls: "oh-soon", t: L("⏰ Stänger om " + dur(st.closeIn), "⏰ Closes in " + dur(st.closeIn)) };
    if (st.open) return { cls: "oh-open", t: L("🕐 Öppet till " + st.closeAt, "🕐 Open until " + st.closeAt) };
    if (st.opensAt == null) return { cls: "oh-shut", t: L("🔒 Stängt", "🔒 Closed") };
    var when = st.opensDay === 0 ? st.opensAt : st.opensDay === 1 && st.opensIn < 720 ? st.opensAt :
      st.opensDay === 1 ? L("i morgon " + st.opensAt, "tomorrow " + st.opensAt) : dayName(st.opensDow) + " " + st.opensAt;
    return { cls: "oh-shut", t: L("🔒 Stängt · öppnar " + when, "🔒 Closed · opens " + when) };
  }

  /* ---------- data ---------- */
  function placeId(lat, lng) { return "pl_" + Math.round(lat * 1e5) + "_" + Math.round(lng * 1e5); }
  function load() {
    if (loaded) return; loaded = true;
    fetch("./hours.json").then(function (r) { if (!r.ok) throw new Error("no hours"); return r.json(); }).then(function (d) {
      if (!d || !d.bars) return;
      H = d; nmList = []; nmById = {};
      (d.nm || []).forEach(function (x) {
        if (!Array.isArray(x) || typeof x[1] !== "number") return;
        var o = { id: placeId(x[1], x[2]), name: x[0], lat: x[1], lng: x[2], t: x[3], w: x[4] };
        nmList.push(o); nmById[o.id] = o;
      });
      changed();
    }).catch(function () {});
    fetch("./systembolaget.json").then(function (r) { if (!r.ok) throw new Error("no sb"); return r.json(); }).then(function (d) {
      if (d && Array.isArray(d.stores)) { SB = d.stores.map(function (x) { return { name: x[0], lat: x[1], lng: x[2], w: x[3], guess: !!x[4] }; }); changed(); }
    }).catch(function () {});
  }
  function changed() { chipCache.at = 0; try { if (A) A.updateCounts(); } catch (e) {} modeCheck(true); }
  function hoursFor(bar) {
    if (!bar) return null;
    var id = String(bar.id);
    if (H && H.bars && H.bars[id]) return H.bars[id];
    var n = nmById[id] || (isFinite(bar.lat) ? nmById[placeId(bar.lat, bar.lng)] : null);
    return n ? n.w : null;
  }
  function barStatus(bar, ms) {
    var w = hoursFor(bar), ov = bar ? overrides[String(bar.id)] : null;
    if (ov && ov.ev !== evening(ms)) ov = null;
    if (!w && !ov) return null;
    return status(w, ms, ov);
  }
  function evening(ms) {   // evening day key, same rule as the server (00:00–05:00 = the day before)
    var d = new Date((ms == null ? Date.now() : ms) - 5 * 3600e3);
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm" }).format(d); } catch (e) { return d.toISOString().slice(0, 10); }
  }
  function here() {
    var c = null;
    try { c = (A.lastLoc && A.lastLoc()) || (A.center && A.center()); } catch (e) {}
    if (!c && A && A.map) { var m = A.map.getCenter(); c = { lat: m.lat, lng: m.lng }; }
    return c;
  }
  function distTxt(m) { return m < 950 ? Math.round(m / 10) * 10 + " m" : (Math.round(m / 100) / 10).toString().replace(".", sv() ? "," : ".") + " km"; }

  /* ---------- 🌭 Nattmat ---------- */
  function nightMode(ms) { var h = Math.floor(wall(ms == null ? Date.now() : ms).min / 60); return !!nmList.length && h >= 1 && h < 5; }
  function openLate(p) { var n = p && (nmById[p.id] || (isFinite(p.lat) ? nmById[placeId(p.lat, p.lng)] : null)); return !!(n && status(n.w).open); }
  function nmNear(c, max) {
    if (!c) return [];
    var out = [];
    nmList.forEach(function (n) {
      if (Math.abs(n.lat - c.lat) > 0.15 || Math.abs(n.lng - c.lng) > 0.3) return;
      var st = status(n.w); if (!st.open) return;
      out.push({ n: n, d: U.haversine(c.lat, c.lng, n.lat, n.lng), st: st });
    });
    out.sort(function (a, b) { return a.d - b.d; });
    return out.slice(0, max || 3);
  }
  function modeCheck(force) {
    var m = nightMode();
    if (m === lastMode && !force) return;
    lastMode = m;
    try { if (window.PLACEPINS && window.PLACEPINS._draw) setTimeout(window.PLACEPINS._draw, 50); } catch (e) {}
  }
  var NM_ICON = { f: "🌭", r: "🍕", k: "🏪" };
  function nmSheet() {
    var c = here(), rows = nmNear(c, 3);
    A.openSheet(L("🌭 Nattmat öppet nu", "🌭 Late-night food open now"), function (body) {
      var el = A.el;
      body.appendChild(el("p", { class: "muted", text: pick("nmIntro", sv() ? [
        "Fältköket ä öppet. Truppen marscherar på magen.", "Hungern slår till efter ett. Här ä närmaste påfyllning.",
        "Kebab, pizza eller korv – välj din sista order för natten.", "Nattpatrull mot mat. Närmast först."
      ] : ["The field kitchen is open. Nearest first."]) }));
      if (!rows.length) body.appendChild(el("p", { text: L("Inget öppet ställe med kända tider i närheten. Kolla gatuköket på hörnet.", "No open place with known hours nearby.") }));
      rows.forEach(function (x) {
        var lb = label(x.st);
        var go = A.btn("📍 " + L("Visa", "Show"), "btn-small", function () { A.closeSheet(); showSpot(x.n); });
        body.appendChild(el("div", { class: "ds-card oh-row" }, [
          el("div", { class: "oh-row-t" }, [el("b", { text: (NM_ICON[x.n.t] || "🌭") + " " + x.n.name }),
            el("span", { class: "muted", text: distTxt(x.d) + (lb ? " · " + lb.t.replace(/^\S+\s/, "") : "") })]), go]));
      });
      body.appendChild(el("p", { class: "muted oh-src", text: L("Tider från OpenStreetMap. Drick vatten, ät nåt och ta dig hem säkert.", "Hours from OpenStreetMap. Drink water, eat and get home safe.") }));
    });
  }
  function showSpot(n) {
    var b = window.BARS && window.BARS.byId ? window.BARS.byId(n.id) : null;
    if (b && A.openBar) { A.openBar(b); return; }
    A.flyTo ? A.flyTo(n.lat, n.lng, 17) : A.map.flyTo([n.lat, n.lng], 17);
  }

  /* ---------- 🍾 Systemet ---------- */
  function sbNear(c) {
    if (!SB || !c) return null;
    var best = null, bd = 60000;
    SB.forEach(function (s) {
      if (Math.abs(s.lat - c.lat) > 0.6 || Math.abs(s.lng - c.lng) > 1.2) return;
      var d = U.haversine(c.lat, c.lng, s.lat, s.lng); if (d < bd) { bd = d; best = s; }
    });
    return best ? { s: best, d: bd, st: status(best.w) } : null;
  }
  function sbLine(x) {
    var st = x.st, nm = x.s.name.replace(/^Systembolaget\s*,?\s*/i, "");
    if (!nm) { try { var tw = window.CITIES && window.CITIES.nearest(x.s.lat, x.s.lng); nm = tw && U.haversine(x.s.lat, x.s.lng, tw.lat, tw.lng) < 8000 ? tw.name : ""; } catch (e) { nm = ""; } }
    var where = (nm ? nm + ", " : "") + distTxt(x.d);
    if (st.open) return L("🍾 Systemet (" + where + ") stänger " + st.closeAt + " · " + dur(st.closeIn) + " kvar",
      "🍾 Systembolaget (" + where + ") closes " + st.closeAt + " · " + dur(st.closeIn) + " left");
    var lb = label(st);
    return L("🍾 Systemet (" + where + ") har stängt" + (lb && st.opensAt ? " · öppnar " + lb.t.split("öppnar ")[1] : ""),
      "🍾 Systembolaget (" + where + ") is closed" + (lb && st.opensAt ? " · opens " + lb.t.split("opens ")[1] : ""));
  }
  function sbSheet() {
    var x = sbNear(here());
    A.openSheet(L("🍾 Systemet", "🍾 Systembolaget"), function (body) {
      var el = A.el;
      if (!x) { body.appendChild(el("p", { text: L("Hittar inget Systembolag i närheten.", "No Systembolaget store nearby.") })); return; }
      body.appendChild(el("p", { class: "oh-big", text: sbLine(x) }));
      if (x.st.open && x.st.closeIn <= 60) body.appendChild(el("p", { class: "oh-soon", text: pick("sbHurry", sv() ? [
        "Förfesten kräver planering, soldat. Kolla klockan.", "Snart stänger dörren. Planera lugnt – ingen spurt i trapporna.",
        "Underhållstjänsten stänger snart. Ta det lugnt och handla vettigt."
      ] : ["The store closes soon. Plan calmly."]) }));
      body.appendChild(el("p", { class: "muted", text: x.s.name }));
      body.appendChild(el("div", { class: "row" }, [
        A.btn("📍 " + L("Visa på kartan", "Show on map"), "btn-small", function () { A.closeSheet(); A.map.flyTo([x.s.lat, x.s.lng], 17); }),
        el("a", { class: "btn btn-small oh-dir", href: "https://www.google.com/maps/dir/?api=1&destination=" + x.s.lat + "," + x.s.lng, target: "_blank", rel: "noopener", text: "🧭 " + L("Vägbeskrivning", "Directions") })
      ]));
      body.appendChild(el("p", { class: "muted oh-src", text: (x.s.guess ? L("Vanliga tider (mån–fre 10–19, lör 10–15). ", "Usual hours (Mon–Fri 10–19, Sat 10–15). ") : "") +
        L("Tider från OpenStreetMap – helgdagar och aftnar kan skilja. 20 år och leg gäller. Drick lagom.",
          "Hours from OpenStreetMap – holidays may differ. Age 20 and ID required. Drink in moderation.") }));
    });
  }
  // Förfest start screen line (js/forfest.js calls it): nearest store, open / closed. Null when unknown.
  function forfestNode() {
    var x = sbNear(here()); if (!x) return null;
    var n = document.createElement("p");
    n.className = "ff-tag oh-ff" + (x.st.open && x.st.closeIn <= 60 ? " oh-soon" : "");
    n.textContent = sbLine(x);
    return n;
  }

  /* ---------- ⏰ closing soon (toast once per bar and night) ---------- */
  function myBar() {
    var ci = A.myCheckin && A.myCheckin();
    if (ci && ci.id) { var b = window.BARS && window.BARS.byId(ci.id); return b || { id: ci.id, name: ci.name, lat: ci.lat, lng: ci.lng }; }
    var mine = A.myBeer && A.myBeer();
    if (mine && mine.precise !== false && window.BARS && window.BARS.assign) {
      var pb = window.BARS.assign([mine]).perBar, k = Object.keys(pb)[0];
      if (k) return pb[k].bar;
    }
    return null;
  }
  function nearestOpenBar(bar, minLeft) {
    if (!window.BARS || !window.BARS.inBounds || !window.L) return null;
    var b = window.L.latLngBounds([bar.lat - 0.03, bar.lng - 0.06], [bar.lat + 0.03, bar.lng + 0.06]);
    var best = null, bd = 4000;
    window.BARS.inBounds(b, 3000).forEach(function (o) {
      if (String(o.id) === String(bar.id) || o.type === "arena") return;
      var st = barStatus(o); if (!st || !st.open || (!st.always && st.closeIn < (minLeft || 45))) return;
      var d = U.haversine(bar.lat, bar.lng, o.lat, o.lng); if (d < bd) { bd = d; best = { bar: o, d: d, st: st }; }
    });
    return best;
  }
  var TOAST_SV = [
    "⏰ {bar} stänger om {min}. Sista beställning, soldat – drick lugnt.",
    "⏰ Om {min} slår {bar} igen portarna. Dags att planera reträtten.",
    "⏰ {bar} stänger om {min}. Truppen bör välja nästa läger.",
    "⏰ Klockan tickar: {bar} stänger om {min}. Inte stressa, bara planera.",
    "⏰ {bar} drar ner rullgardinen om {min}. Vatten nu ä aldrig fel."
  ];
  function checkClosing() {
    if (!A || !A.LIVE) return;
    var bar = myBar(); if (!bar || !isFinite(bar.lat)) return;
    var st = barStatus(bar); if (!st || !st.open || st.always || !(st.closeIn > 0 && st.closeIn <= 30)) return;
    var key = String(bar.id) + "|" + evening();
    if (lsGet(SEEN_KEY, "") === key) return;
    lsSet(SEEN_KEY, key);
    var nb = nearestOpenBar(bar, 45);
    var txt = fill(sv() ? pick("close", TOAST_SV) : "⏰ {bar} closes in {min}.", { bar: bar.name || L("Krogen", "The bar"), min: dur(st.closeIn) });
    if (nb) txt += " " + L("Närmast öppet: " + (nb.bar.name || "en krog") + ", " + distTxt(nb.d) + (nb.st.always ? "" : " (till " + nb.st.closeAt + ")") + ".",
      "Nearest open: " + (nb.bar.name || "a bar") + ", " + distTxt(nb.d) + (nb.st.always ? "" : " (until " + nb.st.closeAt + ")") + ".");
    var show = function () {
      A.toast(txt, { id: "aio-close", cls: "oh-toast", ms: 9000,
        action: nb ? { label: "📍 " + L("Visa", "Show"), fn: function () { A.openBar(nb.bar); } } : null });
    };
    if (window.OLNU_STRIP && window.OLNU_STRIP.after) window.OLNU_STRIP.after(show); else show();
  }

  /* ---------- Ikväll chip (max one) ---------- */
  function chip() {
    if (!A || (!H && !SB)) return null;
    var c = here(), ci = A.myCheckin && A.myCheckin(), mb = A.myBeer && A.myBeer();
    var key = (c ? c.lat.toFixed(3) + "," + c.lng.toFixed(3) : "") + "|" + Math.floor(Date.now() / 30000) + "|" + (ci ? ci.id : "") + "|" + (mb ? mb.lat + "," + mb.lng : "");
    if (chipCache.at && chipCache.key === key) return chipCache.v;
    var v = null, bar = A.LIVE ? myBar() : null, st = bar ? barStatus(bar) : null;
    if (st && st.open && !st.always && st.closeIn > 0 && st.closeIn <= 30) {
      v = { hx: "aio-close", t: L("⏰ " + (bar.name || "Krogen") + " stänger " + st.closeAt, "⏰ " + (bar.name || "The bar") + " closes " + st.closeAt), bar: bar };
    } else if (nightMode()) {
      var rows = nmNear(c, 3);
      if (rows.length && rows[0].d < 15000) v = { hx: "aio-nm", t: L("🌭 Nattmat öppet nu: ", "🌭 Food open now: ") + rows[0].n.name + " · " + distTxt(rows[0].d) + (rows.length > 1 ? " +" + (rows.length - 1) : "") };
    } else {
      var x = sbNear(c), w = wall(Date.now());
      if (x && x.d < 30000 && x.st.open && x.st.closeIn <= 120 && w.dow < 6) v = { hx: "aio-sb", t: L("🍾 Systemet stänger " + x.st.closeAt + " · " + dur(x.st.closeIn) + " kvar", "🍾 Systembolaget closes " + x.st.closeAt) };
    }
    chipCache = { at: Date.now(), key: key, v: v };
    return v;
  }

  window.OPPET = {
    init: function (api) { A = api; setTimeout(load, 1500); setInterval(function () { chipCache.at = 0; modeCheck(false); }, 60000); },
    onAuthed: function () { load(); },
    onPoll: function () { load(); chipCache.at = 0; modeCheck(false); try { checkClosing(); } catch (e) {} },
    hudChipsHTML: function () {
      var v = null; try { v = chip(); } catch (e) { v = null; }
      return v ? '<button type="button" class="hx-chip hx-aio" data-hx="' + v.hx + '">' + esc(v.t) + "</button>" : "";
    },
    hudClick: function (action) {
      if (action === "aio-nm") nmSheet();
      else if (action === "aio-sb") sbSheet();
      else if (action === "aio-close") {
        var bar = myBar(), nb = bar ? nearestOpenBar(bar, 45) : null;
        if (nb) A.openBar(nb.bar); else if (bar) A.openBar(bar);
      }
    },
    // for js/barinfo.js, js/places.js and js/forfest.js
    status: status, label: label, barStatus: barStatus, hoursFor: hoursFor, day: day, hhmm: hhmm, dur: dur, wall: wall,
    evening: evening, nightMode: nightMode, openLate: openLate, nmNear: nmNear, sbNear: sbNear, forfestNode: forfestNode,
    clubAge: function (id) { return H && H.age ? H.age[String(id)] || null : null; },
    setOverride: function (id, c) {
      var k = String(id);
      if (c && c.min != null) overrides[k] = { min: c.min | 0, closed: !!c.closed, ev: evening() }; else delete overrides[k];
      chipCache.at = 0;
    },
    nmSheet: nmSheet, sbSheet: sbSheet, distTxt: distTxt,
    _set: function (h, sb) { if (h) { H = h; nmList = []; nmById = {}; (h.nm || []).forEach(function (x) { var o = { id: placeId(x[1], x[2]), name: x[0], lat: x[1], lng: x[2], t: x[3], w: x[4] }; nmList.push(o); nmById[o.id] = o; }); } if (sb) SB = sb.stores.map(function (x) { return { name: x[0], lat: x[1], lng: x[2], w: x[3], guess: !!x[4] }; }); loaded = true; changed(); },
    _check: checkClosing
  };
})();
