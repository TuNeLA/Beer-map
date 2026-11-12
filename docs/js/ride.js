/* PintsNow — RIDE v3 (lane ride3, 2026-11-11; v2 = lane ride F1, 2026-11-10; research scratchpad/research/F1-ride.md +
   ride3/RESEARCH.md; migrations 0420 + 0495). window.RIDE. "Hämta mig" like Uber / Bolt, for friends (free, no strangers).
   Started by js/skjuts.js (SKJUTS.init → RIDE.init(api, hooks)); no app.js hook.
   OFF unless the server says ride_flags_get().ride_v2 = true (missing RPC / old server / flag off = today's skjuts.js).
   1 Request: one sheet — where (my position or a point on the map), WHERE TO (optional: Hem = the home zone, or another
     place by search / map pick), how many, a short note → ride_request2 (0495; an older server = ride_request, no
     destination). Before the take a driver sees only the AREA of the destination + the trip estimate; the exact point only
     the taker, only while the ride is live.
   2 Driver push (notify-group {event:"pickup", req_id, ride:1}, text built by the server) + in-app: a "Jag kör ikväll"
     driver asks ride_stamp_get every 5 s (cheap; a change → ride_poll), so a new request shows within seconds: toast +
     vibrate + the offer sheet opens when no other sheet is open.
   3 First accept wins on the server (ride_take, one atomic UPDATE).
   4 Live, in this order (Uber: accept → arrived → start trip → complete trip): Tagen → På väg (driver taps) → Framme
     (driver taps "Jag är här", or the server when the car is within 150 m) → I bilen (rider "Jag sitter i bilen" or driver
     "Hen sitter i bilen") → Klar (driver "Framme vid målet"). The rider can never end the ride. Both phones poll every
     2 s while the ride is live, so a step shows on the other phone within ~3 s (toast + card).
     Quick chats per role; a new line = toast (and read aloud for the driver, speechSynthesis sv-SE, mute toggle).
     "Ring": no number by default; a consent request, the number only after the other side says Ja (0495 ride_calls).
   5 The car glides on the rider's map (one short rAF tween per update, only while live and visible) with "Oskar · 3 min".
   6 Flags: re-asked every 30 s (not 10 min) and at once when ride_poll / the stamp says something else.
   Copy: DIALEKT keys ride.* (sv-neutral pack registered below). Styles: ride.css (prefix rd-). No 112 link in the ride
   sheets (owner 11 Nov 21:09: a pickup is not an emergency; 112 stays big in SOS / Följ mig hem / Hem-läge). */
(function () {
  "use strict";
  var U = window.U;
  var A = null, HK = {}, flags = null, flagsAt = 0, R = null, skew = 0, off = false;
  var box = null, foot = null, tail = null, view = null, tick = 0, posT = 0, posBusy = false, pend = {}, pick = null, form = null, mk = { drv: null, pk: null, dst: null };
  var FLAGS_MS = 30000, POS_MS = 4000, LIVE_MS = 2000, IDLE_MS = 5000, FULL_MS = 20000;   // live + open: 2 s (staging: 2.5 s gave 3.4 s once for stamp + poll)
  var stamp = null, stampOff = false, fullAt = 0, tw = {}, areaC = {};
  var STEPS = ["taken", "enroute", "arrived", "picked", "done"];

  /* ---------- copy (sv-neutral; the dialect lane adds regions) ---------- */
  var P = {
    "ride.title": "Hämta mig", "ride.title.drive": "Du kör", "ride.title.offer": "Skjuts?",
    "ride.lead": "Frågan går till alla i dina gäng och vänner som kör ikväll. Ingen som tryckt ÖL! får den.",
    "ride.where": "Var ä du?", "ride.here": "Där jag ä", "ride.pick": "Välj på kartan", "ride.pax": "Hur många?",
    "ride.note": "Nåt mer?", "ride.note.ph": "t.ex. vid kebaben", "ride.send": "Skicka", "ride.sending": "Skickar…",
    "ride.priv": "Bara den som tar körningen ser exakt var du ä och vart du ska. Bilens position syns bara för dig, bara under körningen.",
    "ride.pos.wait": "Hämtar din position…", "ride.pos.none": "Ingen position. Välj på kartan.",
    "ride.pick.lead": "Dra kartan så nålen står där du ska hämtas.", "ride.pick.ok": "Hämta mig här", "ride.pick.cancel": "Avbryt",
    "ride.dest": "Vart ska du?", "ride.dest.opt": "Valfritt", "ride.dest.home": "Hem", "ride.dest.other": "Annan plats",
    "ride.dest.q": "Sök plats eller adress", "ride.dest.qb": "Sök", "ride.dest.map": "Välj på kartan", "ride.dest.clear": "Ta bort målet",
    "ride.dest.nohome": "Ingen hemzon än. Sätt den, så räcker ett tryck nästa gång.", "ride.dest.none": "Hittade inget. Prova med ort, eller välj på kartan.",
    "ride.dest.searching": "Söker…", "ride.dest.pick.lead": "Dra kartan så nålen står där du ska.", "ride.dest.pick.ok": "Hit ska jag",
    "ride.dest.point": "Punkt på kartan", "ride.from": "Från {x}", "ride.to": "Till {x}", "ride.to.none": "Inget mål angivet",
    "ride.trip": "Resa ca {km} km · {m} min", "ride.away": "{km} km bort · ca {m} min dit",
    "ride.wait": "Väntar på chaufför", "ride.asked": ["{n} tillfrågade", "{n} har fått frågan"], "ride.no": "{n} kan int'",
    "ride.since": "Skickad för {m} min sen", "ride.none": "Ingen kör ikväll just nu.", "ride.allno": "Alla har sagt nej.",
    "ride.again": "Fråga igen", "ride.wide": "Fråga fler", "ride.wide.sub": "Alla vänner som int' druckit, även de som int' kör.",
    "ride.taxi": "Ta en taxi", "ride.taxi.map": "Hitta taxi nära dig", "ride.cancel": "Avbryt förfrågan",
    "ride.taken": "{name} tar dig!", "ride.enroute": "{name} ä på väg", "ride.arrived": "{name} ä framme",
    "ride.picked": "Ni åker", "ride.picked.to": "Ni åker · till {x}",
    "ride.eta": "ca {m} min · {km} km", "ride.waited": "Väntat {m} min", "ride.stale": "{name} verkar int' ha åkt än.",
    "ride.car.check": "Kolla att det ä rätt bil.", "ride.car.none": "Ingen bil angiven",
    "ride.step.taken": "Tagen", "ride.step.enroute": "På väg", "ride.step.arrived": "Framme", "ride.step.picked": "I bilen", "ride.step.done": "Klar",
    "ride.map": "Visa på kartan", "ride.route": "Vägen till {name}", "ride.route.dest": "Vägen till {x}", "ride.in.car": "Jag sitter i bilen",
    "ride.done": ["Framme! {name} levererade.", "Hemma snart. Snyggt jobbat, {name}!"], "ride.thanks": "Tack! Skål",
    "ride.thanks.sent": "Skål skickad till {name}", "ride.cancelled": "Avbrutet. Ingen ser nåns position längre.",
    "ride.expired": "Ingen hann svara. Ta en taxi eller fråga igen.",
    "ride.offer.lead": "{name} behöver skjuts", "ride.offer.pax": "{pax} pers", "ride.offer.ago": "Frågade för {m} min sen",
    "ride.take": "Jag tar den", "ride.decline": "Kan int'", "ride.tookit": "{name} tog den ✓", "ride.tookit.me": "Du tog den",
    "ride.declined": "Du sa nej. Ändrat dig? Du kan fortfarande ta den.", "ride.gone": "{name} behöver int' skjuts längre.",
    "ride.excluded": "Du släppte den. Vi frågar de andra.",
    "ride.drunk": "Du har tryckt ÖL! ikväll. Kör int' bil.", "ride.drunk.off": "Stäng av Jag kör",
    "ride.drive.lead": "Du kör {name}", "ride.drive.go": "På väg", "ride.drive.at": "Jag är här", "ride.drive.in": "{name} sitter i bilen",
    "ride.drive.done": "Framme vid målet", "ride.drive.done0": "Klar, framme",
    "ride.drive.s0": "Kör till {name}", "ride.drive.s1": "På väg till {name}", "ride.drive.s2": "Väntar på {name}", "ride.drive.s3": "Kör {name} till {x}", "ride.drive.s3n": "Kör {name} dit hen ska",
    "ride.drive.letgo": "Släpp den", "ride.drive.share": "{name} ser din bil på kartan tills ni ä klara.",
    "ride.drive.ghost": "Du ä i spökläge: {name} ser int' din bil. Tryck stegen själv.",
    "ride.drive.donehead": "Kvällens chaufför", "ride.drive.donesub": ["Snyggt! {n} körningar ikväll.", "Hjälte. {n} körningar ikväll."],
    "ride.drive.thanked": "{name} säger: Tack! Skål", "ride.speak": "Läs upp meddelanden",
    "ride.chat.ph": "Skriv…", "ride.chat.send": "Skicka",
    "ride.qd1": "Jag är här", "ride.qd2": "2 min kvar", "ride.qd3": "Hittar int'", "ride.qd4": "Står utanför",
    "ride.qr1": "Kommer ut nu", "ride.qr2": "Står vid ingången", "ride.qr3": "Ge mig 5 min", "ride.qr4": "Tack!",
    "ride.call": "Ring", "ride.call.to": "Ring {name}", "ride.call.wait": "Väntar på svar…", "ride.call.no": "{name} vill int' visa numret.",
    "ride.call.in": "{name} vill ringa dig. Visa ditt nummer?", "ride.call.yes": "Ja, visa", "ride.call.nej": "Nej",
    "ride.call.warn": "Hen ser ditt nummer och kan spara det.", "ride.call.ph": "Ditt nummer, 07x-xxx xx xx",
    "ride.call.asked": "Frågat {name}. Du får numret om hen säger ja.", "ride.call.shared": "{name} ser ditt nummer under körningen.",
    "ride.call.bad": "Skriv ett svenskt mobilnummer: 07x-xxx xx xx.", "ride.call.slow": "Du har redan frågat två gånger.",
    "ride.call.toast": "{name} vill ringa dig", "ride.call.got": "{name} visar sitt nummer. Tryck Ring.",
    "ride.toast.offer": "{name} behöver skjuts · {place}", "ride.toast.taken": "{name} tar dig! Spänn fast dig.",
    "ride.toast.enroute": "{name} ä på väg till dig.", "ride.toast.arrived": "{name} ä framme. Kolla att det ä rätt bil.",
    "ride.toast.picked": "{name} sitter i bilen. Kör försiktigt!", "ride.toast.done": "Framme! Tacka {name}.",
    "ride.toast.gone": "{name} behöver int' skjuts längre.", "ride.toast.msg": "{name}: {text}",
    "ride.toast.redisp": "{name} kunde int'. Vi frågar de andra.", "ride.toast.sent": "Skickat till {n}. Håll appen öppen.",
    "ride.toast.sent0": "Ingen kör ikväll just nu. Kolla taxi.",
    "ride.chip.wait": "Hämta mig · väntar", "ride.chip.live": "{name} kör dig", "ride.chip.offer": "{name} behöver skjuts", "ride.chip.drive": "Du kör {name}",
    "ride.car.label": "Bil (syns bara för den du kör)", "ride.car.ph": "t.ex. Röd Volvo V70 · ABC 123", "ride.car.saved": "Bilen sparad.",
    "ride.err": "Det gick int'. Försök igen.", "ride.err.slow": "Vänta en liten stund innan du frågar igen.",
    "ride.err.pos": "Vi vet int' var du ä. Välj på kartan.", "ride.err.drinking": "Du har tryckt ÖL! ikväll. Någon annan får köra.",
    "ride.err.order": "Ta stegen i ordning."
  };
  function reg() { try { if (window.DIALEKT && window.DIALEKT.register) { window.DIALEKT.register("sv-neutral", P); return true; } } catch (e) {} return false; }
  reg();
  function fill(s, v) { return String(s).replace(/\{(\w+)\}/g, function (_m, k) { return v && v[k] != null ? String(v[k]) : ""; }); }
  function T(k, v) {
    var out = null;
    try { if (window.DIALEKT && window.DIALEKT.t) { var r = window.DIALEKT.t(k, v); if (r && r !== k) out = r; } } catch (e) {}
    if (out == null) { var d = P[k]; if (Array.isArray(d)) d = d[0]; out = fill(d == null ? k : d, v); }
    try { if (U && U.n1) out = U.n1(out); } catch (e) {}   // "1 körningar" → "1 körning"
    return out;
  }

  /* ---------- small helpers ---------- */
  function esc(s) { return U.esc(s); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function missing(e) { var m = String((e && (e.code || "")) + " " + (e && e.message || "")); return /PGRST202|42883|does not exist|Could not find the function/i.test(m); }
  // soft = a 0495 function: missing on an older server never turns ride off (the caller falls back)
  function call(name, params, soft) {
    if (!A || !A.rpc) return Promise.resolve({ data: null, error: { message: "no_api" } });
    return A.rpc(name, params || {}).then(function (r) { r = r || { error: { message: "error" } }; if (r.error && missing(r.error) && !soft) { off = true; flags = {}; } return r; });
  }
  function data(r) { return r && !r.error ? A.parseData(r.data) : null; }
  function errText(e) {
    var m = String((e && e.message) || "");
    if (/slow_down/.test(m)) return T("ride.err.slow");
    if (/no_position|invalid_position/.test(m)) return T("ride.err.pos");
    if (/invalid_phone/.test(m)) return T("ride.call.bad");
    return T("ride.err");
  }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") e.textContent = v; else if (k === "html") e.innerHTML = v; else if (k === "class") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function ic(name, cls) { try { return window.PNI ? window.PNI.svg(name, cls || "") : ""; } catch (e) { return ""; } }
  function icEl(name, cls) { return h("span", { class: "rd-ic " + (cls || ""), "aria-hidden": "true", html: ic(name) }); }
  function now() { return Date.now() + skew; }
  function mins(iso) { var t = Date.parse(iso); return isFinite(t) ? Math.max(0, Math.floor((now() - t) / 60000)) : 0; }
  function km(m) { return (Math.round((m || 0) / 100) / 10).toFixed(1).replace(".", ","); }
  function push(id) { try { if (A.PUSH_ON && A.invoke) A.invoke("notify-group", { event: "pickup", req_id: id, ride: 1 }); } catch (e) {} }
  function ghost() { try { if (window.EXTRAS && window.EXTRAS.ghostOn) return !!window.EXTRAS.ghostOn(); return localStorage.getItem("olnu.ghostMode") === "1"; } catch (e) { return false; } }
  function myName() { try { return (A.getName && A.getName()) || null; } catch (e) { return null; } }
  function more() { return !!(R && R.more); }
  function initial(n) { return String(n || "?").trim().charAt(0).toUpperCase() || "?"; }
  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function sheetOpen() { try { return !!(A.sheetOpen && A.sheetOpen()); } catch (e) { return false; } }
  function vib(p) { try { if (window.FX && window.FX.vibrate) window.FX.vibrate(p || [30, 60, 30]); } catch (e) {} }
  function face(name, spec, cls) {
    var f = h("span", { class: "rd-face " + (cls || ""), "aria-hidden": "true" });
    var s = ""; try { if (spec && window.AVATAR && window.AVATAR.svg) s = window.AVATAR.svg(spec, { small: true }); } catch (e) { s = ""; }
    if (typeof s === "string" && s.indexOf("<svg") >= 0) f.innerHTML = s; else { f.classList.add("rd-face-i"); f.textContent = initial(name); }
    return f;
  }
  function town(lat, lng) { try { var c = window.CITIES && window.CITIES.nearest(lat, lng); return c && c.name ? c.name : ""; } catch (e) { return ""; } }
  // I-30: a place NAME only if the rider CHOSE it: the bar they are checked in at (≤ 150 m), or (viaMap) the bar they put the pin on
  // (≤ 75 m). Never an automatic "nära <bar>" from the GPS. No name = "" (the label is then the area only).
  function distM(a, b, c, d) { var r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2); return 12742000 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y)); }
  function placeOf(lat, lng, viaMap) {
    try { var c = window.PN && window.PN.myCheckin && window.PN.myCheckin(); if (c && c.name && isFinite(c.lat) && distM(lat, lng, +c.lat, +c.lng) <= 150) return String(c.name); } catch (e) {}
    try { if (viaMap && window.BARS && window.BARS.describe) { var d = window.BARS.describe({ precise: true, lat: lat, lng: lng }); if (d && d.kind === "at" && d.name) return d.name; } } catch (e) {}
    return "";
  }
  function pkSet(lat, lng, viaMap) {   // the pickup point: a chosen name (or "") + the coarse area (async, ≤ 4 s)
    form.lat = lat; form.lng = lng; form.place = placeOf(lat, lng, viaMap); form.area = town(lat, lng);
    areaOf(lat, lng).then(function (a) { if (form && form.lat === lat && a) { form.area = a; paintReq(); } });
  }
  function fromTxt(x) { return x.place ? T("ride.from", { x: x.place }) : x.area ? T("ride.from.area", { x: x.area }) : T("ride.from.none"); }
  function fix(ms) { return HK.fix ? HK.fix(ms) : Promise.resolve(null); }
  // phase: 0 taken · 1 på väg · 2 framme · 3 i bilen · 4 klar (the server status + step_at.picked, 0495)
  function phase(x) {
    if (!x) return -1;
    if (x.status === "done") return 4;
    if (x.status === "arrived") return x.step_at && x.step_at.picked ? 3 : 2;   // a 0420 server has no "picked" step (x.v3 missing)
    return x.status === "enroute" ? 1 : x.status === "taken" ? 0 : -1;
  }
  function destTxt(d, exact) { if (!d) return ""; var n = exact && d.name ? d.name : ""; return n && d.area && n !== d.area ? n + " · " + d.area : (n || d.area || ""); }

  /* ---------- the coarse area of a point (Nominatim, as homezone.js; once per point, ≤ 4 s) ---------- */
  function areaOf(lat, lng) {
    var k = (+lat).toFixed(3) + "," + (+lng).toFixed(3), t0 = town(lat, lng);
    if (areaC[k]) return Promise.resolve(areaC[k]);
    return new Promise(function (res) {
      var done = false, fin = function (v) { if (done) return; done = true; v = v || t0 || ""; if (v) areaC[k] = v; res(v); };
      setTimeout(function () { fin(null); }, 4000);
      try {
        fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=sv&lat=" + (+lat).toFixed(3) + "&lon=" + (+lng).toFixed(3))
          .then(function (r) { return r.json(); }).then(function (j) { fin(areaFromAddr(j && j.address, t0)); }, function () { fin(null); });
      } catch (e) { fin(null); }
    });
  }
  function areaFromAddr(a, t0) {
    if (!a) return null;
    var small = a.suburb || a.quarter || a.neighbourhood || a.city_district || a.village || a.hamlet || "";
    var big = a.town || a.city || a.municipality || t0 || "";
    big = String(big).replace(/ kommun$/, "");
    return small && big && small !== big ? small + ", " + big : (small || big || null);
  }

  /* ---------- flags + data ---------- */
  function loadFlags(force) {
    if (off || !A || !A.LIVE) return Promise.resolve(flags);
    if (!force && flags && Date.now() - flagsAt < FLAGS_MS) return Promise.resolve(flags);
    flagsAt = Date.now();
    var was = on();
    return call("ride_flags_get").then(function (r) {
      var d = data(r); flags = d && typeof d === "object" ? d : {};
      // app.js CFG10 may answer from this phone (≤ 10 min old) in the first minute of the page: ask the server after it
      // → the next poll after page age 62 s asks again (inside the poll's bundle: no extra request, perf-pw "≤ 3 a minute")
      if (r && r.cached) { var age = 0; try { age = performance.now(); } catch (e) {} flagsAt = Date.now() - FLAGS_MS + Math.max(0, 62000 - age); }
      if (!on()) { R = null; syncMap(); stopPos(); }
      if (was !== on()) { stamp = null; try { if (HK.force) HK.force(); } catch (e) {} try { if (A.updateCounts) A.updateCounts(); } catch (e) {} }
      return flags;
    });
  }
  function on() { return !off && !!(flags && flags.ride_v2); }
  function pollArgs() {
    var a = { p_lat: null, p_lng: null, p_ghost: ghost() };
    try { if (HK.driving && HK.driving()) { var l = A.lastLoc && A.lastLoc(); if (l && isFinite(l.lat)) { a.p_lat = +(+l.lat).toFixed(3); a.p_lng = +(+l.lng).toFixed(3); } } } catch (e) {}
    return a;
  }
  function onData(r) {
    fullAt = Date.now();
    if (!r || !r.on) {
      R = null;
      if (r && r.on === false && flags && flags.ride_v2) { flags = Object.assign({}, flags, { ride_v2: false }); loadFlags(true); }   // the switch went off: confirm now
      syncMap(); stopPos(); return;
    }
    var prev = R; R = r;
    if (r.now) { var t = Date.parse(r.now); if (isFinite(t)) skew = t - Date.now(); }
    announce(prev, r);
    syncMap(); syncPos(); repaint();
    if (want) openId(want);
  }
  function live() { return !!(R && ((R.mine && R.mine.live) || (R.drive && R.drive.live) || (R.offers || []).some(function (x) { return x.live && x.can_take; }))); }
  // skjuts.js fastLoop asks this: {ms, tick}. tick = ask the cheap ride_stamp_get first; null = slow (the 45 s poll).
  function fast() {
    if (!on()) return null;
    var m = R && R.mine, d = R && R.drive, drv = !!(HK.driving && HK.driving()) && !(R && R.drinking);
    if ((m && m.live && m.status !== "open") || (d && d.live && d.status !== "open")) return { ms: LIVE_MS, tick: false };
    if (m && m.live) return { ms: LIVE_MS, tick: true };
    if (R && !R.drinking && (R.offers || []).some(function (x) { return x.live && x.can_take && !x.my_declined; })) return { ms: LIVE_MS, tick: true };
    if (drv) return { ms: IDLE_MS, tick: true };
    return null;
  }
  // true = run the full ride_poll now
  function stampTick() {
    if (stampOff || Date.now() - fullAt > FULL_MS) return Promise.resolve(true);
    return call("ride_stamp_get", null, true).then(function (r) {
      if (r.error) { if (missing(r.error)) { stampOff = true; return true; } return false; }   // busy / net: wait for the next tick
      var d = data(r) || {};
      if (d.on === false) { if (flags && flags.ride_v2) { flags = Object.assign({}, flags, { ride_v2: false }); R = null; syncMap(); stopPos(); loadFlags(true); } return false; }
      var ch = stamp === null || d.s !== stamp; stamp = d.s || ""; return ch;
    });
  }
  function find(id) {
    if (!R) return null; id = String(id);
    if (R.mine && String(R.mine.id) === id) return R.mine;
    if (R.drive && String(R.drive.id) === id) return R.drive;
    return (R.offers || []).filter(function (x) { return String(x.id) === id; })[0] || null;
  }
  function merge(x) {   // a fresh row from an action RPC (same shape as the poll)
    if (!x || !x.id) return; R = R || { on: true, offers: [] };
    if (x.role === "rider") R.mine = x; else if (x.role === "taker") { R.drive = x; R.offers = (R.offers || []).filter(function (o) { return o.id !== x.id; }); }
    else { var f = false; R.offers = (R.offers || []).map(function (o) { if (o.id === x.id) { f = true; return x; } return o; }); if (!f) R.offers.unshift(x); }
    if (x.role !== "taker" && R.drive && R.drive.id === x.id && x.role === "asked") R.drive = null;
    syncMap(); syncPos(); repaint();
    try { if (HK.fast) HK.fast(); } catch (e) {}
  }
  function refresh() { return HK.force ? HK.force() : Promise.resolve(); }

  /* ---------- read aloud for the driver (speechSynthesis, sv-SE only, mute toggle) ---------- */
  function speakOn() { return lsGet("olnu.rdSpeak", 1) !== 0; }
  function say1(text) {
    try {
      var S = window.speechSynthesis; if (!S || !speakOn() || document.hidden || !(R && R.drive && R.drive.live)) return;
      var v = (S.getVoices() || []).filter(function (x) { return /^sv/i.test(x.lang || ""); })[0];
      if (!v) return;   // no Swedish voice: skip quietly
      var u = new SpeechSynthesisUtterance(String(text).replace(/int'/g, "inte")); u.voice = v; u.lang = v.lang; u.rate = 1.05;
      S.speak(u);
    } catch (e) {}
  }

  /* ---------- toasts on news (once per thing, kept 2 days) ---------- */
  function announce(prev, r) {
    var seen = lsGet("olnu.rdSeen", {}) || {}, t = Date.now(), ch = false;
    Object.keys(seen).forEach(function (k) { if (t - seen[k] > 2 * 864e5) { seen[k] = undefined; ch = true; } });
    seen = JSON.parse(JSON.stringify(seen));
    function once(k, fn) { if (seen[k]) return; seen[k] = t; ch = true; fn(); }
    (r.offers || []).forEach(function (x) {
      if (!x.live || !x.can_take || x.my_declined || r.drinking) return;
      once("o" + x.id + ":" + x.round, function () {
        var pl = [x.place || x.area || "", x.dest && x.dest.area ? "→ " + x.dest.area : ""].filter(Boolean).join(" ");
        A.toast(T("ride.toast.offer", { name: x.name, place: pl }).replace(/ · $/, ""), { id: "rd-o-" + x.id, ms: 15000, urgent: true, cls: "rd-toast",
          action: { label: "Visa", fn: function () { openId(x.id); } } });
        vib();
        if (!sheetOpen() && !pick && !document.hidden) openId(x.id);   // like Uber's offer screen (only when nothing else is open)
      });
    });
    var m = r.mine;
    if (m && m.live && m.taker_name) {
      var p = phase(m), nm = { name: m.taker_name };
      if (p >= 0) once("t" + m.id + ":" + m.taker_name, function () { if (p === 0) A.toast(T("ride.toast.taken", nm), { id: "rd-m", ms: 8000, urgent: true }); });
      if (p >= 1) once("e" + m.id + ":" + m.taker_name, function () { if (p === 1) { A.toast(T("ride.toast.enroute", nm), { id: "rd-m", ms: 6000, urgent: true }); vib([20]); } });
      if (p >= 2) once("a" + m.id + ":" + m.taker_name, function () { if (p === 2) { A.toast(T("ride.toast.arrived", nm), { id: "rd-m", ms: 10000, urgent: true }); vib(); } });
    }
    if (m && m.status === "done" && m.taker_name && prev && prev.mine && prev.mine.id === m.id && prev.mine.status !== "done")
      once("d" + m.id, function () { A.toast(T("ride.toast.done", { name: m.taker_name }), { id: "rd-m", ms: 6000, urgent: true }); });
    if (m && m.live && m.status === "open" && m.round > 1 && m.step_at && m.step_at.redispatch && prev && prev.mine && prev.mine.id === m.id && prev.mine.taker_name)
      once("r" + m.id + ":" + m.round, function () { A.toast(T("ride.toast.redisp", { name: prev.mine.taker_name }), { id: "rd-m", ms: 8000 }); });
    var d = r.drive, rn = d && d.rider ? d.rider.name : "";
    if (d && d.status === "cancelled") once("c" + d.id, function () { A.toast(T("ride.toast.gone", { name: rn }), { id: "rd-d", ms: 8000, urgent: true }); say1(T("ride.toast.gone", { name: rn })); });
    if (d && d.live && phase(d) === 3 && d.step_at && d.step_at.picked_by === "rider")
      once("p" + d.id, function () { A.toast(T("ride.toast.picked", { name: rn }), { id: "rd-d", ms: 6000, urgent: true }); vib([20]); say1(T("ride.drive.in", { name: rn })); });
    // chat lines from the other side (≤ 3 min old) + "Ring?" asks / answers
    [[m, m && m.taker_name], [d, rn]].forEach(function (p2) {
      var x = p2[0]; if (!x || !x.msgs) return;
      x.msgs.forEach(function (g) {
        if (g.me || !(Date.parse(g.at) > now() - 180000)) return;
        once("m" + x.id + ":" + (g.id || g.at), function () {
          A.toast(T("ride.toast.msg", { name: p2[1] || "", text: g.body }), { id: "rd-msg", ms: 6000, urgent: true }); vib([20]);
          if (x.role === "taker") say1(T("ride.toast.msg", { name: p2[1] || "", text: g.body }));
        });
      });
      var c = x.call; if (!c || !x.live) return;
      if (c["in"]) once("ci" + c["in"].id, function () { A.toast(T("ride.call.toast", { name: p2[1] || "" }), { id: "rd-call", ms: 10000, urgent: true, action: { label: "Svara", fn: function () { openId(x.id); } } }); vib(); });
      if (c.tel) once("ct" + x.id + ":" + c.tel.slice(-2), function () { A.toast(T("ride.call.got", { name: p2[1] || "" }), { id: "rd-call", ms: 6000, urgent: true }); });
    });
    if (ch) lsSet("olnu.rdSeen", seen);
  }

  /* ---------- map: the car (rider), the pickup (rider + taker), the destination (taker, after pickup). No CSS transitions. ---------- */
  function marker(key, lat, lng, cls, label, html) {
    var map = A && A.map, L = window.L;
    if (!map || !L) return;
    if (lat == null || !isFinite(+lat)) { if (mk[key]) { try { map.removeLayer(mk[key]); } catch (e) {} mk[key] = null; } return; }
    if (mk[key]) {
      if (mk[key].__html !== html) { try { var el = mk[key].getElement && mk[key].getElement(), pin = el && el.querySelector(".rd-pin"); if (pin) pin.innerHTML = html; mk[key].__html = html; } catch (e) {} }
      if (key === "drv") glide(key, +lat, +lng); else { try { mk[key].setLatLng([+lat, +lng]); } catch (e) {} }
      return;
    }
    try {
      if (map.getPane && !map.getPane("ride")) { map.createPane("ride"); map.getPane("ride").style.zIndex = 725; }
      mk[key] = L.marker([+lat, +lng], { pane: "ride", keyboard: true, title: label, zIndexOffset: 9500,
        icon: L.divIcon({ className: "rd-mk", iconSize: [0, 0], iconAnchor: [0, 0], html: '<div class="rd-pin ' + cls + '">' + html + "</div>" }) }).addTo(map);
      mk[key].__html = html;
      mk[key].on("click", function () { var x = (R && (R.mine || R.drive)); if (x) openId(x.id); });
    } catch (e) { mk[key] = null; }
  }
  // the car glides to its new spot (≤ 900 ms, one marker, only while a ride is live and the tab is visible; jumps > 2 km jump)
  function glide(key, lat, lng) {
    var m = mk[key]; if (!m) return;
    if (tw[key]) { try { cancelAnimationFrame(tw[key]); } catch (e) {} tw[key] = 0; }
    var f = null; try { f = m.getLatLng(); } catch (e) {}
    if (!f || reduced() || document.hidden || typeof requestAnimationFrame !== "function" || U.haversine(f.lat, f.lng, lat, lng) > 2000 || (f.lat === lat && f.lng === lng)) {
      try { m.setLatLng([lat, lng]); } catch (e) {} return;
    }
    var t0 = 0, D = 900, fl = f.lat, fg = f.lng;
    var step = function (t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / D); k = k * (2 - k);
      try { m.setLatLng([fl + (lat - fl) * k, fg + (lng - fg) * k]); } catch (e) { k = 1; }
      tw[key] = k < 1 ? requestAnimationFrame(step) : 0;
    };
    tw[key] = requestAnimationFrame(step);
  }
  function syncMap() {
    var m = R && R.mine, d = R && R.drive, dr = m && m.live && m.driver && m.driver.lat != null ? m.driver : null;
    var lab = dr ? String(dr.name).slice(0, 16) + (dr.eta_min && phase(m) < 2 ? " · " + dr.eta_min + " min" : "") : "";
    marker("drv", dr ? dr.lat : null, dr ? dr.lng : null, "rd-pin-car", dr ? dr.name : "", ic("taxi") + "<b>" + esc(lab) + "</b>");
    var mp = m && m.live && m.status !== "open" && phase(m) < 3 && m.pk_lat != null ? m : null;
    var tp = d && d.live && d.pk_lat != null && phase(d) < 3 ? d : null;
    if (tp) marker("pk", tp.pk_lat, tp.pk_lng, "rd-pin-pk", tp.rider ? tp.rider.name : "", ic("pin") + "<b>" + esc(tp.rider ? String(tp.rider.name).slice(0, 18) : "") + "</b>");
    else marker("pk", mp ? mp.pk_lat : null, mp ? mp.pk_lng : null, "rd-pin-pk", "Du", ic("pin") + "<b>Du</b>");
    var dd = d && d.live && phase(d) === 3 && d.dest && d.dest.lat != null ? d.dest : null;
    marker("dst", dd ? dd.lat : null, dd ? dd.lng : null, "rd-pin-dst", dd ? destTxt(dd, true) : "", ic("flag") + "<b>" + esc(dd ? String(dd.name || dd.area || "").slice(0, 18) : "") + "</b>");
  }

  /* ---------- the taker's position (only this ride, only while live, never in ghost mode), every 4 s ---------- */
  function syncPos() {
    var d = R && R.drive, go = !!(d && d.live && d.status !== "open" && !ghost());
    if (!go) { stopPos(); return; }
    if (posT) return;
    var step = function () {
      posT = setTimeout(step, POS_MS);
      var x = R && R.drive; if (!x || !x.live || ghost()) { stopPos(); return; }
      if (document.hidden || posBusy) return;
      posBusy = true;
      fix(3500).then(function (p) {
        if (!p || !(R && R.drive && R.drive.live)) { posBusy = false; return; }
        return call("ride_pos", { p_id: x.id, p_lat: p.lat, p_lng: p.lng }).then(function (r) {
          posBusy = false; var j = data(r);
          if (j && j.status && R && R.drive && R.drive.id === x.id && j.status !== R.drive.status) {
            if (STEPS.indexOf(j.status) > STEPS.indexOf(R.drive.status)) { R.drive.status = j.status; if (j.status === "arrived") push(x.id); repaint(); }
            refresh();   // the server took an auto step: show the same state as the rider sees
          }
        });
      }).catch(function () { posBusy = false; });
    };
    step();
  }
  function stopPos() { if (posT) { clearTimeout(posT); posT = 0; } }

  /* ---------- sheets ---------- */
  function sheet(title, kind, id) {
    A.openSheet(title, function (body) {
      // box = repainted on every poll; foot = the chat field (built once per ride, never repainted, so the keyboard stays
      // open and a half-written line stays); tail = the end buttons (Avbryt / Släpp den) under the chat field
      box = h("div", { class: "rd" }); foot = h("div", { class: "rd rd-foot" }); tail = h("div", { class: "rd rd-tail" }); view = { kind: kind, id: id };
      body.appendChild(box); body.appendChild(foot); body.appendChild(tail);
      paint();
    });
    clearInterval(tick); tick = setInterval(function () { if (!box || !document.body.contains(box)) { clearInterval(tick); tick = 0; return; } if (view && view.kind !== "req") paint(); }, 30000);
  }
  // an input INSIDE the repainted box (the "Ring" number field) has focus: wait (the chat field lives in foot, never repainted)
  function typingIn() { var a = document.activeElement; return !!(a && box && box.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName)); }
  function repaint() { if (box && document.body.contains(box) && view && view.kind !== "req" && !typingIn()) paint(); }
  function paint() {
    if (!box || !view) return;
    if (view.kind === "req") return paintReq();
    var x = find(view.id); box.innerHTML = ""; if (tail) tail.innerHTML = "";
    if (!x) { box.appendChild(h("p", { class: "rd-muted", text: T("ride.cancelled") })); composer(null); return; }
    if (x.role === "rider") paintRider(x); else if (x.role === "taker") paintTaker(x); else paintOffer(x);
    composer(x.live && x.status !== "open" && (x.role === "rider" || x.role === "taker") ? x : null);
    if (pend[x.id]) { var a = pend[x.id]; pend[x.id] = null; if (a === "ta" && x.role === "asked" && x.can_take) take(x); else if (a === "nej" && x.role === "asked" && x.live) decline(x); }
  }
  function openReq(opts) {
    if (!on()) return false;
    var m = R && R.mine;
    if (m && m.live) { openId(m.id); return true; }
    var keep = !!(opts && opts.keep && form);
    if (!keep) form = { pax: (form && form.pax) || 1, note: (form && form.note) || "", where: "here", lat: null, lng: null, place: "", dest: null, dmode: null, q: "", ps: null };
    sheet(T("ride.title"), "req", null);
    if (!keep) locate();
    return true;
  }
  function locate() {
    form.lat = null; form.lng = null; form.place = ""; form.area = ""; form.loading = true; paintReq();
    var l = null; try { l = A.lastLoc && A.lastLoc(); } catch (e) {}
    if (l && isFinite(l.lat)) pkSet(l.lat, l.lng, false);
    fix(8000).then(function (p) {
      form.loading = false;
      if (form.where !== "here") return;
      if (p) pkSet(p.lat, p.lng, false);
      paintReq();
    });
  }
  function seg(label, items, cur, onPick, cls) {
    var s = h("div", { class: "rd-seg " + (cls || ""), role: "radiogroup", "aria-label": label });
    items.forEach(function (it) {
      var b = h("button", { type: "button", role: "radio", class: "rd-segb", "aria-checked": String(it[0] === cur), "data-v": String(it[0]), text: it[1] });
      b.addEventListener("click", function () { onPick(it[0]); });
      s.appendChild(b);
    });
    return s;
  }
  function home() { try { return window.HOMEZONE && window.HOMEZONE.home ? window.HOMEZONE.home() : null; } catch (e) { return null; } }
  function setDest(d) {
    form.dest = d; form.ps = null; paintReq();
    if (d && d.lat != null) areaOf(d.lat, d.lng).then(function (a) { if (form && form.dest === d && a) { d.area = a; paintReq(); } });
  }
  function pickDest(v) {
    var f = form;
    if (v === f.dmode && v !== "other") { f.dmode = null; f.dest = null; paintReq(); return; }   // a second tap on Hem = no destination
    f.dmode = v;
    if (v === "home") {
      var hz = home();
      if (!hz) {
        f.dmode = null; paintReq();
        A.toast(T("ride.dest.nohome"), { ms: 5000 });
        try { if (window.HOMEZONE && window.HOMEZONE.open) window.HOMEZONE.open({ then: function () { openReq({ keep: true }); if (home()) pickDest("home"); } }); } catch (e) {}
        return;
      }
      setDest({ kind: "home", name: T("ride.dest.home"), area: town(hz.lat, hz.lng), lat: +hz.lat, lng: +hz.lng });
      return;
    }
    if (f.dest && f.dest.kind === "home") f.dest = null;
    paintReq();
  }
  function destCenter() {   // I-07: hits near the pickup / my position first, else the map centre
    var f = form, c = f && f.lat != null ? f : null;
    try { if (!c) c = (A.lastLoc && A.lastLoc()) || null; } catch (e) {}
    if (!c || !isFinite(c.lat)) { try { var m = A.map.getCenter(); c = { lat: m.lat, lng: m.lng }; } catch (e) { c = null; } }
    return c;
  }
  function hitDest(x) { var t = town(x.lat, x.lng); return { kind: "place", name: String(x.title || "").slice(0, 40), area: areaFromAddr(x.addr, t) || x.sub || t, lat: x.lat, lng: x.lng }; }
  function paintReq() {
    if (!box || !view || view.kind !== "req") return;
    var f = form; box.innerHTML = "";
    box.appendChild(h("p", { class: "rd-lead", text: T("ride.lead") }));
    box.appendChild(h("h3", { class: "rd-h", text: T("ride.where") }));
    box.appendChild(seg(T("ride.where"), [["here", T("ride.here")], ["map", T("ride.pick")]], f.where, function (v) {
      if (v === "map") { startPick("pk"); return; }
      f.where = "here"; locate();
    }, "rd-seg2"));
    var plTxt = f.lat != null ? (f.place || (f.area ? T("ride.from.area", { x: f.area }) : (f.where === "map" ? T("ride.dest.point") : "Din position"))) : (f.loading ? T("ride.pos.wait") : T("ride.pos.none"));
    box.appendChild(h("div", { class: "rd-place" + (f.lat == null ? " rd-place-none" : "") }, [icEl("pin"), h("span", { text: plTxt })]));
    // destination (optional)
    box.appendChild(h("h3", { class: "rd-h rd-h-dest" }, [T("ride.dest") + " ", h("small", { class: "rd-opt", text: T("ride.dest.opt") })]));
    box.appendChild(seg(T("ride.dest"), [["home", T("ride.dest.home")], ["other", T("ride.dest.other")]], f.dmode, pickDest, "rd-seg2 rd-dseg"));
    if (f.dest) {
      box.appendChild(h("div", { class: "rd-place rd-dest" }, [icEl("flag"), h("span", { text: destTxt(f.dest, true) }),
        h("button", { type: "button", class: "rd-x", "aria-label": T("ride.dest.clear"), html: ic("x"), onclick: function () { f.dest = null; f.dmode = null; paintReq(); } })]));
    } else if (f.dmode === "other") {
      var q = h("input", { type: "search", class: "rd-in rd-dq", maxlength: "80", placeholder: T("ride.dest.q"), "aria-label": T("ride.dest.q"), enterkeyhint: "search", value: f.q || "" });
      var qb = h("button", { type: "button", class: "btn rd-qbtn", text: T("ride.dest.qb") });
      var say = h("div", { class: "rd-say" }, [q, qb]); box.appendChild(say);
      if (!f.ps) f.ps = {};
      if ((window.PN && window.PN.placeSearch)) (window.PN && window.PN.placeSearch).attach({ input: q, button: qb, host: say, center: destCenter, state: f.ps,
        subOf: function (x) { return areaFromAddr(x.addr, town(x.lat, x.lng)) || x.sub; }, onPick: function (x) { f.ps = {}; f.q = ""; setDest(hitDest(x)); } });
      box.appendChild(h("button", { type: "button", class: "rd-rowbtn rd-dmap", onclick: function () { startPick("dest"); } }, [icEl("map"), h("span", { text: T("ride.dest.map") }), icEl("chev-right", "rd-chev")]));
    }
    box.appendChild(h("h3", { class: "rd-h", text: T("ride.pax") }));
    box.appendChild(seg(T("ride.pax"), [[1, "1"], [2, "2"], [3, "3"], [4, "4+"]], f.pax, function (v) { f.pax = v; paintReq(); }, "rd-seg4"));
    box.appendChild(h("h3", { class: "rd-h", text: T("ride.note") }));
    var inp = h("input", { type: "text", class: "rd-in rd-note-in", maxlength: "40", placeholder: T("ride.note.ph"), "aria-label": T("ride.note"), value: f.note || "" });
    inp.addEventListener("input", function () { f.note = inp.value; });
    box.appendChild(inp);
    var go = h("button", { type: "button", class: "btn btn-amber btn-block rd-go", text: T("ride.send"), disabled: f.lat == null || f.busy });
    go.addEventListener("click", function () { send(go); });
    box.appendChild(go);
    box.appendChild(h("p", { class: "rd-muted rd-priv", text: T("ride.priv") }));
  }
  function send(btn) {
    var f = form; if (f.lat == null || f.busy) return;
    f.busy = true; btn.disabled = true; btn.textContent = T("ride.sending");
    // I-30: the place NAME goes to the server only when chosen; the area (stadsdel / by) always. Exact point = p_lat / p_lng (after the take only)
    var base = { p_lat: f.lat, p_lng: f.lng, p_place: f.place || null, p_pax: f.pax, p_note: (f.note || "").trim() || null, p_name: myName() };
    var d = f.dest, go, dp = d && d.lat != null ? { p_dest_lat: d.lat, p_dest_lng: d.lng, p_dest_name: d.name || null, p_dest_area: d.area || town(d.lat, d.lng) || null, p_dest_kind: d.kind === "home" ? "home" : "place" } : {};
    var legacy = function () {   // an older server (no 0506): 0495 ride_request2 with the destination, or 0420 ride_request
      return d && d.lat != null ? call("ride_request2", Object.assign({}, base, dp), true).then(function (r) { return r.error && missing(r.error) ? call("ride_request", base) : r; }) : call("ride_request", base);
    };
    go = call("ride_request3", Object.assign({}, base, dp, { p_pk_chosen: !!f.place, p_pk_area: f.area || town(f.lat, f.lng) || null }), true)
      .then(function (r) { return r.error && missing(r.error) ? legacy() : r; });
    go.then(function (r) {
      f.busy = false;
      if (r.error) { A.toast(errText(r.error), { err: true }); paintReq(); return; }
      var x = data(r); if (!x || !x.id) { paintReq(); return; }
      form = null; stamp = null; merge(x); push(x.id);
      A.toast(x.n ? T("ride.toast.sent", { n: x.n }) : T("ride.toast.sent0"), { ms: 5000 });
      openId(x.id);
    });
  }
  /* map pick (pickup or destination): a fixed pin over the map centre; the map moves under it (no marker, no per-frame JS) */
  function startPick(what) {
    var map = A && A.map; if (!map) return;
    var dest = what === "dest";
    if (!dest) form.where = "map";
    pick = h("div", { class: "rd-pick", role: "dialog", "aria-label": dest ? T("ride.dest.map") : T("ride.pick") });
    var c = map.getContainer ? map.getContainer().getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    var pin = h("div", { class: "rd-pick-pin" + (dest ? " rd-pick-dst" : ""), "aria-hidden": "true", html: ic(dest ? "flag" : "pin") });
    pin.style.left = Math.round(c.left + c.width / 2) + "px"; pin.style.top = Math.round(c.top + c.height / 2) + "px";
    var lead = dest ? T("ride.dest.pick.lead") : T("ride.pick.lead");
    var lbl = h("p", { class: "rd-pick-place", text: lead });
    var okB = h("button", { type: "button", class: "btn btn-amber rd-pick-ok", text: dest ? T("ride.dest.pick.ok") : T("ride.pick.ok") });
    var noB = h("button", { type: "button", class: "btn rd-pick-no", text: T("ride.pick.cancel") });
    var bar = h("div", { class: "rd-pick-bar" }, [lbl, h("div", { class: "rd-row2" }, [noB, okB])]);
    pick.appendChild(pin); pick.appendChild(bar);
    document.body.appendChild(pick);
    var upd = function () { try { var ll = map.getCenter(); var p = placeOf(ll.lat, ll.lng, true) || town(ll.lat, ll.lng); lbl.textContent = p || lead; } catch (e) {} };
    map.on("moveend", upd);
    var end = function (ok) {
      try { map.off("moveend", upd); } catch (e) {}
      var ll = null; try { ll = map.getCenter(); } catch (e) {}
      if (pick && pick.parentNode) pick.parentNode.removeChild(pick); pick = null;
      if (dest) {
        openReq({ keep: true });
        if (ok && ll) setDest({ kind: "place", name: placeOf(ll.lat, ll.lng, true) || T("ride.dest.point"), area: town(ll.lat, ll.lng), lat: ll.lat, lng: ll.lng });
        return;
      }
      if (ok && ll) pkSet(ll.lat, ll.lng, true);
      else if (form.lat == null) form.where = "here";
      openReq({ keep: true });
      if (form && form.where === "here" && form.lat == null) locate();
    };
    okB.addEventListener("click", function () { end(true); });
    noB.addEventListener("click", function () { end(false); });
    try { A.closeSheet("pick"); } catch (e) {}
    try { var l = dest ? (form.dest && form.dest.lat != null ? form.dest : form.lat != null ? { lat: form.lat, lng: form.lng } : null) : (form.lat != null ? { lat: form.lat, lng: form.lng } : (A.lastLoc && A.lastLoc())); if (l) A.flyTo(l.lat, l.lng, dest ? 14 : 17); } catch (e) {}
  }

  function steps(x) {
    var cur = phase(x), list = x.v3 ? STEPS : STEPS.filter(function (s) { return s !== "picked"; }), ol = h("ol", { class: "rd-steps" + (x.v3 ? " rd-steps5" : ""), "aria-label": "Status" });
    if (!x.v3 && cur === 4) cur = 3;
    list.forEach(function (s, i) {
      var st = i < cur || x.status === "done" ? "done" : i === cur ? "now" : "next";
      ol.appendChild(h("li", { class: "rd-step rd-step-" + st, "data-step": s, "aria-current": st === "now" ? "step" : null }, [icEl(st === "done" ? "check" : "clock"), h("span", { text: T("ride.step." + s) })]));
    });
    return ol;
  }
  function chat(x) {
    var wrap = h("div", { class: "rd-chat" });
    var list = h("ul", { class: "rd-msgs" });
    (x.msgs || []).slice(-6).forEach(function (m) { list.appendChild(h("li", { class: "rd-msg" + (m.me ? " rd-msg-me" : ""), text: m.body })); });
    if ((x.msgs || []).length) wrap.appendChild(list);
    var q = h("div", { class: "rd-quick", "data-role": x.role });
    var keys = x.role === "taker" ? ["ride.qd1", "ride.qd2", "ride.qd3", "ride.qd4"] : ["ride.qr1", "ride.qr2", "ride.qr3", "ride.qr4"];
    keys.forEach(function (k) {
      var t = T(k);
      q.appendChild(h("button", { type: "button", class: "rd-qb", text: t, onclick: function (e) { say(x, t, e.currentTarget); } }));
    });
    wrap.appendChild(q);
    return wrap;
  }
  // the chat field (+ the read-aloud switch for the driver): built once per ride id in `foot`, outside the repainted box
  function composer(x) {
    if (!foot) return;
    var key = x ? x.id + ":" + x.role : null;
    if (foot.__key === key) return;
    foot.__key = key; foot.innerHTML = "";
    if (!x) return;
    var id = x.id;
    var inp = h("input", { type: "text", class: "rd-in rd-chat-in", maxlength: "120", placeholder: T("ride.chat.ph"), "aria-label": T("ride.chat.ph"), enterkeyhint: "send" });
    var sb = h("button", { type: "button", class: "rd-send", "aria-label": T("ride.chat.send"), html: ic("send") });
    sb.addEventListener("click", function () { var v = inp.value.trim(), y = find(id); if (v && y) { inp.value = ""; say(y, v, sb); } });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); sb.click(); } });
    foot.appendChild(h("div", { class: "rd-say" }, [inp, sb]));
    if (x.role === "taker" && window.speechSynthesis) {
      var sw = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(speakOn()), "aria-label": T("ride.speak") });
      sw.addEventListener("click", function () { lsSet("olnu.rdSpeak", speakOn() ? 0 : 1); sw.setAttribute("aria-checked", String(speakOn())); });
      foot.appendChild(h("div", { class: "toggle-row rd-speak" }, [h("span", { text: T("ride.speak") }), sw]));
    }
  }
  function say(x, text, btn) {
    if (btn) btn.disabled = true;
    call("ride_msg", { p_id: x.id, p_text: text }).then(function (r) {
      if (btn) btn.disabled = false;
      if (r.error) { A.toast(errText(r.error), { err: true }); return; }
      merge(data(r));
    });
  }
  /* "Ring": a consent request; the number only after the other side says Ja (0495). No number by default. */
  function callBox(x, other) {
    var c = x.call; if (!x.live || x.status === "open" || c === undefined) return null;   // older server: no Ring
    c = c || {};
    var w = h("div", { class: "rd-callw" });
    if (c["in"]) {
      var card = h("div", { class: "rd-card rd-callin", role: "alert" }, [h("b", { text: T("ride.call.in", { name: other }) }), h("small", { class: "rd-muted", text: T("ride.call.warn") })]);
      var ph = null;
      if (!c["in"].saved) { ph = h("input", { type: "tel", class: "rd-in rd-phone", maxlength: "20", autocomplete: "tel", placeholder: T("ride.call.ph"), "aria-label": T("ride.call.ph") }); card.appendChild(ph); }
      var yes = h("button", { type: "button", class: "btn btn-amber rd-call-yes", text: T("ride.call.yes") });
      var no = h("button", { type: "button", class: "btn rd-call-no", text: T("ride.call.nej") });
      yes.addEventListener("click", function () {
        var v = ph ? ph.value.trim() : null; if (ph && v.replace(/\D/g, "").length < 9) { A.toast(T("ride.call.bad"), { err: true }); ph.focus(); return; }
        if (ph) ph.blur();
        act(yes, "ride_call_answer", { p_id: x.id, p_yes: true, p_phone: v }, function (d) { merge(d); A.toast(T("ride.call.shared", { name: other }), { ms: 4000 }); }, true);
      });
      no.addEventListener("click", function () { act(no, "ride_call_answer", { p_id: x.id, p_yes: false, p_phone: null }, function (d) { merge(d); }, true); });
      card.appendChild(h("div", { class: "rd-row2" }, [no, yes]));
      w.appendChild(card);
    }
    if (c.tel) { w.appendChild(h("a", { class: "btn btn-block rd-call rd-call-tel", href: "tel:" + c.tel, html: ic("phone", "pi-lead") + esc(T("ride.call.to", { name: other })) })); return w; }
    var o = c.out, wait = o && !o.answer && Date.parse(o.at) > now() - 600000;
    if (o && o.answer === "no") w.appendChild(h("p", { class: "rd-muted rd-small", text: T("ride.call.no", { name: other }) }));
    var b = h("button", { type: "button", class: "btn btn-block rd-call", disabled: wait || (c.n_out | 0) >= 2, html: ic("phone", "pi-lead") + esc(wait ? T("ride.call.wait") : T("ride.call")) });
    b.addEventListener("click", function () {
      act(b, "ride_call_ask", { p_id: x.id }, function (d) { if (!d) return; merge(d); push(x.id); A.toast(T("ride.call.asked", { name: other }), { ms: 4000 }); }, true);
    });
    w.appendChild(b);
    return w;
  }
  function taxiCard() {
    var c = null; try { c = A.lastLoc && A.lastLoc(); } catch (e) {}
    var m = R && R.mine; if (m && m.pk_lat != null) c = { lat: m.pk_lat, lng: m.pk_lng };
    try { if (!window.TAXI_DATA && window.OLNU_LAZY_NOW) window.OLNU_LAZY_NOW().then(function () { repaint(); }); } catch (e) {}
    var list = [].concat(window.BOLD_TAXI || [], ((window.TAXI_DATA && window.TAXI_DATA.towns) || []).filter(function (t) { return t.tel && !t.unverified; }));
    var best = null, bd = 30000;
    if (c && isFinite(c.lat)) list.forEach(function (t) { var d = U.haversine(c.lat, c.lng, t.lat, t.lng); if (d <= bd) { bd = d; best = t; } });
    var href = best ? "tel:" + best.tel : "https://www.google.com/maps/search/taxi/" + (c ? "@" + (+c.lat).toFixed(5) + "," + (+c.lng).toFixed(5) + ",14z" : "");
    var a = h("a", { class: "rd-taxi", href: href, target: best ? null : "_blank", rel: best ? null : "noopener" }, [icEl("taxi"),
      h("span", { class: "rd-taxi-t" }, [h("b", { text: best ? T("ride.taxi") : T("ride.taxi.map") }), h("small", { text: best ? best.name + " · " + best.text : "Google Maps" })]),
      icEl(best ? "phone" : "chev-right", "rd-taxi-go")]);
    return a;
  }
  function act(btn, name, params, after, soft) {
    if (btn) btn.disabled = true;
    return call(name, params, soft).then(function (r) {
      if (btn) btn.disabled = false;
      if (r.error) { A.toast(/slow_down/.test(String(r.error.message)) && /call/.test(name) ? T("ride.call.slow") : errText(r.error), { err: true }); refresh(); return null; }
      var d = data(r); if (d && d.code === "order") A.toast(T("ride.err.order"), { ms: 3000 });
      if (after) after(d); return d;
    });
  }
  function route(from, to) {   // "Från … / Till …" (two short lines with icons)
    var ul = h("ul", { class: "rd-route" });
    ul.appendChild(h("li", {}, [icEl("pin", "rd-r-from"), h("span", { text: from })]));
    ul.appendChild(h("li", { class: to ? "" : "rd-r-none" }, [icEl("flag", "rd-r-to"), h("span", { text: to || T("ride.to.none") })]));
    return ul;
  }
  function tripTxt(d) { return d && d.trip_m ? T("ride.trip", { km: km(d.trip_m), m: d.trip_min || 1 }) : ""; }
  function paintRider(x) {
    var b = box;
    if (x.status === "open" && x.live) {
      var m = mins(x.opened_at), none = !x.n, alln = x.n > 0 && x.declined_n >= x.n;
      b.appendChild(h("div", { class: "rd-card rd-wait" }, [
        h("div", { class: "rd-wait-top" }, [h("span", { class: "rd-pulse", "aria-hidden": "true" }), h("b", { class: "rd-big", text: none ? T("ride.none") : alln ? T("ride.allno") : T("ride.wait") })]),
        route(fromTxt(x), x.dest ? T("ride.to", { x: destTxt(x.dest, true) }) : ""),
        h("p", { class: "rd-muted", text: [x.pax + " pers", T("ride.asked", { n: x.n }) + (x.declined_n ? " · " + T("ride.no", { n: x.declined_n }) : "")].filter(Boolean).join(" · ") }),
        h("p", { class: "rd-muted", text: T("ride.since", { m: m }) })]));
      if (more() && (none || alln || m >= 5)) {
        var row = h("div", { class: "rd-row2" });
        if (!x.again && !none) row.appendChild(h("button", { type: "button", class: "btn rd-again", text: T("ride.again"), disabled: m < 4, onclick: function (e) { act(e.currentTarget, "ride_again", { p_id: x.id }, function (d) { merge(d); push(x.id); }); } }));
        if (!x.wide) row.appendChild(h("button", { type: "button", class: "btn rd-wide", text: T("ride.wide"), onclick: function (e) { act(e.currentTarget, "ride_widen", { p_id: x.id }, function (d) { merge(d); push(x.id); }); } }));
        if (row.childNodes.length) { b.appendChild(row); if (!x.wide) b.appendChild(h("p", { class: "rd-muted rd-small", text: T("ride.wide.sub") })); }
      }
      if (more() && (none || alln || m >= 10)) b.appendChild(taxiCard());
      b.appendChild(h("button", { type: "button", class: "btn btn-block rd-cancel", text: T("ride.cancel"), onclick: function (e) { cancel(x, e.currentTarget); } }));
      return;
    }
    if (x.live && x.driver) {
      var d = x.driver, p = phase(x), nm = { name: d.name };
      var msg = p === 3 ? (x.dest ? T("ride.picked.to", { x: destTxt(x.dest, true) }) : T("ride.picked")) : p === 2 ? T("ride.arrived", nm) : p === 1 ? T("ride.enroute", nm) : T("ride.taken", nm);
      var sub = p === 3 ? tripTxt(x.dest) : p === 2 ? T("ride.waited", { m: mins(x.step_at && x.step_at.arrived) }) : d.eta_min ? T("ride.eta", { m: d.eta_min, km: km(d.dist_m) }) : "";
      var stale = p < 2 && d.pos_at && mins(d.pos_at) >= 3;
      b.appendChild(h("div", { class: "rd-card rd-driver", "data-phase": String(p) }, [
        h("div", { class: "rd-who" }, [face(d.name, d.avatar, "rd-face-l"), h("div", { class: "rd-who-t" }, [h("b", { class: "rd-big rd-state", text: msg }),
          sub ? h("span", { class: "rd-eta", text: sub }) : null])]),
        p < 3 ? h("div", { class: "rd-car" }, [icEl("taxi"), h("span", {}, [h("b", { text: d.car || T("ride.car.none") }), h("small", { text: T("ride.car.check") })])]) : null,
        stale ? h("p", { class: "rd-warn", text: T("ride.stale", { name: d.name }) }) : null,
        steps(x)]));
      if (p === 2 && x.v3) b.appendChild(h("button", { type: "button", class: "btn btn-amber btn-block rd-incar", text: T("ride.in.car"), onclick: function (e) { act(e.currentTarget, "ride_step", { p_id: x.id, p_step: "picked" }, function (dd) { merge(dd); }, true); } }));
      if (d.lat != null && p < 3) b.appendChild(h("button", { type: "button", class: "rd-rowbtn rd-showmap", onclick: function () { showMap(x); } }, [icEl("map"), h("span", { text: T("ride.map") }), icEl("chev-right", "rd-chev")]));
      var cb = callBox(x, d.name); if (cb) b.appendChild(cb);
      b.appendChild(chat(x));
      if (p < 3) tail.appendChild(h("button", { type: "button", class: "btn btn-block rd-cancel", text: T("ride.pick.cancel"), onclick: function (e) { cancel(x, e.currentTarget); } }));
      return;
    }
    // ended
    if (x.status === "done") {
      var nm2 = x.taker_name || "";
      b.appendChild(h("div", { class: "rd-card rd-end" }, [icEl("check", "rd-ok"), h("b", { class: "rd-big", text: T("ride.done", { name: nm2 }) })]));
      if (more()) b.appendChild(x.thanks ? h("p", { class: "rd-muted", text: T("ride.thanks.sent", { name: nm2 }) })
        : h("button", { type: "button", class: "btn btn-amber btn-block rd-thanks", html: ic("cheers", "pi-lead") + esc(T("ride.thanks")), onclick: function (e) {
          act(e.currentTarget, "ride_thanks", { p_id: x.id }, function (dd) { merge(dd); A.toast(T("ride.thanks.sent", { name: nm2 }), { ms: 3500 }); try { if (window.FX && window.FX.cheers) window.FX.cheers(); } catch (er) {} }); } }));
      return;
    }
    b.appendChild(h("p", { class: "rd-lead", text: x.status === "expired" ? T("ride.expired") : T("ride.cancelled") }));
    if (x.status === "expired") { b.appendChild(taxiCard()); b.appendChild(h("button", { type: "button", class: "btn btn-block rd-new", text: T("ride.again"), onclick: function () { R.mine = null; openReq({}); } })); }
  }
  function showMap(x) {
    try {
      A.closeSheet("map");
      var d = x.driver, pts = [[+d.lat, +d.lng]]; if (x.pk_lat != null) pts.push([+x.pk_lat, +x.pk_lng]);
      if (pts.length > 1 && A.map && A.map.fitBounds && window.L && window.L.latLngBounds) A.map.fitBounds(window.L.latLngBounds(pts), { padding: [60, 60], maxZoom: 16 });
      else A.flyTo(+d.lat, +d.lng, 16);
    } catch (e) {}
  }
  function cancel(x, btn) {
    act(btn, "ride_cancel", { p_id: x.id }, function (d) { merge(d); push(x.id); syncMap(); A.toast(T("ride.cancelled"), { ms: 3500 }); });
  }
  function paintOffer(x) {
    var b = box, d = x.dest;
    var facts = [T("ride.offer.pax", { pax: x.pax || 1 }), x.dist_m != null ? T("ride.away", { km: km(x.dist_m), m: x.drv_min || Math.max(1, Math.ceil(x.dist_m / 500)) }) : ""].filter(Boolean).join(" · ");
    b.appendChild(h("div", { class: "rd-card rd-offer" }, [
      h("b", { class: "rd-big", text: T("ride.offer.lead", { name: x.name }) }),
      route(fromTxt(x), d ? T("ride.to", { x: d.area || "?" }) : ""),
      h("p", { class: "rd-facts", text: facts }),
      d && d.trip_m ? h("p", { class: "rd-facts rd-trip", text: tripTxt(d) }) : null,
      x.note ? h("p", { class: "rd-note", text: "”" + x.note + "”" }) : null,
      h("p", { class: "rd-muted", text: T("ride.offer.ago", { m: mins(x.created_at) }) })]));
    if (R && R.drinking && x.live && x.status === "open") {
      b.appendChild(h("div", { class: "rd-card rd-drunk", role: "alert" }, [icEl("block"), h("b", { text: T("ride.drunk") })]));
      if (HK.driving && HK.driving()) b.appendChild(h("button", { type: "button", class: "btn btn-block rd-drv-off", text: T("ride.drunk.off"), onclick: function (e) { if (HK.setDriver) HK.setDriver(false, e.currentTarget); } }));
      return;
    }
    if (x.taker_name && x.status !== "open") { b.appendChild(h("p", { class: "rd-took", html: ic("check") + esc(T("ride.tookit", { name: x.taker_name })) })); return; }
    if (!x.live) { b.appendChild(h("p", { class: "rd-lead", text: T("ride.gone", { name: x.name }) })); return; }
    if (x.excluded) { b.appendChild(h("p", { class: "rd-lead", text: T("ride.excluded") })); return; }
    if (x.my_declined) b.appendChild(h("p", { class: "rd-muted", text: T("ride.declined") }));
    var yes = h("button", { type: "button", class: "btn btn-amber rd-take", text: T("ride.take") });
    var no = h("button", { type: "button", class: "btn rd-decline", text: T("ride.decline"), "aria-pressed": String(!!x.my_declined) });
    yes.addEventListener("click", function () { take(x, yes); });
    no.addEventListener("click", function () { decline(x, no); });
    b.appendChild(h("div", { class: "rd-row2 rd-answer" }, [no, yes]));
  }
  function take(x, btn) {
    act(btn, "ride_take", { p_id: x.id }, function (d) {
      if (!d) return;
      if (d.ok && d.ride) { merge(d.ride); push(x.id); openId(x.id); A.toast(T("ride.drive.lead", { name: x.name }) + ". Kör försiktigt!", { ms: 4000 }); return; }
      if (d.code === "taken") { x.taker_name = d.name; x.status = "taken"; x.can_take = false; merge(x); }
      else if (d.code === "drinking") { if (R) R.drinking = true; A.toast(T("ride.err.drinking"), { err: true }); repaint(); }
      else if (d.code === "excluded") { x.excluded = true; merge(x); }
      else { x.live = false; merge(x); }
    });
  }
  function decline(x, btn) { act(btn, "ride_decline", { p_id: x.id }, function (d) { merge(d); try { A.closeSheet("done"); } catch (e) {} }); }
  // the driver's ONE next step, in order: På väg → Jag är här → Hen sitter i bilen → Framme vid målet
  function nextStep(x, rn) {
    var p = phase(x);
    if (p === 0) return ["enroute", T("ride.drive.go")];
    if (p === 1) return ["arrived", T("ride.drive.at")];
    if (p === 2 && x.v3) return ["picked", T("ride.drive.in", { name: rn })];   // a 0420 server: Framme → Klar
    return ["done", x.dest ? T("ride.drive.done") : T("ride.drive.done0")];
  }
  function paintTaker(x) {
    var b = box, rn = (x.rider && x.rider.name) || "";
    if (!x.live) {
      if (x.status === "done") {
        var n = (R && R.chauffeur) || 1;
        b.appendChild(h("div", { class: "rd-card rd-end rd-medal" }, [icEl("medal", "rd-gold"), h("b", { class: "rd-big", text: T("ride.drive.donehead") }),
          h("p", { class: "rd-muted", text: T("ride.drive.donesub", { n: n }) }), x.thanks ? h("p", { class: "rd-took", html: ic("cheers") + esc(T("ride.drive.thanked", { name: rn })) }) : null]));
      } else b.appendChild(h("p", { class: "rd-lead", text: x.status === "cancelled" ? T("ride.gone", { name: rn }) : T("ride.cancelled") }));
      return;
    }
    if (x.status === "open") { b.appendChild(h("p", { class: "rd-lead", text: T("ride.excluded") })); return; }
    var p = phase(x), dt = x.dest ? destTxt(x.dest, true) : "";
    var sub = p === 3 ? (dt ? T("ride.drive.s3", { name: rn, x: dt }) : T("ride.drive.s3n", { name: rn })) : T("ride.drive.s" + p, { name: rn });
    var facts = [p < 2 && x.dist_m != null ? km(x.dist_m) + " km" : "", (x.pax || 1) + " pers"].filter(Boolean).join(" · ");
    b.appendChild(h("div", { class: "rd-card rd-driver", "data-phase": String(p) }, [
      h("div", { class: "rd-who" }, [face(rn, x.rider && x.rider.avatar, "rd-face-l"), h("div", { class: "rd-who-t" }, [h("b", { class: "rd-big rd-state", text: sub }),
        h("span", { class: "rd-eta", text: facts })])]),
      route(fromTxt(x), dt ? T("ride.to", { x: dt }) : ""),
      x.note ? h("p", { class: "rd-note", text: "”" + x.note + "”" }) : null,
      steps(x)]));
    var nx = nextStep(x, rn);
    b.appendChild(h("button", { type: "button", class: "btn btn-amber btn-block rd-next", "data-step": nx[0], text: nx[1], onclick: function (e) {
      act(e.currentTarget, "ride_step", { p_id: x.id, p_step: nx[0] }, function (d) { merge(d); if (nx[0] === "arrived") push(x.id); if (nx[0] === "done") { stopPos(); refresh(); } }, nx[0] === "picked"); } }));
    var navTo = p === 3 && x.dest && x.dest.lat != null ? [x.dest.lat, x.dest.lng, T("ride.route.dest", { x: x.dest.name || x.dest.area || "" })] : p < 3 && x.pk_lat != null ? [x.pk_lat, x.pk_lng, T("ride.route", { name: rn })] : null;
    if (navTo) b.appendChild(h("a", { class: "rd-rowbtn rd-nav", href: "https://www.google.com/maps/dir/?api=1&destination=" + (+navTo[0]).toFixed(5) + "," + (+navTo[1]).toFixed(5), target: "_blank", rel: "noopener" },
      [icEl("compass"), h("span", { text: navTo[2] }), icEl("chev-right", "rd-chev")]));
    b.appendChild(h("p", { class: "rd-muted rd-small", text: ghost() ? T("ride.drive.ghost", { name: rn }) : T("ride.drive.share", { name: rn }) }));
    var cb = callBox(x, rn); if (cb) b.appendChild(cb);
    b.appendChild(chat(x));
    if (p < 3) tail.appendChild(h("button", { type: "button", class: "btn btn-block rd-letgo", text: T("ride.drive.letgo"), onclick: function (e) { act(e.currentTarget, "ride_cancel", { p_id: x.id }, function (d) { if (R) R.drive = null; push(x.id); stopPos(); syncMap(); if (d) merge(d); }); } }));
  }

  /* ---------- open by id (push tap / HUD / map pin) ---------- */
  var want = null;
  function openId(id) {
    var x = find(id);
    if (!x) { want = String(id); return false; }
    want = null;
    sheet(x.role === "taker" ? T("ride.title.drive") : x.role === "rider" ? T("ride.title") : T("ride.title.offer"), "ride", x.id);
    return true;
  }
  function chip() {
    if (!on() || !R) return "";
    var o = (R.offers || []).filter(function (x) { return x.live && x.can_take && !x.my_declined && !R.drinking; })[0], d = R.drive, m = R.mine, t = "", id = 0;
    if (d && d.live && d.status !== "open") { t = T("ride.chip.drive", { name: (d.rider && d.rider.name) || "" }); id = d.id; }
    else if (m && m.live) { t = m.taker_name && m.status !== "open" ? T("ride.chip.live", { name: m.taker_name }) + (m.driver && m.driver.eta_min && phase(m) < 2 ? " · ca " + m.driver.eta_min + " min" : "") : T("ride.chip.wait"); id = m.id; }
    else if (o) { t = T("ride.chip.offer", { name: o.name }); id = o.id; }
    if (!id) return "";
    return '<button type="button" class="hx-chip pk-chip-hud rd-chip" data-hx="rd:' + esc(String(id)) + '">' + ic("taxi", "pi-lead") + esc(t) + "</button>";
  }

  /* ---------- "Jag kör ikväll" extras (skjuts.js ikvNode): the car note + the drink rule ---------- */
  function ikvExtra(driving) {
    if (!on()) return null;
    var w = h("div", { class: "rd-ikv" });
    if (R && R.drinking) {
      w.appendChild(h("div", { class: "rd-drunk", role: "alert" }, [icEl("block"), h("b", { text: T("ride.drunk") })]));
      if (driving) w.appendChild(h("button", { type: "button", class: "btn btn-block rd-drv-off", text: T("ride.drunk.off"), onclick: function (e) { if (HK.setDriver) HK.setDriver(false, e.currentTarget); } }));
      return w;
    }
    if (!driving) return null;
    var inp = h("input", { type: "text", class: "rd-in", maxlength: "30", placeholder: T("ride.car.ph"), "aria-label": T("ride.car.label"), value: (R && R.car) || "" });
    var save = h("button", { type: "button", class: "btn rd-car-save", text: "Spara" });
    save.addEventListener("click", function () { act(save, "ride_car_set", { p_car: inp.value.trim() || null }, function (d) { if (d && R) R.car = d.car; A.toast(T("ride.car.saved"), { ms: 2500 }); }); });
    w.appendChild(h("label", { class: "rd-lbl", text: T("ride.car.label") }));
    w.appendChild(h("div", { class: "rd-say" }, [inp, save]));
    return w;
  }

  /* ---------- Android push buttons: /?pickup=<id>&ride=ta|nej ---------- */
  function noteAct(url) {
    try { var q = new URL(url, location.href).searchParams, id = q.get("pickup"), a = q.get("ride"); if (id && /^\d{1,18}$/.test(id) && (a === "ta" || a === "nej")) pend[id] = a; } catch (e) {}
  }
  noteAct(location.href);
  try { if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", function (e) { var d = e.data || {}; if (d.type === "olnu-open" && d.url) noteAct(d.url); }); } catch (e) {}
  document.addEventListener("visibilitychange", function () { if (!document.hidden && A && Date.now() - flagsAt > FLAGS_MS) loadFlags(true); });

  window.RIDE = {
    init: function (api, hooks) { A = api; HK = hooks || {}; reg(); },
    onAuthed: function () { return loadFlags(true); },
    loadFlags: loadFlags, on: on, live: live, pollArgs: pollArgs, onData: onData, fast: fast, tick: stampTick,
    off: function () { off = true; flags = {}; R = null; syncMap(); stopPos(); },
    open: openReq, openId: openId, has: function (id) { return !!find(id); },
    chip: chip, hud: function (a) { a = String(a || ""); if (a.indexOf("rd:") === 0) return openId(a.slice(3)); return false; },
    ikvExtra: ikvExtra, taxiCard: taxiCard, T: T, PACK: P,
    _state: function () { return R; }, _flags: function () { return flags; }, _phase: phase
  };
})();
